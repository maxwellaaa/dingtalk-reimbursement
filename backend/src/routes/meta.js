import { Router } from 'express';
import multer from 'multer';
import { config } from '../config.js';
import { authRequired } from '../middleware/auth.js';
import {
  getAttachmentForUser,
  resolveAttachmentPath,
  saveAttachment,
} from '../services/attachment.js';
import { listActiveProjects, listCostCategories, getProjectDashboard, getReimbursementSummary, buildSummaryExportCsv } from '../services/meta.js';
import { listReimbursementItemRows, buildItemsExportCsv, buildItemsExportXlsx } from '../services/reportItems.js';
import { getOverviewReport, buildOverviewExportCsv } from '../services/overview.js';
import { listApiUsage } from '../services/apiUsage.js';
import { checkInvoiceDuplicate, ocrInvoiceFromAttachment } from '../services/invoice.js';
import { previewBudgetForItems } from '../services/budget.js';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.upload.maxSizeMb * 1024 * 1024 },
});

router.get('/projects', authRequired, async (req, res) => {
  try {
    const raw = String(req.query.mode || 'view');
    const mode = ['apply', 'all', 'joined', 'view'].includes(raw) ? raw : 'view';
    const list = await listActiveProjects(req.user.id, { mode });
    res.json({ code: 0, data: { list } });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

router.get('/cost-categories', authRequired, async (_req, res) => {
  try {
    const list = await listCostCategories();
    res.json({ code: 0, data: { list } });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

router.get('/projects/:id/dashboard', authRequired, async (req, res) => {
  try {
    const data = await getProjectDashboard(Number(req.params.id), req.user.id);
    if (!data) {
      return res.status(404).json({ code: 404, message: '项目不存在' });
    }
    res.json({ code: 0, data });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ code: status, message: err.message });
  }
});

router.get('/reports/summary', authRequired, async (req, res) => {
  try {
    const projectId = req.query.projectId ? Number(req.query.projectId) : undefined;
    const dateFrom = req.query.dateFrom || undefined;
    const dateTo = req.query.dateTo || undefined;
    const data = await getReimbursementSummary({
      projectId,
      dateFrom,
      dateTo,
      userId: req.user.id,
      mine: req.query.mine === '1' || req.query.mine === 'true',
      groupBy: req.query.groupBy || undefined,
    });
    res.json({ code: 0, data });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

/** GET /api/reports/items/export — 报销明细行 CSV */
router.get('/reports/items/export', authRequired, async (req, res) => {
  try {
    const format = String(req.query.format || 'csv').toLowerCase();
    if (!['csv', 'xlsx'].includes(format)) {
      return res.status(400).json({ code: 400, message: 'format 须为 csv 或 xlsx' });
    }
    const projectId = req.query.projectId ? Number(req.query.projectId) : undefined;
    const dateFrom = req.query.dateFrom || undefined;
    const dateTo = req.query.dateTo || undefined;
    const mine = req.query.mine === '1' || req.query.mine === 'true';
    const rows = await listReimbursementItemRows({
      userId: req.user.id,
      projectId,
      dateFrom,
      dateTo,
      mine,
    });
    const stamp = new Date().toISOString().slice(0, 10);
    if (format === 'xlsx') {
      const buffer = await buildItemsExportXlsx(rows);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="reimb-items-${stamp}.xlsx"`);
      return res.send(Buffer.from(buffer));
    }
    const csv = buildItemsExportCsv(rows, { projectId, dateFrom, dateTo });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="reimb-items-${stamp}.csv"`);
    res.send(csv);
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

router.get('/reports/summary/export', authRequired, async (req, res) => {
  try {
    const format = String(req.query.format || 'csv').toLowerCase();
    if (format !== 'csv') {
      return res.status(400).json({ code: 400, message: '目前仅支持 format=csv' });
    }
    const projectId = req.query.projectId ? Number(req.query.projectId) : undefined;
    const dateFrom = req.query.dateFrom || undefined;
    const dateTo = req.query.dateTo || undefined;
    const summary = await getReimbursementSummary({
      projectId,
      dateFrom,
      dateTo,
      userId: req.user.id,
    });
    const csv = buildSummaryExportCsv(summary);
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="reimb-summary-${stamp}.csv"`);
    res.send(csv);
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

/** GET /api/reports/overview — 公司/项目/期间/科目/财务ABC 总览 */
router.get('/reports/overview', authRequired, async (req, res) => {
  try {
    const projectId = req.query.projectId ? Number(req.query.projectId) : undefined;
    const period = String(req.query.period || 'month');
    const dateFrom = req.query.dateFrom || undefined;
    const dateTo = req.query.dateTo || undefined;
    const data = await getOverviewReport({
      userId: req.user.id,
      projectId,
      period,
      dateFrom,
      dateTo,
    });
    res.json({ code: 0, data });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

/**
 * GET /api/reports/overview/export?format=csv&sections=all|company,project,period,category,finance,status
 */
router.get('/reports/overview/export', authRequired, async (req, res) => {
  try {
    const format = String(req.query.format || 'csv').toLowerCase();
    if (format !== 'csv') {
      return res.status(400).json({ code: 400, message: '目前仅支持 format=csv' });
    }
    const projectId = req.query.projectId ? Number(req.query.projectId) : undefined;
    const period = String(req.query.period || 'month');
    const dateFrom = req.query.dateFrom || undefined;
    const dateTo = req.query.dateTo || undefined;
    const sections = String(req.query.sections || 'all')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const overview = await getOverviewReport({
      userId: req.user.id,
      projectId,
      period,
      dateFrom,
      dateTo,
    });
    const csv = buildOverviewExportCsv(overview, sections);
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="reimb-overview-${stamp}.csv"`);
    res.send(csv);
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

router.post('/invoices/ocr', authRequired, async (req, res) => {
  try {
    const fileId = Number(req.body?.fileId);
    if (!fileId) {
      return res.status(400).json({ code: 400, message: '缺少 fileId' });
    }
    const data = await ocrInvoiceFromAttachment(fileId, req.user.id);
    res.json({ code: 0, data });
  } catch (err) {
    res.status(400).json({ code: 400, message: err.message });
  }
});

router.get('/invoices/check', authRequired, async (req, res) => {
  try {
    const no = req.query.no || req.query.invoiceNo;
    const code = req.query.code || req.query.invoiceCode || null;
    const excludeReimbId = req.query.excludeReimbId ? Number(req.query.excludeReimbId) : 0;
    const data = await checkInvoiceDuplicate(no, code, excludeReimbId);
    res.json({ code: 0, data });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

router.get('/budget/preview', authRequired, async (req, res) => {
  try {
    const projectId = Number(req.query.projectId);
    const expenseDate = req.query.expenseDate || new Date().toISOString().slice(0, 10);
    let items = [];
    if (req.query.items) {
      items = JSON.parse(req.query.items);
    } else if (req.query.costCategoryId && req.query.amount) {
      items = [{
        costCategoryId: Number(req.query.costCategoryId),
        amount: Number(req.query.amount),
        taxAmount: Number(req.query.taxAmount) || 0,
      }];
    }
    const data = await previewBudgetForItems({ projectId, expenseDate, items });
    res.json({ code: 0, data });
  } catch (err) {
    res.status(400).json({ code: 400, message: err.message });
  }
});

router.get('/api-usage', authRequired, async (req, res) => {
  try {
    const data = await listApiUsage({ month: req.query.month });
    res.json({ code: 0, data });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

router.post('/files', authRequired, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ code: 400, message: '未选择文件' });
    }
    const saved = await saveAttachment(req.file, req.user.id);
    res.json({ code: 0, data: saved });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

router.get('/files/:id', authRequired, async (req, res) => {
  try {
    const att = await getAttachmentForUser(Number(req.params.id), req.user.id);
    if (!att) {
      return res.status(404).json({ code: 404, message: '文件不存在' });
    }
    const fullPath = resolveAttachmentPath(att.filePath);
    res.download(fullPath, att.fileName);
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

export default router;
