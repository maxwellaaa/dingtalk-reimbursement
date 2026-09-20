import { query, withTransaction } from '../db/pool.js';
import {
  canViewReimbursement,
  cancelInternalApproval,
  enrichPendingTaskContext,
  listApprovalTimeline,
  submitApprovalFlow,
} from './approval.js';
import {
  releaseBudgetOnReject,
  isValidBudgetExceptionType,
  budgetExceptionLabel,
} from './budget.js';
import { checkInvoiceDuplicate, upsertInvoice } from './invoice.js';
import { getApprovalMode } from './sysConfig.js';

const STATUS_LABEL = {
  draft: '草稿',
  pending: '待提交',
  approving: '审批中',
  approved: '已通过',
  rejected: '已驳回',
  paid: '已付款',
  cancelled: '已撤销',
};

function formatBillNo(date, seq) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `RB${y}${m}${d}${String(seq).padStart(4, '0')}`;
}

async function nextBillNo(conn) {
  const prefix = formatBillNo(new Date(), 0).slice(0, 10);
  const [rows] = await conn.query(
    'SELECT COUNT(*) AS c FROM reimbursement WHERE bill_no LIKE ?',
    [`${prefix}%`],
  );
  return formatBillNo(new Date(), Number(rows[0].c) + 1);
}

function sumItems(items) {
  return items.reduce(
    (acc, it) => {
      acc.amount += Number(it.amount) || 0;
      acc.tax += Number(it.taxAmount) || 0;
      return acc;
    },
    { amount: 0, tax: 0 },
  );
}

async function loadItems(reimbursementId) {
  return query(
    `SELECT ri.id, ri.line_no AS lineNo, ri.cost_category_id AS costCategoryId,
            cc.name AS costCategoryName, ri.amount, ri.tax_amount AS taxAmount, ri.description,
            ri.invoice_id AS invoiceId, i.invoice_no AS invoiceNo, i.invoice_code AS invoiceCode
     FROM reimbursement_item ri
     JOIN cost_category cc ON cc.id = ri.cost_category_id
     LEFT JOIN invoice i ON i.id = ri.invoice_id
     WHERE ri.reimbursement_id = :id
     ORDER BY ri.line_no`,
    { id: reimbursementId },
  );
}

async function loadAttachments(reimbursementId) {
  return query(
    `SELECT id, file_name AS fileName, file_size AS fileSize, mime_type AS mimeType, created_at AS createdAt
     FROM file_attachment
     WHERE biz_type = 'reimbursement' AND biz_id = :id
     ORDER BY id`,
    { id: reimbursementId },
  );
}

async function enrichReimbursement(row) {
  if (!row) return null;
  const [items, attachments] = await Promise.all([
    loadItems(row.id),
    loadAttachments(row.id),
  ]);
  return {
    ...row,
    expenseDate: toDateOnly(row.expenseDate),
    submitAt: row.submitAt,
    approvedAt: row.approvedAt,
    createdAt: row.createdAt,
    statusLabel: STATUS_LABEL[row.status] || row.status,
    budgetExceptionLabel: row.budgetExceptionType
      ? budgetExceptionLabel(row.budgetExceptionType)
      : null,
    items,
    attachments,
  };
}

/** MySQL DATE / Date → YYYY-MM-DD，避免 JSON 序列化成 UTC 导致前移一天 */
function toDateOnly(value) {
  if (value == null || value === '') return value;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return s;
}

