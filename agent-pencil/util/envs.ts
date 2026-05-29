import { resolve } from "node:path";

const {
	SERVER_BASE_URL,
	SERVER_PORT,
	PENCIL_WORKSPACE_DIR,
	PENCIL_PUPPETEER_EXECUTABLE,
} = process.env;

const BASE_URL = SERVER_BASE_URL || "http://localhost:3000";
const PORT = Number(SERVER_PORT ?? 3000);
const WORKSPACE_DIR = resolve(PENCIL_WORKSPACE_DIR ?? "./workspace");
const PUPPETEER_EXECUTABLE = PENCIL_PUPPETEER_EXECUTABLE;

export const envs = {
	BASE_URL,
	PORT,
	WORKSPACE_DIR,
	PUPPETEER_EXECUTABLE,
};
