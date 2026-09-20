<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api/http.js';
import { useUserStore } from '../stores/user.js';
import { formatMoney, STATUS_MAP } from '../utils/format.js';

const router = useRouter();
const { state } = useUserStore();

const loading = ref(true);
const exporting = ref(false);
const overview = ref(null);
const projects = ref([]);
const filterProjectId = ref('');
const period = ref('month');
const customFrom = ref('');
const customTo = ref('');
const activeTab = ref('company');

const periodOptions = [
  { value: 'year', label: '本年' },
  { value: 'quarter', label: '本季' },
  { value: 'month', label: '本月' },
  { value: 'week', label: '本周' },
  { value: 'all', label: '全部' },
  { value: 'custom', label: '自定义' },
];

const tabs = [
  { id: 'company', label: '公司总览' },
  { id: 'project', label: '项目总览' },
  { id: 'period', label: '年季月周' },
  { id: 'category', label: '科目分类' },
  { id: 'finance', label: '财务ABC' },
  { id: 'status', label: '按状态' },
];

const identity = computed(() => overview.value?.identity || state.user?.access || null);

const filterParams = computed(() => {
  const params = { period: period.value };
  if (filterProjectId.value) params.projectId = filterProjectId.value;
  if (period.value === 'custom') {
    if (customFrom.value) params.dateFrom = customFrom.value;
    if (customTo.value) params.dateTo = customTo.value;
  }
  return params;
});

async function load() {
  loading.value = true;
  try {
    overview.value = await api.getOverview(filterParams.value);
  } catch (err) {
    alert(err.message);
  } finally {
    loading.value = false;
  }
}

