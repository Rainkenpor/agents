// ══════════════════════════════════════════════════════════════════════════
// Elastic (Elasticsearch vía Kibana Console Proxy)
// ══════════════════════════════════════════════════════════════════════════
//
// Todas las consultas a Elasticsearch se hacen a través del console proxy de
// Kibana, de modo que basta con tener acceso a la URL de Kibana del space:
//
//   POST {KIBANA_URL}/s/{SPACE}/api/console/proxy?path={esPath}&method={METHOD}
//
// Kibana reenvía el body a Elasticsearch usando su propia sesión/credenciales.
// Las APIs propias de Kibana (data views) se llaman directamente.

import z from "zod";
import { ok } from "../types";
import type { ToolDefinition } from "../types";
import { envs } from "../util/envs";
import { logger } from "../util/logger";
import { emit } from "../hooks";

// ─── Cliente HTTP ─────────────────────────────────────────────────────────────

function baseHeaders(): Record<string, string> {
	const headers: Record<string, string> = {
		"kbn-xsrf": "true",
		"Content-Type": "application/json",
	};
	if (envs.AUTH_HEADER) headers.Authorization = envs.AUTH_HEADER;
	else if (envs.API_KEY) headers.Authorization = `ApiKey ${envs.API_KEY}`;
	return headers;
}

/**
 * Ejecuta una petición a Elasticsearch a través del console proxy de Kibana.
 *
 * @param method  Método HTTP que verá Elasticsearch (GET/POST/PUT/DELETE).
 * @param esPath  Ruta de la API de Elasticsearch, ej "/_cat/indices" o "/idx/_search".
 * @param body    Cuerpo opcional (query DSL, etc.).
 */
async function esProxy(
	method: "GET" | "POST" | "PUT" | "DELETE",
	esPath: string,
	body?: unknown,
): Promise<unknown> {
	const normalized = esPath.startsWith("/") ? esPath : `/${esPath}`;
	const url =
		`${envs.KIBANA_URL}/s/${envs.SPACE}/api/console/proxy` +
		`?path=${encodeURIComponent(normalized)}&method=${method}`;

	logger.info(`[elastic] proxy ${method} ${normalized}`);

	const res = await fetch(url, {
		method: "POST", // el proxy de Kibana siempre se invoca con POST
		headers: baseHeaders(),
		body: body !== undefined ? JSON.stringify(body) : undefined,
	});

	const text = await res.text();
	let parsed: unknown = text;
	try {
		parsed = text ? JSON.parse(text) : null;
	} catch {
		/* respuesta no-JSON (ej. _cat sin format=json) */
	}

	if (!res.ok) {
		throw new Error(
			`Elasticsearch ${method} ${normalized} → ${res.status}: ${
				typeof parsed === "string" ? parsed : JSON.stringify(parsed)
			}`,
		);
	}
	return parsed;
}

/** Llama una API nativa de Kibana (no la de Elasticsearch). */
async function kibanaApi(
	method: "GET" | "POST" | "PUT" | "DELETE",
	apiPath: string,
	body?: unknown,
): Promise<unknown> {
	const normalized = apiPath.startsWith("/") ? apiPath : `/${apiPath}`;
	const url = `${envs.KIBANA_URL}/s/${envs.SPACE}${normalized}`;

	logger.info(`[elastic] kibana ${method} ${normalized}`);

	const res = await fetch(url, {
		method,
		headers: baseHeaders(),
		body: body !== undefined ? JSON.stringify(body) : undefined,
	});

	const text = await res.text();
	let parsed: unknown = text;
	try {
		parsed = text ? JSON.parse(text) : null;
	} catch {
		/* no-JSON */
	}

	if (!res.ok) {
		throw new Error(
			`Kibana ${method} ${normalized} → ${res.status}: ${
				typeof parsed === "string" ? parsed : JSON.stringify(parsed)
			}`,
		);
	}
	return parsed;
}

// ─── Tools ──────────────────────────────────────────────────────────────────

