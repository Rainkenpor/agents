import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import simpleGit from "simple-git";
import z from "zod";
import { emit } from "../hooks";
import { ok } from "../types";
import type { ToolDefinition } from "../types";
import { envs } from "../util/envs";
import { logger } from "../util/logger";
import {
	createSession,
	destroySession,
	getSession,
	git,
	listSessions,
	type RepoProtocol,
	type RepoSession,
	resolveSafePath,
} from "../util/session";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Envuelve un handler: captura errores y los devuelve como ok({ error }). */
async function run(
	fn: () => Promise<unknown>,
): Promise<ReturnType<typeof ok>> {
	try {
		return ok(await fn());
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return ok({ error: message });
	}
}

/** Detecta el protocolo a partir de la URL del remoto. */
function detectProtocol(url: string): RepoProtocol {
	if (url.startsWith("git@") || url.startsWith("ssh://")) return "ssh";
	return "http";
}

/** Inyecta el token en una URL HTTPS como userinfo (https://<token>@host/...). */
function injectToken(url: string, token: string): string {
	try {
		const u = new URL(url);
		u.username = encodeURIComponent(token);
		return u.toString();
	} catch {
		return url;
	}
}

type TreeNode =
	| { name: string; type: "file" }
	| { name: string; type: "dir"; children?: TreeNode[] };

/** Construye el árbol de carpetas/archivos excluyendo .git */
async function buildTree(absDir: string, depth: number): Promise<TreeNode[]> {
	const entries = await readdir(absDir, { withFileTypes: true });
	const nodes: TreeNode[] = [];
	for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
		if (e.name === ".git") continue;
		if (e.isDirectory()) {
			const node: TreeNode = { name: e.name, type: "dir" };
			if (depth > 1) {
				node.children = await buildTree(join(absDir, e.name), depth - 1);
			}
			nodes.push(node);
		} else {
			nodes.push({ name: e.name, type: "file" });
		}
	}
	return nodes;
}

/** Rama actual del repo. */
async function currentBranch(session: RepoSession): Promise<string> {
	return (await git(session).revparse(["--abbrev-ref", "HEAD"])).trim();
}

// ─── Tools ──────────────────────────────────────────────────────────────────

