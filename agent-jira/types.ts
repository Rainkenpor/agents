// ─── Contexto por request ─────────────────────────────────────────────────────

export interface AtlassianContext {
	baseUrl: string;
	email: string;
	token: string;
}

// ─── Helpers HTTP expuestos a las tools ───────────────────────────────────────

export interface AtlassianHelpers {
	jiraUrl: (p: string) => string;
	agileUrl: (p: string) => string;
	cfluUrl: (p: string) => string;
	rawUrl: (p: string) => string;
	apiGet: (url: string, params?: Record<string, unknown>) => Promise<unknown>;
	apiPost: (url: string, body?: unknown) => Promise<unknown>;
	apiPut: (url: string, body?: unknown) => Promise<unknown>;
	apiDelete: (
		url: string,
		params?: Record<string, unknown>,
	) => Promise<unknown>;
	authHeaders: () => Record<string, string>;
}

// ─── Utilidades MCP ───────────────────────────────────────────────────────────

/** Convierte texto plano a Atlassian Document Format (ADF) */
export const adf = (text: string) => ({
	type: "doc",
	version: 1,
	content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

/** Envuelve datos como respuesta de tool MCP */
export const ok = (data: unknown) => ({
	content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});
