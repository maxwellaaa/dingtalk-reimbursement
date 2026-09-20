<script setup>
import { computed } from 'vue';
import { useUserStore } from '../stores/user.js';

const { state, confirmIdentity } = useUserStore();

const access = computed(() => state.user?.access || null);
const roleText = computed(() => access.value?.primaryRoleLabel || '员工');

async function onConfirm() {
  try {
    await confirmIdentity();
  } catch (err) {
    alert(err.message || '确认失败');
  }
}
</script>

<template>
  <div v-if="state.ready && state.user && !state.identityConfirmed" class="overlay" role="dialog" aria-modal="true">
    <div class="panel card">
      <h2>确认登录身份</h2>
      <p class="muted">后台将按以下身份隔离数据，请确认无误后再进入系统。</p>
      <dl class="meta">
        <div><dt>姓名</dt><dd>{{ state.user.name }}</dd></div>
        <div><dt>账号</dt><dd>{{ state.user.userId }}</dd></div>
        <div><dt>角色</dt><dd>{{ roleText }}</dd></div>
        <div><dt>可见范围</dt><dd>{{ access?.scopeLabel?.replace(/[ABC]档/g, '')?.replace(/·\s*$/, '') || '仅本人单据' }}</dd></div>
      </dl>
      <button
        type="button"
        class="btn-primary"
        :disabled="state.identityConfirming"
        @click="onConfirm"
      >
        {{ state.identityConfirming ? '确认中…' : '确认身份并进入' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.panel {
  width: min(420px, 100%);
  padding: 20px;
}

.panel h2 {
  font-size: 18px;
  margin-bottom: 8px;
}

.meta {
  margin: 16px 0 12px;
  display: grid;
  gap: 10px;
}

.meta > div {
  display: grid;
  grid-template-columns: 72px 1fr;
  gap: 8px;
  font-size: 14px;
}

.meta dt {
  color: var(--color-muted);
}

.meta dd {
  margin: 0;
  word-break: break-all;
}

.hint {
  font-size: 12px;
  line-height: 1.5;
  margin-bottom: 16px;
}

.btn-primary {
  width: 100%;
  border: none;
  border-radius: 10px;
  padding: 12px;
  background: var(--color-primary);
  color: #fff;
  font-size: 15px;
}
</style>
