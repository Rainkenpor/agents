/**
 * RepositoryService — manage git repositories identified by UUID.
 *
 * Each (url + branch) clone lives in its own folder named after a generated
 * UUID, so multiple MCPs can work on the same remote repository with different
 * branches (or even the same branch) without path collisions.
 *
 * Storage layout (relative to project root):
 *   data/repos/<id>/          ← git working tree
 *   data/workspace/repos.json ← registry mapping id → { url, branch, path, ... }
 *
 * All git commands are executed via child_process.exec and are promisified.
 */

import fs from "node:fs";
import nodePath from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import type { RepoEntry, WorkspaceConfig } from "./types.ts";
import { workspaceLogger } from "./util/logger.ts";

const execAsync = promisify(exec);

const DEFAULT_DATA_DIR = nodePath.join(process.cwd(), "data", "workspace");
const DEFAULT_REPOS_DIR = nodePath.join(process.cwd(), "data", "repos");

export class RepositoryService {
  private readonly registryPath: string;
  private readonly reposDir: string;

  constructor(config: WorkspaceConfig = {}) {
    const dataDir = config.dataDir ?? DEFAULT_DATA_DIR;
    this.reposDir = config.reposDir ?? DEFAULT_REPOS_DIR;
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(this.reposDir, { recursive: true });
    this.registryPath = nodePath.join(dataDir, "repos.json");
  }

  // ── Registry helpers ────────────────────────────────────────────────────────

  private loadRegistry(): RepoEntry[] {
    if (!fs.existsSync(this.registryPath)) return [];
    try {
      return JSON.parse(fs.readFileSync(this.registryPath, "utf-8")) as RepoEntry[];
    } catch {
      return [];
    }
  }

  private saveRegistry(entries: RepoEntry[]): void {
    fs.writeFileSync(this.registryPath, JSON.stringify(entries, null, 2), "utf-8");
  }

  private getEntry(repoId: string): RepoEntry {
    const entry = this.loadRegistry().find((r) => r.id === repoId);
    if (!entry) throw new Error(`Repository not found in registry: ${repoId}`);
    if (!fs.existsSync(entry.path)) {
      throw new Error(
        `Repository folder is missing on disk (was it closed?): ${entry.path}`,
      );
    }
    return entry;
  }

  // ── Git command helper ──────────────────────────────────────────────────────

