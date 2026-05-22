import type { AtlassianHelpers } from "../types.ts";
import {
	type FetchedDocument,
	fetchDocumentById,
} from "./document-client.ts";
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

export interface UpdateDocumentArgs {
	document_id: string;
	space_key: string;
	title_override?: string;
	version_comment?: string;
}

export interface UpdateDocumentResult extends PublishDocumentResult {
	version: number;
}

export interface FindDocumentPageArgs {
	document_id: string;
	space_key: string;
	title_override?: string;
}

export interface FindDocumentPageResult {
	exists: boolean;
	page_id: string | null;
	page_url: string | null;
	page_title: string | null;
	version: number | null;
	document_code: string;
	document_title: string;
	expected_title: string;
}

function buildExpectedTitle(
	doc: Pick<FetchedDocument, "code" | "title">,
	title_override?: string,
): string {
	return title_override ?? `${doc.code} — ${doc.title}`;
}

function buildStorageBody(
	h: AtlassianHelpers,
	doc: FetchedDocument,
): Promise<string> {
	const orderedSections = [...doc.sections].sort((a, b) => {
		const ai = a.order_index ?? Number.MAX_SAFE_INTEGER;
		const bi = b.order_index ?? Number.MAX_SAFE_INTEGER;
		if (ai !== bi) return ai - bi;
		return a.created_at.localeCompare(b.created_at);
	});
	const wikiSource = orderedSections
		.map((sec) => `h2. ${sec.name}\n\n${sec.content ?? ""}`)
		.join("\n\n");
	return wikiToStorage(h, wikiSource);
}

function resolvePageUrl(
	h: AtlassianHelpers,
	links: { base?: string; webui?: string } | undefined,
	pageId: string,
	context: string,
): string {
	const webui = links?.webui ?? "";
	const base = links?.base ?? h.rawUrl("/wiki");
	const url = webui ? `${base}${webui}` : "";
	if (!url) {
		console.warn(
			`[${context}] Página ${pageId} sin webui; el resultado no tendrá URL navegable.`,
		);
	}
	return url;
}

interface ConfluenceSearchResult {
	results: Array<{
		id: string;
		title: string;
		version?: { number?: number };
		_links?: { webui?: string };
	}>;
	_links?: { base?: string };
}

async function findPageByTitle(
	h: AtlassianHelpers,
	space_key: string,
	title: string,
): Promise<{
	page: ConfluenceSearchResult["results"][number];
	base?: string;
} | null> {
	const res = (await h.apiGet(h.cfluUrl("content"), {
		spaceKey: space_key,
		title,
		type: "page",
		expand: "version",
	})) as ConfluenceSearchResult;
	const page = res.results?.[0];
	if (!page) return null;
	return { page, base: res._links?.base };
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

	const storage = await buildStorageBody(h, doc);
	const title = buildExpectedTitle(doc, title_override);

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

	return {
		page_id: created.id,
		page_url: resolvePageUrl(
			h,
			created._links,
			created.id,
			"publishDocumentToConfluence",
		),
		document_code: doc.code,
		document_title: doc.title,
		sections_count: doc.sections.length,
	};
}

export async function findPageForDocument(
	h: AtlassianHelpers,
	{ document_id, space_key, title_override }: FindDocumentPageArgs,
): Promise<FindDocumentPageResult> {
	const doc = await fetchDocumentById(document_id);
	const expected_title = buildExpectedTitle(doc, title_override);

	const hit = await findPageByTitle(h, space_key, expected_title);
	if (!hit) {
		return {
			exists: false,
			page_id: null,
			page_url: null,
			page_title: null,
			version: null,
			document_code: doc.code,
			document_title: doc.title,
			expected_title,
		};
	}

	const { page, base } = hit;
	return {
		exists: true,
		page_id: page.id,
		page_url: resolvePageUrl(
			h,
			{ base, webui: page._links?.webui },
			page.id,
			"findPageForDocument",
		),
		page_title: page.title,
		version: page.version?.number ?? null,
		document_code: doc.code,
		document_title: doc.title,
		expected_title,
	};
}

export async function updateDocumentPageInConfluence(
	h: AtlassianHelpers,
	{
		document_id,
		space_key,
		title_override,
		version_comment,
	}: UpdateDocumentArgs,
): Promise<UpdateDocumentResult> {
	const doc = await fetchDocumentById(document_id);

	if (!doc.sections?.length)
		throw new Error(
			`El documento ${doc.code} no tiene secciones; no hay contenido que actualizar.`,
		);

	const expected_title = buildExpectedTitle(doc, title_override);
	const hit = await findPageByTitle(h, space_key, expected_title);
	if (!hit)
		throw new Error(
			`No se encontró una página en el space "${space_key}" con título "${expected_title}". Crea la página primero con confluence_create_page_from_document.`,
		);

	const storage = await buildStorageBody(h, doc);
	const currentVersion = hit.page.version?.number ?? 0;
	const newVersion = currentVersion + 1;

	let updated: {
		id: string;
		_links?: { base?: string; webui?: string };
		version?: { number?: number };
	};
	try {
		updated = (await h.apiPut(h.cfluUrl(`content/${hit.page.id}`), {
			version: {
				number: newVersion,
				...(version_comment ? { message: version_comment } : {}),
			},
			type: "page",
			title: expected_title,
			body: { storage: { value: storage, representation: "storage" } },
		})) as {
			id: string;
			_links?: { base?: string; webui?: string };
			version?: { number?: number };
		};
	} catch (err) {
		throw new Error(
			`No se pudo actualizar la página ${hit.page.id} en Confluence para ${doc.code}: ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	return {
		page_id: updated.id,
		page_url: resolvePageUrl(
			h,
			updated._links ?? { base: hit.base },
			updated.id,
			"updateDocumentPageInConfluence",
		),
		document_code: doc.code,
		document_title: doc.title,
		sections_count: doc.sections.length,
		version: updated.version?.number ?? newVersion,
	};
}
