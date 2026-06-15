// ══════════════════════════════════════════════════════════════════════════
// Microsoft Teams tools
//
// - Envío de mensajes (chats/canales) → Azure Bot Framework vía
//   botframework-connector (sendToConversation a un conversationId existente).
//   Ver util/bot.ts.
// - Directorio (listar usuarios) y listado de chats → Microsoft Graph
//   (app-only / client_credentials), que no tiene equivalente en Bot Framework.
// ══════════════════════════════════════════════════════════════════════════
import z from "zod";
import { ok } from "../types";
import type { ToolDefinition } from "../types";
import { graph } from "../util/graph";
import { sendMessage, sendToUser } from "../util/bot";
import { envs } from "../util/envs";
import { emit } from "../hooks";

export const teamsTools: ToolDefinition[] = [
	// ─── Usuarios (descubrimiento) ──────────────────────────────────────────────
	{
		name: "teams_list_users",
		description:
			"Lista usuarios del directorio (Azure AD). Útil para obtener los IDs/UPN de los usuarios.",
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
		name: "teams_list_chats",
		description:
			"Lista los chats en los que participa un usuario (por defecto el usuario de la app) junto con los miembros de cada chat. Útil para descubrir los conversationId que se usan con teams_send_chat_message.",
		inputSchema: {
			userId: z
				.string()
				.optional()
				.describe(
					"ID o userPrincipalName del usuario cuyos chats se quieren listar. Si se omite, se usa el usuario de la app.",
				),
			chatType: z
				.enum(["oneOnOne", "group", "meeting"])
				.optional()
				.describe("Filtra por tipo de chat (oneOnOne, group o meeting)"),
			top: z
				.number()
				.optional()
				.describe("Máximo de chats a devolver (default 25)"),
		},
		handler: async ({
			userId,
			chatType,
			top,
		}: {
			userId?: string;
			chatType?: "oneOnOne" | "group" | "meeting";
			top?: number;
		}) => {
			const targetUser = userId;
			if (!targetUser) {
				throw new Error("No se indicó userId.");
			}
			const params: Record<string, unknown> = {
				$expand: "members",
				$top: top ?? 25,
			};
			if (chatType) params.$filter = `chatType eq '${chatType}'`;

			const data = (await graph.get(`users/${targetUser}/chats`, params)) as {
				value?: Array<{
					id?: string;
					topic?: string | null;
					chatType?: string;
					members?: Array<{
						displayName?: string;
						userId?: string;
						email?: string;
						roles?: string[];
					}>;
				}>;
			};

			// Normaliza la salida para enfatizar chat + miembros.
			const chats = (data.value ?? []).map((chat) => ({
				id: chat.id,
				topic: chat.topic ?? null,
				chatType: chat.chatType,
				members: (chat.members ?? []).map((m) => ({
					displayName: m.displayName,
					userId: m.userId,
					email: m.email,
					roles: m.roles ?? [],
				})),
			}));

			return ok({ user: targetUser, count: chats.length, chats });
		},
	},
	{
		name: "teams_send_chat_message",
		description:
			"Envía un mensaje a un chat de Teams vía Azure Bot Framework. Soporta texto plano o HTML. Hay dos modos: (1) chat 1:1 → pasa 'userId' (AAD object id del usuario) y se crea/reutiliza la conversación personal automáticamente (la app de Teams debe estar instalada para ese usuario); (2) chat grupal o 1:1 ya existente → pasa 'conversationId' (id de teams_list_chats, ej: '19:...@thread.v2') y el bot debe estar instalado en ese chat. Indica uno de los dos.",
		inputSchema: {
			userId: z
				.string()
				.optional()
				.describe(
					"AAD object id del usuario destino para un chat 1:1. Crea/reutiliza la conversación personal con createConversation. Tiene prioridad sobre conversationId.",
				),
			conversationId: z
				.string()
				.optional()
				.describe(
					"conversationId de un chat existente (id devuelto por teams_list_chats, ej: '19:...@thread.v2'). Se usa si no se indica userId.",
				),
			content: z.string().describe("Contenido del mensaje"),
			contentType: z
				.enum(["text", "html"])
				.optional()
				.describe("Formato del contenido (default 'text')"),
		},
		handler: async ({
			userId,
			conversationId,
			content,
			contentType,
		}: {
			userId?: string;
			conversationId?: string;
			content: string;
			contentType?: "text" | "html";
		}) => {
			if (!userId && !conversationId) {
				throw new Error(
					"Debes indicar 'userId' (chat 1:1) o 'conversationId' (chat existente).",
				);
			}
			const data = userId
				? await sendToUser(userId, content, contentType ?? "text")
				: await sendMessage(
						conversationId as string,
						content,
						contentType ?? "text",
					);
			await emit("message.sent", {
				scope: "chat",
				containerId: data.conversationId ?? conversationId ?? "",
				messageId: data.id ?? "",
			});
			return ok(data);
		},
	},

	// ─── Canales ──────────────────────────────────────────────────────────────────
	{
		name: "teams_send_channel_message",
		description:
			"Envía un mensaje a un canal de un grupo/Team ya existente vía Azure Bot Framework, usando su conversationId. Soporta texto plano o HTML. El bot debe estar instalado en el Team.",
		inputSchema: {
			conversationId: z
				.string()
				.describe("conversationId del canal (ej: '19:...@thread.tacv2')."),
			content: z.string().describe("Contenido del mensaje"),
			contentType: z
				.enum(["text", "html"])
				.optional()
				.describe("Formato del contenido (default 'text')"),
		},
		handler: async ({
			conversationId,
			content,
			contentType,
		}: {
			conversationId: string;
			content: string;
			contentType?: "text" | "html";
		}) => {
			const data = await sendMessage(
				conversationId,
				content,
				contentType ?? "text",
			);
			await emit("message.sent", {
				scope: "channel",
				containerId: conversationId,
				messageId: data.id ?? "",
			});
			return ok(data);
		},
	},
];
