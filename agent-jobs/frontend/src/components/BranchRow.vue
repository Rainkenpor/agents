<script setup lang="ts">
import { ref, watch } from 'vue';
import type { Branch } from '../services/api';

const props = defineProps<{ branch: Branch }>();

const highlight = ref(false);

watch(
  () => props.branch.headSha,
  () => {
    highlight.value = true;
    setTimeout(() => (highlight.value = false), 2000);
  },
);

function formatDate(ts: number | null) {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `hace ${days}d`;
  if (hours > 0) return `hace ${hours}h`;
  if (mins > 0) return `hace ${mins}m`;
  return 'ahora';
}
</script>

<template>
  <div
    :class="[
      'flex items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors duration-700',
      highlight ? 'bg-yellow-500/15 border border-yellow-500/30' : 'bg-gray-800/50 border border-transparent hover:bg-gray-800',
    ]"
  >
    <div class="flex items-center gap-2 min-w-0">
      <svg class="w-3.5 h-3.5 text-gray-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
          d="M9 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V8l-5-5H9z" />
      </svg>
      <span class="font-mono text-xs text-green-300 truncate">{{ branch.name }}</span>
    </div>
    <div class="flex items-center gap-3 shrink-0 ml-2">
      <span class="font-mono text-xs text-gray-400 bg-gray-700 px-1.5 py-0.5 rounded">
        {{ branch.headSha.slice(0, 7) }}
      </span>
      <span class="text-xs text-gray-500 hidden sm:block">
        {{ formatDate(branch.updatedAt) }}
      </span>
    </div>
  </div>
</template>
