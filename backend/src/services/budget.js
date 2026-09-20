import { query, withTransaction } from '../db/pool.js';
import { getConfig } from './sysConfig.js';
import {
  BUDGET_EXCEPTION_TYPE_DEFS,
  isValidBudgetExceptionType,
  budgetExceptionLabel,
  listBudgetExceptionTypes,
} from '../constants/landscapeFinance.js';

export {
  BUDGET_EXCEPTION_TYPE_DEFS,
  isValidBudgetExceptionType,
  budgetExceptionLabel,
  listBudgetExceptionTypes,
};

/** @deprecated 使用 listBudgetExceptionTypes；保留短标签映射兼容旧逻辑 */
export const BUDGET_EXCEPTION_TYPES = Object.fromEntries(
  Object.entries(BUDGET_EXCEPTION_TYPE_DEFS).map(([k, v]) => [k, v.label]),
);

export async function isStrictBudgetMode() {
  return (await getConfig('budget.strict_mode', 'true')) === 'true';
}

const USED_AMOUNT_EXPR = `COALESCE(SUM(CASE WHEN change_amount < 0 THEN ABS(change_amount) ELSE -change_amount END), 0)`;

async function getUsedAmount(projectId, costCategoryId, conn = null) {
  const sql = `SELECT ${USED_AMOUNT_EXPR} AS used
     FROM budget_ledger
     WHERE project_id = ? AND cost_category_id = ?`;
  const params = [projectId, costCategoryId];
  if (conn) {
    const [rows] = await conn.query(sql, params);
    return Number(rows[0].used);
  }
  const rows = await query(
    `SELECT ${USED_AMOUNT_EXPR} AS used
     FROM budget_ledger
     WHERE project_id = :projectId AND cost_category_id = :costCategoryId`,
    { projectId, costCategoryId },
  );
  return Number(rows[0].used);
}

async function getBudgetRow(projectId, costCategoryId, fiscalYear) {
  const rows = await query(
    `SELECT id, budget_amount AS budgetAmount, warn_threshold AS warnThreshold
     FROM project_budget
     WHERE project_id = :projectId AND cost_category_id = :costCategoryId
       AND fiscal_year = :year AND status = 1
     LIMIT 1`,
    { projectId, costCategoryId, year: fiscalYear },
  );
  return rows[0] || null;
}

export async function validateBudgetForReimbursement(reimbId) {
  const reimbRows = await query(
    `SELECT project_id AS projectId, expense_date AS expenseDate,
            budget_exception_type AS budgetExceptionType,
            budget_exception_remark AS budgetExceptionRemark
     FROM reimbursement WHERE id = :id LIMIT 1`,
    { id: reimbId },
  );
  const reimb = reimbRows[0];
  if (!reimb) throw new Error('报销单不存在');

  const fiscalYear = new Date(reimb.expenseDate).getFullYear();
  const strict = await isStrictBudgetMode();
  const exceptionType = reimb.budgetExceptionType || null;
  const hasException = isValidBudgetExceptionType(exceptionType);
  const items = await query(
    `SELECT ri.cost_category_id AS costCategoryId, cc.name AS costCategoryName,
            ri.amount, ri.tax_amount AS taxAmount
     FROM reimbursement_item ri
     JOIN cost_category cc ON cc.id = ri.cost_category_id
     WHERE ri.reimbursement_id = :id`,
    { id: reimbId },
  );

  const warnings = [];
  let missingBudget = false;

  for (const item of items) {
    const budget = await getBudgetRow(reimb.projectId, item.costCategoryId, fiscalYear);
    const itemAmount = Number(item.amount) + Number(item.taxAmount || 0);
    if (!budget) {
      missingBudget = true;
      if (strict && !hasException) {
        throw new Error(
          `科目「${item.costCategoryName}」未配置 ${fiscalYear} 年预算。若属临时人员采购/临时项目/备用金/特批等，请在填单时选择对应例外类型后再提交`,
        );
      }
      warnings.push({
        costCategoryName: item.costCategoryName,
        code: 'missing_budget',
        message: hasException
          ? `未配置预算，按「${budgetExceptionLabel(exceptionType)}」例外提交`
          : '未配置预算',
      });
      continue;
    }

    const used = await getUsedAmount(reimb.projectId, item.costCategoryId);
    const remaining = Number(budget.budgetAmount) - used;
    const warnLine = Number(budget.budgetAmount) * Number(budget.warnThreshold || 0.9);

    if (itemAmount > remaining) {
      // 已配置预算的超支：严格模式始终拦截，例外类型不可绕过
      if (strict) {
        throw new Error(
          `科目「${item.costCategoryName}」超预算：剩余 ¥${remaining.toFixed(2)}，本次 ¥${itemAmount.toFixed(2)}`,
        );
      }
      warnings.push({
        costCategoryName: item.costCategoryName,
        code: 'over_budget',
        message: `超预算（剩余 ¥${remaining.toFixed(2)}）`,
      });
    } else if (used + itemAmount >= warnLine) {
      warnings.push({
        costCategoryName: item.costCategoryName,
        code: 'warn_threshold',
        message: `已达预警线（已用 ¥${(used + itemAmount).toFixed(2)} / ¥${budget.budgetAmount}）`,
      });
    }
  }

  if (hasException && !missingBudget) {
    throw new Error('所选科目均已配置预算，无需填写预算例外类型');
  }

  return {
    ok: true,
    warnings,
    missingBudget,
    budgetExceptionType: exceptionType,
    budgetExceptionLabel: hasException ? budgetExceptionLabel(exceptionType) : null,
  };
}

