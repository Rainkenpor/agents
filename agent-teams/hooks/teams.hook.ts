// ─── Hooks de Microsoft Teams ─────────────────────────────────────────────────
import z from "zod";
import type { HookDefinition } from "../types";

export const teamsHooks: HookDefinition[] = [
	{
		name: "message.sent",
		description:
			"Se dispara tras enviar un mensaje a un chat o a un canal vía Bot Framework",
		payloadSchema: {
			scope: z.string().describe("Ámbito: 'chat' o 'channel'"),
			containerId: z
				.string()
				.describe("conversationId del chat o canal destino"),
			messageId: z.string().describe("ID del mensaje enviado"),
		},
	},
];
