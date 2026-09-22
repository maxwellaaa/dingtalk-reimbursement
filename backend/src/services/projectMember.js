/**
 * 项目成员：自助入组 + GM/财务C/项目经理维护
 * @COUPLED routes/projectMembers.js · admin/reimb-members.js
 */
import ExcelJS from 'exceljs';
import { query } from '../db/pool.js';
import {
  ROLE_CODES,
  canManageRoles,
  resolveDataScope,
} from './accessScope.js';
import { attendanceAlignedProjectWhere } from './projectAlign.js';

const MEMBER_ROLE_LABELS = {
  manager: '项目经理',
  finance: '项目财务',
  member: '普通成员',
};

const MEMBER_SOURCE_LABELS = {
  admin: '后台分配',
  self: '自助加入',
  sync: '考勤同步',
};

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

async function fetchApprovalRolesByUser(projectId) {
  const rows = await query(
    `SELECT user_id AS userId, role_code AS roleCode, grade
     FROM user_role
     WHERE project_id = :projectId AND status = 1`,
    { projectId },
  );
  const map = new Map();
  for (const row of rows) {
    const uid = Number(row.userId);
    if (!map.has(uid)) map.set(uid, []);
    map.get(uid).push({ roleCode: row.roleCode, grade: row.grade });
  }
  return map;
}

function enrichMemberRow(row, project, approvalMap) {
  const userId = Number(row.userId);
  const memberRole = row.memberRole || 'member';
  const approvalRoles = approvalMap.get(userId) || [];
  const isProjectManager = Number(project.managerUserId) === userId;
  const isProjectFinance = Number(project.financeUserId) === userId;
  const isSyncedManager = memberRole === 'manager' && row.source === 'admin';
  return {
    ...row,
    memberRole,
    roleLabel: MEMBER_ROLE_LABELS[memberRole] || memberRole,
    sourceLabel: MEMBER_SOURCE_LABELS[row.source] || row.source || '—',
    approvalRoles,
    approvalSummary: approvalRoles.length
      ? approvalRoles.map((r) => `${r.roleCode}${r.grade ? `·${r.grade}` : ''}`).join(', ')
      : '',
    isProtected: isProjectManager || isProjectFinance,
    isSyncedManager,
    canRemove: !isProjectManager && !isProjectFinance,
  };
}

export async function listProjectMembers(actorUserId, projectId) {
  const ok = await canManageProjectMembers(actorUserId, projectId);
  if (!ok) throw forbidden('无权管理该项目成员');
  const project = await assertActiveProject(projectId);

  const rows = await query(
    `SELECT pm.id, pm.user_id AS userId, pm.role AS memberRole, pm.source,
            pm.joined_at AS joinedAt, u.name, u.title, u.ding_user_id AS dingUserId, u.mobile
     FROM project_member pm
     JOIN user_account u ON u.id = pm.user_id
     WHERE pm.project_id = :projectId AND u.status = 1
     ORDER BY pm.joined_at DESC, pm.id DESC`,
    { projectId },
  );
  const approvalMap = await fetchApprovalRolesByUser(projectId);
  return rows.map((row) => enrichMemberRow(row, project, approvalMap));
}

async function writeMemberAudit(actorUserId, projectId, action, targetUserId, detail = null) {
  try {
    await query(
      `INSERT INTO project_member_audit
       (project_id, actor_user_id, target_user_id, action, detail, created_at)
       VALUES (:projectId, :actorUserId, :targetUserId, :action, :detail, NOW())`,
      {
        projectId,
        actorUserId,
        targetUserId: targetUserId || null,
        action,
        detail: detail ? JSON.stringify(detail) : null,
      },
    );
  } catch (err) {
    if (!/project_member_audit/i.test(err.message)) throw err;
  }
}

