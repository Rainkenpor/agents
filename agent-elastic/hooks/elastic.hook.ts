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
];
