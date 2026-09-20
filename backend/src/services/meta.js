import { query } from '../db/pool.js';
import { getProjectBudgetSummary } from './budget.js';
import { canAccessProject, resolveDataScope, buildReimbursementScopeFilter, ROLE_CODES } from './accessScope.js';
import { attendanceAlignedProjectWhere } from './projectAlign.js';

async function listAllActiveProjects() {
  const vis = attendanceAlignedProjectWhere('p');
  return query(
    `SELECT p.id, p.code, p.name, p.contract_no AS contractNo, p.status,
            r.code AS regionCode, r.name AS regionName
     FROM project p
     JOIN region r ON r.id = p.region_id
     WHERE p.status = 'active' AND ${vis.sql}
     ORDER BY p.code`,
    vis.params,
  );
}

/**
 * @param {number} [userId]
 * @param {{ mode?: 'view'|'apply'|'joined'|'all' }} [opts]
 *   - view: 按可见范围（员工=成员项目）
 *   - joined: 仅 project_member 已加入
 *   - all|apply: 全部在办（协助报销 / 兼容旧 apply）
 */
export async function listActiveProjects(userId, { mode = 'view' } = {}) {
  if (mode === 'all' || mode === 'apply' || !userId) {
    return listAllActiveProjects();
  }

  if (mode === 'joined') {
    const vis = attendanceAlignedProjectWhere('p');
    return query(
      `SELECT p.id, p.code, p.name, p.contract_no AS contractNo, p.status,
              r.code AS regionCode, r.name AS regionName
       FROM project p
       JOIN region r ON r.id = p.region_id
       JOIN project_member pm ON pm.project_id = p.id AND pm.user_id = :userId
       WHERE p.status = 'active' AND ${vis.sql}
       ORDER BY p.code`,
      { userId, ...vis.params },
    );
  }

  const scope = await resolveDataScope(userId);
  if (scope.level === 'all') {
    return listAllActiveProjects();
  }
  if (scope.level === 'projects' && scope.projectIds.length) {
    const vis = attendanceAlignedProjectWhere('p');
    const params = Object.fromEntries(scope.projectIds.map((id, i) => [`p${i}`, id]));
    return query(
      `SELECT p.id, p.code, p.name, p.contract_no AS contractNo, p.status,
              r.code AS regionCode, r.name AS regionName
       FROM project p
       JOIN region r ON r.id = p.region_id
       WHERE p.status = 'active' AND p.id IN (${scope.projectIds.map((_, i) => `:p${i}`).join(',')})
         AND ${vis.sql}
       ORDER BY p.code`,
      { ...params, ...vis.params },
    );
  }
  const vis = attendanceAlignedProjectWhere('p');
  return query(
    `SELECT p.id, p.code, p.name, p.contract_no AS contractNo, p.status,
            r.code AS regionCode, r.name AS regionName
     FROM project p
     JOIN region r ON r.id = p.region_id
     JOIN project_member pm ON pm.project_id = p.id AND pm.user_id = :userId
     WHERE p.status = 'active' AND ${vis.sql}
     ORDER BY p.code`,
    { userId, ...vis.params },
  );
}

export async function getProjectById(id) {
  const vis = attendanceAlignedProjectWhere('p');
  const rows = await query(
    `SELECT p.id, p.code, p.name, p.contract_no AS contractNo, p.region_id AS regionId,
            r.name AS regionName
     FROM project p
     JOIN region r ON r.id = p.region_id
     WHERE p.id = :id AND p.status = 'active' AND ${vis.sql} LIMIT 1`,
    { id, ...vis.params },
  );
  return rows[0] || null;
}

export async function listCostCategories() {
  return query(
    `SELECT id, code, name FROM cost_category WHERE status = 1 ORDER BY sort_order, id`,
  );
}

export async function getProjectDashboard(projectId, userId) {
  if (userId) {
    const scope = await resolveDataScope(userId);
    if (scope.primaryRole === ROLE_CODES.employee) {
      const err = new Error('员工无权查看预算总览');
      err.status = 403;
      throw err;
    }
    const ok = await canAccessProject(userId, projectId);
    if (!ok) {
      const err = new Error('无权查看该项目看板');
      err.status = 403;
      throw err;
    }
  }
  const project = await getProjectById(projectId);
  if (!project) return null;

  const fiscalYear = new Date().getFullYear();
  const [budgets, stats] = await Promise.all([
    getProjectBudgetSummary(projectId, fiscalYear),
    query(
      `SELECT status, COUNT(*) AS count, COALESCE(SUM(reimburse_amount), 0) AS amount
       FROM reimbursement WHERE project_id = :projectId GROUP BY status`,
      { projectId },
    ),
  ]);

  const totalBudget = budgets.reduce((sum, b) => sum + b.budgetAmount, 0);
  const totalUsed = budgets.reduce((sum, b) => sum + b.usedAmount, 0);

  return {
    project,
    fiscalYear,
    budgets,
    summary: {
      totalBudget,
      totalUsed,
      totalRemaining: totalBudget - totalUsed,
      usageRate: totalBudget > 0 ? totalUsed / totalBudget : 0,
    },
    reimbursementStats: stats.map((s) => ({
      status: s.status,
      count: Number(s.count),
      amount: Number(s.amount),
    })),
  };
}