export async function listProjectMemberAudit(actorUserId, projectId, limit = 50) {
  const ok = await canManageProjectMembers(actorUserId, projectId);
  if (!ok) throw forbidden('无权管理该项目成员');
  try {
    return query(
      `SELECT a.id, a.action, a.target_user_id AS targetUserId, a.detail, a.created_at AS createdAt,
              u.name AS targetName, actor.name AS actorName
       FROM project_member_audit a
       LEFT JOIN user_account u ON u.id = a.target_user_id
       LEFT JOIN user_account actor ON actor.id = a.actor_user_id
       WHERE a.project_id = :projectId
       ORDER BY a.id DESC
       LIMIT :limit`,
      { projectId, limit: Math.min(Number(limit) || 50, 200) },
    );
  } catch (err) {
    if (/project_member_audit/i.test(err.message)) return [];
    throw err;
  }
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
  await writeMemberAudit(actorUserId, projectId, 'add', uid, { role });
  return listProjectMembers(actorUserId, projectId);
}

export async function removeProjectMember(actorUserId, projectId, targetUserId) {
  const ok = await canManageProjectMembers(actorUserId, projectId);
  if (!ok) throw forbidden('无权管理该项目成员');
  const project = await assertActiveProject(projectId);
  const uid = Number(targetUserId);
  if (Number(project.managerUserId) === uid) {
    throw badRequest('不可移除项目经理，请先在「角色分配」移交后再移除');
  }
  if (Number(project.financeUserId) === uid) {
    throw badRequest('不可移除项目财务，请先在「角色分配」移交后再移除');
  }
  const [existing] = await query(
    `SELECT role, source FROM project_member
     WHERE project_id = :projectId AND user_id = :userId LIMIT 1`,
    { projectId, userId: uid },
  );
  if (existing?.role === 'manager' && existing?.source === 'admin') {
    throw badRequest('该成员为考勤同步的项目经理，请在「经理账号」调整工地授权后再操作');
  }
  const result = await query(
    `DELETE FROM project_member WHERE project_id = :projectId AND user_id = :userId`,
    { projectId, userId: uid },
  );
  if (!result.affectedRows) throw badRequest('成员不存在');
  await writeMemberAudit(actorUserId, projectId, 'remove', uid);
  return listProjectMembers(actorUserId, projectId);
}

export async function batchAddProjectMembers(actorUserId, projectId, userIds = []) {
  const ok = await canManageProjectMembers(actorUserId, projectId);
  if (!ok) throw forbidden('无权管理该项目成员');
  const project = await assertActiveProject(projectId);
  const ids = [...new Set(userIds.map(Number).filter(Boolean))];
  if (!ids.length) throw badRequest('请至少选择一个用户');

  let added = 0;
  for (const uid of ids) {
    const users = await query(
      `SELECT id FROM user_account WHERE id = :id AND status = 1 LIMIT 1`,
      { id: uid },
    );
    if (!users[0]) continue;
    const role = await resolveMemberRole(uid, project);
    await query(
      `INSERT INTO project_member (project_id, user_id, role, source, joined_at)
       VALUES (:projectId, :userId, :role, 'admin', NOW())
       ON DUPLICATE KEY UPDATE role = VALUES(role), source = 'admin'`,
      { projectId, userId: uid, role },
    );
    added += 1;
  }
  await writeMemberAudit(actorUserId, projectId, 'batch_add', null, { userIds: ids, added });
  const list = await listProjectMembers(actorUserId, projectId);
  return { added, list };
}