  private async git(repoPath: string, args: string): Promise<string> {
    const cmd = `git -C "${repoPath}" ${args}`;
    workspaceLogger.info(`[repo] git ${args} → ${repoPath}`);
    const { stdout, stderr } = await execAsync(cmd, { timeout: 120_000 });
    if (stderr?.trim()) workspaceLogger.info(`[repo] stderr: ${stderr.trim()}`);
    return stdout.trim();
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Clone a remote repository at a specific branch into a new UUID-named folder.
   * If a clone of the same (url + branch) already exists in the registry, its
   * existing ID is returned instead of cloning again.
   *
   * @returns The registry entry (id, path, url, branch).
   */
  async clone(
    url: string,
    branch: string,
    options: { label?: string; force?: boolean } = {},
  ): Promise<RepoEntry> {
    const registry = this.loadRegistry();

    // Reuse existing clone unless force is requested
    if (!options.force) {
      const existing = registry.find(
        (r) => r.url === url && r.branch === branch && fs.existsSync(r.path),
      );
      if (existing) {
        workspaceLogger.info(`[repo] reusing existing clone ${existing.id} for ${url}@${branch}`);
        return existing;
      }
    }

    const id = randomUUID();
    const repoPath = nodePath.join(this.reposDir, id);
    fs.mkdirSync(repoPath, { recursive: true });

    workspaceLogger.info(`[repo] cloning ${url}@${branch} → ${repoPath}`);
    await execAsync(
      `git clone --branch "${branch}" --single-branch "${url}" "${repoPath}"`,
      { timeout: 300_000 },
    );

    const entry: RepoEntry = {
      id,
      url,
      branch,
      path: repoPath,
      clonedAt: new Date().toISOString(),
      label: options.label,
    };

    registry.push(entry);
    this.saveRegistry(registry);
    workspaceLogger.info(`[repo] cloned → id=${id}`);
    return entry;
  }

  /**
   * Read a file inside a repository. Throws if repo or file is not found.
   */
  readFile(repoId: string, filePath: string): string {
    const entry = this.getEntry(repoId);
    const abs = nodePath.join(entry.path, filePath);
    if (!fs.existsSync(abs)) throw new Error(`File not found: ${filePath}`);
    return fs.readFileSync(abs, "utf-8");
  }

  /**
   * Create or overwrite a file inside a repository.
   */
  writeFile(repoId: string, filePath: string, content: string): void {
    const entry = this.getEntry(repoId);
    const abs = nodePath.join(entry.path, filePath);
    fs.mkdirSync(nodePath.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf-8");
    workspaceLogger.info(`[repo:${repoId}] write → ${filePath}`);
  }

  /**
   * Delete a tracked file from the repository (stages the removal with git rm).
   * Falls back to plain `fs.unlinkSync` if the file is untracked.
   */
  async deleteFile(repoId: string, filePath: string): Promise<void> {
    const entry = this.getEntry(repoId);
    const abs = nodePath.join(entry.path, filePath);
    if (!fs.existsSync(abs)) throw new Error(`File not found: ${filePath}`);

    try {
      await this.git(entry.path, `rm -f "${filePath}"`);
    } catch {
      // File might be untracked — remove from disk directly
      fs.unlinkSync(abs);
    }
    workspaceLogger.info(`[repo:${repoId}] delete → ${filePath}`);
  }

  /**
   * Move or rename a file / directory inside a repository using `git mv`.
   */
  async move(repoId: string, from: string, to: string): Promise<void> {
    const entry = this.getEntry(repoId);
    const absTo = nodePath.join(entry.path, to);
    fs.mkdirSync(nodePath.dirname(absTo), { recursive: true });
    await this.git(entry.path, `mv "${from}" "${to}"`);
    workspaceLogger.info(`[repo:${repoId}] move ${from} → ${to}`);
  }

  /**
   * Create a directory inside the repository (git does not track empty dirs,
   * so a `.gitkeep` placeholder file is created automatically).
   */
  createDirectory(repoId: string, dirPath: string): void {
    const entry = this.getEntry(repoId);
    const abs = nodePath.join(entry.path, dirPath);
    fs.mkdirSync(abs, { recursive: true });
    // Ensure git tracks the directory
    const gitkeep = nodePath.join(abs, ".gitkeep");
    if (!fs.existsSync(gitkeep)) fs.writeFileSync(gitkeep, "", "utf-8");
    workspaceLogger.info(`[repo:${repoId}] mkdir → ${dirPath}`);
  }

  /**
   * List files and directories at a given path inside the repository.
   */
  listDirectory(repoId: string, dirPath = "."): string[] {
    const entry = this.getEntry(repoId);
    const abs = nodePath.join(entry.path, dirPath);
    if (!fs.existsSync(abs)) throw new Error(`Directory not found: ${dirPath}`);
    return fs
      .readdirSync(abs, { withFileTypes: true })
      .map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
  }

  /**
   * Stage all changes and create a commit.
   */
  async commit(
    repoId: string,
    message: string,
    options: { author?: string } = {},
  ): Promise<string> {
    const entry = this.getEntry(repoId);
    await this.git(entry.path, "add -A");
    const authorFlag = options.author
      ? `--author="${options.author} <noreply@workspace>"`
      : "";
    const out = await this.git(
      entry.path,
      `commit ${authorFlag} -m ${JSON.stringify(message)}`,
    );
    workspaceLogger.info(`[repo:${repoId}] commit: ${message}`);
    return out;
  }

  /**
   * Push the current branch to the remote.
   */
  async push(repoId: string): Promise<string> {
    const entry = this.getEntry(repoId);
    const out = await this.git(entry.path, `push origin ${entry.branch}`);
    workspaceLogger.info(`[repo:${repoId}] push`);
    return out;
  }

  /**
   * Pull the latest changes from the remote.
   */
  async pull(repoId: string): Promise<string> {
    const entry = this.getEntry(repoId);
    const out = await this.git(entry.path, `pull origin ${entry.branch}`);
    workspaceLogger.info(`[repo:${repoId}] pull`);
    return out;
  }

  /**
   * Get the current git status of a repository.
   */
  async status(repoId: string): Promise<string> {
    const entry = this.getEntry(repoId);
    return this.git(entry.path, "status --short");
  }

  /**
   * Get the recent commit log of a repository.
   */
  async log(repoId: string, limit = 10): Promise<string> {
    const entry = this.getEntry(repoId);
    return this.git(
      entry.path,
      `log --oneline -${limit}`,
    );
  }

  /**
   * Close (delete) a repository — removes the folder from disk and
   * the entry from the registry.
   */
  close(repoId: string): void {
    const registry = this.loadRegistry();
    const idx = registry.findIndex((r) => r.id === repoId);
    if (idx === -1) throw new Error(`Repository not found in registry: ${repoId}`);

    const entry = registry[idx];
    if (fs.existsSync(entry.path)) {
      fs.rmSync(entry.path, { recursive: true, force: true });
      workspaceLogger.info(`[repo:${repoId}] folder deleted: ${entry.path}`);
    }

    registry.splice(idx, 1);
    this.saveRegistry(registry);
    workspaceLogger.info(`[repo:${repoId}] closed and removed from registry`);
  }

  /**
   * Return all entries in the registry (including repos whose folders may have
   * been deleted externally — call `close()` to clean those up properly).
   */
  listRepos(): RepoEntry[] {
    return this.loadRegistry();
  }

  /**
   * Return a single registry entry by ID, or null if not found.
   */
  getRepo(repoId: string): RepoEntry | null {
    return this.loadRegistry().find((r) => r.id === repoId) ?? null;
  }
}
