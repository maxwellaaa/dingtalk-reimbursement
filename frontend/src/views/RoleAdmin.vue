<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api/http.js';
import { useUserStore } from '../stores/user.js';
import { toast } from '../utils/dingtalk.js';

const router = useRouter();
const { state } = useUserStore();

const loading = ref(true);
const saving = ref(false);
const keyword = ref('');
const users = ref([]);
const total = ref(0);
const meta = ref({ projects: [], regions: [], grades: [] });
const selectedUserId = ref(null);
const detail = ref(null);
const form = reactive({
  roleCode: 'employee',
  grade: 'A',
  projectId: '',
  regionId: '',
});

const canManage = computed(() => !!state.user?.access?.canManageRoles);
const canManageGm = computed(() => !!state.user?.access?.canManageGmRoles);

const needsGrade = computed(() => form.roleCode !== 'employee');
const needsProject = computed(
  () =>
    form.roleCode === 'project_manager' ||
    (form.roleCode === 'finance' && form.grade === 'A'),
);
const needsRegion = computed(() => form.roleCode === 'finance' && form.grade === 'B');

const roleChoices = computed(() => {
  const all = [
    { value: 'employee', label: '员工' },
    { value: 'project_manager', label: '项目经理' },
    { value: 'finance', label: '财务' },
    { value: 'gm', label: '总经理' },
  ];
  return canManageGm.value ? all : all.filter((r) => r.value !== 'gm');
});

async function loadMeta() {
  meta.value = await api.adminMeta();
}

async function loadUsers() {
  loading.value = true;
  try {
    const data = await api.adminSearchUsers({ q: keyword.value.trim(), pageSize: 50 });
    users.value = data.list || [];
    total.value = data.total || 0;
  } finally {
    loading.value = false;
  }
}

async function selectUser(userId) {
  selectedUserId.value = userId;
  detail.value = await api.adminUserRoles(userId);
  form.roleCode = 'employee';
  form.grade = 'A';
  form.projectId = '';
  form.regionId = '';
}

async function assign() {
  if (!selectedUserId.value) return;
  saving.value = true;
  try {
    const body = { roleCode: form.roleCode };
    if (needsGrade.value) body.grade = form.grade;
    if (needsProject.value) body.projectId = Number(form.projectId);
    if (needsRegion.value) body.regionId = Number(form.regionId);
    detail.value = await api.adminAssignRole(selectedUserId.value, body);
    toast(form.roleCode === 'employee' ? '已设为员工' : '已分配角色');
    await loadUsers();
  } catch (err) {
    alert(err.message);
  } finally {
    saving.value = false;
  }
}

async function revoke(roleId) {
  if (!confirm('确认撤销该角色？')) return;
  saving.value = true;
  try {
    detail.value = await api.adminRevokeRole(roleId);
    toast('已撤销');
    await loadUsers();
  } catch (err) {
    alert(err.message);
  } finally {
    saving.value = false;
  }
}

function roleLine(r) {
  const parts = [r.roleLabel || r.roleCode];
  if (r.gradeLabel || r.grade) parts.push(r.gradeLabel || r.grade);
  if (r.projectCode) parts.push(r.projectCode);
  if (r.regionName) parts.push(r.regionName);
  return parts.join(' · ');
}

watch(
  () => form.roleCode,
  (code) => {
    if (code === 'finance' && form.grade === 'C') {
      form.projectId = '';
      form.regionId = '';
    }
    if (code === 'gm' || code === 'employee') {
      form.projectId = '';
      form.regionId = '';
    }
  },
);

onMounted(async () => {
  if (!canManage.value) {
    loading.value = false;
    return;
  }
  try {
    await loadMeta();
    await loadUsers();
  } catch (err) {
    alert(err.message);
    loading.value = false;
  }
});
</script>

