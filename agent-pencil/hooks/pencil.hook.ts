import z from "zod";
import type { HookDefinition } from "../types";

export const pencilHooks: HookDefinition[] = [
	{
		name: "document.opened",
		description: "Fires when a .pen document is loaded into the store",
		payloadSchema: {
			docId: z.string().describe("The internal ID assigned to the document"),
			name: z.string().describe("Human-readable document name"),
			path: z.string().optional().describe("Filesystem path if loaded from disk"),
		},
	},
	{
		name: "document.exported",
		description: "Fires when one or more nodes are exported (PNG/SVG/PDF)",
		payloadSchema: {
			docId: z.string().describe("Document the export belongs to"),
			nodeIds: z.array(z.string()).describe("Nodes that were exported"),
			format: z.string().describe("Output format: png | svg | pdf"),
			path: z.string().optional().describe("File path if written to disk"),
		},
	},
];
