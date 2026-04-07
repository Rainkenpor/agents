<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import type { Repo } from '../services/api';
import { useRepoStore } from '../stores/repoStore';
import BranchRow from './BranchRow.vue';

const props = defineProps<{ repo: Repo }>();
const repoStore = useRepoStore();
const router = useRouter();

const deleting = ref(false);
const polling = ref(false);
const confirmDelete = ref(false);

async function handleDelete() {
  if (!confirmDelete.value) {
    confirmDelete.value = true;
    setTimeout(() => (confirmDelete.value = false), 3000);
    return;
  }
  deleting.value = true;
  try {
    await repoStore.removeRepo(props.repo.id);
  } finally {
    deleting.value = false;
    confirmDelete.value = false;
  }
}

async function handlePoll() {
  polling.value = true;
  try {
    await repoStore.pollRepo(props.repo.id);
  } finally {
    setTimeout(() => (polling.value = false), 1000);
  }
}

const statusConfig = {
  active: { label: 'Activo', class: 'bg-green-500/15 text-green-400 border-green-500/30' },
  cloning: { label: 'Clonando...', class: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30' },
  error: { label: 'Error', class: 'bg-red-500/15 text-red-400 border-red-500/30' },
};
</script>

<template>
  <div class="rounded-xl border border-gray-700 bg-gray-900 overflow-hidden">
    <!-- Header -->
    <div class="px-4 py-3 flex items-start justify-between gap-3 border-b border-gray-800">
      <div class="min-w-0">
        <button
          @click="router.push(`/repos/${repo.id}`)"
          class="text-base font-semibold text-white hover:text-green-400 transition-colors truncate block"
        >
          {{ repo.name }}
        </button>
        <p class="text-xs text-gray-500 truncate mt-0.5">{{ repo.url }}</p>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <span
          :class="['text-xs px-2 py-0.5 rounded border font-medium', statusConfig[repo.status].class]"
        >
          {{ statusConfig[repo.status].label }}
        </span>
      </div>
    </div>

    <!-- Error message -->
    <div v-if="repo.status === 'error' && repo.errorMessage" class="px-4 py-2 bg-red-950/30 text-xs text-red-400">
      {{ repo.errorMessage }}
    </div>

    <!-- Cloning spinner -->
    <div v-if="repo.status === 'cloning'" class="px-4 py-4 flex items-center gap-3 text-sm text-gray-400">
      <svg class="w-4 h-4 animate-spin text-yellow-400" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      Clonando repositorio...
    </div>

    <!-- Branches list -->
    <div v-else-if="repo.branches.length > 0" class="px-4 py-3 flex flex-col gap-1.5">
      <BranchRow v-for="branch in repo.branches" :key="branch.id" :branch="branch" />
    </div>
    <div v-else-if="repo.status === 'active'" class="px-4 py-3 text-sm text-gray-500 italic">
      Sin ramas encontradas
    </div>

    <!-- Footer -->
    <div class="px-4 py-2 border-t border-gray-800 flex items-center justify-between">
      <span class="text-xs text-gray-600">
        {{ repo.branches.length }} {{ repo.branches.length === 1 ? 'rama' : 'ramas' }}
      </span>
      <div class="flex items-center gap-2">
        <button
          v-if="repo.status === 'active'"
          @click="handlePoll"
          :disabled="polling"
          class="text-xs text-gray-400 hover:text-white disabled:opacity-50 transition-colors px-2 py-1 rounded hover:bg-gray-700"
        >
          <span v-if="polling">Verificando...</span>
          <span v-else>Verificar ahora</span>
        </button>
        <button
          @click="handleDelete"
          :disabled="deleting"
          :class="[
            'text-xs px-2 py-1 rounded transition-colors',
            confirmDelete
              ? 'bg-red-600 text-white hover:bg-red-500'
              : 'text-gray-500 hover:text-red-400 hover:bg-gray-800',
          ]"
        >
          {{ confirmDelete ? 'Confirmar' : 'Eliminar' }}
        </button>
      </div>
    </div>
  </div>
</template>
