import type { AtlassianHelpers } from "../types.ts";
import { fetchDocumentById } from "./document-client.ts";
import { wikiToStorage } from "./md-to-storage.ts";

export interface PublishDocumentArgs {
	document_id: string;
	parent_id: string;
	space_key: string;
	title_override?: string;
}

export interface PublishDocumentResult {
	page_id: string;
	page_url: string;
	document_code: string;
	document_title: string;
	sections_count: number;
}

export async function publishDocumentToConfluence(
	h: AtlassianHelpers,
	{ document_id, parent_id, space_key, title_override }: PublishDocumentArgs,
): Promise<PublishDocumentResult> {
	const doc = await fetchDocumentById(document_id);

	if (!doc.sections?.length)
		throw new Error(
			`El documento ${doc.code} no tiene secciones; no hay contenido que publicar.`,
		);

	const orderedSections = [...doc.sections].sort((a, b) =>
		a.created_at.localeCompare(b.created_at),
	);

	const wikiSource = orderedSections
		.map((sec) => `h2. ${sec.name}\n\n${sec.content ?? ""}`)
		.join("\n\n");
	const storage = await wikiToStorage(h, wikiSource);

	const title = title_override ?? `${doc.code} — ${doc.title}`;
	let created: { id: string; _links?: { base?: string; webui?: string } };
	try {
		created = (await h.apiPost(h.cfluUrl("content"), {
			type: "page",
			title,
			space: { key: space_key },
			ancestors: [{ id: parent_id }],
			body: { storage: { value: storage, representation: "storage" } },
		})) as { id: string; _links?: { base?: string; webui?: string } };
	} catch (err) {
		throw new Error(
			`No se pudo crear la página en Confluence para ${doc.code}: ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	const webui = created._links?.webui ?? "";
	const base = created._links?.base ?? h.rawUrl("/wiki");

	return {
		page_id: created.id,
		page_url: webui ? `${base}${webui}` : "",
		document_code: doc.code,
		document_title: doc.title,
		sections_count: orderedSections.length,
	};
}
