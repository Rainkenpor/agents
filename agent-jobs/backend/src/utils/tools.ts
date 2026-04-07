/**
 * tools.ts — Definiciones de herramientas y ejecutor para InternalAgentService
 *
 * Expone cuatro herramientas orientadas a tests de Vitest dentro de un repo
 * identificado por su ID de base de datos:
 *   • list_tests   — lista los archivos de test del repo
 *   • read_test    — lee el contenido de un archivo de test
 *   • write_test   — crea/sobreescribe un archivo de test (prefijado con el Jira)
 *   • run_tests    — ejecuta Vitest en el repo y devuelve la salida
 */
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { repos } from "../db/schema.js";
import { agentLogger } from "../services/logger.service.js";

const execAsync = promisify(exec);

// ── Minimal interface copies (mirrors agent.ts — avoids circular imports) ────

interface ToolCallbacks {
	onToolCall: (toolName: string, args: unknown) => Promise<void>;
	draftCallbacks: {
		onUpdate: (draft: string) => Promise<void>;
		onRead: () => Promise<string | null>;
	};
	credentialCallbacks: {
		getCredentials: (mcpServerId: string) => Promise<Record<string, string>>;
		setCredential: (
			mcpServerId: string,
			key: string,
			value: string,
		) => Promise<void>;
		deleteCredential: (mcpServerId: string, key: string) => Promise<void>;
		getListCredentials: () => Promise<
			{
				id: string;
				name: string;
				displayName: string;
				credentialFields: { key: string; description: string }[];
			}[]
		>;
	};
}

interface IAgentServiceExecuteMin {
	toolsCallbacks?: ToolCallbacks;
}

interface Tool {
	type: "function";
	function: {
		name: string;
		description: string;
		parameters: Record<string, unknown>;
	};
}

// ── Security helper ───────────────────────────────────────────────────────────

/**
 * Resolves `filePath` relative to `basePath` and asserts the result stays
 * within `basePath` to prevent path-traversal attacks.
 * Returns the resolved absolute path.
 */
function assertWithinRepo(basePath: string, filePath: string): string {
	const base = path.resolve(basePath);
	const resolved = path.resolve(basePath, filePath);
	if (resolved !== base && !resolved.startsWith(base + path.sep)) {
		throw new Error(
			`Path traversal attempt: "${filePath}" resolves outside the repository directory`,
		);
	}
	return resolved;
}

// ── DB helper ─────────────────────────────────────────────────────────────────

async function getRepoLocalPath(repoId: number): Promise<string> {
	const [repo] = await db
		.select({ localPath: repos.localPath })
		.from(repos)
		.where(eq(repos.id, repoId));
	if (!repo) throw new Error(`Repository with id=${repoId} not found`);
	return repo.localPath;
}

// ── Test-file discovery ───────────────────────────────────────────────────────

const SKIP_DIRS = new Set([
	".git",
	"node_modules",
	"dist",
	"build",
	".turbo",
	"coverage",
]);
const TEST_EXTENSIONS = [
	".test.ts",
	".spec.ts",
	".test.js",
	".spec.js",
	".test.mts",
	".spec.mts",
];

function collectTestFiles(
	dir: string,
	results: string[],
	maxResults = 500,
): void {
	if (results.length >= maxResults || !fs.existsSync(dir)) return;

	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return;
	}

	for (const entry of entries) {
		if (results.length >= maxResults) break;
		if (SKIP_DIRS.has(entry.name)) continue;

		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			collectTestFiles(fullPath, results, maxResults);
		} else if (
			entry.isFile() &&
			TEST_EXTENSIONS.some((ext) => entry.name.endsWith(ext))
		) {
			results.push(fullPath);
		}
	}
}

// ── Tool definitions ──────────────────────────────────────────────────────────

