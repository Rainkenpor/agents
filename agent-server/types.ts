import type { IncomingMessage, ServerResponse } from "node:http";

// ─── Credential requerida por un MCP ─────────────────────────────────────────

export interface McpCredential {
	/** Nombre exacto de la variable de entorno, ej. "ATLASSIAN_BASE_URL" */
	key: string;
	/** Si true, el servidor aborta el startup si la variable no está definida */
	required: boolean;
	/** Descripción legible para el log de startup */
	description: string;
}

// ─── Metadata de una tool (solo nombre + descripción, sin handler) ────────────

export interface ToolMeta {
	name: string;
	description: string;
}

// ─── Metadata de un hook (solo nombre + descripción, sin payloadSchema) ───────

export interface HookMeta {
	name: string;
	description: string;
}

// ─── Contrato público que cada MCP debe exportar desde su index.ts ────────────

export interface McpModule {
	/**
	 * Identificador slug del MCP. Se usa para construir la ruta HTTP.
	 * Ejemplo: "jira" → POST /jira/mcp
	 */
	slug: string;

	/** Nombre legible para los logs de startup */
	displayName: string;

	/**
	 * Lista de tools (solo metadata: nombre + descripción).
	 * Usada exclusivamente para logging en startup.
	 */
	tools: ToolMeta[];

	/**
	 * Lista de hooks que este MCP puede emitir.
	 * Usada para logging en startup y para exponer el catálogo vía GET /hooks.
	 */
	hooks?: HookMeta[];

	/**
	 * Handler para las rutas de hooks del módulo: GET/POST /hooks/*, SSE stream.
	 * El servidor central lo monta en `/<slug>/hooks*`.
	 * Si se omite, el módulo no expone endpoints de hooks.
	 */
	hooksHandler?: (req: IncomingMessage, res: ServerResponse) => Promise<void>;

	/** Variables de entorno que este MCP necesita */
	credentials: McpCredential[];

	/**
	 * Inicialización async opcional (ej: seed de BD).
	 * El servidor central la ejecuta antes de registrar las rutas.
	 */
	onStartup?: () => Promise<void>;

	/**
	 * Handler HTTP que recibe req/res de Express.
	 * Express req/res extienden IncomingMessage/ServerResponse,
	 * por lo que el código existente de server.ts es compatible sin cambios.
	 */
	handler: (req: IncomingMessage, res: ServerResponse, body: unknown | Record<string,any>) => Promise<void>;
}
