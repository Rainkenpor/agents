// ─── Git Repository MCP Tools ─────────────────────────────────────────────────
//
// Tools exposed via MCP to manage monitored repositories and query hook history.
//
// Available tools:
//   git_add_repository      – clone and start monitoring a Git repo
//   git_list_repositories   – list all monitored repos with branch status
//   git_remove_repository   – stop monitoring and delete local clone
//   git_list_sent_hooks     – query the hook history (filterable)
//   git_resend_hook         – replay a previously sent hook
//   git_trigger_check       – manually trigger a poll cycle

import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { db } from "../db/index.ts";
import { repositories, branches, sentHooks } from "../db/schema.ts";
import { emit } from "../hooks.ts";
import { ok } from "../types.ts";
import type { ToolDefinition } from "../types.ts";
import {
	cloneRepository,
	listBranches,
	removeLocalClone,
	monitorRepositories,
} from "../git/git.monitor.ts";

export const gitTools: ToolDefinition[] = [
	// ── git_add_repository ─────────────────────────────────────────────────────
	{
		name: "git_add_repository",
		description:
			"Add a Git repository to the monitoring system. " +
			"Performs an initial mirror clone, records all existing branches and their " +
			"latest commits, then emits a git.repo.created hook. " +
			"Authentication is handled by the system's git credential store (SSH keys, " +
			"HTTPS credential helper, or token embedded in the URL).",
		inputSchema: {
			url: z
				.string()
				.describe(
					"Git remote URL — HTTPS (https://github.com/user/repo.git) or SSH (git@github.com:user/repo.git)",
				),
			name: z
				.string()
				.optional()
				.describe(
					"Human-readable display name. Defaults to the last path segment of the URL.",
				),
		},
		handler: async ({ url, name }) => {
			// Prevent duplicates
			const existing = await db
				.select()
				.from(repositories)
				.where(and(eq(repositories.url, url), eq(repositories.isActive, true)));
			if (existing.length > 0 && existing[0].isActive) {
				throw new Error(`Repository already monitored: ${url}`);
			}

			const repoName =
				name || url.split("/").pop()?.replace(/\.git$/, "") || url;
			const id = crypto.randomUUID();
			const now = new Date().toISOString();

			// Clone (can be slow for large repos)
			const localPath = await cloneRepository(id, url);

			// Read initial branches
			const initialBranches = await listBranches(localPath);

			// Persist repository
			await db.insert(repositories).values({
				id,
				url,
				name: repoName,
				isActive: true,
				createdAt: now,
				localPath,
			});

			// Persist branches
			for (const b of initialBranches) {
				await db.insert(branches).values({
					id: crypto.randomUUID(),
					repositoryId: id,
					name: b.name,
					lastCommitSha: b.sha,
					lastCommitMessage: b.message,
					lastCommitAuthor: b.author,
					lastCommitDate: b.date,
					isActive: true,
					createdAt: now,
				});
			}

			// Emit hook
			await emit("git.repo.created", {
				repository: { id, url, name: repoName },
				branches: initialBranches.map((b) => ({
					name: b.name,
					commitSha: b.sha,
				})),
			});

			return ok({
				id,
				url,
				name: repoName,
				localPath,
				branches: initialBranches,
				createdAt: now,
			});
		},
	},

	// ── git_list_repositories ──────────────────────────────────────────────────
	{
		name: "git_list_repositories",
		description:
			"List all monitored Git repositories with their active branches and last known commit SHAs.",
		inputSchema: {
			includeDeleted: z
				.boolean()
				.optional()
				.describe("Set to true to include repositories that were removed"),
		},
		handler: async ({ includeDeleted }) => {
			const repos = includeDeleted
				? await db.select().from(repositories)
				: await db
						.select()
						.from(repositories)
						.where(eq(repositories.isActive, true));

			const result = await Promise.all(
				repos.map(async (repo) => {
					const repoBranches = await db
						.select()
						.from(branches)
						.where(
							and(
								eq(branches.repositoryId, repo.id),
								eq(branches.isActive, true),
							),
						);
					return {
						id: repo.id,
						url: repo.url,
						name: repo.name,
						isActive: repo.isActive,
						createdAt: repo.createdAt,
						deletedAt: repo.deletedAt ?? null,
						branches: repoBranches.map((b) => ({
							name: b.name,
							lastCommitSha: b.lastCommitSha,
							lastCommitMessage: b.lastCommitMessage,
							lastCommitAuthor: b.lastCommitAuthor,
							lastCommitDate: b.lastCommitDate,
						})),
					};
				}),
			);

			return ok(result);
		},
	},

	// ── git_remove_repository ──────────────────────────────────────────────────
	{
		name: "git_remove_repository",
		description:
			"Stop monitoring a Git repository, remove its local clone, " +
			"and emit a git.repo.deleted hook.",
		inputSchema: {
			id: z.string().describe("Repository UUID (from git_list_repositories)"),
		},
		handler: async ({ id }) => {
			const rows = await db
				.select()
				.from(repositories)
				.where(eq(repositories.id, id));
			if (!rows.length) throw new Error(`Repository not found: ${id}`);

			const repo = rows[0];
			if (!repo.isActive) throw new Error(`Repository already deleted: ${id}`);

			const now = new Date().toISOString();

			// Soft-delete repository and branches
			await db
				.update(repositories)
				.set({ isActive: false, deletedAt: now })
				.where(eq(repositories.id, id));

			await db
				.update(branches)
				.set({ isActive: false, deletedAt: now })
				.where(eq(branches.repositoryId, id));

			// Remove local mirror
			if (repo.localPath) {
				removeLocalClone(repo.localPath);
			}

			// Emit hook
			await emit("git.repo.deleted", {
				repository: { id: repo.id, url: repo.url, name: repo.name },
				deletedAt: now,
			});

			return ok({ id, removed: true, name: repo.name });
		},
	},

	// ── git_list_sent_hooks ────────────────────────────────────────────────────
	{
		name: "git_list_sent_hooks",
		description:
			"Query the history of hooks that have been sent. " +
			"Useful for auditing, debugging, and selecting a hook to resend.",
		inputSchema: {
			hookName: z
				.string()
				.optional()
				.describe(
					"Filter by hook name (e.g. git.commit.pushed, git.repo.created)",
				),
			repositoryId: z
				.string()
				.optional()
				.describe("Filter by repository UUID"),
			limit: z
				.number()
				.optional()
				.describe("Max results to return (default 50, max 200)"),
		},
		handler: async ({ hookName, repositoryId, limit }) => {
			const conditions = [];
			if (hookName) conditions.push(eq(sentHooks.hookName, hookName));
			if (repositoryId)
				conditions.push(eq(sentHooks.repositoryId, repositoryId));

			const cap = Math.min(limit ?? 50, 200);

			const rows = await db
				.select()
				.from(sentHooks)
				.where(conditions.length > 0 ? and(...conditions) : undefined)
				.orderBy(desc(sentHooks.sentAt))
				.limit(cap);

			return ok(
				rows.map((h) => ({
					id: h.id,
					hookName: h.hookName,
					repositoryId: h.repositoryId,
					sentAt: h.sentAt,
					payload: JSON.parse(h.payload) as unknown,
				})),
			);
		},
	},

	// ── git_resend_hook ────────────────────────────────────────────────────────
	{
		name: "git_resend_hook",
		description:
			"Re-emit a previously sent hook event. " +
			"The payload is replayed as-is with an additional _resent flag " +
			"and _originalId field for traceability.",
		inputSchema: {
			hookId: z
				.string()
				.describe("Sent hook UUID (from git_list_sent_hooks)"),
		},
		handler: async ({ hookId }) => {
			const rows = await db
				.select()
				.from(sentHooks)
				.where(eq(sentHooks.id, hookId));
			if (!rows.length) throw new Error(`Sent hook not found: ${hookId}`);

			const hook = rows[0];
			const originalPayload = JSON.parse(hook.payload) as object;

			await emit(hook.hookName, {
				...originalPayload,
				_resent: true,
				_originalId: hookId,
				_originalSentAt: hook.sentAt,
			});

			return ok({
				resent: true,
				hookId,
				hookName: hook.hookName,
				resentAt: new Date().toISOString(),
			});
		},
	},

	// ── git_trigger_check ─────────────────────────────────────────────────────
	{
		name: "git_trigger_check",
		description:
			"Manually trigger a polling cycle instead of waiting for the next scheduled run. " +
			"Useful after a force-push or to verify the monitor is working.",
		inputSchema: {
			repositoryId: z
				.string()
				.optional()
				.describe(
					"Check only this repository UUID. Omit to check all monitored repos.",
				),
		},
		handler: async ({ repositoryId }) => {
			await monitorRepositories(repositoryId);
			return ok({
				triggered: true,
				repositoryId: repositoryId ?? "all",
				triggeredAt: new Date().toISOString(),
			});
		},
	},
];
