// ─── Hook Registry & Emitter ──────────────────────────────────────────────────
//
// [AGENT INSTRUCTIONS]
// This file is the central hub for all MCP hook events (Registry Pattern).
//
// HOW TO ADD A NEW HOOK GROUP:
//   1. Create `hooks/my-domain.hook.ts` and export a `HookDefinition[]` array.
//   2. Import that array here and spread it into `registryHook`.
//
// HOW TO EMIT A HOOK FROM A TOOL:
//   import { emit } from "../hooks";
//   await emit("item.created", { id: "123", name: "Test" });
//
// HOOK NAMING CONVENTION:
//   "<resource>.<past-tense-action>"  →  "item.created", "order.cancelled"
//
// SUBSCRIBERS receive events via:
//   - SSE stream:   GET /hooks/stream[?event=<name>]
//   - Webhooks:     POST /hooks/subscriptions  (register a callback URL)

import type { ZodTypeAny } from "zod";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { HookDefinition } from "./types";
import { logger } from "./util/logger";
import { exampleHooks } from "./hooks/example.hook";

// ─── Registry ─────────────────────────────────────────────────────────────────

// Add new hook arrays here
export const registryHook: HookDefinition[] = [...exampleHooks];

// ─── Hook Discovery ───────────────────────────────────────────────────────────

/** Serialized metadata for a single payload field */
export type HookFieldMeta = {
	/** JSON-compatible type name (string, number, boolean, array, object, enum…) */
	type: string;
	/** Description from z.string().describe("…") */
	description?: string;
	/** Whether the field is optional */
	optional: boolean;
};

/** Full metadata for a single hook, suitable for JSON serialization */
export type HookCatalogEntry = {
	name: string;
	description: string;
	/** Shape of the payload emitted by this hook */
	payload: Record<string, HookFieldMeta>;
};

/**
 * Maps a Zod type name to a human-readable type string.
 * Unwraps ZodOptional so callers get the inner type + the `optional` flag.
 */
function serializeZodType(zodType: ZodTypeAny): HookFieldMeta {
	let inner = zodType;
	let optional = false;

	if (inner._def.typeName === "ZodOptional") {
		optional = true;
		inner = inner._def.innerType as ZodTypeAny;
	}

	const typeMap: Record<string, string> = {
		ZodString: "string",
		ZodNumber: "number",
		ZodBoolean: "boolean",
		ZodArray: "array",
		ZodObject: "object",
		ZodRecord: "record",
		ZodEnum: "enum",
		ZodNativeEnum: "enum",
		ZodDate: "string (date)",
		ZodNull: "null",
		ZodUndefined: "undefined",
		ZodUnknown: "unknown",
		ZodAny: "any",
	};

	const typeName = inner._def.typeName as string;
	// .description comes from .describe("…") on the Zod type
	const description =
		(inner as unknown as { description?: string }).description ??
		(zodType as unknown as { description?: string }).description;

	return {
		type: typeMap[typeName] ?? typeName.replace(/^Zod/, "").toLowerCase(),
		...(description ? { description } : {}),
		optional,
	};
}

/**
 * Returns the full hook catalog with serialized payload schemas.
 * Used by the GET /hooks discovery endpoint.
 */
export function getHookCatalog(): HookCatalogEntry[] {
	return registryHook.map((hook) => ({
		name: hook.name,
		description: hook.description,
		payload: Object.fromEntries(
			Object.entries(hook.payloadSchema).map(([key, zodType]) => [
				key,
				serializeZodType(zodType as ZodTypeAny),
			]),
		),
	}));
}

// ─── Event shape ─────────────────────────────────────────────────────────────

export type HookEvent = {
	/** Hook name (dot-notation, e.g. "item.created") */
	name: string;
	/** Arbitrary payload — shape is documented in the HookDefinition */
	payload: unknown;
	/** ISO-8601 timestamp of when the event was emitted */
	timestamp: string;
};

// ─── SSE Subscribers ─────────────────────────────────────────────────────────

type SseSubscriber = {
	id: string;
	/** undefined = receive all events */
	filter: string | undefined;
	write: (data: string) => void;
};

const sseSubscribers = new Map<string, SseSubscriber>();

// ─── Webhook Subscriptions ────────────────────────────────────────────────────

