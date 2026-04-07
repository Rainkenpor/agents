<script setup lang="ts">
import { useNotificationStore } from '../stores/notificationStore';

const store = useNotificationStore();

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
</script>

<template>
  <div class="rounded-xl border border-gray-700 bg-gray-900 overflow-hidden">
    <div class="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
      <h3 class="text-sm font-semibold text-white">Actividad reciente</h3>
      <button
        v-if="store.events.length"
        @click="store.clear()"
        class="text-xs text-gray-500 hover:text-gray-300 transition-colors"
      >
        Limpiar
      </button>
    </div>

    <div class="max-h-80 overflow-y-auto">
      <div v-if="store.events.length === 0" class="px-4 py-6 text-center text-sm text-gray-600">
        Sin actividad aún
      </div>
      <div
        v-for="ev in store.events"
        :key="ev.id"
        class="px-4 py-2.5 border-b border-gray-800/50 last:border-0 hover:bg-gray-800/30 transition-colors"
      >
        <div class="flex items-center justify-between gap-2">
          <div class="min-w-0">
            <p class="text-xs text-white">
              <span class="text-green-400 font-medium">{{ ev.repoName }}</span>
              <span class="text-gray-500 mx-1">/</span>
              <span class="font-mono text-yellow-300">{{ ev.branch }}</span>
            </p>
            <p class="text-xs text-gray-500 font-mono mt-0.5">
              {{ ev.previousSha.slice(0, 7) }} → {{ ev.newSha.slice(0, 7) }}
            </p>
            <p v-if="ev.lastCommitMessage" class="text-xs text-gray-600 italic truncate mt-0.5">
              "{{ ev.lastCommitMessage }}"
            </p>
          </div>
          <span class="text-xs text-gray-600 shrink-0">{{ formatTime(ev.detectedAt) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
