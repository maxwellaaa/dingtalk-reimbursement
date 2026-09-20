<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api/http.js';
import { useUserStore } from '../stores/user.js';
import { toast } from '../utils/dingtalk.js';

const router = useRouter();
const { state } = useUserStore();

const loading = ref(true);
const saving = ref(false);
const projects = ref([]);
const projectId = ref('');
const members = ref([]);
const keyword = ref('');
const users = ref([]);
const selectedUserId = ref('');

const canEnter = computed(
  () =>
    !!state.user?.access?.canManageProjectMembers ||
    !!state.user?.access?.canManageRoles ||
    state.user?.access?.primaryRole === 'project_manager',
);

async function loadProjects() {
  const data = await api.listManageableProjects();
  projects.value = data.list || [];
  if (!projectId.value && projects.value[0]) {
    projectId.value = String(projects.value[0].id);
  }
}

async function loadMembers() {
  if (!projectId.value) {
    members.value = [];
    return;
  }
  const data = await api.listProjectMembers(Number(projectId.value));
  members.value = data.list || [];
}

async function searchUsers() {
  if (!projectId.value) return;
  try {
    const data = await api.searchMemberCandidates(Number(projectId.value), keyword.value.trim());
    users.value = (data.list || []).filter((u) => !u.alreadyMember);
  } catch (err) {
    alert(err.message);
    users.value = [];
  }
}

async function addMember() {
  if (!selectedUserId.value) {
    alert('请选择用户');
    return;
  }
  saving.value = true;
  try {
    const data = await api.addProjectMember(Number(projectId.value), Number(selectedUserId.value));
    members.value = data.list || [];
    selectedUserId.value = '';
    toast('已加入成员');
    await searchUsers();
  } catch (err) {
    alert(err.message);
  } finally {
    saving.value = false;
  }
}

async function removeMember(u) {
  if (!confirm(`确认移除 ${u.name}？`)) return;
  saving.value = true;
  try {
    const data = await api.removeProjectMember(Number(projectId.value), u.userId);
    members.value = data.list || [];
    toast('已移除');
  } catch (err) {
    alert(err.message);
  } finally {
    saving.value = false;
  }
}

watch(projectId, async () => {
  await loadMembers();
  await searchUsers();
});

onMounted(async () => {
  if (!canEnter.value) {
    loading.value = false;
    return;
  }
  try {
    await loadProjects();
    await loadMembers();
    await searchUsers();
  } catch (err) {
    alert(err.message);
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="page">
    <section class="card head">
      <button type="button" class="back" @click="router.push('/profile')">← 返回</button>
      <h2>项目成员管理</h2>
      <p class="muted">总经理 / 财务C / 项目经理可为项目分配报销可见成员。</p>
    </section>

    <section v-if="!canEnter" class="card empty">
      <p>当前账号无管理权限</p>
    </section>

    <template v-else>
      <div v-if="loading" class="loading-wrap"><div class="spinner" /></div>
      <template v-else>
        <section class="card">
          <label class="field">
            <span>项目</span>
            <select v-model="projectId">
              <option v-for="p in projects" :key="p.id" :value="String(p.id)">
                {{ p.code }} · {{ p.name }}
              </option>
            </select>
          </label>
        </section>

        <section class="card">
          <h3 class="section-title">成员（{{ members.length }}）</h3>
          <ul class="list">
            <li v-for="m in members" :key="m.userId">
              <div>
                <strong>{{ m.name }}</strong>
                <p class="muted">{{ m.title || m.memberRole }} · {{ m.dingUserId }}</p>
              </div>
              <button type="button" class="link-danger" :disabled="saving" @click="removeMember(m)">
                移除
              </button>
            </li>
          </ul>
          <p v-if="!members.length" class="muted">暂无成员</p>
        </section>

        <section class="card">
          <h3 class="section-title">添加成员</h3>
          <div class="search">
            <input v-model="keyword" type="search" placeholder="搜索姓名 / 钉钉号" @keyup.enter="searchUsers" />
            <button type="button" class="btn-outline" @click="searchUsers">搜索</button>
          </div>
          <label class="field">
            <span>用户</span>
            <select v-model="selectedUserId">
              <option value="">请选择</option>
              <option v-for="u in users" :key="u.id" :value="String(u.id)">
                {{ u.name }}{{ u.title ? ` · ${u.title}` : '' }}
              </option>
            </select>
          </label>
          <button type="button" class="btn-primary" :disabled="saving" @click="addMember">加入项目</button>
        </section>
      </template>
    </template>
  </div>
</template>

<style scoped>
.head h2 {
  font-size: 18px;
  margin: 6px 0 4px;
}

.back {
  border: none;
  background: transparent;
  color: var(--color-primary);
  padding: 0;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 10px;
  font-size: 13px;
}

.field select,
.search input {
  border: 1px solid var(--color-border);
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 14px;
}

.search {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
}

.search input {
  flex: 1;
}

.list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.list li {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 0;
  border-bottom: 1px solid var(--color-border);
}

.link-danger {
  border: none;
  background: transparent;
  color: #cf1322;
}

.btn-primary,
.btn-outline {
  border-radius: 10px;
  padding: 10px 14px;
  font-size: 14px;
}

.btn-primary {
  border: none;
  background: var(--color-primary);
  color: #fff;
  width: 100%;
}

.btn-outline {
  border: 1px solid var(--color-border);
  background: #fff;
}

.empty {
  text-align: center;
  padding: 28px 16px;
}
</style>