async function downloadBlob(res, filename) {
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function exportAll() {
  exporting.value = true;
  try {
    const res = await api.exportOverviewCsv({ ...filterParams.value, sections: 'all' });
    await downloadBlob(res, `报销总览_${new Date().toISOString().slice(0, 10)}.csv`);
  } catch (err) {
    alert(err.message);
  } finally {
    exporting.value = false;
  }
}

async function exportSection(section) {
  exporting.value = true;
  try {
    const res = await api.exportOverviewCsv({ ...filterParams.value, sections: section });
    await downloadBlob(res, `报销报表_${section}_${new Date().toISOString().slice(0, 10)}.csv`);
  } catch (err) {
    alert(err.message);
  } finally {
    exporting.value = false;
  }
}

function openProject(projectId) {
  if (!state.user?.access?.canViewBudgetOverview) return;
  router.push(`/projects/${projectId}/dashboard`);
}

onMounted(async () => {
  try {
    const p = await api.listProjects();
    projects.value = p.list || [];
  } catch {
    projects.value = [];
  }
  await load();
});

watch([filterProjectId, period, customFrom, customTo], () => {
  if (period.value === 'custom' && !customFrom.value && !customTo.value) return;
  load();
});
</script>

<template>
  <div class="page overview">
    <section class="card identity">
      <div class="id-head">
        <h2 class="section-title">登录身份（后台确认）</h2>
        <span class="badge" :class="state.identityConfirmed ? 'ok' : 'warn'">
          {{ state.identityConfirmed ? '已确认' : '待确认' }}
        </span>
      </div>
      <p class="name">{{ state.user?.name || '-' }} · {{ identity?.primaryRoleLabel || '员工' }}{{ identity?.primaryGrade ? identity.primaryGrade + '档' : '' }}</p>
      <p class="muted scope">{{ identity?.scopeLabel || '仅本人单据' }}</p>
    </section>

    <section class="card filters">
      <h2 class="section-title">筛选</h2>
      <div class="period-chips">
        <button
          v-for="opt in periodOptions"
          :key="opt.value"
          type="button"
          class="chip"
          :class="{ active: period === opt.value }"
          @click="period = opt.value"
        >
          {{ opt.label }}
        </button>
      </div>
      <div v-if="period === 'custom'" class="date-row">
        <label class="field">
          <span>开始</span>
          <input v-model="customFrom" type="date" lang="zh-CN" />
        </label>
        <label class="field">
          <span>结束</span>
          <input v-model="customTo" type="date" lang="zh-CN" />
        </label>
      </div>
      <label class="field">
        <span>项目</span>
        <select v-model="filterProjectId">
          <option value="">全部可见项目</option>
          <option v-for="p in projects" :key="p.id" :value="String(p.id)">
            {{ p.code }} · {{ p.name }}
          </option>
        </select>
      </label>
      <div class="export-row">
        <button type="button" class="btn-primary" :disabled="exporting" @click="exportAll">
          {{ exporting ? '导出中…' : '一键导出总览' }}
        </button>
        <button type="button" class="btn-outline" :disabled="exporting" @click="exportSection(activeTab === 'period' ? 'period' : activeTab)">
          导出当前分类
        </button>
      </div>
    </section>

    <div class="tabs">
      <button
        v-for="t in tabs"
        :key="t.id"
        type="button"
        class="tab"
        :class="{ active: activeTab === t.id }"
        @click="activeTab = t.id"
      >
        {{ t.label }}
      </button>
    </div>

    <div v-if="loading" class="loading-wrap"><div class="spinner" /></div>

    <template v-else-if="overview">
      <p class="period-label muted">
        {{ overview.period?.label }} ·
        {{ overview.period?.dateFrom || '…' }} ~ {{ overview.period?.dateTo || '…' }}
      </p>

      <!-- 公司总览 -->
      <section v-if="activeTab === 'company'" class="card">
        <h2 class="section-title">公司总览</h2>
        <div class="kpi-grid">
          <div class="kpi">
            <span class="kpi-label">报销单</span>
            <strong>{{ overview.company.totalCount }}</strong>
          </div>
          <div class="kpi">
            <span class="kpi-label">合计金额</span>
            <strong>¥ {{ formatMoney(overview.company.totalAmount) }}</strong>
          </div>
          <div class="kpi">
            <span class="kpi-label">涉及项目</span>
            <strong>{{ overview.company.projectCount }}</strong>
          </div>
        </div>
      </section>

      <!-- 项目总览 -->
      <section v-if="activeTab === 'project'" class="card">
        <h2 class="section-title">项目总览</h2>
        <ul v-if="overview.byProject?.length" class="stats">
          <li
            v-for="row in overview.byProject"
            :key="row.projectId"
            :class="{ clickable: state.user?.access?.canViewBudgetOverview }"
            @click="openProject(row.projectId)"
          >
            <span class="label">{{ row.projectCode }} · {{ row.projectName }}</span>
            <span>{{ row.count }} 单</span>
            <span>¥ {{ formatMoney(row.amount) }}</span>
          </li>
        </ul>
        <p v-else class="muted">暂无项目数据</p>
      </section>

      <!-- 年季月周 -->
      <section v-if="activeTab === 'period'" class="card">
        <h2 class="section-title">年 / 季 / 月 / 周</h2>
        <ul class="stats snap">
          <li v-for="key in ['year', 'quarter', 'month', 'week']" :key="key">
            <span class="label">{{ overview.periodSnapshots[key]?.label || key }}</span>
            <span>{{ overview.periodSnapshots[key]?.totalCount || 0 }} 单</span>
            <span>¥ {{ formatMoney(overview.periodSnapshots[key]?.totalAmount || 0) }}</span>
          </li>
        </ul>
        <h3 class="sub-title">当前期间序列（{{ overview.period.seriesBucket }}）</h3>
        <ul v-if="overview.series?.length" class="stats">
          <li v-for="row in overview.series" :key="row.key">
            <span class="label">{{ row.key }}</span>
            <span>{{ row.count }} 单</span>
            <span>¥ {{ formatMoney(row.amount) }}</span>
          </li>
        </ul>
        <p v-else class="muted">当前期间无明细序列</p>
      </section>

      <!-- 科目分类 -->
      <section v-if="activeTab === 'category'" class="card">
        <div class="section-head">
          <h2 class="section-title">科目分类报表</h2>
          <button type="button" class="link-btn" :disabled="exporting" @click="exportSection('category')">导出</button>
        </div>
        <ul v-if="overview.byCategory?.length" class="stats">
          <li v-for="row in overview.byCategory" :key="row.categoryId">
            <span class="label">{{ row.categoryName }}</span>
            <span>{{ row.billCount }} 单</span>
            <span>¥ {{ formatMoney(row.amount) }}</span>
          </li>
        </ul>
        <p v-else class="muted">暂无科目数据</p>
      </section>

      <!-- 财务 ABC -->
      <section v-if="activeTab === 'finance'" class="card">
        <div class="section-head">
          <h2 class="section-title">财务 ABC 档</h2>
          <button type="button" class="link-btn" :disabled="exporting" @click="exportSection('finance')">导出</button>
        </div>
        <p class="muted hint">按报销金额落入的财务审批档统计（与审批路由阈值一致）</p>
        <ul class="stats">
          <li v-for="row in overview.byFinanceGrade" :key="row.grade">
            <span class="label">{{ row.gradeLabel }}</span>
            <span>{{ row.count }} 单</span>
            <span>¥ {{ formatMoney(row.amount) }}</span>
          </li>
        </ul>
      </section>

      <!-- 状态 -->
      <section v-if="activeTab === 'status'" class="card">
        <div class="section-head">
          <h2 class="section-title">按状态</h2>
          <button type="button" class="link-btn" :disabled="exporting" @click="exportSection('status')">导出</button>
        </div>
        <ul v-if="overview.byStatus?.length" class="stats">
          <li v-for="row in overview.byStatus" :key="row.status">
            <span class="label" :style="{ color: STATUS_MAP[row.status]?.color }">
              {{ STATUS_MAP[row.status]?.label || row.statusLabel || row.status }}
            </span>
            <span>{{ row.count }} 单</span>
            <span>¥ {{ formatMoney(row.amount) }}</span>
          </li>
        </ul>
        <p v-else class="muted">暂无数据</p>
      </section>
    </template>
  </div>
</template>

<style scoped>
.section-title {
  font-size: 16px;
  margin: 0;
}

.section-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.identity {
  margin-bottom: 12px;
}

.id-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.badge {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 999px;
}

.badge.ok {
  background: #e6fffb;
  color: #08979c;
}

.badge.warn {
  background: #fff7e6;
  color: #d46b08;
}

.name {
  font-size: 15px;
  font-weight: 600;
}

.scope {
  margin-top: 4px;
  font-size: 13px;
}

.filters {
  margin-bottom: 12px;
}

.period-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 10px 0;
}

