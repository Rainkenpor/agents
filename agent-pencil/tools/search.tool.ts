import z from "zod";
import { ok } from "../types";
import type { ToolDefinition } from "../types";
import { requireActive, walkNodes } from "../pencil/document-store";
import type { PenNode } from "../pencil/schema";

export const searchTools: ToolDefinition[] = [
	{
		name: "search_all_unique_properties",
		description:
			"Returns the set of unique values found for a given property across every node in the active doc, plus the IDs that carry each value.",
		inputSchema: {
			property: z.string().describe('Property to inspect (e.g. "fontFamily", "fill")'),
		},
		handler: async ({ property }: { property: string }) => {
			const active = requireActive();
			const acc = new Map<string, string[]>();
			walkNodes(active.doc.children, (n) => {
				const v = (n as unknown as Record<string, unknown>)[property];
				if (v === undefined || v === null) return;
				const key = typeof v === "object" ? JSON.stringify(v) : String(v);
				if (!acc.has(key)) acc.set(key, []);
				acc.get(key)!.push(n.id);
			});
			return ok({
				property,
				values: [...acc.entries()].map(([value, ids]) => ({ value, count: ids.length, ids })),
			});
		},
	},
	{
		name: "replace_all_matching_properties",
		description:
			"For every node where `property` equals `from`, sets it to `to`. Returns the affected node IDs.",
		inputSchema: {
			property: z.string().describe("Property name to compare"),
			from: z.any().describe("Existing value to match (compared via JSON equality)"),
			to: z.any().describe("New value to write"),
		},
		handler: async ({
			property,
			from,
			to,
		}: { property: string; from: unknown; to: unknown }) => {
			const active = requireActive();
			const ids: string[] = [];
			const fromKey = typeof from === "object" ? JSON.stringify(from) : String(from);
			walkNodes(active.doc.children, (n) => {
				const rec = n as unknown as Record<string, unknown>;
				const cur = rec[property];
				const curKey = typeof cur === "object" ? JSON.stringify(cur) : String(cur);
				if (cur !== undefined && curKey === fromKey) {
					rec[property] = to as PenNode[keyof PenNode];
					ids.push(n.id);
				}
			});
			return ok({ updated: ids });
		},
	},
];