export type WebhookSubscription = {
	id: string;
	/** Target URL that will receive POST requests */
	url: string;
	/**
	 * Hook names this subscription listens to.
	 * Empty array means all events.
	 */
	events: string[];
	/** Optional HMAC-SHA256 signing secret (never returned in listings) */
	secret?: string;
	createdAt: string;
};

const webhookSubscriptions = new Map<string, WebhookSubscription>();

// ─── Emit ─────────────────────────────────────────────────────────────────────

/**
 * Emit a hook event. Call this from tool handlers after a successful action.
 *
 * SSE delivery is synchronous; webhook delivery is fire-and-forget.
 */
export async function emit(name: string, payload: unknown): Promise<void> {
	const event: HookEvent = {
		name,
		payload,
		timestamp: new Date().toISOString(),
	};

	logger.info(`[hook] ↑ ${name} ${JSON.stringify(payload).slice(0, 80)}`);

	const sseData = `data: ${JSON.stringify(event)}\n\n`;

	// ── SSE delivery (synchronous) ────────────────────────────────────────────
	for (const sub of sseSubscribers.values()) {
		if (!sub.filter || sub.filter === name) {
			try {
				sub.write(sseData);
			} catch {
				// Client disconnected without triggering the close event
				sseSubscribers.delete(sub.id);
			}
		}
	}

	// ── Webhook delivery (fire-and-forget) ────────────────────────────────────
	for (const sub of webhookSubscriptions.values()) {
		if (sub.events.length === 0 || sub.events.includes(name)) {
			deliverWebhook(sub, event).catch((err) =>
				logger.info(`[hook] webhook ${sub.id} delivery failed: ${err}`),
			);
		}
	}
}

async function deliverWebhook(
	sub: WebhookSubscription,
	event: HookEvent,
): Promise<void> {
	const body = JSON.stringify(event);
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		"X-Hook-Name": event.name,
		"X-Hook-Timestamp": event.timestamp,
	};

	if (sub.secret) {
		const { createHmac } = await import("node:crypto");
		const sig = createHmac("sha256", sub.secret).update(body).digest("hex");
		headers["X-Hook-Signature"] = `sha256=${sig}`;
	}

	const response = await fetch(sub.url, { method: "POST", headers, body });
	logger.info(`[hook] webhook ${sub.id} → ${sub.url} ${response.status}`);
}

// ─── SSE endpoint handler ─────────────────────────────────────────────────────

/**
 * Attach an SSE stream to the response. Keeps the connection open until the
 * client disconnects. Optionally filter by event name via `?event=<name>`.
 */
export function handleSseStream(
	req: IncomingMessage,
	res: ServerResponse,
): void {
	const url = new URL(req.url ?? "/", "http://localhost");
	const filter = url.searchParams.get("event") ?? undefined;
	const id = crypto.randomUUID();

	res.writeHead(200, {
		"Content-Type": "text/event-stream",
		"Cache-Control": "no-cache",
		Connection: "keep-alive",
		"Access-Control-Allow-Origin": "*",
	});

	// Initial handshake event
	res.write(
		`data: ${JSON.stringify({ name: "connected", subscriberId: id, filter: filter ?? "all" })}\n\n`,
	);

	sseSubscribers.set(id, { id, filter, write: (d) => res.write(d) });
	logger.info(
		`[hook] SSE connected: ${id}${filter ? ` (filter: ${filter})` : ""}`,
	);

	req.on("close", () => {
		sseSubscribers.delete(id);
		logger.info(`[hook] SSE disconnected: ${id}`);
	});
}

// ─── Webhook subscription management ─────────────────────────────────────────

export function addWebhookSubscription(
	url: string,
	events: string[],
	secret?: string,
): WebhookSubscription {
	const id = crypto.randomUUID();
	const sub: WebhookSubscription = {
		id,
		url,
		events,
		secret,
		createdAt: new Date().toISOString(),
	};
	webhookSubscriptions.set(id, sub);
	logger.info(`[hook] webhook subscription created: ${id} → ${url}`);
	return sub;
}

export function removeWebhookSubscription(id: string): boolean {
	const existed = webhookSubscriptions.has(id);
	if (existed) {
		webhookSubscriptions.delete(id);
		logger.info(`[hook] webhook subscription removed: ${id}`);
	}
	return existed;
}

/** Returns subscriptions with secrets redacted */
export function listWebhookSubscriptions(): Omit<WebhookSubscription, "secret">[] {
	return [...webhookSubscriptions.values()].map(({ secret: _s, ...rest }) => rest);
}