.chip {
  border: 1px solid var(--color-border);
  background: #fff;
  border-radius: 999px;
  padding: 6px 12px;
  font-size: 13px;
}

.chip.active {
  border-color: var(--color-primary);
  color: var(--color-primary);
  background: #e8f3ff;
}

.field {
  display: grid;
  gap: 6px;
  margin-bottom: 10px;
  font-size: 14px;
}

.field span {
  color: var(--color-muted);
}

.field input,
.field select {
  width: 100%;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 10px 12px;
  font: inherit;
  background: #fff;
}

.date-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.export-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 4px;
}

.btn-primary,
.btn-outline {
  border-radius: 10px;
  padding: 10px;
  font-size: 13px;
}

.btn-primary {
  border: none;
  background: var(--color-primary);
  color: #fff;
}

.btn-outline {
  border: 1px solid var(--color-border);
  background: #fff;
  color: var(--color-text);
}

.tabs {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  margin-bottom: 10px;
  padding-bottom: 4px;
}

.tab {
  flex-shrink: 0;
  border: none;
  background: #f5f5f5;
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 13px;
  color: var(--color-muted);
}

.tab.active {
  background: #e8f3ff;
  color: var(--color-primary);
  font-weight: 600;
}

.period-label {
  font-size: 12px;
  margin-bottom: 8px;
}

.kpi-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-top: 12px;
}

.kpi {
  background: #f7f9fc;
  border-radius: 10px;
  padding: 12px 8px;
  text-align: center;
}

.kpi-label {
  display: block;
  font-size: 12px;
  color: var(--color-muted);
  margin-bottom: 6px;
}

.kpi strong {
  font-size: 15px;
}

.sub-title {
  font-size: 14px;
  margin: 16px 0 8px;
}

.stats {
  list-style: none;
  margin-top: 8px;
  display: grid;
  gap: 8px;
}

.stats li {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 8px;
  font-size: 13px;
  padding: 8px 0;
  border-bottom: 1px solid var(--color-border);
}

.stats li:last-child {
  border-bottom: none;
}

.stats li.clickable {
  cursor: pointer;
}

.label {
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hint {
  font-size: 12px;
  margin-bottom: 8px;
}

.link-btn {
  border: none;
  background: none;
  color: var(--color-primary);
  font-size: 13px;
}
</style>
