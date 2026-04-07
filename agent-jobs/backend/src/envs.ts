import { resolve } from "path";
import dotenv from "dotenv";

dotenv.config({ path: "../.env" });

export const envs = {
	SERVER_PORT: Number(process.env.SERVER_PORT) || 3100,
	dbFolder: process.env.DB_FOLDER
		? resolve(process.env.DB_FOLDER)
		: resolve("./data/db"),
	reposFolder: process.env.REPOS_FOLDER
		? resolve(process.env.REPOS_FOLDER)
		: resolve("./data/repos"),
	checkIntervalMs: Number(process.env.CHECK_INTERVAL_MS) || 60_000,

	AGENT_BASE_URL: process.env.AGENT_BASE_URL,
	AGENT_MODEL: process.env.AGENT_MODEL || "gpt-4-0613",
} as const;
