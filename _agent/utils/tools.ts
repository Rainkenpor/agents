import nodePath from "node:path";
import fs from "node:fs";

export interface IAgentServiceExecute {
	dirPath: string;
	systemPrompt: string;
	allowedTools: Set<string>;
	query: string;
}

export interface IAgentService {
	// biome-ignore lint/suspicious/noExplicitAny: return type varies per implementation
	executeAgent(params: IAgentServiceExecute): Promise<any>;
}

interface Tool {
	type: "function";
	function: {
		name: string;
		description: string;
		parameters: Record<string, unknown>;
	};
}

/** Resolve a path — absolute paths pass through, relative ones are joined to basePath */
function resolvePath(basePath: string, filePath: string): string {
	if (nodePath.isAbsolute(filePath)) return filePath;
	return nodePath.join(basePath, filePath);
}

/** Minimalistic glob: resolves files matching a simple pattern with wildcards */
function walkFiles(
	dir: string,
	pattern: string,
	results: string[],
	maxResults: number,
	skipDirs: string[] = ["node_modules", ".git", "dist", "build"],
): void {
	if (!fs.existsSync(dir) || results.length >= maxResults) return;

	const parts = pattern.split("/");
	const head = parts[0];
	const tail = parts.slice(1).join("/");

	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return;
	}

	for (const entry of entries) {
		if (results.length >= maxResults) break;
		if (entry.isDirectory() && skipDirs.includes(entry.name)) continue;

		const fullPath = nodePath.join(dir, entry.name);

		if (head === "**") {
			// Descend into subdirectory
			if (entry.isDirectory()) {
				walkFiles(fullPath, pattern, results, maxResults, skipDirs);
			}
			// Also try matching the rest of the pattern at current level
			if (tail) {
				walkFiles(dir, tail, results, maxResults, skipDirs);
			} else if (entry.isFile()) {
				results.push(fullPath);
			}
		} else {
			const regex = new RegExp(
				`^${head
					.replace(/[.+^${}()|[\]\\]/g, "\\$&")
					.replace(/\*/g, ".*")
					.replace(/\?/g, ".")}$`,
			);
			if (regex.test(entry.name)) {
				if (tail) {
					if (entry.isDirectory()) {
						walkFiles(fullPath, tail, results, maxResults, skipDirs);
					}
				} else if (entry.isFile()) {
					results.push(fullPath);
				}
			}
		}
	}
}

/** Search for text/regex in files recursively */
function grepDirectory(
	dir: string,
	pattern: string,
	includePattern: string | undefined,
	isRegex: boolean,
	results: string[],
	maxResults: number,
	skipDirs = ["node_modules", ".git", "dist", "build", ".opencode"],
): void {
	if (!fs.existsSync(dir) || results.length >= maxResults) return;

	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return;
	}

	const regex = isRegex
		? new RegExp(pattern, "i")
		: new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");

	const includeRegex = includePattern
		? new RegExp(
				`^${includePattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`,
				"i",
			)
		: null;

	for (const entry of entries) {
		if (results.length >= maxResults) break;
		const fullPath = nodePath.join(dir, entry.name);

		if (entry.isDirectory()) {
			if (skipDirs.includes(entry.name)) continue;
			grepDirectory(
				fullPath,
				pattern,
				includePattern,
				isRegex,
				results,
				maxResults,
				skipDirs,
			);
		} else if (entry.isFile()) {
			if (includeRegex && !includeRegex.test(entry.name)) continue;
			try {
				const content = fs.readFileSync(fullPath, "utf-8");
				const lines = content.split("\n");
				for (let i = 0; i < lines.length; i++) {
					if (results.length >= maxResults) break;
					if (regex.test(lines[i])) {
						results.push(`${fullPath}:${i + 1}: ${lines[i].trimEnd()}`);
					}
				}
			} catch {
				// Skip binary or unreadable files
			}
		}
	}
}

/** Tool definitions for function-calling */
export function buildToolDefinitions(allowedTools?: Set<string>): Tool[] {
	const baseTools: Tool[] = [
		{
			type: "function",
			function: {
				name: "read_file",
				description:
					"Read the contents of a file in the project directory. Supports pagination (200 lines per page) and line-range queries. Returns the total number of pages. Use 'page' for paginated access or 'start_line'/'end_line' for a specific range.",
				parameters: {
					type: "object",
					properties: {
						path: {
							type: "string",
							description:
								"Path to the file (relative to project dir or absolute).",
						},
						page: {
							type: "number",
							description:
								"Page number to retrieve (1-based). Each page contains up to 200 lines. Omit to get page 1.",
						},
						start_line: {
							type: "number",
							description:
								"First line to retrieve (1-based, inclusive). Use together with end_line for a range query.",
						},
						end_line: {
							type: "number",
							description:
								"Last line to retrieve (1-based, inclusive). Use together with start_line for a range query.",
						},
					},
					required: ["path"],
				},
			},
		},
		{
			type: "function",
			function: {
				name: "list_directory",
				description: "List files and sub-directories in a directory.",
				parameters: {
					type: "object",
					properties: {
						path: {
							type: "string",
							description:
								"Directory path (relative to project dir or absolute). Defaults to project root.",
						},
					},
					required: [],
				},
			},
		},
		{
			type: "function",
			function: {
				name: "write_file",
				description: "Write or overwrite a file with the given content.",
				parameters: {
					type: "object",
					properties: {
						path: {
							type: "string",
							description: "File path (relative to project dir or absolute).",
						},
						content: {
							type: "string",
							description: "Content to write.",
						},
					},
					required: ["path", "content"],
				},
			},
		},
		{
			type: "function",
			function: {
				name: "search_files",
				description:
					"Find files matching a glob pattern (e.g. **/*.ts, src/**/*.sql).",
				parameters: {
					type: "object",
					properties: {
						pattern: {
							type: "string",
							description: "Glob pattern.",
						},
						base_path: {
							type: "string",
							description:
								"Base directory to search (optional, defaults to project root).",
						},
					},
					required: ["pattern"],
				},
			},
		},
		{
			type: "function",
			function: {
				name: "grep_search",
				description:
					"Search for a text pattern or regex across files in the project.",
				parameters: {
					type: "object",
					properties: {
						pattern: {
							type: "string",
							description: "Text or regex to search for.",
						},
						path: {
							type: "string",
							description:
								"Directory or file to search in (optional, defaults to project root).",
						},
						include: {
							type: "string",
							description: "File name pattern to include (e.g. *.ts, *.sql).",
						},
						is_regex: {
							type: "boolean",
							description: "Whether pattern is a regex (default false).",
						},
					},
					required: ["pattern"],
				},
			},
		},
		{
			type: "function",
			function: {
				name: "spawn_subagent",
				description:
					"Spawn a specialised sub-agent to complete a focused documentation task. The sub-agent runs in the same project directory with its own instructions and tool access.",
				parameters: {
					type: "object",
					properties: {
						query: {
							type: "string",
							description: "Detailed task for the sub-agent.",
						},
					},
					required: ["agent_type", "query"],
				},
			},
		},
	];

	if (allowedTools && allowedTools.size > 0) {
		const filterBaseTools = baseTools.filter((t) =>
			allowedTools.has(t.function.name),
		);

		return [...filterBaseTools];
	}

	return [...baseTools];
}

