/**
 * 角色分配管理：权限门禁、分配/撤销、项目字段同步
 */
import { closePool, query } from '../src/db/pool.js';
import {
  assignRole,
  assertCanManageRoles,
  getUserRolesDetail,
  listAdminMeta,
  revokeRole,
  searchUsers,
} from '../src/services/roleAdmin.js';
import { getUserAccessProfile, resolveDataScope } from '../src/services/accessScope.js';

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
  const financeA = await uid('dev_finance_a');
  const financeC = await uid('dev_finance_c');
  const gmC = await uid('dev_gm_c');
  const p3 = await pid('HD-2026-003');

  // 门禁：员工 / 财务A 不可管；财务C / 总经理可以
  let denied = false;
  try {
    await assertCanManageRoles(employee);
  } catch (e) {
    denied = e.status === 403;
  }
  assert(denied, 'employee should not manage roles');

  denied = false;
  try {
    await assertCanManageRoles(financeA);
  } catch (e) {
    denied = e.status === 403;
  }
  assert(denied, 'finance A should not manage roles');

  await assertCanManageRoles(financeC);
  await assertCanManageRoles(gmC);
  console.log('[ok] manage gate');

  const profileGm = await getUserAccessProfile(gmC);
  const profileFinC = await getUserAccessProfile(financeC);
  const profileFinA = await getUserAccessProfile(financeA);
  assert(profileGm.canManageRoles && profileGm.canManageGmRoles, 'gm flags');
  assert(profileFinC.canManageRoles && !profileFinC.canManageGmRoles, 'financeC flags');
  assert(!profileFinA.canManageRoles, 'financeA flags');
  console.log('[ok] access flags');

  const meta = await listAdminMeta();
  assert(meta.projects?.length >= 1 && meta.regions?.length >= 1, 'meta lists');
  assert(meta.roleOptions?.some((r) => r.roleCode === 'project_manager'), 'role options');

  const searched = await searchUsers({ q: '开发测试', pageSize: 20 });
  assert(searched.total >= 1 && searched.list.some((u) => u.id === employee2), 'search users');
  console.log('[ok] meta + search');

  // 财务C 不可分配总经理
  denied = false;
  try {
    await assignRole(financeC, employee2, { roleCode: 'gm', grade: 'A' });
  } catch (e) {
    denied = e.status === 403;
  }
  assert(denied, 'financeC cannot assign gm');

  // 总经理给员工2 分配项目经理（项目003）——先清成员工避免残留角色干扰
  await assignRole(gmC, employee2, { roleCode: 'employee' });

  const before = await query('SELECT manager_user_id AS mid FROM project WHERE id = :id', { id: p3 });
  const previousManager = before[0]?.mid || null;

  await assignRole(gmC, employee2, {
    roleCode: 'project_manager',
    grade: 'B',
    projectId: p3,
  });
  const detail = await getUserRolesDetail(employee2);
  assert(
    detail.roles.some((r) => r.roleCode === 'project_manager' && r.projectId === p3 && r.grade === 'B'),
    'pm role assigned',
  );
  const after = await query('SELECT manager_user_id AS mid FROM project WHERE id = :id', { id: p3 });
  assert(after[0].mid === employee2, 'project.manager_user_id synced');

  const scope = await resolveDataScope(employee2);
  assert(scope.projectIds.includes(p3), 'scope includes p3');
  console.log('[ok] assign pm + sync');

  const pmRole = detail.roles.find((r) => r.roleCode === 'project_manager' && r.projectId === p3);
  await revokeRole(gmC, pmRole.id);
  const afterRevoke = await getUserRolesDetail(employee2);
  assert(!afterRevoke.roles.some((r) => r.id === pmRole.id && r.status === 1), 'role revoked');
  const cleared = await query('SELECT manager_user_id AS mid FROM project WHERE id = :id', { id: p3 });
  assert(cleared[0].mid == null, 'manager_user_id cleared');

  // 恢复原项目经理（若 seed 有）
  if (previousManager) {
    await query('UPDATE project SET manager_user_id = :uid WHERE id = :id', {
      uid: previousManager,
      id: p3,
    });
  }
  console.log('[ok] revoke + clear');

  // 设为员工：清角色
  await assignRole(gmC, employee2, {
    roleCode: 'project_manager',
    grade: 'A',
    projectId: p3,
  });
  await assignRole(gmC, employee2, { roleCode: 'employee' });
  const asEmp = await getUserRolesDetail(employee2);
  assert(asEmp.roles.length === 0, 'reset to employee clears roles');
  assert(asEmp.access.primaryRole === 'employee', 'primary employee');
  if (previousManager) {
    await query('UPDATE project SET manager_user_id = :uid WHERE id = :id', {
      uid: previousManager,
      id: p3,
    });
  }
  console.log('[ok] reset employee');

  console.log('verify-role-admin: ALL PASSED');
}

main()
  .catch((err) => {
    console.error('verify-role-admin FAILED:', err.message);
    process.exitCode = 1;
  })
  .finally(() => closePool());
