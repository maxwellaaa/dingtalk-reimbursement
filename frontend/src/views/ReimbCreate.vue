<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api/http.js';
import { todayStr } from '../utils/format.js';
import { toast } from '../utils/dingtalk.js';

const route = useRoute();
const router = useRouter();
const editId = computed(() => (route.query.id ? Number(route.query.id) : null));

const loading = ref(true);
const saving = ref(false);
const projects = ref([]);
const categories = ref([]);
const attachments = ref([]);

const invoiceHints = reactive({});
const budgetPreview = ref(null);
const ocrLoadingId = ref(null);
const ocrTargetLine = ref(0);
let invoiceTimers = {};
let budgetTimer = null;

const form = reactive({
  projectId: '',
  title: '',
  expenseDate: todayStr(),
  description: '',
  payeeName: '',
  payeeAccount: '',
  payeeBank: '',
  budgetExceptionType: '',
  budgetExceptionRemark: '',
  items: [{ costCategoryId: '', amount: '', taxAmount: '0', description: '', invoiceNo: '', invoiceCode: '' }],
});

const budgetWarnings = computed(() => budgetPreview.value?.warnings || []);
const hasOverBudgetError = computed(() =>
  (budgetPreview.value?.lines || []).some((l) => l.code === 'over_budget' && l.level === 'error'),
);
const hasMissingBudget = computed(() => !!budgetPreview.value?.missingBudget);
const canBypassMissingBudget = computed(() => !!budgetPreview.value?.canBypassMissingBudget);
const exceptionTypes = computed(() => {
  const list = budgetPreview.value?.exceptionTypes;
  if (list?.length) return list;
  return [
    {
      value: 'temp_staff_purchase',
      label: '临时人员采购',
      desc: '项目临时人员代采材料、工具、劳保用品等，凭票核销',
      remarkPlaceholder: '如：临时人员张三代购安全帽/雨衣…',
    },
    {
      value: 'seasonal_emergency',
      label: '雨季高温应急',
      desc: '雨季排水、防暑降温等临时用具/物资应急采购',
      remarkPlaceholder: '如：高温采购遮阳网；暴雨应急抽水泵…',
    },
    {
      value: 'temp_project',
      label: '临时项目',
      desc: '未正式立项或临时交办的园林工程费用',
      remarkPlaceholder: '如：业主临时交办补植…',
    },
    { value: 'petty_cash', label: '备用金', desc: '项目备用金垫付后核销', remarkPlaceholder: '如：备用金核销单号…' },
    { value: 'special_approval', label: '特批', desc: '领导书面或钉钉特批', remarkPlaceholder: '如：特批审批号…' },
  ];
});

const selectedCategoryCodes = computed(() => {
  const idToCode = new Map(categories.value.map((c) => [String(c.id), c.code]));
  return form.items.map((it) => idToCode.get(String(it.costCategoryId))).filter(Boolean);
});

const recommendedExceptionType = computed(() => {
  const codes = new Set(selectedCategoryCodes.value);
  let best = 'temp_staff_purchase';
  let bestScore = -1;
  for (const opt of exceptionTypes.value) {
    const score = (opt.suggestCategoryCodes || []).filter((c) => codes.has(c)).length;
    // fallback scoring by label keywords if API未带 suggest
    let s = score;
    if (!opt.suggestCategoryCodes?.length) {
      if (opt.value === 'temp_staff_purchase' && (codes.has('TEMP_LABOR') || codes.has('PETTY_BUY'))) s = 2;
      if (opt.value === 'seasonal_emergency' && codes.has('SEASONAL_GEAR')) s = 2;
    }
    if (s > bestScore) {
      bestScore = s;
      best = opt.value;
    }
  }
  return bestScore > 0 ? best : 'temp_staff_purchase';
});

const selectedException = computed(() =>
  exceptionTypes.value.find((o) => o.value === form.budgetExceptionType),
);

const needsBudgetException = computed(
  () => canBypassMissingBudget.value || (hasMissingBudget.value && !!budgetPreview.value?.strict),
);
const budgetBlocksSave = computed(() => {
  if (hasOverBudgetError.value) return true;
  if (needsBudgetException.value && !form.budgetExceptionType) return true;
  return false;
});

function applyRecommendedException() {
  if (!needsBudgetException.value) return;
  if (!form.budgetExceptionType) {
    form.budgetExceptionType = recommendedExceptionType.value;
  }
}

function addLine() {
  form.items.push({ costCategoryId: '', amount: '', taxAmount: '0', description: '', invoiceNo: '', invoiceCode: '' });
}

