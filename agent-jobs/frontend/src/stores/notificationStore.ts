import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { BranchChangedPayload } from '../composables/useWebSocket';

export interface Notification extends BranchChangedPayload {
  id: string;
}

export const useNotificationStore = defineStore('notifications', () => {
  const events = ref<Notification[]>([]);

  function push(payload: BranchChangedPayload) {
    events.value.unshift({
      ...payload,
      id: `${payload.repoId}-${payload.branch}-${payload.detectedAt}`,
    });
    if (events.value.length > 100) {
      events.value = events.value.slice(0, 100);
    }
  }

  function clear() {
    events.value = [];
  }

  return { events, push, clear };
});
