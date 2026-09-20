<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, getToken } from '../api/http.js';
import { useUserStore } from '../stores/user.js';
import { formatDate, formatMoney, STATUS_MAP } from '../utils/format.js';
import { toast } from '../utils/dingtalk.js';

const route = useRoute();
const router = useRouter();
const { state: userState } = useUserStore();
const id = computed(() => Number(route.params.id));
const loading = ref(true);
const detail = ref(null);
const submitting = ref(false);
const cancelling = ref(false);
const reopening = ref(false);
const acting = ref(false);
const comment = ref('');
const approverPath = ref(null);

const TASK_STATUS = {
  pending: '待处理',
  waiting: '等待中',
  approved: '已通过',
  rejected: '已驳回',
  cancelled: '已取消',
};

const OA_SYNC_LABEL = {
  pending: '待发起',
  synced: '已发起',
  finished: '已完成',
  rejected: '已驳回',
  failed: '发起失败',
};

const OA_EVENT_LABEL = {
  start: '开始',
  finish: '结束',
  terminate: '终止',
  delete: '删除',
  cancel: '撤销',
};

/** 草稿不展示 OA；仅已提交且走 B 或已有 OA 映射时展示 */
const showOaSection = computed(() => {
  const d = detail.value;
  if (!d || d.status === 'draft') return false;
  return d.approvalMode === 'B' || !!d.approvalTimeline?.oa;
});

const canCancel = computed(() => {
  const d = detail.value;
  if (!d || d.status !== 'approving') return false;
  const uid = userState.user?.id;
  if (uid == null) return false;
  return Number(d.applicantUserId) === Number(uid);
});

const canReopen = computed(() => {
  const d = detail.value;
  if (!d || d.status !== 'rejected') return false;
  const uid = userState.user?.id;
  if (uid == null) return false;
  return Number(d.applicantUserId) === Number(uid);
});

const showModeTag = computed(() => {
  const d = detail.value;
  return d && d.status !== 'draft' && d.approvalMode;
});

async function loadApproverPath() {
  try {
    approverPath.value = await api.getProjectApproverPath(id.value);
  } catch {
    approverPath.value = null;
  }
}

async function load() {
  loading.value = true;
  try {
    detail.value = await api.getReimbursement(id.value);
    if (detail.value?.status === 'draft') {
      await loadApproverPath();
    } else {
      approverPath.value = null;
    }
  } catch (err) {
    alert(err.message);
    router.back();
  } finally {
    loading.value = false;
  }
}

onMounted(load);

watch(id, () => load());

async function onSubmit() {
  if (approverPath.value && !approverPath.value.canSubmit) {
    alert('本项目尚未配置项目经理或财务，请联系管理员后再提交');
    return;
  }
  if (!confirm('确认提交？将按本项目已分配的经理、财务进入审批')) return;
  submitting.value = true;
  try {
    const data = await api.submitReimbursement(id.value, {});
    detail.value = data;
    const mode = data.submitResult?.mode || data.approvalMode;
    if (mode === 'B') {
      toast(data.submitResult?.message || '已提交钉钉 OA 审批，请在钉钉「OA审批」中查看');
    } else if (data.submitResult?.fallbackReason) {
      toast(`已降级为 H5 自研审批（${data.submitResult.fallbackReason}）`);
    } else {
      toast(data.submitResult?.message || '已提交自研审批，审批人将在 H5「待办」中处理');
    }
  } catch (err) {
    alert(err.message);
  } finally {
    submitting.value = false;
  }
}

async function onApprove() {
  if (!detail.value?.pendingTask) return;
  acting.value = true;
  try {
    await api.actOnApprovalTask(detail.value.pendingTask.taskId, {
      action: 'approve',
      comment: comment.value || '同意',
    });
    toast('已通过');
    comment.value = '';
    await load();
  } catch (err) {
    alert(err.message);
  } finally {
    acting.value = false;
  }
}

async function onReject() {
  if (!detail.value?.pendingTask) return;
  if (!confirm('确认驳回？')) return;
  acting.value = true;
  try {
    await api.actOnApprovalTask(detail.value.pendingTask.taskId, {
      action: 'reject',
      comment: comment.value || '驳回',
    });
    toast('已驳回');
    comment.value = '';
    await load();
  } catch (err) {
    alert(err.message);
  } finally {
    acting.value = false;
  }
}

