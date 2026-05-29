import z from "zod";
import type { HookDefinition } from "../types";

export const pencilHooks: HookDefinition[] = [
	// ── Documents ───────────────────────────────────────────────────────────
	{
		name: "document.created",
		description: "Fired after a new pencil document is created",
		payloadSchema: {
			docId: z.string().describe("ID of the created document"),
			name: z.string().describe("Name of the document"),
		},
	},
	{
		name: "document.opened",
		description: "Fired after a document is opened/loaded",
		payloadSchema: {
			docId: z.string().describe("ID of the opened document"),
		},
	},
	{
		name: "document.renamed",
		description: "Fired after a document is renamed",
		payloadSchema: {
			docId: z.string().describe("ID of the document"),
			before: z.string().describe("Previous name"),
			after: z.string().describe("New name"),
		},
	},
	{
		name: "document.deleted",
		description: "Fired after a document is deleted",
		payloadSchema: {
			docId: z.string().describe("ID of the deleted document"),
		},
	},
	{
		name: "document.rolled_back",
		description: "Fired after a document is rolled back to a previous version",
		payloadSchema: {
			docId: z.string().describe("ID of the document"),
			version: z.number().describe("Version restored"),
		},
	},

	// ── Pages ───────────────────────────────────────────────────────────────
	{
		name: "page.added",
		description: "Fired after a page is added to a document",
		payloadSchema: {
			docId: z.string().describe("ID of the document"),
			pageId: z.string().describe("ID of the new page"),
			name: z.string().describe("Name of the new page"),
		},
	},
	{
		name: "page.updated",
		description: "Fired after a page's HTML is updated",
		payloadSchema: {
			docId: z.string().describe("ID of the document"),
			pageId: z.string().describe("ID of the updated page"),
		},
	},
	{
		name: "page.deleted",
		description: "Fired after a page is deleted",
		payloadSchema: {
			docId: z.string().describe("ID of the document"),
			pageId: z.string().describe("ID of the deleted page"),
		},
	},
	{
		name: "page.reordered",
		description: "Fired after a document's pages are reordered",
		payloadSchema: {
			docId: z.string().describe("ID of the document"),
			order: z.array(z.string()).describe("New order of page IDs"),
		},
	},
	{
		name: "page.rendered",
		description: "Fired after a page is rendered to PNG",
		payloadSchema: {
			docId: z.string().describe("ID of the document"),
			pageId: z.string().describe("ID of the page"),
			mode: z.string().describe("base64 or file"),
		},
	},

	// ── Templates ───────────────────────────────────────────────────────────
	{
		name: "template.saved",
		description: "Fired after a template is saved",
		payloadSchema: {
			name: z.string().describe("Name of the saved template"),
			pageCount: z.number().describe("Number of pages in the template"),
		},
	},
	{
		name: "template.applied",
		description: "Fired after a template is applied (to a new or existing doc)",
		payloadSchema: {
			name: z.string().describe("Name of the applied template"),
			docId: z.string().describe("ID of the resulting / target document"),
		},
	},
	{
		name: "template.deleted",
		description: "Fired after a template is deleted",
		payloadSchema: {
			name: z.string().describe("Name of the deleted template"),
		},
	},

	// ── Palettes ────────────────────────────────────────────────────────────
	{
		name: "palette.saved",
		description: "Fired after a palette is saved",
		payloadSchema: {
			name: z.string().describe("Name of the saved palette"),
		},
	},
	{
		name: "palette.applied",
		description: "Fired after a palette is applied to a document",
		payloadSchema: {
			docId: z.string().describe("ID of the document"),
			paletteName: z.string().optional().describe("Palette name (omit to clear)"),
		},
	},
	{
		name: "palette.deleted",
		description: "Fired after a palette is deleted",
		payloadSchema: {
			name: z.string().describe("Name of the deleted palette"),
		},
	},
];
