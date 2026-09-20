<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api/http.js';
import { useUserStore } from '../stores/user.js';
import { formatMoney, STATUS_MAP } from '../utils/format.js';

const route = useRoute();
const router = useRouter();
const { state } = useUserStore();
const projectId = computed(() => Number(route.params.id));
const loading = ref(true);
const dashboard = ref(null);
const denied = ref('');

const canViewBudgetOverview = computed(
  () => !!state.user?.access?.canViewBudgetOverview,
);

async function load() {
  loading.value = true;
  denied.value = '';
  if (!canViewBudgetOverview.value) {
    denied.value = '员工无权查看预算总览';
    loading.value = false;
    return;
  }
  try {
    dashboard.value = await api.getProjectDashboard(projectId.value);
  } catch (err) {
    denied.value = err.message || '加载失败';
  } finally {
    loading.value = false;
  }
}

onMounted(load);

function pct(rate) {
  return `${Math.round((rate || 0) * 100)}%`;
}
</script>

<template>
  <div class="page">
    <div v-if="loading" class="loading-wrap"><div class="spinner" /></div>

    <section v-else-if="denied" class="card">
      <h2>无法查看</h2>
      <p class="muted">{{ denied }}</p>
      <button type="button" class="btn-primary" @click="router.replace('/')">返回首页</button>
    </section>

    <template v-else-if="dashboard">

      <section class="card">

        <h2>{{ dashboard.project.code }}</h2>

        <p class="muted">{{ dashboard.project.name }}</p>

        <p class="muted">{{ dashboard.project.regionName }} · {{ dashboard.fiscalYear }} 年度预算</p>

      </section>



      <section class="card summary-card">

        <div class="stat">

          <span class="label">总预算</span>

          <strong>¥ {{ formatMoney(dashboard.summary.totalBudget) }}</strong>

        </div>

        <div class="stat">

          <span class="label">已占用</span>

          <strong class="used">¥ {{ formatMoney(dashboard.summary.totalUsed) }}</strong>

        </div>

        <div class="stat">

          <span class="label">剩余</span>

          <strong class="remain">¥ {{ formatMoney(dashboard.summary.totalRemaining) }}</strong>

        </div>

        <p class="usage">整体使用率 {{ pct(dashboard.summary.usageRate) }}</p>

      </section>



      <section class="card">

        <h3 class="section-title">科目预算</h3>

        <div v-if="!dashboard.budgets.length" class="empty muted">暂无预算配置</div>

        <div v-for="b in dashboard.budgets" :key="b.costCategoryId" class="budget-row">

          <div class="row-top">

            <strong>{{ b.costCategoryName }}</strong>

            <span :class="{ warn: b.overWarn }">{{ pct(b.usageRate) }}</span>

          </div>

          <div class="bar-wrap">

            <div class="bar" :class="{ warn: b.overWarn }" :style="{ width: `${Math.min(b.usageRate * 100, 100)}%` }" />

          </div>

          <p class="muted amounts">

            已用 ¥{{ formatMoney(b.usedAmount) }} / 预算 ¥{{ formatMoney(b.budgetAmount) }}

            · 剩余 ¥{{ formatMoney(b.remaining) }}

          </p>

        </div>

      </section>



      <section v-if="dashboard.reimbursementStats?.length" class="card">

        <h3 class="section-title">报销统计</h3>

        <div v-for="s in dashboard.reimbursementStats" :key="s.status" class="stat-row">

          <span>{{ STATUS_MAP[s.status]?.label || s.status }}</span>

          <span>{{ s.count }} 单 · ¥ {{ formatMoney(s.amount) }}</span>

        </div>

      </section>

    </template>

  </div>

</template>



<style scoped>

.summary-card {

  display: grid;

  gap: 10px;

}



.stat {

  display: flex;

  justify-content: space-between;

  font-size: 14px;

}



.stat .label {

  color: var(--color-muted);

}



.stat strong {

  font-size: 16px;

}



.stat .used {

  color: var(--color-primary);

}



.stat .remain {

  color: var(--color-success);

}



.usage {

  font-size: 13px;

  color: var(--color-muted);

  padding-top: 4px;

  border-top: 1px solid var(--color-border);

}



.section-title {

  font-size: 15px;

  margin-bottom: 10px;

}



.budget-row {

  padding: 10px 0;

  border-bottom: 1px solid var(--color-border);

}



.budget-row:last-child {

  border-bottom: none;

}



.row-top {

  display: flex;

  justify-content: space-between;

  font-size: 14px;

  margin-bottom: 6px;

}



.row-top .warn {

  color: #fa8c16;

}



.bar-wrap {

  height: 6px;

  background: #f0f0f0;

  border-radius: 999px;

  overflow: hidden;

}



.bar {

  height: 100%;

  background: var(--color-primary);

  border-radius: 999px;

}



.bar.warn {

  background: #fa8c16;

}



.amounts {

  font-size: 12px;

  margin-top: 4px;

}



.stat-row {

  display: flex;

  justify-content: space-between;

  font-size: 14px;

  padding: 8px 0;

  border-bottom: 1px solid var(--color-border);

}



.stat-row:last-child {

  border-bottom: none;

}



.empty {

  text-align: center;

  padding: 16px 0;

}

.btn-primary {
  margin-top: 12px;
  border: none;
  border-radius: 10px;
  padding: 10px 16px;
  background: var(--color-primary);
  color: #fff;
  font-size: 14px;
}

</style>


