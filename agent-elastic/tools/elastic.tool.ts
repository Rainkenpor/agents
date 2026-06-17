// ══════════════════════════════════════════════════════════════════════════
// Elastic (conexión DIRECTA a Elasticsearch)
// ══════════════════════════════════════════════════════════════════════════
//
// Todas las consultas se hacen directamente contra Elasticsearch (puerto 9200):
//
//   {METHOD} {ELASTIC_URL}{esPath}
//
// con el verbo HTTP real (GET/POST/PUT/DELETE), Content-Type application/json y,
// opcionalmente, un header Authorization (API key o Basic).

import z from "zod";
import { ok } from "../types";
import type { ToolDefinition } from "../types";
import { envs } from "../util/envs";
import { logger } from "../util/logger";
import { emit } from "../hooks";

// ─── Cliente HTTP ─────────────────────────────────────────────────────────────

function baseHeaders(): Record<string, string> {
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};
	if (envs.AUTH_HEADER) headers.Authorization = envs.AUTH_HEADER;
	else if (envs.API_KEY) headers.Authorization = `ApiKey ${envs.API_KEY}`;
	return headers;
}

/**
 * Ejecuta una petición DIRECTA contra Elasticsearch.
 *
 * @param method  Método HTTP real (GET/POST/PUT/DELETE).
 * @param esPath  Ruta de la API de Elasticsearch, ej "/_cat/indices" o "/idx/_search".
 * @param body    Cuerpo opcional (query DSL, etc.).
 */
