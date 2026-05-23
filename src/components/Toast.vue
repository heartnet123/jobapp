<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';

const props = withDefaults(
  defineProps<{
    message: string;
    type?: 'success' | 'info' | 'error';
    duration?: number;
  }>(),
  {
    type: 'success',
    duration: 3000,
  }
);

const emit = defineEmits<{
  (e: 'close'): void;
}>();

let timer: number | undefined;

onMounted(() => {
  timer = window.setTimeout(() => {
    emit('close');
  }, props.duration);
});

onUnmounted(() => {
  if (timer) clearTimeout(timer);
});
</script>

<template>
  <div class="toast-card" :class="`toast-${type}`" role="alert">
    <iconify-icon
      :icon="
        type === 'success'
          ? 'solar:check-circle-bold'
          : type === 'error'
            ? 'solar:danger-bold'
            : 'solar:info-circle-bold'
      "
      class="toast-icon"
    ></iconify-icon>
    <span class="toast-message">{{ message }}</span>
    <button type="button" class="toast-close" @click="emit('close')" aria-label="Close toast">
      <iconify-icon icon="solar:close-circle-linear"></iconify-icon>
    </button>
  </div>
</template>

<style scoped>
.toast-card {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-width: 18rem;
  max-width: 24rem;
  padding: 0.75rem 1rem;
  background: rgba(23, 23, 23, 0.85); /* 23, 23, 23 matches neutral-900 */
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: var(--radius-md, 0.5rem);
  box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(12px);
  color: var(--neutral-50);
  pointer-events: auto;
}

.toast-icon {
  font-size: 1.25rem;
}

.toast-success .toast-icon {
  color: var(--color-success);
}

.toast-success {
  border-left: 3px solid var(--color-success);
}

.toast-error .toast-icon {
  color: var(--color-danger);
}

.toast-error {
  border-left: 3px solid var(--color-danger);
}

.toast-info .toast-icon {
  color: var(--color-primary);
}

.toast-info {
  border-left: 3px solid var(--color-primary);
}

.toast-message {
  flex: 1;
  font-size: 0.875rem;
  font-weight: 500;
}

.toast-close {
  display: grid;
  place-items: center;
  background: transparent;
  border: 0;
  color: var(--neutral-500);
  font-size: 1.1rem;
  padding: 0;
  transition: color var(--transition-speed-fast);
}

.toast-close:hover {
  color: var(--neutral-100);
}
</style>
