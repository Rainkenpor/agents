// ══════════════════════════════════════════════════════════════════════════
// EXAMPLE – replace or delete this section
// ══════════════════════════════════════════════════════════════════════════
import z from "zod";
import type { HookDefinition } from "../types";

export const exampleHooks: HookDefinition[] = [
	{
		name: "item.created",
		description:
			"Fired after example_create_item successfully creates a new item",
		payloadSchema: {
			id: z.string().describe("Generated ID of the created item"),
			name: z.string().describe("Name of the created item"),
			description: z
				.string()
				.optional()
				.describe("Description if provided"),
		},
	},
	{
		name: "item.fetched",
		description: "Fired after example_get_item retrieves an item",
		payloadSchema: {
			id: z.string().describe("ID of the fetched item"),
		},
	},
];
