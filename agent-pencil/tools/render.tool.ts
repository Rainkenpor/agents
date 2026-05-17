import fs from "node:fs";
import path from "node:path";
import z from "zod";
import { ok } from "../types";
import type { ToolDefinition } from "../types";
import { emit } from "../hooks";
import { envs } from "../util/envs";
import { requireActive } from "../pencil/document-store";
import { resolveTree } from "../pencil/resolver";
import { computeLayout, type ResolvedNode } from "../pencil/layout";
import { renderSvg, svgToPng, svgsToPdfBuffer } from "../pencil/renderer";

type OutputMode = "file" | "base64" | "both";

function findResolved(roots: ResolvedNode[], id: string): ResolvedNode | null {
	for (const r of roots) {
		if (r.id === id) return r;
		const inner = r.children ? findResolved(r.children as ResolvedNode[], id) : null;
		if (inner) return inner;
	}
	return null;
}

async function writeOutput(
	buffer: Buffer,
	mime: string,
	ext: string,
	output: OutputMode,
	suggestedName: string,
): Promise<{ path?: string; base64?: string; mime: string }> {
	const result: { path?: string; base64?: string; mime: string } = { mime };
	if (output === "file" || output === "both") {
		fs.mkdirSync(envs.PENCIL_OUTPUT_DIR, { recursive: true });
		const filename = `${suggestedName}-${Date.now()}.${ext}`;
		const full = path.resolve(envs.PENCIL_OUTPUT_DIR, filename);
		fs.writeFileSync(full, buffer);
		result.path = full;
	}
	if (output === "base64" || output === "both") {
		result.base64 = buffer.toString("base64");
	}
	return result;
}

export const renderTools: ToolDefinition[] = [
	{
		name: "get_screenshot",
		description:
			"Renders a node (or the active root) as a PNG. Output can be saved to disk, returned as base64, or both.",
		inputSchema: {
			nodeId: z
				.string()
				.optional()
				.describe("Node to render. Defaults to the first root frame of the active doc."),
			output: z
				.enum(["file", "base64", "both"])
				.optional()
				.describe("Where to send the result. Default: file"),
			scale: z.number().optional().describe("Pixel scale factor (default 1)"),
		},
		handler: async ({
			nodeId,
			output = "file" as OutputMode,
			scale = 1,
		}: { nodeId?: string; output?: OutputMode; scale?: number }) => {
			const active = requireActive();
			const resolved = resolveTree(active.doc);
			const laid = computeLayout(resolved);
			const target = nodeId ? findResolved(laid, nodeId) : laid[0];
			if (!target) throw new Error(`node not found: ${nodeId}`);
			const svg = renderSvg(target, { scale });
			const png = svgToPng(svg, scale);
			const result = await writeOutput(png, "image/png", "png", output, target.id);
			await emit("document.exported", {
				docId: active.id,
				nodeIds: [target.id],
				format: "png",
				path: result.path,
			});
			return ok({ nodeId: target.id, width: target.width, height: target.height, ...result });
		},
	},
	{
		name: "export_nodes",
		description:
			"Exports one or many nodes in PNG, SVG or PDF. Supports file output, base64 inline, or both.",
		inputSchema: {
			ids: z.array(z.string()).describe("Nodes to export"),
			format: z
				.enum(["png", "svg", "pdf"])
				.describe("Output format. PDF combines all nodes in one multi-page document."),
			output: z
				.enum(["file", "base64", "both"])
				.optional()
				.describe("Where to send the result. Default: file"),
			scale: z.number().optional().describe("Scale factor for PNG (default 1)"),
		},
		handler: async ({
			ids,
			format,
			output = "file" as OutputMode,
			scale = 1,
		}: { ids: string[]; format: "png" | "svg" | "pdf"; output?: OutputMode; scale?: number }) => {
			const active = requireActive();
			const resolved = resolveTree(active.doc);
			const laid = computeLayout(resolved);

			const targets = ids.map((id) => {
				const t = findResolved(laid, id);
				if (!t) throw new Error(`node not found: ${id}`);
				return t;
			});

			if (format === "pdf") {
				const svgs = targets.map((t) => renderSvg(t, { scale }));
				const pdf = await svgsToPdfBuffer(svgs);
				const result = await writeOutput(
					pdf,
					"application/pdf",
					"pdf",
					output,
					`export-${ids.length}`,
				);
				await emit("document.exported", {
					docId: active.id,
					nodeIds: ids,
					format: "pdf",
					path: result.path,
				});
				return ok({ ids, format, ...result });
			}

			const items: Array<{ id: string; path?: string; base64?: string; mime: string }> = [];
			for (const t of targets) {
				const svg = renderSvg(t, { scale });
				let buf: Buffer;
				let mime: string;
				let ext: string;
				if (format === "png") {
					buf = svgToPng(svg, scale);
					mime = "image/png";
					ext = "png";
				} else {
					buf = Buffer.from(svg, "utf8");
					mime = "image/svg+xml";
					ext = "svg";
				}
				const r = await writeOutput(buf, mime, ext, output, t.id);
				items.push({ id: t.id, ...r });
			}
			await emit("document.exported", {
				docId: active.id,
				nodeIds: ids,
				format,
				path: items[0]?.path,
			});
			return ok({ format, items });
		},
	},
];