<template>
  <div class="page role-admin">
    <section class="card head-card">
      <button type="button" class="back" @click="router.push('/profile')">← 返回</button>
      <h2>角色分配</h2>
      <p class="muted">总经理 / 财务C 可点选分配。分配项目经理、财务A 会同步项目字段。</p>
    </section>

    <section v-if="!canManage" class="card empty">
      <p>当前账号无管理权限</p>
      <p class="muted">请使用总经理或财务C 身份进入</p>
      <button type="button" class="btn-primary" @click="router.push('/profile')">去切换身份</button>
    </section>

    <template v-else>
      <section class="card search-card">
        <input
          v-model="keyword"
          type="search"
          placeholder="搜索姓名 / 钉钉号 / 手机"
          @keyup.enter="loadUsers"
        />
        <button type="button" class="btn-primary" @click="loadUsers">搜索</button>
      </section>

      <div v-if="loading" class="loading-wrap"><div class="spinner" /></div>

      <template v-else>
        <p class="muted count">共 {{ total }} 人</p>

        <section class="list">
          <button
            v-for="u in users"
            :key="u.id"
            type="button"
            class="card user-item"
            :class="{ active: selectedUserId === u.id }"
            @click="selectUser(u.id)"
          >
            <div class="row-top">
              <strong>{{ u.name }}</strong>
              <span class="tag">{{ u.primaryRoleLabel }}{{ u.primaryGrade || '' }}</span>
            </div>
            <p class="muted">{{ u.title || '—' }} · {{ u.dingUserId }}</p>
            <p class="scope">{{ u.scopeLabel }}</p>
          </button>
        </section>

        <section v-if="detail" class="card detail-card">
          <h3>{{ detail.user.name }} · 当前角色</h3>
          <p class="muted scope">{{ detail.access?.scopeLabel }}</p>

          <div v-if="!detail.roles.length" class="empty-roles muted">暂无角色记录（默认按员工）</div>
          <ul v-else class="role-list">
            <li v-for="r in detail.roles" :key="r.id">
              <span>{{ roleLine(r) }}</span>
              <button
                type="button"
                class="link-danger"
                :disabled="saving || (r.roleCode === 'gm' && !canManageGm)"
                @click="revoke(r.id)"
              >
                撤销
              </button>
            </li>
          </ul>

          <h3 class="add-title">新增 / 调整角色</h3>
          <p class="muted tip">选「员工」将清除其全部角色，恢复仅看本人。</p>
          <label class="field">
            <span>角色</span>
            <select v-model="form.roleCode">
              <option v-for="r in roleChoices" :key="r.value" :value="r.value">{{ r.label }}</option>
            </select>
          </label>
          <label v-if="needsGrade" class="field">
            <span>档位</span>
            <select v-model="form.grade">
              <option v-for="g in meta.grades" :key="g.value" :value="g.value">{{ g.label }}</option>
            </select>
          </label>
          <label v-if="needsProject" class="field">
            <span>项目</span>
            <select v-model="form.projectId">
              <option value="">请选择</option>
              <option v-for="p in meta.projects" :key="p.id" :value="String(p.id)">
                {{ p.code }} · {{ p.name }}
              </option>
            </select>
          </label>
          <label v-if="needsRegion" class="field">
            <span>片区</span>
            <select v-model="form.regionId">
              <option value="">请选择</option>
              <option v-for="r in meta.regions" :key="r.id" :value="String(r.id)">
                {{ r.code }} · {{ r.name }}
              </option>
            </select>
          </label>
          <button type="button" class="btn-primary full" :disabled="saving" @click="assign">
            {{ saving ? '保存中…' : '确认分配' }}
          </button>
        </section>
      </template>
    </template>
  </div>
</template>

<style scoped>
.head-card h2 {
  font-size: 18px;
  margin: 6px 0 4px;
}

.back {
  border: none;
  background: transparent;
  color: var(--color-primary);
  padding: 0;
  font-size: 14px;
}

.search-card {
  display: flex;
  gap: 8px;
}

.search-card input {
  flex: 1;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 14px;
}

.count {
  font-size: 13px;
  margin: 0 4px 8px;
}

.list {
  display: grid;
  gap: 8px;
  margin-bottom: 12px;
}

.user-item {
  width: 100%;
  text-align: left;
  border: 1px solid transparent;
}

.user-item.active {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 1px rgba(22, 119, 255, 0.2);
}

.row-top {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
}

.tag {
  font-size: 12px;
  color: var(--color-primary);
  white-space: nowrap;
}

.scope {
  margin-top: 4px;
  font-size: 12px;
  color: #1677ff;
}

.detail-card h3 {
  font-size: 15px;
  margin-bottom: 6px;
}

.add-title {
  margin-top: 16px;
}

.tip {
  font-size: 12px;
  margin: 0 0 10px;
}

.role-list {
  list-style: none;
  padding: 0;
  margin: 8px 0 0;
}

.role-list li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  padding: 10px 0;
  border-bottom: 1px solid var(--color-border);
  font-size: 14px;
}

.link-danger {
  border: none;
  background: transparent;
  color: #cf1322;
  font-size: 13px;
  white-space: nowrap;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 10px;
  font-size: 13px;
}

.field select {
  border: 1px solid var(--color-border);
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 14px;
  background: #fff;
}

.btn-primary {
  border: none;
  border-radius: 10px;
  padding: 10px 14px;
  background: var(--color-primary);
  color: #fff;
  font-size: 14px;
}

.btn-primary.full {
  width: 100%;
  margin-top: 4px;
}

.empty {
  text-align: center;
  padding: 28px 16px;
}

.empty .btn-primary {
  margin-top: 12px;
}

.empty-roles {
  font-size: 13px;
  padding: 8px 0;
}
</style>
