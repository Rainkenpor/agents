<script setup lang="ts">
import { onMounted } from 'vue';
import { RouterView } from 'vue-router';
import { useWebSocket } from './composables/useWebSocket';
import { useRepoStore } from './stores/repoStore';
import NotificationToast from './components/NotificationToast.vue';

const { status } = useWebSocket();
const repoStore = useRepoStore();

onMounted(() => {
  repoStore.fetchRepos();
});
</script>

<template>
  <div class="min-h-screen bg-gray-950 text-gray-100">
    <!-- Header -->
    <header class="border-b border-gray-800 bg-gray-900">
      <div class="mx-auto max-w-7xl px-4 py-3 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <svg class="w-6 h-6 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
          </svg>
          <RouterLink to="/" class="text-lg font-semibold text-white hover:text-green-400 transition-colors">
            Git Watcher
          </RouterLink>
        </div>
        <!-- WS status indicator -->
        <div class="flex items-center gap-2 text-sm">
          <span
            :class="[
              'w-2 h-2 rounded-full',
              status === 'OPEN' ? 'bg-green-400' : status === 'CONNECTING' ? 'bg-yellow-400 animate-pulse' : 'bg-red-500'
            ]"
          />
          <span class="text-gray-400">
            {{ status === 'OPEN' ? 'Conectado' : status === 'CONNECTING' ? 'Conectando...' : 'Desconectado' }}
          </span>
        </div>
      </div>
    </header>

    <main class="mx-auto max-w-7xl px-4 py-8">
      <RouterView />
    </main>

    <NotificationToast />
  </div>
</template>