/** Execute a single tool call and return a string result */
export async function executeToolCall(
	newAgentService: () => any,
	toolName: string,
	args: Record<string, unknown>,
	basePath: string,
	originalParams: IAgentServiceExecute,
): Promise<string> {
	try {
		switch (toolName) {
			case "read_file": {
				const target = resolvePath(basePath, args.path as string);
				if (!fs.existsSync(target)) return `Error: File not found: ${target}`;
				const content = fs.readFileSync(target, "utf-8");
				const lines = content.split("\n");
				const totalLines = lines.length;
				const PAGE_SIZE = 200;
				const totalPages = Math.ceil(totalLines / PAGE_SIZE);

				// Line-range query takes priority over pagination
				if (args.start_line != null || args.end_line != null) {
					const start = Math.max(1, (args.start_line as number) ?? 1);
					const end = Math.min(
						totalLines,
						(args.end_line as number) ?? totalLines,
					);
					if (start > totalLines)
						return `Error: start_line (${start}) exceeds total lines (${totalLines})`;
					const slice = lines.slice(start - 1, end);
					const numbered = slice.map((l, i) => `${start + i}: ${l}`).join("\n");
					return `File: ${args.path}\nLines ${start}-${end} of ${totalLines} (total pages: ${totalPages})\n\n${numbered}`;
				}

				const page = Math.max(
					1,
					Math.min(totalPages || 1, (args.page as number) ?? 1),
				);
				const startIdx = (page - 1) * PAGE_SIZE;
				const endIdx = Math.min(startIdx + PAGE_SIZE, totalLines);
				const slice = lines.slice(startIdx, endIdx);
				const numbered = slice
					.map((l, i) => `${startIdx + i + 1}: ${l}`)
					.join("\n");
				return `File: ${args.path}\nPage ${page} of ${totalPages} (lines ${startIdx + 1}-${endIdx} of ${totalLines})\n\n${numbered}`;
			}

			case "list_directory": {
				const target = resolvePath(basePath, (args.path as string) || ".");
				if (!fs.existsSync(target))
					return `Error: Directory not found: ${target}`;
				const entries = fs.readdirSync(target, { withFileTypes: true });
				return entries
					.map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
					.join("\n");
			}

			case "write_file": {
				const target = resolvePath(basePath, args.path as string);
				fs.mkdirSync(nodePath.dirname(target), { recursive: true });
				fs.writeFileSync(target, args.content as string, "utf-8");
				return `Written: ${target}`;
			}

			case "search_files": {
				const searchBase = args.base_path
					? resolvePath(basePath, args.base_path as string)
					: basePath;
				const found: string[] = [];
				walkFiles(searchBase, args.pattern as string, found, 200);
				if (found.length === 0) return "No files found matching the pattern";
				return found.map((f) => nodePath.relative(basePath, f)).join("\n");
			}

			case "grep_search": {
				const searchDir = args.path
					? resolvePath(basePath, args.path as string)
					: basePath;
				const matches: string[] = [];
				grepDirectory(
					searchDir,
					args.pattern as string,
					args.include as string | undefined,
					(args.is_regex as boolean) ?? false,
					matches,
					100,
				);
				if (matches.length === 0) return "No matches found";
				return matches
					.map((m) => m.replace(basePath + nodePath.sep, ""))
					.join("\n");
			}

			case "spawn_subagent": {
				const subService = newAgentService();
				const subResult = await subService.executeAgent({
					...originalParams,
					query: args.query as string,
				});
				return `Sub-agent: completed.\n${typeof subResult === "string" ? subResult : ""}`;
			}

			default:
				return `Error: Unsupported tool: ${toolName}`;
		}
	} catch (err) {
		return `Error in tool '${toolName}': ${err instanceof Error ? err.message : String(err)} ${Object.entries(
			args,
		)
			.map(([k, v]) => `\n  ${k}: ${JSON.stringify(v)}`)
			.join("")}`;
	}
}
