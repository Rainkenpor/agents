export interface Branch {
  id: number;
  repoId: number;
  name: string;
  headSha: string;
  lastCommitMessage: string | null;
  lastCommitDate: number | null;
  updatedAt: number;
}

export interface Repo {
  id: number;
  name: string;
  url: string;
  localPath: string;
  status: 'cloning' | 'active' | 'error';
  errorMessage: string | null;
  createdAt: number;
  lastCheckedAt: number | null;
  branches: Branch[];
}

const BASE = '/api/v1';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
  return data as T;
}

export const api = {
  getRepos: () => request<Repo[]>('/repos'),
  getRepo: (id: number) => request<Repo>(`/repos/${id}`),
  addRepo: (url: string, name: string) =>
    request<Repo>('/repos', { method: 'POST', body: JSON.stringify({ url, name }) }),
  deleteRepo: (id: number) => request<void>(`/repos/${id}`, { method: 'DELETE' }),
  pollRepo: (id: number) => request<{ queued: boolean }>(`/repos/${id}/poll`, { method: 'POST' }),
};
