<script setup>
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api/http.js';
import { formatDate, formatMoney } from '../utils/format.js';

const router = useRouter();
const loading = ref(true);
const list = ref([]);

async function load() {
  loading.value = true;
  try {
    const data = await api.listMyApprovalTasks();
    list.value = data.list || [];
  } catch (err) {
    alert(err.message);
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="page">
    <section class="card head-card">
      <h2>待我审批</h2>
      <p class="muted">方案 A 自研审批 · 开发环境无 OA 时自动走此流程</p>
    </section>

    <div v-if="loading" class="loading-wrap"><div class="spinner" /></div>

    <div v-else-if="!list.length" class="empty card">
      <p>暂无待办</p>
      <p class="muted">提交报销后，审批人将在此看到任务</p>
    </div>

    <section v-else class="list">
      <button
        v-for="item in list"
        :key="item.taskId"
        type="button"
        class="card item"
        @click="router.push(`/reimb/${item.reimbursementId}`)"
      >
        <div class="row-top">
          <strong>{{ item.title || item.billNo }}</strong>
          <span class="amount">¥ {{ formatMoney(item.reimburseAmount) }}</span>
        </div>
        <p class="muted">{{ item.billNo }} · {{ item.projectName }}</p>
        <p class="meta">
          <span>{{ item.applicantName }}</span>
          <span>{{ item.nodeName }}</span>
          <span>{{ formatDate(item.expenseDate) }}</span>
        </p>
      </button>
    </section>
  </div>
</template>

<style scoped>
.head-card h2 {
  font-size: 18px;
  margin-bottom: 4px;
}

.empty {
  text-align: center;
  padding: 32px 16px;
}

.list {
  display: grid;
  gap: 10px;
}

.item {
  width: 100%;
  text-align: left;
  border: none;
}

.row-top {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}

.amount {
  color: var(--color-primary);
  font-weight: 600;
  white-space: nowrap;
}

.meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 12px;
  color: var(--color-muted);
  margin-top: 8px;
}
</style>
