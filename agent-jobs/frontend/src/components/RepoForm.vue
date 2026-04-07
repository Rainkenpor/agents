<script setup lang="ts">
import { ref } from 'vue';
import { useRepoStore } from '../stores/repoStore';

const repoStore = useRepoStore();
const url = ref('');
const name = ref('');
const loading = ref(false);
const error = ref<string | null>(null);

async function submit() {
  if (!url.value.trim() || !name.value.trim()) return;
  loading.value = true;
  error.value = null;
  try {
    await repoStore.addRepo(url.value.trim(), name.value.trim());
    url.value = '';
    name.value = '';
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Error al agregar el repositorio';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="rounded-xl border border-gray-700 bg-gray-900 p-6">
    <h2 class="text-lg font-semibold text-white mb-4">Agregar Repositorio</h2>
    <form @submit.prevent="submit" class="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div class="flex-1">
        <label class="block text-xs text-gray-400 mb-1">Nombre</label>
        <input
          v-model="name"
          type="text"
          placeholder="mi-proyecto"
          class="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
          :disabled="loading"
        />
      </div>
      <div class="flex-[2]">
        <label class="block text-xs text-gray-400 mb-1">URL del repositorio</label>
        <input
          v-model="url"
          type="text"
          placeholder="https://github.com/usuario/repo.git"
          class="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
          :disabled="loading"
        />
      </div>
      <button
        type="submit"
        :disabled="loading || !url.trim() || !name.trim()"
        class="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-500 disabled:cursor-not-allowed disabled:opacity-50 transition-colors whitespace-nowrap"
      >
        <span v-if="loading" class="flex items-center gap-2">
          <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Clonando...
        </span>
        <span v-else>+ Agregar</span>
      </button>
    </form>
    <p v-if="error" class="mt-2 text-sm text-red-400">{{ error }}</p>
  </div>
</template>