function removeLine(index) {
  if (form.items.length <= 1) return;
  delete invoiceHints[index];
  form.items.splice(index, 1);
  scheduleBudgetPreview();
}

function scheduleInvoiceCheck(idx) {
  clearTimeout(invoiceTimers[idx]);
  const it = form.items[idx];
  const no = it?.invoiceNo?.trim();
  if (!no || no.length < 4) {
    invoiceHints[idx] = null;
    return;
  }
  invoiceTimers[idx] = setTimeout(async () => {
    try {
      const result = await api.checkInvoiceDuplicate({
        no,
        code: it.invoiceCode?.trim() || undefined,
        excludeReimbId: editId.value || undefined,
      });
      if (result.duplicate) {
        invoiceHints[idx] = {
          level: 'error',
          message: `已在报销单 ${result.billNo}（${result.status}）中使用`,
        };
      } else {
        invoiceHints[idx] = { level: 'ok', message: '发票号可用' };
      }
    } catch {
      invoiceHints[idx] = null;
    }
  }, 400);
}

function scheduleBudgetPreview() {
  clearTimeout(budgetTimer);
  budgetTimer = setTimeout(async () => {
    if (!form.projectId) {
      budgetPreview.value = null;
      return;
    }
    const items = form.items
      .filter((it) => it.costCategoryId && Number(it.amount) > 0)
      .map((it) => ({
        costCategoryId: Number(it.costCategoryId),
        amount: Number(it.amount),
        taxAmount: Number(it.taxAmount) || 0,
      }));
    if (!items.length) {
      budgetPreview.value = null;
      return;
    }
    try {
      budgetPreview.value = await api.previewBudget({
        projectId: Number(form.projectId),
        expenseDate: form.expenseDate,
        items,
      });
      applyRecommendedException();
    } catch {
      budgetPreview.value = null;
    }
  }, 500);
}

watch(
  () => form.items.map((it) => [it.invoiceNo, it.invoiceCode].join('|')),
  () => {
    form.items.forEach((_, idx) => scheduleInvoiceCheck(idx));
  },
);

watch(
  () => [form.projectId, form.expenseDate, ...form.items.map((it) => `${it.costCategoryId}:${it.amount}:${it.taxAmount}`)],
  scheduleBudgetPreview,
);

watch(needsBudgetException, (need) => {
  if (!need && budgetPreview.value) {
    form.budgetExceptionType = '';
    form.budgetExceptionRemark = '';
  }
});

watch(recommendedExceptionType, (next, prev) => {
  if (!needsBudgetException.value) return;
  // 未选或仍停留在上一档推荐时，跟随新推荐（用户手动改选后不覆盖）
  if (!form.budgetExceptionType || form.budgetExceptionType === prev) {
    form.budgetExceptionType = next;
  }
});

function findTargetLineIdx() {
  const empty = form.items.findIndex((it) => !it.invoiceNo?.trim());
  return empty >= 0 ? empty : 0;
}

async function runOcr(fileId, lineIdx = ocrTargetLine.value) {
  ocrLoadingId.value = fileId;
  try {
    const result = await api.ocrInvoice(fileId);
    if (result.invoiceNo) {
      form.items[lineIdx].invoiceNo = result.invoiceNo;
      if (result.invoiceCode) {
        form.items[lineIdx].invoiceCode = result.invoiceCode;
      }
      toast(result.message || '已识别发票号');
      scheduleInvoiceCheck(lineIdx);
    } else {
      toast(result.message || '未能识别，请手动填写');
    }
  } catch (err) {
    alert(err.message);
  } finally {
    ocrLoadingId.value = null;
  }
}

async function onPickFile(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const saved = await api.uploadFile(file);
    attachments.value.push(saved);
    toast('上传成功');
    await runOcr(saved.id, findTargetLineIdx());
  } catch (err) {
    alert(err.message);
  }
  e.target.value = '';
}

function removeAttachment(id) {
  attachments.value = attachments.value.filter((a) => a.id !== id);
}

function buildPayload() {
  return {
    projectId: Number(form.projectId),
    title: form.title.trim(),
    expenseDate: form.expenseDate,
    description: form.description.trim(),
    payeeName: form.payeeName.trim(),
    payeeAccount: form.payeeAccount.trim(),
    payeeBank: form.payeeBank.trim(),
    budgetExceptionType: form.budgetExceptionType || undefined,
    budgetExceptionRemark: form.budgetExceptionRemark.trim() || undefined,
    items: form.items.map((it) => ({
      costCategoryId: Number(it.costCategoryId),
      amount: Number(it.amount),
      taxAmount: Number(it.taxAmount) || 0,
      description: it.description.trim(),
      invoiceNo: it.invoiceNo?.trim() || undefined,
      invoiceCode: it.invoiceCode?.trim() || undefined,
    })),
    attachmentIds: attachments.value.map((a) => a.id),
  };
}

