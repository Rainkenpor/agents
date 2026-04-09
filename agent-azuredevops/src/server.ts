#!/usr/bin/env bun
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./mcp.js";

async function main(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("[agent-azuredevops] MCP server started (stdio)\n");
}

main().catch((error) => {
  process.stderr.write(`[agent-azuredevops] Fatal: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
