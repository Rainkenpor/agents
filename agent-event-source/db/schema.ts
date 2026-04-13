// ─── Database Schema (Drizzle + Bun SQLite) ───────────────────────────────────

import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

// ─── Repositories ─────────────────────────────────────────────────────────────

export const repositories = sqliteTable("repositories", {
	id: text("id").primaryKey(),
	url: text("url").notNull().unique(),
	name: text("name").notNull(),
	/** 1 = active, 0 = deleted */
	isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
	createdAt: text("created_at").notNull(),
	deletedAt: text("deleted_at"),
	/** Absolute path to the local bare/mirror clone used for polling */
	localPath: text("local_path"),
});

// ─── Branches ─────────────────────────────────────────────────────────────────

export const branches = sqliteTable("branches", {
	id: text("id").primaryKey(),
	repositoryId: text("repository_id")
		.notNull()
		.references(() => repositories.id),
	name: text("name").notNull(),
	lastCommitSha: text("last_commit_sha").notNull(),
	lastCommitMessage: text("last_commit_message"),
	lastCommitAuthor: text("last_commit_author"),
	lastCommitDate: text("last_commit_date"),
	/** 1 = active, 0 = branch deleted on remote */
	isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
	createdAt: text("created_at").notNull(),
	deletedAt: text("deleted_at"),
});

// ─── Sent Hooks ───────────────────────────────────────────────────────────────

export const sentHooks = sqliteTable("sent_hooks", {
	id: text("id").primaryKey(),
	hookName: text("hook_name").notNull(),
	/** JSON-serialized payload */
	payload: text("payload").notNull(),
	/** FK to repository when the hook is git-related */
	repositoryId: text("repository_id").references(() => repositories.id),
	sentAt: text("sent_at").notNull(),
});

// ─── Pending Webhook Deliveries ───────────────────────────────────────────────
//
// Stores webhook deliveries that failed (network error or non-2xx response).
// Rows are removed when delivery succeeds. Used by the retry scheduler.

export const pendingDeliveries = sqliteTable("pending_deliveries", {
	id: text("id").primaryKey(),
	hookName: text("hook_name").notNull(),
	/** JSON-serialized HookEvent payload */
	payload: text("payload").notNull(),
	/** ISO-8601 timestamp from the original HookEvent */
	hookTimestamp: text("hook_timestamp").notNull(),
	/** ID of the WebhookSubscription that failed */
	subscriptionId: text("subscription_id").notNull(),
	/** Target URL (denormalized — subscription may be gone on restart) */
	targetUrl: text("target_url").notNull(),
	/** Optional HMAC secret (denormalized for retry) */
	secret: text("secret"),
	/** JSON-serialized string[] of event filters from the subscription */
	events: text("events").notNull(),
	/** When the first failure was recorded */
	failedAt: text("failed_at").notNull(),
	/** Total delivery attempts so far (including the original failed one) */
	attempts: integer("attempts").notNull().default(1),
	/** ISO-8601 of the last attempted delivery */
	lastAttemptAt: text("last_attempt_at"),
	/** ISO-8601 — will not be retried before this time */
	nextRetryAt: text("next_retry_at").notNull(),
});
