// ─── Cliente HTTP para la Web API de SonarQube ────────────────────────────────
//
// La Web API de SonarQube vive bajo `<BASE_URL>/api/*`. La autenticación se
// realiza con un token de usuario enviado vía Basic Auth (token como usuario,
// password vacío), que es el método compatible con todas las versiones.
//
// Docs: https://docs.sonarsource.com/sonarqube/latest/extension-guide/web-api/

import { envs } from "./envs";
import { logger } from "./logger";

const API_PREFIX = "/api";

/** Construye la cabecera de autorización Basic a partir del token */
function authHeader(): Record<string, string> {
	if (!envs.SONAR_TOKEN) return {};
	const encoded = Buffer.from(`${envs.SONAR_TOKEN}:`).toString("base64");
	return { Authorization: `Basic ${encoded}` };
}

/** Construye la URL completa de un endpoint de la API */
function apiUrl(path: string, params?: Record<string, unknown>): string {
	const clean = path.startsWith("/") ? path : `/${path}`;
	const url = new URL(`${envs.BASE_URL}${API_PREFIX}${clean}`);
	if (params) {
		for (const [key, value] of Object.entries(params)) {
			if (value === undefined || value === null || value === "") continue;
			url.searchParams.set(key, String(value));
		}
	}
	return url.toString();
}

async function parseResponse(res: Response, url: string): Promise<unknown> {
	const text = await res.text();
	if (!res.ok) {
		logger.info(`[sonar] ✗ ${res.status} ${url} :: ${text.slice(0, 200)}`);
		throw new Error(
			`SonarQube API ${res.status} ${res.statusText}: ${text || "(sin cuerpo)"}`,
		);
	}
	if (!text) return {};
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

/** GET autenticado contra la Web API de SonarQube */
export async function sonarGet(
	path: string,
	params?: Record<string, unknown>,
): Promise<unknown> {
	const url = apiUrl(path, params);
	logger.info(`[sonar] → GET ${url}`);
	const res = await fetch(url, {
		method: "GET",
		headers: { Accept: "application/json", ...authHeader() },
	});
	return parseResponse(res, url);
}

/**
 * POST autenticado. SonarQube espera los parámetros como
 * `application/x-www-form-urlencoded`, no como JSON.
 */
export async function sonarPost(
	path: string,
	params?: Record<string, unknown>,
): Promise<unknown> {
	const url = apiUrl(path);
	const body = new URLSearchParams();
	if (params) {
		for (const [key, value] of Object.entries(params)) {
			if (value === undefined || value === null || value === "") continue;
			body.set(key, String(value));
		}
	}
	logger.info(`[sonar] → POST ${url} :: ${body.toString()}`);
	const res = await fetch(url, {
		method: "POST",
		headers: {
			Accept: "application/json",
			"Content-Type": "application/x-www-form-urlencoded",
			...authHeader(),
		},
		body: body.toString(),
	});
	return parseResponse(res, url);
}