export async function listReimbursements(userId, { status, page = 1, pageSize = 20, mine = false } = {}) {
  const { resolveDataScope, buildReimbursementScopeFilter } = await import('./accessScope.js');
  const scope = await resolveDataScope(userId);
  const scopeFilter = buildReimbursementScopeFilter(scope, 'r');
  const offset = (page - 1) * pageSize;
  let where = `WHERE ${scopeFilter.sql}`;
  const params = { ...scopeFilter.params, limit: pageSize, offset };

  if (mine) {
    where += ' AND r.applicant_user_id = :mineUserId';
    params.mineUserId = userId;
  }

  if (status) {
    where += ' AND r.status = :status';
    params.status = status;
  }

  const rows = await query(
    `SELECT r.id, r.bill_no AS billNo, r.title, r.status, r.reimburse_amount AS reimburseAmount,
            r.expense_date AS expenseDate, r.submit_at AS submitAt, r.created_at AS createdAt,
            p.code AS projectCode, p.name AS projectName
     FROM reimbursement r
     JOIN project p ON p.id = r.project_id
     ${where}
     ORDER BY r.created_at DESC
     LIMIT :limit OFFSET :offset`,
    params,
  );

  const countRows = await query(
    `SELECT COUNT(*) AS total FROM reimbursement r ${where}`,
    params,
  );

  return {
    list: rows.map((r) => ({
      ...r,
      expenseDate: toDateOnly(r.expenseDate),
      statusLabel: STATUS_LABEL[r.status] || r.status,
    })),
    total: Number(countRows[0].total),
    page,
    pageSize,
    scope: {
      level: scope.level,
      label: scope.scopeLabel,
      primaryRole: scope.primaryRole,
      primaryGrade: scope.primaryGrade,
    },
  };
}

async function fetchReimbursementRow(id) {
  const rows = await query(
    `SELECT r.id, r.bill_no AS billNo, r.project_id AS projectId, r.title, r.status,
            r.total_amount AS totalAmount, r.reimburse_amount AS reimburseAmount,
            r.payee_name AS payeeName, r.payee_account AS payeeAccount, r.payee_bank AS payeeBank,
            r.expense_date AS expenseDate, r.description, r.submit_at AS submitAt,
            r.approved_at AS approvedAt, r.approval_mode AS approvalMode, r.created_at AS createdAt,
            r.applicant_user_id AS applicantUserId,
            r.budget_exception_type AS budgetExceptionType,
            r.budget_exception_remark AS budgetExceptionRemark,
            p.code AS projectCode, p.name AS projectName,
            u.name AS applicantName
     FROM reimbursement r
     JOIN project p ON p.id = r.project_id
     JOIN user_account u ON u.id = r.applicant_user_id
     WHERE r.id = :id
     LIMIT 1`,
    { id },
  );
  return rows[0] || null;
}

export async function getReimbursement(id, userId) {
  const allowed = await canViewReimbursement(id, userId);
  if (!allowed) return null;

  const row = await fetchReimbursementRow(id);
  if (!row) return null;

  const enriched = await enrichReimbursement(row);

  const pendingTask = await query(
    `SELECT t.id AS taskId, t.node_order AS nodeOrder
     FROM approval_task t
     JOIN approval_instance ai ON ai.id = t.instance_id
     WHERE ai.reimbursement_id = :id AND t.assignee_user_id = :userId AND t.status = 'pending'
     LIMIT 1`,
    { id, userId },
  );
  enriched.pendingTask = await enrichPendingTaskContext(pendingTask[0] || null);
  enriched.approvalTimeline = await listApprovalTimeline(id);

  return enriched;
}

