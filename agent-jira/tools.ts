import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type AtlassianHelpers, adf, ok } from "./types.ts";

export function registerTools(s: McpServer, h: AtlassianHelpers): void {
	const {
		jiraUrl,
		agileUrl,
		cfluUrl,
		rawUrl,
		apiGet,
		apiPost,
		apiPut,
		apiDelete,
		authHeaders,
	} = h;

	// ══════════════════════════════════════════════════════════════════════════
	// JIRA – ISSUES
	// ══════════════════════════════════════════════════════════════════════════

	s.tool(
		"jira_get_issue",
		"Obtiene los detalles completos de un issue de Jira",
		{
			issue_key: z.string().describe("Clave del issue, ej. PROJ-123"),
			fields: z
				.string()
				.optional()
				.describe("Campos separados por coma (vacío = todos)"),
			expand: z
				.string()
				.optional()
				.describe("Expansiones, ej. renderedFields,changelog"),
		},
		async ({ issue_key, fields, expand }) =>
			ok(await apiGet(jiraUrl(`issue/${issue_key}`), { fields, expand })),
	);

	s.tool(
		"jira_search_issues",
		"Busca issues usando JQL (Jira Query Language)",
		{
			jql: z.string().describe("Consulta JQL"),
			max_results: z.number().int().default(50),
			start_at: z.number().int().default(0),
			fields: z.string().optional().describe("Campos separados por coma"),
		},
		async ({ jql, max_results, start_at, fields }) => {
			const payload: Record<string, unknown> = {
				jql,
				maxResults: max_results,
				startAt: start_at,
			};
			if (fields) payload.fields = fields.split(",").map((f) => f.trim());
			return ok(await apiPost(jiraUrl("search"), payload));
		},
	);

	s.tool(
		"jira_create_issue",
		"Crea un nuevo issue en Jira",
		{
			project_key: z.string().describe("Clave del proyecto, ej. PROJ"),
			summary: z.string(),
			issue_type: z.string().default("Task"),
			description: z.string().optional(),
			assignee_account_id: z.string().optional(),
			priority: z
				.string()
				.optional()
				.describe("Highest, High, Medium, Low, Lowest"),
			labels: z.string().optional().describe("Separadas por coma"),
			parent_key: z.string().optional().describe("Issue padre para sub-tasks"),
			story_points: z.number().optional(),
			components: z.string().optional().describe("Separados por coma"),
			fix_versions: z.string().optional().describe("Separadas por coma"),
			due_date: z.string().optional().describe("YYYY-MM-DD"),
		},
		async (args) => {
			const fields: Record<string, unknown> = {
				project: { key: args.project_key },
				summary: args.summary,
				issuetype: { name: args.issue_type },
			};
			if (args.description) fields.description = adf(args.description);
			if (args.assignee_account_id)
				fields.assignee = { accountId: args.assignee_account_id };
			if (args.priority) fields.priority = { name: args.priority };
			if (args.labels)
				fields.labels = args.labels.split(",").map((l) => l.trim());
			if (args.parent_key) fields.parent = { key: args.parent_key };
			if (args.story_points != null) {
				fields.story_points = args.story_points;
				fields.customfield_10016 = args.story_points;
			}
			if (args.components)
				fields.components = args.components
					.split(",")
					.map((c) => ({ name: c.trim() }));
			if (args.fix_versions)
				fields.fixVersions = args.fix_versions
					.split(",")
					.map((v) => ({ name: v.trim() }));
			if (args.due_date) fields.duedate = args.due_date;
			return ok(await apiPost(jiraUrl("issue"), { fields }));
		},
	);

	s.tool(
		"jira_update_issue",
		"Actualiza campos de un issue existente",
		{
			issue_key: z.string(),
			summary: z.string().optional(),
			description: z.string().optional(),
			assignee_account_id: z.string().optional(),
			priority: z.string().optional(),
			labels: z.string().optional(),
			story_points: z.number().optional(),
			due_date: z.string().optional(),
			fix_versions: z.string().optional(),
			components: z.string().optional(),
		},
		async (args) => {
			const fields: Record<string, unknown> = {};
			if (args.summary) fields.summary = args.summary;
			if (args.description) fields.description = adf(args.description);
			if (args.assignee_account_id !== undefined)
				fields.assignee = args.assignee_account_id
					? { accountId: args.assignee_account_id }
					: null;
			if (args.priority) fields.priority = { name: args.priority };
			if (args.labels != null)
				fields.labels = args.labels.split(",").map((l) => l.trim());
			if (args.story_points != null)
				fields.customfield_10016 = args.story_points;
			if (args.due_date) fields.duedate = args.due_date;
			if (args.fix_versions)
				fields.fixVersions = args.fix_versions
					.split(",")
					.map((v) => ({ name: v.trim() }));
			if (args.components)
				fields.components = args.components
					.split(",")
					.map((c) => ({ name: c.trim() }));
			await apiPut(jiraUrl(`issue/${args.issue_key}`), { fields });
			return ok({ status: "actualizado", issue: args.issue_key });
		},
	);

	s.tool(
		"jira_delete_issue",
		"Elimina un issue de Jira",
		{
			issue_key: z.string(),
			delete_subtasks: z.boolean().default(true),
		},
		async ({ issue_key, delete_subtasks }) =>
			ok(
				await apiDelete(jiraUrl(`issue/${issue_key}`), {
					deleteSubtasks: String(delete_subtasks),
				}),
			),
	);

	s.tool(
		"jira_assign_issue",
		"Asigna o desasigna un issue",
		{
			issue_key: z.string(),
			account_id: z
				.string()
				.nullable()
				.optional()
				.describe("null para desasignar"),
		},
		async ({ issue_key, account_id }) => {
			await apiPut(jiraUrl(`issue/${issue_key}/assignee`), {
				accountId: account_id ?? null,
			});
			return ok({ status: "asignado", issue: issue_key, account_id });
		},
	);

	s.tool(
		"jira_get_issue_changelog",
		"Obtiene el historial de cambios de un issue",
		{
			issue_key: z.string(),
			max_results: z.number().int().default(50),
			start_at: z.number().int().default(0),
		},
		async ({ issue_key, max_results, start_at }) =>
			ok(
				await apiGet(jiraUrl(`issue/${issue_key}/changelog`), {
					maxResults: max_results,
					startAt: start_at,
				}),
			),
	);

	// ══════════════════════════════════════════════════════════════════════════
	// JIRA – COMENTARIOS
	// ══════════════════════════════════════════════════════════════════════════

	s.tool(
		"jira_get_comments",
		"Lista los comentarios de un issue",
		{
			issue_key: z.string(),
			max_results: z.number().int().default(50),
			start_at: z.number().int().default(0),
		},
		async ({ issue_key, max_results, start_at }) =>
			ok(
				await apiGet(jiraUrl(`issue/${issue_key}/comment`), {
					maxResults: max_results,
					startAt: start_at,
				}),
			),
	);

	s.tool(
		"jira_add_comment",
		"Añade un comentario a un issue",
		{
			issue_key: z.string(),
			body: z.string(),
			visibility_role: z
				.string()
				.optional()
				.describe("Rol que puede ver el comentario"),
		},
		async ({ issue_key, body, visibility_role }) => {
			const payload: Record<string, unknown> = { body: adf(body) };
			if (visibility_role)
				payload.visibility = { type: "role", value: visibility_role };
			return ok(await apiPost(jiraUrl(`issue/${issue_key}/comment`), payload));
		},
	);

	s.tool(
		"jira_update_comment",
		"Actualiza el texto de un comentario existente",
		{
			issue_key: z.string(),
			comment_id: z.string(),
			body: z.string(),
		},
		async ({ issue_key, comment_id, body }) =>
			ok(
				await apiPut(jiraUrl(`issue/${issue_key}/comment/${comment_id}`), {
					body: adf(body),
				}),
			),
	);

	s.tool(
		"jira_delete_comment",
		"Elimina un comentario de un issue",
		{ issue_key: z.string(), comment_id: z.string() },
		async ({ issue_key, comment_id }) =>
			ok(await apiDelete(jiraUrl(`issue/${issue_key}/comment/${comment_id}`))),
	);

	// ══════════════════════════════════════════════════════════════════════════
	// JIRA – TRANSICIONES
	// ══════════════════════════════════════════════════════════════════════════

	s.tool(
		"jira_get_transitions",
		"Lista las transiciones disponibles para un issue",
		{ issue_key: z.string() },
		async ({ issue_key }) =>
			ok(await apiGet(jiraUrl(`issue/${issue_key}/transitions`))),
	);

	s.tool(
		"jira_transition_issue",
		"Cambia el estado de un issue aplicando una transición",
		{
			issue_key: z.string(),
			transition_id: z.string().describe("Obtener con jira_get_transitions"),
			comment: z.string().optional(),
			resolution: z.string().optional().describe("Done, Won't Do, Duplicate…"),
		},
		async ({ issue_key, transition_id, comment, resolution }) => {
			const payload: Record<string, unknown> = {
				transition: { id: transition_id },
			};
			if (comment)
				payload.update = { comment: [{ add: { body: adf(comment) } }] };
			if (resolution) {
				if (!payload.fields) payload.fields = {};
				(payload.fields as Record<string, unknown>).resolution = {
					name: resolution,
				};
			}
			const r = await fetch(jiraUrl(`issue/${issue_key}/transitions`), {
				method: "POST",
				headers: authHeaders(),
				body: JSON.stringify(payload),
			});
			if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
			return ok({ status: "transicionado", issue: issue_key, transition_id });
		},
	);

	// ══════════════════════════════════════════════════════════════════════════
	// JIRA – WORKLOGS
	// ══════════════════════════════════════════════════════════════════════════

	s.tool(
		"jira_get_worklogs",
		"Lista los worklogs (tiempo registrado) de un issue",
		{ issue_key: z.string() },
		async ({ issue_key }) =>
			ok(await apiGet(jiraUrl(`issue/${issue_key}/worklog`))),
	);

	s.tool(
		"jira_add_worklog",
		"Registra tiempo trabajado en un issue",
		{
			issue_key: z.string(),
			time_spent: z.string().describe("Formato Jira: 2h 30m, 1d"),
			comment: z.string().optional(),
			started: z
				.string()
				.optional()
				.describe("ISO 8601, ej. 2024-01-15T10:00:00.000+0000"),
			adjust_estimate: z
				.string()
				.default("auto")
				.describe("auto, leave, manual, new"),
		},
		async ({ issue_key, time_spent, comment, started, adjust_estimate }) => {
			const payload: Record<string, unknown> = { timeSpent: time_spent };
			if (comment) payload.comment = adf(comment);
			if (started) payload.started = started;
			const url = `${jiraUrl(`issue/${issue_key}/worklog`)}?adjustEstimate=${adjust_estimate}`;
			return ok(await apiPost(url, payload));
		},
	);

	// ══════════════════════════════════════════════════════════════════════════
	// JIRA – PROYECTOS
	// ══════════════════════════════════════════════════════════════════════════

	s.tool(
		"jira_list_projects",
		"Lista todos los proyectos accesibles",
		{
			query: z.string().optional().describe("Filtrar por nombre o clave"),
			max_results: z.number().int().default(50),
			start_at: z.number().int().default(0),
			order_by: z.string().default("name"),
			expand: z.string().optional(),
		},
		async ({ query, max_results, start_at, order_by, expand }) =>
			ok(
				await apiGet(jiraUrl("project/search"), {
					query,
					maxResults: max_results,
					startAt: start_at,
					orderBy: order_by,
					expand,
				}),
			),
	);

	s.tool(
		"jira_get_project",
		"Obtiene los detalles de un proyecto",
		{ project_key: z.string(), expand: z.string().optional() },
		async ({ project_key, expand }) =>
			ok(await apiGet(jiraUrl(`project/${project_key}`), { expand })),
	);

	s.tool(
		"jira_create_project",
		"Crea un nuevo proyecto en Jira",
		{
			key: z.string().describe("Máx 10 caracteres mayúsculas"),
			name: z.string(),
			project_type: z
				.string()
				.default("software")
				.describe("software, business, service_desk"),
			description: z.string().optional(),
			lead_account_id: z.string().optional(),
			assignee_type: z
				.string()
				.default("UNASSIGNED")
				.describe("UNASSIGNED o PROJECT_LEAD"),
			template_key: z.string().optional(),
		},
		async ({
			key,
			name,
			project_type,
			description,
			lead_account_id,
			assignee_type,
			template_key,
		}) => {
			const payload: Record<string, unknown> = {
				key: key.toUpperCase(),
				name,
				projectTypeKey: project_type,
				assigneeType: assignee_type,
			};
			if (description) payload.description = description;
			if (lead_account_id) payload.leadAccountId = lead_account_id;
			if (template_key) payload.projectTemplateKey = template_key;
			return ok(await apiPost(jiraUrl("project"), payload));
		},
	);

	s.tool(
		"jira_get_project_components",
		"Lista los componentes de un proyecto",
		{ project_key: z.string() },
		async ({ project_key }) =>
			ok(await apiGet(jiraUrl(`project/${project_key}/components`))),
	);

	s.tool(
		"jira_get_project_versions",
		"Lista las versiones de un proyecto",
		{ project_key: z.string() },
		async ({ project_key }) =>
			ok(await apiGet(jiraUrl(`project/${project_key}/versions`))),
	);

	s.tool(
		"jira_create_version",
		"Crea una versión en un proyecto",
		{
			project_key: z.string(),
			name: z.string(),
			description: z.string().optional(),
			release_date: z.string().optional().describe("YYYY-MM-DD"),
			start_date: z.string().optional().describe("YYYY-MM-DD"),
			released: z.boolean().default(false),
		},
		async ({
			project_key,
			name,
			description,
			release_date,
			start_date,
			released,
		}) => {
			const payload: Record<string, unknown> = {
				project: project_key,
				name,
				released,
			};
			if (description) payload.description = description;
			if (release_date) payload.releaseDate = release_date;
			if (start_date) payload.startDate = start_date;
			return ok(await apiPost(jiraUrl("version"), payload));
		},
	);

	// ══════════════════════════════════════════════════════════════════════════
	// JIRA – LINKS ENTRE ISSUES
	// ══════════════════════════════════════════════════════════════════════════

	s.tool(
		"jira_get_link_types",
		"Lista los tipos de link disponibles en Jira",
		{},
		async () => ok(await apiGet(jiraUrl("issueLinkType"))),
	);

	s.tool(
		"jira_create_issue_link",
		"Crea un link entre dos issues",
		{
			link_type: z.string().describe("Blocks, Clones, Duplicates, Relates…"),
			inward_issue_key: z.string(),
			outward_issue_key: z.string(),
			comment: z.string().optional(),
		},
		async ({ link_type, inward_issue_key, outward_issue_key, comment }) => {
			const payload: Record<string, unknown> = {
				type: { name: link_type },
				inwardIssue: { key: inward_issue_key },
				outwardIssue: { key: outward_issue_key },
			};
			if (comment) payload.comment = { body: adf(comment) };
			const r = await fetch(jiraUrl("issueLink"), {
				method: "POST",
				headers: authHeaders(),
				body: JSON.stringify(payload),
			});
			if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
			return ok({
				status: "link_creado",
				tipo: link_type,
				de: inward_issue_key,
				a: outward_issue_key,
			});
		},
	);

	s.tool(
		"jira_delete_issue_link",
		"Elimina un link entre issues",
		{ link_id: z.string() },
		async ({ link_id }) => ok(await apiDelete(jiraUrl(`issueLink/${link_id}`))),
	);

	// ══════════════════════════════════════════════════════════════════════════
	// JIRA – USUARIOS
	// ══════════════════════════════════════════════════════════════════════════

	s.tool(
		"jira_get_current_user",
		"Obtiene la información del usuario autenticado",
		{},
		async () => ok(await apiGet(jiraUrl("myself"))),
	);

	s.tool(
		"jira_get_user",
		"Obtiene la información de un usuario por su account ID",
		{ account_id: z.string() },
		async ({ account_id }) =>
			ok(await apiGet(jiraUrl("user"), { accountId: account_id })),
	);

	s.tool(
		"jira_search_users",
		"Busca usuarios en Atlassian por nombre o email",
		{ query: z.string(), max_results: z.number().int().default(20) },
		async ({ query, max_results }) =>
			ok(
				await apiGet(jiraUrl("user/search"), {
					query,
					maxResults: max_results,
				}),
			),
	);

	s.tool(
		"jira_get_assignable_users",
		"Lista usuarios asignables en un proyecto o issue",
		{
			project_key: z.string(),
			issue_key: z.string().optional(),
			query: z.string().optional(),
			max_results: z.number().int().default(50),
		},
		async ({ project_key, issue_key, query, max_results }) => {
			const params: Record<string, unknown> = {
				project: project_key,
				maxResults: max_results,
			};
			if (issue_key) params.issueKey = issue_key;
			if (query) params.query = query;
			return ok(await apiGet(jiraUrl("user/assignable/search"), params));
		},
	);

	// ══════════════════════════════════════════════════════════════════════════
	// JIRA – METADATOS
	// ══════════════════════════════════════════════════════════════════════════

	s.tool(
		"jira_get_issue_types",
		"Lista los tipos de issue disponibles",
		{ project_key: z.string().optional() },
		async ({ project_key }) => {
			if (project_key)
				return ok(await apiGet(jiraUrl(`project/${project_key}/statuses`)));
			return ok(await apiGet(jiraUrl("issuetype")));
		},
	);

	s.tool(
		"jira_get_priorities",
		"Lista las prioridades disponibles en Jira",
		{},
		async () => ok(await apiGet(jiraUrl("priority"))),
	);

	s.tool(
		"jira_get_statuses",
		"Lista los estados disponibles",
		{ project_key: z.string().optional() },
		async ({ project_key }) => {
			if (project_key)
				return ok(await apiGet(jiraUrl(`project/${project_key}/statuses`)));
			return ok(await apiGet(jiraUrl("status")));
		},
	);

	s.tool(
		"jira_get_fields",
		"Lista todos los campos de Jira incluyendo custom fields",
		{},
		async () => ok(await apiGet(jiraUrl("field"))),
	);

	s.tool(
		"jira_get_project_metadata",
		"Obtiene metadatos de creación de issues para un proyecto",
		{ project_key: z.string(), issue_type_id: z.string().optional() },
		async ({ project_key, issue_type_id }) => {
			const params: Record<string, unknown> = {
				projectKeys: project_key,
				expand: "projects.issuetypes.fields",
			};
			if (issue_type_id) params.issuetypeIds = issue_type_id;
			return ok(await apiGet(jiraUrl("issue/createmeta"), params));
		},
	);

	s.tool(
		"jira_get_attachments",
		"Lista los adjuntos de un issue",
		{ issue_key: z.string() },
		async ({ issue_key }) => {
			const issue = await apiGet(jiraUrl(`issue/${issue_key}`), {
				fields: "attachment",
			});
			return ok(
				(issue as { fields?: { attachment?: unknown } }).fields?.attachment ??
					[],
			);
		},
	);

	// ══════════════════════════════════════════════════════════════════════════
	// JIRA – BOARDS Y SPRINTS (Agile API)
	// ══════════════════════════════════════════════════════════════════════════

	s.tool(
		"jira_list_boards",
		"Lista boards de Jira Agile",
		{
			project_key_or_id: z.string().optional(),
			board_type: z.string().optional().describe("scrum, kanban, simple"),
			name: z.string().optional(),
			max_results: z.number().int().default(50),
			start_at: z.number().int().default(0),
		},
		async ({ project_key_or_id, board_type, name, max_results, start_at }) =>
			ok(
				await apiGet(agileUrl("board"), {
					projectKeyOrId: project_key_or_id,
					type: board_type,
					name,
					maxResults: max_results,
					startAt: start_at,
				}),
			),
	);

	s.tool(
		"jira_get_board",
		"Obtiene los detalles de un board específico",
		{ board_id: z.number().int() },
		async ({ board_id }) => ok(await apiGet(agileUrl(`board/${board_id}`))),
	);

	s.tool(
		"jira_list_sprints",
		"Lista los sprints de un board",
		{
			board_id: z.number().int(),
			state: z.string().optional().describe("active, closed, future"),
			max_results: z.number().int().default(50),
			start_at: z.number().int().default(0),
		},
		async ({ board_id, state, max_results, start_at }) =>
			ok(
				await apiGet(agileUrl(`board/${board_id}/sprint`), {
					state,
					maxResults: max_results,
					startAt: start_at,
				}),
			),
	);

	s.tool(
		"jira_get_sprint",
		"Obtiene los detalles de un sprint",
		{ sprint_id: z.number().int() },
		async ({ sprint_id }) => ok(await apiGet(agileUrl(`sprint/${sprint_id}`))),
	);

	s.tool(
		"jira_get_sprint_issues",
		"Lista los issues de un sprint",
		{
			sprint_id: z.number().int(),
			jql: z.string().optional(),
			max_results: z.number().int().default(50),
			start_at: z.number().int().default(0),
		},
		async ({ sprint_id, jql, max_results, start_at }) =>
			ok(
				await apiGet(agileUrl(`sprint/${sprint_id}/issue`), {
					jql,
					maxResults: max_results,
					startAt: start_at,
				}),
			),
	);

	s.tool(
		"jira_create_sprint",
		"Crea un nuevo sprint en un board",
		{
			board_id: z.number().int(),
			name: z.string(),
			goal: z.string().optional(),
			start_date: z.string().optional().describe("ISO 8601"),
			end_date: z.string().optional().describe("ISO 8601"),
		},
		async ({ board_id, name, goal, start_date, end_date }) => {
			const payload: Record<string, unknown> = {
				originBoardId: board_id,
				name,
			};
			if (goal) payload.goal = goal;
			if (start_date) payload.startDate = start_date;
			if (end_date) payload.endDate = end_date;
			return ok(await apiPost(agileUrl("sprint"), payload));
		},
	);

	s.tool(
		"jira_update_sprint",
		"Actualiza un sprint (nombre, estado, fechas, objetivo)",
		{
			sprint_id: z.number().int(),
			name: z.string().optional(),
			state: z.string().optional().describe("active, closed, future"),
			goal: z.string().optional(),
			start_date: z.string().optional(),
			end_date: z.string().optional(),
		},
		async ({ sprint_id, name, state, goal, start_date, end_date }) => {
			const payload: Record<string, unknown> = {};
			if (name != null) payload.name = name;
			if (state != null) payload.state = state;
			if (goal != null) payload.goal = goal;
			if (start_date != null) payload.startDate = start_date;
			if (end_date != null) payload.endDate = end_date;
			return ok(await apiPut(agileUrl(`sprint/${sprint_id}`), payload));
		},
	);

	s.tool(
		"jira_move_issues_to_sprint",
		"Mueve issues a un sprint",
		{
			sprint_id: z.number().int(),
			issue_keys: z
				.string()
				.describe("Claves separadas por coma, ej. PROJ-1,PROJ-2"),
		},
		async ({ sprint_id, issue_keys }) => {
			const keys = issue_keys.split(",").map((k) => k.trim());
			const r = await fetch(agileUrl(`sprint/${sprint_id}/issue`), {
				method: "POST",
				headers: authHeaders(),
				body: JSON.stringify({ issues: keys }),
			});
			if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
			return ok({ status: "movidos", sprint: sprint_id, issues: keys });
		},
	);

	s.tool(
		"jira_get_board_backlog",
		"Obtiene los issues del backlog de un board",
		{
			board_id: z.number().int(),
			jql: z.string().optional(),
			max_results: z.number().int().default(50),
			start_at: z.number().int().default(0),
		},
		async ({ board_id, jql, max_results, start_at }) =>
			ok(
				await apiGet(agileUrl(`board/${board_id}/backlog`), {
					jql,
					maxResults: max_results,
					startAt: start_at,
				}),
			),
	);

	// ══════════════════════════════════════════════════════════════════════════
	// JIRA – EPICS
	// ══════════════════════════════════════════════════════════════════════════

	s.tool(
		"jira_get_epic",
		"Obtiene los detalles de un epic",
		{ epic_id_or_key: z.string() },
		async ({ epic_id_or_key }) =>
			ok(await apiGet(agileUrl(`epic/${epic_id_or_key}`))),
	);

	s.tool(
		"jira_get_epic_issues",
		"Lista los issues de un epic",
		{
			epic_id_or_key: z.string(),
			jql: z.string().optional(),
			max_results: z.number().int().default(50),
			start_at: z.number().int().default(0),
		},
		async ({ epic_id_or_key, jql, max_results, start_at }) =>
			ok(
				await apiGet(agileUrl(`epic/${epic_id_or_key}/issue`), {
					jql,
					maxResults: max_results,
					startAt: start_at,
				}),
			),
	);

	// ══════════════════════════════════════════════════════════════════════════
	// CONFLUENCE – SPACES
	// ══════════════════════════════════════════════════════════════════════════

	s.tool(
		"confluence_list_spaces",
		"Lista los espacios de Confluence",
		{
			query: z.string().optional().describe("Filtrar por nombre"),
			space_type: z.string().optional().describe("global o personal"),
			limit: z.number().int().default(25),
			start: z.number().int().default(0),
			expand: z.string().optional(),
		},
		async ({ query, space_type, limit, start, expand }) =>
			ok(
				await apiGet(cfluUrl("space"), {
					spaceKey: query,
					type: space_type,
					limit,
					start,
					expand,
				}),
			),
	);

	s.tool(
		"confluence_get_space",
		"Obtiene los detalles de un espacio de Confluence",
		{ space_key: z.string(), expand: z.string().optional() },
		async ({ space_key, expand }) =>
			ok(await apiGet(cfluUrl(`space/${space_key}`), { expand })),
	);

	s.tool(
		"confluence_create_space",
		"Crea un nuevo espacio en Confluence",
		{
			key: z.string().describe("Mayúsculas, sin espacios"),
			name: z.string(),
			description: z.string().optional(),
			is_private: z.boolean().default(false),
		},
		async ({ key, name, description, is_private }) => {
			const payload: Record<string, unknown> = {
				key: key.toUpperCase(),
				name,
				type: is_private ? "personal" : "global",
			};
			if (description)
				payload.description = {
					plain: { value: description, representation: "plain" },
				};
			return ok(await apiPost(cfluUrl("space"), payload));
		},
	);

	// ══════════════════════════════════════════════════════════════════════════
	// CONFLUENCE – PÁGINAS
	// ══════════════════════════════════════════════════════════════════════════

	s.tool(
		"confluence_get_page",
		"Obtiene una página de Confluence por ID",
		{
			page_id: z.string(),
			expand: z
				.string()
				.optional()
				.describe("body.storage,version,space,ancestors"),
		},
		async ({ page_id, expand }) =>
			ok(
				await apiGet(cfluUrl(`content/${page_id}`), {
					expand: expand ?? "body.storage,version,space,ancestors",
				}),
			),
	);

	s.tool(
		"confluence_get_page_by_title",
		"Busca una página de Confluence por espacio y título",
		{ space_key: z.string(), title: z.string(), expand: z.string().optional() },
		async ({ space_key, title, expand }) =>
			ok(
				await apiGet(cfluUrl("content"), {
					spaceKey: space_key,
					title,
					type: "page",
					expand: expand ?? "body.storage,version,space",
				}),
			),
	);

	s.tool(
		"confluence_create_page",
		"Crea una nueva página en Confluence",
		{
			space_key: z.string(),
			title: z.string(),
			body: z.string(),
			parent_id: z.string().optional(),
			representation: z
				.string()
				.default("storage")
				.describe("storage (XHTML), wiki, markdown"),
		},
		async ({ space_key, title, body, parent_id, representation }) => {
			const payload: Record<string, unknown> = {
				type: "page",
				title,
				space: { key: space_key },
				body: { [representation]: { value: body, representation } },
			};
			if (parent_id) payload.ancestors = [{ id: parent_id }];
			return ok(await apiPost(cfluUrl("content"), payload));
		},
	);

	s.tool(
		"confluence_update_page",
		"Actualiza el contenido de una página existente",
		{
			page_id: z.string(),
			title: z.string(),
			body: z.string(),
			version_number: z.number().int().describe("Versión actual + 1"),
			representation: z.string().default("storage"),
			parent_id: z.string().optional(),
		},
		async ({
			page_id,
			title,
			body,
			version_number,
			representation,
			parent_id,
		}) => {
			const payload: Record<string, unknown> = {
				version: { number: version_number },
				type: "page",
				title,
				body: { [representation]: { value: body, representation } },
			};
			if (parent_id) payload.ancestors = [{ id: parent_id }];
			return ok(await apiPut(cfluUrl(`content/${page_id}`), payload));
		},
	);

	s.tool(
		"confluence_delete_page",
		"Elimina una página de Confluence (mueve a la papelera)",
		{ page_id: z.string() },
		async ({ page_id }) => ok(await apiDelete(cfluUrl(`content/${page_id}`))),
	);

	s.tool(
		"confluence_get_page_children",
		"Lista las páginas hijas de una página",
		{
			page_id: z.string(),
			limit: z.number().int().default(25),
			start: z.number().int().default(0),
			expand: z.string().optional(),
		},
		async ({ page_id, limit, start, expand }) =>
			ok(
				await apiGet(cfluUrl(`content/${page_id}/child/page`), {
					limit,
					start,
					expand,
				}),
			),
	);

	s.tool(
		"confluence_get_page_descendants",
		"Lista todos los descendientes de una página",
		{
			page_id: z.string(),
			depth: z.string().optional(),
			expand: z.string().optional(),
		},
		async ({ page_id, depth, expand }) =>
			ok(
				await apiGet(cfluUrl(`content/${page_id}/descendant/page`), {
					depth,
					expand,
				}),
			),
	);

	s.tool(
		"confluence_get_page_history",
		"Obtiene el historial de versiones de una página",
		{
			page_id: z.string(),
			limit: z.number().int().default(25),
			start: z.number().int().default(0),
		},
		async ({ page_id, limit, start }) =>
			ok(await apiGet(cfluUrl(`content/${page_id}/version`), { limit, start })),
	);

	s.tool(
		"confluence_move_page",
		"Mueve una página dentro del árbol de Confluence",
		{
			page_id: z.string(),
			target_id: z.string().describe("ID de la nueva página padre"),
			position: z
				.string()
				.default("append")
				.describe("append, prepend, before, after"),
		},
		async ({ page_id, target_id, position }) => {
			const r = await fetch(
				cfluUrl(`content/${page_id}/move/${position}/${target_id}`),
				{
					method: "PUT",
					headers: authHeaders(),
				},
			);
			if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
			return ok({ status: "movida", page_id, target_id });
		},
	);

	// ══════════════════════════════════════════════════════════════════════════
	// CONFLUENCE – BÚSQUEDA
	// ══════════════════════════════════════════════════════════════════════════

	s.tool(
		"confluence_search",
		"Busca contenido en Confluence usando CQL",
		{
			cql: z.string().describe("Consulta CQL"),
			limit: z.number().int().default(25),
			start: z.number().int().default(0),
			expand: z.string().optional(),
		},
		async ({ cql, limit, start, expand }) =>
			ok(
				await apiGet(cfluUrl("content/search"), { cql, limit, start, expand }),
			),
	);

	s.tool(
		"confluence_search_text",
		"Búsqueda de texto libre en Confluence",
		{
			query: z.string(),
			space_key: z.string().optional(),
			limit: z.number().int().default(25),
			start: z.number().int().default(0),
		},
		async ({ query, space_key, limit, start }) => {
			let cql = `text~"${query}"`;
			if (space_key) cql += ` AND space.key="${space_key}"`;
			return ok(await apiGet(cfluUrl("content/search"), { cql, limit, start }));
		},
	);

	// ══════════════════════════════════════════════════════════════════════════
	// CONFLUENCE – COMENTARIOS
	// ══════════════════════════════════════════════════════════════════════════

	s.tool(
		"confluence_get_comments",
		"Lista los comentarios de una página de Confluence",
		{
			page_id: z.string(),
			depth: z.string().default("all").describe("all o root"),
			limit: z.number().int().default(25),
			start: z.number().int().default(0),
			expand: z.string().optional(),
		},
		async ({ page_id, depth, limit, start, expand }) =>
			ok(
				await apiGet(cfluUrl(`content/${page_id}/child/comment`), {
					depth,
					limit,
					start,
					expand: expand ?? "body.storage,version",
				}),
			),
	);

	s.tool(
		"confluence_add_comment",
		"Añade un comentario a una página de Confluence",
		{
			page_id: z.string(),
			body: z.string(),
			parent_comment_id: z.string().optional(),
		},
		async ({ page_id, body, parent_comment_id }) => {
			const payload: Record<string, unknown> = {
				type: "comment",
				container: { id: page_id, type: "page" },
				body: { storage: { value: body, representation: "storage" } },
			};
			if (parent_comment_id)
				payload.ancestors = [{ id: parent_comment_id, type: "comment" }];
			return ok(await apiPost(cfluUrl("content"), payload));
		},
	);

	s.tool(
		"confluence_delete_comment",
		"Elimina un comentario de Confluence",
		{ comment_id: z.string() },
		async ({ comment_id }) =>
			ok(await apiDelete(cfluUrl(`content/${comment_id}`))),
	);

	// ══════════════════════════════════════════════════════════════════════════
	// CONFLUENCE – LABELS
	// ══════════════════════════════════════════════════════════════════════════

	s.tool(
		"confluence_get_labels",
		"Lista las etiquetas de una página",
		{ page_id: z.string() },
		async ({ page_id }) =>
			ok(await apiGet(cfluUrl(`content/${page_id}/label`))),
	);

	s.tool(
		"confluence_add_labels",
		"Añade etiquetas a una página",
		{
			page_id: z.string(),
			labels: z.string().describe("Separadas por coma, ej. api,backend"),
		},
		async ({ page_id, labels }) => {
			const payload = labels
				.split(",")
				.map((l) => ({ prefix: "global", name: l.trim() }));
			return ok(await apiPost(cfluUrl(`content/${page_id}/label`), payload));
		},
	);

	s.tool(
		"confluence_remove_label",
		"Elimina una etiqueta de una página",
		{ page_id: z.string(), label: z.string() },
		async ({ page_id, label }) =>
			ok(await apiDelete(cfluUrl(`content/${page_id}/label/${label}`))),
	);

	// ══════════════════════════════════════════════════════════════════════════
	// CONFLUENCE – RESTRICCIONES DE ACCESO
	// ══════════════════════════════════════════════════════════════════════════

	s.tool(
		"confluence_get_restrictions",
		"Obtiene las restricciones de acceso de una página",
		{ page_id: z.string() },
		async ({ page_id }) =>
			ok(await apiGet(cfluUrl(`content/${page_id}/restriction`))),
	);

	s.tool(
		"confluence_add_restriction",
		"Añade una restricción de acceso a una página",
		{
			page_id: z.string(),
			operation: z.string().describe("read o update"),
			user_account_id: z.string().optional(),
			group_name: z.string().optional(),
		},
		async ({ page_id, operation, user_account_id, group_name }) => {
			const payload = [
				{
					operation,
					restrictions: {
						user: user_account_id
							? { results: [{ accountId: user_account_id }] }
							: { results: [] },
						group: group_name
							? { results: [{ name: group_name }] }
							: { results: [] },
					},
				},
			];
			return ok(
				await apiPost(cfluUrl(`content/${page_id}/restriction`), payload),
			);
		},
	);

	// ══════════════════════════════════════════════════════════════════════════
	// ATLASSIAN – SOLICITUD GENÉRICA
	// ══════════════════════════════════════════════════════════════════════════

	s.tool(
		"atlassian_request",
		"Realiza una solicitud directa a la API de Atlassian (para endpoints no cubiertos)",
		{
			method: z.string().describe("GET, POST, PUT, DELETE, PATCH"),
			path: z.string().describe("Path relativo, ej. /rest/api/3/issue"),
			api: z.string().default("jira").describe("jira, agile, confluence, raw"),
			body: z.string().optional().describe("JSON string del body"),
			params: z.string().optional().describe("JSON string de query params"),
		},
		async ({ method, path, api, body: bodyStr, params: paramsStr }) => {
			let base: string;
			switch (api) {
				case "agile":
					base = agileUrl(path);
					break;
				case "confluence":
					base = cfluUrl(path);
					break;
				case "raw":
					base = rawUrl(path);
					break;
				default:
					base = jiraUrl(path);
			}
			const parsedParams: Record<string, unknown> = paramsStr
				? JSON.parse(paramsStr)
				: {};
			const u = new URL(base);
			for (const [k, v] of Object.entries(parsedParams))
				if (v != null) u.searchParams.set(k, String(v));

			const r = await fetch(u.toString(), {
				method: method.toUpperCase(),
				headers: authHeaders(),
				body: bodyStr ?? undefined,
			});
			if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
			const text = await r.text();
			return ok(text ? JSON.parse(text) : { status: "ok" });
		},
	);
}
