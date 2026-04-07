import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { resolve } from 'path';
import { db } from './client.js';

export function runMigrations() {
  const migrationsFolder = resolve('./drizzle');
  migrate(db, { migrationsFolder });
  console.log('[DB] Migrations applied successfully');
}
