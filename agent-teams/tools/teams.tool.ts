// ══════════════════════════════════════════════════════════════════════════
// Microsoft Teams tools — vía Microsoft Graph (app-only / client_credentials)
//
// Cubre: crear chats, crear grupos (teams), asignar usuarios a los grupos y
// escribir mensajes en chats y canales de Teams.
// ══════════════════════════════════════════════════════════════════════════
import z from "zod";
import { ok } from "../types";
import type { ToolDefinition } from "../types";
import { graph } from "../util/graph";
import { envs } from "../util/envs";
import { emit } from "../hooks";

/** Construye el binding OData a un usuario para members de Graph */
const userBind = (userId: string) =>
	`${envs.GRAPH_BASE_URL}/users('${userId}')`;

/** Convierte un string separado por comas en una lista de valores limpios */
const splitCsv = (value: string): string[] =>
	value
		.split(",")
		.map((v) => v.trim())
		.filter((v) => v.length > 0);

/**
 * Garantiza que el usuario de la app (TEAMS_APP_USER_ID) esté incluido en la
 * lista. Requerido por Graph en el flujo app-only al crear chats/Teams.
 * Lo antepone si no está presente (comparación case-insensitive).
 */
const withAppUser = (list: string[]): string[] => {
	const appUser = envs.APP_USER_ID;
	if (!appUser) return list;
	const exists = list.some((u) => u.toLowerCase() === appUser.toLowerCase());
	return exists ? list : [appUser, ...list];
};