async function esRequest(
	method: "GET" | "POST" | "PUT" | "DELETE",
	esPath: string,
	body?: unknown,
): Promise<unknown> {
	const normalized = esPath.startsWith("/") ? esPath : `/${esPath}`;
	const url = `${envs.ES_URL}${normalized}`;

	logger.info(`[elastic] ${method} ${normalized}`);

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

// ─── Helpers de logs ──────────────────────────────────────────────────────────

/** Campos que se proyectan en las tools de logs (suficientes para diagnóstico). */
const LOG_SOURCE = ["@timestamp", "level", "hostname", "msg", "message", "traceId"];

/** Convierte los hits crudos de _search en líneas compactas de log. */
function projectLogs(raw: unknown): {
	total: number;
	count: number;
	logs: Array<Record<string, unknown>>;
} {
	const hitsObj = (raw as any)?.hits;
	const hits = hitsObj?.hits ?? [];
	const logs = hits.map((h: any) => ({
		timestamp: h._source?.["@timestamp"],
		level: h._source?.level,
		hostname: h._source?.hostname,
		msg: h._source?.msg ?? h._source?.message,
		traceId: h._source?.traceId,
		index: h._index,
	}));
	return {
		total: hitsObj?.total?.value ?? logs.length,
		count: logs.length,
		logs,
	};
}

// ─── Tools ──────────────────────────────────────────────────────────────────

export const elasticTools: ToolDefinition[] = [
	{
		name: "elastic_list_indices",
		description:
			"Lista los índices de Elasticsearch (vía _cat/indices). Útil para descubrir qué datos hay disponibles antes de hacer búsquedas. Los datastreams aparecen como índices de respaldo '.ds-...'.",
		inputSchema: {
			pattern: z
				.string()
				.optional()
				.describe(
					"Patrón de índices opcional, ej 'logs-*' o 'log-*-qa'. Para datastreams usa su nombre (log-*-qa), NO los backing indices ocultos (.ds-...). Por defecto lista todos.",
				),
		},
		handler: async ({ pattern }: { pattern?: string }) => {
			const path = pattern
				? `/_cat/indices/${encodeURIComponent(pattern)}?format=json&bytes=b`
				: "/_cat/indices?format=json&bytes=b";
			const data = await esRequest("GET", path);
			return ok(data);
		},
	},
	{
		name: "elastic_get_mapping",
		description:
			"Obtiene el mapping (definición de campos y tipos) de uno o varios índices. Úsalo para saber qué campos puedes consultar y cuáles tienen subcampo '.keyword'.",
		inputSchema: {
			index: z
				.string()
				.describe("Nombre del índice o patrón, ej 'logs-*' o 'mi-indice'."),
		},
		handler: async ({ index }: { index: string }) => {
			const data = await esRequest(
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
				.describe(
					"Campos separados por coma, ej 'message,@timestamp'. Default '*'.",
				),
		},
		handler: async ({ index, fields }: { index: string; fields?: string }) => {
			const f = fields || "*";
			const data = await esRequest(
				"GET",
				`/${encodeURIComponent(index)}/_field_caps?fields=${encodeURIComponent(f)}`,
			);
			return ok(data);
		},
	},
	{
		name: "elastic_logs",
		description:
			"Extrae logs de Elasticsearch de forma compacta. Devuelve solo { timestamp, level, hostname, msg, traceId, index } en vez del hit crudo (las respuestas _search son enormes). REGLAS: hostname usa wildcard sobre hostname.keyword (el texto analizado NO sirve para comodines); level se matchea contra level.keyword cubriendo minúscula y Capitalizada ('error'/'Error'); el texto libre usa match_phrase sobre msg/message; resultados ordenados por @timestamp desc (los más recientes primero). Primera opción para 'dame los últimos errores del host X'.",
		inputSchema: {
			index: z
				.string()
				.describe(
					"Índice o patrón a consultar, ej 'log-*-qa' o 'logs-*'. Usa el nombre del datastream (log-*-qa), NO los backing indices ocultos '.ds-...' (un wildcard no los matchea).",
				),
			hostname: z
				.string()
				.optional()
				.describe(
					"Filtro por hostname con comodín, ej 'consumer-logistika*'. Se aplica sobre hostname.keyword.",
				),
			level: z
				.string()
				.optional()
				.describe(
					"Nivel de log, ej 'error', 'warn', 'info'. Se matchea contra level.keyword cubriendo minúscula y Capitalizada.",
				),
			text: z
				.string()
				.optional()
				.describe(
					"Texto libre a buscar dentro del mensaje (match_phrase sobre msg/message), ej 'NJS-098'.",
				),
			from: z
				.string()
				.optional()
				.describe(
					"Inicio del rango de @timestamp (ISO-8601 o expresión ES, ej '2026-06-17T00:00:00Z' o 'now-1h').",
				),
			to: z
				.string()
				.optional()
				.describe("Fin del rango de @timestamp (ISO-8601 o expresión ES)."),
			last: z
				.string()
				.optional()
				.describe(
					"Atajo de tiempo relativo, ej '15m', '1h', '24h' → se traduce a @timestamp >= now-<last>.",
				),
			size: z
				.number()
				.int()
				.min(1)
				.max(1000)
				.optional()
				.describe("Cantidad de líneas a devolver. Default 50."),
		},
		handler: async ({
			index,
			hostname,
			level,
			text,
			from,
			to,
			last,
			size,
		}: {
			index: string;
			hostname?: string;
			level?: string;
			text?: string;
			from?: string;
			to?: string;
			last?: string;
			size?: number;
		}) => {
			const must: Record<string, unknown>[] = [];
			const filter: Record<string, unknown>[] = [];

			if (hostname) {
				filter.push({ wildcard: { "hostname.keyword": hostname } });
			}

			if (level) {
				// level puede ser "error" o "Error" según el servicio → cubrir ambos
				const lower = level.toLowerCase();
				const cap = lower.charAt(0).toUpperCase() + lower.slice(1);
				filter.push({
					terms: { "level.keyword": [...new Set([lower, cap, level])] },
				});
			}

			if (text) {
				must.push({
					bool: {
						should: [
							{ match_phrase: { msg: text } },
							{ match_phrase: { message: text } },
						],
						minimum_should_match: 1,
					},
				});
			}

			const range: Record<string, string> = {};
			if (last) range.gte = `now-${last}`;
			if (from) range.gte = from;
			if (to) range.lte = to;
			if (Object.keys(range).length) {
				filter.push({ range: { "@timestamp": range } });
			}

			const body = {
				size: size ?? 50,
				sort: [{ "@timestamp": "desc" }],
				query: { bool: { must, filter } },
				_source: LOG_SOURCE,
			};

			const raw = await esRequest(
				"POST",
				`/${encodeURIComponent(index)}/_search`,
				body,
			);
			const result = projectLogs(raw);
			await emit("elastic.logs.extracted", {
				index,
				count: result.count,
				level,
				hostname,
			});
			return ok(result);
		},
	},
	{
		name: "elastic_trace",
		description:
			"Correlaciona todas las líneas de log de una misma transacción por su traceId (term sobre traceId.keyword), ordenadas por @timestamp ASC (flujo cronológico) y proyectadas de forma compacta. Úsala tras encontrar un error con elastic_logs para ver la traza completa.",
		inputSchema: {
			index: z
				.string()
				.describe(
					"Índice o patrón a consultar, ej 'log-*-qa' (nombre del datastream, no los '.ds-...' ocultos).",
				),
			traceId: z
				.string()
				.describe("Valor exacto del traceId a correlacionar."),
			size: z
				.number()
				.int()
				.min(1)
				.max(1000)
				.optional()
				.describe("Máximo de líneas a devolver. Default 200."),
		},
		handler: async ({
			index,
			traceId,
			size,
		}: {
			index: string;
			traceId: string;
			size?: number;
		}) => {
			const body = {
				size: size ?? 200,
				sort: [{ "@timestamp": "asc" }],
				query: { term: { "traceId.keyword": traceId } },
				_source: LOG_SOURCE,
			};
			const raw = await esRequest(
				"POST",
				`/${encodeURIComponent(index)}/_search`,
				body,
			);
			return ok(projectLogs(raw));
		},
	},
	{
		name: "elastic_search",
		description:
			"Ejecuta una búsqueda en Elasticsearch usando Query DSL: filtrar, ordenar y paginar documentos. Devuelve los hits crudos. Para extracción de logs prefiere elastic_logs (salida compacta).",
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
				.describe("Ordenamiento, ej [{ '@timestamp': 'desc' }]. Opcional."),
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

			const data = await esRequest(
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
				.describe(
					"Query DSL opcional (el contenido de 'query'). Default match_all.",
				),
		},
		handler: async ({
			index,
			query,
		}: {
			index: string;
			query?: Record<string, unknown>;
		}) => {
			const body = query ? { query } : undefined;
			const data = await esRequest(
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
			"Ejecuta una agregación de Elasticsearch (aggs) sin traer documentos. Útil para top-N, histogramas de fechas, métricas (avg/sum/min/max), cardinalidad, etc. Las agregaciones por término deben usar el subcampo '.keyword' (ej 'hostname.keyword').",
		inputSchema: {
			index: z.string().describe("Índice o patrón, ej 'logs-*'."),
			aggs: z
				.record(z.any())
				.describe(
					"Objeto de agregaciones (el contenido de 'aggs'), ej { por_host: { terms: { field: 'hostname.keyword' } } }.",
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
			const data = await esRequest(
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
			const data = await esRequest(
				"GET",
				`/${encodeURIComponent(index)}/_doc/${encodeURIComponent(id)}`,
			);
			return ok(data);
		},
	},
	{
		name: "elastic_sql_query",
		description:
			'Ejecuta una consulta SQL de Elasticsearch (_sql). Forma sencilla de consultar datos sin escribir Query DSL. Ej: SELECT * FROM "logs-*" WHERE status = \'error\' LIMIT 10.',
		inputSchema: {
			query: z
				.string()
				.describe(
					"Sentencia SQL de Elasticsearch. Usa comillas dobles para nombres de índice con guiones o comodines.",
				),
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
			const data = await esRequest("POST", "/_sql?format=json", {
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
			const data = await esRequest("GET", "/_cluster/health");
			return ok(data);
		},
	},
	{
		name: "elastic_cat_aliases",
		description:
			"Lista los alias de índices definidos en el cluster (vía _cat/aliases).",
		inputSchema: {},
		handler: async () => {
			const data = await esRequest("GET", "/_cat/aliases?format=json");
			return ok(data);
		},
	},
	{
		name: "elastic_raw_request",
		description:
			"Escotilla de escape: ejecuta una petición arbitraria directamente contra cualquier API de Elasticsearch. Úsalo solo cuando ninguna tool específica cubre el caso.",
		inputSchema: {
			method: z
				.enum(["GET", "POST", "PUT", "DELETE"])
				.describe("Método HTTP."),
			path: z
				.string()
				.describe(
					"Ruta de la API de Elasticsearch, ej '/_cat/nodes?format=json'.",
				),
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
			const data = await esRequest(method, path, body);
			return ok(data);
		},
	},
];
