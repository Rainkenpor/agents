// ── Repository Registry ───────────────────────────────────────────────────────

/**
 * Entry stored in the repository registry (repos.json).
 * Each (url + branch) combination that has been cloned gets its own ID,
 * so multiple MCPs can work on the same repository with different branches
 * without collisions.
 */
export interface RepoEntry {
  /** Unique identifier (UUID v4) — also the folder name under data/repos/ */
  id: string;
  /** Remote URL of the repository */
  url: string;
  /** Branch that was checked out at clone time */
  branch: string;
  /** Absolute path to the cloned working directory */
  path: string;
  /** ISO-8601 timestamp of when the repo was cloned */
  clonedAt: string;
  /** Optional human-readable label */
  label?: string;
}

// ── File History ──────────────────────────────────────────────────────────────

export type FileOperation = "read" | "write" | "delete" | "move" | "mkdir";

/**
 * Single entry in the file-operation history log.
 */
export interface FileHistoryEntry {
  /** Unique ID for this history record */
  id: string;
  /** ISO-8601 timestamp */
  timestamp: string;
  /** Type of operation performed */
  operation: FileOperation;
  /** Absolute path of the file / directory affected */
  path: string;
  /** Source path (only for `move` operations) */
  oldPath?: string;
  /** Optional human-readable note provided by the caller */
  message?: string;
  /** Which MCP / agent triggered this operation */
  actor?: string;
}

// ── Workspace Config ──────────────────────────────────────────────────────────

export interface WorkspaceConfig {
  /**
   * Root data directory.
   * FilesService stores history here; RepositoryService stores the registry
   * and repo folders here.
   * Defaults to `<cwd>/data/workspace`.
   */
  dataDir?: string;
  /**
   * Directory where git repos are cloned.
   * Defaults to `<cwd>/data/repos`.
   */
  reposDir?: string;
  /** Maximum number of history entries kept in the log (default: 2000) */
  historyLimit?: number;
}
