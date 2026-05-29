import { readFile, writeFile, readdir, unlink, stat } from "node:fs/promises";
import {
	docPath,
	ensureWorkspace,
	palettePath,
	paths,
	templatePath,
} from "../util/workspace";
import type { PencilDocument, Palette, Template } from "./schema";

async function exists(p: string): Promise<boolean> {
	try {
		await stat(p);
		return true;
	} catch {
		return false;
	}
}

async function readJson<T>(p: string): Promise<T> {
	const raw = await readFile(p, "utf8");
	return JSON.parse(raw) as T;
}

async function writeJson(p: string, data: unknown): Promise<void> {
	await writeFile(p, JSON.stringify(data, null, 2), "utf8");
}

// ── Documents ───────────────────────────────────────────────────────────────

export async function saveDocument(doc: PencilDocument): Promise<void> {
	await ensureWorkspace();
	doc.updatedAt = new Date().toISOString();
	await writeJson(docPath(doc.id), doc);
}

export async function loadDocument(id: string): Promise<PencilDocument> {
	await ensureWorkspace();
	const p = docPath(id);
	if (!(await exists(p))) {
		throw new Error(`document not found: ${id}`);
	}
	return readJson<PencilDocument>(p);
}

export async function deleteDocument(id: string): Promise<void> {
	await ensureWorkspace();
	const p = docPath(id);
	if (await exists(p)) await unlink(p);
}

export async function listDocuments(): Promise<
	Array<{ id: string; name: string; pageCount: number; updatedAt: string }>
> {
	await ensureWorkspace();
	const files = await readdir(paths.documents).catch(() => []);
	const out = [];
	for (const f of files) {
		if (!f.endsWith(".json")) continue;
		const doc = await readJson<PencilDocument>(`${paths.documents}/${f}`);
		out.push({
			id: doc.id,
			name: doc.name,
			pageCount: doc.pages.length,
			updatedAt: doc.updatedAt,
		});
	}
	return out;
}

// ── Templates ───────────────────────────────────────────────────────────────

export async function saveTemplate(t: Template): Promise<void> {
	await ensureWorkspace();
	await writeJson(templatePath(t.name), t);
}

export async function loadTemplate(name: string): Promise<Template> {
	await ensureWorkspace();
	const p = templatePath(name);
	if (!(await exists(p))) throw new Error(`template not found: ${name}`);
	return readJson<Template>(p);
}

export async function deleteTemplate(name: string): Promise<void> {
	await ensureWorkspace();
	const p = templatePath(name);
	if (await exists(p)) await unlink(p);
}

export async function listTemplates(): Promise<
	Array<{ name: string; pageCount: number; paletteName?: string }>
> {
	await ensureWorkspace();
	const files = await readdir(paths.templates).catch(() => []);
	const out = [];
	for (const f of files) {
		if (!f.endsWith(".json")) continue;
		const t = await readJson<Template>(`${paths.templates}/${f}`);
		out.push({
			name: t.name,
			pageCount: t.pages.length,
			paletteName: t.paletteName,
		});
	}
	return out;
}

// ── Palettes ────────────────────────────────────────────────────────────────

export async function savePalette(p: Palette): Promise<void> {
	await ensureWorkspace();
	await writeJson(palettePath(p.name), p);
}

export async function loadPalette(name: string): Promise<Palette> {
	await ensureWorkspace();
	const path = palettePath(name);
	if (!(await exists(path))) throw new Error(`palette not found: ${name}`);
	return readJson<Palette>(path);
}

export async function deletePalette(name: string): Promise<void> {
	await ensureWorkspace();
	const path = palettePath(name);
	if (await exists(path)) await unlink(path);
}

export async function listPalettes(): Promise<Palette[]> {
	await ensureWorkspace();
	const files = await readdir(paths.palettes).catch(() => []);
	const out: Palette[] = [];
	for (const f of files) {
		if (!f.endsWith(".json")) continue;
		out.push(await readJson<Palette>(`${paths.palettes}/${f}`));
	}
	return out;
}
