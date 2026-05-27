// ─── Cliente de Microsoft Graph ──────────────────────────────────────────────
//
// Flujo OAuth2 client_credentials (app-only). Obtiene un access token usando
// las credenciales del .env root y lo cachea hasta poco antes de expirar.
// Expone helpers GET/POST/PATCH/DELETE contra https://graph.microsoft.com.

import { envs, assertTeamsCredentials } from "./envs";
import { logger } from "./logger";

type CachedToken = { value: string; expiresAt: number };
let cachedToken: CachedToken | null = null;

/** Devuelve un access token válido para Microsoft Graph (con cache). */
export async function getAccessToken(): Promise<string> {
	assertTeamsCredentials();

	const now = Date.now();
	if (cachedToken && cachedToken.expiresAt > now + 60_000) {
		return cachedToken.value;
	}

	const body = new URLSearchParams({
		client_id: envs.CLIENT_ID,
		client_secret: envs.CLIENT_SECRET,
		scope: "https://graph.microsoft.com/.default",
		grant_type: "client_credentials",
	});

	const res = await fetch(envs.TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body,
	});

	const text = await res.text();
	if (!res.ok) {
		logger.error(`[graph] token error ${res.status}: ${text}`);
		throw new Error(`No se pudo obtener token de Graph (${res.status}): ${text}`);
	}

	const json = JSON.parse(text) as {
		access_token: string;
		expires_in: number;
	};
	cachedToken = {
		value: json.access_token,
		expiresAt: now + json.expires_in * 1000,
	};
	logger.info("[graph] token client_credentials obtenido");
	return cachedToken.value;
}

function graphUrl(path: string): string {
	if (/^https?:\/\//.test(path)) return path;
	return `${envs.GRAPH_BASE_URL}/${path.replace(/^\//, "")}`;
}

async function request(
	method: "GET" | "POST" | "PATCH" | "DELETE",
	path: string,
	body?: unknown,
	params?: Record<string, unknown>,
): Promise<unknown> {
	const token = await getAccessToken();
	const url = new URL(graphUrl(path));
	if (params) {
		for (const [k, v] of Object.entries(params)) {
			if (v != null) url.searchParams.set(k, String(v));
		}
	}

	const res = await fetch(url.toString(), {
		method,
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
			Accept: "application/json",
		},
		body: body !== undefined ? JSON.stringify(body) : undefined,
	});

	const text = await res.text();
	if (!res.ok) {
		logger.error(`[graph] ${method} ${url.pathname} → ${res.status}: ${text}`);
		throw new Error(`Graph ${method} ${res.status}: ${text}`);
	}

	// Algunas respuestas (201/204) pueden venir vacías; devolvemos un objeto útil.
	if (!text) {
		const location = res.headers.get("location") ?? undefined;
		return { status: res.status, ...(location ? { location } : {}) };
	}
	return JSON.parse(text);
}

export const graph = {
	get: (path: string, params?: Record<string, unknown>) =>
		request("GET", path, undefined, params),
	post: (path: string, body?: unknown) => request("POST", path, body),
	patch: (path: string, body?: unknown) => request("PATCH", path, body),
	delete: (path: string) => request("DELETE", path),
};
