/**
 * _workspace — File & Repository management for MCP servers
 *
 * Provides two services that MCP tools can import and use:
 *
 *   FilesService      — read / write / delete / move files with history tracking
 *   RepositoryService — clone, edit, commit, push/pull and close git repositories
 *
 * Both services are safe to use as singletons: instantiate once and share across
 * all tool handlers within the same MCP module.
 *
 * Quick start:
 *   import { FilesService, RepositoryService } from "../_workspace/index.ts";
 *
 *   const files = new FilesService();
 *   const repos  = new RepositoryService();
 */

export { FilesService } from "./files.service.ts";
export { RepositoryService } from "./repository.service.ts";
export type {
  RepoEntry,
  FileHistoryEntry,
  FileOperation,
  WorkspaceConfig,
} from "./types.ts";
