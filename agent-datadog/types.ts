import type { ZodRawShape } from "zod";

// ─── Request Context ──────────────────────────────────────────────────────────

export interface AppContext {
	/** Datadog API Key sent via `mcp-api-key` header */
	apiKey: string;
	/** Datadog Application Key sent via `mcp-application-key` header */
	appKey: string;
}

// ─── MCP response helper ──────────────────────────────────────────────────────

export const ok = (data: unknown) => ({
	content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

// ─── Tool Registry type ───────────────────────────────────────────────────────

export interface ToolDefinition {
	name: string;
	description: string;
	inputSchema: ZodRawShape;
	// biome-ignore lint/suspicious/noExplicitAny: args validated by Zod inside SDK
	handler: (args: any) => Promise<ReturnType<typeof ok>>;
}

// ─── Hook Registry type ───────────────────────────────────────────────────────

export interface HookDefinition {
	name: string;
	description: string;
	payloadSchema: ZodRawShape;
}
