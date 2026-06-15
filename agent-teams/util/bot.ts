// ─── Cliente de Azure Bot Framework (botframework-connector) ──────────────────
//
// Envío de mensajes a Microsoft Teams vía el REST connector de Bot Framework.
//
// A diferencia del envío proactivo con botbuilder (que requiere capturar antes
// una "conversation reference" desde el endpoint /messages), aquí se envía
// directamente a un conversationId YA EXISTENTE con
// `ConnectorClient.sendToConversation`. Solo se necesita:
//   - Credenciales del Azure Bot (BOT_APP_ID / BOT_APP_PASSWORD / BOT_TENANT_ID).
//   - El conversationId del chat o canal donde el bot ya está instalado.
//   - El serviceUrl regional de Teams (TEAMS_SERVICE_URL).

import { MicrosoftAppCredentials, ConnectorClient } from "botframework-connector";
import { envs, assertBotCredentials } from "./envs";
import { logger } from "./logger";

let connectorSingleton: ConnectorClient | null = null;

/** Devuelve un ConnectorClient autenticado con las credenciales del bot (singleton). */
function getConnector(): ConnectorClient {
	if (connectorSingleton) return connectorSingleton;
	assertBotCredentials();

	const credentials = new MicrosoftAppCredentials(
		envs.BOT_APP_ID,
		envs.BOT_APP_PASSWORD,
		envs.BOT_TENANT_ID,
	);
	// Necesario para que el SDK confíe en el endpoint de Teams.
	MicrosoftAppCredentials.trustServiceUrl(envs.SERVICE_URL);

	connectorSingleton = new ConnectorClient(credentials, {
		baseUri: envs.SERVICE_URL,
	});
	logger.info(`[bot] ConnectorClient inicializado (serviceUrl: ${envs.SERVICE_URL})`);
	return connectorSingleton;
}

/** Construye la actividad de mensaje a enviar (texto plano o HTML). */
function buildActivity(
	content: string,
	contentType: "text" | "html",
	recipientId?: string,
) {
	return {
		type: "message",
		from: { id: envs.BOT_APP_ID, name: envs.BOT_NAME },
		...(recipientId ? { recipient: { id: recipientId } } : {}),
		text: content,
		...(contentType === "html" ? { textFormat: "xml" } : {}),
	};
}

/**
 * Envía un mensaje a una conversación (chat o canal) de Teams ya existente,
 * reutilizando su conversationId. El bot debe estar instalado en esa conversación.
 *
 *  - Entrada: conversationId del chat/canal, contenido y formato del texto.
 *  - Salida: id de la actividad enviada.
 *  - Errores: bot no instalado en la conversación, credenciales inválidas,
 *    conversationId incorrecto o serviceUrl regional equivocado.
 */
export async function sendMessage(
	conversationId: string,
	content: string,
	contentType: "text" | "html" = "text",
): Promise<{ id?: string; conversationId: string }> {
	const connector = getConnector();

	const response = await connector.conversations.sendToConversation(
		conversationId,
		// biome-ignore lint/suspicious/noExplicitAny: Activity parcial aceptada por el connector
		buildActivity(content, contentType) as any,
	);
	logger.info(`[bot] mensaje enviado a ${conversationId} (activityId: ${response.id})`);
	return { id: response.id, conversationId };
}

/**
 * Envía un mensaje 1:1 a un usuario. Crea (o reutiliza) la conversación personal
 * con `createConversation` y luego envía el mensaje, igual que el ejemplo
 * send-teams-message.js.
 *
 *  - Entrada: AAD object id del usuario destino, contenido y formato del texto.
 *  - Salida: id de la actividad enviada y de la conversación creada.
 *  - Errores: app de Teams no instalada para el usuario, credenciales inválidas
 *    o serviceUrl regional equivocado.
 */
export async function sendToUser(
	userObjectId: string,
	content: string,
	contentType: "text" | "html" = "text",
): Promise<{ id?: string; conversationId: string }> {
	const connector = getConnector();

	const conversation = (await connector.conversations.createConversation({
		isGroup: false,
		bot: { id: envs.BOT_APP_ID, name: envs.BOT_NAME },
		members: [{ id: userObjectId, name: "" }],
		tenantId: envs.BOT_TENANT_ID,
		channelData: { tenant: { id: envs.BOT_TENANT_ID } },
	})) as unknown as { id: string };

	const response = await connector.conversations.sendToConversation(
		conversation.id,
		// biome-ignore lint/suspicious/noExplicitAny: Activity parcial aceptada por el connector
		buildActivity(content, contentType, userObjectId) as any,
	);
	logger.info(
		`[bot] mensaje 1:1 enviado a ${userObjectId} en conversación ${conversation.id} (activityId: ${response.id})`,
	);
	return { id: response.id, conversationId: conversation.id };
}
