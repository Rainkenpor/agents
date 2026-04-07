import { rm } from "fs/promises";
import { simpleGit } from "simple-git";

export interface BranchHead {
	sha: string;
	message: string;
	date: number;
}

export async function cloneRepo(url: string, destPath: string): Promise<void> {
	await simpleGit().clone(url, destPath, ["--no-single-branch"]);
}

export async function fetchAll(localPath: string): Promise<void> {
	await simpleGit(localPath).fetch(["--all", "--prune"]);
}

export async function listBranches(localPath: string): Promise<string[]> {
	const result = await simpleGit(localPath).branch(["-r"]);
	return Object.keys(result.branches)
		.filter((b) => !b.includes("HEAD"))
		.map((b) => b.replace(/^origin\//, "").trim())
		.filter((b, i, arr) => arr.indexOf(b) === i);
}

export async function getBranchHead(
	localPath: string,
	branch: string,
): Promise<BranchHead> {
	const git = simpleGit(localPath);
	const log = await git.log({
		from: `origin/${branch}`,
		to: `origin/${branch}`,
		maxCount: 1,
		"--no-walk": null as unknown as string,
	});

	if (!log.latest) {
		const refLog = await git.raw(["rev-parse", `origin/${branch}`]);
		const sha = refLog.trim();
		return { sha, message: "", date: Date.now() };
	}

	return {
		sha: log.latest.hash,
		message: log.latest.message,
		date: new Date(log.latest.date).getTime(),
	};
}

export interface BranchBirthInfo {
	/** Primer commit exclusivo de la rama (el primer commit hecho sobre ella). */
	birthSha: string;
	/**
	 * Commit de vínculo: el commit en la rama base justo antes del fork point.
	 * Es el padre del birthSha y representa la interacción con otra rama.
	 */
	linkSha: string | null;
}

/**
 * Encuentra el SHA del commit donde la rama nació, es decir, el commit más
 * antiguo que existe exclusivamente en `branch` y no en ninguna otra rama.
 * También retorna el commit de vínculo (padre del birthSha = fork point en la
 * rama base).
 * Devuelve `null` si la rama no tiene commits exclusivos.
 */
export async function getBranchBirthCommit(
	localPath: string,
	branch: string,
	allBranches: string[],
): Promise<BranchBirthInfo | null> {
	const git = simpleGit(localPath);

	const exclusions = allBranches
		.filter((b) => b !== branch)
		.map((b) => `^origin/${b}`);

	const result = await git.raw([
		"rev-list",
		`origin/${branch}`,
		...exclusions,
		"--reverse",
	]);

	const shas = result.trim().split("\n").filter(Boolean);
	const birthSha = shas[0];
	if (!birthSha) return null;

	let linkSha: string | null = null;
	try {
		const parentResult = await git.raw(["rev-parse", `${birthSha}^`]);
		linkSha = parentResult.trim() || null;
	} catch {
		// La rama nació en el commit raíz del repositorio — no tiene padre
		linkSha = null;
	}

	return { birthSha, linkSha };
}

export async function deleteRepoFolder(localPath: string): Promise<void> {
	await rm(localPath, { recursive: true, force: true });
}
