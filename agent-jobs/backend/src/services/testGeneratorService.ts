/**
 * testGeneratorService.ts
 *
 * Background service that processes pending branch_tracking records that have
 * a Jira ticket associated. For each record it:
 *   1. Resolves the repository's local path.
 *   2. Runs `git diff initialCommitSha..latestCommitSha` to collect the changed
 *      files and their diffs.
 *   3. Passes the diff context to the InternalAgentService (synchronously,
 *      one at a time) with instructions to generate Vitest tests.
 *   4. Marks the record as "completado" regardless of agent outcome so the
 *      queue keeps draining.
 *
 * The agent receives:
 *   - The repo_id so it can call write_test / list_tests / read_test / run_tests.
 *   - The list of changed files.
 *   - The full git diff (truncated to MAX_DIFF_CHARS for context safety).
 *
 * Tests are placed at   test/{jira}/{file_name}.test.ts   inside the repo by
 * the write_test tool.
 */
import { and, eq, isNotNull } from "drizzle-orm";
import { simpleGit } from "simple-git";
import { db } from "../db/client.js";
import { branchTracking, repos } from "../db/schema.js";
import { InternalAgentService } from "./agent.js";
import { agentLogger } from "./logger.service.js";

// ── Config ────────────────────────────────────────────────────────────────────

/** Interval between queue-drain cycles (ms). */
const POLL_INTERVAL_MS =
	Number(process.env.TEST_GEN_INTERVAL_MS) || 2 * 60 * 1000; // 2 min default

/** Maximum diff chars sent in the agent prompt to avoid context overflow. */
const MAX_DIFF_CHARS = 40_000;

/** Allowed tool names for the test-generator agent. */
const TEST_AGENT_TOOLS = new Set([
	"list_tests",
	"read_test",
	"write_test",
	"run_tests",
]);

// ── Git helpers ───────────────────────────────────────────────────────────────

interface DiffResult {
	changedFiles: string[];
	diffStat: string;
	fullDiff: string;
}

async function getDiff(
	localPath: string,
	from: string,
	to: string,
): Promise<DiffResult> {
	const git = simpleGit(localPath);

	// Changed file names
	const nameOnly = await git.raw(["diff", "--name-only", `${from}..${to}`]);
	const changedFiles = nameOnly
		.trim()
		.split("\n")
		.map((f) => f.trim())
		.filter(Boolean);

	// Compact stat summary
	const diffStat = await git.raw(["diff", "--stat", `${from}..${to}`]);

	// Full patch (truncated)
	let fullDiff = await git.raw(["diff", `${from}..${to}`]);
	if (fullDiff.length > MAX_DIFF_CHARS) {
		fullDiff = `${fullDiff.slice(0, MAX_DIFF_CHARS)}\n\n...[diff truncated — ${fullDiff.length} total chars]`;
	}

	return { changedFiles, diffStat: diffStat.trim(), fullDiff };
}

// ── Agent prompt builder ──────────────────────────────────────────────────────

function buildSystemPrompt(): string {
	return `You are a test-generation agent. Your job is to analyze code changes (provided as a git diff) and write comprehensive Vitest unit/integration tests for the modified code.

Rules:
- Use only the tools available to you: list_tests, read_test, write_test, run_tests.
- Always call write_test with the correct repo_id and jira arguments provided in the user message.
- Each logical unit of change should get its own test file (e.g. one file per modified class or module).
- Test files are stored at test/{jira}/{file_name}.test.ts inside the repository.
- Use descriptive file names (e.g. 'user-service', 'auth-middleware').
- After writing all tests, call run_tests to validate them.
- If run_tests reports failures, fix the test files and run again (up to 3 attempts).
- Only use 'vitest' imports (import { describe, it, expect, vi } from "vitest").
- Do NOT install packages or modify source files.
- When finished, briefly summarize what tests you wrote.`;
}

function buildUserQuery(
	repoId: number,
	jira: string,
	branchName: string,
	diff: DiffResult,
): string {
	const fileList =
		diff.changedFiles.length > 0
			? diff.changedFiles.map((f) => `  - ${f}`).join("\n")
			: "  (no files detected)";

	return `Generate Vitest tests for the following branch changes.

## Context
- repo_id: ${repoId}
- jira: ${jira}
- branch: ${branchName}

## Changed files
${fileList}

## Diff stat
\`\`\`
${diff.diffStat || "(empty)"}
\`\`\`

## Full diff
\`\`\`diff
${diff.fullDiff || "(empty diff — commits may be equal)"}
\`\`\`

Write the tests now using write_test. Store them under test/${jira}/ inside the repository (repo_id=${repoId}).`;
}