export const gitTools: ToolDefinition[] = [
	// ── Ciclo de vida ─────────────────────────────────────────────────────────
	{
		name: "git_clone",
		description:
			"Clona un repositorio Git (HTTP/HTTPS o SSH) en un workspace efímero y " +
			"devuelve un CÓDIGO DE 4 DÍGITOS requerido por todas las demás tools. " +
			"SSH usa las llaves instaladas en el sistema. Para repos HTTPS privados " +
			"se puede pasar un token. El repo se elimina automáticamente tras 1 hora.",
		inputSchema: {
			url: z
				.string()
				.describe(
					"URL del repo. HTTP(S): https://host/owner/repo.git — SSH: git@host:owner/repo.git",
				),
			token: z
				.string()
				.optional()
				.describe(
					"Token/PAT opcional para repos HTTPS privados (se inyecta en la URL, no se loguea)",
				),
		},
		handler: async ({ url, token }: { url: string; token?: string }) =>
			run(async () => {
				const protocol = detectProtocol(url);
				const cloneUrl =
					protocol === "http" && token ? injectToken(url, token) : url;

				await mkdir(envs.GIT_WORKSPACE, { recursive: true });

				// La sesión genera el código/dir; el timer de expiración arranca aquí.
				const session = createSession({ url, protocol, defaultBranch: "" });

				try {
					await simpleGit({
						timeout: { block: envs.GIT_CLONE_TIMEOUT_MS },
					}).clone(cloneUrl, session.dir);

					const g = git(session);
					session.defaultBranch = await currentBranch(session);
					await g.addConfig("user.name", envs.GIT_AUTHOR_NAME);
					await g.addConfig("user.email", envs.GIT_AUTHOR_EMAIL);
				} catch (err) {
					await destroySession(session.code, "closed");
					throw err;
				}

				logger.info(`[git] clonado ${url} (${protocol}) → ${session.code}`);
				await emit("git.repo_cloned", {
					code: session.code,
					url: session.url,
					protocol: session.protocol,
					defaultBranch: session.defaultBranch,
					expiresAt: new Date(session.expiresAt).toISOString(),
				});

				return {
					code: session.code,
					defaultBranch: session.defaultBranch,
					protocol: session.protocol,
					expiresAt: new Date(session.expiresAt).toISOString(),
					ttlMs: envs.GIT_REPO_TTL_MS,
				};
			}),
	},
	{
		name: "git_list_sessions",
		description:
			"Lista los repositorios activos en el MCP con su TTL restante.",
		inputSchema: {},
		handler: async () => run(async () => listSessions()),
	},
	{
		name: "git_session_info",
		description: "Devuelve el detalle de una sesión de repo por su código.",
		inputSchema: {
			code: z.string().describe("Código de 4 dígitos de la sesión"),
		},
		handler: async ({ code }: { code: string }) =>
			run(async () => {
				const s = getSession(code);
				return {
					code: s.code,
					url: s.url,
					protocol: s.protocol,
					defaultBranch: s.defaultBranch,
					dir: s.dir,
					createdAt: new Date(s.createdAt).toISOString(),
					expiresAt: new Date(s.expiresAt).toISOString(),
					ttlRemainingMs: Math.max(0, s.expiresAt - Date.now()),
				};
			}),
	},
	{
		name: "git_close",
		description:
			"Cierra una sesión anticipadamente: borra el repo del disco y libera el código.",
		inputSchema: {
			code: z.string().describe("Código de 4 dígitos de la sesión"),
		},
		handler: async ({ code }: { code: string }) =>
			run(async () => {
				getSession(code); // valida que exista
				await destroySession(code, "closed");
				return { code, closed: true };
			}),
	},

	// ── Árbol y archivos ────────────────────────────────────────────────────
	{
		name: "git_read_tree",
		description:
			"Devuelve el árbol de carpetas y archivos del repo (excluye .git).",
		inputSchema: {
			code: z.string().describe("Código de 4 dígitos de la sesión"),
			path: z
				.string()
				.optional()
				.describe("Ruta relativa de partida (default: raíz del repo)"),
			depth: z
				.number()
				.optional()
				.describe("Profundidad máxima de recursión (default: completa)"),
		},
		handler: async ({
			code,
			path,
			depth,
		}: { code: string; path?: string; depth?: number }) =>
			run(async () => {
				const session = getSession(code);
				const abs = resolveSafePath(session, path ?? ".");
				const tree = await buildTree(abs, depth ?? Number.MAX_SAFE_INTEGER);
				return { path: path ?? ".", tree };
			}),
	},
	{
		name: "git_read_file",
		description: "Lee el contenido de un archivo del repo.",
		inputSchema: {
			code: z.string().describe("Código de 4 dígitos de la sesión"),
			path: z.string().describe("Ruta relativa del archivo dentro del repo"),
		},
		handler: async ({ code, path }: { code: string; path: string }) =>
			run(async () => {
				const session = getSession(code);
				const abs = resolveSafePath(session, path);
				const content = await readFile(abs, "utf8");
				return { path, content };
			}),
	},
	{
		name: "git_write_file",
		description:
			"Crea un archivo nuevo o sobrescribe uno existente con el contenido dado.",
		inputSchema: {
			code: z.string().describe("Código de 4 dígitos de la sesión"),
			path: z.string().describe("Ruta relativa del archivo dentro del repo"),
			content: z.string().describe("Contenido completo a escribir"),
		},
		handler: async ({
			code,
			path,
			content,
		}: { code: string; path: string; content: string }) =>
			run(async () => {
				const session = getSession(code);
				const abs = resolveSafePath(session, path);
				const created = !existsSync(abs);
				await mkdir(dirname(abs), { recursive: true });
				await writeFile(abs, content, "utf8");
				await emit("git.file_written", { code, path, created });
				return { path, created, bytes: Buffer.byteLength(content) };
			}),
	},
	{
		name: "git_delete_file",
		description: "Elimina un archivo del repo.",
		inputSchema: {
			code: z.string().describe("Código de 4 dígitos de la sesión"),
			path: z.string().describe("Ruta relativa del archivo a eliminar"),
		},
		handler: async ({ code, path }: { code: string; path: string }) =>
			run(async () => {
				const session = getSession(code);
				const abs = resolveSafePath(session, path);
				await rm(abs, { recursive: true, force: true });
				await emit("git.file_deleted", { code, path });
				return { path, deleted: true };
			}),
	},

	// ── Ramas ─────────────────────────────────────────────────────────────────
	{
		name: "git_list_branches",
		description:
			"Lista todas las ramas locales y remotas, e indica la rama actual.",
		inputSchema: {
			code: z.string().describe("Código de 4 dígitos de la sesión"),
		},
		handler: async ({ code }: { code: string }) =>
			run(async () => {
				const session = getSession(code);
				const summary = await git(session).branch(["-a"]);
				const local: string[] = [];
				const remote: string[] = [];
				for (const name of summary.all) {
					if (name.startsWith("remotes/")) remote.push(name.replace(/^remotes\//, ""));
					else local.push(name);
				}
				return { current: summary.current, local, remote };
			}),
	},
	{
		name: "git_current_branch",
		description: "Devuelve la rama actual del repo.",
		inputSchema: {
			code: z.string().describe("Código de 4 dígitos de la sesión"),
		},
		handler: async ({ code }: { code: string }) =>
			run(async () => {
				const session = getSession(code);
				return { current: await currentBranch(session) };
			}),
	},
	{
		name: "git_checkout",
		description:
			"Cambia a la rama indicada. Con create=true crea la rama y cambia a ella.",
		inputSchema: {
			code: z.string().describe("Código de 4 dígitos de la sesión"),
			branch: z.string().describe("Nombre de la rama destino"),
			create: z
				.boolean()
				.optional()
				.describe("Si true, crea la rama localmente antes de cambiar"),
		},
		handler: async ({
			code,
			branch,
			create,
		}: { code: string; branch: string; create?: boolean }) =>
			run(async () => {
				const session = getSession(code);
				const g = git(session);
				if (create) await g.checkoutLocalBranch(branch);
				else await g.checkout(branch);
				await emit("git.branch_switched", {
					code,
					branch,
					created: !!create,
				});
				return { current: await currentBranch(session), created: !!create };
			}),
	},
	{
		name: "git_create_branch",
		description:
			"Crea una nueva rama local. Con push=true la publica al remoto con upstream.",
		inputSchema: {
			code: z.string().describe("Código de 4 dígitos de la sesión"),
			name: z.string().describe("Nombre de la nueva rama"),
			push: z
				.boolean()
				.optional()
				.describe("Si true, publica la rama al remoto (origin) con -u"),
		},
		handler: async ({
			code,
			name,
			push,
		}: { code: string; name: string; push?: boolean }) =>
			run(async () => {
				const session = getSession(code);
				const g = git(session);
				await g.checkoutLocalBranch(name);
				if (push) await g.push(["-u", "origin", name]);
				await emit("git.branch_created", { code, name, pushed: !!push });
				return { name, pushed: !!push };
			}),
	},

	// ── Estado y sincronización ───────────────────────────────────────────────
	{
		name: "git_status",
		description: "Devuelve el estado del working tree (archivos modificados, etc).",
		inputSchema: {
			code: z.string().describe("Código de 4 dígitos de la sesión"),
		},
		handler: async ({ code }: { code: string }) =>
			run(async () => {
				const session = getSession(code);
				return await git(session).status();
			}),
	},
	{
		name: "git_add",
		description: "Agrega archivos al stage (default: todos los cambios).",
		inputSchema: {
			code: z.string().describe("Código de 4 dígitos de la sesión"),
			files: z
				.array(z.string())
				.optional()
				.describe("Rutas a agregar (default: todo, equivalente a 'git add .')"),
		},
		handler: async ({ code, files }: { code: string; files?: string[] }) =>
			run(async () => {
				const session = getSession(code);
				await git(session).add(files && files.length ? files : ".");
				return { staged: files && files.length ? files : ["."] };
			}),
	},
	{
		name: "git_commit",
		description:
			"Crea un commit con los cambios en stage. Con addAll=true agrega todo antes.",
		inputSchema: {
			code: z.string().describe("Código de 4 dígitos de la sesión"),
			message: z.string().describe("Mensaje del commit"),
			addAll: z
				.boolean()
				.optional()
				.describe("Si true, ejecuta 'git add .' antes del commit"),
			authorName: z
				.string()
				.optional()
				.describe("Nombre del autor (override del default)"),
			authorEmail: z
				.string()
				.optional()
				.describe("Email del autor (override del default)"),
		},
		handler: async ({
			code,
			message,
			addAll,
			authorName,
			authorEmail,
		}: {
			code: string;
			message: string;
			addAll?: boolean;
			authorName?: string;
			authorEmail?: string;
		}) =>
			run(async () => {
				const session = getSession(code);
				const g = git(session);
				if (addAll) await g.add(".");
				const options: Record<string, string> = {};
				if (authorName && authorEmail) {
					options["--author"] = `${authorName} <${authorEmail}>`;
				}
				const result = await g.commit(message, undefined, options);
				await emit("git.committed", {
					code,
					message,
					hash: result.commit,
				});
				return { hash: result.commit, summary: result.summary };
			}),
	},
	{
		name: "git_push",
		description:
			"Hace push de la rama actual al remoto usando la auth del clone.",
		inputSchema: {
			code: z.string().describe("Código de 4 dígitos de la sesión"),
			setUpstream: z
				.boolean()
				.optional()
				.describe("Si true, establece upstream (-u origin <rama>)"),
		},
		handler: async ({
			code,
			setUpstream,
		}: { code: string; setUpstream?: boolean }) =>
			run(async () => {
				const session = getSession(code);
				const g = git(session);
				const branch = await currentBranch(session);
				if (setUpstream) await g.push(["-u", "origin", branch]);
				else await g.push();
				await emit("git.pushed", { code, branch });
				return { branch, pushed: true };
			}),
	},
	{
		name: "git_pull",
		description: "Trae e integra cambios del remoto en la rama actual.",
		inputSchema: {
			code: z.string().describe("Código de 4 dígitos de la sesión"),
		},
		handler: async ({ code }: { code: string }) =>
			run(async () => {
				const session = getSession(code);
				const result = await git(session).pull();
				await emit("git.pulled", {
					code,
					summary: JSON.stringify(result.summary),
				});
				return result;
			}),
	},
	{
		name: "git_fetch",
		description: "Descarga refs y objetos del remoto sin integrarlos.",
		inputSchema: {
			code: z.string().describe("Código de 4 dígitos de la sesión"),
		},
		handler: async ({ code }: { code: string }) =>
			run(async () => {
				const session = getSession(code);
				return await git(session).fetch();
			}),
	},
	{
		name: "git_log",
		description: "Devuelve el historial de commits (más reciente primero).",
		inputSchema: {
			code: z.string().describe("Código de 4 dígitos de la sesión"),
			limit: z
				.number()
				.optional()
				.describe("Cantidad máxima de commits (default: 20)"),
		},
		handler: async ({ code, limit }: { code: string; limit?: number }) =>
			run(async () => {
				const session = getSession(code);
				const log = await git(session).log({ maxCount: limit ?? 20 });
				return log.all.map((c) => ({
					hash: c.hash,
					date: c.date,
					message: c.message,
					author: `${c.author_name} <${c.author_email}>`,
				}));
			}),
	},
	{
		name: "git_diff",
		description:
			"Devuelve el diff del working tree. Con staged=true muestra lo que está en stage.",
		inputSchema: {
			code: z.string().describe("Código de 4 dígitos de la sesión"),
			staged: z
				.boolean()
				.optional()
				.describe("Si true, muestra el diff de los cambios en stage"),
		},
		handler: async ({ code, staged }: { code: string; staged?: boolean }) =>
			run(async () => {
				const session = getSession(code);
				const diff = await git(session).diff(staged ? ["--staged"] : []);
				return { staged: !!staged, diff };
			}),
	},
];