async function onSaveDraft() {
  if (hasOverBudgetError.value) {
    alert('严格模式下已配置预算的科目超支，无法保存提交，请调整金额或科目');
    return;
  }
  if (needsBudgetException.value && !form.budgetExceptionType) {
    alert('该项目科目未配置年度预算，请选择例外类型（如临时人员采购 / 雨季高温应急 / 特批）');
    return;
  }
  if (!needsBudgetException.value) {
    form.budgetExceptionType = '';
    form.budgetExceptionRemark = '';
  }
  saving.value = true;
  try {
    const payload = buildPayload();
    let data;
    if (editId.value) {
      data = await api.updateReimbursement(editId.value, payload);
    } else {
      data = await api.createReimbursement(payload);
    }
    toast('已保存草稿');
    router.replace(`/reimb/${data.id}`);
  } catch (err) {
    alert(err.message);
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  try {
    const c = await api.listCostCategories();
    categories.value = c.list;
    if (categories.value.length && !form.items[0].costCategoryId) {
      form.items[0].costCategoryId = String(categories.value[0].id);
    }

    if (editId.value) {
      const d = await api.getReimbursement(editId.value);
      if (d.status !== 'draft') {
        alert('仅草稿可编辑');
        router.replace(`/reimb/${editId.value}`);
        return;
      }
      form.projectId = String(d.projectId);
      form.title = d.title;
      form.expenseDate = d.expenseDate?.slice?.(0, 10) || d.expenseDate;
      form.description = d.description || '';
      form.payeeName = d.payeeName || '';
      form.payeeAccount = d.payeeAccount || '';
      form.payeeBank = d.payeeBank || '';
      form.budgetExceptionType = d.budgetExceptionType || '';
      form.budgetExceptionRemark = d.budgetExceptionRemark || '';
      form.items = d.items.map((it) => ({
        costCategoryId: String(it.costCategoryId),
        amount: String(it.amount),
        taxAmount: String(it.taxAmount || 0),
        description: it.description || '',
        invoiceNo: it.invoiceNo || '',
        invoiceCode: it.invoiceCode || '',
      }));
      attachments.value = (d.attachments || []).map((a) => ({
        id: a.id,
        fileName: a.fileName,
        fileSize: a.fileSize,
      }));
    }

    await loadProjectOptions();
    if (form.projectId && !projects.value.some((p) => String(p.id) === String(form.projectId))) {
      form.projectId = '';
    }
    scheduleBudgetPreview();
  } catch (err) {
    alert(err.message);
  } finally {
    loading.value = false;
  }
});

async function loadProjectOptions() {
  const joined = await api.listProjects({ mode: 'joined' });
  projects.value = joined.list || [];
}
</script>