const ALL_TOOLS: Tool[] = [
	{
		type: "function",
		function: {
			name: "list_tests",
			description:
				"Lists all Vitest test files (*.test.ts, *.spec.ts, etc.) found inside a repository. The repository is identified by its database ID. Returns the relative paths of the discovered test files.",
			parameters: {
				type: "object",
				properties: {
					repo_id: {
						type: "number",
						description: "Database ID of the repository to inspect.",
					},
				},
				required: ["repo_id"],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "read_test",
			description:
				"Reads the full content of a single test file inside a repository. Use `list_tests` first to discover available test file paths.",
			parameters: {
				type: "object",
				properties: {
					repo_id: {
						type: "number",
						description: "Database ID of the repository.",
					},
					file_path: {
						type: "string",
						description:
							"Path to the test file relative to the repository root (e.g. 'test/user.test.ts').",
					},
				},
				required: ["repo_id", "file_path"],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "write_test",
			description:
				"Creates or overwrites a Vitest test file inside a repository. The file is stored at `{test_dir}/{jira}/{file_name}.test.ts`, grouping all tests for a Jira ticket under a dedicated subfolder.",
			parameters: {
				type: "object",
				properties: {
					repo_id: {
						type: "number",
						description: "Database ID of the repository.",
					},
					jira: {
						type: "string",
						description:
							"Jira ticket key used as a prefix in the file name (e.g. 'PROJ-123').",
					},
					file_name: {
						type: "string",
						description:
							"Base name for the test file without extension (e.g. 'user-login'). The final file will be stored at `{test_dir}/{jira}/{file_name}.test.ts`.",
					},
					content: {
						type: "string",
						description:
							"Full TypeScript test file content. Must be compatible with Vitest.",
					},
					test_dir: {
						type: "string",
						description:
							"Subdirectory inside the repo where the file will be written. Defaults to 'test'.",
					},
				},
				required: ["repo_id", "jira", "file_name", "content"],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "run_tests",
			description:
				"Executes Vitest inside a repository and returns the full test output (stdout + stderr). Can optionally target a single test file. Test failures (non-zero exit) are surfaced as output rather than errors so the agent can read the results.",
			parameters: {
				type: "object",
				properties: {
					repo_id: {
						type: "number",
						description: "Database ID of the repository.",
					},
					test_file: {
						type: "string",
						description:
							"Optional relative path to a single test file to run (e.g. 'test/PROJ-123-user-login.test.ts'). Omit to run the full test suite.",
					},
					timeout_ms: {
						type: "number",
						description:
							"Maximum execution time in milliseconds. Defaults to 60000 (60 s).",
					},
				},
				required: ["repo_id"],
			},
		},
	},
];

// ── Public: build filtered tool list ─────────────────────────────────────────

export function buildToolDefinitions(
	allowedTools?: Set<string>,
	_toolsCallbacks?: ToolCallbacks,
): Tool[] {
	if (allowedTools && allowedTools.size > 0) {
		return ALL_TOOLS.filter((t) => allowedTools.has(t.function.name));
	}
	return ALL_TOOLS;
}

// ── Public: execute a single tool call ───────────────────────────────────────

export async function executeToolCall(
	_newAgentService: () => unknown,
	toolName: string,
	args: Record<string, unknown>,
	originalParams: IAgentServiceExecuteMin,
): Promise<string> {
	try {
		await originalParams.toolsCallbacks?.onToolCall(toolName, args);

		switch (toolName) {
			// ── list_tests ──────────────────────────────────────────────────────
			case "list_tests": {
				const repoPath = await getRepoLocalPath(Number(args.repo_id));
				const files: string[] = [];
				collectTestFiles(repoPath, files);
				if (files.length === 0)
					return "No test files found in this repository.";
				const relative = files
					.map((f) => path.relative(repoPath, f).replace(/\\/g, "/"))
					.sort();
				return `Found ${relative.length} test file(s):\n${relative.join("\n")}`;
			}

			// ── read_test ───────────────────────────────────────────────────────
			case "read_test": {
				const repoPath = await getRepoLocalPath(Number(args.repo_id));
				const filePath = assertWithinRepo(repoPath, String(args.file_path));
				if (!fs.existsSync(filePath))
					return `File not found: ${args.file_path}`;
				const content = await fsPromises.readFile(filePath, "utf-8");
				return content;
			}

			// ── write_test ──────────────────────────────────────────────────────
			case "write_test": {
				const repoPath = await getRepoLocalPath(Number(args.repo_id));
				const testDir = String(args.test_dir ?? "test");
				// Sanitise jira and file_name — only allow safe characters
				const jira = String(args.jira).replace(/[^a-zA-Z0-9_-]/g, "_");
				const baseName = String(args.file_name)
					.replace(/\.test\.[mc]?[tj]s$/, "")
					.replace(/\.spec\.[mc]?[tj]s$/, "")
					.replace(/[^a-zA-Z0-9_.-]/g, "_");
				// Store tests grouped by Jira: test/{jira}/{file_name}.test.ts
				const relativePath = path.join(testDir, jira, `${baseName}.test.ts`);
				const fullPath = assertWithinRepo(repoPath, relativePath);
				await fsPromises.mkdir(path.dirname(fullPath), { recursive: true });
				await fsPromises.writeFile(fullPath, String(args.content), "utf-8");
				agentLogger.info(`[tools] write_test → ${fullPath}`);
				return `Test file written: ${relativePath.replace(/\\/g, "/")}`;
			}

			// ── run_tests ───────────────────────────────────────────────────────
			case "run_tests": {
				const repoPath = await getRepoLocalPath(Number(args.repo_id));
				const timeoutMs = Number(args.timeout_ms ?? 60_000);

				// Build safe argument list
				const vitestArgs: string[] = ["run", "--reporter=verbose"];
				if (args.test_file) {
					// Validate path stays inside repo, then make relative for vitest
					const absTestFile = assertWithinRepo(
						repoPath,
						String(args.test_file),
					);
					const relTestFile = path
						.relative(repoPath, absTestFile)
						.replace(/\\/g, "/");
					vitestArgs.push(relTestFile);
				}

				agentLogger.info(
					`[tools] run_tests cwd=${repoPath} vitest ${vitestArgs.join(" ")}`,
				);

				// Use npx to resolve vitest from the repo's local node_modules.
				// execAsync throws on non-zero exit (test failures) — catch it to
				// return the output rather than a generic error message.
				const vitestCmd = `npx vitest ${vitestArgs.join(" ")}`;
				try {
					const { stdout, stderr } = await execAsync(vitestCmd, {
						cwd: repoPath,
						timeout: timeoutMs,
						encoding: "utf-8",
					});
					const output = [stdout, stderr].filter(Boolean).join("\n").trim();
					return output || "Tests completed with no output.";
				} catch (execErr: unknown) {
					// Non-zero exit — test failures produce output we still want to show
					const err = execErr as {
						stdout?: string;
						stderr?: string;
						message?: string;
					};
					const output = [err.stdout, err.stderr]
						.filter(Boolean)
						.join("\n")
						.trim();
					if (output) return output;
					throw execErr; // re-throw if there is truly no output (e.g. binary not found)
				}
			}

			default:
				return `Unknown tool: "${toolName}". Available tools: ${ALL_TOOLS.map((t) => t.function.name).join(", ")}`;
		}
	} catch (err) {
		return `Error in tool '${toolName}': ${err instanceof Error ? err.message : String(err)}`;
	}
}
