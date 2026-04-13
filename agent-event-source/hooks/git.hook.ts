// ─── Git Repository Hooks ─────────────────────────────────────────────────────
//
// Hooks emitted by the Git monitor and tools.
// Naming: git.<resource>.<past-tense-action>

import { z } from "zod";
import type { HookDefinition } from "../types.ts";

// ─── Shared sub-schemas ───────────────────────────────────────────────────────

const repoSchema = {
	id: z.string().describe("Internal repository UUID"),
	url: z.string().describe("Remote Git URL"),
	name: z.string().describe("Display name of the repository"),
};

const branchSchema = {
	name: z.string().describe("Branch name (e.g. main, feature/x)"),
	commitSha: z.string().describe("Latest commit SHA on this branch"),
};

const commitSchema = {
	sha: z.string().describe("Full commit SHA"),
	message: z.string().nullable().describe("Commit subject line"),
	author: z.string().nullable().describe("Author name"),
	date: z.string().nullable().describe("Author date (ISO-8601)"),
};

// ─── Hook definitions ─────────────────────────────────────────────────────────

export const gitHooks: HookDefinition[] = [
	{
		name: "git.repo.created",
		description:
			"Fired when a Git repository is added to the monitoring system",
		payloadSchema: {
			repository: z.object(repoSchema).describe("Repository metadata"),
			branches: z
				.array(z.object(branchSchema))
				.describe("Branches found at registration time"),
		},
	},

	{
		name: "git.repo.deleted",
		description: "Fired when a Git repository is removed from monitoring",
		payloadSchema: {
			repository: z.object(repoSchema).describe("Repository that was removed"),
			deletedAt: z.string().describe("ISO-8601 timestamp of deletion"),
		},
	},

	{
		name: "git.branch.created",
		description:
			"Fired when a new branch is detected on a monitored repository",
		payloadSchema: {
			repository: z.object(repoSchema).describe("Parent repository"),
			branch: z
				.object({
					name: z.string().describe("New branch name"),
					commitSha: z.string().describe("Initial commit SHA"),
					message: z.string().nullable().describe("Commit subject line"),
					author: z.string().nullable().describe("Commit author"),
					date: z.string().nullable().describe("Commit date ISO-8601"),
				})
				.describe("New branch info"),
		},
	},

	{
		name: "git.branch.deleted",
		description:
			"Fired when a branch is no longer present on the remote repository",
		payloadSchema: {
			repository: z.object(repoSchema).describe("Parent repository"),
			branch: z
				.object({
					name: z.string().describe("Deleted branch name"),
					lastCommitSha: z.string().describe("Last known commit SHA"),
				})
				.describe("Deleted branch info"),
		},
	},

	{
		name: "git.commit.pushed",
		description:
			"Fired when new commits are detected on a branch since the last polling cycle",
		payloadSchema: {
			repository: z.object(repoSchema).describe("Parent repository"),
			branch: z
				.object({ name: z.string().describe("Branch where commits landed") })
				.describe("Target branch"),
			commits: z
				.array(z.object(commitSchema))
				.describe(
					"New commits in chronological order (oldest first). Limited to the last 100.",
				),
			latestCommit: z
				.object(commitSchema)
				.describe("The most recent commit on the branch"),
		},
	},
];
