// ─── Repo Session Store ───────────────────────────────────────────────────────
//
// Gestiona los repositorios efímeros clonados por el MCP de Git.
//
// Cada `git_clone` crea una sesión identificada por un CÓDIGO DE 4 DÍGITOS que
// debe pasarse a todas las demás tools. La sesión vive en memoria con un TTL
// fijo (default 1h); al expirar se borra la carpeta y se elimina del Map.
// El estado se pierde al reiniciar el proceso, lo cual es aceptable por el TTL.

import { rm } from "node:fs/promises";
import { resolve, sep } from "node:path";
import simpleGit, { type SimpleGit } from "simple-git";
import { envs } from "./envs";
import { logger } from "./logger";
import { emit } from "../hooks";

export type RepoProtocol = "http" | "ssh";

export interface RepoSession {
	/** Código de 4 dígitos que identifica la sesión */
	code: string;
	/** Directorio local del repo clonado */
	dir: string;
	/** URL del remoto (sin credenciales) */
	url: string;
	/** Protocolo detectado al clonar */
	protocol: RepoProtocol;
	/** Rama por defecto del repo */
	defaultBranch: string;
	/** Epoch ms de creación */
	createdAt: number;
	/** Epoch ms en que expira y se elimina */
	expiresAt: number;
	/** Timer de auto-eliminación */
	timer: ReturnType<typeof setTimeout>;
}

const sessions = new Map<string, RepoSession>();

/** Genera un código aleatorio de 4 dígitos (1000–9999) sin colisión. */
function generateCode(): string {
	for (let i = 0; i < 100; i++) {
		const code = String(Math.floor(1000 + Math.random() * 9000));
		if (!sessions.has(code)) return code;
	}
	throw new Error("No se pudo generar un código de sesión único");
}

/** Devuelve la instancia simple-git apuntando al repo de la sesión. */
export function git(session: RepoSession): SimpleGit {
	return simpleGit(session.dir);
}

/**
 * Crea y registra una nueva sesión de repo. El directorio se devuelve para que
 * el caller ejecute el clone dentro de él. Arma el timer de expiración.
 */
export function createSession(meta: {
	url: string;
	protocol: RepoProtocol;
	defaultBranch: string;
}): RepoSession {
	const code = generateCode();
	const dir = resolve(envs.GIT_WORKSPACE, code);
	const createdAt = Date.now();
	const expiresAt = createdAt + envs.GIT_REPO_TTL_MS;

	const timer = setTimeout(() => {
		logger.info(`[git] sesión ${code} expiró, eliminando`);
		void destroySession(code, "expired");
	}, envs.GIT_REPO_TTL_MS);
	// No mantener vivo el proceso solo por este timer.
	if (typeof timer.unref === "function") timer.unref();

	const session: RepoSession = {
		code,
		dir,
		url: meta.url,
		protocol: meta.protocol,
		defaultBranch: meta.defaultBranch,
		createdAt,
		expiresAt,
		timer,
	};
	sessions.set(code, session);
	logger.info(`[git] sesión creada ${code} → ${dir}`);
	return session;
}

/**
 * Devuelve la sesión asociada al código o lanza un error claro si no existe
 * o ya expiró. Usar al inicio de toda tool que reciba `code`.
 */
export function getSession(code: string): RepoSession {
	const session = sessions.get(code);
	if (!session) {
		throw new Error(
			`Código de repo inválido o sesión expirada: "${code}". Clona de nuevo con git_clone.`,
		);
	}
	return session;
}

/**
 * Elimina una sesión: limpia el timer, borra el directorio del disco y la quita
 * del Map. `reason` distingue cierre manual de expiración para el hook.
 */
export async function destroySession(
	code: string,
	reason: "closed" | "expired",
): Promise<boolean> {
	const session = sessions.get(code);
	if (!session) return false;

	clearTimeout(session.timer);
	sessions.delete(code);

	try {
		await rm(session.dir, { recursive: true, force: true });
	} catch (err) {
		logger.info(`[git] error borrando ${session.dir}: ${err}`);
	}

	await emit(reason === "expired" ? "git.repo_expired" : "git.repo_closed", {
		code,
		url: session.url,
	});
	logger.info(`[git] sesión ${code} eliminada (${reason})`);
	return true;
}

/** Snapshot de las sesiones activas con TTL restante en ms. */
export function listSessions() {
	const now = Date.now();
	return [...sessions.values()].map((s) => ({
		code: s.code,
		url: s.url,
		protocol: s.protocol,
		defaultBranch: s.defaultBranch,
		createdAt: new Date(s.createdAt).toISOString(),
		expiresAt: new Date(s.expiresAt).toISOString(),
		ttlRemainingMs: Math.max(0, s.expiresAt - now),
	}));
}

/**
 * Resuelve una ruta relativa contra el directorio del repo y valida que no
 * escape de él (anti path-traversal). Devuelve la ruta absoluta segura.
 */
export function resolveSafePath(session: RepoSession, relPath: string): string {
	const base = resolve(session.dir);
	const target = resolve(base, relPath);
	if (target !== base && !target.startsWith(base + sep)) {
		throw new Error(
			`Ruta fuera del repositorio no permitida: "${relPath}"`,
		);
	}
	return target;
}
