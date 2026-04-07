import { existsSync, mkdirSync } from "node:fs";
import { defineConfig } from "drizzle-kit";
import { join } from "node:path";
import { envs } from "./src/envs.js";

console.log("Using DB file at:", join(envs.dbFolder, "app.db"));

if (!existsSync(envs.dbFolder)) {
	console.log("DB folder does not exist. Creating:", envs.dbFolder);
	mkdirSync(envs.dbFolder, { recursive: true });
}

export default defineConfig({
	schema: "./src/db/schema.ts",
	out: "./drizzle",
	dialect: "sqlite",
	dbCredentials: {
		url: join(envs.dbFolder, "app.db"),
	},
});
