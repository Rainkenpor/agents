import type { PenDoc, PenNode } from "./schema";

interface StoredDoc {
	id: string;
	name: string;
	path?: string;
	doc: PenDoc;
}

const docs = new Map<string, StoredDoc>();
let activeId: string | null = null;

export function storeDoc(doc: PenDoc, opts: { path?: string; name?: string } = {}): StoredDoc {
	const id = crypto.randomUUID();
	const name = opts.name ?? doc.children?.[0]?.name ?? id;
	const entry: StoredDoc = { id, name, path: opts.path, doc };
	docs.set(id, entry);
	activeId = id;
	return entry;
}

export function getActiveDoc(): StoredDoc | null {
	return activeId ? docs.get(activeId) ?? null : null;
}

export function getDoc(id: string): StoredDoc | null {
	return docs.get(id) ?? null;
}

export function setActive(id: string): void {
	if (!docs.has(id)) throw new Error(`doc not found: ${id}`);
	activeId = id;
}

export function listDocs(): StoredDoc[] {
	return Array.from(docs.values());
}

export function requireActive(): StoredDoc {
	const d = getActiveDoc();
	if (!d) throw new Error("No active document. Call open_document first.");
	return d;
}

// ─── Tree helpers ─────────────────────────────────────────────────────────────

export function walkNodes(
	nodes: PenNode[] | undefined,
	fn: (n: PenNode, parent: PenNode | null) => void,
	parent: PenNode | null = null,
): void {
	if (!nodes) return;
	for (const n of nodes) {
		fn(n, parent);
		if (n.children) walkNodes(n.children, fn, n);
	}
}

export function findNode(doc: PenDoc, id: string): PenNode | null {
	let found: PenNode | null = null;
	walkNodes(doc.children, (n) => {
		if (n.id === id) found = n;
	});
	return found;
}

export function findParent(doc: PenDoc, id: string): PenNode | null {
	let parentOf: PenNode | null = null;
	walkNodes(doc.children, (n, parent) => {
		if (n.id === id) parentOf = parent;
	});
	return parentOf;
}
