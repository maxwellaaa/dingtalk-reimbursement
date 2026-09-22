/**
 * 角色分配管理：用户检索、增删 user_role、同步项目经理/财务字段
 */
import { query } from '../db/pool.js';
import {
  ROLE_CODES,
  ROLE_LABELS,
  GRADE_LABELS,
  canManageRoles,
  canManageGmRoles,
  getUserAccessProfile,
  listUserRoles,
  resolveDataScope,
} from './accessScope.js';
import { attendanceAlignedProjectWhere } from './projectAlign.js';

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function forbidden(message) {
  const err = new Error(message);
  err.status = 403;
  return err;
}

export async function assertCanManageRoles(actorUserId) {
  const scope = await resolveDataScope(actorUserId);
  if (!canManageRoles(scope)) {
    throw forbidden('仅总经理或财务C可分配角色');
  }
  return scope;
}

export async function listAdminMeta() {
  const vis = attendanceAlignedProjectWhere('p');
  const [projects, regions] = await Promise.all([
    query(
      `SELECT p.id, p.code, p.name, p.region_id AS regionId, r.name AS regionName
       FROM project p
       LEFT JOIN region r ON r.id = p.region_id
       WHERE p.status = 'active' AND ${vis.sql}
       ORDER BY p.code`,
      vis.params,
    ),
    query(
      `SELECT id, code, name FROM region WHERE status = 1 ORDER BY sort_order, id`,
    ),
  ]);

  return {
    projects,
    regions,
    roleOptions: [
      { roleCode: ROLE_CODES.employee, label: ROLE_LABELS.employee, needsGrade: false, needsProject: false, needsRegion: false },
      { roleCode: ROLE_CODES.project_manager, label: ROLE_LABELS.project_manager, needsGrade: true, needsProject: true, needsRegion: false },
      { roleCode: ROLE_CODES.finance, label: ROLE_LABELS.finance, needsGrade: true, needsProject: 'A', needsRegion: 'B' },
      { roleCode: ROLE_CODES.gm, label: ROLE_LABELS.gm, needsGrade: true, needsProject: false, needsRegion: false, gmOnly: true },
    ],
    grades: [
      { value: 'A', label: GRADE_LABELS.A },
      { value: 'B', label: GRADE_LABELS.B },
      { value: 'C', label: GRADE_LABELS.C },
    ],
  };
}

