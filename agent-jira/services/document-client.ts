// ─── Cliente HTTP MCP para llamar al agent-document por detrás ───────────────
//
// El reuso se hace por HTTP MCP contra /document/mcp del mismo agent-server,
// NO por import directo. Mantiene el aislamiento entre agents del workspace.

export interface DocumentSection {
	id: string;
	document_id: string;
	template_section_id: string | null;
	name: string;
	content: string | null;
	created_at: string;
	updated_at: string;
	order_index: number | null;
}

export interface FetchedDocument {
	id: string;
	code: string;
	title: string;
	status: "draft" | "completed" | "generated";
	template_id: string;
	type_id: string;
	created_at: string;
	updated_at: string;
	sections: DocumentSection[];
}

const AGENT_SERVER_URL = (process.env.AGENT_SERVER_URL ?? "http://localhost:4000").replace(/\/$/, "");

/** Parsea la respuesta de StreamableHTTPServerTransport (JSON plano o SSE). */
async function parseMcpResponse(r: Response): Promise<{ result?: { content?: Array<{ text?: string }> }; error?: { message?: string } }> {
	const ct = r.headers.get("content-type") ?? "";
	const raw = await r.text();
	if (ct.includes("text/event-stream")) {
		// SSE: una o más líneas "data: {...}". Tomar el último frame con data.
		let last: string | undefined;
		for (const line of raw.split(/\r?\n/)) {
			if (line.startsWith("data:")) last = line.slice(5).trim();
		}
		if (!last) throw new Error(`document MCP: SSE sin frame data\n${raw}`);
		return JSON.parse(last);
	}
	return JSON.parse(raw);
}

/** Obtiene un documento de trazabilidad por su UUID llamando al MCP de agent-document. */
export async function fetchDocumentById(id: string): Promise<FetchedDocument> {
	const url = `${AGENT_SERVER_URL}/document/mcp`;
	const body = {
		jsonrpc: "2.0",
		id: 1,
		method: "tools/call",
		params: { name: "get_document", arguments: { id } },
	};
	const r = await fetch(url, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Accept: "application/json, text/event-stream",
		},
		body: JSON.stringify(body),
	});
	if (!r.ok) throw new Error(`document MCP HTTP ${r.status}: ${await r.text()}`);

	const parsed = await parseMcpResponse(r);
	if (parsed.error) throw new Error(`document MCP: ${parsed.error.message ?? JSON.stringify(parsed.error)}`);

	const text = parsed.result?.content?.[0]?.text;
	if (!text) throw new Error("document MCP: respuesta sin content");

	const data = JSON.parse(text) as FetchedDocument | { error: string };
	if ("error" in data) throw new Error(`document MCP: ${data.error}`);
	return data;
}
