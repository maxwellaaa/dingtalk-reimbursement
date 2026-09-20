<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useUserStore } from '../stores/user.js';
import { api } from '../api/http.js';

const router = useRouter();
const { state } = useUserStore();
const projects = ref([]);

const canViewBudgetOverview = computed(
  () => !!state.user?.access?.canViewBudgetOverview,
);

onMounted(async () => {
  if (!canViewBudgetOverview.value) {
    projects.value = [];
    return;
  }
  try {
    const data = await api.listProjects();
    projects.value = (data.list || []).slice(0, 3);
  } catch {
    projects.value = [];
  }
});

const shortcuts = [
  { title: '新建报销', desc: '选择项目、填写明细', path: '/reimb/create', disabled: false },
  { title: '我的报销', desc: '查看审批进度', path: '/reimb', disabled: false },
  { title: '待办审批', desc: '自研审批 / OA 回写', path: '/approve', disabled: false },
  { title: '数据总览', desc: '公司/项目/年季月周/财务ABC', path: '/reports', disabled: false },
];
</script>

<template>
  <div class="page home">
    <section class="hero card">
      <p class="phase-tag">P5 · 部署运维就绪</p>
      <h1>园林协作报销</h1>
      <p class="muted">钉钉免登 · 自研审批 / OA 可切换</p>
      <div v-if="state.user" class="user-chip">
        <span>{{ state.user.name || state.user.userId }}</span>
        <span v-if="state.user.title" class="muted"> · {{ state.user.title }}</span>
      </div>
      <p v-if="state.user?.access?.scopeLabel" class="scope-hint">{{ state.user.access.scopeLabel }}</p>
    </section>

    <section class="card">
      <h2 class="section-title">快捷入口</h2>
      <div class="grid">
        <button
          v-for="item in shortcuts"
          :key="item.title"
          type="button"
          class="shortcut"
          :disabled="item.disabled"
          @click="router.push(item.path)"
        >
          <strong>{{ item.title }}</strong>
          <span class="muted">{{ item.desc }}</span>
        </button>
      </div>
    </section>

    <section class="card">
      <h2 class="section-title">实施进度</h2>
      <ul class="timeline">
        <li class="done"><span>P0</span> 钉钉应用 + 免登 + H5 骨架</li>
        <li class="done"><span>P1</span> 报销 CRUD、项目、附件</li>
        <li class="done"><span>P2</span> 审批流 + OA 对接</li>
        <li class="done"><span>P3</span> 发票查重、预算、看板</li>
        <li class="done"><span>P4</span> 钉钉 OA 事件回写</li>
        <li class="done"><span>P5</span> 部署、备份、运维手册</li>
      </ul>
    </section>

    <section v-if="canViewBudgetOverview && projects.length" class="card">
      <h2 class="section-title">项目预算</h2>
      <div class="grid">
        <button
          v-for="p in projects"
          :key="p.id"
          type="button"
          class="shortcut"
          @click="router.push(`/projects/${p.id}/dashboard`)"
        >
          <strong>{{ p.code }}</strong>
          <span class="muted">{{ p.name }}</span>
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.hero h1 {
  font-size: 22px;
  margin: 8px 0 4px;
}

.phase-tag {
  display: inline-block;
  font-size: 12px;
  color: var(--color-primary);
  background: #e8f3ff;
  padding: 2px 8px;
  border-radius: 999px;
}

.user-chip {
  margin-top: 12px;
  font-size: 14px;
}

.scope-hint {
  margin-top: 6px;
  font-size: 12px;
  color: #1677ff;
}

.section-title {
  font-size: 15px;
  margin-bottom: 12px;
}

.grid {
  display: grid;
  gap: 10px;
}

.shortcut {
  text-align: left;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  padding: 12px;
  background: #fafbfc;
}

.shortcut:disabled {
  opacity: 0.5;
}

.shortcut strong {
  display: block;
  margin-bottom: 4px;
}

.timeline {
  list-style: none;
  display: grid;
  gap: 10px;
}

.timeline li {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
  color: var(--color-muted);
}

.timeline li span {
  display: inline-flex;
  width: 28px;
  height: 28px;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: var(--color-border);
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text);
}

.timeline li.done {
  color: var(--color-text);
}

.timeline li.done span {
  background: #e6fffb;
  color: var(--color-success);
}
</style>
