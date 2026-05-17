import fs from "node:fs";
import path from "node:path";
import { envs } from "../util/envs";
import type { PenDoc, PenNode } from "./schema";

let libCache: Map<string, PenDoc> | null = null;

function loadLibMap(): Map<string, PenDoc> {
	if (libCache) return libCache;
	libCache = new Map();
	const raw = envs.PENCIL_LIB_PATHS;
	if (!raw) return libCache;
	try {
		const map = JSON.parse(raw) as Record<string, string>;
		for (const [key, p] of Object.entries(map)) {
			const abs = path.resolve(p);
			if (fs.existsSync(abs)) {
				const content = fs.readFileSync(abs, "utf8");
				libCache.set(key, JSON.parse(content) as PenDoc);
			}
		}
	} catch (err) {
		console.warn("[lib-resolver] failed to load PENCIL_LIB_PATHS:", err);
	}
	return libCache;
}

/**
 * Looks up a node referenced by `pencil:lib.pen#nodeId` style strings.
 * Returns null if the library file isn't configured.
 */
export function resolveRef(ref: string): PenNode | null {
	const libs = loadLibMap();
	if (libs.size === 0) return null;
	const [libKey, nodeId] = ref.split("#");
	const lib = libs.get(libKey);
	if (!lib || !nodeId) return null;
	const found = walkFind(lib.children, nodeId);
	return found;
}

function walkFind(nodes: PenNode[] | undefined, id: string): PenNode | null {
	if (!nodes) return null;
	for (const n of nodes) {
		if (n.id === id) return n;
		const child = walkFind(n.children, id);
		if (child) return child;
	}
	return null;
}
