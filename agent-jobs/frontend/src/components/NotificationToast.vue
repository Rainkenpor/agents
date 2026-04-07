<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useNotificationStore } from '../stores/notificationStore';

const store = useNotificationStore();
const visible = ref(false);
const current = ref(store.events[0]);

watch(
  () => store.events[0],
  (newEvent) => {
    if (!newEvent) return;
    current.value = newEvent;
    visible.value = true;
    setTimeout(() => (visible.value = false), 4000);
  },
);

const shortSha = computed(() => current.value?.newSha?.slice(0, 7) ?? '');
</script>

<template>
  <Transition
    enter-active-class="transition-all duration-300 ease-out"
    enter-from-class="opacity-0 translate-y-2"
    enter-to-class="opacity-100 translate-y-0"
    leave-active-class="transition-all duration-200 ease-in"
    leave-from-class="opacity-100 translate-y-0"
    leave-to-class="opacity-0 translate-y-2"
  >
    <div
      v-if="visible && current"
      class="fixed bottom-4 right-4 z-50 max-w-sm rounded-xl border border-green-500/30 bg-gray-900 shadow-2xl shadow-black/50 p-4"
    >
      <div class="flex items-start gap-3">
        <div class="mt-0.5 w-2 h-2 rounded-full bg-green-400 shrink-0 animate-pulse" />
        <div class="min-w-0">
          <p class="text-sm font-medium text-white">Rama actualizada</p>
          <p class="text-xs text-gray-400 mt-0.5">
            <span class="text-green-400">{{ current.repoName }}</span>
            /
            <span class="font-mono text-yellow-300">{{ current.branch }}</span>
          </p>
          <p class="text-xs text-gray-500 mt-1 font-mono">
            {{ current.previousSha.slice(0, 7) }}
            <span class="mx-1 text-gray-600">→</span>
            {{ shortSha }}
          </p>
          <p v-if="current.lastCommitMessage" class="text-xs text-gray-400 mt-1 truncate italic">
            "{{ current.lastCommitMessage }}"
          </p>
        </div>
        <button @click="visible = false" class="text-gray-600 hover:text-gray-400 shrink-0">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  </Transition>
</template>