export async function previewBudgetForItems({ projectId, expenseDate, items }) {
  if (!projectId || !items?.length) {
    return {
      ok: true,
      strict: await isStrictBudgetMode(),
      missingBudget: false,
      overBudget: false,
      canBypassMissingBudget: false,
      exceptionTypes: listBudgetExceptionTypes(),
      warnings: [],
      lines: [],
    };
  }

  const fiscalYear = new Date(expenseDate || new Date()).getFullYear();
  const strict = await isStrictBudgetMode();
  const warnings = [];
  const lines = [];
  let missingBudget = false;
  let overBudget = false;

  const byCategory = new Map();
  for (const raw of items) {
    const costCategoryId = Number(raw.costCategoryId);
    const amount = Number(raw.amount) || 0;
    const taxAmount = Number(raw.taxAmount) || 0;
    const itemAmount = amount + taxAmount;
    if (!costCategoryId || itemAmount <= 0) continue;
    byCategory.set(costCategoryId, (byCategory.get(costCategoryId) || 0) + itemAmount);
  }

  for (const [costCategoryId, itemAmount] of byCategory) {
    const catRows = await query(
      'SELECT name FROM cost_category WHERE id = :id LIMIT 1',
      { id: costCategoryId },
    );
    const costCategoryName = catRows[0]?.name || `科目#${costCategoryId}`;
    const budget = await getBudgetRow(projectId, costCategoryId, fiscalYear);

    if (!budget) {
      missingBudget = true;
      const entry = {
        costCategoryId,
        costCategoryName,
        code: 'missing_budget',
        level: strict ? 'error' : 'warn',
        message: `科目「${costCategoryName}」未配置 ${fiscalYear} 年预算`,
      };
      lines.push(entry);
      if (strict) warnings.push(entry);
      continue;
    }

    const used = await getUsedAmount(projectId, costCategoryId);
    const remaining = Number(budget.budgetAmount) - used;
    const warnLine = Number(budget.budgetAmount) * Number(budget.warnThreshold || 0.9);
    const afterUsed = used + itemAmount;

    let entry;
    if (itemAmount > remaining) {
      overBudget = true;
      entry = {
        costCategoryId,
        costCategoryName,
        code: 'over_budget',
        level: strict ? 'error' : 'warn',
        message: `超预算：剩余 ¥${remaining.toFixed(2)}，本次 ¥${itemAmount.toFixed(2)}`,
        remaining,
        budgetAmount: Number(budget.budgetAmount),
        usedAmount: used,
      };
    } else if (afterUsed >= warnLine) {
      entry = {
        costCategoryId,
        costCategoryName,
        code: 'warn_threshold',
        level: 'warn',
        message: `已达预警线（提交后已用 ¥${afterUsed.toFixed(2)} / ¥${budget.budgetAmount}）`,
        remaining,
        budgetAmount: Number(budget.budgetAmount),
        usedAmount: used,
      };
    } else {
      entry = {
        costCategoryId,
        costCategoryName,
        code: 'ok',
        level: 'ok',
        message: `剩余 ¥${(remaining - itemAmount).toFixed(2)}`,
        remaining: remaining - itemAmount,
        budgetAmount: Number(budget.budgetAmount),
        usedAmount: used,
      };
    }
    lines.push(entry);
    if (entry.level !== 'ok') warnings.push(entry);
  }

  const hardBlock = strict && overBudget;
  const canBypassMissingBudget = strict && missingBudget && !overBudget;

  return {
    // 仅「已配置预算且超支」在严格模式下不可提交；缺预算可通过例外类型绕过
    ok: !hardBlock,
    strict,
    missingBudget,
    overBudget,
    canBypassMissingBudget,
    fiscalYear,
    exceptionTypes: listBudgetExceptionTypes(),
    warnings,
    lines,
  };
}

