<script setup>
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api/http.js';

const router = useRouter();
const loading = ref(true);
const joined = ref([]);

async function load() {
  loading.value = true;
  try {
    const mine = await api.listMyProjects();
    joined.value = mine.list || [];
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
    <section class="card head">
      <button type="button" class="back" @click="router.push('/profile')">← 返回</button>
      <h2>我的项目组</h2>
      <p class="muted">由财务或总经理分配后才会出现在此列表，填单时只可选这些项目。</p>
    </section>

    <div v-if="loading" class="loading-wrap"><div class="spinner" /></div>

    <section v-else class="card">
      <h3 class="section-title">已分配（{{ joined.length }}）</h3>
      <p v-if="!joined.length" class="muted">暂无项目，请联系财务或总经理将你加入项目组</p>
      <ul v-else class="list">
        <li v-for="p in joined" :key="p.id">
          <div>
            <strong>{{ p.code }}</strong>
            <p class="muted">{{ p.name }}</p>
          </div>
        </li>
      </ul>
    </section>
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
  font-size: 14px;
}

.section-title {
  margin: 0 0 8px;
  font-size: 15px;
}

.list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.list li {
  padding: 12px 0;
  border-bottom: 1px solid var(--color-border);
}
</style>
