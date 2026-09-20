<script setup>
import { onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import TabBar from './components/TabBar.vue';
import IdentityConfirm from './components/IdentityConfirm.vue';
import { useUserStore } from './stores/user.js';
import { setNavTitle } from './utils/dingtalk.js';

const route = useRoute();
const { state, bootstrap } = useUserStore();

onMounted(() => {
  bootstrap();
});

watch(
  () => route.meta.title,
  (title) => {
    if (title) setNavTitle(title);
  },
  { immediate: true },
);
</script>

<template>
  <div class="app-shell">
    <div v-if="state.loading" class="loading-wrap">
      <div class="spinner" />
      <p class="muted">{{ state.loginStep || '正在登录…' }}</p>
    </div>

    <div v-else-if="state.error" class="page">
      <div class="card error-card">
        <h2>无法进入应用</h2>
        <p class="muted">{{ state.error }}</p>
        <p class="hint muted">
          请确认：本机穿透仍开着；开放平台「网页应用首页 / 安全设置」已是当前 https 地址；
          CorpId 为 ding 开头（凭证与基础信息里复制）。
        </p>
        <button class="btn-primary" type="button" @click="bootstrap">重试</button>
      </div>
    </div>

    <template v-else>
      <main class="main">
        <router-view />
      </main>
      <TabBar v-if="state.ready" />
      <IdentityConfirm />
    </template>
  </div>
</template>

<style scoped>
.app-shell {
  min-height: 100%;
  display: flex;
  flex-direction: column;
}

.main {
  flex: 1;
  padding-bottom: calc(56px + var(--safe-bottom));
}

.error-card h2 {
  font-size: 18px;
  margin-bottom: 8px;
}

.error-card p {
  margin-bottom: 16px;
  line-height: 1.5;
}

.hint {
  font-size: 13px;
  margin-top: -8px;
}
</style>
