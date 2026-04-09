import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createMcpServer } from "./mcp.js";
import type { McpModule } from "./module.js";
import { TOOL_CATALOG } from "./infrastructure/mcp/registerTools.js";

export function buildServer() {
  return createMcpServer();
}

export async function handler(req: IncomingMessage, res: ServerResponse, parsedBody?: unknown): Promise<void> {
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  res.on("close", () => {
    void transport.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, parsedBody);
  } catch (error) {
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  }
}

export const agentAzureDevOpsMcp: McpModule = {
  slug: "agent-azuredevops",
  displayName: "Agent Azure DevOps",
  credentials: [
    {
      key: "AZDO_ORGANIZATION",
      required: false,
      description: "Organizacion por defecto de Azure DevOps. Si falta, la tool usa grupodistelsa o el valor enviado por input.",
    },
  ],
  tools: [...TOOL_CATALOG],
  handler,
};

export default agentAzureDevOpsMcp;
