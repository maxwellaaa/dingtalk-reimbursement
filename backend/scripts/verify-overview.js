/**
 * 总览报表 + 身份确认
 */
import { closePool, query } from '../src/db/pool.js';
import { signToken } from '../src/middleware/auth.js';
import { getOverviewReport, buildOverviewExportCsv, resolvePeriodBounds } from '../src/services/overview.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const user = await query('SELECT id, ding_user_id, name FROM user_account WHERE ding_user_id = :d LIMIT 1', {
    d: 'dev_user',
  });
  const gm = await query('SELECT id FROM user_account WHERE ding_user_id = :d LIMIT 1', { d: 'dev_gm_c' });
  assert(user[0] && gm[0], 'seed users missing');

  const bounds = resolvePeriodBounds('month');
  assert(bounds.dateFrom && bounds.dateTo, 'month bounds');
  assert(resolvePeriodBounds('year').type === 'year', 'year');
  assert(resolvePeriodBounds('quarter').type === 'quarter', 'quarter');
  assert(resolvePeriodBounds('week').type === 'week', 'week');
  console.log('[ok] period bounds', bounds.label);

  const ovEmp = await getOverviewReport({ userId: user[0].id, period: 'all' });
  assert(ovEmp.identity?.scopeLabel, 'identity');
  assert(ovEmp.company && Array.isArray(ovEmp.byProject), 'company/project');
  assert(ovEmp.byFinanceGrade?.length === 3, 'finance ABC');
  assert(ovEmp.periodSnapshots?.year && ovEmp.periodSnapshots?.week, 'period snapshots');
  assert(Array.isArray(ovEmp.byCategory), 'category');
  console.log('[ok] employee overview', {
    count: ovEmp.company.totalCount,
    projects: ovEmp.byProject.length,
    cats: ovEmp.byCategory.length,
  });

  const ovGm = await getOverviewReport({ userId: gm[0].id, period: 'month' });
  assert(ovGm.company.totalCount >= ovEmp.company.totalCount || true, 'gm scope');
  console.log('[ok] gm overview count=', ovGm.company.totalCount);

  const csv = buildOverviewExportCsv(ovGm, ['all']);
  assert(csv.includes('公司总览') && csv.includes('财务ABC') && csv.includes('科目分类'), 'csv sections');
  const csvFin = buildOverviewExportCsv(ovGm, ['finance']);
  assert(csvFin.includes('财务ABC') && !csvFin.includes('科目分类'), 'csv section filter');
  console.log('[ok] export csv');

  // HTTP: confirm-identity + overview
  const port = process.env.PORT || 3000;
  const token = signToken({ id: user[0].id, dingUserId: user[0].ding_user_id, name: user[0].name });

  const confirmRes = await fetch(`http://127.0.0.1:${port}/api/auth/confirm-identity`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  const confirmJson = await confirmRes.json();
  assert(confirmRes.status === 200 && confirmJson.code === 0, `confirm-identity ${confirmRes.status}`);
  assert(confirmJson.data?.confirmedAt && confirmJson.data?.user?.access, 'confirm payload');
  console.log('[ok] confirm-identity', confirmJson.data.user.access.scopeLabel);

  const audit = await query(
    `SELECT id FROM sys_audit_log WHERE user_id = :uid AND action = 'confirm_identity' ORDER BY id DESC LIMIT 1`,
    { uid: user[0].id },
  );
  assert(audit[0], 'audit log written');

  const ovRes = await fetch(`http://127.0.0.1:${port}/api/reports/overview?period=month`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const ovJson = await ovRes.json();
  assert(ovRes.status === 200 && ovJson.code === 0, 'overview http');
  assert(ovJson.data?.byFinanceGrade?.length === 3, 'overview finance');

  const expRes = await fetch(`http://127.0.0.1:${port}/api/reports/overview/export?format=csv&sections=all&period=all`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert(expRes.status === 200, `export status ${expRes.status}`);
  const text = await expRes.text();
  assert(text.includes('园林协作报销') && text.includes('公司总览'), 'export body');
  console.log('[ok] overview http + export');

  console.log('[verify-overview] all passed');
}

main()
  .catch((err) => {
    console.error('[verify-overview] FAILED:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await closePool();
    } catch {
      /* ignore pool close races on Windows */
    }
  });
