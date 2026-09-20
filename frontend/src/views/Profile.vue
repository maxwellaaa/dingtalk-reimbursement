<script setup>
import { useRouter } from 'vue-router';
import { useUserStore } from '../stores/user.js';
import { api } from '../api/http.js';
import { toast } from '../utils/dingtalk.js';

const { state, logout, switchDevUser } = useUserStore();
const router = useRouter();

const personas = [
  { role: 'employee', label: '员工', hint: '仅本人单据' },
  { role: 'pm:A', label: '项目经理', hint: '项目 001' },
  { role: 'pm:B', label: '项目经理', hint: '项目 002' },
  { role: 'pm:C', label: '项目经理', hint: '项目 003' },
  { role: 'finance:A', label: '财务', hint: '项目级' },
  { role: 'finance:B', label: '财务', hint: '片区级' },
  { role: 'finance:C', label: '财务', hint: '全公司' },
  { role: 'gm:A', label: '总经理', hint: '全公司' },
  { role: 'gm:B', label: '总经理', hint: '全公司' },
  { role: 'gm:C', label: '总经理', hint: '全公司' },
];

async function switchRole(role) {
  const data = await api.devLogin(role === 'employee' ? undefined : role);
  switchDevUser(data.user, data.token, data.membership);
  const scope = data.user.access?.scopeLabel || '';
  toast(`已切换为 ${data.user.name}${scope ? `（${scope}）` : ''}`);
  if (role.startsWith('pm') || role.startsWith('finance') || role.startsWith('gm') || role === 'manager') {
    router.push('/approve');
  } else {
    router.push('/');
  }
}
</script>

<template>
  <div class="page profile">
    <section class="card profile-card" v-if="state.user">
      <div class="avatar">{{ (state.user.name || '?').slice(0, 1) }}</div>
      <div>
        <h2>{{ state.user.name || '未命名用户' }}</h2>
        <p class="muted">{{ state.user.title || '员工' }}</p>
        <p v-if="state.user.access?.scopeLabel" class="scope">{{ state.user.access.scopeLabel.replace(/[ABC]档/g, '').replace(/\s*·\s*$/, '').replace(/\s{2,}/g, ' ').trim() }}</p>
        <p class="muted uid">userid: {{ state.user.userId }}</p>
      </div>
    </section>

    <section class="card">
      <h3 class="section-title">环境</h3>
      <p class="row">
        <span>运行环境</span>
        <span>{{ state.inDingTalk ? '钉钉客户端' : '浏览器调试' }}</span>
      </p>
      <p class="row">
        <span>当前阶段</span>
        <span>P5 · v1.0.0</span>
      </p>
      <p v-if="state.user?.access" class="row">
        <span>主角色</span>
        <span>{{ state.user.access.primaryRoleLabel }}</span>
      </p>
    </section>

    <section class="card">
      <h3 class="section-title">项目组</h3>
      <button type="button" class="btn-outline admin-link" @click="router.push('/my-projects')">
        <strong>我的项目组</strong>
        <span class="muted">查看财务/总经理已分配的项目</span>
      </button>
    </section>

    <section v-if="state.user?.access?.canManageRoles || state.user?.access?.canManageProjectMembers" class="card">
      <h3 class="section-title">管理</h3>
      <button
        v-if="state.user?.access?.canManageRoles"
        type="button"
        class="btn-outline admin-link"
        @click="router.push('/admin/roles')"
      >
        <strong>角色分配</strong>
        <span class="muted">点选为员工分配项目经理 / 财务 / 总经理</span>
      </button>
      <button
        type="button"
        class="btn-outline admin-link"
        @click="router.push('/admin/members')"
      >
        <strong>项目成员</strong>
        <span class="muted">分配项目报销成员列表</span>
      </button>
    </section>

    <section v-if="!state.inDingTalk" class="card">
      <h3 class="section-title">开发身份切换</h3>
      <p class="hint muted">
        员工仅看本人；项目经理看本项目；财务看项目/片区/公司；总经理看全部。
        审批流：本项目经理 → 本项目财务 → 总经理（≤5千跳过）。提交无需选人。
      </p>
      <div class="role-btns">
        <button
          v-for="p in personas"
          :key="p.role"
          type="button"
          class="btn-outline"
          @click="switchRole(p.role)"
        >
          <strong>{{ p.label }}</strong>
          <span class="muted">{{ p.hint }}</span>
        </button>
      </div>
    </section>

    <button class="btn-outline full" type="button" @click="logout">重新登录</button>
  </div>
</template>

<style scoped>
.profile-card {
  display: flex;
  gap: 14px;
  align-items: center;
}

.avatar {
  width: 52px;
  height: 52px;
  border-radius: 14px;
  background: linear-gradient(135deg, #1677ff, #69b1ff);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  font-weight: 600;
}

.profile-card h2 {
  font-size: 18px;
}

.scope {
  margin-top: 4px;
  font-size: 13px;
  color: #1677ff;
}

.uid {
  font-size: 12px;
  margin-top: 4px;
  word-break: break-all;
}

.section-title {
  font-size: 15px;
  margin-bottom: 10px;
}

.hint {
  font-size: 13px;
  margin-bottom: 10px;
  line-height: 1.5;
}

.row {
  display: flex;
  justify-content: space-between;
  font-size: 14px;
  padding: 8px 0;
  border-bottom: 1px solid var(--color-border);
}

.row:last-child {
  border-bottom: none;
}

.role-btns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.btn-outline {
  border: 1px solid var(--color-border);
  border-radius: 10px;
  padding: 10px 12px;
  background: #fff;
  color: var(--color-text);
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 13px;
}

.btn-outline.full {
  width: 100%;
  margin-top: 16px;
  display: block;
  text-align: center;
}

.admin-link {
  width: 100%;
}
</style>
