import fs from "node:fs";
import path from "node:path";
import z from "zod";
import { ok } from "../types";
import type { ToolDefinition } from "../types";
import { emit } from "../hooks";
import { envs } from "../util/envs";
import { DocSchema } from "../pencil/schema";
import {
	getActiveDoc,
	listDocs,
	requireActive,
	setActive,
	storeDoc,
} from "../pencil/document-store";

function slugify(s: string): string {
	return s
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
		|| "doc";
}

export const documentTools: ToolDefinition[] = [
	{
		name: "open_document",
		description:
			"Loads a .pen JSON file (by path or inline content) into the in-memory store and marks it as active. Returns docId and the document tree.",
		inputSchema: {
			path: z.string().optional().describe("Absolute or relative path to the .pen file"),
			content: z
				.string()
				.optional()
				.describe("Raw JSON content of the .pen file (alternative to path)"),
			name: z.string().optional().describe("Optional human-readable name"),
		},
		handler: async ({
			path: filePath,
			content,
			name,
		}: { path?: string; content?: string; name?: string }) => {
			let raw: string;
			let abs: string | undefined;
			if (filePath) {
				abs = path.isAbsolute(filePath) ? filePath : path.resolve(filePath);
				raw = fs.readFileSync(abs, "utf8");
			} else if (content) {
				raw = content;
			} else {
				throw new Error("Provide either `path` or `content`.");
			}
			const parsed = DocSchema.parse(JSON.parse(raw));
			const entry = storeDoc(parsed, { path: abs, name });
			await emit("document.opened", {
				docId: entry.id,
				name: entry.name,
				path: entry.path,
			});
			return ok({
				docId: entry.id,
				name: entry.name,
				path: entry.path,
				root: parsed.children?.[0]?.id,
				rootCount: parsed.children?.length ?? 0,
			});
		},
	},
	{
		name: "get_editor_state",
		description:
			"Returns the current editor state: active doc, available docs, and root metadata.",
		inputSchema: {},
		handler: async () => {
			const active = getActiveDoc();
			return ok({
				activeDocId: active?.id ?? null,
				activeName: active?.name ?? null,
				docs: listDocs().map((d) => ({ id: d.id, name: d.name, path: d.path })),
				selection: [],
				viewport: { x: 0, y: 0, zoom: 1 },
			});
		},
	},
	{
		name: "get_guidelines",
		description:
			"Returns design guidelines (palette, spacing, typography) inferred from the active document.",
		inputSchema: {},
		handler: async () => {
			const active = requireActive();
			const palette = new Set<string>();
			const fonts = new Set<string>();
			const sizes = new Set<number>();
			const walk = (n: { fill?: unknown; fontFamily?: string; fontSize?: number; children?: unknown[] }) => {
				if (typeof n.fill === "string") palette.add(n.fill);
				if (n.fontFamily) fonts.add(n.fontFamily);
				if (typeof n.fontSize === "number") sizes.add(n.fontSize);
				const kids = (n.children ?? []) as typeof n[];
				for (const k of kids) walk(k);
			};
			for (const c of active.doc.children ?? []) walk(c as never);
			return ok({
				palette: [...palette],
				fontFamilies: [...fonts],
				fontSizes: [...sizes].sort((a, b) => a - b),
				spacing: [4, 8, 12, 16, 20, 24],
			});
		},
	},
	{
		name: "set_active_document",
		description: "Switches which loaded document is active.",
		inputSchema: { docId: z.string().describe("Document ID returned by open_document") },
		handler: async ({ docId }: { docId: string }) => {
			setActive(docId);
			return ok({ activeDocId: docId });
		},
	},
	{
		name: "save_document",
		description:
			"Persists the active document's tree as a .pen JSON file to disk. Defaults to PENCIL_OUTPUT_DIR/<slug>.pen if no path is given.",
		inputSchema: {
			path: z
				.string()
				.optional()
				.describe("Target filesystem path. Use .pen extension by convention."),
			pretty: z
				.boolean()
				.optional()
				.describe("Pretty-print with 2-space indent (default true)"),
		},
		handler: async ({
			path: target,
			pretty = true,
		}: { path?: string; pretty?: boolean }) => {
			const active = requireActive();
			const out =
				target ??
				path.resolve(envs.PENCIL_OUTPUT_DIR, `${slugify(active.name)}.pen`);
			fs.mkdirSync(path.dirname(out), { recursive: true });
			const data: Record<string, unknown> = {
				version: active.doc.version ?? "2.10",
				children: active.doc.children,
			};
			if (active.doc.variables) data.variables = active.doc.variables;
			const json = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
			fs.writeFileSync(out, json, "utf8");
			return ok({ path: out, bytes: Buffer.byteLength(json, "utf8"), name: active.name });
		},
	},
];
