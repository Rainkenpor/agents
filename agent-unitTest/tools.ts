// ─── Tool Registry ────────────────────────────────────────────────────────────
//
// [AGENT INSTRUCTIONS]
// This file is the central registry for all MCP tools (Registry Pattern).
//
// HOW TO ADD A NEW TOOL GROUP:
//   1. Create `tools/my-domain.tool.ts` and export a `ToolDefinition[]` array.
//   2. Import that array here and spread it into `registry`.
//
// GUIDELINES:
//   - One `ToolDefinition[]` export per domain file.
//   - Always return `ok(data)` from types.ts inside handlers.
//   - Use `z.string().describe(...)` to document each parameter for the LLM.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolDefinition } from "./types";
import { logger } from "./util/logger";
// import { exampleTools } from "./tools/example.tool";
import { testGeneratorTools } from "./tools/test-generator.tool";
import { gitBranchesTools } from "./tools/git-branches.tool";

const RESPONSE_PREVIEW_LENGTH = 200;

// ─── Add new tool arrays here ─────────────────────────────────────────────────
export const registryTool: ToolDefinition[] = [
	// ...exampleTools,
	...testGeneratorTools,
	...gitBranchesTools,
];

function wrapHandler(
	name: string,
	handler: ToolDefinition["handler"],
): ToolDefinition["handler"] {
	return async (args) => {
		logger.info(`[tool] → ${name}(${JSON.stringify(args)})`);
		const result = await handler(args);
		const preview = JSON.stringify(result);
		const suffix = preview.length > RESPONSE_PREVIEW_LENGTH ? "…" : "";
		logger.info(
			`[tool] ← ${preview.slice(0, RESPONSE_PREVIEW_LENGTH)}${suffix}`,
		);
		return result;
	};
}

/**
 * Registers every tool in the registry on the given McpServer instance
 * and prints a startup summary to the console.
 */
export function initializeTools(s: McpServer): void {
	for (const tool of registryTool) {
		s.registerTool(
			tool.name,
			{ description: tool.description, inputSchema: tool.inputSchema },
			wrapHandler(tool.name, tool.handler),
		);
	}
}
