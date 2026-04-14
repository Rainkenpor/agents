/**
 * test-generator.tool.ts
 *
 * Receives a repository + branch payload, clones the repo, checks out the branch,
 * uses InternalAgentService to analyse the code and write vitest unit tests into
 * test/<sanitised-branch>/, validates them by running vitest, then commits and
 * pushes the result back to the same branch.
 */

import z from "zod";
import { ok } from "../types";
import type { ToolDefinition } from "../types";
import { execSync, spawnSync } from "node:child_process";
import nodePath from "node:path";
import fs from "node:fs";
import { InternalAgentService } from "../../_agent/internal.service.ts";
import { logger } from "../util/logger";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Strip the "origin/" prefix used by Azure DevOps webhooks */
function localBranchName(name: string): string {
	return name.replace(/^origin\//, "");
}

/** Filesystem-safe directory name: strip "origin/" then replace "/" with "-" */
function sanitiseBranch(name: string): string {
	return name.replace(/^origin\//, "").replace(/\//g, "-");
}

/** Run a command, throw with readable message on failure */
function sh(cmd: string, cwd?: string): string {
	try {
		return execSync(cmd, {
			cwd,
			encoding: "utf-8",
			stdio: "pipe",
		}).trim();
	} catch (err) {
		const e = err as { message: string; stderr?: string; stdout?: string };
		throw new Error(
			`Command failed: ${cmd}\n${e.stderr ?? ""}\n${e.stdout ?? ""}`.trim(),
		);
	}
}

// ── Git ───────────────────────────────────────────────────────────────────────

function cloneOrUpdate(
	repoUrl: string,
	repoName: string,
	branch: string,
): string {
	const dataDir = process.env.DATA_DIR ?? nodePath.join(process.cwd(), "data");
	const agentDir = nodePath.join(dataDir, "agent");
	const cloneDir = nodePath.join(agentDir, repoName);

	if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

	if (fs.existsSync(cloneDir)) {
		logger.info(`[test-generator] Repo already cloned — fetching: ${cloneDir}`);
		sh("git fetch --all", cloneDir);
		// Checkout might fail if there are local changes — reset first
		sh("git reset --hard HEAD", cloneDir);
		sh(`git checkout ${branch}`, cloneDir);
		try {
			sh(`git pull origin ${branch}`, cloneDir);
		} catch {
			// Remote branch might not exist yet; ignore pull error
		}
	} else {
		logger.info(`[test-generator] Cloning ${repoUrl} → ${cloneDir}`);
		sh(`git clone "${repoUrl}" "${cloneDir}"`);
		sh(`git checkout ${branch}`, cloneDir);
	}

	return cloneDir;
}

// ── Package manager / Vitest ──────────────────────────────────────────────────

function detectPm(repoPath: string): "bun" | "pnpm" | "yarn" | "npm" {
	if (
		fs.existsSync(nodePath.join(repoPath, "bun.lock")) ||
		fs.existsSync(nodePath.join(repoPath, "bun.lockb"))
	)
		return "bun";
	if (fs.existsSync(nodePath.join(repoPath, "pnpm-lock.yaml"))) return "pnpm";
	if (fs.existsSync(nodePath.join(repoPath, "yarn.lock"))) return "yarn";
	return "npm";
}

function ensureDeps(repoPath: string, pm: string): void {
	// Install node_modules if missing
	if (!fs.existsSync(nodePath.join(repoPath, "node_modules"))) {
		logger.info("[test-generator] Installing dependencies…");
		sh(`${pm} install`, repoPath);
	}

	// Ensure vitest is present
	const pkgRaw = fs.readFileSync(
		nodePath.join(repoPath, "package.json"),
		"utf-8",
	);
	const pkg = JSON.parse(pkgRaw) as {
		dependencies?: Record<string, string>;
		devDependencies?: Record<string, string>;
	};
	const hasVitest =
		pkg.devDependencies?.vitest != null || pkg.dependencies?.vitest != null;
	if (!hasVitest) {
		logger.info("[test-generator] Adding vitest as devDependency…");
		const addCmd =
			pm === "npm" ? "npm install -D vitest" : `${pm} add -D vitest`;
		sh(addCmd, repoPath);
	}
}

function runVitest(
	repoPath: string,
	testDirRelative: string,
): { success: boolean; output: string } {
	// Try bun x vitest first, fall back to npx vitest
	for (const runner of [
		["bun", "x", "vitest", "run", testDirRelative, "--reporter=verbose"],
		["npx", "vitest", "run", testDirRelative, "--reporter=verbose"],
	]) {
		const res = spawnSync(runner[0], runner.slice(1), {
			cwd: repoPath,
			encoding: "utf-8",
			timeout: 120_000,
			shell: true,
		});
		if (res.error) continue; // binary not found — try next
		return {
			success: (res.status ?? 1) === 0,
			output: (res.stdout ?? "") + (res.stderr ?? ""),
		};
	}
	return { success: false, output: "Could not locate vitest runner" };
}

// ── Agent calls ───────────────────────────────────────────────────────────────

async function generateTestsWithAgent(
	repoPath: string,
	testDirRelative: string,
	branch: BranchPayload,
): Promise<void> {
	const agent = new InternalAgentService();

	// ── write_file callback: run vitest immediately after each test file is written ──
	agent.registerToolsCallback(
		"write_file",
		async (args: Record<string, unknown>) => {
			const filePath = args.path as string;

			// Only validate test files
			if (!filePath.includes(".test.") && !filePath.includes(".spec.")) {
				return;
			}

			logger.info(`[test-generator] Auto-running vitest on: ${filePath}`);

			// Resolve to an absolute path so vitest can locate the file
			const absolutePath = nodePath.isAbsolute(filePath)
				? filePath
				: nodePath.join(repoPath, filePath);

			const relativeToRepo = nodePath.relative(repoPath, absolutePath);
			const { success, output } = runVitest(repoPath, relativeToRepo);

			const status = success ? "✅ PASSED" : "❌ FAILED";
			const truncated = output.slice(0, 3000);

			return `\n\n--- VITEST RESULT [${status}] for ${filePath} ---\n${truncated}\n--- END VITEST RESULT ---\n\nIMPORTANT: Review the result above. If the test ${success ? "passed" : "failed"}, ${success ? "proceed to the next module." : "fix the errors in the test file before continuing."}`;
		},
	);

	const systemPrompt = `You are an expert unit-test generation agent for TypeScript / JavaScript projects.

## Objective
Analyse the repository and write comprehensive **vitest** unit tests that cover the code
introduced or modified in the branch described below.

## Output directory
Write every test file inside: \`${testDirRelative}\`
(relative to the repository root).  The \`write_file\` tool creates parent directories
automatically, so you do not need to create them separately.

## Branch context
- Branch  : ${branch.name}
- SHA     : ${branch.commitSha}
- Message : ${branch.message}
- Author  : ${branch.author}

## Vitest conventions
- \`import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'\`
- Use \`vi.mock('module')\` to mock external dependencies (fs, http, databases, etc.)
- File naming: \`<source-name>.test.ts\`
- Group related tests with \`describe\` blocks
- Test both happy paths and error / edge cases
- Keep tests independent (no shared state between test files)

## Import paths
- From \`${testDirRelative}/foo.test.ts\` to \`src/foo.ts\` the relative path is
  \`../../src/foo\` — always compute the correct relative path.

## Sub-agent strategy (REQUIRED)
Use \`spawn_subagent\` to delegate the creation of each individual test file to a
dedicated sub-agent.  Do NOT write test files yourself directly — always delegate.

For every source module that needs tests:
1. Identify the source file to test.
2. Call \`spawn_subagent\` with a self-contained query that includes:
   - The full path of the source file to test.
   - The expected output path: \`${testDirRelative}/<module>.test.ts\`
   - The vitest import conventions listed above.
   - A request to read the source file and write a complete test file.
3. After the sub-agent returns, the test file will be executed automatically by
   vitest.  Review the VITEST RESULT block appended to the sub-agent response.
4. If the test failed, spawn a new sub-agent with the error output to fix it.

## Workflow
1. \`list_directory\` on the root to map the project structure.
2. Read \`package.json\` to understand scripts and dependencies.
3. Identify source modules to test (focus on files changed in this branch).
4. For each module, call \`spawn_subagent\` to generate its test file.
5. Review each VITEST RESULT and fix failures via additional sub-agent calls.
6. Summarise what was created and the overall test status.
`;

	const query = `Generate vitest unit tests for branch "${branch.name}" (${branch.message}).

Steps:
1. Explore the project structure (list_directory, search_files "**/*.ts").
2. Read package.json to understand the project.
3. Identify the source modules introduced or modified in this branch.
4. For each module, use spawn_subagent to create a dedicated test file in "${testDirRelative}/".
   Each sub-agent query must be self-contained: include the source file path, the target
   test file path, and the vitest conventions.
5. After each spawn_subagent call, check the VITEST RESULT block in the response.
   If a test failed, spawn another sub-agent to fix it using the error output.
6. Report the final status of every test file created.`;

	await agent.executeAgent({
		dirPath: repoPath,
		systemPrompt,
		allowedTools: new Set([
			"read_file",
			"list_directory",
			"write_file",
			"search_files",
			"grep_search",
			"spawn_subagent",
		]),
		query,
	});
}

async function fixTestsWithAgent(
	repoPath: string,
	testDirRelative: string,
	errorOutput: string,
): Promise<void> {
	const agent = new InternalAgentService();

	const systemPrompt = `You are a test-debugging agent. Fix failing vitest tests.
Only modify files inside \`${testDirRelative}\` — never touch source files.`;

	const query = `The following vitest errors were reported.  Fix the test files in "${testDirRelative}":

\`\`\`
${errorOutput.slice(0, 4000)}
\`\`\`

Steps:
1. Read the failing test files.
2. Read the corresponding source files to understand the correct API / types.
3. Rewrite the test files so they pass.`;

	await agent.executeAgent({
		dirPath: repoPath,
		systemPrompt,
		allowedTools: new Set([
			"read_file",
			"list_directory",
			"write_file",
			"search_files",
			"grep_search",
		]),
		query,
	});
}

// ── Git commit + push ─────────────────────────────────────────────────────────

function commitAndPush(
	repoPath: string,
	testDirRelative: string,
	branch: string,
	passed: boolean,
): string {
	// Check if there is anything staged
	sh(`git add "${testDirRelative}"`, repoPath);

	const diff = execSync("git diff --cached --name-only", {
		cwd: repoPath,
		encoding: "utf-8",
	}).trim();
	if (!diff) return "Nothing to commit — no test files were generated.";

	const status = passed ? "PASS" : "FAIL";
	sh(
		`git commit -m "test: add unit tests for ${branch} [${status}]"`,
		repoPath,
	);
	sh(`git push origin ${branch}`, repoPath);
	return `Committed and pushed ${diff.split("\n").length} file(s) to ${branch}`;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface RepositoryPayload {
	id: string;
	url: string;
	name: string;
}

interface BranchPayload {
	name: string;
	commitSha: string;
	message: string;
	author: string;
	date: string;
}

// ── Tool definition ───────────────────────────────────────────────────────────

export const testGeneratorTools: ToolDefinition[] = [
	{
		name: "generate_branch_tests",
		description:
			"Clones a repository, checks out the specified branch, uses an AI agent to analyse the code and write vitest unit tests in test/<branch>/, validates them by running vitest, then commits and pushes the result back to the same branch.",
		inputSchema: {
			repository: z
				.object({
					id: z.string().describe("Repository ID"),
					url: z.string().describe("Clone URL of the repository"),
					name: z.string().describe("Repository name (used as directory name)"),
				})
				.describe("Repository metadata"),
			branch: z
				.object({
					name: z
						.string()
						.describe(
							"Full branch name as reported by the VCS (e.g. origin/feature/my-feature)",
						),
					commitSha: z.string().describe("Head commit SHA of the branch"),
					message: z.string().describe("Most recent commit message"),
					author: z.string().describe("Most recent commit author"),
					date: z.string().describe("Most recent commit date (ISO 8601)"),
				})
				.describe("Branch metadata"),
		},
		handler: async ({
			repository,
			branch,
		}: {
			repository: RepositoryPayload;
			branch: BranchPayload;
		}) => {
			const localBranch = localBranchName(branch.name);
			const sanitised = sanitiseBranch(branch.name);

			logger.info(
				`[test-generator] ══════ START ${repository.name}@${localBranch} ══════`,
			);

			// ── 1. Clone / update repo ────────────────────────────────────────
			let repoPath: string;
			try {
				repoPath = cloneOrUpdate(repository.url, repository.name, branch.name);
			} catch (err) {
				return ok({
					status: "failed",
					step: "clone",
					error: (err as Error).message,
				});
			}

			const testDirRelative = nodePath.join("test", sanitised);
			const testDirAbsolute = nodePath.join(repoPath, testDirRelative);

			// Ensure the test output directory exists
			if (!fs.existsSync(testDirAbsolute))
				fs.mkdirSync(testDirAbsolute, { recursive: true });

			// ── 2. Generate tests with the AI agent ───────────────────────────
			logger.info(`[test-generator] Generating tests → ${testDirRelative}`);
			try {
				await generateTestsWithAgent(repoPath, testDirRelative, branch);
			} catch (err) {
				return ok({
					status: "failed",
					step: "generate",
					error: (err as Error).message,
				});
			}

			// ── 3. Install dependencies / vitest ──────────────────────────────
			const pm = detectPm(repoPath);
			try {
				ensureDeps(repoPath, pm);
			} catch (err) {
				logger.warn(
					`[test-generator] Could not install deps: ${(err as Error).message}`,
				);
			}

			// ── 4. Run vitest ─────────────────────────────────────────────────
			let testResult = runVitest(repoPath, testDirRelative);
			logger.info(`[test-generator] Test run #1 success=${testResult.success}`);

			// ── 5. Fix loop (max 2 attempts) ──────────────────────────────────
			for (let attempt = 0; !testResult.success && attempt < 2; attempt++) {
				logger.info(
					`[test-generator] Fixing tests (attempt ${attempt + 1}/2)…`,
				);
				try {
					await fixTestsWithAgent(repoPath, testDirRelative, testResult.output);
					testResult = runVitest(repoPath, testDirRelative);
					logger.info(
						`[test-generator] Fix attempt ${attempt + 1} success=${testResult.success}`,
					);
				} catch (err) {
					logger.warn(
						`[test-generator] Fix attempt ${attempt + 1} error: ${(err as Error).message}`,
					);
					break;
				}
			}

			// ── 6. Commit & push ──────────────────────────────────────────────
			let commitResult: string;
			try {
				commitResult = commitAndPush(
					repoPath,
					testDirRelative,
					localBranch,
					testResult.success,
				);
			} catch (err) {
				commitResult = `Commit/push failed: ${(err as Error).message}`;
			}

			logger.info(
				`[test-generator] ══════ END ${repository.name}@${localBranch} ══════`,
			);

			return ok({
				status: testResult.success ? "success" : "partial",
				repository: repository.name,
				branch: localBranch,
				testDirectory: testDirRelative,
				testsPass: testResult.success,
				testOutput: testResult.output.slice(0, 3000),
				commitResult,
			});
		},
	},
];
