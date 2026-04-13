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
