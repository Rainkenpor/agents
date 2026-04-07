import type { WebSocket } from '@fastify/websocket';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { branches, repos } from '../db/schema.js';

const clients = new Set<WebSocket>();

export type WsEvent =
  | { event: 'branch_changed'; payload: BranchChangedPayload }
  | { event: 'repo_status_changed'; payload: RepoStatusChangedPayload }
  | { event: 'branches_refreshed'; payload: BranchesRefreshedPayload };

export interface BranchChangedPayload {
  repoId: number;
  repoName: string;
  branch: string;
  previousSha: string;
  newSha: string;
  lastCommitMessage: string | null;
  detectedAt: number;
}

export interface RepoStatusChangedPayload {
  repoId: number;
  status: 'cloning' | 'active' | 'error';
  errorMessage: string | null;
  updatedAt: number;
}

export interface BranchesRefreshedPayload {
  repoId: number;
  branches: {
    id: number;
    name: string;
    headSha: string;
    lastCommitMessage: string | null;
    lastCommitDate: number | null;
    updatedAt: number;
  }[];
}

export function addClient(ws: WebSocket) {
  clients.add(ws);
  sendInitialSnapshot(ws);
}

export function removeClient(ws: WebSocket) {
  clients.delete(ws);
}

export function broadcast(wsEvent: WsEvent) {
  const message = JSON.stringify(wsEvent);
  for (const client of clients) {
    if (client.readyState === 1) {
      client.send(message);
    }
  }
}

async function sendInitialSnapshot(ws: WebSocket) {
  try {
    const allRepos = await db.select().from(repos).where(eq(repos.status, 'active'));
    for (const repo of allRepos) {
      const repoBranches = await db.select().from(branches).where(eq(branches.repoId, repo.id));
      const payload: BranchesRefreshedPayload = {
        repoId: repo.id,
        branches: repoBranches.map((b) => ({
          id: b.id,
          name: b.name,
          headSha: b.headSha,
          lastCommitMessage: b.lastCommitMessage,
          lastCommitDate: b.lastCommitDate,
          updatedAt: b.updatedAt,
        })),
      };
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ event: 'branches_refreshed', payload }));
      }
    }
  } catch (err) {
    console.error('[WS] Error sending initial snapshot:', err);
  }
}
