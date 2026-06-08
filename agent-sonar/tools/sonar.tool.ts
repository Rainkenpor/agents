// ─── Tools de SonarQube ───────────────────────────────────────────────────────
//
// Gestión de proyectos y consulta de métricas/issues sobre una instancia de
// SonarQube (https://sup.gdsas.com). Usa el cliente en util/sonar.ts.

import z from "zod";
import { ok } from "../types";
import type { ToolDefinition } from "../types";
import { sonarGet, sonarPost } from "../util/sonar";
import { emit } from "../hooks";

// Métricas más usadas en SonarQube; sirven como default sensato
const DEFAULT_METRICS = [
	"alert_status",
	"bugs",
	"vulnerabilities",
	"code_smells",
	"coverage",
	"duplicated_lines_density",
	"ncloc",
	"reliability_rating",
	"security_rating",
	"sqale_rating",
].join(",");

export const sonarTools: ToolDefinition[] = [
	{
		name: "sonar_list_projects",
		description:
			"Lista los proyectos de SonarQube. Permite buscar por nombre o clave y paginar los resultados.",
		inputSchema: {
			query: z
				.string()
				.optional()
				.describe("Texto para filtrar proyectos por nombre o clave"),
			page: z
				.number()
				.int()
				.positive()
				.optional()
				.describe("Número de página (default 1)"),
			pageSize: z
				.number()
				.int()
				.positive()
				.max(500)
				.optional()
				.describe("Cantidad de proyectos por página (default 100, máx 500)"),
		},
		handler: async ({
			query,
			page,
			pageSize,
		}: {
			query?: string;
			page?: number;
			pageSize?: number;
		}) => {
			const data = await sonarGet("/projects/search", {
				q: query,
				p: page,
				ps: pageSize ?? 100,
			});
			return ok(data);
		},
	},
	{
		name: "sonar_create_project",
		description:
			"Crea un nuevo proyecto en SonarQube. Requiere un nombre y una clave única (project key).",
		inputSchema: {
			name: z.string().describe("Nombre visible del proyecto"),
			projectKey: z
				.string()
				.describe(
					"Clave única del proyecto (ej: 'mi-app-backend'). Solo letras, dígitos, '-', '_', '.' y ':'",
				),
			mainBranch: z
				.string()
				.optional()
				.describe("Nombre de la rama principal (ej: 'main'). Opcional"),
			visibility: z
				.enum(["public", "private"])
				.optional()
				.describe("Visibilidad del proyecto. Opcional"),
		},
		handler: async ({
			name,
			projectKey,
			mainBranch,
			visibility,
		}: {
			name: string;
			projectKey: string;
			mainBranch?: string;
			visibility?: "public" | "private";
		}) => {
			const data = await sonarPost("/projects/create", {
				name,
				project: projectKey,
				mainBranch,
				visibility,
			});
			await emit("project.created", { projectKey, name, visibility });
			return ok(data);
		},
	},
	{
		name: "sonar_delete_project",
		description:
			"Elimina un proyecto de SonarQube por su clave. Operación irreversible.",
		inputSchema: {
			projectKey: z.string().describe("Clave del proyecto a eliminar"),
		},
		handler: async ({ projectKey }: { projectKey: string }) => {
			await sonarPost("/projects/delete", { project: projectKey });
			await emit("project.deleted", { projectKey });
			return ok({ deleted: true, projectKey });
		},
	},
	{
		name: "sonar_get_component",
		description:
			"Obtiene los detalles de un componente (proyecto, directorio o archivo) por su clave.",
		inputSchema: {
			componentKey: z
				.string()
				.describe("Clave del componente (ej: la clave del proyecto)"),
			branch: z.string().optional().describe("Rama a consultar. Opcional"),
		},
		handler: async ({
			componentKey,
			branch,
		}: {
			componentKey: string;
			branch?: string;
		}) => {
			const data = await sonarGet("/components/show", {
				component: componentKey,
				branch,
			});
			return ok(data);
		},
	},
	{
		name: "sonar_get_measures",
		description:
			"Obtiene métricas de calidad de un proyecto/componente: bugs, vulnerabilidades, code smells, cobertura, duplicación, ratings, etc.",
		inputSchema: {
			componentKey: z
				.string()
				.describe("Clave del proyecto o componente a medir"),
			metrics: z
				.string()
				.optional()
				.describe(
					`Lista de métricas separadas por coma. Default: ${DEFAULT_METRICS}`,
				),
			branch: z.string().optional().describe("Rama a consultar. Opcional"),
		},
		handler: async ({
			componentKey,
			metrics,
			branch,
		}: {
			componentKey: string;
			metrics?: string;
			branch?: string;
		}) => {
			const data = await sonarGet("/measures/component", {
				component: componentKey,
				metricKeys: metrics ?? DEFAULT_METRICS,
				branch,
			});
			return ok(data);
		},
	},
	{
		name: "sonar_get_quality_gate_status",
		description:
			"Obtiene el estado de la Quality Gate de un proyecto (OK / ERROR) junto con las condiciones evaluadas.",
		inputSchema: {
			projectKey: z.string().describe("Clave del proyecto"),
			branch: z.string().optional().describe("Rama a consultar. Opcional"),
		},
		handler: async ({
			projectKey,
			branch,
		}: {
			projectKey: string;
			branch?: string;
		}) => {
			const data = await sonarGet("/qualitygates/project_status", {
				projectKey,
				branch,
			});
			return ok(data);
		},
	},
	{
		name: "sonar_search_issues",
		description:
			"Busca issues (bugs, vulnerabilidades, code smells) de uno o varios proyectos, con filtros por severidad, tipo y estado.",
		inputSchema: {
			projectKeys: z
				.string()
				.optional()
				.describe("Claves de proyecto separadas por coma"),
			severities: z
				.string()
				.optional()
				.describe(
					"Severidades separadas por coma: INFO, MINOR, MAJOR, CRITICAL, BLOCKER",
				),
			types: z
				.string()
				.optional()
				.describe("Tipos separados por coma: BUG, VULNERABILITY, CODE_SMELL"),
			statuses: z
				.string()
				.optional()
				.describe(
					"Estados separados por coma: OPEN, CONFIRMED, REOPENED, RESOLVED, CLOSED",
				),
			page: z
				.number()
				.int()
				.positive()
				.optional()
				.describe("Número de página (default 1)"),
			pageSize: z
				.number()
				.int()
				.positive()
				.max(500)
				.optional()
				.describe("Issues por página (default 100, máx 500)"),
		},
		handler: async ({
			projectKeys,
			severities,
			types,
			statuses,
			page,
			pageSize,
		}: {
			projectKeys?: string;
			severities?: string;
			types?: string;
			statuses?: string;
			page?: number;
			pageSize?: number;
		}) => {
			const data = await sonarGet("/issues/search", {
				componentKeys: projectKeys,
				severities,
				types,
				statuses,
				p: page,
				ps: pageSize ?? 100,
			});
			return ok(data);
		},
	},
];
