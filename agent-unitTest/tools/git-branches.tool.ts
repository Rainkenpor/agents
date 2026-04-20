/**
 * git-branches.tool.ts
 *
 * Lists all branches of a remote Git repository without cloning it.
 * Uses `git ls-remote --heads` which only fetches ref metadata.
 */

import z from "zod";
import { ok } from "../types";
import type { ToolDefinition } from "../types";
import { execSync } from "node:child_process";

// ── Helpers ───────────────────────────────────────────────────────────────────

interface RemoteBranch {
	name: string;
	sha: string;
}

/**
 * Queries remote refs without cloning.
 * Supports https (with embedded credentials) and ssh URLs.
 */
function listRemoteBranches(
	repoUrl: string,
	filter?: string,
): RemoteBranch[] {
	// git ls-remote --heads prints lines like:
	//   <sha>\trefs/heads/<branch>
	const raw = execSync(`git ls-remote --heads "${repoUrl}"`, {
		encoding: "utf-8",
		stdio: "pipe",
		// Avoid interactive prompts; fail fast if credentials are missing
		env: {
			...process.env,
			GIT_TERMINAL_PROMPT: "0",
			GIT_ASKPASS: "echo",
		},
	});

	const branches: RemoteBranch[] = raw
		.split("\n")
		.filter(Boolean)
		.map((line) => {
			const [sha, ref] = line.split("\t");
			const name = ref.replace("refs/heads/", "");
			return { name, sha: sha.trim() };
		})
		.filter(({ name }) =>
			filter ? name.toLowerCase().includes(filter.toLowerCase()) : true,
		);

	return branches;
}

// ── Tool definition ───────────────────────────────────────────────────────────

export const gitBranchesTools: ToolDefinition[] = [
	{
		name: "git_list_remote_branches",
		description:
			"Lists all branches of a remote Git repository without cloning it. " +
			"Uses git ls-remote so only ref metadata is fetched — no local disk space is used. " +
			"Supports HTTPS (with credentials embedded in the URL or via environment variables) and SSH URLs.",
		inputSchema: {
			repoUrl: z
				.string()
				.describe(
					"Clone URL of the repository (e.g. https://dev.azure.com/org/proj/_git/repo or git@github.com:org/repo.git)",
				),
			filter: z
				.string()
				.optional()
				.describe(
					"Optional substring filter applied to branch names (case-insensitive). Returns all branches when omitted.",
				),
		},
		handler: async ({
			repoUrl,
			filter,
		}: {
			repoUrl: string;
			filter?: string;
		}) => {
			let branches: RemoteBranch[];
			try {
				branches = listRemoteBranches(repoUrl, filter);
			} catch (err) {
				const message = (err as { stderr?: string; message: string }).stderr
					?.trim() || (err as Error).message;
				return ok({
					status: "error",
					repoUrl,
					error: message,
				});
			}

			return ok({
				status: "success",
				repoUrl,
				totalBranches: branches.length,
				filter: filter ?? null,
				branches,
			});
		},
	},
];
