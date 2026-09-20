import express from 'express';
import { query, closePool } from '../src/db/pool.js';
import {
  validateBudgetForReimbursement,
  getProjectBudgetSummary,
  releaseBudgetOnReject,
  previewBudgetForItems,
} from '../src/services/budget.js';
import { checkInvoiceDuplicate, validateInvoicesForSubmit, ocrInvoiceFromAttachment } from '../src/services/invoice.js';
import { getProjectDashboard, getReimbursementSummary, buildSummaryExportCsv } from '../src/services/meta.js';
import { createReimbursement, submitReimbursement, cancelReimbursement } from '../src/services/reimbursement.js';
import { actOnTask, listMyPendingTasks } from '../src/services/approval.js';
import { signToken } from '../src/middleware/auth.js';
import metaRoutes from '../src/routes/meta.js';
import { saveAttachment } from '../src/services/attachment.js';

async function main() {
  const user = await query('SELECT id FROM user_account WHERE ding_user_id = :id LIMIT 1', { id: 'dev_user' });
  const manager = await query('SELECT id FROM user_account WHERE ding_user_id = :id LIMIT 1', { id: 'dev_manager' });
  const project = await query('SELECT id FROM project WHERE code = :code LIMIT 1', { code: 'HD-2026-001' });
  const category = await query('SELECT id FROM cost_category LIMIT 1');

  if (!user[0] || !manager[0] || !project[0] || !category[0]) {
    throw new Error('seed data missing, run npm run db:seed');
  }

  const userId = user[0].id;
  const managerId = manager[0].id;
  const projectId = project[0].id;

  const finance = await query('SELECT id FROM user_account WHERE ding_user_id = :id LIMIT 1', { id: 'dev_finance_a' });
  if (!finance[0]) throw new Error('dev_finance_a missing, run npm run db:seed');
  const financeId = finance[0].id;

  const dashboard = await getProjectDashboard(projectId);
  console.log('[ok] dashboard budgets=', dashboard.budgets.length, 'summary=', dashboard.summary.totalBudget);

  const reimb = await createReimbursement(userId, {
    projectId,
    title: 'P3验证报销',
    expenseDate: new Date().toISOString().slice(0, 10),
    items: [{ costCategoryId: category[0].id, amount: 100, taxAmount: 0, invoiceNo: 'INV-P3-TEST-001' }],
  });
  console.log('[ok] created reimb', reimb.billNo);

  await validateBudgetForReimbursement(reimb.id);
  console.log('[ok] budget validation passed');

  const dup = await checkInvoiceDuplicate('INV-P3-TEST-001');
  console.log('[ok] duplicate check (draft):', dup.duplicate);

  const preview = await previewBudgetForItems({
    projectId,
    expenseDate: new Date().toISOString().slice(0, 10),
    items: [{ costCategoryId: category[0].id, amount: 100, taxAmount: 0 }],
  });
  console.log('[ok] budget preview lines=', preview.lines.length, 'strict=', preview.strict);

  const summaryAll = await getReimbursementSummary({ projectId });
  const summaryFiltered = await getReimbursementSummary({
    projectId,
    dateFrom: '2020-01-01',
    dateTo: '2099-12-31',
  });
  console.log('[ok] report summary filter:', summaryAll.totalCount, '>=', summaryFiltered.totalCount);

  const csv = buildSummaryExportCsv(summaryFiltered);
  if (!csv.includes('状态,单数,金额') || !csv.includes('合计')) {
    throw new Error('csv export content invalid');
  }
  console.log('[ok] csv export builder');

  const app = express();
  app.use('/api', metaRoutes);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address();
  const token = signToken({ id: userId, dingUserId: 'dev_user', name: 'P3验证' });
  const exportRes = await fetch(`http://127.0.0.1:${port}/api/reports/summary/export?format=csv&projectId=${projectId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (exportRes.status !== 200) {
    throw new Error(`export endpoint status ${exportRes.status}`);
  }
  const contentType = exportRes.headers.get('content-type') || '';
  if (!contentType.includes('text/csv')) {
    throw new Error(`export content-type invalid: ${contentType}`);
  }
  server.close();
  console.log('[ok] export endpoint smoke test');

  const ocrFile = await saveAttachment(
    {
      originalname: '发票号码123456789012.pdf',
      mimetype: 'application/pdf',
      size: 12,
      buffer: Buffer.from('plain text invoice 123456789012'),
    },
    userId,
  );
  const ocrResult = await ocrInvoiceFromAttachment(ocrFile.id, userId);
  if (ocrResult.invoiceNo !== '123456789012') {
    throw new Error(`ocr filename parse failed: ${ocrResult.invoiceNo}`);
  }
  console.log('[ok] invoice ocr from filename:', ocrResult.source);

  await submitReimbursement(reimb.id, userId, {});
  console.log('[ok] submitted, status=', (await query('SELECT status FROM reimbursement WHERE id = :id', { id: reimb.id }))[0].status);

  await validateInvoicesForSubmit(reimb.id);
  console.log('[ok] invoice validation on submit passed');

  const tasks = await listMyPendingTasks(managerId);
  const task = tasks.find((t) => t.reimbursementId === reimb.id);
  if (!task) throw new Error('manager pending task not found');
  await actOnTask(task.taskId, managerId, 'approve', '测试通过', {});
  console.log('[ok] manager approved');

  const financeTasks = await listMyPendingTasks(financeId);
  const financeTask = financeTasks.find((t) => t.reimbursementId === reimb.id);
  if (!financeTask) throw new Error('finance pending task not found');
  await actOnTask(financeTask.taskId, financeId, 'approve', '财务通过', {});
  console.log('[ok] finance approved');

  const ledger = await query(
    'SELECT COUNT(*) AS c FROM budget_ledger WHERE reimbursement_id = :id AND biz_type = \'occupy\'',
    { id: reimb.id },
  );
  console.log('[ok] budget ledger entries=', ledger[0].c);

  const summary = await getProjectBudgetSummary(projectId);
  const used = summary.find((s) => s.costCategoryId === category[0].id)?.usedAmount;
  console.log('[ok] category used amount includes 100:', used >= 100);

  const usedBeforeRelease = used;
  await releaseBudgetOnReject(reimb.id, '测试释放');
  const summaryAfterRelease = await getProjectBudgetSummary(projectId);
  const usedAfterRelease = summaryAfterRelease.find((s) => s.costCategoryId === category[0].id)?.usedAmount;
  console.log('[ok] budget released:', usedBeforeRelease - usedAfterRelease >= 100);

  const releaseRows = await query(
    'SELECT COUNT(*) AS c FROM budget_ledger WHERE reimbursement_id = :id AND biz_type = \'release\'',
    { id: reimb.id },
  );
  console.log('[ok] release ledger entries=', releaseRows[0].c);

  await releaseBudgetOnReject(reimb.id, '重复释放应跳过');
  const releaseRows2 = await query(
    'SELECT COUNT(*) AS c FROM budget_ledger WHERE reimbursement_id = :id AND biz_type = \'release\'',
    { id: reimb.id },
  );
  console.log('[ok] release idempotent:', releaseRows[0].c === releaseRows2[0].c);

  const reimbReject = await createReimbursement(userId, {
    projectId,
    title: 'P3驳回验证',
    expenseDate: new Date().toISOString().slice(0, 10),
    items: [{ costCategoryId: category[0].id, amount: 50, taxAmount: 0, invoiceNo: 'INV-P3-TEST-002' }],
  });
  await submitReimbursement(reimbReject.id, userId, {});
  const rejectTask = (await listMyPendingTasks(managerId)).find((t) => t.reimbursementId === reimbReject.id);
  if (!rejectTask) throw new Error('reject task not found');
  await actOnTask(rejectTask.taskId, managerId, 'reject', '测试驳回');
  const rejectRelease = await query(
    'SELECT COUNT(*) AS c FROM budget_ledger WHERE reimbursement_id = :id AND biz_type = \'release\'',
    { id: reimbReject.id },
  );
  console.log('[ok] reject without occupy has no release:', rejectRelease[0].c === 0);

  const reimbCancel = await createReimbursement(userId, {
    projectId,
    title: 'P3撤回验证',
    expenseDate: new Date().toISOString().slice(0, 10),
    items: [{ costCategoryId: category[0].id, amount: 30, taxAmount: 0, invoiceNo: 'INV-P3-TEST-003' }],
  });
  await submitReimbursement(reimbCancel.id, userId, {});
  await cancelReimbursement(reimbCancel.id, userId);
  const cancelStatus = (
    await query('SELECT status FROM reimbursement WHERE id = :id', { id: reimbCancel.id })
  )[0].status;
  console.log('[ok] cancel status=', cancelStatus);

  const dup2 = await checkInvoiceDuplicate('INV-P3-TEST-001');
  console.log('[ok] duplicate after approve:', dup2.duplicate, dup2.billNo || '');

  await query('DELETE FROM budget_ledger WHERE reimbursement_id = :id', { id: reimb.id });
  await query('DELETE FROM approval_task WHERE instance_id IN (SELECT id FROM approval_instance WHERE reimbursement_id = :id)', { id: reimb.id });
  await query('DELETE FROM approval_instance WHERE reimbursement_id = :id', { id: reimb.id });
  await query('DELETE FROM reimbursement_item WHERE reimbursement_id = :id', { id: reimb.id });
  await query('DELETE FROM reimbursement WHERE id = :id', { id: reimb.id });

  for (const extraId of [reimbReject.id, reimbCancel.id]) {
    await query('DELETE FROM budget_ledger WHERE reimbursement_id = :id', { id: extraId });
    await query(
      'DELETE FROM approval_task WHERE instance_id IN (SELECT id FROM approval_instance WHERE reimbursement_id = :id)',
      { id: extraId },
    );
    await query('DELETE FROM approval_instance WHERE reimbursement_id = :id', { id: extraId });
    await query('DELETE FROM reimbursement_item WHERE reimbursement_id = :id', { id: extraId });
    await query('DELETE FROM reimbursement WHERE id = :id', { id: extraId });
  }
  await query('DELETE FROM invoice WHERE invoice_no IN (:n1, :n2, :n3)', {
    n1: 'INV-P3-TEST-001',
    n2: 'INV-P3-TEST-002',
    n3: 'INV-P3-TEST-003',
  });
  await query('DELETE FROM file_attachment WHERE id = :id', { id: ocrFile.id });
  console.log('[ok] cleanup done');
}

main()
  .then(async () => {
    console.log('[verify-p3] all passed');
    await closePool();
  })
  .catch(async (err) => {
    console.error('[verify] failed:', err.message);
    try {
      await closePool();
    } catch {
      /* ignore */
    }
    process.exit(1);
  });
