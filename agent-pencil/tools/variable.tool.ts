import z from "zod";
import { ok } from "../types";
import type { ToolDefinition } from "../types";
import { requireActive } from "../pencil/document-store";

export const variableTools: ToolDefinition[] = [
	{
		name: "get_variables",
		description: "Returns the variables map of the active document.",
		inputSchema: {},
		handler: async () => {
			const active = requireActive();
			return ok({ variables: active.doc.variables ?? {} });
		},
	},
	{
		name: "set_variables",
		description:
			"Sets one or more variables on the active document. Affects subsequent renders only — the source file is not written.",
		inputSchema: {
			updates: z
				.array(
					z.object({
						name: z.string().describe("Variable name (without `--` prefix)"),
						value: z.any().describe("New value"),
					}),
				)
				.describe("Variable updates"),
		},
		handler: async ({ updates }: { updates: { name: string; value: unknown }[] }) => {
			const active = requireActive();
			active.doc.variables = { ...(active.doc.variables ?? {}) };
			for (const u of updates) active.doc.variables[u.name] = u.value;
			return ok({ variables: active.doc.variables });
		},
	},
];
