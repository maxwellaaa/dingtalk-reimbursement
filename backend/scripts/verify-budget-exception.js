/**
 * Smoke: missing-budget exception vs over-budget hard block
 */
import { closePool, query } from '../src/db/pool.js';
import {
  previewBudgetForItems,
  validateBudgetForReimbursement,
} from '../src/services/budget.js';
import { createReimbursement, submitReimbursement } from '../src/services/reimbursement.js';

async function main() {
  const user = await query('SELECT id FROM user_account WHERE ding_user_id = :id LIMIT 1', {
    id: 'dev_user',
  });
  const project = await query('SELECT id FROM project WHERE code = :code LIMIT 1', {
    code: 'HD-2026-001',
  });
  const category = await query('SELECT id, name FROM cost_category WHERE code = :c LIMIT 1', {
    c: 'OTHER',
  });
  if (!user[0] || !project[0] || !category[0]) throw new Error('seed missing');

  const year = new Date().getFullYear();
  const projectId = project[0].id;
  const missingCat = category[0];

  await query(
    `UPDATE project_budget SET status = 0
     WHERE project_id = :p AND cost_category_id = :c AND fiscal_year = :y`,
    { p: projectId, c: missingCat.id, y: year },
  );

  try {
    const preview = await previewBudgetForItems({
      projectId,
      expenseDate: `${year}-07-01`,
      items: [{ costCategoryId: missingCat.id, amount: 50, taxAmount: 0 }],
    });
    if (!preview.missingBudget || !preview.canBypassMissingBudget) {
      throw new Error(`expected canBypassMissingBudget, got ${JSON.stringify(preview)}`);
    }
    console.log('[ok] preview missing budget can bypass', missingCat.name);

    const reimbNo = await createReimbursement(user[0].id, {
      projectId,
      title: '无预算例外测试',
      expenseDate: `${year}-07-01`,
      items: [
        {
          costCategoryId: missingCat.id,
          amount: 50,
          taxAmount: 0,
          invoiceNo: `INV-MISS-${Date.now()}`,
        },
      ],
    });
    let failed = false;
    try {
      await validateBudgetForReimbursement(reimbNo.id);
    } catch (e) {
      failed = /未配置/.test(e.message);
      console.log('[ok] validate without exception blocked:', e.message.slice(0, 80));
    }
    if (!failed) throw new Error('expected validate to block without exception');

    const reimbYes = await createReimbursement(user[0].id, {
      projectId,
      title: '特批无预算测试',
      expenseDate: `${year}-07-01`,
      budgetExceptionType: 'special_approval',
      budgetExceptionRemark: '领导特批测试',
      items: [
        {
          costCategoryId: missingCat.id,
          amount: 50,
          taxAmount: 0,
          invoiceNo: `INV-EXC-${Date.now()}`,
        },
      ],
    });
    const v = await validateBudgetForReimbursement(reimbYes.id);
    if (!v.ok || v.budgetExceptionType !== 'special_approval') {
      throw new Error('exception validate failed');
    }
    console.log('[ok] validate with special_approval');

    const submitted = await submitReimbursement(reimbYes.id, user[0].id, {});
    if (submitted.status !== 'approving') throw new Error('submit failed');
    console.log('[ok] submitted with exception', submitted.billNo, submitted.budgetExceptionLabel);

    const seedling = await query('SELECT id FROM cost_category WHERE code = :c LIMIT 1', {
      c: 'SEEDLING',
    });
    const overPreview = await previewBudgetForItems({
      projectId,
      expenseDate: `${year}-07-01`,
      items: [{ costCategoryId: seedling[0].id, amount: 99999999, taxAmount: 0 }],
    });
    if (!overPreview.overBudget || overPreview.canBypassMissingBudget) {
      throw new Error('over budget should not be bypassable');
    }
    console.log('[ok] over-budget cannot bypass');

    for (const rid of [reimbNo.id, reimbYes.id]) {
      await query('DELETE FROM budget_ledger WHERE reimbursement_id = :id', { id: rid });
      await query(
        `DELETE FROM approval_task WHERE instance_id IN
         (SELECT id FROM approval_instance WHERE reimbursement_id = :id)`,
        { id: rid },
      );
      await query('DELETE FROM approval_instance WHERE reimbursement_id = :id', { id: rid });
      await query('DELETE FROM reimbursement_item WHERE reimbursement_id = :id', { id: rid });
      await query('DELETE FROM reimbursement WHERE id = :id', { id: rid });
    }
    await query('DELETE FROM invoice WHERE invoice_no LIKE :p', { p: 'INV-MISS-%' });
    await query('DELETE FROM invoice WHERE invoice_no LIKE :p', { p: 'INV-EXC-%' });
    console.log('[ok] cleanup');
    console.log('[verify-budget-exception] all passed');
  } finally {
    await query(
      `UPDATE project_budget SET status = 1
       WHERE project_id = :p AND cost_category_id = :c AND fiscal_year = :y`,
      { p: projectId, c: missingCat.id, y: year },
    );
  }
}

main()
  .then(async () => {
    await closePool();
  })
  .catch(async (err) => {
    console.error('[verify-budget-exception] failed:', err.message);
    try {
      await closePool();
    } catch {
      /* ignore */
    }
    process.exit(1);
  });
