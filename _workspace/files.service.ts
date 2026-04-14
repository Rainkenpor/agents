/**
 * FilesService — read, write, delete and move files with automatic history tracking.
 *
 * Every mutating operation is appended to a persistent JSON log so that any
 * MCP can later query what happened to a given path.
 *
 * History is stored at:
 *   <dataDir>/files-history.json   (default: <cwd>/data/workspace/files-history.json)
 */

import fs from "node:fs";
import nodePath from "node:path";
import { randomUUID } from "node:crypto";
import type { FileHistoryEntry, FileOperation, WorkspaceConfig } from "./types.ts";
import { workspaceLogger } from "./util/logger.ts";

const DEFAULT_DATA_DIR = nodePath.join(process.cwd(), "data", "workspace");
const DEFAULT_HISTORY_LIMIT = 2_000;

export class FilesService {
  private readonly historyPath: string;
  private readonly historyLimit: number;

  constructor(config: WorkspaceConfig = {}) {
    const dataDir = config.dataDir ?? DEFAULT_DATA_DIR;
    fs.mkdirSync(dataDir, { recursive: true });
    this.historyPath = nodePath.join(dataDir, "files-history.json");
    this.historyLimit = config.historyLimit ?? DEFAULT_HISTORY_LIMIT;
  }

  // ── History helpers ─────────────────────────────────────────────────────────

  private loadHistory(): FileHistoryEntry[] {
    if (!fs.existsSync(this.historyPath)) return [];
    try {
      return JSON.parse(fs.readFileSync(this.historyPath, "utf-8")) as FileHistoryEntry[];
    } catch {
      return [];
    }
  }

  private saveHistory(entries: FileHistoryEntry[]): void {
    // Keep only the most recent entries
    const pruned = entries.slice(-this.historyLimit);
    fs.writeFileSync(this.historyPath, JSON.stringify(pruned, null, 2), "utf-8");
  }

  private appendHistory(entry: Omit<FileHistoryEntry, "id" | "timestamp">): void {
    const history = this.loadHistory();
    history.push({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      ...entry,
    });
    this.saveHistory(history);
    workspaceLogger.info(`[files] ${entry.operation} → ${entry.path}`);
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Read a file and return its content together with the history for that path.
   */
  readFile(
    filePath: string,
    actor?: string,
  ): { content: string; history: FileHistoryEntry[] } {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    const content = fs.readFileSync(filePath, "utf-8");
    this.appendHistory({ operation: "read", path: filePath, actor });
    const history = this.getHistory(filePath);
    return { content, history };
  }

  /**
   * Write (create or overwrite) a file, creating parent directories as needed.
   */
  writeFile(
    filePath: string,
    content: string,
    options: { message?: string; actor?: string } = {},
  ): void {
    fs.mkdirSync(nodePath.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf-8");
    this.appendHistory({
      operation: "write",
      path: filePath,
      message: options.message,
      actor: options.actor,
    });
  }

  /**
   * Delete a file. Throws if the file does not exist.
   */
  deleteFile(
    filePath: string,
    options: { message?: string; actor?: string } = {},
  ): void {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    fs.unlinkSync(filePath);
    this.appendHistory({
      operation: "delete",
      path: filePath,
      message: options.message,
      actor: options.actor,
    });
  }

  /**
   * Move or rename a file / directory.
   */
  move(
    fromPath: string,
    toPath: string,
    options: { message?: string; actor?: string } = {},
  ): void {
    if (!fs.existsSync(fromPath)) {
      throw new Error(`Source not found: ${fromPath}`);
    }
    fs.mkdirSync(nodePath.dirname(toPath), { recursive: true });
    fs.renameSync(fromPath, toPath);
    this.appendHistory({
      operation: "move",
      path: toPath,
      oldPath: fromPath,
      message: options.message,
      actor: options.actor,
    });
  }

  /**
   * Create a directory (including all parent directories).
   */
  createDirectory(
    dirPath: string,
    options: { actor?: string } = {},
  ): void {
    fs.mkdirSync(dirPath, { recursive: true });
    this.appendHistory({ operation: "mkdir", path: dirPath, actor: options.actor });
  }

  /**
   * List entries in a directory.
   * Returns relative names with a trailing `/` for sub-directories.
   */
  listDirectory(dirPath: string): string[] {
    if (!fs.existsSync(dirPath)) {
      throw new Error(`Directory not found: ${dirPath}`);
    }
    return fs
      .readdirSync(dirPath, { withFileTypes: true })
      .map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
  }

  /**
   * Return history entries, optionally filtered to a specific path.
   */
  getHistory(filePath?: string): FileHistoryEntry[] {
    const all = this.loadHistory();
    if (!filePath) return all;
    return all.filter((e) => e.path === filePath || e.oldPath === filePath);
  }

  /**
   * Clear all history entries.
   */
  clearHistory(): void {
    this.saveHistory([]);
    workspaceLogger.info("[files] history cleared");
  }
}
