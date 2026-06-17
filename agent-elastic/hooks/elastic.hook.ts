import z from "zod";
import type { HookDefinition } from "../types";

export const elasticHooks: HookDefinition[] = [
	{
		name: "elastic.search.executed",
		description:
			"Se dispara después de ejecutar una búsqueda (elastic_search) contra Elasticsearch",
		payloadSchema: {
			index: z.string().describe("Índice o patrón consultado"),
			size: z.number().describe("Cantidad de documentos solicitados"),
			hasQuery: z
				.boolean()
				.describe("Indica si se envió una query DSL (false = match_all)"),
		},
	},
	{
		name: "elastic.logs.extracted",
		description:
			"Se dispara tras extraer logs compactos con elastic_logs",
		payloadSchema: {
			index: z.string().describe("Índice o patrón consultado"),
			count: z.number().describe("Cantidad de líneas devueltas"),
			level: z.string().optional().describe("Filtro de nivel aplicado"),
			hostname: z
				.string()
				.optional()
				.describe("Filtro de hostname aplicado"),
		},
	},
];
