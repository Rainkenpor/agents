import z from "zod";
import { ok } from "../types";
import type { ToolDefinition } from "../types";
import { emit } from "../hooks";
import {
	deletePalette,
	listPalettes,
	loadDocument,
	loadPalette,
	savePalette,
	saveDocument,
} from "../pencil/store";
import { appendOperation } from "../pencil/history";

export const paletteTools: ToolDefinition[] = [
	{
		name: "pencil_palette_save",
		description:
			"Saves a named palette. Colors become CSS variables (--<key>: <value>) injected at render time. daisyTheme sets data-theme on the <html> element.",
		inputSchema: {
			name: z.string().describe("Palette name (unique)"),
			colors: z
				.record(z.string())
				.describe(
					"Map of CSS variable name → color value (e.g. { primary: '#3b82f6' }). The key is used as --<key>.",
				),
			daisyTheme: z
				.string()
				.optional()
				.describe(
					"Optional DaisyUI theme name (e.g. 'light', 'dark', 'corporate')",
				),
		},
		handler: async ({
			name,
			colors,
			daisyTheme,
		}: {
			name: string;
			colors: Record<string, string>;
			daisyTheme?: string;
		}) => {
			await savePalette({ name, colors, daisyTheme });
			await emit("palette.saved", { name });
			return ok({ name });
		},
	},
	{
		name: "pencil_palette_list",
		description: "Lists all saved palettes",
		inputSchema: {},
		handler: async () => ok(await listPalettes()),
	},
	{
		name: "pencil_palette_apply",
		description:
			"Sets the active palette of a document. Pass an empty paletteName to clear.",
		inputSchema: {
			docId: z.string().describe("ID of the document"),
			paletteName: z
				.string()
				.optional()
				.describe("Name of the palette to apply (omit/empty to clear)"),
		},
		handler: async ({
			docId,
			paletteName,
		}: { docId: string; paletteName?: string }) => {
			const doc = await loadDocument(docId);
			const previous = doc.paletteName;
			if (paletteName) {
				await loadPalette(paletteName); // ensures it exists
				doc.paletteName = paletteName;
			} else {
				doc.paletteName = undefined;
			}
			await saveDocument(doc);
			await appendOperation(docId, {
				type: "palette.applied",
				paletteName: doc.paletteName,
				previous,
			});
			await emit("palette.applied", { docId, paletteName: doc.paletteName });
			return ok({ docId, paletteName: doc.paletteName });
		},
	},
	{
		name: "pencil_palette_delete",
		description: "Deletes a palette",
		inputSchema: {
			name: z.string().describe("Name of the palette to delete"),
		},
		handler: async ({ name }: { name: string }) => {
			await deletePalette(name);
			await emit("palette.deleted", { name });
			return ok({ name, deleted: true });
		},
	},
];
