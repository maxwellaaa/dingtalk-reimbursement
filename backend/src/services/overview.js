/**
 * 总览 / 分类报表 / 期间聚合
 */
import { query } from '../db/pool.js';
import {
  APPROVAL_AMOUNT_THRESHOLDS,
  buildReimbursementScopeFilter,
  getUserAccessProfile,
  resolveDataScope,
} from './accessScope.js';

const STATUS_LABELS = {
  draft: '草稿',
  pending: '待审批',
  approving: '审批中',
  approved: '已通过',
  rejected: '已驳回',
  paid: '已付款',
  cancelled: '已撤销',
};

function pad(n) {
  return String(n).padStart(2, '0');
}

function ymd(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * @param {'year'|'quarter'|'month'|'week'|'all'|'custom'} period
 * @param {{ dateFrom?: string, dateTo?: string }} custom
 */
export function resolvePeriodBounds(period = 'month', custom = {}, now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (period === 'custom') {
    return {
      type: 'custom',
      dateFrom: custom.dateFrom || null,
      dateTo: custom.dateTo || null,
      label: `${custom.dateFrom || '…'} ~ ${custom.dateTo || '…'}`,
      seriesBucket: 'day',
    };
  }
  if (period === 'all') {
    return {
      type: 'all',
      dateFrom: null,
      dateTo: null,
      label: '全部时间',
      seriesBucket: 'month',
    };
  }
  if (period === 'year') {
    return {
      type: 'year',
      dateFrom: `${d.getFullYear()}-01-01`,
      dateTo: `${d.getFullYear()}-12-31`,
      label: `${d.getFullYear()}年`,
      seriesBucket: 'month',
    };
  }
  if (period === 'quarter') {
    const q = Math.floor(d.getMonth() / 3);
    const start = new Date(d.getFullYear(), q * 3, 1);
    const end = new Date(d.getFullYear(), q * 3 + 3, 0);
    return {
      type: 'quarter',
      dateFrom: ymd(start),
      dateTo: ymd(end),
      label: `${d.getFullYear()}年Q${q + 1}`,
      seriesBucket: 'month',
    };
  }
  if (period === 'week') {
    const day = d.getDay() || 7;
    const start = new Date(d);
    start.setDate(d.getDate() - day + 1);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return {
      type: 'week',
      dateFrom: ymd(start),
      dateTo: ymd(end),
      label: `${ymd(start)} ~ ${ymd(end)}`,
      seriesBucket: 'day',
    };
  }
  // month default
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return {
    type: 'month',
    dateFrom: ymd(start),
    dateTo: ymd(end),
    label: `${d.getFullYear()}-${pad(d.getMonth() + 1)}`,
    seriesBucket: 'week',
  };
}

async function buildScopedWhere(userId, { projectId, dateFrom, dateTo } = {}) {
  const params = {};
  let where = '1=1';
  if (userId) {
    const scope = await resolveDataScope(userId);
    const scopeFilter = buildReimbursementScopeFilter(scope, 'r');
    where += ` AND (${scopeFilter.sql})`;
    Object.assign(params, scopeFilter.params);
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
  return { where, params };
}

async function aggregateTotals(where, params) {
  const [stats, totals] = await Promise.all([
    query(
      `SELECT r.status, COUNT(*) AS count, COALESCE(SUM(r.reimburse_amount), 0) AS amount
       FROM reimbursement r WHERE ${where} GROUP BY r.status ORDER BY r.status`,
      params,
    ),
    query(
      `SELECT COUNT(*) AS totalCount, COALESCE(SUM(r.reimburse_amount), 0) AS totalAmount,
              COUNT(DISTINCT r.project_id) AS projectCount
       FROM reimbursement r WHERE ${where}`,
      params,
    ),
  ]);
  return {
    totalCount: Number(totals[0].totalCount),
    totalAmount: Number(totals[0].totalAmount),
    projectCount: Number(totals[0].projectCount),
    byStatus: stats.map((s) => ({
      status: s.status,
      statusLabel: STATUS_LABELS[s.status] || s.status,
      count: Number(s.count),
      amount: Number(s.amount),
    })),
  };
}

async function aggregateByProject(where, params) {
  const rows = await query(
    `SELECT p.id AS projectId, p.code AS projectCode, p.name AS projectName,
            COUNT(*) AS count, COALESCE(SUM(r.reimburse_amount), 0) AS amount
     FROM reimbursement r
     JOIN project p ON p.id = r.project_id
     WHERE ${where}
     GROUP BY p.id, p.code, p.name
     ORDER BY amount DESC`,
    params,
  );
  return rows.map((r) => ({
    projectId: Number(r.projectId),
    projectCode: r.projectCode,
    projectName: r.projectName,
    count: Number(r.count),
    amount: Number(r.amount),
  }));
}

async function aggregateByCategory(where, params) {
  const rows = await query(
    `SELECT cc.id AS categoryId, cc.code AS categoryCode, cc.name AS categoryName,
            COUNT(DISTINCT r.id) AS billCount,
            COALESCE(SUM(ri.amount), 0) AS amount
     FROM reimbursement r
     JOIN reimbursement_item ri ON ri.reimbursement_id = r.id
     JOIN cost_category cc ON cc.id = ri.cost_category_id
     WHERE ${where}
     GROUP BY cc.id, cc.code, cc.name
     ORDER BY amount DESC`,
    params,
  );
  return rows.map((r) => ({
    categoryId: Number(r.categoryId),
    categoryCode: r.categoryCode,
    categoryName: r.categoryName,
    billCount: Number(r.billCount),
    amount: Number(r.amount),
  }));
}

function financeGradeSql() {
  const a = APPROVAL_AMOUNT_THRESHOLDS.financeAMax;
  const b = APPROVAL_AMOUNT_THRESHOLDS.financeBMax;
  return `CASE
    WHEN r.reimburse_amount <= ${a} THEN 'A'
    WHEN r.reimburse_amount <= ${b} THEN 'B'
    ELSE 'C'
  END`;
}

async function aggregateByFinanceGrade(where, params) {
  const gradeExpr = financeGradeSql();
  const rows = await query(
    `SELECT grade, COUNT(*) AS count, COALESCE(SUM(amount), 0) AS amount FROM (
       SELECT ${gradeExpr} AS grade, r.reimburse_amount AS amount
       FROM reimbursement r
       WHERE ${where}
     ) t
     GROUP BY grade`,
    params,
  );
  const labels = {
    A: `财务A档（≤${APPROVAL_AMOUNT_THRESHOLDS.financeAMax}）`,
    B: `财务B档（≤${APPROVAL_AMOUNT_THRESHOLDS.financeBMax}）`,
    C: `财务C档（>${APPROVAL_AMOUNT_THRESHOLDS.financeBMax}）`,
  };
  const map = Object.fromEntries(rows.map((r) => [r.grade, r]));
  return ['A', 'B', 'C'].map((grade) => ({
    grade,
    gradeLabel: labels[grade],
    count: Number(map[grade]?.count || 0),
    amount: Number(map[grade]?.amount || 0),
  }));
}

function seriesExpr(bucket) {
  if (bucket === 'day') return `DATE_FORMAT(r.expense_date, '%Y-%m-%d')`;
  if (bucket === 'week') return `DATE_FORMAT(r.expense_date, '%x-W%v')`;
  if (bucket === 'quarter') return `CONCAT(YEAR(r.expense_date), '-Q', QUARTER(r.expense_date))`;
  if (bucket === 'year') return `CAST(YEAR(r.expense_date) AS CHAR)`;
  return `DATE_FORMAT(r.expense_date, '%Y-%m')`;
}

async function aggregateSeries(where, params, bucket) {
  const expr = seriesExpr(bucket);
  const rows = await query(
    `SELECT ${expr} AS bucketKey,
            COUNT(*) AS count, COALESCE(SUM(r.reimburse_amount), 0) AS amount
     FROM reimbursement r
     WHERE ${where}
     GROUP BY ${expr}
     ORDER BY ${expr}`,
    params,
  );
  return rows.map((r) => ({
    key: r.bucketKey,
    count: Number(r.count),
    amount: Number(r.amount),
  }));
}

async function periodSnapshot(userId, projectId, periodType) {
  const bounds = resolvePeriodBounds(periodType);
  const { where, params } = await buildScopedWhere(userId, {
    projectId,
    dateFrom: bounds.dateFrom,
    dateTo: bounds.dateTo,
  });
  const totals = await aggregateTotals(where, params);
  return {
    type: bounds.type,
    label: bounds.label,
    dateFrom: bounds.dateFrom,
    dateTo: bounds.dateTo,
    ...totals,
  };
}

/**
 * 一键总览：公司 / 项目 / 期间 / 科目 / 财务ABC
 */
export async function getOverviewReport({
  userId,
  projectId,
  period = 'month',
  dateFrom,
  dateTo,
} = {}) {
  const identity = await getUserAccessProfile(userId);
  const bounds =
    period === 'custom'
      ? resolvePeriodBounds('custom', { dateFrom, dateTo })
      : resolvePeriodBounds(period);

  const { where, params } = await buildScopedWhere(userId, {
    projectId: projectId || undefined,
    dateFrom: bounds.dateFrom || undefined,
    dateTo: bounds.dateTo || undefined,
  });

  const [company, byProject, byCategory, byFinanceGrade, series, yearSnap, quarterSnap, monthSnap, weekSnap] =
    await Promise.all([
      aggregateTotals(where, params),
      aggregateByProject(where, params),
      aggregateByCategory(where, params),
      aggregateByFinanceGrade(where, params),
      aggregateSeries(where, params, bounds.seriesBucket),
      periodSnapshot(userId, projectId || undefined, 'year'),
      periodSnapshot(userId, projectId || undefined, 'quarter'),
      periodSnapshot(userId, projectId || undefined, 'month'),
      periodSnapshot(userId, projectId || undefined, 'week'),
    ]);

  return {
    identity: {
      primaryRole: identity.primaryRole,
      primaryRoleLabel: identity.primaryRoleLabel,
      primaryGrade: identity.primaryGrade,
      scopeLevel: identity.scopeLevel,
      scopeLabel: identity.scopeLabel,
      projectIds: identity.projectIds,
      amountThresholds: identity.amountThresholds,
    },
    period: {
      type: bounds.type,
      label: bounds.label,
      dateFrom: bounds.dateFrom,
      dateTo: bounds.dateTo,
      seriesBucket: bounds.seriesBucket,
      projectId: projectId || null,
    },
    company,
    byProject,
    byCategory,
    byFinanceGrade,
    byStatus: company.byStatus,
    series,
    periodSnapshots: {
      year: yearSnap,
      quarter: quarterSnap,
      month: monthSnap,
      week: weekSnap,
    },
  };
}

function escapeCsvCell(value) {
  const s = String(value ?? '');
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function sectionLines(title, headers, rows) {
  const lines = [`# ${title}`, headers.join(',')];
  for (const row of rows) {
    lines.push(row.map(escapeCsvCell).join(','));
  }
  lines.push('');
  return lines;
}

/**
 * @param {object} overview
 * @param {string[]} [sections] company|project|period|category|finance|status|all
 */
export function buildOverviewExportCsv(overview, sections = ['all']) {
  const want = new Set(sections.includes('all') ? ['company', 'project', 'period', 'category', 'finance', 'status'] : sections);
  const lines = [
    `# 园林协作报销 · 总览报表`,
    `# 身份: ${overview.identity?.scopeLabel || '-'}`,
    `# 期间: ${overview.period?.label || '-'} (${overview.period?.dateFrom || '-'} ~ ${overview.period?.dateTo || '-'})`,
    `# 导出时间: ${new Date().toISOString()}`,
    '',
  ];

  if (want.has('company')) {
    lines.push(
      ...sectionLines(
        '公司总览',
        ['指标', '值'],
        [
          ['单数', overview.company?.totalCount ?? 0],
          ['金额', Number(overview.company?.totalAmount || 0).toFixed(2)],
          ['涉及项目数', overview.company?.projectCount ?? 0],
        ],
      ),
    );
  }

  if (want.has('status')) {
    lines.push(
      ...sectionLines(
        '按状态',
        ['状态', '单数', '金额'],
        (overview.byStatus || []).map((r) => [r.statusLabel || r.status, r.count, Number(r.amount).toFixed(2)]),
      ),
    );
  }

  if (want.has('project')) {
    lines.push(
      ...sectionLines(
        '项目总览',
        ['项目编码', '项目名称', '单数', '金额'],
        (overview.byProject || []).map((r) => [r.projectCode, r.projectName, r.count, Number(r.amount).toFixed(2)]),
      ),
    );
  }

  if (want.has('period')) {
    lines.push(
      ...sectionLines(
        '期间快照（年/季/月/周）',
        ['期间', '标签', '起', '止', '单数', '金额'],
        ['year', 'quarter', 'month', 'week'].map((k) => {
          const s = overview.periodSnapshots?.[k] || {};
          return [k, s.label, s.dateFrom, s.dateTo, s.totalCount ?? 0, Number(s.totalAmount || 0).toFixed(2)];
        }),
      ),
    );
    lines.push(
      ...sectionLines(
        `期间序列（${overview.period?.seriesBucket || 'month'}）`,
        ['桶', '单数', '金额'],
        (overview.series || []).map((r) => [r.key, r.count, Number(r.amount).toFixed(2)]),
      ),
    );
  }

  if (want.has('category')) {
    lines.push(
      ...sectionLines(
        '科目分类',
        ['科目编码', '科目名称', '单据数', '金额'],
        (overview.byCategory || []).map((r) => [
          r.categoryCode,
          r.categoryName,
          r.billCount,
          Number(r.amount).toFixed(2),
        ]),
      ),
    );
  }

  if (want.has('finance')) {
    lines.push(
      ...sectionLines(
        '财务ABC（按金额档）',
        ['档位', '说明', '单数', '金额'],
        (overview.byFinanceGrade || []).map((r) => [
          r.grade,
          r.gradeLabel,
          r.count,
          Number(r.amount).toFixed(2),
        ]),
      ),
    );
  }

  return `\uFEFF${lines.join('\r\n')}`;
}

export { STATUS_LABELS };
