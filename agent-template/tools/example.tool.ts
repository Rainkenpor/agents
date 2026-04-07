// ══════════════════════════════════════════════════════════════════════════
// EXAMPLE – replace or delete this section
// ══════════════════════════════════════════════════════════════════════════
import z from "zod";
import { ok } from "../types";
import type { ToolDefinition } from "../types";

export const exampleTools: ToolDefinition[] = [
	{
		name: "example_get_item",
		description: "Fetches a single item by ID from the target API",
		inputSchema: {
			id: z.string().describe("The unique identifier of the item"),
		},
		handler: async ({ id }: { id: string }) =>
			ok(`Fetched item with ID: ${id}`),
	},
	{
		name: "example_create_item",
		description: "Creates a new item in the target API",
		inputSchema: {
			name: z.string().describe("Name of the item to create"),
			description: z
				.string()
				.optional()
				.describe("Optional description for the item"),
		},
		handler: async ({
			name,
			description,
		}: { name: string; description?: string }) =>
			ok(
				`Created item with name: ${name}${description ? ` and description: ${description}` : ""}`,
			),
	},
];
