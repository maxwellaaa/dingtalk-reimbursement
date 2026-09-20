<script setup>
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';

const route = useRoute();
const router = useRouter();

const tabs = [
  { path: '/', label: '首页', icon: '⌂' },
  { path: '/reports', label: '总览', icon: '▦' },
  { path: '/reimb', label: '报销', icon: '☰' },
  { path: '/approve', label: '待办', icon: '✓' },
  { path: '/profile', label: '我的', icon: '○' },
];

const active = computed(() => route.path);

function go(path) {
  if (active.value !== path) {
    router.push(path);
  }
}
</script>

<template>
  <nav class="tabbar">
    <button
      v-for="tab in tabs"
      :key="tab.path"
      type="button"
      class="tab"
      :class="{ active: active === tab.path || (tab.path !== '/' && active.startsWith(tab.path)) }"
      @click="go(tab.path)"
    >
      <span class="icon">{{ tab.icon }}</span>
      <span class="label">{{ tab.label }}</span>
    </button>
  </nav>
</template>

<style scoped>
.tabbar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  background: #fff;
  border-top: 1px solid var(--color-border);
  padding-bottom: var(--safe-bottom);
  z-index: 100;
}

.tab {
  flex: 1;
  border: none;
  background: none;
  padding: 8px 0 6px;
  color: var(--color-muted);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.tab.active {
  color: var(--color-primary);
}

.icon {
  font-size: 18px;
  line-height: 1;
}

.label {
  font-size: 11px;
}
</style>
