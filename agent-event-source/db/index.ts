// ─── Database Connection & Initialization ─────────────────────────────────────

import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { mkdirSync, existsSync } from "fs";
import * as schema from "./schema.ts";

const DATA_DIR = process.env.DATA_DIR || "./data";

if (!existsSync(DATA_DIR)) {
	mkdirSync(DATA_DIR, { recursive: true });
}

const sqlite = new Database(`${DATA_DIR}/agent-event-source.db`, { create: true });

// WAL mode for better concurrent read performance
sqlite.exec("PRAGMA journal_mode = WAL;");
sqlite.exec("PRAGMA foreign_keys = ON;");

export const db = drizzle(sqlite, { schema });

/**
 * Creates all required tables and indexes if they don't exist yet.
 * Call once at server startup before any other DB operation.
 */
export function initializeDatabase(): void {
	sqlite.exec(`
    CREATE TABLE IF NOT EXISTS repositories (
      id          TEXT PRIMARY KEY,
      url         TEXT NOT NULL,
      name        TEXT NOT NULL,
      is_active   INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT NOT NULL,
      deleted_at  TEXT,
      local_path  TEXT
    );

    CREATE TABLE IF NOT EXISTS branches (
      id                  TEXT PRIMARY KEY,
      repository_id       TEXT NOT NULL REFERENCES repositories(id),
      name                TEXT NOT NULL,
      last_commit_sha     TEXT NOT NULL,
      last_commit_message TEXT,
      last_commit_author  TEXT,
      last_commit_date    TEXT,
      is_active           INTEGER NOT NULL DEFAULT 1,
      created_at          TEXT NOT NULL,
      deleted_at          TEXT
    );

    CREATE TABLE IF NOT EXISTS sent_hooks (
      id            TEXT PRIMARY KEY,
      hook_name     TEXT NOT NULL,
      payload       TEXT NOT NULL,
      repository_id TEXT REFERENCES repositories(id),
      sent_at       TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_branches_repo
      ON branches(repository_id);
    CREATE INDEX IF NOT EXISTS idx_branches_active
      ON branches(repository_id, is_active);
    CREATE INDEX IF NOT EXISTS idx_sent_hooks_name
      ON sent_hooks(hook_name);
    CREATE INDEX IF NOT EXISTS idx_sent_hooks_repo
      ON sent_hooks(repository_id);
    CREATE INDEX IF NOT EXISTS idx_sent_hooks_sent
      ON sent_hooks(sent_at DESC);
  `);
}