export async function occupyBudgetOnApproval(reimbId) {
  const existing = await query(
    `SELECT id FROM budget_ledger WHERE reimbursement_id = :id AND biz_type = 'occupy' LIMIT 1`,
    { id: reimbId },
  );
  if (existing[0]) return;

  const reimbRows = await query(
    'SELECT project_id AS projectId, expense_date AS expenseDate, bill_no AS billNo FROM reimbursement WHERE id = :id LIMIT 1',
    { id: reimbId },
  );
  const reimb = reimbRows[0];
  if (!reimb) return;

  const fiscalYear = new Date(reimb.expenseDate).getFullYear();
  const items = await query(
    `SELECT cost_category_id AS costCategoryId, amount, tax_amount AS taxAmount
     FROM reimbursement_item WHERE reimbursement_id = :id`,
    { id: reimbId },
  );

  await withTransaction(async (conn) => {
    const pendingByCategory = new Map();

    for (const item of items) {
      const amount = Number(item.amount) + Number(item.taxAmount || 0);
      if (amount <= 0) continue;

      const budget = await getBudgetRow(reimb.projectId, item.costCategoryId, fiscalYear);
      if (!budget) continue;

      const dbUsed = await getUsedAmount(reimb.projectId, item.costCategoryId, conn);
      const pendingUsed = pendingByCategory.get(item.costCategoryId) || 0;
      const totalUsed = dbUsed + pendingUsed;
      const balanceAfter = Number(budget.budgetAmount) - totalUsed - amount;

      await conn.query(
        `INSERT INTO budget_ledger
         (project_id, cost_category_id, reimbursement_id, change_amount, balance_after, biz_type, remark)
         VALUES (?, ?, ?, ?, ?, 'occupy', ?)`,
        [
          reimb.projectId,
          item.costCategoryId,
          reimbId,
          -amount,
          balanceAfter,
          `报销单 ${reimb.billNo} 审批通过占用`,
        ],
      );
      pendingByCategory.set(item.costCategoryId, pendingUsed + amount);
    }
  });
}

export async function releaseBudgetOnReject(reimbId, remark = '驳回释放') {
  const existing = await query(
    `SELECT id FROM budget_ledger WHERE reimbursement_id = :id AND biz_type = 'release' LIMIT 1`,
    { id: reimbId },
  );
  if (existing[0]) return;

  const occupies = await query(
    `SELECT project_id AS projectId, cost_category_id AS costCategoryId, change_amount AS changeAmount
     FROM budget_ledger WHERE reimbursement_id = :id AND biz_type = 'occupy'`,
    { id: reimbId },
  );
  if (!occupies.length) return;

  const reimbRows = await query(
    'SELECT bill_no AS billNo, expense_date AS expenseDate FROM reimbursement WHERE id = :id LIMIT 1',
    { id: reimbId },
  );
  const reimb = reimbRows[0];
  if (!reimb) return;

  const fiscalYear = new Date(reimb.expenseDate).getFullYear();
  const billNo = reimb.billNo || reimbId;

  await withTransaction(async (conn) => {
    const pendingByCategory = new Map();

    for (const occ of occupies) {
      const amount = Math.abs(Number(occ.changeAmount));
      if (amount <= 0) continue;

      const budget = await getBudgetRow(occ.projectId, occ.costCategoryId, fiscalYear);
      const dbUsed = await getUsedAmount(occ.projectId, occ.costCategoryId, conn);
      const pendingRelease = pendingByCategory.get(occ.costCategoryId) || 0;
      const totalUsed = dbUsed - pendingRelease;
      const balanceAfter = budget
        ? Number(budget.budgetAmount) - totalUsed + amount
        : totalUsed - amount;

      await conn.query(
        `INSERT INTO budget_ledger
         (project_id, cost_category_id, reimbursement_id, change_amount, balance_after, biz_type, remark)
         VALUES (?, ?, ?, ?, ?, 'release', ?)`,
        [
          occ.projectId,
          occ.costCategoryId,
          reimbId,
          amount,
          balanceAfter,
          `${remark}：报销单 ${billNo}`,
        ],
      );
      pendingByCategory.set(occ.costCategoryId, pendingRelease + amount);
    }
  });
}

export async function getProjectBudgetSummary(projectId, fiscalYear = new Date().getFullYear()) {
  const rows = await query(
    `SELECT pb.cost_category_id AS costCategoryId, cc.code AS costCategoryCode, cc.name AS costCategoryName,
            pb.budget_amount AS budgetAmount, pb.warn_threshold AS warnThreshold,
            COALESCE(SUM(CASE WHEN bl.change_amount < 0 THEN ABS(bl.change_amount) WHEN bl.change_amount > 0 THEN -bl.change_amount ELSE 0 END), 0) AS usedAmount
     FROM project_budget pb
     JOIN cost_category cc ON cc.id = pb.cost_category_id
     LEFT JOIN budget_ledger bl ON bl.project_id = pb.project_id AND bl.cost_category_id = pb.cost_category_id
     WHERE pb.project_id = :projectId AND pb.fiscal_year = :year AND pb.status = 1
     GROUP BY pb.id, pb.cost_category_id, cc.code, cc.name, pb.budget_amount, pb.warn_threshold
     ORDER BY cc.sort_order, cc.id`,
    { projectId, year: fiscalYear },
  );

  return rows.map((row) => {
    const budgetAmount = Number(row.budgetAmount);
    const usedAmount = Number(row.usedAmount);
    const remaining = budgetAmount - usedAmount;
    const usageRate = budgetAmount > 0 ? usedAmount / budgetAmount : 0;
    return {
      ...row,
      budgetAmount,
      usedAmount,
      remaining,
      usageRate,
      warnThreshold: Number(row.warnThreshold),
      overWarn: usageRate >= Number(row.warnThreshold),
    };
  });
}
