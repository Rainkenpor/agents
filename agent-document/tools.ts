import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DB } from "./src/db/index.ts";
import { registerDocumentTypeTools } from "./src/tools/document-types.ts";
import { registerTemplateTools } from "./src/tools/templates.ts";
import { registerDocumentTools } from "./src/tools/documents.ts";

export function registerTools(s: McpServer, db: DB): void {
  registerDocumentTypeTools(s, db);
  registerTemplateTools(s, db);
  registerDocumentTools(s, db);
}
