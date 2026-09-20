/**
 * 项目成员：自助入组 + GM/财务C/项目经理维护
 */
import { query } from '../db/pool.js';
import {
  ROLE_CODES,
  canManageRoles,
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

export async function countJoinedProjects(userId) {
  const rows = await query(
    `SELECT COUNT(*) AS c FROM project_member pm
     JOIN project p ON p.id = pm.project_id AND p.status = 'active'
     WHERE pm.user_id = :userId`,
    { userId },
  );
  return Number(rows[0]?.c || 0);
}

export async function getMembershipSummary(userId) {
  const joinedCount = await countJoinedProjects(userId);
  // 员工不自助入组：由财务/总经理（或项目经理）分配后才可见项目
  return { needJoin: false, joinedCount };
}

export async function listMyJoinedProjects(userId) {
  return query(
    `SELECT p.id, p.code, p.name, p.contract_no AS contractNo, p.status,
            r.code AS regionCode, r.name AS regionName,
            pm.role AS memberRole, pm.source, pm.joined_at AS joinedAt,
            (p.manager_user_id = :userId) AS isManager,
            (p.finance_user_id = :userId) AS isFinance
     FROM project_member pm
     JOIN project p ON p.id = pm.project_id
     JOIN region r ON r.id = p.region_id
     WHERE pm.user_id = :userId AND p.status = 'active'
     ORDER BY p.code`,
    { userId },
  );
}

export async function canManageProjectMembers(actorUserId, projectId) {
  const scope = await resolveDataScope(actorUserId);
  if (canManageRoles(scope)) return true;

  const project = await query(
    `SELECT id, manager_user_id AS managerUserId FROM project
     WHERE id = :id AND status = 'active' LIMIT 1`,
    { id: projectId },
  );
  if (!project[0]) return false;
  if (Number(project[0].managerUserId) === Number(actorUserId)) return true;

  const pmRole = await query(
    `SELECT id FROM user_role
     WHERE user_id = :uid AND role_code = 'project_manager' AND status = 1
       AND project_id = :pid LIMIT 1`,
    { uid: actorUserId, pid: projectId },
  );
  return !!pmRole[0];
}

async function assertActiveProject(projectId) {
  const rows = await query(
    `SELECT id, manager_user_id AS managerUserId, finance_user_id AS financeUserId
     FROM project WHERE id = :id AND status = 'active' LIMIT 1`,
    { id: projectId },
  );
  if (!rows[0]) throw badRequest('项目不存在或已停用');
  return rows[0];
}

async function resolveMemberRole(userId, project) {
  if (Number(project.managerUserId) === Number(userId)) return 'manager';
  if (Number(project.financeUserId) === Number(userId)) return 'finance';
  return 'member';
}

export async function joinProjects(userId, projectIds, { source = 'self' } = {}) {
  if (source === 'self') {
    throw forbidden('请等待财务或总经理将你加入项目组后再填报');
  }
  const ids = [...new Set((projectIds || []).map(Number).filter(Boolean))];
  if (!ids.length) throw badRequest('请至少选择一个项目');

  const joined = [];
  for (const projectId of ids) {
    const project = await assertActiveProject(projectId);
    const role = await resolveMemberRole(userId, project);
    await query(
      `INSERT INTO project_member (project_id, user_id, role, source, joined_at)
       VALUES (:projectId, :userId, :role, :source, NOW())
       ON DUPLICATE KEY UPDATE role = VALUES(role)`,
      { projectId, userId, role, source },
    );
    joined.push(projectId);
  }
  return {
    joined,
    ...(await getMembershipSummary(userId)),
    list: await listMyJoinedProjects(userId),
  };
}

export async function leaveProject(userId, projectId) {
  const project = await assertActiveProject(projectId);
  if (Number(project.managerUserId) === Number(userId)) {
    throw badRequest('你是该项目经理，请先在角色管理中移交后再退出');
  }
  if (Number(project.financeUserId) === Number(userId)) {
    throw badRequest('你是该项目财务，请先在角色管理中移交后再退出');
  }
  const result = await query(
    `DELETE FROM project_member WHERE project_id = :projectId AND user_id = :userId`,
    { projectId, userId },
  );
  if (!result.affectedRows) throw badRequest('你不在该项目组中');
  return {
    ...(await getMembershipSummary(userId)),
    list: await listMyJoinedProjects(userId),
  };
}

export async function listProjectMembers(actorUserId, projectId) {
  const ok = await canManageProjectMembers(actorUserId, projectId);
  if (!ok) throw forbidden('无权管理该项目成员');
  await assertActiveProject(projectId);

  return query(
    `SELECT pm.id, pm.user_id AS userId, pm.role AS memberRole, pm.source,
            pm.joined_at AS joinedAt, u.name, u.title, u.ding_user_id AS dingUserId, u.mobile
     FROM project_member pm
     JOIN user_account u ON u.id = pm.user_id
     WHERE pm.project_id = :projectId AND u.status = 1
     ORDER BY pm.joined_at DESC, pm.id DESC`,
    { projectId },
  );
}

export async function addProjectMember(actorUserId, projectId, targetUserId) {
  const ok = await canManageProjectMembers(actorUserId, projectId);
  if (!ok) throw forbidden('无权管理该项目成员');
  const project = await assertActiveProject(projectId);
  const uid = Number(targetUserId);
  if (!uid) throw badRequest('缺少 userId');

  const users = await query(
    `SELECT id FROM user_account WHERE id = :id AND status = 1 LIMIT 1`,
    { id: uid },
  );
  if (!users[0]) throw badRequest('用户不存在');

  const role = await resolveMemberRole(uid, project);
  await query(
    `INSERT INTO project_member (project_id, user_id, role, source, joined_at)
     VALUES (:projectId, :userId, :role, 'admin', NOW())
     ON DUPLICATE KEY UPDATE role = VALUES(role), source = 'admin'`,
    { projectId, userId: uid, role },
  );
  return listProjectMembers(actorUserId, projectId);
}

export async function removeProjectMember(actorUserId, projectId, targetUserId) {
  const ok = await canManageProjectMembers(actorUserId, projectId);
  if (!ok) throw forbidden('无权管理该项目成员');
  const project = await assertActiveProject(projectId);
  const uid = Number(targetUserId);
  if (Number(project.managerUserId) === uid) {
    throw badRequest('不可移除项目经理，请先移交项目经理');
  }
  if (Number(project.financeUserId) === uid) {
    throw badRequest('不可移除项目财务，请先移交财务');
  }
  await query(
    `DELETE FROM project_member WHERE project_id = :projectId AND user_id = :userId`,
    { projectId, userId: uid },
  );
  return listProjectMembers(actorUserId, projectId);
}

/** 当前用户可管理成员的项目列表（供管理页） */
export async function listManageableProjects(actorUserId) {
  const scope = await resolveDataScope(actorUserId);
  const vis = attendanceAlignedProjectWhere('p');
  if (canManageRoles(scope)) {
    return query(
      `SELECT p.id, p.code, p.name FROM project p
       WHERE p.status = 'active' AND ${vis.sql}
       ORDER BY p.code`,
      vis.params,
    );
  }
  return query(
    `SELECT DISTINCT p.id, p.code, p.name
     FROM project p
     LEFT JOIN user_role ur
       ON ur.project_id = p.id AND ur.user_id = :uid
      AND ur.role_code = 'project_manager' AND ur.status = 1
     WHERE p.status = 'active' AND ${vis.sql}
       AND (p.manager_user_id = :uid OR ur.id IS NOT NULL)
     ORDER BY p.code`,
    { uid: actorUserId, ...vis.params },
  );
}

/** 管理成员时搜已登录过的用户（不要求 GM） */
export async function searchUsersForMember(actorUserId, projectId, q = '') {
  const ok = await canManageProjectMembers(actorUserId, projectId);
  if (!ok) throw forbidden('无权管理该项目成员');
  const keyword = String(q || '').trim();
  const params = { projectId };
  let where = 'u.status = 1';
  if (keyword) {
    where += ' AND (u.name LIKE :kw OR u.ding_user_id LIKE :kw OR u.mobile LIKE :kw)';
    params.kw = `%${keyword}%`;
  }
  return query(
    `SELECT u.id, u.name, u.title, u.ding_user_id AS dingUserId,
            EXISTS(
              SELECT 1 FROM project_member pm
              WHERE pm.project_id = :projectId AND pm.user_id = u.id
            ) AS alreadyMember
     FROM user_account u
     WHERE ${where}
     ORDER BY u.id DESC
     LIMIT 50`,
    params,
  );
}