async function replaceItems(conn, reimbursementId, items, userId) {
  await conn.query('DELETE FROM reimbursement_item WHERE reimbursement_id = ?', [reimbursementId]);
  let lineNo = 1;
  for (const it of items) {
    let invoiceId = it.invoiceId || null;
    if (it.invoiceNo) {
      const dup = await checkInvoiceDuplicate(it.invoiceNo, it.invoiceCode, reimbursementId);
      if (dup.duplicate) {
        throw new Error(`发票 ${it.invoiceNo} 已在报销单 ${dup.billNo} 中使用`);
      }
      invoiceId = await upsertInvoice(conn, {
        invoiceNo: it.invoiceNo,
        invoiceCode: it.invoiceCode,
        amount: Number(it.amount) + Number(it.taxAmount || 0),
        userId,
      });
    }
    await conn.query(
      `INSERT INTO reimbursement_item (reimbursement_id, line_no, cost_category_id, amount, tax_amount, description, invoice_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        reimbursementId,
        lineNo++,
        it.costCategoryId,
        it.amount,
        it.taxAmount || 0,
        it.description || null,
        invoiceId,
      ],
    );
  }
}

async function linkAttachments(conn, reimbursementId, attachmentIds, userId) {
  if (!attachmentIds?.length) return;
  await conn.query(
    `UPDATE file_attachment
     SET biz_type = 'reimbursement', biz_id = ?
     WHERE id IN (?) AND uploaded_by = ? AND biz_type = 'pending'`,
    [reimbursementId, attachmentIds, userId],
  );
}

function normalizeBudgetException(payload = {}) {
  const type = payload.budgetExceptionType || null;
  const remark = (payload.budgetExceptionRemark || '').trim() || null;
  if (!type) {
    return { budgetExceptionType: null, budgetExceptionRemark: null };
  }
  if (!isValidBudgetExceptionType(type)) {
    throw new Error('预算例外类型无效，请选择：临时人员采购 / 雨季高温应急 / 临时项目 / 备用金 / 特批');
  }
  return { budgetExceptionType: type, budgetExceptionRemark: remark };
}

export async function createReimbursement(userId, payload) {
  const {
    projectId,
    title,
    expenseDate,
    description,
    payeeName,
    payeeAccount,
    payeeBank,
    items = [],
    attachmentIds = [],
  } = payload;
  const { budgetExceptionType, budgetExceptionRemark } = normalizeBudgetException(payload);

  if (!projectId || !title || !expenseDate) {
    throw new Error('项目、标题、费用日期为必填');
  }
  if (!items.length) {
    throw new Error('至少一条费用明细');
  }

  const project = await query('SELECT id, region_id FROM project WHERE id = :id AND status = \'active\' LIMIT 1', {
    id: projectId,
  });
  if (!project[0]) throw new Error('项目不存在或已关闭');

  const totals = sumItems(items);
  const approvalMode = await getApprovalMode();

  const reimbId = await withTransaction(async (conn) => {
    const billNo = await nextBillNo(conn);
    const [result] = await conn.query(
      `INSERT INTO reimbursement
       (bill_no, project_id, applicant_user_id, region_id, title, total_amount, reimburse_amount,
        payee_name, payee_account, payee_bank, expense_date, description, status, approval_mode,
        budget_exception_type, budget_exception_remark)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`,
      [
        billNo,
        projectId,
        userId,
        project[0].region_id,
        title,
        totals.amount + totals.tax,
        totals.amount + totals.tax,
        payeeName || null,
        payeeAccount || null,
        payeeBank || null,
        expenseDate,
        description || null,
        approvalMode,
        budgetExceptionType,
        budgetExceptionRemark,
      ],
    );

    const id = result.insertId;
    await replaceItems(conn, id, items, userId);
    await linkAttachments(conn, id, attachmentIds, userId);
    return id;
  });
  return getReimbursement(reimbId, userId);
}

export async function updateReimbursement(id, userId, payload) {
  const existing = await query(
    'SELECT id, status FROM reimbursement WHERE id = :id AND applicant_user_id = :userId LIMIT 1',
    { id, userId },
  );
  if (!existing[0]) throw new Error('报销单不存在');
  if (existing[0].status !== 'draft') throw new Error('仅草稿可编辑');

  const {
    projectId,
    title,
    expenseDate,
    description,
    payeeName,
    payeeAccount,
    payeeBank,
    items = [],
    attachmentIds,
  } = payload;
  const { budgetExceptionType, budgetExceptionRemark } = normalizeBudgetException(payload);

  const project = await query('SELECT id, region_id FROM project WHERE id = :id LIMIT 1', { id: projectId });
  if (!project[0]) throw new Error('项目不存在');

  const totals = sumItems(items);

  await withTransaction(async (conn) => {
    await conn.query(
      `UPDATE reimbursement SET
         project_id = ?, region_id = ?, title = ?, total_amount = ?, reimburse_amount = ?,
         payee_name = ?, payee_account = ?, payee_bank = ?, expense_date = ?, description = ?,
         budget_exception_type = ?, budget_exception_remark = ?
       WHERE id = ?`,
      [
        projectId,
        project[0].region_id,
        title,
        totals.amount + totals.tax,
        totals.amount + totals.tax,
        payeeName || null,
        payeeAccount || null,
        payeeBank || null,
        expenseDate,
        description || null,
        budgetExceptionType,
        budgetExceptionRemark,
        id,
      ],
    );
    await replaceItems(conn, id, items, userId);
    if (attachmentIds) {
      await linkAttachments(conn, id, attachmentIds, userId);
    }
  });
  return getReimbursement(id, userId);
}

export async function submitReimbursement(id, userId, overrides = {}) {
  const existing = await query(
    'SELECT id, status FROM reimbursement WHERE id = :id AND applicant_user_id = :userId LIMIT 1',
    { id, userId },
  );
  if (!existing[0]) throw new Error('报销单不存在');
  if (existing[0].status !== 'draft') throw new Error('仅草稿可提交');

  const submitResult = await submitApprovalFlow(id, userId, overrides);
  const reimb = await getReimbursement(id, userId);
  return { ...reimb, submitResult };
}

export async function cancelReimbursement(id, userId) {
  const existing = await query(
    'SELECT id, status, approval_mode AS approvalMode FROM reimbursement WHERE id = :id AND applicant_user_id = :userId LIMIT 1',
    { id, userId },
  );
  if (!existing[0]) throw new Error('报销单不存在');
  if (existing[0].status !== 'approving') throw new Error('仅审批中的报销单可撤回');

  if (existing[0].approvalMode === 'A') {
    await cancelInternalApproval(id);
  }

  await query(`UPDATE reimbursement SET status = 'cancelled' WHERE id = :id`, { id });
  await releaseBudgetOnReject(id, '撤回释放');
  return getReimbursement(id, userId);
}

/**
 * 已驳回 → 草稿：保留明细与附件，关闭旧审批实例，便于修改后重新提交
 */
export async function reopenRejectedReimbursement(id, userId) {
  const existing = await query(
    `SELECT id, status, approval_mode AS approvalMode
     FROM reimbursement WHERE id = :id AND applicant_user_id = :userId LIMIT 1`,
    { id, userId },
  );
  if (!existing[0]) throw new Error('报销单不存在');
  if (existing[0].status !== 'rejected') throw new Error('仅已驳回的报销单可修改重提');

  await withTransaction(async (conn) => {
    // 保留驳回历史：取消旧实例后，若有 uk_reimb 唯一约束则删除以便重新发起
    const [instances] = await conn.query(
      `SELECT id FROM approval_instance
       WHERE reimbursement_id = ? AND status IN ('pending', 'rejected', 'cancelled')`,
      [id],
    );
    for (const inst of instances) {
      await conn.query(`DELETE FROM approval_task WHERE instance_id = ?`, [inst.id]);
      await conn.query(`DELETE FROM approval_instance WHERE id = ?`, [inst.id]);
    }

    await conn.query(
      `UPDATE reimbursement
       SET status = 'draft', submit_at = NULL, approved_at = NULL, approval_mode = 'A'
       WHERE id = ?`,
      [id],
    );
  });

  return getReimbursement(id, userId);
}

export async function deleteReimbursement(id, userId) {
  const existing = await query(
    'SELECT id, status FROM reimbursement WHERE id = :id AND applicant_user_id = :userId LIMIT 1',
    { id, userId },
  );
  if (!existing[0]) throw new Error('报销单不存在');
  if (existing[0].status !== 'draft') throw new Error('仅草稿可删除');

  await withTransaction(async (conn) => {
    await conn.query('DELETE FROM reimbursement_item WHERE reimbursement_id = ?', [id]);
    await conn.query('DELETE FROM file_attachment WHERE biz_type = \'reimbursement\' AND biz_id = ?', [id]);
    await conn.query('DELETE FROM reimbursement WHERE id = ?', [id]);
  });
  return { id };
}

export { STATUS_LABEL };
