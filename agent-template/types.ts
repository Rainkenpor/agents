// ─── Request Context ──────────────────────────────────────────────────────────
//
// [AGENT INSTRUCTIONS]
// Replace `AppContext` with the fields your app needs per request.
// These values are extracted from HTTP headers in server.ts.
//
// Examples:
//   - REST API: { baseUrl, apiKey }
//   - OAuth service: { accessToken }
//   - DB-backed service: { tenantId, authToken }
//
// The context is instantiated once per MCP request and passed to the factory.

export interface AppContext {
	/** Base URL of the target API (e.g. "https://api.example.com") */
	baseUrl: string;
	/** Authentication token sent via the `mcp-token` header */
	token: string;
}

// ─── Helpers passed to registerTools ─────────────────────────────────────────
//
// [AGENT INSTRUCTIONS]
// Add helper functions that your tools will share: HTTP clients, URL builders,
// auth header generators, etc. Keep helpers stateless — all state lives in ctx.
//
// Every field here is built inside the factory (server.ts) from `AppContext`
// and handed to `registerTools`.

export interface AppHelpers {
	/** Builds a full URL for a given API path */
	apiUrl: (path: string) => string;
	/** Authenticated GET; throws on non-2xx */
	apiGet: (url: string, params?: Record<string, unknown>) => Promise<unknown>;
	/** Authenticated POST; throws on non-2xx */
	apiPost: (url: string, body?: unknown) => Promise<unknown>;
	/** Authenticated PUT; throws on non-2xx */
	apiPut: (url: string, body?: unknown) => Promise<unknown>;
	/** Authenticated DELETE; throws on non-2xx */
	apiDelete: (url: string) => Promise<unknown>;
}

// ─── MCP response helper ──────────────────────────────────────────────────────

/** Wraps any value as a valid MCP tool text response */
export const ok = (data: unknown) => ({
	content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

// ─── Tool Registry type ───────────────────────────────────────────────────────

import type { ZodRawShape } from "zod";

/**
 * Declarative tool definition used by the Registry.
 * Each tool file exports a `ToolDefinition[]`; `tools.ts` collects and
 * registers them all, then logs them to the console on startup.
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