export async function searchUsers({ q = '', page = 1, pageSize = 30 } = {}) {
  const limit = Math.min(Math.max(Number(pageSize) || 30, 1), 100);
  const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;
  const keyword = String(q || '').trim();
  const params = { limit, offset };
  let where = 'u.status = 1';
  if (keyword) {
    where += ' AND (u.name LIKE :kw OR u.ding_user_id LIKE :kw OR u.mobile LIKE :kw OR u.title LIKE :kw)';
    params.kw = `%${keyword}%`;
  }

  const [rows, countRows] = await Promise.all([
    query(
      `SELECT u.id, u.ding_user_id AS dingUserId, u.name, u.mobile, u.title,
              u.region_id AS regionId
       FROM user_account u
       WHERE ${where}
       ORDER BY u.id DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params,
    ),
    query(
      `SELECT COUNT(*) AS cnt FROM user_account u WHERE ${where}`,
      params,
    ),
  ]);

  const list = [];
  for (const u of rows) {
    const access = await getUserAccessProfile(u.id);
    list.push({
      ...u,
      primaryRole: access.primaryRole,
      primaryRoleLabel: access.primaryRoleLabel,
      primaryGrade: access.primaryGrade,
      scopeLabel: access.scopeLabel,
      roleCount: access.roles.length,
    });
  }

  return {
    list,
    total: Number(countRows[0]?.cnt || 0),
    page: Math.max(Number(page) || 1, 1),
    pageSize: limit,
  };
}

function roleScopeKey(row) {
  return [
    row.roleCode,
    row.grade || '',
    row.regionId || '',
    row.projectId || '',
  ].join('|');
}

function consolidateRoleRows(roles) {
  const groups = new Map();
  for (const r of roles) {
    const key = roleScopeKey(r);
    if (!groups.has(key)) {
      groups.set(key, {
        ...r,
        roleIds: [r.id],
        duplicateCount: 1,
      });
      continue;
    }
    const g = groups.get(key);
    g.roleIds.push(r.id);
    g.duplicateCount += 1;
  }
  return [...groups.values()].map((g) => ({
    ...g,
    id: g.roleIds[0],
    isDuplicate: g.duplicateCount > 1,
  }));
}

/** 合并 MySQL UNIQUE 对 NULL project_id 允许多行造成的重复角色 */
export async function dedupeUserRoles(userId) {
  const rows = await query(
    `SELECT id, role_code AS roleCode, grade, region_id AS regionId, project_id AS projectId
     FROM user_role
     WHERE user_id = :userId AND status = 1
     ORDER BY id ASC`,
    { userId },
  );

  const keepIds = new Set();
  const deactivateIds = [];
  const buckets = new Map();

  for (const row of rows) {
    const key = roleScopeKey(row);
    if (!buckets.has(key)) {
      buckets.set(key, row.id);
      keepIds.add(row.id);
      continue;
    }
    deactivateIds.push(row.id);
  }

  if (deactivateIds.length) {
    await query(
      `UPDATE user_role SET status = 0 WHERE id IN (${deactivateIds.map((_, i) => `:id${i}`).join(',')})`,
      Object.fromEntries(deactivateIds.map((id, i) => [`id${i}`, id])),
    );
  }

  return { removed: deactivateIds.length, kept: keepIds.size };
}

export async function getUserRolesDetail(userId) {
  const users = await query(
    `SELECT id, ding_user_id AS dingUserId, name, mobile, title
     FROM user_account WHERE id = :id AND status = 1 LIMIT 1`,
    { id: userId },
  );
  if (!users[0]) {
    const err = new Error('用户不存在');
    err.status = 404;
    throw err;
  }

  const roles = await query(
    `SELECT ur.id, ur.role_code AS roleCode, ur.grade,
            ur.region_id AS regionId, ur.project_id AS projectId, ur.status,
            r.name AS regionName, p.code AS projectCode, p.name AS projectName
     FROM user_role ur
     LEFT JOIN region r ON r.id = ur.region_id
     LEFT JOIN project p ON p.id = ur.project_id
     WHERE ur.user_id = :userId AND ur.status = 1
     ORDER BY FIELD(ur.role_code, 'gm', 'finance', 'project_manager', 'employee'), ur.grade, ur.id`,
    { userId },
  );

  const mapped = roles.map((r) => ({
    ...r,
    roleLabel: ROLE_LABELS[r.roleCode] || r.roleCode,
    gradeLabel: r.grade ? GRADE_LABELS[r.grade] : null,
    scopeText: r.projectCode
      ? `${r.projectCode} ${r.projectName || ''}`.trim()
      : (r.regionName || (r.roleCode === 'project_manager' && r.grade === 'C' ? '授权工地关联项目（多项目）' : '—')),
  }));

  const access = await getUserAccessProfile(userId);
  const consolidated = consolidateRoleRows(mapped);
  return {
    user: users[0],
    roles: consolidated,
    rawRoleCount: mapped.length,
    access,
  };
}

function normalizeRoleInput(body) {
  const roleCode = String(body.roleCode || '').trim();
  const grade = body.grade ? String(body.grade).toUpperCase() : null;
  const projectId = body.projectId != null && body.projectId !== '' ? Number(body.projectId) : null;
  const regionId = body.regionId != null && body.regionId !== '' ? Number(body.regionId) : null;

  if (!Object.values(ROLE_CODES).includes(roleCode)) {
    throw badRequest('无效角色');
  }

  if (roleCode === ROLE_CODES.employee) {
    return { roleCode, grade: null, projectId: null, regionId: null };
  }

  if (roleCode === ROLE_CODES.project_manager) {
    if (!['A', 'B', 'C'].includes(grade)) throw badRequest('项目经理需选择档位 A/B/C');
    if (grade === 'A' && !projectId) throw badRequest('项目经理 A 需绑定项目');
    if (grade === 'B' && !projectId) throw badRequest('项目经理 B 需绑定项目');
    return { roleCode, grade, projectId: projectId || null, regionId: null };
  }

  if (roleCode === ROLE_CODES.finance) {
    if (!['A', 'B', 'C'].includes(grade)) throw badRequest('财务需选择档位 A/B/C');
    if (grade === 'A') {
      if (!projectId) throw badRequest('财务A需绑定项目');
      return { roleCode, grade, projectId, regionId: null };
    }
    if (grade === 'B') {
      if (!regionId) throw badRequest('财务B需绑定片区');
      return { roleCode, grade, projectId: null, regionId };
    }
    return { roleCode, grade: 'C', projectId: null, regionId: null };
  }

  if (roleCode === ROLE_CODES.gm) {
    if (!['A', 'B', 'C'].includes(grade)) throw badRequest('总经理需选择档位 A/B/C');
    return { roleCode, grade, projectId: null, regionId: null };
  }

  throw badRequest('无效角色');
}

async function syncProjectFields(userId, roleCode, grade, projectId) {
  if (roleCode === ROLE_CODES.project_manager && projectId) {
    await query(`UPDATE project SET manager_user_id = :userId WHERE id = :projectId`, {
      userId,
      projectId,
    });
    await query(
      `INSERT INTO project_member (project_id, user_id, role, source, joined_at)
       VALUES (:projectId, :userId, 'manager', 'admin', NOW())
       ON DUPLICATE KEY UPDATE role = 'manager', source = 'admin'`,
      { projectId, userId },
    );
  }
  if (roleCode === ROLE_CODES.finance && grade === 'A' && projectId) {
    await query(`UPDATE project SET finance_user_id = :userId WHERE id = :projectId`, {
      userId,
      projectId,
    });
    await query(
      `INSERT INTO project_member (project_id, user_id, role, source, joined_at)
       VALUES (:projectId, :userId, 'finance', 'admin', NOW())
       ON DUPLICATE KEY UPDATE role = 'finance', source = 'admin'`,
      { projectId, userId },
    );
  }
}

async function clearProjectFieldsIfOwned(userId, roleCode, grade, projectId) {
  if (roleCode === ROLE_CODES.project_manager && projectId) {
    await query(
      `UPDATE project SET manager_user_id = NULL
       WHERE id = :projectId AND manager_user_id = :userId`,
      { projectId, userId },
    );
  }
  if (roleCode === ROLE_CODES.finance && grade === 'A' && projectId) {
    await query(
      `UPDATE project SET finance_user_id = NULL
       WHERE id = :projectId AND finance_user_id = :userId`,
      { projectId, userId },
    );
  }
}

async function writeAudit(actorUserId, action, detail) {
  await query(
    `INSERT INTO sys_audit_log (user_id, action, biz_type, biz_id, detail_json)
     VALUES (:userId, :action, 'role_admin', :bizId, :detail)`,
    {
      userId: actorUserId,
      action,
      bizId: detail.targetUserId || null,
      detail: JSON.stringify(detail),
    },
  );
}

export async function assignRole(actorUserId, targetUserId, body) {
  const actorScope = await assertCanManageRoles(actorUserId);
  const normalized = normalizeRoleInput(body || {});

  if (normalized.roleCode === ROLE_CODES.gm && !canManageGmRoles(actorScope)) {
    throw forbidden('仅总经理可分配总经理角色');
  }

  const users = await query(`SELECT id FROM user_account WHERE id = :id AND status = 1 LIMIT 1`, {
    id: targetUserId,
  });
  if (!users[0]) {
    const err = new Error('用户不存在');
    err.status = 404;
    throw err;
  }

  // 「员工」= 清除其它角色，恢复默认可见范围
  if (normalized.roleCode === ROLE_CODES.employee) {
    const active = await query(
      `SELECT id, role_code AS roleCode, grade, project_id AS projectId
       FROM user_role WHERE user_id = :userId AND status = 1`,
      { userId: targetUserId },
    );
    for (const row of active) {
      if (row.roleCode === ROLE_CODES.gm && !canManageGmRoles(actorScope)) {
        throw forbidden('仅总经理可撤销总经理角色，无法降为员工');
      }
      await query(`UPDATE user_role SET status = 0 WHERE id = :id`, { id: row.id });
      await clearProjectFieldsIfOwned(targetUserId, row.roleCode, row.grade, row.projectId);
    }
    await writeAudit(actorUserId, 'reset_employee', { targetUserId });
    return getUserRolesDetail(targetUserId);
  }

  if (normalized.projectId) {
    const projects = await query(`SELECT id FROM project WHERE id = :id LIMIT 1`, {
      id: normalized.projectId,
    });
    if (!projects[0]) throw badRequest('项目不存在');
  }
  if (normalized.regionId) {
    const regions = await query(`SELECT id FROM region WHERE id = :id AND status = 1 LIMIT 1`, {
      id: normalized.regionId,
    });
    if (!regions[0]) throw badRequest('片区不存在');
  }

  await dedupeUserRoles(targetUserId);

  await query(
    `INSERT INTO user_role (user_id, role_code, grade, region_id, project_id, status)
     VALUES (:userId, :roleCode, :grade, :regionId, :projectId, 1)
     ON DUPLICATE KEY UPDATE status = 1, grade = VALUES(grade)`,
    {
      userId: targetUserId,
      roleCode: normalized.roleCode,
      grade: normalized.grade,
      regionId: normalized.regionId,
      projectId: normalized.projectId,
    },
  );

  await dedupeUserRoles(targetUserId);
  await syncProjectFields(targetUserId, normalized.roleCode, normalized.grade, normalized.projectId);
  await writeAudit(actorUserId, 'assign_role', {
    targetUserId,
    ...normalized,
  });

  return getUserRolesDetail(targetUserId);
}

export async function revokeRole(actorUserId, roleRowId) {
  const actorScope = await assertCanManageRoles(actorUserId);
  const rows = await query(
    `SELECT id, user_id AS userId, role_code AS roleCode, grade,
            region_id AS regionId, project_id AS projectId, status
     FROM user_role WHERE id = :id LIMIT 1`,
    { id: roleRowId },
  );
  const row = rows[0];
  if (!row || row.status !== 1) {
    const err = new Error('角色记录不存在');
    err.status = 404;
    throw err;
  }

  if (row.roleCode === ROLE_CODES.gm && !canManageGmRoles(actorScope)) {
    throw forbidden('仅总经理可撤销总经理角色');
  }

  await query(`UPDATE user_role SET status = 0 WHERE id = :id`, { id: roleRowId });
  await clearProjectFieldsIfOwned(row.userId, row.roleCode, row.grade, row.projectId);
  await writeAudit(actorUserId, 'revoke_role', {
    targetUserId: row.userId,
    roleId: row.id,
    roleCode: row.roleCode,
    grade: row.grade,
    regionId: row.regionId,
    projectId: row.projectId,
  });

  return getUserRolesDetail(row.userId);
}

export { listUserRoles };
