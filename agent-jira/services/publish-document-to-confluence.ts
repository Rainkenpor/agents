import type { AtlassianHelpers } from "../types.ts";
import {
	type FetchedDocument,
	fetchDocumentById,
} from "./document-client.ts";

export interface PublishDocumentArgs {
	document_id: string;
	parent_id: string;
	space_key: string;
	title_override?: string;
}

export interface PublishDocumentResult {
	page_id: string;
	page_url: string;
	document_id: string;
	document_name: string;
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
	document_id: string;
	document_name: string;
	expected_title: string;
}

function buildExpectedTitle(
	doc: Pick<FetchedDocument, "name">,
	title_override?: string,
): string {
	return title_override ?? doc.name;
}

async function markdownToStorage(
	h: AtlassianHelpers,
	markdown: string,
): Promise<string> {
	const res = (await h.apiPost(h.cfluUrl("contentbody/convert/storage"), {
		value: markdown,
		representation: "wiki",
	})) as { value: string };
	return res.value;
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
	const doc = await fetchDocumentById(document_id, h.agentManagerToken);

	if (!doc.content?.trim())
		throw new Error(
			`El documento ${doc.id} (${doc.name}) no tiene contenido; no hay nada que publicar.`,
		);

	const storage = await markdownToStorage(h, doc.content);
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
			`No se pudo crear la página en Confluence para ${doc.id}: ${err instanceof Error ? err.message : String(err)}`,
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
		document_id: doc.id,
		document_name: doc.name,
	};
}

export async function findPageForDocument(
	h: AtlassianHelpers,
	{ document_id, space_key, title_override }: FindDocumentPageArgs,
): Promise<FindDocumentPageResult> {
	const doc = await fetchDocumentById(document_id, h.agentManagerToken);
	const expected_title = buildExpectedTitle(doc, title_override);

	const hit = await findPageByTitle(h, space_key, expected_title);
	if (!hit) {
		return {
			exists: false,
			page_id: null,
			page_url: null,
			page_title: null,
			version: null,
			document_id: doc.id,
			document_name: doc.name,
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
		document_id: doc.id,
		document_name: doc.name,
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
	const doc = await fetchDocumentById(document_id, h.agentManagerToken);

	if (!doc.content?.trim())
		throw new Error(
			`El documento ${doc.id} (${doc.name}) no tiene contenido; no hay nada que actualizar.`,
		);

	const expected_title = buildExpectedTitle(doc, title_override);
	const hit = await findPageByTitle(h, space_key, expected_title);
	if (!hit)
		throw new Error(
			`No se encontró una página en el space "${space_key}" con título "${expected_title}". Crea la página primero con confluence_create_page_from_document.`,
		);

	const storage = await markdownToStorage(h, doc.content);
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
			`No se pudo actualizar la página ${hit.page.id} en Confluence para ${doc.id}: ${err instanceof Error ? err.message : String(err)}`,
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
		document_id: doc.id,
		document_name: doc.name,
		version: updated.version?.number ?? newVersion,
	};
}
