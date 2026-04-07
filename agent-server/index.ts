import { logger } from "./util/logger.ts";
import { validateEnvs } from "./util/envs.ts";
import { mcpModules } from "./registry.ts";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

const PORT = Number(process.env.SERVER_PORT ?? 4000);

// ─── 1. Ejecutar onStartup de cada MCP (ej: seed de BD) ──────────────────────

for (const mcp of mcpModules) {
  if (mcp.onStartup) {
    logger.info(`[startup] Inicializando ${mcp.displayName}...`);
    await mcp.onStartup();
  }
}

// ─── 2. Validar credentials ───────────────────────────────────────────────────

validateEnvs(mcpModules);

// ─── 3. Loguear MCPs y tools registrados ─────────────────────────────────────

for (const mcp of mcpModules) {
  logger.info(`[startup] ${mcp.displayName} → POST /${mcp.slug}/mcp  (${mcp.tools.length} tools)`);
  for (const tool of mcp.tools) {
    logger.info(`  • ${tool.name.padEnd(40)} ${tool.description}`);
  }
}

// ─── 4. Crear servidor y manejar rutas ───────────────────────────────────────

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const path = url.pathname;
  const method = req.method;

  // Health check
  if (method === 'GET' && path === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: "ok",
      mcps: mcpModules.map((m) => ({
        slug: m.slug,
        name: m.displayName,
        tools: m.tools.length,
        endpoint: `/${m.slug}/mcp`,
      })),
    }));
    return;
  }

  // MCP routes
  for (const mcp of mcpModules) {
    if (path === `/${mcp.slug}/mcp`) {

      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const rawBody = Buffer.concat(chunks);

      try {
        let parsedBody: unknown;
        let rpcMethod: string | undefined;
        if (rawBody.length > 0) {
          try {
            parsedBody = JSON.parse(rawBody.toString());
            rpcMethod = (parsedBody as { method?: string }).method;
          } catch {
            // body no es JSON (p.ej. GET de SSE)
          }
        }

        await mcp.handler(req, res, parsedBody);
      } catch (err) {
        logger.error(`[${mcp.slug}] Error no manejado: ${String(err)}`);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: String(err) }));
        }
      }
      return;
    }
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    error: "Not Found",
    available: mcpModules.map((m) => `/${m.slug}/mcp`),
  }));
});

// ─── 5. Iniciar servidor ──────────────────────────────────────────────────────

server.listen(PORT, () => {
  logger.info(`[server] Agent server corriendo en http://localhost:${PORT}`);
  logger.info(`[server] Endpoints disponibles:`);
  for (const mcp of mcpModules) {
    logger.info(`  POST /${mcp.slug}/mcp  →  ${mcp.displayName}`);
  }
  logger.info(`[server] GET  /health        →  Estado del servidor`);
});
