// ─── Webhook Retry Scheduler ──────────────────────────────────────────────────
//
// Persists failed webhook deliveries and retries them periodically.
//
// USAGE (from server bootstrap):
//   import { registerWebhookFailureHandler } from "../hooks.ts";
//   import { savePendingDelivery, startRetryScheduler } from "./hooks/webhook.retry.ts";
//
//   registerWebhookFailureHandler(savePendingDelivery);
//   startRetryScheduler(20); // minutes
//
// RETRY LOGIC:
//   • On service startup  → all pending deliveries are retried immediately.
//   • Every N minutes     → deliveries whose `next_retry_at` has passed are retried.
//   • On success          → row is deleted from pending_deliveries.
//   • On failure          → attempts counter is incremented, next_retry_at advances.

import { db } from "../db/index.ts";
import { pendingDeliveries } from "../db/schema.ts";
import type { WebhookSubscription, HookEvent } from "../hooks.ts";
import { logger } from "../util/logger.ts";
import { eq, lte } from "drizzle-orm";

const RETRY_INTERVAL_MS = 20 * 60 * 1000; // 20 minutes default

// ─── Persist a failed delivery ────────────────────────────────────────────────

/**
 * Called by the failure handler registered in hooks.ts.
 * Stores the delivery in `pending_deliveries` so it can be retried later.
 */
export async function savePendingDelivery(
	sub: WebhookSubscription,
	event: HookEvent,
): Promise<void> {
	const now = new Date().toISOString();
	await db.insert(pendingDeliveries).values({
		id: crypto.randomUUID(),
		hookName: event.name,
		payload: JSON.stringify(event.payload),
		hookTimestamp: event.timestamp,
		subscriptionId: sub.id,
		targetUrl: sub.url,
		secret: sub.secret ?? null,
		events: JSON.stringify(sub.events),
		failedAt: now,
		attempts: 1,
		lastAttemptAt: now,
		nextRetryAt: new Date(Date.now() + RETRY_INTERVAL_MS).toISOString(),
	});
	logger.info(
		`[webhook-retry] queued pending delivery for "${event.name}" → ${sub.url}`,
	);
}

// ─── Retry logic ──────────────────────────────────────────────────────────────

/**
 * Attempt delivery for a single pending row.
 * Returns true if the delivery succeeded (row should be deleted).
 */
async function attemptDelivery(
	delivery: typeof pendingDeliveries.$inferSelect,
): Promise<boolean> {
	const event: HookEvent = {
		name: delivery.hookName,
		payload: JSON.parse(delivery.payload) as unknown,
		timestamp: delivery.hookTimestamp,
	};

	const body = JSON.stringify(event);
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		"X-Hook-Name": event.name,
		"X-Hook-Timestamp": event.timestamp,
		"X-Hook-Retry": "true",
		"X-Hook-Attempt": String(delivery.attempts + 1),
	};

	if (delivery.secret) {
		const { createHmac } = await import("node:crypto");
		const sig = createHmac("sha256", delivery.secret)
			.update(body)
			.digest("hex");
		headers["X-Hook-Signature"] = `sha256=${sig}`;
	}

	try {
		const response = await fetch(delivery.targetUrl, {
			method: "POST",
			headers,
			body,
		});

		if (response.ok) {
			logger.info(
				`[webhook-retry] ✓ delivered "${delivery.hookName}" → ${delivery.targetUrl} ` +
					`(attempt ${delivery.attempts + 1}, HTTP ${response.status})`,
			);
			return true;
		}

		logger.warn(
			`[webhook-retry] ✗ "${delivery.hookName}" → ${delivery.targetUrl} ` +
				`HTTP ${response.status} (attempt ${delivery.attempts + 1})`,
		);
	} catch (err) {
		logger.warn(
			`[webhook-retry] ✗ "${delivery.hookName}" → ${delivery.targetUrl} ` +
				`unreachable: ${err} (attempt ${delivery.attempts + 1})`,
		);
	}

	return false;
}

// ─── Process pending deliveries ───────────────────────────────────────────────

/**
 * Process pending webhook deliveries.
 *
 * @param ignoreDelay - When true, retries ALL pending deliveries regardless of
 *   `next_retry_at`. Pass `true` on service startup so pending events are sent
 *   immediately instead of waiting for the first scheduled window.
 */
export async function processPendingDeliveries(
	ignoreDelay = false,
): Promise<void> {
	const now = new Date().toISOString();

	const pending = ignoreDelay
		? await db.select().from(pendingDeliveries)
		: await db
				.select()
				.from(pendingDeliveries)
				.where(lte(pendingDeliveries.nextRetryAt, now));

	if (pending.length === 0) return;

	logger.info(
		`[webhook-retry] processing ${pending.length} pending deliveries` +
			(ignoreDelay ? " (startup flush)" : ""),
	);

	for (const delivery of pending) {
		const succeeded = await attemptDelivery(delivery);

		if (succeeded) {
			await db
				.delete(pendingDeliveries)
				.where(eq(pendingDeliveries.id, delivery.id));
		} else {
			await db
				.update(pendingDeliveries)
				.set({
					attempts: delivery.attempts + 1,
					lastAttemptAt: new Date().toISOString(),
					nextRetryAt: new Date(Date.now() + RETRY_INTERVAL_MS).toISOString(),
				})
				.where(eq(pendingDeliveries.id, delivery.id));
		}
	}
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

/**
 * Start the webhook retry scheduler.
 *
 * Behaviour:
 *   1. Immediately retries all pending deliveries (startup flush).
 *   2. Schedules a recurring run every `intervalMinutes` to retry any new
 *      failures whose retry window has elapsed.
 *
 * @param intervalMinutes - Retry interval in minutes (default: 20).
 */
export function startRetryScheduler(intervalMinutes = 20): void {
	const intervalMs = intervalMinutes * 60 * 1000;

	// 1. Startup flush — send everything that is still pending right now
	processPendingDeliveries(true).catch((err) =>
		logger.error(`[webhook-retry] startup flush error: ${err}`),
	);

	// 2. Recurring scheduler
	setInterval(() => {
		processPendingDeliveries(false).catch((err) =>
			logger.error(`[webhook-retry] scheduled retry error: ${err}`),
		);
	}, intervalMs);

	logger.info(
		`[webhook-retry] scheduler started — retry every ${intervalMinutes} minute(s)`,
	);
}
