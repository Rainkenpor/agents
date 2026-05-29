import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { envs } from "./envs";

export const paths = {
	root: envs.WORKSPACE_DIR,
	documents: join(envs.WORKSPACE_DIR, "documents"),
	templates: join(envs.WORKSPACE_DIR, "templates"),
	palettes: join(envs.WORKSPACE_DIR, "palettes"),
	history: join(envs.WORKSPACE_DIR, "history"),
	tmp: join(envs.WORKSPACE_DIR, "tmp"),
};

export const docPath = (id: string) => join(paths.documents, `${id}.json`);
export const historyPath = (id: string) => join(paths.history, `${id}.jsonl`);
export const templatePath = (name: string) =>
	join(paths.templates, `${name}.json`);
export const palettePath = (name: string) =>
	join(paths.palettes, `${name}.json`);

let ensured = false;
export async function ensureWorkspace(): Promise<void> {
	if (ensured) return;
	await Promise.all([
		mkdir(paths.documents, { recursive: true }),
		mkdir(paths.templates, { recursive: true }),
		mkdir(paths.palettes, { recursive: true }),
		mkdir(paths.history, { recursive: true }),
		mkdir(paths.tmp, { recursive: true }),
	]);
	ensured = true;
}