export const elasticTools: ToolDefinition[] = [
	{
		name: "elastic_list_indices",
		description:
			"Lista los índices de Elasticsearch (vía _cat/indices). Útil para descubrir qué datos hay disponibles antes de hacer búsquedas.",
		inputSchema: {
			pattern: z
				.string()
				.optional()
				.describe(
					"Patrón de índices opcional, ej 'logs-*' o 'app-2024-*'. Por defecto lista todos.",
				),
		},
		handler: async ({ pattern }: { pattern?: string }) => {
			const path = pattern
				? `/_cat/indices/${encodeURIComponent(pattern)}?format=json&bytes=b`
				: "/_cat/indices?format=json&bytes=b";
			const data = await esProxy("GET", path);
			return ok(data);
		},
	},
	{
		name: "elastic_list_data_views",
		description:
			"Lista las Data Views (index patterns) configuradas en el space de Kibana. Son las que aparecen en el selector de la vista Discover.",
		inputSchema: {},
		handler: async () => {
			const data = await kibanaApi("GET", "/api/data_views");
			return ok(data);
		},
	},
	{
		name: "elastic_get_mapping",
		description:
			"Obtiene el mapping (definición de campos y tipos) de uno o varios índices. Úsalo para saber qué campos puedes consultar.",
		inputSchema: {
			index: z
				.string()
				.describe("Nombre del índice o patrón, ej 'logs-*' o 'mi-indice'."),
		},
		handler: async ({ index }: { index: string }) => {
			const data = await esProxy(
				"GET",
				`/${encodeURIComponent(index)}/_mapping`,
			);
			return ok(data);
		},
	},
	{
		name: "elastic_field_caps",
		description:
			"Devuelve las capacidades de los campos (field_caps) de un índice: nombre, tipo y si es agregable/buscable. Más compacto que el mapping completo.",
		inputSchema: {
			index: z.string().describe("Índice o patrón, ej 'logs-*'."),
			fields: z
				.string()
				.optional()
				.describe("Campos separados por coma, ej 'message,@timestamp'. Default '*'."),
		},
		handler: async ({ index, fields }: { index: string; fields?: string }) => {
			const f = fields || "*";
			const data = await esProxy(
				"GET",
				`/${encodeURIComponent(index)}/_field_caps?fields=${encodeURIComponent(f)}`,
			);
			return ok(data);
		},
	},
	{
		name: "elastic_search",
		description:
			"Ejecuta una búsqueda en Elasticsearch usando Query DSL. Equivale a lo que hace la vista Discover: filtrar, ordenar y paginar documentos. Devuelve los hits que coinciden.",
		inputSchema: {
			index: z.string().describe("Índice o patrón a consultar, ej 'logs-*'."),
			query: z
				.record(z.any())
				.optional()
				.describe(
					"Objeto Query DSL de Elasticsearch (el contenido de 'query'). Ej: { match: { status: 'error' } }. Si se omite, hace match_all.",
				),
			size: z
				.number()
				.int()
				.min(0)
				.max(10000)
				.optional()
				.describe("Cantidad de documentos a devolver. Default 10."),
			from: z
				.number()
				.int()
				.min(0)
				.optional()
				.describe("Offset de paginación. Default 0."),
			sort: z
				.array(z.record(z.any()))
				.optional()
				.describe(
					"Ordenamiento, ej [{ '@timestamp': 'desc' }]. Opcional.",
				),
			source: z
				.array(z.string())
				.optional()
				.describe(
					"Lista de campos a incluir (_source). Opcional; omite para traer todos.",
				),
		},
		handler: async ({
			index,
			query,
			size,
			from,
			sort,
			source,
		}: {
			index: string;
			query?: Record<string, unknown>;
			size?: number;
			from?: number;
			sort?: Record<string, unknown>[];
			source?: string[];
		}) => {
			const body: Record<string, unknown> = {
				query: query ?? { match_all: {} },
				size: size ?? 10,
				from: from ?? 0,
			};
			if (sort) body.sort = sort;
			if (source) body._source = source;

			const data = await esProxy(
				"POST",
				`/${encodeURIComponent(index)}/_search`,
				body,
			);
			await emit("elastic.search.executed", {
				index,
				size: body.size as number,
				hasQuery: Boolean(query),
			});
			return ok(data);
		},
	},
	{
		name: "elastic_count",
		description:
			"Cuenta cuántos documentos coinciden con una query en un índice, sin traer los documentos. Rápido para métricas y validaciones.",
		inputSchema: {
			index: z.string().describe("Índice o patrón, ej 'logs-*'."),
			query: z
				.record(z.any())
				.optional()
				.describe("Query DSL opcional (el contenido de 'query'). Default match_all."),
		},
		handler: async ({
			index,
			query,
		}: {
			index: string;
			query?: Record<string, unknown>;
		}) => {
			const body = query ? { query } : undefined;
			const data = await esProxy(
				"POST",
				`/${encodeURIComponent(index)}/_count`,
				body,
			);
			return ok(data);
		},
	},
	{
		name: "elastic_aggregate",
		description:
			"Ejecuta una agregación de Elasticsearch (aggs) sin traer documentos. Útil para top-N, histogramas de fechas, métricas (avg/sum/min/max), cardinalidad, etc.",
		inputSchema: {
			index: z.string().describe("Índice o patrón, ej 'logs-*'."),
			aggs: z
				.record(z.any())
				.describe(
					"Objeto de agregaciones (el contenido de 'aggs'), ej { por_status: { terms: { field: 'status' } } }.",
				),
			query: z
				.record(z.any())
				.optional()
				.describe("Query DSL opcional para filtrar antes de agregar."),
		},
		handler: async ({
			index,
			aggs,
			query,
		}: {
			index: string;
			aggs: Record<string, unknown>;
			query?: Record<string, unknown>;
		}) => {
			const body: Record<string, unknown> = { size: 0, aggs };
			if (query) body.query = query;
			const data = await esProxy(
				"POST",
				`/${encodeURIComponent(index)}/_search`,
				body,
			);
			return ok(data);
		},
	},
	{
		name: "elastic_get_document",
		description:
			"Obtiene un documento específico por su _id dentro de un índice.",
		inputSchema: {
			index: z.string().describe("Nombre del índice."),
			id: z.string().describe("El _id del documento."),
		},
		handler: async ({ index, id }: { index: string; id: string }) => {
			const data = await esProxy(
				"GET",
				`/${encodeURIComponent(index)}/_doc/${encodeURIComponent(id)}`,
			);
			return ok(data);
		},
	},
	{
		name: "elastic_sql_query",
		description:
			"Ejecuta una consulta SQL de Elasticsearch (_sql). Forma sencilla de consultar datos sin escribir Query DSL. Ej: SELECT * FROM \"logs-*\" WHERE status = 'error' LIMIT 10.",
		inputSchema: {
			query: z
				.string()
				.describe("Sentencia SQL de Elasticsearch. Usa comillas dobles para nombres de índice con guiones o comodines."),
			fetch_size: z
				.number()
				.int()
				.min(1)
				.optional()
				.describe("Máximo de filas a devolver. Default 100."),
		},
		handler: async ({
			query,
			fetch_size,
		}: {
			query: string;
			fetch_size?: number;
		}) => {
			const data = await esProxy("POST", "/_sql?format=json", {
				query,
				fetch_size: fetch_size ?? 100,
			});
			return ok(data);
		},
	},
	{
		name: "elastic_cluster_health",
		description:
			"Devuelve el estado de salud del cluster de Elasticsearch (status green/yellow/red, número de nodos y shards).",
		inputSchema: {},
		handler: async () => {
			const data = await esProxy("GET", "/_cluster/health");
			return ok(data);
		},
	},
	{
		name: "elastic_cat_aliases",
		description:
			"Lista los alias de índices definidos en el cluster (vía _cat/aliases).",
		inputSchema: {},
		handler: async () => {
			const data = await esProxy("GET", "/_cat/aliases?format=json");
			return ok(data);
		},
	},
	{
		name: "elastic_raw_request",
		description:
			"Escotilla de escape: ejecuta una petición arbitraria contra cualquier API de Elasticsearch a través del console proxy de Kibana. Úsalo solo cuando ninguna tool específica cubre el caso.",
		inputSchema: {
			method: z
				.enum(["GET", "POST", "PUT", "DELETE"])
				.describe("Método HTTP que verá Elasticsearch."),
			path: z
				.string()
				.describe("Ruta de la API de Elasticsearch, ej '/_cat/nodes?format=json'."),
			body: z
				.record(z.any())
				.optional()
				.describe("Cuerpo JSON opcional para la petición."),
		},
		handler: async ({
			method,
			path,
			body,
		}: {
			method: "GET" | "POST" | "PUT" | "DELETE";
			path: string;
			body?: Record<string, unknown>;
		}) => {
			const data = await esProxy(method, path, body);
			return ok(data);
		},
	},
];
