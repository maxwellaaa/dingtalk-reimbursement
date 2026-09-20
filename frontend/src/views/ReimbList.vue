<script setup>
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api/http.js';
import { formatDate, formatMoney, STATUS_MAP } from '../utils/format.js';

const router = useRouter();
const loading = ref(true);
const list = ref([]);
const filter = ref('');
const scopeLabel = ref('');

async function load() {
  loading.value = true;
  try {
    const data = await api.listReimbursements({ status: filter.value || undefined });
    list.value = data.list;
    scopeLabel.value = data.scope?.label || '';
  } catch (err) {
    alert(err.message);
  } finally {
    loading.value = false;
  }
}

onMounted(load);

function statusStyle(status) {
  return { color: STATUS_MAP[status]?.color || '#666' };
}
</script>

<template>
  <div class="page">
    <p v-if="scopeLabel" class="scope-banner">{{ scopeLabel }}</p>
    <div class="filters">
      <button
        v-for="opt in ['', 'draft', 'pending', 'approved', 'rejected']"
        :key="opt || 'all'"
        type="button"
        class="chip"
        :class="{ active: filter === opt }"
        @click="filter = opt; load()"
      >
        {{ opt ? STATUS_MAP[opt]?.label : '全部' }}
      </button>
    </div>

    <div v-if="loading" class="loading-wrap">
      <div class="spinner" />
    </div>

    <div v-else-if="!list.length" class="card empty">
      <p class="muted">暂无报销单</p>
      <button class="btn-primary" type="button" @click="router.push('/reimb/create')">新建报销</button>
    </div>

    <div v-else class="list">
      <article
        v-for="item in list"
        :key="item.id"
        class="card item"
        @click="router.push(`/reimb/${item.id}`)"
      >
        <div class="row-top">
          <strong>{{ item.title }}</strong>
          <span :style="statusStyle(item.status)">{{ item.statusLabel }}</span>
        </div>
        <p class="muted project">{{ item.projectCode }} · {{ item.projectName }}</p>
        <div class="row-bottom">
          <span class="amount">¥ {{ formatMoney(item.reimburseAmount) }}</span>
          <span class="muted">{{ formatDate(item.expenseDate) }}</span>
        </div>
        <p class="muted bill-no">{{ item.billNo }}</p>
      </article>
    </div>

    <button class="fab" type="button" aria-label="新建" @click="router.push('/reimb/create')">+</button>
  </div>
</template>

<style scoped>
.scope-banner {
  font-size: 12px;
  color: #1677ff;
  margin-bottom: 8px;
}

.filters {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  margin-bottom: 12px;
  padding-bottom: 4px;
}

.chip {
  flex-shrink: 0;
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

.list {
  display: grid;
  gap: 10px;
}

.item {
  cursor: pointer;
}

.row-top {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}

.row-top strong {
  font-size: 15px;
}

.project {
  margin-bottom: 8px;
  font-size: 13px;
}

.row-bottom {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.amount {
  font-size: 16px;
  font-weight: 600;
  color: var(--color-primary);
}

.bill-no {
  margin-top: 6px;
  font-size: 12px;
}

.empty p {
  margin-bottom: 12px;
}

.fab {
  position: fixed;
  right: 20px;
  bottom: calc(72px + var(--safe-bottom));
  width: 52px;
  height: 52px;
  border-radius: 50%;
  border: none;
  background: var(--color-primary);
  color: #fff;
  font-size: 28px;
  line-height: 1;
  box-shadow: 0 4px 12px rgba(22, 119, 255, 0.35);
}
</style>
