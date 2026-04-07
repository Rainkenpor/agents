import { onUnmounted, ref } from 'vue';
import { useRepoStore } from '../stores/repoStore';
import { useNotificationStore } from '../stores/notificationStore';

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

type WsMessage =
  | { event: 'branch_changed'; payload: BranchChangedPayload }
  | { event: 'repo_status_changed'; payload: RepoStatusChangedPayload }
  | { event: 'branches_refreshed'; payload: BranchesRefreshedPayload };

let sharedWs: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1000;
const wsStatus = ref<'CONNECTING' | 'OPEN' | 'CLOSED'>('CLOSED');

function getWsUrl() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

function connect(repoStore: ReturnType<typeof useRepoStore>, notifStore: ReturnType<typeof useNotificationStore>) {
  if (sharedWs && sharedWs.readyState <= 1) return;

  wsStatus.value = 'CONNECTING';
  sharedWs = new WebSocket(getWsUrl());

  sharedWs.onopen = () => {
    wsStatus.value = 'OPEN';
    reconnectDelay = 1000;
    console.log('[WS] Connected');
  };

  sharedWs.onmessage = (event) => {
    try {
      const msg: WsMessage = JSON.parse(event.data as string);
      if (msg.event === 'branch_changed') {
        repoStore.applyBranchChanged(msg.payload);
        notifStore.push(msg.payload);
      } else if (msg.event === 'repo_status_changed') {
        repoStore.applyRepoStatusChanged(msg.payload);
      } else if (msg.event === 'branches_refreshed') {
        repoStore.applyBranchesRefreshed(msg.payload);
      }
    } catch {
      // ignore malformed messages
    }
  };

  sharedWs.onclose = () => {
    wsStatus.value = 'CLOSED';
    console.log(`[WS] Disconnected — reconnecting in ${reconnectDelay}ms`);
    reconnectTimer = setTimeout(() => {
      reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
      connect(repoStore, notifStore);
    }, reconnectDelay);
  };

  sharedWs.onerror = () => {
    sharedWs?.close();
  };
}

export function useWebSocket() {
  const repoStore = useRepoStore();
  const notifStore = useNotificationStore();

  connect(repoStore, notifStore);

  onUnmounted(() => {
    // Don't disconnect on component unmount since it's a shared singleton
  });

  function disconnect() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    sharedWs?.close();
    sharedWs = null;
  }

  return { status: wsStatus, disconnect };
}
