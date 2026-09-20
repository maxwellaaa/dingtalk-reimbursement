/**
 * 可见范围隔离：员工 / 项目经理ABC / 财务ABC / 总经理
 */
import { closePool, query } from '../src/db/pool.js';
import { listReimbursements, createReimbursement } from '../src/services/reimbursement.js';
import { resolveDataScope, canAccessProject, pickFinanceGradeByAmount, pickGmGradeByAmount } from '../src/services/accessScope.js';
import { getReimbursementSummary, getProjectDashboard } from '../src/services/meta.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function uid(ding) {
  const rows = await query('SELECT id FROM user_account WHERE ding_user_id = :d LIMIT 1', { d: ding });
  assert(rows[0], `missing user ${ding}, run npm run db:seed`);
  return rows[0].id;
}

async function pid(code) {
  const rows = await query('SELECT id FROM project WHERE code = :c LIMIT 1', { c: code });
  assert(rows[0], `missing project ${code}`);
  return rows[0].id;
}

async function main() {
  const employee = await uid('dev_user');
  const employee2 = await uid('dev_user_2');
  const pmA = await uid('dev_manager');
  const pmB = await uid('dev_pm_b');
  const financeA = await uid('dev_finance_a');
  const financeB = await uid('dev_finance_b');
  const financeC = await uid('dev_finance_c');
  const gmC = await uid('dev_gm_c');

  const p1 = await pid('HD-2026-001');
  const p2 = await pid('HD-2026-002');
  const p3 = await pid('HD-2026-003');

  const cat = await query('SELECT id FROM cost_category WHERE status = 1 LIMIT 1');
  const catId = cat[0].id;
  const today = new Date().toISOString().slice(0, 10);

  // 各建一张单：员工1→项目1，员工2→项目2
  const r1 = await createReimbursement(employee, {
    projectId: p1,
    title: 'SCOPE-EMP1',
    expenseDate: today,
    items: [{ costCategoryId: catId, amount: 11, taxAmount: 0, invoiceNo: `INV-SCOPE1-${Date.now()}` }],
  });
  const r2 = await createReimbursement(employee2, {
    projectId: p2,
    title: 'SCOPE-EMP2',
    expenseDate: today,
    items: [{ costCategoryId: catId, amount: 22, taxAmount: 0, invoiceNo: `INV-SCOPE2-${Date.now()}` }],
  });

  // 角色 scope
  const sEmp = await resolveDataScope(employee);
  assert(sEmp.level === 'own', `employee level=${sEmp.level}`);
  const sPmA = await resolveDataScope(pmA);
  assert(sPmA.level === 'projects' && sPmA.projectIds.includes(p1) && !sPmA.projectIds.includes(p2), 'PM-A scope');
  const sPmB = await resolveDataScope(pmB);
  assert(sPmB.projectIds.includes(p2) && !sPmB.projectIds.includes(p1), 'PM-B scope');
  const sFinA = await resolveDataScope(financeA);
  assert(sFinA.level === 'projects' && sFinA.projectIds.includes(p1) && sFinA.projectIds.includes(p2), 'Finance-A');
  const sFinB = await resolveDataScope(financeB);
  assert(sFinB.level === 'projects' && sFinB.projectIds.includes(p3), 'Finance-B region');
  const sFinC = await resolveDataScope(financeC);
  assert(sFinC.level === 'all', 'Finance-C all');
  const sGm = await resolveDataScope(gmC);
  assert(sGm.level === 'all', 'GM all');
  console.log('[ok] role scopes');

  // 列表隔离
  const listEmp = await listReimbursements(employee);
  assert(listEmp.list.every((x) => x.title !== 'SCOPE-EMP2' || x.id === r1.id), 'employee must not see emp2 bill');
  assert(listEmp.list.some((x) => x.id === r1.id), 'employee sees own');

  const listPmA = await listReimbursements(pmA);
  assert(listPmA.list.some((x) => x.id === r1.id), 'PM-A sees project1');
  assert(!listPmA.list.some((x) => x.id === r2.id), 'PM-A must not see project2');

  const listPmB = await listReimbursements(pmB);
  assert(listPmB.list.some((x) => x.id === r2.id), 'PM-B sees project2');
  assert(!listPmB.list.some((x) => x.id === r1.id), 'PM-B must not see project1');

  const listFinC = await listReimbursements(financeC);
  assert(listFinC.list.some((x) => x.id === r1.id) && listFinC.list.some((x) => x.id === r2.id), 'Finance-C sees all');

  const listGm = await listReimbursements(gmC);
  assert(listGm.list.some((x) => x.id === r1.id) && listGm.list.some((x) => x.id === r2.id), 'GM sees all');
  console.log('[ok] list isolation');

  // 看板
  assert(await canAccessProject(employee, p1), 'emp member p1');
  assert(!(await canAccessProject(employee, p2)), 'emp not p2');
  assert(await canAccessProject(pmA, p1), 'pmA p1');
  assert(!(await canAccessProject(pmA, p2)), 'pmA not p2');
  assert(await canAccessProject(gmC, p3), 'gm all');

  let denied = false;
  try {
    await getProjectDashboard(p2, employee);
  } catch (e) {
    denied = e.status === 403;
  }
  assert(denied, 'employee dashboard p2 should 403');
  await getProjectDashboard(p1, employee);
  console.log('[ok] dashboard ACL');

  // 汇总隔离
  const sumEmp = await getReimbursementSummary({ userId: employee });
  const sumGm = await getReimbursementSummary({ userId: gmC });
  assert(sumGm.totalCount >= sumEmp.totalCount, 'gm count >= emp');
  console.log('[ok] summary scope', { emp: sumEmp.totalCount, gm: sumGm.totalCount });

  // 金额选档
  assert(pickFinanceGradeByAmount(1000) === 'A', 'fin A');
  assert(pickFinanceGradeByAmount(10000) === 'B', 'fin B');
  assert(pickFinanceGradeByAmount(80000) === 'C', 'fin C');
  assert(pickGmGradeByAmount(10000) === 'A', 'gm A');
  assert(pickGmGradeByAmount(100000) === 'B', 'gm B');
  assert(pickGmGradeByAmount(300000) === 'C', 'gm C');
  console.log('[ok] amount grade thresholds');

  console.log('[verify-access-scope] all passed');
}

main()
  .catch((err) => {
    console.error('[verify-access-scope] FAILED:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
    process.exit(process.exitCode || 0);
  });