async function onDelete() {
  if (!confirm('确认删除此草稿？')) return;
  try {
    await api.deleteReimbursement(id.value);
    toast('已删除');
    router.replace('/reimb');
  } catch (err) {
    alert(err.message);
  }
}

async function onCancel() {
  if (!confirm('确认撤回？撤回后审批流程将终止')) return;
  cancelling.value = true;
  try {
    detail.value = await api.cancelReimbursement(id.value);
    toast('已撤回');
  } catch (err) {
    alert(err.message);
  } finally {
    cancelling.value = false;
  }
}

async function onReopen() {
  if (!confirm('将驳回单恢复为草稿，可修改后重新提交。是否继续？')) return;
  reopening.value = true;
  try {
    await api.reopenRejectedReimbursement(id.value);
    toast('已恢复为草稿，请修改后提交');
    router.replace(`/reimb/create?id=${id.value}`);
  } catch (err) {
    alert(err.message);
  } finally {
    reopening.value = false;
  }
}

async function downloadFile(fileId, fileName) {
  const res = await fetch(`/api/files/${fileId}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) {
    alert('下载失败');
    return;
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
</script>

<template>
  <div class="page">
    <div v-if="loading" class="loading-wrap"><div class="spinner" /></div>

    <template v-else-if="detail">
      <section class="card">
        <div class="head">
          <h2>{{ detail.title }}</h2>
          <span class="status" :style="{ color: STATUS_MAP[detail.status]?.color }">
            {{ detail.statusLabel }}
          </span>
        </div>
        <p class="muted">{{ detail.billNo }}</p>
        <p class="amount">¥ {{ formatMoney(detail.reimburseAmount) }}</p>
        <p v-if="showModeTag" class="mode-tag">审批模式 {{ detail.approvalMode === 'B' ? '钉钉 OA' : '自研 H5' }}</p>
        <p v-else-if="detail.status === 'draft'" class="mode-tag">草稿 · 提交后进入审批</p>
        <p v-if="detail.budgetExceptionLabel" class="exception-tag">
          预算例外 · {{ detail.budgetExceptionLabel }}
          <span v-if="detail.budgetExceptionRemark">（{{ detail.budgetExceptionRemark }}）</span>
        </p>
      </section>

      <section class="card">
        <h3 class="section-title">基本信息</h3>
        <p class="row"><span>项目</span><span>{{ detail.projectCode }} {{ detail.projectName }}</span></p>
        <p class="row"><span>费用日期</span><span>{{ formatDate(detail.expenseDate) }}</span></p>
        <p v-if="detail.budgetExceptionLabel" class="row">
          <span>预算例外</span>
          <span>{{ detail.budgetExceptionLabel }}</span>
        </p>
        <p v-if="detail.budgetExceptionRemark" class="row">
          <span>例外说明</span>
          <span>{{ detail.budgetExceptionRemark }}</span>
        </p>
        <p class="row"><span>收款人</span><span>{{ detail.payeeName || '-' }}</span></p>
        <p class="row"><span>说明</span><span>{{ detail.description || '-' }}</span></p>
      </section>

      <section class="card">
        <h3 class="section-title">费用明细</h3>
        <div v-for="it in detail.items" :key="it.id" class="line">
          <div class="line-top">
            <strong>{{ it.costCategoryName }}</strong>
            <span>¥ {{ formatMoney(it.amount) }}</span>
          </div>
          <p v-if="it.description" class="muted">{{ it.description }}</p>
          <p v-if="it.invoiceNo" class="muted invoice-tag">发票 {{ it.invoiceNo }}</p>
        </div>
      </section>

      <section v-if="detail.attachments?.length" class="card">
        <h3 class="section-title">附件</h3>
        <ul class="files">
          <li v-for="f in detail.attachments" :key="f.id">
            <button type="button" class="file-link" @click="downloadFile(f.id, f.fileName)">
              {{ f.fileName }}
            </button>
          </li>
        </ul>
      </section>

      <section v-if="showOaSection" class="card oa-card">
        <h3 class="section-title">钉钉 OA 审批</h3>
        <template v-if="detail.approvalTimeline?.oa">
          <p class="row">
            <span>同步状态</span>
            <span :class="['oa-status', detail.approvalTimeline.oa.syncStatus]">
              {{ detail.approvalTimeline.oa.syncStatusLabel || OA_SYNC_LABEL[detail.approvalTimeline.oa.syncStatus] || detail.approvalTimeline.oa.syncStatus }}
            </span>
          </p>
          <p v-if="detail.approvalTimeline.oa.processInstanceId" class="row">
            <span>实例 ID</span>
            <span class="mono">{{ detail.approvalTimeline.oa.processInstanceId }}</span>
          </p>
          <p v-if="detail.approvalTimeline.oa.lastEventType" class="row">
            <span>最近事件</span>
            <span>{{ OA_EVENT_LABEL[detail.approvalTimeline.oa.lastEventType] || detail.approvalTimeline.oa.lastEventType }}</span>
          </p>
          <p v-if="detail.approvalTimeline.oa.lastEventAt" class="row">
            <span>事件时间</span>
            <span>{{ formatDate(detail.approvalTimeline.oa.lastEventAt) }}</span>
          </p>
          <p v-if="detail.approvalTimeline.oa.oaUrl" class="row">
            <span>钉钉审批</span>
            <a :href="detail.approvalTimeline.oa.oaUrl" class="oa-link" target="_blank" rel="noopener">在钉钉中打开</a>
          </p>
        </template>
        <p v-else class="muted oa-hint">钉钉 OA 实例同步中，请稍后刷新</p>
        <p v-if="detail.status === 'approving' && detail.approvalMode === 'B'" class="oa-tip">
          请在钉钉「OA审批」中处理；状态将自动回写
        </p>
      </section>

      <section v-if="detail.approvalTimeline?.tasks?.length" class="card">
        <h3 class="section-title">审批进度</h3>
        <ul class="timeline">
          <li v-for="t in detail.approvalTimeline.tasks" :key="t.id" :class="t.status">
            <div class="tl-head">
              <strong>{{ t.nodeName }}</strong>
              <span>{{ TASK_STATUS[t.status] || t.status }}</span>
            </div>
            <p class="muted">{{ t.assigneeName }}{{ t.actedAt ? ` · ${formatDate(t.actedAt)}` : '' }}</p>
            <p v-if="t.comment" class="comment">{{ t.comment }}</p>
          </li>
        </ul>
      </section>

      <section v-if="detail.pendingTask" class="card approve-box">
        <h3 class="section-title">审批操作</h3>
        <textarea v-model="comment" rows="2" placeholder="审批意见（可选）" />
        <div class="actions-inline">
          <button class="btn-primary" type="button" :disabled="acting" @click="onApprove">
            {{ acting ? '处理中…' : '同意' }}
          </button>
          <button class="btn-danger-inline" type="button" :disabled="acting" @click="onReject">驳回</button>
        </div>
      </section>

      <section v-if="detail.status === 'draft'" class="card pick-card">
        <h3 class="section-title">本项目审批人</h3>
        <p class="muted pick-hint">按项目自动提交至已分配经理、财务，无需再选人。</p>
        <p class="row">
          <span>项目经理</span>
          <span>{{ approverPath?.pm?.name || '未配置' }}</span>
        </p>
        <p class="row">
          <span>财务</span>
          <span>{{ approverPath?.finance?.name || '未配置' }}</span>
        </p>
        <p v-if="approverPath && !approverPath.canSubmit" class="muted warn-tip">
          请先在角色/项目管理中为本项目配置经理与财务
        </p>
      </section>

      <div v-if="detail.status === 'draft'" class="actions">
        <button class="btn-primary" type="button" :disabled="submitting" @click="onSubmit">
          {{ submitting ? '提交中…' : '提交报销' }}
        </button>
        <button class="btn-outline" type="button" @click="router.push(`/reimb/create?id=${detail.id}`)">
          编辑
        </button>
        <button class="btn-danger" type="button" @click="onDelete">删除草稿</button>
      </div>

      <div v-else-if="canReopen" class="actions">
        <button class="btn-primary" type="button" :disabled="reopening" @click="onReopen">
          {{ reopening ? '处理中…' : '修改并重新申请' }}
        </button>
      </div>

      <div v-else-if="canCancel" class="actions">
        <button class="btn-danger" type="button" :disabled="cancelling" @click="onCancel">
          {{ cancelling ? '撤回中…' : '撤回报销' }}
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.head {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: flex-start;
}

.head h2 {
  font-size: 18px;
}

.status {
  font-size: 13px;
  white-space: nowrap;
}

.mode-tag {
  margin-top: 8px;
  font-size: 12px;
  color: var(--color-muted);
}

.exception-tag {
  margin-top: 6px;
  font-size: 12px;
  color: #d48806;
  background: #fff7e6;
  display: inline-block;
  padding: 4px 8px;
  border-radius: 6px;
}

.amount {
  margin-top: 8px;
  font-size: 24px;
  font-weight: 700;
  color: var(--color-primary);
}

.section-title {
  font-size: 15px;
  margin-bottom: 10px;
}

.row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 14px;
  padding: 8px 0;
  border-bottom: 1px solid var(--color-border);
}

.row:last-child {
  border-bottom: none;
}

.row span:first-child {
  color: var(--color-muted);
  flex-shrink: 0;
}

.row span:last-child {
  text-align: right;
}

.mono {
  font-size: 11px;
  word-break: break-all;
}

.line {
  padding: 10px 0;
  border-bottom: 1px solid var(--color-border);
}

.line:last-child {
  border-bottom: none;
}

.line-top {
  display: flex;
  justify-content: space-between;
}

.invoice-tag {
  margin-top: 4px;
  font-size: 12px;
  color: var(--color-primary);
}

.files {
  list-style: none;
}

.file-link {
  color: var(--color-primary);
  font-size: 14px;
  line-height: 2;
  border: none;
  background: none;
  padding: 0;
  text-align: left;
}

.oa-card {
  border-left: 3px solid #1677ff;
}

.oa-status.synced,
.oa-status.pending {
  color: var(--color-primary);
}

.oa-status.finished {
  color: var(--color-success);
}

.oa-status.rejected,
.oa-status.failed {
  color: var(--color-danger);
}

.oa-link {
  color: var(--color-primary);
  font-size: 14px;
}

.oa-tip,
.oa-hint {
  margin-top: 10px;
  font-size: 13px;
  color: var(--color-muted);
}

.oa-tip {
  padding: 8px 10px;
  background: #e6f4ff;
  border-radius: 8px;
  color: #1677ff;
}

.timeline {
  list-style: none;
  display: grid;
  gap: 12px;
}

.tl-head {
  display: flex;
  justify-content: space-between;
  font-size: 14px;
}

.timeline li.approved .tl-head span {
  color: var(--color-success);
}

.timeline li.rejected .tl-head span {
  color: var(--color-danger);
}

.timeline li.pending .tl-head span {
  color: var(--color-primary);
}

.comment {
  margin-top: 4px;
  font-size: 13px;
}

.approve-box textarea {
  width: 100%;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 8px;
  font-size: 14px;
  margin-bottom: 10px;
  resize: vertical;
}

.pick-hint {
  font-size: 12px;
  margin: 0 0 12px;
}

.warn-tip {
  color: #d48806;
  font-size: 12px;
  margin-top: 8px;
}

.pick-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
  font-size: 13px;
}

.pick-field select {
  border: 1px solid var(--color-border);
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 14px;
  background: #fff;
}

.actions-inline {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.btn-danger-inline {
  padding: 12px;
  border-radius: 10px;
  border: none;
  background: #fff1f0;
  color: var(--color-danger);
  font-size: 15px;
}

.actions {
  display: grid;
  gap: 10px;
  margin-top: 8px;
}

.btn-outline,
.btn-danger {
  width: 100%;
  padding: 12px;
  border-radius: 10px;
  font-size: 15px;
}

.btn-outline {
  border: 1px solid var(--color-border);
  background: #fff;
}

.btn-danger {
  border: none;
  background: #fff1f0;
  color: var(--color-danger);
}
</style>
