/**
 * 按项目自动审批路径：提交/同意均无需选人
 */
import { closePool, query } from '../src/db/pool.js';
import { createReimbursement, submitReimbursement } from '../src/services/reimbursement.js';
import { actOnTask, listMyPendingTasks } from '../src/services/approval.js';
import { getProjectApproverPath } from '../src/services/approverCandidates.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function uid(ding) {
  const rows = await query('SELECT id FROM user_account WHERE ding_user_id = :d LIMIT 1', { d: ding });
  assert(rows[0], `missing ${ding}, run npm run db:seed`);
  return rows[0].id;
}

async function pid(code) {
  const rows = await query('SELECT id FROM project WHERE code = :c LIMIT 1', { c: code });
  assert(rows[0], `missing project ${code}`);
  return rows[0].id;
}

async function main() {
  const employee = await uid('dev_user');
  const pmA = await uid('dev_manager');
  const financeA = await uid('dev_finance_a');
  const p1 = await pid('HD-2026-001');
  const cat = await query('SELECT id FROM cost_category WHERE status = 1 LIMIT 1');
  const catId = cat[0].id;
  const today = new Date().toISOString().slice(0, 10);

  const small = await createReimbursement(employee, {
    projectId: p1,
    title: 'PICK-SMALL',
    expenseDate: today,
    items: [{ costCategoryId: catId, amount: 800, taxAmount: 0, invoiceNo: `INV-PICK-S-${Date.now()}` }],
  });
  const pathInfo = await getProjectApproverPath(employee, small.id);
  assert(pathInfo.canSubmit, 'path canSubmit');
  assert(Number(pathInfo.pm.userId) === pmA, 'path pm');
  assert(Number(pathInfo.finance.userId) === financeA, 'path finance');
  assert(pathInfo.pm.grade == null && pathInfo.pm.gradeLabel == null, 'no grade on path');

  await submitReimbursement(small.id, employee, {});
  const tasksSmall = await query(
    `SELECT t.assignee_user_id AS uid
     FROM approval_task t
     JOIN approval_instance ai ON ai.id = t.instance_id
     WHERE ai.reimbursement_id = :id ORDER BY t.node_order`,
    { id: small.id },
  );
  assert(tasksSmall.length === 2, `small 2 tasks got ${tasksSmall.length}`);
  assert(Number(tasksSmall[0].uid) === pmA, 'auto pm');
  assert(Number(tasksSmall[1].uid) === financeA, 'auto finance');
  console.log('[ok] submit without picks');

  const mgrTask = (await listMyPendingTasks(pmA)).find((t) => t.reimbursementId === small.id);
  assert(mgrTask, 'pm pending');
  await actOnTask(mgrTask.taskId, pmA, 'approve', '同意', {});
  const finTask = (await listMyPendingTasks(financeA)).find((t) => t.reimbursementId === small.id);
  assert(finTask, 'finance pending');
  await actOnTask(finTask.taskId, financeA, 'approve', '财务通过', {});
  const st = await query('SELECT status FROM reimbursement WHERE id = :id', { id: small.id });
  assert(st[0].status === 'approved', 'small approved');
  console.log('[ok] approve without next pick');

  const large = await createReimbursement(employee, {
    projectId: p1,
    title: 'PICK-LARGE',
    expenseDate: today,
    items: [{ costCategoryId: catId, amount: 12000, taxAmount: 0, invoiceNo: `INV-PICK-L-${Date.now()}` }],
  });
  await submitReimbursement(large.id, employee, {});
  const tPm = (await listMyPendingTasks(pmA)).find((t) => t.reimbursementId === large.id);
  await actOnTask(tPm.taskId, pmA, 'approve', '同意', {});
  const tFin = (await listMyPendingTasks(financeA)).find((t) => t.reimbursementId === large.id);
  await actOnTask(tFin.taskId, financeA, 'approve', '交总经理', {});
  const gmPending = await query(
    `SELECT t.assignee_user_id AS uid, t.status FROM approval_task t
     JOIN approval_instance ai ON ai.id = t.instance_id
     WHERE ai.reimbursement_id = :id AND t.status = 'pending'`,
    { id: large.id },
  );
  assert(gmPending[0]?.status === 'pending', 'gm pending');
  const gmUid = Number(gmPending[0].uid);
  const tGm = (await listMyPendingTasks(gmUid)).find((t) => t.reimbursementId === large.id);
  assert(tGm, 'gm task');
  await actOnTask(tGm.taskId, gmUid, 'approve', '总经理通过', {});
  const stL = await query('SELECT status FROM reimbursement WHERE id = :id', { id: large.id });
  assert(stL[0].status === 'approved', 'large approved');
  console.log('[ok] large auto gm');

  for (const rid of [small.id, large.id]) {
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

  console.log('verify-approver-pick: ALL PASSED');
}

main()
  .catch((err) => {
    console.error('verify-approver-pick FAILED:', err.message);
    process.exitCode = 1;
  })
  .finally(() => closePool());
