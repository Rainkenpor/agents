<script setup lang="ts">
import { computed } from 'vue';
import { useRepoStore } from '../stores/repoStore';
import RepoForm from '../components/RepoForm.vue';
import RepoCard from '../components/RepoCard.vue';
import NotificationPanel from '../components/NotificationPanel.vue';

const repoStore = useRepoStore();

const stats = computed(() => ({
  total: repoStore.repos.length,
  active: repoStore.repos.filter((r) => r.status === 'active').length,
  branches: repoStore.repos.reduce((sum, r) => sum + r.branches.length, 0),
  errors: repoStore.repos.filter((r) => r.status === 'error').length,
}));
</script>

<template>
  <div class="flex flex-col gap-6">
    <!-- Stats row -->
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <div class="rounded-lg border border-gray-700 bg-gray-900 px-4 py-3">
        <p class="text-xs text-gray-500">Repositorios</p>
        <p class="text-2xl font-bold text-white mt-1">{{ stats.total }}</p>
      </div>
      <div class="rounded-lg border border-gray-700 bg-gray-900 px-4 py-3">
        <p class="text-xs text-gray-500">Activos</p>
        <p class="text-2xl font-bold text-green-400 mt-1">{{ stats.active }}</p>
      </div>
      <div class="rounded-lg border border-gray-700 bg-gray-900 px-4 py-3">
        <p class="text-xs text-gray-500">Ramas monitoreadas</p>
        <p class="text-2xl font-bold text-blue-400 mt-1">{{ stats.branches }}</p>
      </div>
      <div class="rounded-lg border border-gray-700 bg-gray-900 px-4 py-3">
        <p class="text-xs text-gray-500">Con errores</p>
        <p class="text-2xl font-bold text-red-400 mt-1">{{ stats.errors }}</p>
      </div>
    </div>

    <!-- Add repo form -->
    <RepoForm />

    <!-- Loading state -->
    <div v-if="repoStore.loading" class="flex items-center justify-center py-12 text-gray-500">
      <svg class="w-6 h-6 animate-spin mr-3" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      Cargando repositorios...
    </div>

    <!-- Error state -->
    <div v-else-if="repoStore.error" class="rounded-lg border border-red-800 bg-red-950/30 px-4 py-3 text-sm text-red-400">
      {{ repoStore.error }}
    </div>

    <!-- Empty state -->
    <div
      v-else-if="repoStore.repos.length === 0"
      class="flex flex-col items-center justify-center py-16 text-center"
    >
      <svg class="w-12 h-12 text-gray-700 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
          d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
      </svg>
      <p class="text-gray-500 text-sm">No hay repositorios agregados</p>
      <p class="text-gray-600 text-xs mt-1">Usa el formulario de arriba para agregar tu primer repo</p>
    </div>

    <!-- Main layout: repos + notifications -->
    <div v-else class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div class="lg:col-span-2 flex flex-col gap-4">
        <RepoCard v-for="repo in repoStore.repos" :key="repo.id" :repo="repo" />
      </div>
      <div>
        <NotificationPanel />
      </div>
    </div>
  </div>
</template>
