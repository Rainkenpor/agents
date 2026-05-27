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
	/** Base de la API de Microsoft Graph */
	get GRAPH_BASE_URL() {
		return (process.env.GRAPH_BASE_URL ?? "https://graph.microsoft.com/v1.0").replace(
			/\/$/,
			"",
		);
	},
	/** Endpoint de login para obtener el token client_credentials */
	get TOKEN_URL() {
		return `https://login.microsoftonline.com/${this.TENANT_ID}/oauth2/v2.0/token`;
	},
	/** Puerto del servidor standalone */
	get PORT() {
		return Number(process.env.TEAMS_PORT ?? process.env.PORT ?? 3003);
	},
};

/** Lanza si falta alguna credencial obligatoria de Teams */
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
