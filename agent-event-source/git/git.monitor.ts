// ─── Git Repository Monitor ───────────────────────────────────────────────────
//
// Polls all active repositories at a configurable interval.
// Uses `git clone --mirror` for initial setup and `git remote update` for diffs.
// Only uses git CLI — no extra npm dependencies.

import { $ } from "bun";
import { db } from "../db/index.ts";
import { repositories, branches } from "../db/schema.ts";
import { eq, and } from "drizzle-orm";
import { emit } from "../hooks.ts";
import { logger } from "../util/logger.ts";
import { existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";

// ─── Constants ────────────────────────────────────────────────────────────────
const DATA_DIR = process.env.DATA_DIR || "./data";

if (!existsSync(DATA_DIR)) {
	mkdirSync(DATA_DIR, { recursive: true });
}

/** Root directory for local mirror clones, relative to cwd */
export const REPOS_DIR = join(DATA_DIR, "repos");

/** Separator used in git --format strings (ASCII Unit Separator, very rare in text) */
const SEP = "\x1f";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BranchSnapshot {
	name: string;
	sha: string;
	message: string | null;
	author: string | null;
	date: string | null;
}

export interface CommitEntry {
	sha: string;
	message: string | null;
	author: string | null;
	date: string | null;
}

// ─── Git helpers ──────────────────────────────────────────────────────────────

/**
 * Clones the repository as a mirror (bare clone that tracks all refs).
 * Returns the local path where it was cloned.
 */
export async function cloneRepository(
	repoId: string,
	url: string,
): Promise<string> {
	if (!existsSync(REPOS_DIR)) {
		mkdirSync(REPOS_DIR, { recursive: true });
	}
	const localPath = join(REPOS_DIR, repoId);
	await $`git clone --mirror ${url} ${localPath}`
		.env({ ...process.env, GIT_TERMINAL_PROMPT: "0" })
		.quiet();
	return localPath;
}

/**
 * Fetches all refs from the remote and prunes deleted branches.
 */
async function fetchUpdates(localPath: string): Promise<void> {
	await $`git remote update --prune`
		.cwd(localPath)
		.env({ ...process.env, GIT_TERMINAL_PROMPT: "0" })
		.quiet();
}

/**
 * Returns all branches in the local mirror with their latest commit details.
 * Uses ASCII Unit Separator (0x1F) to safely delimit fields.
 */
export async function listBranches(
	localPath: string,
): Promise<BranchSnapshot[]> {
	const format = `--format=%(refname:short)${SEP}%(objectname)${SEP}%(subject)${SEP}%(authorname)${SEP}%(authordate:iso8601-strict)`;
	const raw = await $`git for-each-ref ${format} refs/heads/`
		.cwd(localPath)
		.text();

	return raw
		.split("\n")
		.filter((l) => l.trim())
		.map((line) => {
			const parts = line.split(SEP);
			return {
				name: parts[0] ?? "",
				sha: parts[1] ?? "",
				message: parts[2] || null,
				author: parts[3] || null,
				date: parts[4]?.trim() || null,
			};
		})
		.filter((b) => b.name && b.sha);
}

/**
 * Returns commits in the range `oldSha..newSha` (oldest first, max 100).
 */
export async function getCommitsBetween(
	localPath: string,
	oldSha: string,
	newSha: string,
): Promise<CommitEntry[]> {
	const format = `--pretty=format:%H${SEP}%s${SEP}%an${SEP}%aI`;
	const range = `${oldSha}..${newSha}`;
	const raw = await $`git log ${format} --reverse --max-count=100 ${range}`
		.cwd(localPath)
		.nothrow()
		.text();

	return raw
		.split("\n")
		.filter((l) => l.trim())
		.map((line) => {
			const parts = line.split(SEP);
			return {
				sha: parts[0] ?? "",
				message: parts[1] || null,
				author: parts[2] || null,
				date: parts[3]?.trim() || null,
			};
		})
		.filter((c) => c.sha);
}

/**
 * Removes the local mirror clone from disk.
 */
export function removeLocalClone(localPath: string): void {
	if (existsSync(localPath)) {
		rmSync(localPath, { recursive: true, force: true });
	}
}

// ─── Monitor loop ─────────────────────────────────────────────────────────────

let isMonitoring = false;

/**
 * Checks all active (or a single) repository for changes and emits hooks.
 * Safe to call concurrently — a guard flag prevents overlapping runs.
 */
export async function monitorRepositories(
	targetRepoId?: string,
): Promise<void> {
	if (isMonitoring) {
		logger.warn("[git-monitor] Previous cycle still running — skipping");
		return;
	}
	isMonitoring = true;

	try {
		const condition = targetRepoId
			? and(eq(repositories.isActive, true), eq(repositories.id, targetRepoId))
			: eq(repositories.isActive, true);

		const repos = await db.select().from(repositories).where(condition);
		logger.info(
			`[git-monitor] Starting check cycle for ${repos.length} repo(s)`,
		);

		for (const repo of repos) {
			await checkRepository(repo);
		}

		logger.info("[git-monitor] Check cycle completed");
	} catch (err) {
		logger.error(`[git-monitor] Cycle error: ${err}`);
	} finally {
		isMonitoring = false;
	}
}

async function checkRepository(
	repo: typeof repositories.$inferSelect,
): Promise<void> {
	const { id, url, name, localPath } = repo;

	if (!localPath || !existsSync(localPath)) {
		logger.error(
			`[git-monitor] Local clone missing for ${name} (${id}) — skipping`,
		);
		return;
	}

	try {
		logger.info(`[git-monitor] Fetching ${name}…`);
		await fetchUpdates(localPath);

		const remoteBranches = await listBranches(localPath);
		const dbBranches = await db
			.select()
			.from(branches)
			.where(and(eq(branches.repositoryId, id), eq(branches.isActive, true)));

		const remoteMap = new Map(remoteBranches.map((b) => [b.name, b]));
		const dbMap = new Map(dbBranches.map((b) => [b.name, b]));
		const now = new Date().toISOString();
		const repoPayload = { id, url, name };

		// ── Detect new branches ──────────────────────────────────────────────
		for (const [branchName, info] of remoteMap) {
			if (dbMap.has(branchName)) continue;

			await db.insert(branches).values({
				id: crypto.randomUUID(),
				repositoryId: id,
				name: branchName,
				lastCommitSha: info.sha,
				lastCommitMessage: info.message,
				lastCommitAuthor: info.author,
				lastCommitDate: info.date,
				isActive: true,
				createdAt: now,
			});

			await emit("git.branch.created", {
				repository: repoPayload,
				branch: {
					name: branchName,
					commitSha: info.sha,
					message: info.message,
					author: info.author,
					date: info.date,
				},
			});
			logger.info(`[git-monitor] New branch detected: ${name}/${branchName}`);
		}

		// ── Detect deleted branches ──────────────────────────────────────────
		for (const [branchName, dbBranch] of dbMap) {
			if (remoteMap.has(branchName)) continue;

			await db
				.update(branches)
				.set({ isActive: false, deletedAt: now })
				.where(eq(branches.id, dbBranch.id));

			await emit("git.branch.deleted", {
				repository: repoPayload,
				branch: { name: branchName, lastCommitSha: dbBranch.lastCommitSha },
			});
			logger.info(`[git-monitor] Branch deleted: ${name}/${branchName}`);
		}

		// ── Detect new commits on existing branches ──────────────────────────
		for (const [branchName, dbBranch] of dbMap) {
			const remote = remoteMap.get(branchName);
			if (!remote || remote.sha === dbBranch.lastCommitSha) continue;

			const commits = await getCommitsBetween(
				localPath,
				dbBranch.lastCommitSha,
				remote.sha,
			);

			await db
				.update(branches)
				.set({
					lastCommitSha: remote.sha,
					lastCommitMessage: remote.message,
					lastCommitAuthor: remote.author,
					lastCommitDate: remote.date,
				})
				.where(eq(branches.id, dbBranch.id));

			await emit("git.commit.pushed", {
				repository: repoPayload,
				branch: { name: branchName },
				commits,
				latestCommit: {
					sha: remote.sha,
					message: remote.message,
					author: remote.author,
					date: remote.date,
				},
			});
			logger.info(
				`[git-monitor] ${commits.length} new commit(s) on ${name}/${branchName}`,
			);
		}
	} catch (err) {
		logger.error(`[git-monitor] Error checking ${name}: ${err}`);
	}
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

/**
 * Starts the background polling loop.
 * @param intervalMinutes How often to poll (default from env, fallback 20).
 */
export function startMonitor(intervalMinutes: number): void {
	const ms = intervalMinutes * 60 * 1000;
	logger.info(
		`[git-monitor] Polling every ${intervalMinutes} minute(s) (${ms}ms)`,
	);

	// Run an initial check shortly after startup
	setTimeout(monitorRepositories, 10_000);
	setInterval(monitorRepositories, ms);
}
