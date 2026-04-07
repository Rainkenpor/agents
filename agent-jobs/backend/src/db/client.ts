import BetterSQLite3 from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "fs";
import { join } from "path";
import { envs } from "../envs.js";
import * as schema from "./schema.js";

mkdirSync(envs.dbFolder, { recursive: true });

const sqlite = new BetterSQLite3(join(envs.dbFolder, "app.db"));
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });
export { sqlite };
