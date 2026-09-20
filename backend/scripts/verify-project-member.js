/**
 * 项目成员：管理员分配后可见；员工不可自助入组
 */
import { closePool, query } from '../src/db/pool.js';
import { listActiveProjects } from '../src/services/meta.js';
import {
  addProjectMember,
  getMembershipSummary,
  joinProjects,
  listMyJoinedProjects,
  listProjectMembers,
  removeProjectMember,
} from '../src/services/projectMember.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function uid(ding) {
  const rows = await query('SELECT id FROM user_account WHERE ding_user_id = :d LIMIT 1', { d: ding });
  assert(rows[0], `missing ${ding}`);
  return rows[0].id;
}

async function pid(code) {
  const rows = await query('SELECT id FROM project WHERE code = :c LIMIT 1', { c: code });
  assert(rows[0], `missing ${code}`);
  return rows[0].id;
}

async function main() {
  const employee = await uid('dev_user');
  const employee2 = await uid('dev_user_2');
  const pmA = await uid('dev_manager');
  const financeC = await uid('dev_finance_c');
  const p1 = await pid('HD-2026-001');
  const p2 = await pid('HD-2026-002');
  const p3 = await pid('HD-2026-003');

  await query('DELETE FROM project_member WHERE user_id = :uid', { uid: employee2 });
  let mem = await getMembershipSummary(employee2);
  assert(mem.needJoin === false && mem.joinedCount === 0, 'no self-join prompt');

  let denied = false;
  try {
    await joinProjects(employee2, [p3], { source: 'self' });
  } catch (e) {
    denied = e.status === 403;
  }
  assert(denied, 'employee cannot self join');
  console.log('[ok] self join blocked');

  await addProjectMember(financeC, p3, employee2);
  mem = await getMembershipSummary(employee2);
  assert(mem.joinedCount === 1, 'after admin assign');
  const mine = await listMyJoinedProjects(employee2);
  assert(mine.some((p) => Number(p.id) === p3), 'joined p3');

  const joinedList = await listActiveProjects(employee2, { mode: 'joined' });
  assert(joinedList.length === 1 && Number(joinedList[0].id) === p3, 'mode=joined');
  console.log('[ok] admin assign + joined list');

  await addProjectMember(financeC, p1, employee2);
  const members = await listProjectMembers(financeC, p1);
  assert(members.some((m) => Number(m.userId) === employee2), 'admin add member');

  denied = false;
  try {
    await listProjectMembers(employee, p2);
  } catch (e) {
    denied = e.status === 403;
  }
  assert(denied, 'employee cannot manage members');
  await listProjectMembers(pmA, p1);
  console.log('[ok] acl');

  await removeProjectMember(financeC, p1, employee2);
  await removeProjectMember(financeC, p3, employee2);
  // 恢复 seed：emp2 → p2
  await addProjectMember(financeC, p2, employee2);
  console.log('[ok] restore');

  console.log('verify-project-member: ALL PASSED');
}

main()
  .catch((err) => {
    console.error('verify-project-member FAILED:', err.message);
    process.exitCode = 1;
  })
  .finally(() => closePool());
