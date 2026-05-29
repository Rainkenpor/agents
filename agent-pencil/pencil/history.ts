import { appendFile, readFile, writeFile, stat } from "node:fs/promises";
import { ensureWorkspace, historyPath } from "../util/workspace";
import type { Operation, PencilDocument, StoredOperation } from "./schema";
import { saveDocument } from "./store";

async function exists(p: string): Promise<boolean> {
	try {
		await stat(p);
		return true;
	} catch {
		return false;
	}
}

export async function readHistory(docId: string): Promise<StoredOperation[]> {
	await ensureWorkspace();
	const p = historyPath(docId);
	if (!(await exists(p))) return [];
	const raw = await readFile(p, "utf8");
	return raw
		.split("\n")
		.filter((l) => l.trim().length > 0)
		.map((l) => JSON.parse(l) as StoredOperation);
}

export async function appendOperation(
	docId: string,
	op: Operation,
): Promise<StoredOperation> {
	await ensureWorkspace();
	const existing = await readHistory(docId);
	const stored: StoredOperation = {
		version: existing.length,
		timestamp: new Date().toISOString(),
		op,
	};
	await appendFile(historyPath(docId), `${JSON.stringify(stored)}\n`, "utf8");
	return stored;
}

/**
 * Replays operations 0..targetVersion (inclusive) to build a document state.
 * Returns the document at that version. Throws if doc.created is missing.
 */
function applyOps(ops: StoredOperation[]): PencilDocument {
	let doc: PencilDocument | null = null;
	for (const { op } of ops) {
		switch (op.type) {
			case "doc.created":
				doc = JSON.parse(JSON.stringify(op.doc)) as PencilDocument;
				break;
			case "doc.renamed":
				if (doc) doc.name = op.after;
				break;
			case "page.added":
				if (doc) doc.pages.push({ ...op.page });
				break;
			case "page.updated":
				if (doc) {
					const idx = doc.pages.findIndex((p) => p.id === op.pageId);
					if (idx >= 0) doc.pages[idx]!.html = op.after;
				}
				break;
			case "page.deleted":
				if (doc) doc.pages = doc.pages.filter((p) => p.id !== op.page.id);
				break;
			case "page.reordered":
				if (doc) {
					const byId = new Map(doc.pages.map((p) => [p.id, p]));
					doc.pages = op.order
						.map((id) => byId.get(id))
						.filter((p): p is NonNullable<typeof p> => Boolean(p));
				}
				break;
			case "palette.applied":
				if (doc) doc.paletteName = op.paletteName;
				break;
		}
	}
	if (!doc) throw new Error("history has no doc.created operation");
	return doc;
}

/**
 * Rolls back to `version` (inclusive): replays ops [0..version], rewrites the
 * doc file, and truncates history beyond that version. Discards later ops.
 */
export async function rollback(
	docId: string,
	version: number,
): Promise<PencilDocument> {
	const all = await readHistory(docId);
	if (version < 0 || version >= all.length) {
		throw new Error(
			`invalid version ${version} (history has ${all.length} ops)`,
		);
	}
	const kept = all.slice(0, version + 1);
	const doc = applyOps(kept);
	doc.updatedAt = new Date().toISOString();
	await saveDocument(doc);
	const truncated = kept.map((s) => JSON.stringify(s)).join("\n") + "\n";
	await writeFile(historyPath(docId), truncated, "utf8");
	return doc;
}
