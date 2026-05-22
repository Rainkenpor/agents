// ─── Cliente HTTP para obtener documentos de trazabilidad de agent-manager ───
//
// Los documentos viven en Postgres en agent-manager. Se consultan vía:
//   GET {AGENT_MANAGER_URL}/api/traceability/documents/:id
// El JWT del usuario lo propaga agent-manager como header
// "x-agent-manager-token" al invocar cualquier tool MCP. Si ese header no
// está presente, hace fallback a AGENT_MANAGER_TOKEN (env).

export interface FetchedDocument {
	id: string;
	stageId: string;
	name: string;
	content: string;
	active: boolean;
	originalId: string | null;
	createdAt: string;
	updatedAt: string;
}

const AGENT_MANAGER_URL = (
	process.env.AGENT_MANAGER_URL ?? "http://localhost:3000"
).replace(/\/$/, "");

const AGENT_MANAGER_TOKEN_ENV = process.env.AGENT_MANAGER_TOKEN ?? "";

/**
 * Obtiene un documento de trazabilidad desde agent-manager (Postgres).
 * @param id UUID del documento (traceability_documents.id)
 * @param token JWT del usuario propagado por agent-manager (opcional;
 *              si está vacío usa AGENT_MANAGER_TOKEN del .env)
 */
export async function fetchDocumentById(
	id: string,
	token?: string,
): Promise<FetchedDocument> {
	const url = `${AGENT_MANAGER_URL}/api/traceability/documents/${encodeURIComponent(id)}`;
	const bearer = token || AGENT_MANAGER_TOKEN_ENV;
	const headers: Record<string, string> = { Accept: "application/json" };
	if (bearer) headers.Authorization = `Bearer ${bearer}`;

	const r = await fetch(url, { method: "GET", headers });
	if (!r.ok) {
		const text = await r.text();
		if (r.status === 401)
			throw new Error(
				`agent-manager: 401 no autorizado al consultar id="${id}". Verifica que el JWT del usuario se esté propagando (header x-agent-manager-token) o configura AGENT_MANAGER_TOKEN en el .env.`,
			);
		if (r.status === 404)
			throw new Error(
				`agent-manager: documento no encontrado (id="${id}"). Verifica que el UUID exista en traceability_documents.`,
			);
		throw new Error(`agent-manager HTTP ${r.status}: ${text}`);
	}

	const data = (await r.json()) as FetchedDocument | { error?: string };
	if ("error" in data && data.error)
		throw new Error(`agent-manager: ${data.error}`);
	return data as FetchedDocument;
}