const STATUS_LABELS = {
  draft: '草稿',
  pending: '待审批',
  approving: '审批中',
  approved: '已通过',
  rejected: '已驳回',
  paid: '已付款',
  cancelled: '已撤销',
};

function escapeCsvCell(value) {
  const s = String(value ?? '');
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function buildSummaryExportCsv(summary) {
  const lines = [
    '状态,单数,金额',
    ...(summary.byStatus || []).map((row) => {
      const label = STATUS_LABELS[row.status] || row.status;
      return `${escapeCsvCell(label)},${row.count},${Number(row.amount).toFixed(2)}`;
    }),
    '',
    `合计,${summary.totalCount},${Number(summary.totalAmount).toFixed(2)}`,
  ];
  if (summary.projectId || summary.dateFrom || summary.dateTo) {
    lines.unshift(
      `# 筛选: 项目ID=${summary.projectId || '全部'}, 开始=${summary.dateFrom || '-'}, 结束=${summary.dateTo || '-'}`,
    );
  }
  return `\uFEFF${lines.join('\r\n')}`;
}

export async function getReimbursementSummary({
  projectId,
  dateFrom,
  dateTo,
  userId,
  mine = false,
  groupBy,
} = {}) {
  const params = {};
  let where = '1=1';

  if (userId) {
    const scope = await resolveDataScope(userId);
    const scopeFilter = buildReimbursementScopeFilter(scope, 'r');
    where += ` AND (${scopeFilter.sql})`;
    Object.assign(params, scopeFilter.params);
  }

  if (mine && userId) {
    where += ' AND r.applicant_user_id = :mineUserId';
    params.mineUserId = userId;
  }

  if (projectId) {
    where += ' AND r.project_id = :projectId';
    params.projectId = projectId;
  }
  if (dateFrom) {
    where += ' AND r.expense_date >= :dateFrom';
    params.dateFrom = dateFrom;
  }
  if (dateTo) {
    where += ' AND r.expense_date <= :dateTo';
    params.dateTo = dateTo;
  }

  const fromClause = 'FROM reimbursement r';

  const queries = [
    query(
      `SELECT r.status, COUNT(*) AS count, COALESCE(SUM(r.reimburse_amount), 0) AS amount
       ${fromClause} WHERE ${where} GROUP BY r.status ORDER BY r.status`,
      params,
    ),
    query(
      `SELECT COUNT(*) AS totalCount, COALESCE(SUM(r.reimburse_amount), 0) AS totalAmount
       ${fromClause} WHERE ${where}`,
      params,
    ),
  ];

  if (groupBy === 'project') {
    queries.push(
      query(
        `SELECT r.project_id AS projectId, p.code AS projectCode, p.name AS projectName,
                COUNT(*) AS count, COALESCE(SUM(r.reimburse_amount), 0) AS amount
         ${fromClause}
         JOIN project p ON p.id = r.project_id
         WHERE ${where}
         GROUP BY r.project_id, p.code, p.name
         ORDER BY amount DESC`,
        params,
      ),
    );
  } else if (groupBy === 'month') {
    queries.push(
      query(
        `SELECT DATE_FORMAT(r.expense_date, '%Y-%m') AS periodKey,
                COUNT(*) AS count, COALESCE(SUM(r.reimburse_amount), 0) AS amount
         ${fromClause} WHERE ${where}
         GROUP BY DATE_FORMAT(r.expense_date, '%Y-%m')
         ORDER BY periodKey DESC`,
        params,
      ),
    );
  }

  const results = await Promise.all(queries);
  const stats = results[0];
  const totals = results[1];

  const out = {
    projectId: projectId || null,
    dateFrom: dateFrom || null,
    dateTo: dateTo || null,
    mine: !!mine,
    totalCount: Number(totals[0].totalCount),
    totalAmount: Number(totals[0].totalAmount),
    byStatus: stats.map((s) => ({
      status: s.status,
      statusLabel: STATUS_LABELS[s.status] || s.status,
      count: Number(s.count),
      amount: Number(s.amount),
    })),
  };

  if (groupBy === 'project' && results[2]) {
    out.byProject = results[2].map((r) => ({
      projectId: Number(r.projectId),
      projectCode: r.projectCode,
      projectName: r.projectName,
      count: Number(r.count),
      amount: Number(r.amount),
    }));
  }
  if (groupBy === 'month' && results[2]) {
    out.byMonth = results[2].map((r) => ({
      periodKey: r.periodKey,
      count: Number(r.count),
      amount: Number(r.amount),
    }));
  }

  return out;
}
