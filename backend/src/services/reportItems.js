import ExcelJS from 'exceljs';
import { query } from '../db/pool.js';
import { resolveDataScope, buildReimbursementScopeFilter } from './accessScope.js';

const STATUS_LABELS = {
  draft: '草稿',
  approving: '审批中',
  approved: '已通过',
  rejected: '已驳回',
  paid: '已付款',
  cancelled: '已取消',
};

const EXPORT_HEADERS = [
  '单据号', '标题', '状态', '费用日期', '申请时间', '项目编码', '项目名称', '申请人',
  '行号', '费用科目', '金额', '税额', '说明', '发票号码', '发票代码',
];

function escapeCsvCell(value) {
  const s = value == null ? '' : String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function rowToCells(row) {
  return [
    row.billNo,
    row.title,
    STATUS_LABELS[row.status] || row.status,
    row.expenseDate,
    row.createdAt,
    row.projectCode,
    row.projectName,
    row.applicantName,
    row.lineNo,
    row.costCategoryName,
    Number(row.lineAmount || 0).toFixed(2),
    Number(row.taxAmount || 0).toFixed(2),
    row.lineDescription,
    row.invoiceNo,
    row.invoiceCode,
  ];
}

/**
 * 报销明细行导出（按单据明细行展开）
 */
export async function listReimbursementItemRows({
  userId,
  projectId,
  dateFrom,
  dateTo,
  mine = false,
} = {}) {
  const scope = await resolveDataScope(userId);
  const scopeFilter = buildReimbursementScopeFilter(scope, 'r');
  let where = `WHERE ${scopeFilter.sql}`;
  const params = { ...scopeFilter.params };

  if (mine) {
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

  return query(
    `SELECT r.bill_no AS billNo, r.title, r.status, r.expense_date AS expenseDate,
            r.created_at AS createdAt, r.reimburse_amount AS reimburseAmount, r.submit_at AS submitAt,
            p.code AS projectCode, p.name AS projectName,
            ua.name AS applicantName,
            ri.line_no AS lineNo, cc.name AS costCategoryName,
            ri.amount AS lineAmount, ri.tax_amount AS taxAmount, ri.description AS lineDescription,
            i.invoice_no AS invoiceNo, i.invoice_code AS invoiceCode
     FROM reimbursement r
     JOIN project p ON p.id = r.project_id
     JOIN user_account ua ON ua.id = r.applicant_user_id
     JOIN reimbursement_item ri ON ri.reimbursement_id = r.id
     JOIN cost_category cc ON cc.id = ri.cost_category_id
     LEFT JOIN invoice i ON i.id = ri.invoice_id
     ${where}
     ORDER BY r.expense_date DESC, r.bill_no, ri.line_no`,
    params,
  );
}

export function buildItemsExportCsv(rows, { projectId, dateFrom, dateTo } = {}) {
  const lines = rows.map((row) => rowToCells(row).map(escapeCsvCell).join(','));
  const meta = `# 筛选: 项目ID=${projectId || '全部'}, 开始=${dateFrom || '-'}, 结束=${dateTo || '-'}`;
  return `\uFEFF${meta}\r\n${EXPORT_HEADERS.join(',')}\r\n${lines.join('\r\n')}\r\n`;
}

export async function buildItemsExportXlsx(rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('报销明细');
  ws.addRow(EXPORT_HEADERS);
  for (const row of rows) {
    ws.addRow(rowToCells(row));
  }
  ws.getRow(1).font = { bold: true };
  return wb.xlsx.writeBuffer();
}