<template>
  <div class="page form-page">
    <div v-if="loading" class="loading-wrap"><div class="spinner" /></div>

    <template v-else>
      <section class="card">
        <label class="field">
          <span>所属项目 *</span>
          <select v-model="form.projectId" required>
            <option value="" disabled>请选择项目</option>
            <option v-for="p in projects" :key="p.id" :value="String(p.id)">
              {{ p.code }} · {{ p.name }}
            </option>
          </select>
        </label>
        <p v-if="!projects.length" class="muted help-tip">
          暂无可用项目。请联系财务或总经理将你加入项目组后再填报。
        </p>

        <label class="field">
          <span>报销标题 *</span>
          <input v-model="form.title" type="text" placeholder="如：XX项目苗木采购费" />
        </label>

        <label class="field">
          <span>费用发生日期 *</span>
          <input v-model="form.expenseDate" type="date" lang="zh-CN" />
        </label>

        <label class="field">
          <span>报销说明</span>
          <textarea v-model="form.description" rows="2" placeholder="补充说明" />
        </label>
      </section>

      <section v-if="budgetPreview?.lines?.length" class="card budget-hints">
        <h3 class="section-title">预算预览</h3>
        <ul class="hint-list">
          <li
            v-for="line in budgetPreview.lines"
            :key="line.costCategoryId"
            :class="['hint-item', line.level]"
          >
            <span class="hint-cat">{{ line.costCategoryName }}</span>
            <span>{{ line.message }}</span>
          </li>
        </ul>
        <p v-if="hasOverBudgetError" class="hint-foot error">
          严格模式下，已配置预算的科目超支将无法提交
        </p>
        <p v-else-if="needsBudgetException" class="hint-foot warn">
          未配置 {{ budgetPreview.fiscalYear || '当年' }} 年预算的科目，可按「临时人员采购 / 雨季高温应急 / 临时项目」等例外提交
        </p>
        <p v-else-if="budgetWarnings.length" class="hint-foot warn">提交前请关注预算预警</p>
      </section>

      <section v-if="needsBudgetException" class="card exception-card">
        <h3 class="section-title">预算例外类型 *</h3>
        <p class="muted exception-hint">
          适用于临时人员采购、雨季高温应急、临时项目等未建年度预算的场景；已配置预算且超支不可用此选项绕过。
        </p>
        <p v-if="recommendedExceptionType" class="recommend-tip">
          根据费用科目，建议选择：
          <strong>{{ exceptionTypes.find((o) => o.value === recommendedExceptionType)?.label }}</strong>
          <button type="button" class="text-btn" @click="form.budgetExceptionType = recommendedExceptionType">
            一键采用
          </button>
        </p>
        <div class="exception-options">
          <label
            v-for="opt in exceptionTypes"
            :key="opt.value"
            class="exception-option"
            :class="{
              active: form.budgetExceptionType === opt.value,
              recommend: opt.value === recommendedExceptionType,
            }"
          >
            <input v-model="form.budgetExceptionType" type="radio" :value="opt.value" />
            <span class="exception-copy">
              <strong>
                {{ opt.label }}
                <em v-if="opt.value === recommendedExceptionType" class="badge">推荐</em>
              </strong>
              <span v-if="opt.desc" class="muted">{{ opt.desc }}</span>
            </span>
          </label>
        </div>
        <label class="field">
          <span>例外说明{{ form.budgetExceptionType === 'temp_staff_purchase' ? '（建议填写代采人与用途）' : '' }}</span>
          <textarea
            v-model="form.budgetExceptionRemark"
            rows="2"
            :placeholder="selectedException?.remarkPlaceholder || '如：临时人员代购 / 备用金垫付 / 特批编号…'"
          />
        </label>
      </section>

      <section class="card">
        <div class="section-head">
          <h3>费用明细 *</h3>
          <button type="button" class="text-btn" @click="addLine">+ 添加</button>
        </div>

        <div v-for="(it, idx) in form.items" :key="idx" class="item-block">
          <label class="field">
            <span>科目</span>
            <select v-model="it.costCategoryId">
              <option v-for="c in categories" :key="c.id" :value="String(c.id)">{{ c.name }}</option>
            </select>
          </label>
          <label class="field">
            <span>金额（元）</span>
            <input v-model="it.amount" type="number" min="0" step="0.01" placeholder="0.00" />
          </label>
          <label class="field">
            <span>说明</span>
            <input v-model="it.description" type="text" placeholder="可选" />
          </label>
          <label class="field">
            <span>发票号码</span>
            <input v-model="it.invoiceNo" type="text" placeholder="选填，用于查重" />
            <p v-if="invoiceHints[idx]" :class="['inline-hint', invoiceHints[idx].level]">
              {{ invoiceHints[idx].message }}
            </p>
          </label>
          <button v-if="form.items.length > 1" type="button" class="remove-btn" @click="removeLine(idx)">
            删除此行
          </button>
        </div>
      </section>

      <section class="card">
        <h3 class="section-title">收款信息</h3>
        <label class="field"><span>户名</span><input v-model="form.payeeName" type="text" /></label>
        <label class="field"><span>账号</span><input v-model="form.payeeAccount" type="text" /></label>
        <label class="field"><span>开户行</span><input v-model="form.payeeBank" type="text" /></label>
      </section>

      <section class="card">
        <h3 class="section-title">发票 / 凭证附件</h3>
        <label v-if="form.items.length > 1" class="field">
          <span>识别填入明细行</span>
          <select v-model.number="ocrTargetLine">
            <option v-for="(_, idx) in form.items" :key="idx" :value="idx">第 {{ idx + 1 }} 行</option>
          </select>
        </label>
        <ul v-if="attachments.length" class="file-list">
          <li v-for="f in attachments" :key="f.id">
            <span>{{ f.fileName }}</span>
            <div class="file-actions">
              <button
                type="button"
                class="ocr-btn"
                :disabled="ocrLoadingId === f.id"
                @click="runOcr(f.id, ocrTargetLine)"
              >
                {{ ocrLoadingId === f.id ? '识别中…' : '识别发票号' }}
              </button>
              <button type="button" @click="removeAttachment(f.id)">移除</button>
            </div>
          </li>
        </ul>
        <label class="upload-btn">
          <input type="file" accept="image/*,.pdf" hidden @change="onPickFile" />
          + 上传附件
        </label>
      </section>

      <button
        class="btn-primary"
        type="button"
        :disabled="saving || budgetBlocksSave"
        @click="onSaveDraft"
      >
        {{ saving ? '保存中…' : '保存草稿' }}
      </button>
    </template>
  </div>
