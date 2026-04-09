// ─── MCP Tool Result ──────────────────────────────────────────────────────────

export type McpToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

/** Wraps any value as a valid MCP tool text response */
export const ok = (data: unknown): McpToolResult => ({
  content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
});

// ─── Tool Registry type ───────────────────────────────────────────────────────

import type { ZodRawShape } from "zod";

/**
 * Declarative tool definition used by the Registry.
 * Each tool file exports a `ToolDefinition[]`; `tools.ts` collects and
 * registers them todos, luego wrapHandler agrega logging centralizado.
 */
export interface ToolDefinition {
  /** Unique snake_case identifier shown to the LLM */
  name: string;
  /** Human-readable description shown to the LLM */
  description: string;
  /** Zod input schema that validates and documents parameters */
  inputSchema: ZodRawShape;
  // biome-ignore lint/suspicious/noExplicitAny: args are validated by Zod inside SDK
  handler: (args: any) => Promise<McpToolResult>;
}
