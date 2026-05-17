import type { PenDoc, PenNode } from "./schema";
import { resolveRef } from "./lib-resolver";

/**
 * Returns a deep clone of `tree` with:
 *  - `ref` nodes expanded from external libs (or replaced with placeholder).
 *  - `descendants` overrides applied to ref children.
 *  - `$U:--var` strings substituted from `variables`.
 */
export function resolveTree(doc: PenDoc): PenDoc {
	const vars = doc.variables ?? {};
	const cloned: PenDoc = {
		...doc,
		children: (doc.children ?? []).map((c) => resolveNode(c, vars)),
	};
	return cloned;
}

function resolveNode(node: PenNode, vars: Record<string, unknown>): PenNode {
	let resolved: PenNode;

	if (node.ref) {
		const target = resolveRef(node.ref);
		if (target) {
			// Merge: ref provides the template, node overrides shallow + descendants apply by id.
			resolved = {
				...target,
				...node,
				ref: undefined,
				children: target.children?.map((c) =>
					resolveNode(applyDescendant(c, node.descendants), vars),
				),
			};
		} else {
			// Placeholder when lib is missing.
			resolved = {
				...node,
				type: "frame",
				fill: "#2A2A2A",
				ref: undefined,
				children: [
					{
						type: "text",
						id: `${node.id}-ph`,
						name: "placeholder",
						content: `[ref: ${node.ref}]`,
						fill: "#9CA3AF",
						fontFamily: "Inter",
						fontSize: 11,
						fontWeight: "normal",
					},
				],
			};
		}
	} else {
		resolved = { ...node };
	}

	// Substitute $U:--var in string fields (content, fill if string)
	for (const key of Object.keys(resolved)) {
		const v = (resolved as Record<string, unknown>)[key];
		if (typeof v === "string" && v.startsWith("$U:")) {
			const varName = v.slice(3);
			const fromVars = vars[varName];
			if (fromVars !== undefined) {
				(resolved as Record<string, unknown>)[key] = fromVars;
			}
		}
	}

	if (resolved.children) {
		resolved.children = resolved.children.map((c) => resolveNode(c, vars));
	}
	return resolved;
}

function applyDescendant(
	child: PenNode,
	descendants: Record<string, Partial<PenNode>> | undefined,
): PenNode {
	if (!descendants) return child;
	const patch = descendants[child.id];
	if (!patch) return child;
	return { ...child, ...patch };
}