export async function batchRemoveProjectMembers(actorUserId, projectId, userIds = []) {
  const ok = await canManageProjectMembers(actorUserId, projectId);
  if (!ok) throw forbidden('无权管理该项目成员');
  const project = await assertActiveProject(projectId);
  const ids = [...new Set(userIds.map(Number).filter(Boolean))];
  if (!ids.length) throw badRequest('请至少选择一个成员');

  let removed = 0;
  const blocked = [];
  for (const uid of ids) {
    if (Number(project.managerUserId) === uid || Number(project.financeUserId) === uid) {
      blocked.push({ userId: uid, reason: '项目经理/财务不可批量移除' });
      continue;
    }
    const [existing] = await query(
      `SELECT role, source FROM project_member
       WHERE project_id = :projectId AND user_id = :userId LIMIT 1`,
      { projectId, userId: uid },
    );
    if (existing?.role === 'manager' && existing?.source === 'admin') {
      blocked.push({ userId: uid, reason: '考勤同步项目经理' });
      continue;
    }
    const result = await query(
      `DELETE FROM project_member WHERE project_id = :projectId AND user_id = :userId`,
      { projectId, userId: uid },
    );
    if (result.affectedRows) removed += 1;
  }
  await writeMemberAudit(actorUserId, projectId, 'batch_remove', null, { userIds: ids, removed, blocked });
  const list = await listProjectMembers(actorUserId, projectId);
  return { removed, blocked, list };
}

export async function copyProjectMembers(actorUserId, sourceProjectId, targetProjectId) {
  const src = Number(sourceProjectId);
  const tgt = Number(targetProjectId);
  if (!src || !tgt || src === tgt) throw badRequest('源项目与目标项目无效');

  const okSrc = await canManageProjectMembers(actorUserId, src);
  const okTgt = await canManageProjectMembers(actorUserId, tgt);
  if (!okSrc || !okTgt) throw forbidden('无权管理源或目标项目');

  const targetProject = await assertActiveProject(tgt);
  const members = await query(
    `SELECT user_id AS userId, role FROM project_member WHERE project_id = :projectId`,
    { projectId: src },
  );

  let copied = 0;
  let skipped = 0;
  for (const m of members) {
    const uid = Number(m.userId);
    if (Number(targetProject.managerUserId) === uid || Number(targetProject.financeUserId) === uid) {
      skipped += 1;
      continue;
    }
    const role = await resolveMemberRole(uid, targetProject);
    const result = await query(
      `INSERT INTO project_member (project_id, user_id, role, source, joined_at)
       VALUES (:projectId, :userId, :role, 'admin', NOW())
       ON DUPLICATE KEY UPDATE role = VALUES(role)`,
      { projectId: tgt, userId: uid, role },
    );
    if (result.affectedRows) copied += 1;
    else skipped += 1;
  }
  await writeMemberAudit(actorUserId, tgt, 'copy_from', null, { sourceProjectId: src, copied, skipped });
  const list = await listProjectMembers(actorUserId, tgt);
  return { copied, skipped, list };
}

export async function exportProjectMembersWorkbook(actorUserId, projectId) {
  const ok = await canManageProjectMembers(actorUserId, projectId);
  if (!ok) throw forbidden('无权管理该项目成员');
  await assertActiveProject(projectId);
  const list = await listProjectMembers(actorUserId, projectId);
  const meta = await query(
    `SELECT code, name FROM project WHERE id = :id LIMIT 1`,
    { id: projectId },
  );

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('项目成员');
  ws.columns = [
    { header: '姓名', key: 'name', width: 14 },
    { header: '手机', key: 'mobile', width: 14 },
    { header: '成员角色', key: 'roleLabel', width: 12 },
    { header: '审批角色', key: 'approvalSummary', width: 20 },
    { header: '来源', key: 'sourceLabel', width: 12 },
    { header: '加入时间', key: 'joinedAt', width: 18 },
  ];
  for (const row of list) {
    ws.addRow({
      name: row.name,
      mobile: row.mobile || '',
      roleLabel: row.roleLabel,
      approvalSummary: row.approvalSummary,
      sourceLabel: row.sourceLabel,
      joinedAt: row.joinedAt,
    });
  }
  ws.getRow(1).font = { bold: true };
  const buffer = await wb.xlsx.writeBuffer();
  const code = meta[0]?.code || `P${projectId}`;
  return { buffer, filename: `项目成员-${code}.xlsx` };
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
  const rows = await query(
    `SELECT u.id, u.name, u.title, u.ding_user_id AS dingUserId, u.mobile,
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
  return rows.filter((u) => !u.alreadyMember);
}
