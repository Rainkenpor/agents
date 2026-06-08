import { tmpdir } from "node:os";
import { join } from "node:path";

const {
	SERVER_BASE_URL,
	SERVER_PORT,
	GIT_WORKSPACE,
	GIT_REPO_TTL_MS,
	GIT_CLONE_TIMEOUT_MS,
	GIT_AUTHOR_NAME,
	GIT_AUTHOR_EMAIL,
} = process.env;

const BASE_URL = SERVER_BASE_URL || "http://localhost:3000";
const PORT = Number(SERVER_PORT ?? 3000);

export const envs = {
	BASE_URL,
	PORT,
	// ── Git MCP ───────────────────────────────────────────────────────────────
	/** Carpeta raíz donde se clonan los repos efímeros */
	GIT_WORKSPACE: GIT_WORKSPACE || join(tmpdir(), "agent-git-repos"),
	/** Tiempo de vida de un repo clonado antes de auto-eliminarse (default 1h) */
	GIT_REPO_TTL_MS: Number(GIT_REPO_TTL_MS ?? 3_600_000),
	/** Timeout para la operación de clone (default 2min) */
	GIT_CLONE_TIMEOUT_MS: Number(GIT_CLONE_TIMEOUT_MS ?? 120_000),
	/** Identidad por defecto para commits si la tool no la especifica */
	GIT_AUTHOR_NAME: GIT_AUTHOR_NAME || "agent-git",
	GIT_AUTHOR_EMAIL: GIT_AUTHOR_EMAIL || "agent-git@localhost",
};
