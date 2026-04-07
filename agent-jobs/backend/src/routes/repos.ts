import type { FastifyInstance } from "fastify";
import { desc, eq } from "drizzle-orm";
import { join } from "path";
import { randomUUID } from "crypto";
import { mkdirSync } from "fs";
import { db } from "../db/client.js";
import { branches, branchTracking, repos } from "../db/schema.js";
import { envs } from "../envs.js";
import { cloneRepo, deleteRepoFolder } from "../services/gitService.js";
import { pollRepo } from "../services/pollerService.js";
import { broadcast } from "../services/wsService.js";

interface AddRepoBody {
	url: string;
	name: string;
}

export async function reposRoutes(fastify: FastifyInstance) {
	// GET /api/v1/repos
	fastify.get("/", async () => {
		const allRepos = await db.select().from(repos).orderBy(repos.createdAt);
		const result = await Promise.all(
			allRepos.map(async (repo) => {
				const repoBranches = await db
					.select()
					.from(branches)
					.where(eq(branches.repoId, repo.id));
				return { ...repo, branches: repoBranches };
			}),
		);
		return result;
	});

	// GET /api/v1/repos/:id
	fastify.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
		const id = Number(req.params.id);
		const [repo] = await db.select().from(repos).where(eq(repos.id, id));
		if (!repo) return reply.status(404).send({ error: "Repo not found" });
		const repoBranches = await db
			.select()
			.from(branches)
			.where(eq(branches.repoId, repo.id));
		return { ...repo, branches: repoBranches };
	});

	// POST /api/v1/repos
	fastify.post<{ Body: AddRepoBody }>(
		"/",
		{
			schema: {
				body: {
					type: "object",
					required: ["url", "name"],
					properties: {
						url: { type: "string", minLength: 1 },
						name: { type: "string", minLength: 1 },
					},
				},
			},
		},
		async (req, reply) => {
			const { url, name } = req.body;

			const [existing] = await db
				.select()
				.from(repos)
				.where(eq(repos.url, url));
			if (existing) {
				return reply.status(409).send({ error: "Repository already exists" });
			}

			const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 50);
			const localPath = join(
				envs.reposFolder,
				`${safeName}_${randomUUID().slice(0, 8)}`,
			);
			mkdirSync(envs.reposFolder, { recursive: true });

			const [newRepo] = await db
				.insert(repos)
				.values({
					name,
					url,
					localPath,
					createdAt: Date.now(),
					status: "cloning",
				})
				.returning();

			reply.status(202).send(newRepo);

			// Async clone
			cloneRepo(url, localPath)
				.then(async () => {
					await db
						.update(repos)
						.set({ status: "active" })
						.where(eq(repos.id, newRepo.id));
					broadcast({
						event: "repo_status_changed",
						payload: {
							repoId: newRepo.id,
							status: "active",
							errorMessage: null,
							updatedAt: Date.now(),
						},
					});
					console.log(`[Repos] Cloned: ${name}`);
					await pollRepo(newRepo.id);
				})
				.catch(async (err) => {
					const errorMessage = err instanceof Error ? err.message : String(err);
					console.error(`[Repos] Clone failed for ${name}:`, errorMessage);
					await db
						.update(repos)
						.set({ status: "error", errorMessage })
						.where(eq(repos.id, newRepo.id));
					broadcast({
						event: "repo_status_changed",
						payload: {
							repoId: newRepo.id,
							status: "error",
							errorMessage,
							updatedAt: Date.now(),
						},
					});
				});
		},
	);

	// DELETE /api/v1/repos/:id
	fastify.delete<{ Params: { id: string } }>("/:id", async (req, reply) => {
		const id = Number(req.params.id);
		const [repo] = await db.select().from(repos).where(eq(repos.id, id));
		if (!repo) return reply.status(404).send({ error: "Repo not found" });

		await db.delete(repos).where(eq(repos.id, id));
		deleteRepoFolder(repo.localPath).catch((err) =>
			console.warn(`[Repos] Could not delete folder ${repo.localPath}:`, err),
		);

		return reply.status(204).send();
	});

	// POST /api/v1/repos/:id/poll
	fastify.post<{ Params: { id: string } }>("/:id/poll", async (req, reply) => {
		const id = Number(req.params.id);
		const [repo] = await db.select().from(repos).where(eq(repos.id, id));
		if (!repo) return reply.status(404).send({ error: "Repo not found" });
		if (repo.status !== "active") {
			return reply
				.status(400)
				.send({ error: `Repo status is '${repo.status}', cannot poll` });
		}

		pollRepo(id).catch((err) =>
			console.error(`[Repos] Manual poll failed:`, err),
		);
		return { queued: true };
	});

	// GET /api/v1/repos/:id/branch-tracking
	fastify.get<{ Params: { id: string } }>(
		"/:id/branch-tracking",
		async (req, reply) => {
			const id = Number(req.params.id);
			const [repo] = await db.select().from(repos).where(eq(repos.id, id));
			if (!repo) return reply.status(404).send({ error: "Repo not found" });

			const records = await db
				.select()
				.from(branchTracking)
				.where(eq(branchTracking.repoId, id))
				.orderBy(desc(branchTracking.createdAt));
			return records;
		},
	);

	// PATCH /api/v1/repos/:id/branch-tracking/:trackingId
	fastify.patch<{
		Params: { id: string; trackingId: string };
		Body: { status: "pendiente" | "completado" };
	}>(
		"/:id/branch-tracking/:trackingId",
		{
			schema: {
				body: {
					type: "object",
					required: ["status"],
					properties: {
						status: { type: "string", enum: ["pendiente", "completado"] },
					},
				},
			},
		},
		async (req, reply) => {
			const repoId = Number(req.params.id);
			const trackingId = Number(req.params.trackingId);

			const [record] = await db
				.select()
				.from(branchTracking)
				.where(eq(branchTracking.id, trackingId));

			if (!record || record.repoId !== repoId) {
				return reply.status(404).send({ error: "Tracking record not found" });
			}

			const [updated] = await db
				.update(branchTracking)
				.set({ status: req.body.status, updatedAt: Date.now() })
				.where(eq(branchTracking.id, trackingId))
				.returning();

			return updated;
		},
	);
}
