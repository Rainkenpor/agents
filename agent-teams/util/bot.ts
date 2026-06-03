// ─── Cliente de Azure Bot Framework ───────────────────────────────────────────
//
// Sustituye el envío de mensajes vía Microsoft Graph por el canal soportado de
// Microsoft Teams: el Azure Bot Service (Bot Framework).
//
// Flujo:
//   1. Azure Bot Service entrega cada actividad de Teams a POST /messages
//      (en agent-server: /teams/hooks/messages).
//   2. `processActivity()` autentica la actividad con CloudAdapter y, en el turn,
//      guarda la "conversation reference" (serviceUrl, conversationId, tenantId…).
//   3. Las tools envían mensajes proactivos reusando esas references con
//      `adapter.continueConversationAsync()`.
//
// Las references se persisten a disco (BOT_REFS_PATH) para sobrevivir reinicios.

import {
	CloudAdapter,
	ConfigurationServiceClientCredentialFactory,
	createBotFrameworkAuthenticationFromConfiguration,
	TurnContext,
	type Activity,
	type ConversationReference,
} from "botbuilder";
import { readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { envs, assertBotCredentials } from "./envs";
import { logger } from "./logger";
import { emit } from "../hooks";

// ─── Conversation reference store ──────────────────────────────────────────────

export type StoredRef = {
	/** ID de la conversación (chat 1:1, group chat o canal) en Bot Framework */
	conversationId: string;
	/** personal | groupChat | channel */
	conversationType?: string;
	/** Nombre/topic de la conversación, si aplica */
	name?: string;
	/** AAD object id del último usuario que interactuó (útil para 1:1) */
	aadObjectId?: string;
	/** displayName del último usuario que interactuó */
	fromName?: string;
	serviceUrl?: string;
	tenantId?: string;
	/** Reference completa de Bot Framework (lo que se reusa para enviar) */
	reference: Partial<ConversationReference>;
	updatedAt: string;
};

const refs = new Map<string, StoredRef>();
/** Índice aadObjectId → conversationId (chats 1:1) para envíos por usuario */
const userIndex = new Map<string, string>();

function persist(): void {
	try {
		writeFileSync(
			envs.BOT_REFS_PATH,
			JSON.stringify([...refs.values()], null, 2),
			"utf8",
		);
	} catch (err) {
		logger.error(`[bot] no se pudieron persistir refs: ${String(err)}`);
	}
}

function loadRefs(): void {
	try {
		const raw = readFileSync(envs.BOT_REFS_PATH, "utf8");
		const list = JSON.parse(raw) as StoredRef[];
		for (const r of list) {
			refs.set(r.conversationId, r);
			if (r.conversationType === "personal" && r.aadObjectId) {
				userIndex.set(r.aadObjectId.toLowerCase(), r.conversationId);
			}
		}
		logger.info(`[bot] ${refs.size} conversation references cargadas`);
	} catch {
		// archivo inexistente o vacío: arrancamos sin refs.
	}
}

loadRefs();

function storeReference(activity: Partial<Activity>): void {
	const reference = TurnContext.getConversationReference(activity);
	const conversationId = reference.conversation?.id;
	if (!conversationId) return;

	const aadObjectId = activity.from?.aadObjectId;
	const stored: StoredRef = {
		conversationId,
		conversationType: reference.conversation?.conversationType,
		name: reference.conversation?.name,
		aadObjectId,
		fromName: activity.from?.name,
		serviceUrl: reference.serviceUrl,
		tenantId:
			(activity.conversation as { tenantId?: string } | undefined)?.tenantId ??
			(activity.channelData as { tenant?: { id?: string } } | undefined)?.tenant
				?.id,
		reference,
		updatedAt: new Date().toISOString(),
	};
	refs.set(conversationId, stored);
	if (stored.conversationType === "personal" && aadObjectId) {
		userIndex.set(aadObjectId.toLowerCase(), conversationId);
	}
	persist();
	logger.info(
		`[bot] ref guardada: ${conversationId} (${stored.conversationType ?? "?"})`,
	);
}

// ─── Adapter ───────────────────────────────────────────────────────────────────

let adapterSingleton: CloudAdapter | null = null;

function getAdapter(): CloudAdapter {
	if (adapterSingleton) return adapterSingleton;
	assertBotCredentials();

	const credentialsFactory = new ConfigurationServiceClientCredentialFactory({
		MicrosoftAppId: envs.BOT_APP_ID,
		MicrosoftAppPassword: envs.BOT_APP_PASSWORD,
		MicrosoftAppType: envs.BOT_APP_TYPE,
		MicrosoftAppTenantId: envs.BOT_TENANT_ID,
	});

	const auth = createBotFrameworkAuthenticationFromConfiguration(
		null,
		credentialsFactory,
	);

	const adapter = new CloudAdapter(auth);
	adapter.onTurnError = async (context, error) => {
		logger.error(`[bot] turn error: ${String(error)}`);
		try {
			await context.sendActivity("El bot encontró un error procesando la actividad.");
		} catch {
			// noop
		}
	};
	adapterSingleton = adapter;
	return adapter;
}

// ─── Ingesta del endpoint /messages ────────────────────────────────────────────

/**
 * Procesa una actividad entrante de Azure Bot Service. Adapta el req/res de
 * node:http a la interfaz que espera CloudAdapter y guarda la conversation
 * reference en cada turn. Emite el hook `message.received` para mensajes de texto.
 */
export async function processActivity(
	req: IncomingMessage,
	res: ServerResponse,
	activity: unknown,
): Promise<void> {
	const adapter = getAdapter();

	// Shims compatibles con la interfaz Request/Response de botbuilder.
	const reqShim = {
		body: activity,
		headers: req.headers,
		method: req.method,
	};
	const resShim = {
		status(code: number) {
			res.statusCode = code;
			return this;
		},
		send(body?: unknown) {
			if (body === undefined || body === null) res.end();
			else res.end(typeof body === "string" ? body : JSON.stringify(body));
			return this;
		},
		end() {
			res.end();
			return this;
		},
		set(field: string, value: string) {
			res.setHeader(field, value);
			return this;
		},
		header(field: string, value: string) {
			res.setHeader(field, value);
			return this;
		},
	};

	await adapter.process(
		// biome-ignore lint/suspicious/noExplicitAny: shim compatible con botbuilder Request
		reqShim as any,
		// biome-ignore lint/suspicious/noExplicitAny: shim compatible con botbuilder Response
		resShim as any,
		async (context) => {
			storeReference(context.activity);

			if (context.activity.type === "message") {
				await emit("message.received", {
					conversationId: context.activity.conversation?.id ?? "",
					conversationType:
						context.activity.conversation?.conversationType ?? "",
					from: context.activity.from?.name ?? "",
					aadObjectId: context.activity.from?.aadObjectId ?? "",
					text: context.activity.text ?? "",
				});
			}
		},
	);
}

// ─── Envío proactivo ───────────────────────────────────────────────────────────

/** Resuelve la StoredRef a partir de un conversationId o (fallback) un AAD id. */
function resolveRef(conversationOrUserId: string): StoredRef {
	const direct = refs.get(conversationOrUserId);
	if (direct) return direct;

	const byUser = userIndex.get(conversationOrUserId.toLowerCase());
	if (byUser) {
		const stored = refs.get(byUser);
		if (stored) return stored;
	}

	throw new Error(
		`No hay conversation reference para '${conversationOrUserId}'. ` +
			`El bot debe haber recibido al menos una actividad de esa conversación ` +
			`(p.ej. que le escriban, o ser agregado al chat/canal/Team) antes de poder ` +
			`enviar proactivamente. Usa teams_list_conversation_refs para ver las disponibles.`,
	);
}

/**
 * Envía un mensaje proactivo a una conversación (chat o canal) por su
 * conversationId (o el AAD id del usuario para chats 1:1 ya conocidos).
 */
export async function sendMessage(
	conversationOrUserId: string,
	content: string,
	contentType: "text" | "html" = "text",
): Promise<{ id?: string }> {
	const stored = resolveRef(conversationOrUserId);
	const adapter = getAdapter();

	let sentId: string | undefined;
	await adapter.continueConversationAsync(
		envs.BOT_APP_ID,
		stored.reference as ConversationReference,
		async (context) => {
			const resp = await context.sendActivity(
				contentType === "html"
					? { type: "message", text: content, textFormat: "xml" }
					: { type: "message", text: content },
			);
			sentId = resp?.id;
		},
	);
	return { id: sentId };
}

/** Devuelve las conversation references conocidas (sin el objeto reference crudo). */
export function listReferences(): Array<Omit<StoredRef, "reference">> {
	return [...refs.values()].map(({ reference: _r, ...rest }) => rest);
}
