<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useRepoStore } from '../stores/repoStore';
import BranchRow from '../components/BranchRow.vue';

const route = useRoute();
const router = useRouter();
const repoStore = useRepoStore();

const repoId = computed(() => Number(route.params.id));
const repo = computed(() => repoStore.repos.find((r) => r.id === repoId.value));

function formatDate(ts: number | null) {
  if (!ts) return 'Nunca';
  return new Date(ts).toLocaleString('es');
}
</script>

<template>
  <div v-if="!repo" class="py-12 text-center text-gray-500">
    Repositorio no encontrado.
    <RouterLink to="/" class="text-green-400 hover:underline ml-1">Volver al inicio</RouterLink>
  </div>

  <div v-else class="flex flex-col gap-6">
    <!-- Breadcrumb -->
    <div class="flex items-center gap-2 text-sm">
      <RouterLink to="/" class="text-gray-500 hover:text-white transition-colors">Inicio</RouterLink>
      <span class="text-gray-700">/</span>
      <span class="text-white">{{ repo.name }}</span>
    </div>

    <!-- Repo header -->
    <div class="rounded-xl border border-gray-700 bg-gray-900 p-6">
      <div class="flex items-start justify-between gap-4">
        <div>
          <h1 class="text-xl font-bold text-white">{{ repo.name }}</h1>
          <a :href="repo.url" target="_blank" class="text-sm text-green-400 hover:underline mt-1 block">
            {{ repo.url }}
          </a>
        </div>
        <span
          :class="[
            'text-sm px-3 py-1 rounded-full border font-medium',
            repo.status === 'active' ? 'bg-green-500/15 text-green-400 border-green-500/30' :
            repo.status === 'error' ? 'bg-red-500/15 text-red-400 border-red-500/30' :
            'bg-yellow-500/15 text-yellow-400 border-yellow-500/30'
          ]"
        >
          {{ repo.status === 'active' ? 'Activo' : repo.status === 'error' ? 'Error' : 'Clonando' }}
        </span>
      </div>

      <div class="grid grid-cols-2 sm:grid-cols-3 gap-4 mt-6 pt-4 border-t border-gray-800">
        <div>
          <p class="text-xs text-gray-500">Ramas</p>
          <p class="text-lg font-semibold text-white">{{ repo.branches.length }}</p>
        </div>
        <div>
          <p class="text-xs text-gray-500">Creado</p>
          <p class="text-sm text-gray-300">{{ formatDate(repo.createdAt) }}</p>
        </div>
        <div>
          <p class="text-xs text-gray-500">Última verificación</p>
          <p class="text-sm text-gray-300">{{ formatDate(repo.lastCheckedAt) }}</p>
        </div>
      </div>

      <div v-if="repo.errorMessage" class="mt-4 rounded-lg bg-red-950/30 border border-red-800 px-4 py-3 text-sm text-red-400">
        {{ repo.errorMessage }}
      </div>
    </div>

    <!-- Branches -->
    <div class="rounded-xl border border-gray-700 bg-gray-900 overflow-hidden">
      <div class="px-4 py-3 border-b border-gray-800">
        <h2 class="text-sm font-semibold text-white">Ramas ({{ repo.branches.length }})</h2>
      </div>
      <div class="p-4 flex flex-col gap-1.5">
        <div v-if="repo.branches.length === 0" class="py-6 text-center text-sm text-gray-600">
          Sin ramas detectadas
        </div>
        <BranchRow v-for="branch in repo.branches" :key="branch.id" :branch="branch" />
      </div>
    </div>

    <!-- Actions -->
    <div class="flex items-center gap-3">
      <button
        v-if="repo.status === 'active'"
        @click="repoStore.pollRepo(repo.id)"
        class="rounded-lg bg-gray-700 px-4 py-2 text-sm text-white hover:bg-gray-600 transition-colors"
      >
        Verificar ahora
      </button>
      <button
        @click="router.push('/')"
        class="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-400 hover:text-white hover:border-gray-500 transition-colors"
      >
        Volver
      </button>
    </div>
  </div>
</template>
