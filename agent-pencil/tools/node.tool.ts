import z from "zod";
import { ok } from "../types";
import type { ToolDefinition } from "../types";
import { findNode, findParent, requireActive, walkNodes } from "../pencil/document-store";
import { resolveTree } from "../pencil/resolver";
import { computeLayout } from "../pencil/layout";
import type { PenNode } from "../pencil/schema";

export const nodeTools: ToolDefinition[] = [
	{
		name: "batch_get",
		description:
			"Fetches nodes by ID from the active document. Optionally includes descendants.",
		inputSchema: {
			ids: z.array(z.string()).describe("Node IDs to retrieve"),
			includeDescendants: z
				.boolean()
				.optional()
				.describe("If true (default), returns the whole subtree for each ID"),
		},
		handler: async ({
			ids,
			includeDescendants = true,
		}: { ids: string[]; includeDescendants?: boolean }) => {
			const active = requireActive();
			const out = ids.map((id) => {
				const n = findNode(active.doc, id);
				if (!n) return { id, found: false };
				return {
					id,
					found: true,
					node: includeDescendants ? n : { ...n, children: undefined },
				};
			});
			return ok({ nodes: out });
		},
	},
	{
		name: "batch_design",
		description:
			"Applies a batch of mutations (patch, insert, remove) to the active document in memory. Returns the updated nodes.",
		inputSchema: {
			mutations: z
				.array(
					z.object({
						op: z
							.enum(["patch", "insert", "remove"])
							.describe("patch = shallow merge; insert = add child; remove = delete node"),
						id: z.string().describe("Target node ID"),
						patch: z.record(z.any()).optional().describe("Fields to merge (for op=patch)"),
						child: z
							.record(z.any())
							.optional()
							.describe("Child node to append (for op=insert)"),
					}),
				)
				.describe("List of mutations to apply in order"),
		},
		handler: async ({
			mutations,
		}: {
			mutations: {
				op: "patch" | "insert" | "remove";
				id: string;
				patch?: Record<string, unknown>;
				child?: PenNode;
			}[];
		}) => {
			const active = requireActive();
			const applied: Array<{ id: string; op: string; ok: boolean; error?: string }> = [];
			for (const m of mutations) {
				try {
					if (m.op === "patch") {
						const n = findNode(active.doc, m.id);
						if (!n) throw new Error(`node not found: ${m.id}`);
						Object.assign(n, m.patch ?? {});
					} else if (m.op === "insert") {
						const parent = findNode(active.doc, m.id);
						if (!parent) throw new Error(`parent not found: ${m.id}`);
						if (!m.child) throw new Error("child required for insert");
						const child = { ...m.child, id: m.child.id ?? crypto.randomUUID() };
						parent.children = [...(parent.children ?? []), child as PenNode];
					} else if (m.op === "remove") {
						const parent = findParent(active.doc, m.id);
						if (!parent) throw new Error(`parent of ${m.id} not found`);
						parent.children = (parent.children ?? []).filter((c) => c.id !== m.id);
					}
					applied.push({ id: m.id, op: m.op, ok: true });
				} catch (err) {
					applied.push({ id: m.id, op: m.op, ok: false, error: String(err) });
				}
			}
			return ok({ applied });
		},
	},
	{
		name: "snapshot_layout",
		description:
			"Computes absolute x/y/width/height for every node by running the resolver and auto-layout.",
		inputSchema: {
			rootId: z
				.string()
				.optional()
				.describe("Limit the snapshot to a single subtree (default: whole doc)"),
		},
		handler: async ({ rootId }: { rootId?: string }) => {
			const active = requireActive();
			const resolved = resolveTree(active.doc);
			const laid = computeLayout(resolved);
			if (!rootId) {
				return ok({ roots: laid.map((n) => stripChildrenDeep(n)) });
			}
			const find = (nodes: typeof laid): typeof laid[number] | null => {
				for (const n of nodes) {
					if (n.id === rootId) return n;
					const inner = n.children ? find(n.children as typeof laid) : null;
					if (inner) return inner;
				}
				return null;
			};
			const target = find(laid);
			if (!target) throw new Error(`node not found: ${rootId}`);
			return ok({ node: stripChildrenDeep(target) });
		},
	},
	{
		name: "find_empty_space_on_canvas",
		description:
			"Finds an unoccupied region of the given size on the active document's first root frame.",
		inputSchema: {
			width: z.number().describe("Required width of the empty rectangle"),
			height: z.number().describe("Required height of the empty rectangle"),
			padding: z.number().optional().describe("Extra margin around occupied nodes (default 8)"),
		},
		handler: async ({
			width,
			height,
			padding = 8,
		}: { width: number; height: number; padding?: number }) => {
			const active = requireActive();
			const resolved = resolveTree(active.doc);
			const [root] = computeLayout(resolved);
			if (!root) throw new Error("Document has no root frame");
			const occupied: { x: number; y: number; w: number; h: number }[] = [];
			walkNodes(root.children as unknown as PenNode[], (n) => {
				const nn = n as unknown as { x: number; y: number; width: number; height: number };
				occupied.push({ x: nn.x, y: nn.y, w: nn.width, h: nn.height });
			});

			const step = 10;
			for (let y = root.y; y + height <= root.y + root.height; y += step) {
				for (let x = root.x; x + width <= root.x + root.width; x += step) {
					const collides = occupied.some(
						(o) =>
							x < o.x + o.w + padding &&
							x + width + padding > o.x &&
							y < o.y + o.h + padding &&
							y + height + padding > o.y,
					);
					if (!collides) return ok({ x, y });
				}
			}
			return ok({ x: root.x, y: root.y + root.height + padding });
		},
	},
];

function stripChildrenDeep<T extends { children?: T[] }>(n: T): T {
	return {
		...n,
		children: n.children ? n.children.map((c) => stripChildrenDeep(c)) : undefined,
	};
}
