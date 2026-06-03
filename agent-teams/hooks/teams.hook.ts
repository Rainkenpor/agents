// ─── Hooks de Microsoft Teams ─────────────────────────────────────────────────
import z from "zod";
import type { HookDefinition } from "../types";

export const teamsHooks: HookDefinition[] = [
	{
		name: "chat.created",
		description: "Se dispara tras crear un chat con teams_create_chat",
		payloadSchema: {
			chatId: z.string().describe("ID del chat creado"),
			chatType: z.string().describe("Tipo de chat: oneOnOne o group"),
			members: z
				.array(z.string())
				.describe("IDs/UPN de los miembros del chat"),
			topic: z.string().optional().describe("Tema del chat si es group"),
		},
	},
	{
		name: "team.created",
		description: "Se dispara tras crear un grupo/Team con teams_create_team",
		payloadSchema: {
			displayName: z.string().describe("Nombre del Team creado"),
			owners: z.array(z.string()).describe("IDs/UPN de los owners"),
			visibility: z
				.string()
				.optional()
				.describe("Visibilidad del Team (public/private)"),
		},
	},
	{
		name: "member.added",
		description:
			"Se dispara al asignar un usuario a un chat o a un grupo/Team",
		payloadSchema: {
			scope: z.string().describe("Ámbito: 'chat' o 'team'"),
			containerId: z.string().describe("ID del chat o del Team"),
			userId: z.string().describe("ID/UPN del usuario agregado"),
		},
	},
	{
		name: "message.sent",
		description:
			"Se dispara tras escribir un mensaje en un chat o en un canal",
		payloadSchema: {
			scope: z.string().describe("Ámbito: 'chat' o 'channel'"),
			containerId: z
				.string()
				.describe("conversationId del chat o canal destino"),
			messageId: z.string().describe("ID del mensaje enviado"),
		},
	},
	{
		name: "message.received",
		description:
			"Se dispara cuando el Azure Bot recibe un mensaje entrante de Teams (vía el endpoint /messages)",
		payloadSchema: {
			conversationId: z.string().describe("conversationId de origen"),
			conversationType: z
				.string()
				.describe("Tipo: personal | groupChat | channel"),
			from: z.string().describe("displayName del remitente"),
			aadObjectId: z
				.string()
				.describe("AAD object id del remitente (si disponible)"),
			text: z.string().describe("Texto del mensaje recibido"),
		},
	},
];