</template>

<style scoped>
.form-page {
  display: grid;
  gap: 12px;
  /* 预留底部 TabBar，避免「保存草稿」被挡住 */
  padding-bottom: calc(72px + var(--safe-bottom));
}

.form-page > .btn-primary {
  position: sticky;
  bottom: calc(64px + var(--safe-bottom));
  z-index: 5;
  box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.08);
}

.field {
  display: grid;
  gap: 6px;
  margin-bottom: 12px;
  font-size: 14px;
}

.field span {
  color: var(--color-muted);
}

.field input,
.field select,
.field textarea {
  width: 100%;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 10px 12px;
  font: inherit;
  background: #fff;
}

.section-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.section-head h3,
.section-title {
  font-size: 15px;
}

.text-btn {
  border: none;
  background: none;
  color: var(--color-primary);
  font-size: 14px;
}

.item-block {
  padding: 10px 0;
  border-top: 1px dashed var(--color-border);
}

.remove-btn {
  border: none;
  background: none;
  color: var(--color-danger);
  font-size: 13px;
  padding: 4px 0;
}

.file-list {
  list-style: none;
  margin-bottom: 10px;
}

.file-list li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  padding: 6px 0;
}

.file-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.ocr-btn {
  border: none;
  background: none;
  color: var(--color-primary);
  font-size: 13px;
}

.file-list button {
  border: none;
  background: none;
  color: var(--color-danger);
  font-size: 13px;
}

.upload-btn {
  display: block;
  text-align: center;
  padding: 12px;
  border: 1px dashed var(--color-border);
  border-radius: 10px;
  color: var(--color-primary);
  font-size: 14px;
}

.budget-hints {
  border-left: 3px solid var(--color-primary);
}

.exception-card {
  border-left: 3px solid #fa8c16;
}

.exception-hint {
  margin-bottom: 10px;
  line-height: 1.45;
}

.exception-options {
  display: grid;
  gap: 8px;
  margin-bottom: 12px;
}

.exception-option {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  font-size: 14px;
  background: #fff;
}

.exception-option.active {
  border-color: #fa8c16;
  background: #fff7e6;
}

.exception-option.recommend:not(.active) {
  border-color: #91caff;
  background: #f0f7ff;
}

.exception-option input {
  margin-top: 3px;
}

.exception-copy {
  display: grid;
  gap: 2px;
}

.exception-copy strong {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
}

.badge {
  font-style: normal;
  font-size: 11px;
  font-weight: 500;
  color: #1677ff;
  background: #e6f4ff;
  padding: 1px 6px;
  border-radius: 999px;
}

.recommend-tip {
  font-size: 13px;
  margin-bottom: 10px;
  color: #1677ff;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.hint-list {
  list-style: none;
  display: grid;
  gap: 8px;
}

.hint-item {
  display: grid;
  gap: 2px;
  font-size: 13px;
  padding: 8px 10px;
  border-radius: 8px;
  background: #f5f6f8;
}

.hint-item.ok {
  color: var(--color-success);
}

.hint-item.warn {
  background: #fff7e6;
  color: #d48806;
}

.hint-item.error {
  background: #fff1f0;
  color: var(--color-danger);
}

.hint-cat {
  font-weight: 500;
}

.hint-foot {
  margin-top: 8px;
  font-size: 12px;
}

.hint-foot.error {
  color: var(--color-danger);
}

.hint-foot.warn {
  color: #d48806;
}

.inline-hint {
  font-size: 12px;
  margin-top: 2px;
}

.inline-hint.ok {
  color: var(--color-success);
}

.inline-hint.error {
  color: var(--color-danger);
}

.help-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  margin: 0 0 14px;
  color: #595959;
}

.help-tip {
  font-size: 12px;
  margin: -4px 0 10px;
}
</style>
