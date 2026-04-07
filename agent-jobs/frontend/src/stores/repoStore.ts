import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api, type Branch, type Repo } from '../services/api';
import type { BranchChangedPayload, BranchesRefreshedPayload, RepoStatusChangedPayload } from '../composables/useWebSocket';

export const useRepoStore = defineStore('repos', () => {
  const repos = ref<Repo[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchRepos() {
    loading.value = true;
    error.value = null;
    try {
      repos.value = await api.getRepos();
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Error loading repos';
    } finally {
      loading.value = false;
    }
  }

  async function addRepo(url: string, name: string) {
    const newRepo = await api.addRepo(url, name);
    repos.value.push(newRepo);
    return newRepo;
  }

  async function removeRepo(id: number) {
    await api.deleteRepo(id);
    repos.value = repos.value.filter((r) => r.id !== id);
  }

  async function pollRepo(id: number) {
    return api.pollRepo(id);
  }

  // WebSocket mutations
  function applyRepoStatusChanged(payload: RepoStatusChangedPayload) {
    const repo = repos.value.find((r) => r.id === payload.repoId);
    if (repo) {
      repo.status = payload.status;
      repo.errorMessage = payload.errorMessage;
    }
  }

  function applyBranchesRefreshed(payload: BranchesRefreshedPayload) {
    const repo = repos.value.find((r) => r.id === payload.repoId);
    if (repo) {
      repo.branches = payload.branches as Branch[];
    }
  }

  function applyBranchChanged(payload: BranchChangedPayload) {
    const repo = repos.value.find((r) => r.id === payload.repoId);
    if (!repo) return;
    const branch = repo.branches.find((b) => b.name === payload.branch);
    if (branch) {
      branch.headSha = payload.newSha;
      branch.lastCommitMessage = payload.lastCommitMessage;
      branch.updatedAt = payload.detectedAt;
    }
  }

  return {
    repos,
    loading,
    error,
    fetchRepos,
    addRepo,
    removeRepo,
    pollRepo,
    applyRepoStatusChanged,
    applyBranchesRefreshed,
    applyBranchChanged,
  };
});
