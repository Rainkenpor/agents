import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { branches, branchTracking, repos } from "../db/schema.js";
import { envs } from "../envs.js";
import {
	fetchAll,
	getBranchBirthCommit,
	getBranchHead,
	listBranches,
} from "./gitService.js";
import { broadcast } from "./wsService.js";

function extractJiraTicket(branchName: string): string | null {
	// Elimina prefijos como feature/, bugfix/, hotfix/, release/, etc.
	const withoutPrefix = branchName.replace(/^[^/]+\//, "");
	const match = withoutPrefix.match(/^([A-Z][A-Z0-9]*-\d+)/);
	return match ? match[1] : null;
}

let timer: ReturnType<typeof setInterval> | null = null;

export async function pollRepo(repoId: number): Promise<void> {
	const [repo] = await db.select().from(repos).where(eq(repos.id, repoId));
	if (!repo || repo.status !== "active") return;

	try {
		console.log(`[Poller] Checking repo: ${repo.name} (${repo.url})`);
		await fetchAll(repo.localPath);

		const branchNames = await listBranches(repo.localPath);
		const now = Date.now();
		const changedBranches: (typeof branches.$inferSelect)[] = [];

		for (const branchName of branchNames) {
			try {
				const head = await getBranchHead(repo.localPath, branchName);
				const allBranchRows = db
					.select()
					.from(branches)
					.where(eq(branches.repoId, repo.id))
					.all();
				const [existing] = allBranchRows.filter((r) => r.name === branchName);

				if (!existing) {
					const [newBranch] = await db
						.insert(branches)
						.values({
							repoId: repo.id,
							name: branchName,
							headSha: head.sha,
							lastCommitMessage: head.message,
							lastCommitDate: head.date,
							updatedAt: now,
						})
						.returning();
					changedBranches.push(newBranch);

					// Buscar el commit donde nació la rama (primer commit exclusivo + fork point)
					const birthInfo = await getBranchBirthCommit(
						repo.localPath,
						branchName,
						branchNames,
					);
					const birthSha = birthInfo?.birthSha ?? head.sha;
					const linkSha = birthInfo?.linkSha ?? null;
					console.log(
						`[Poller] New branch ${branchName} — birth: ${birthSha.slice(0, 7)}${linkSha ? ` link: ${linkSha.slice(0, 7)}` : ""}`,
					);

					// Registrar en branch_tracking como nueva rama detectada
					await db.insert(branchTracking).values({
						repoId: repo.id,
						branchName,
						jira: extractJiraTicket(branchName),
						initialCommitSha: linkSha || birthSha,
						latestCommitSha: head.sha,
						status: "pendiente",
						createdAt: now,
						updatedAt: now,
					});
				} else if (existing.headSha !== head.sha) {
					console.log(
						`[Poller] Branch changed: ${repo.name}/${branchName} ${existing.headSha.slice(0, 7)} → ${head.sha.slice(0, 7)} — ${head.message}`,
					);

					broadcast({
						event: "branch_changed",
						payload: {
							repoId: repo.id,
							repoName: repo.name,
							branch: branchName,
							previousSha: existing.headSha,
							newSha: head.sha,
							lastCommitMessage: head.message,
							detectedAt: now,
						},
					});

					const [updated] = await db
						.update(branches)
						.set({
							headSha: head.sha,
							lastCommitMessage: head.message,
							lastCommitDate: head.date,
							updatedAt: now,
						})
						.where(eq(branches.id, existing.id))
						.returning();
					changedBranches.push(updated);

					// Registrar nuevo cambio en branch_tracking
					await db.insert(branchTracking).values({
						repoId: repo.id,
						branchName,
						jira: extractJiraTicket(branchName),
						initialCommitSha: existing.headSha,
						latestCommitSha: head.sha,
						status: "pendiente",
						createdAt: now,
						updatedAt: now,
					});
				}
			} catch (err) {
				console.warn(
					`[Poller] Could not get HEAD for ${repo.name}/${branchName}:`,
					err,
				);
			}
		}

		await db
			.update(repos)
			.set({ lastCheckedAt: now })
			.where(eq(repos.id, repo.id));

		const allBranches = await db
			.select()
			.from(branches)
			.where(eq(branches.repoId, repo.id));
		broadcast({
			event: "branches_refreshed",
			payload: {
				repoId: repo.id,
				branches: allBranches.map((b) => ({
					id: b.id,
					name: b.name,
					headSha: b.headSha,
					lastCommitMessage: b.lastCommitMessage,
					lastCommitDate: b.lastCommitDate,
					updatedAt: b.updatedAt,
				})),
			},
		});

		console.log(
			`[Poller] Done: ${repo.name} — ${branchNames.length} branches checked`,
		);
	} catch (err) {
		const errorMessage = err instanceof Error ? err.message : String(err);
		console.error(`[Poller] Error polling ${repo.name}:`, errorMessage);
		await db
			.update(repos)
			.set({ status: "error", errorMessage })
			.where(eq(repos.id, repo.id));
		broadcast({
			event: "repo_status_changed",
			payload: {
				repoId: repo.id,
				status: "error",
				errorMessage,
				updatedAt: Date.now(),
			},
		});
	}
}

async function pollAll(): Promise<void> {
	const activeRepos = await db
		.select()
		.from(repos)
		.where(eq(repos.status, "active"));
	await Promise.allSettled(activeRepos.map((r) => pollRepo(r.id)));
}

export function startPoller(): void {
	if (timer) return;
	console.log(`[Poller] Starting — interval: ${envs.checkIntervalMs}ms`);
	setTimeout(() => pollAll(), 2000);
	timer = setInterval(() => pollAll(), envs.checkIntervalMs);
}

export function stopPoller(): void {
	if (timer) {
		clearInterval(timer);
		timer = null;
		console.log("[Poller] Stopped");
	}
}