// ── Core processor ────────────────────────────────────────────────────────────

/**
 * Processes a single pending branchTracking record. Returns true if a record
 * was processed (whether successfully or with an error), false if there was
 * nothing to do.
 */
async function processNextPending(): Promise<boolean> {
	// Fetch the oldest pending record that has a Jira ticket
	const [record] = await db
		.select()
		.from(branchTracking)
		.where(
			and(
				eq(branchTracking.status, "pendiente"),
				isNotNull(branchTracking.jira),
			),
		)
		.orderBy(branchTracking.createdAt)
		.limit(1);

	if (!record) return false;

	const jira = record.jira as string; // narrowed — isNotNull above guarantees it

	agentLogger.info(
		`[TestGen] Processing tracking id=${record.id} jira=${jira} branch=${record.branchName}`,
	);

	try {
		// Resolve repo
		const [repo] = await db
			.select()
			.from(repos)
			.where(eq(repos.id, record.repoId));

		if (!repo) {
			agentLogger.info(
				`[TestGen] Repository id=${record.repoId} not found — skipping`,
			);
			await db
				.update(branchTracking)
				.set({ status: "completado", updatedAt: Date.now() })
				.where(eq(branchTracking.id, record.id));
			return true;
		}

		// Get diff between the two recorded commits
		let diff: DiffResult;
		try {
			diff = await getDiff(
				repo.localPath,
				record.initialCommitSha,
				record.latestCommitSha,
			);
		} catch (gitErr) {
			agentLogger.info(
				`[TestGen] git diff failed for tracking id=${record.id}: ${gitErr instanceof Error ? gitErr.message : String(gitErr)}`,
			);
			diff = {
				changedFiles: [],
				diffStat: "",
				fullDiff: `(git diff unavailable: ${gitErr instanceof Error ? gitErr.message : String(gitErr)})`,
			};
		}

		// Build agent input
		const systemPrompt = buildSystemPrompt();
		const query = buildUserQuery(repo.id, jira, record.branchName, diff);

		agentLogger.info(
			`[TestGen] Launching agent for jira=${jira} (${diff.changedFiles.length} files changed)`,
		);

		// Mark as completado only after the agent has successfully finished
		await db
			.update(branchTracking)
			.set({ status: "completado", updatedAt: Date.now() })
			.where(eq(branchTracking.id, record.id));

		const agent = new InternalAgentService();
		const result = await agent.executeAgent({
			agentSlug: "test-generator",
			systemPrompt,
			query,
			allowedTools: TEST_AGENT_TOOLS,
		});

		agentLogger.info(
			`[TestGen] Agent finished for jira=${jira}: ${String(result).slice(0, 200)}`,
		);
	} catch (err) {
		agentLogger.info(
			`[TestGen] Error processing tracking id=${record.id}: ${err instanceof Error ? err.message : String(err)}`,
		);
		// Leave the record as "pendiente" so it can be retried on the next cycle
	}

	return true;
}

// ── Poller loop ───────────────────────────────────────────────────────────────

let _timer: ReturnType<typeof setInterval> | null = null;
let _running = false;

/**
 * Drain all pending records in sequence, then wait for the next interval.
 * Uses a lock flag (_running) to prevent overlapping executions.
 */
async function drainQueue(): Promise<void> {
	if (_running) return;
	_running = true;
	try {
		// Process until no more pending records (sequential by design)
		// eslint-disable-next-line no-await-in-loop
		while (await processNextPending()) {
			// keep processing
		}
	} catch (err) {
		agentLogger.info(
			`[TestGen] Unexpected error in drain loop: ${err instanceof Error ? err.message : String(err)}`,
		);
	} finally {
		_running = false;
	}
}

export function startTestGenerator(): void {
	if (_timer) return;
	agentLogger.info(`[TestGen] Starting — interval: ${POLL_INTERVAL_MS}ms`);
	// Run once immediately at startup, then on every interval
	void drainQueue();
	_timer = setInterval(() => void drainQueue(), POLL_INTERVAL_MS);
}

export function stopTestGenerator(): void {
	if (_timer) {
		clearInterval(_timer);
		_timer = null;
	}
}
