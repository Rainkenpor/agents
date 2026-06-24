// ─── Variables de entorno (Microsoft Teams / Microsoft Graph) ─────────────────
//
// Las credenciales se leen del .env de la carpeta root del monorepo
// (agent-server las carga con dotenv: { path: "../.env" }).
//
//   TEAMS_TENANT_ID      → Directory (tenant) ID de Azure AD
//   TEAMS_CLIENT_ID      → Application (client) ID de la app registrada
//   TEAMS_CLIENT_SECRET  → Client secret de la app registrada
//
// Estas credenciales habilitan el flujo client_credentials (app-only)
// contra Microsoft Graph (https://graph.microsoft.com).
//
// Nota: se leen con getters (de forma perezosa) para que el valor refleje
// process.env en el momento de uso, sin depender del orden de imports
// respecto a dotenv.config().

export const envs = {
	get TENANT_ID() {
		return process.env.TEAMS_TENANT_ID ?? "";
	},
	get CLIENT_ID() {
		return process.env.TEAMS_CLIENT_ID ?? "";
	},
	get CLIENT_SECRET() {
		return process.env.TEAMS_CLIENT_SECRET ?? "";
	},
	/**
	 * Object id (AAD) del usuario/cuenta asociada al bot. Permite descubrir los
	 * chats del bot en contexto application-only vía /users/{id}/chats, ya que
	 * /chats a nivel organización no está soportado en app-only.
	 */
	get APP_USER_ID() {
		return process.env.TEAMS_APP_USER_ID ?? "";
	},

	/** Base de la API de Microsoft Graph */
	get GRAPH_BASE_URL() {
		return (
			process.env.GRAPH_BASE_URL ?? "https://graph.microsoft.com/v1.0"
		).replace(/\/$/, "");
	},
	/** Endpoint de login para obtener el token client_credentials */
	get TOKEN_URL() {
		return `https://login.microsoftonline.com/${this.TENANT_ID}/oauth2/v2.0/token`;
	},

	// ─── Azure Bot Framework ────────────────────────────────────────────────────
	//
	// El envío de mensajes a Teams ahora se hace vía Bot Framework (no Graph).
	// Por defecto reutiliza el App Registration de Azure AD (mismo client id/secret),
	// que es el caso común cuando el Azure Bot apunta a la misma app. Se pueden
	// sobreescribir con BOT_APP_ID / BOT_APP_PASSWORD si el bot usa otra app.

	/** Microsoft App ID del Azure Bot (default: TEAMS_CLIENT_ID) */
	get BOT_APP_ID() {
		return process.env.BOT_APP_ID ?? process.env.TEAMS_CLIENT_ID ?? "";
	},
	/** Microsoft App Password/Secret del Azure Bot (default: TEAMS_CLIENT_SECRET) */
	get BOT_APP_PASSWORD() {
		return (
			process.env.BOT_APP_PASSWORD ?? process.env.TEAMS_CLIENT_SECRET ?? ""
		);
	},
	/** Tipo de app del bot: SingleTenant | MultiTenant | UserAssignedMSI */
	get BOT_APP_TYPE() {
		return process.env.BOT_APP_TYPE ?? "SingleTenant";
	},
	/** Tenant del bot (relevante para SingleTenant; default: TEAMS_TENANT_ID) */
	get BOT_TENANT_ID() {
		return process.env.BOT_TENANT_ID ?? process.env.TEAMS_TENANT_ID ?? "";
	},
	/** serviceUrl regional de Teams para el ConnectorClient */
	get SERVICE_URL() {
		return (
			process.env.TEAMS_SERVICE_URL ?? "https://smba.trafficmanager.net/teams/"
		);
	},
	/** Nombre con el que el bot firma las actividades enviadas */
	get BOT_NAME() {
		return process.env.TEAMS_BOT_NAME ?? "Bot";
	},

	/** Puerto del servidor standalone */
	get PORT() {
		return Number(process.env.TEAMS_PORT ?? process.env.PORT ?? 3003);
	},
};

/** Lanza si falta alguna credencial obligatoria de Teams (Graph) */
export function assertTeamsCredentials(): void {
	const missing: string[] = [];
	if (!envs.TENANT_ID) missing.push("TEAMS_TENANT_ID");
	if (!envs.CLIENT_ID) missing.push("TEAMS_CLIENT_ID");
	if (!envs.CLIENT_SECRET) missing.push("TEAMS_CLIENT_SECRET");
	if (missing.length > 0) {
		throw new Error(
			`Faltan credenciales de Teams en el .env root: ${missing.join(", ")}`,
		);
	}
}

/** Lanza si falta alguna credencial obligatoria del Azure Bot */
export function assertBotCredentials(): void {
	const missing: string[] = [];
	if (!envs.BOT_APP_ID) missing.push("BOT_APP_ID (o TEAMS_CLIENT_ID)");
	if (!envs.BOT_APP_PASSWORD)
		missing.push("BOT_APP_PASSWORD (o TEAMS_CLIENT_SECRET)");
	if (envs.BOT_APP_TYPE === "SingleTenant" && !envs.BOT_TENANT_ID) {
		missing.push("BOT_TENANT_ID (o TEAMS_TENANT_ID)");
	}
	if (missing.length > 0) {
		throw new Error(
			`Faltan credenciales del Azure Bot en el .env root: ${missing.join(", ")}`,
		);
	}
}