export const teamsTools: ToolDefinition[] = [
	// ─── Usuarios (descubrimiento) ──────────────────────────────────────────────
	{
		name: "teams_list_users",
		description:
			"Lista usuarios del directorio (Azure AD). Útil para obtener los IDs/UPN necesarios para crear chats, teams y asignar miembros.",
		inputSchema: {
			search: z
				.string()
				.optional()
				.describe(
					"Texto a buscar en displayName o mail (ej: 'Walter' o 'wronquillo@distelsa.com.gt')",
				),
			top: z
				.number()
				.optional()
				.describe("Máximo de resultados a devolver (default 25)"),
		},
		handler: async ({ search, top }: { search?: string; top?: number }) => {
			const params: Record<string, unknown> = {
				$top: top ?? 25,
				$select: "id,displayName,userPrincipalName,mail",
			};
			if (search) {
				params.$filter = `startswith(displayName,'${search}') or startswith(mail,'${search}') or startswith(userPrincipalName,'${search}')`;
			}
			const data = await graph.get("users", params);
			return ok(data);
		},
	},

	// ─── Chats ──────────────────────────────────────────────────────────────────
	{
		name: "teams_create_chat",
		description:
			"Crea un chat de Teams (oneOnOne o group). Recibe los IDs/UPN de los usuarios miembros. Para 'group' se permiten más de 2 miembros y un topic opcional.",
		inputSchema: {
			chatType: z
				.enum(["oneOnOne", "group"])
				.describe(
					"Tipo de chat: 'oneOnOne' (exactamente 2 miembros) o 'group' (2+ miembros)",
				),
			members: z
				.string()
				.describe(
					"IDs o userPrincipalName de los miembros del chat, separados por coma (ej: 'user1@org.com,user2@org.com'). El usuario de la app (TEAMS_APP_USER_ID) se agrega automáticamente.",
				),
			topic: z
				.string()
				.optional()
				.describe("Nombre/tema del chat (solo aplica a chats 'group')"),
		},
		handler: async ({
			chatType,
			members,
			topic,
		}: {
			chatType: "oneOnOne" | "group";
			members: string;
			topic?: string;
		}) => {
			const memberList = withAppUser(splitCsv(members));
			const body: Record<string, unknown> = {
				chatType,
				members: memberList.map((m) => ({
					"@odata.type": "#microsoft.graph.aadUserConversationMember",
					roles: ["owner"],
					"user@odata.bind": userBind(m),
				})),
			};
			if (chatType === "group" && topic) body.topic = topic;

			const data = (await graph.post("chats", body)) as { id?: string };
			await emit("chat.created", {
				chatId: data.id ?? "",
				chatType,
				members: memberList,
				topic,
			});
			return ok(data);
		},
	},
	{
		name: "teams_add_chat_member",
		description: "Agrega un usuario a un chat de Teams existente.",
		inputSchema: {
			chatId: z.string().describe("ID del chat"),
			userId: z
				.string()
				.describe("ID o userPrincipalName del usuario a agregar"),
			shareHistory: z
				.boolean()
				.optional()
				.describe("Si compartir todo el historial del chat (default false)"),
		},
		handler: async ({
			chatId,
			userId,
			shareHistory,
		}: {
			chatId: string;
			userId: string;
			shareHistory?: boolean;
		}) => {
			const body: Record<string, unknown> = {
				"@odata.type": "#microsoft.graph.aadUserConversationMember",
				roles: ["owner"],
				"user@odata.bind": userBind(userId),
			};
			if (shareHistory) body.visibleHistoryStartDateTime = "0001-01-01T00:00:00Z";
			const data = await graph.post(`chats/${chatId}/members`, body);
			await emit("member.added", { scope: "chat", containerId: chatId, userId });
			return ok(data);
		},
	},
	{
		name: "teams_send_chat_message",
		description:
			"Escribe (envía) un mensaje en un chat de Teams existente. Soporta texto plano o HTML.",
		inputSchema: {
			chatId: z.string().describe("ID del chat donde se enviará el mensaje"),
			content: z.string().describe("Contenido del mensaje"),
			contentType: z
				.enum(["text", "html"])
				.optional()
				.describe("Formato del contenido (default 'text')"),
		},
		handler: async ({
			chatId,
			content,
			contentType,
		}: {
			chatId: string;
			content: string;
			contentType?: "text" | "html";
		}) => {
			const body = {
				body: { contentType: contentType ?? "text", content },
			};
			const data = (await graph.post(`chats/${chatId}/messages`, body)) as {
				id?: string;
			};
			await emit("message.sent", {
				scope: "chat",
				containerId: chatId,
				messageId: data.id ?? "",
			});
			return ok(data);
		},
	},
	{
		name: "teams_list_chat_messages",
		description: "Lista los mensajes recientes de un chat de Teams.",
		inputSchema: {
			chatId: z.string().describe("ID del chat"),
			top: z
				.number()
				.optional()
				.describe("Máximo de mensajes a devolver (default 20)"),
		},
		handler: async ({ chatId, top }: { chatId: string; top?: number }) => {
			const data = await graph.get(`chats/${chatId}/messages`, {
				$top: top ?? 20,
			});
			return ok(data);
		},
	},

	// ─── Grupos / Teams ───────────────────────────────────────────────────────────
	{
		name: "teams_create_team",
		description:
			"Crea un grupo (Team) de Microsoft Teams. Debe indicarse al menos un owner. Devuelve la operación de creación (la creación de Team es asíncrona).",
		inputSchema: {
			displayName: z.string().describe("Nombre del Team a crear"),
			description: z
				.string()
				.optional()
				.describe("Descripción del Team"),
			owners: z
				.string()
				.describe(
					"IDs o userPrincipalName de los owners, separados por coma. El usuario de la app (TEAMS_APP_USER_ID) se agrega automáticamente como owner.",
				),
			visibility: z
				.enum(["public", "private"])
				.optional()
				.describe("Visibilidad del Team (default 'private')"),
		},
		handler: async ({
			displayName,
			description,
			owners,
			visibility,
		}: {
			displayName: string;
			description?: string;
			owners: string;
			visibility?: "public" | "private";
		}) => {
			const ownerList = withAppUser(splitCsv(owners));
			const body: Record<string, unknown> = {
				"template@odata.bind":
					"https://graph.microsoft.com/v1.0/teamsTemplates('standard')",
				displayName,
				description: description ?? "",
				visibility: visibility ?? "private",
				members: ownerList.map((o) => ({
					"@odata.type": "#microsoft.graph.aadUserConversationMember",
					roles: ["owner"],
					"user@odata.bind": userBind(o),
				})),
			};
			const data = await graph.post("teams", body);
			await emit("team.created", { displayName, owners: ownerList, visibility });
			return ok(data);
		},
	},
	{
		name: "teams_list_teams",
		description:
			"Lista los grupos (Teams) existentes en la organización (grupos habilitados para Microsoft Teams).",
		inputSchema: {
			top: z
				.number()
				.optional()
				.describe("Máximo de resultados a devolver (default 25)"),
		},
		handler: async ({ top }: { top?: number }) => {
			const data = await graph.get("groups", {
				$filter:
					"resourceProvisioningOptions/Any(x:x eq 'Team')",
				$select: "id,displayName,description,visibility",
				$top: top ?? 25,
			});
			return ok(data);
		},
	},
	{
		name: "teams_add_team_member",
		description:
			"Asigna (agrega) un usuario a un grupo/Team existente, como 'member' u 'owner'.",
		inputSchema: {
			teamId: z.string().describe("ID del Team/grupo"),
			userId: z
				.string()
				.describe("ID o userPrincipalName del usuario a asignar"),
			role: z
				.enum(["member", "owner"])
				.optional()
				.describe("Rol del usuario en el Team (default 'member')"),
		},
		handler: async ({
			teamId,
			userId,
			role,
		}: {
			teamId: string;
			userId: string;
			role?: "member" | "owner";
		}) => {
			const body = {
				"@odata.type": "#microsoft.graph.aadUserConversationMember",
				roles: role === "owner" ? ["owner"] : [],
				"user@odata.bind": userBind(userId),
			};
			const data = await graph.post(`teams/${teamId}/members`, body);
			await emit("member.added", {
				scope: "team",
				containerId: teamId,
				userId,
			});
			return ok(data);
		},
	},

	// ─── Canales ──────────────────────────────────────────────────────────────────
	{
		name: "teams_list_channels",
		description: "Lista los canales de un grupo/Team.",
		inputSchema: {
			teamId: z.string().describe("ID del Team/grupo"),
		},
		handler: async ({ teamId }: { teamId: string }) => {
			const data = await graph.get(`teams/${teamId}/channels`);
			return ok(data);
		},
	},
	{
		name: "teams_send_channel_message",
		description:
			"Escribe (envía) un mensaje en un canal de un grupo/Team. Soporta texto plano o HTML.",
		inputSchema: {
			teamId: z.string().describe("ID del Team/grupo"),
			channelId: z.string().describe("ID del canal"),
			content: z.string().describe("Contenido del mensaje"),
			contentType: z
				.enum(["text", "html"])
				.optional()
				.describe("Formato del contenido (default 'text')"),
		},
		handler: async ({
			teamId,
			channelId,
			content,
			contentType,
		}: {
			teamId: string;
			channelId: string;
			content: string;
			contentType?: "text" | "html";
		}) => {
			const body = {
				body: { contentType: contentType ?? "text", content },
			};
			const data = (await graph.post(
				`teams/${teamId}/channels/${channelId}/messages`,
				body,
			)) as { id?: string };
			await emit("message.sent", {
				scope: "channel",
				containerId: `${teamId}/${channelId}`,
				messageId: data.id ?? "",
			});
			return ok(data);
		},
	},
];
