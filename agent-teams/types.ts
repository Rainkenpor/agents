// ─── MCP response helper ──────────────────────────────────────────────────────

/** Wraps any value as a valid MCP tool text response */
export const ok = (data: unknown) => ({
	content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

import type { ZodRawShape } from "zod";

// ─── Hook Registry type ───────────────────────────────────────────────────────

/**
 * Declarative hook definition used by the Hook Registry.
 * Naming convention for `name`: "<resource>.<past-tense-action>"
 *   Examples: "chat.created", "team.created", "message.sent"
 */
export interface HookDefinition {
	/** Unique dot-notation event name (e.g. "chat.created") */
	name: string;
	/** Human-readable description of when and why this hook fires */
	description: string;
	/** Zod schema documenting the shape of the event payload */
	payloadSchema: ZodRawShape;
}

/**
 * Declarative tool definition used by the Registry.
 * Each tool file exports a `ToolDefinition[]`; `tools.ts` collects and
 * registers them all.
 */
export interface ToolDefinition {
	/** Unique snake_case identifier shown to the LLM */
	name: string;
	/** Human-readable description shown to the LLM */
	description: string;
	/** Zod input schema that validates and documents parameters */
	inputSchema: ZodRawShape;
	// biome-ignore lint/suspicious/noExplicitAny: args are validated by Zod inside SDK
	handler: (args: any) => Promise<ReturnType<typeof ok>>;
}
