import Fastify from "fastify";
import cors from "@fastify/cors";
import websocketPlugin from "@fastify/websocket";
import { envs } from "./envs.js";
import { runMigrations } from "./db/migrate.js";
import { reposRoutes } from "./routes/repos.js";
import { addClient, removeClient } from "./services/wsService.js";
import { startPoller, stopPoller } from "./services/pollerService.js";
import {
	startTestGenerator,
	stopTestGenerator,
} from "./services/testGeneratorService.js";

const fastify = Fastify({ logger: { level: "info" } });

await fastify.register(cors, {
	origin: ["http://localhost:5173", "http://localhost:4173"],
	methods: ["GET", "POST", "DELETE", "PUT", "PATCH"],
});

await fastify.register(websocketPlugin);

// WebSocket route
fastify.get("/ws", { websocket: true }, (socket) => {
	addClient(socket);
	socket.on("close", () => removeClient(socket));
	socket.on("error", () => removeClient(socket));
});

// REST routes
await fastify.register(reposRoutes, { prefix: "/api/v1/repos" });

// Health check
fastify.get("/health", async () => ({ status: "ok", timestamp: Date.now() }));

// Startup
runMigrations();

const shutdown = async () => {
	console.log("\n[App] Shutting down...");
	stopPoller();
	stopTestGenerator();
	await fastify.close();
	process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

try {
	await fastify.listen({ port: envs.SERVER_PORT, host: "0.0.0.0" });
	console.log(`[App] Server running on port ${envs.SERVER_PORT}`);
	console.log(`[App] DB folder:    ${envs.dbFolder}`);
	console.log(`[App] Repos folder: ${envs.reposFolder}`);
	console.log(`[App] Check interval: ${envs.checkIntervalMs}ms`);
	startPoller();
	startTestGenerator();
} catch (err) {
	fastify.log.error(err);
	process.exit(1);
}
