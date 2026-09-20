/**
 * 数据可见范围：员工 / 项目经理 / 财务A·B·C / 总经理A·B·C
 *
 * level:
 *   - own: 仅本人报销
 *   - projects: 指定项目（含本人单据）
 *   - all: 全公司
 */

import { query } from '../db/pool.js';

export const ROLE_CODES = {
  employee: 'employee',
  project_manager: 'project_manager',
  finance: 'finance',
  gm: 'gm',
};

export const ROLE_LABELS = {
  employee: '员工',
  project_manager: '项目经理',
  finance: '财务',
  gm: '公司总经理',
};

export const GRADE_LABELS = { A: 'A档', B: 'B档', C: 'C档' };

/** 审批金额阈值（元）：决定财务/总经理档位 */
export const APPROVAL_AMOUNT_THRESHOLDS = {
  financeAMax: 5000,
  financeBMax: 50000,
  gmAMax: 50000,
  gmBMax: 200000,
};

export async function listUserRoles(userId) {
  return query(
    `SELECT ur.id, ur.role_code AS roleCode, ur.grade, ur.region_id AS regionId,
            ur.project_id AS projectId, ur.status
     FROM user_role ur
     WHERE ur.user_id = :userId AND ur.status = 1
     ORDER BY FIELD(ur.role_code, 'gm', 'finance', 'project_manager', 'employee'), ur.grade`,
    { userId },
  );
}

/**
 * @returns {{
 *   userId: number,
 *   level: 'own'|'projects'|'all',
 *   projectIds: number[],
 *   roles: Array,
 *   primaryRole: string,
 *   primaryGrade: string|null,
 *   scopeLabel: string,
 * }}
 */
export async function resolveDataScope(userId) {
  const roles = await listUserRoles(userId);
  const projectIdSet = new Set();

  let level = 'own';
  let primaryRole = ROLE_CODES.employee;
  let primaryGrade = null;

  const hasGm = roles.some((r) => r.roleCode === ROLE_CODES.gm);
  const financeRoles = roles.filter((r) => r.roleCode === ROLE_CODES.finance);
  const pmRoles = roles.filter((r) => r.roleCode === ROLE_CODES.project_manager);

  if (hasGm) {
    level = 'all';
    primaryRole = ROLE_CODES.gm;
    primaryGrade = roles.find((r) => r.roleCode === ROLE_CODES.gm)?.grade || 'C';
  } else if (financeRoles.some((r) => r.grade === 'C')) {
    level = 'all';
    primaryRole = ROLE_CODES.finance;
    primaryGrade = 'C';
  } else {
    if (financeRoles.some((r) => r.grade === 'B')) {
      primaryRole = ROLE_CODES.finance;
      primaryGrade = 'B';
      level = 'projects';
      for (const fr of financeRoles.filter((r) => r.grade === 'B')) {
        if (fr.regionId) {
          const rows = await query(
            `SELECT id FROM project WHERE region_id = :regionId AND status = 'active'`,
            { regionId: fr.regionId },
          );
          rows.forEach((p) => projectIdSet.add(Number(p.id)));
        }
      }
    }
    if (financeRoles.some((r) => r.grade === 'A' || !r.grade)) {
      if (primaryRole === ROLE_CODES.employee) {
        primaryRole = ROLE_CODES.finance;
        primaryGrade = 'A';
      }
      level = level === 'own' ? 'projects' : level;
      for (const fr of financeRoles.filter((r) => r.grade === 'A' || !r.grade)) {
        if (fr.projectId) projectIdSet.add(Number(fr.projectId));
      }
      const finProjects = await query(
        `SELECT id FROM project WHERE finance_user_id = :userId AND status = 'active'`,
        { userId },
      );
      finProjects.forEach((p) => projectIdSet.add(Number(p.id)));
    }

    if (pmRoles.length) {
      if (primaryRole === ROLE_CODES.employee) {
        primaryRole = ROLE_CODES.project_manager;
        primaryGrade = pmRoles[0].grade || 'A';
      }
      level = level === 'own' ? 'projects' : level;
      for (const pm of pmRoles) {
        if (pm.projectId) projectIdSet.add(Number(pm.projectId));
      }
      const managed = await query(
        `SELECT id FROM project WHERE manager_user_id = :userId AND status = 'active'`,
        { userId },
      );
      managed.forEach((p) => projectIdSet.add(Number(p.id)));
    }
  }

  // 无角色记录时：兼容旧数据——项目经理字段 / 仅员工
  if (!roles.length) {
    const managed = await query(
      `SELECT id FROM project WHERE manager_user_id = :userId AND status = 'active'`,
      { userId },
    );
    if (managed.length) {
      level = 'projects';
      primaryRole = ROLE_CODES.project_manager;
      managed.forEach((p) => projectIdSet.add(Number(p.id)));
    }
  }

  const projectIds = [...projectIdSet];
  const scopeLabel = buildScopeLabel(primaryRole, primaryGrade, level, projectIds.length);

  return {
    userId,
    level,
    projectIds,
    roles,
    primaryRole,
    primaryGrade,
    scopeLabel,
  };
}

function buildScopeLabel(role, grade, level, projectCount) {
  const roleName = ROLE_LABELS[role] || role;
  const gradeName = grade ? GRADE_LABELS[grade] || grade : '';
  if (level === 'all') return `${roleName}${gradeName} · 可见全公司`;
  if (level === 'projects') return `${roleName}${gradeName} · 可见 ${projectCount} 个项目`;
  return `${roleName} · 仅本人单据`;
}

export async function canAccessProject(userId, projectId) {
  const scope = await resolveDataScope(userId);
  if (scope.level === 'all') return true;
  if (scope.level === 'projects') return scope.projectIds.includes(Number(projectId));
  // 员工：可在自己有成员身份或填单时选项目——填单仍允许看全部 active 项目列表中自己可申请的；
  // 看板仅本人相关：若是成员也可看
  const member = await query(
    `SELECT id FROM project_member WHERE project_id = :pid AND user_id = :uid LIMIT 1`,
    { pid: projectId, uid: userId },
  );
  return !!member[0];
}

/**
 * 生成报销列表/汇总 WHERE 片段（含本人单据）
 * @returns {{ sql: string, params: Record<string, unknown> }}
 */
export function buildReimbursementScopeFilter(scope, alias = 'r') {
  const col = (name) => (alias ? `${alias}.${name}` : name);
  const params = { scopeUserId: scope.userId };
  if (scope.level === 'all') {
    return { sql: '1=1', params: {} };
  }
  if (scope.level === 'projects' && scope.projectIds.length) {
    const placeholders = scope.projectIds.map((id, i) => {
      params[`scopePid${i}`] = id;
      return `:scopePid${i}`;
    });
    return {
      sql: `(${col('applicant_user_id')} = :scopeUserId OR ${col('project_id')} IN (${placeholders.join(',')}))`,
      params,
    };
  }
  return {
    sql: `${col('applicant_user_id')} = :scopeUserId`,
    params,
  };
}

export function pickFinanceGradeByAmount(amount) {
  const n = Number(amount) || 0;
  if (n <= APPROVAL_AMOUNT_THRESHOLDS.financeAMax) return 'A';
  if (n <= APPROVAL_AMOUNT_THRESHOLDS.financeBMax) return 'B';
  return 'C';
}

export function pickGmGradeByAmount(amount) {
  const n = Number(amount) || 0;
  if (n <= APPROVAL_AMOUNT_THRESHOLDS.gmAMax) return 'A';
  if (n <= APPROVAL_AMOUNT_THRESHOLDS.gmBMax) return 'B';
  return 'C';
}

/** 解析某档财务审批人 */
export async function resolveFinanceApprover(reimb, grade) {
  if (grade === 'A') {
    if (reimb.financeUserId) return Number(reimb.financeUserId);
    const rows = await query(
      `SELECT user_id AS userId FROM user_role
       WHERE role_code = 'finance' AND grade = 'A' AND project_id = :pid AND status = 1
       LIMIT 1`,
      { pid: reimb.project_id },
    );
    return rows[0]?.userId || null;
  }
  if (grade === 'B') {
    const rows = await query(
      `SELECT ur.user_id AS userId FROM user_role ur
       JOIN project p ON p.region_id = ur.region_id
       WHERE ur.role_code = 'finance' AND ur.grade = 'B' AND ur.status = 1
         AND p.id = :pid
       LIMIT 1`,
      { pid: reimb.project_id },
    );
    return rows[0]?.userId || null;
  }
  const rows = await query(
    `SELECT user_id AS userId FROM user_role
     WHERE role_code = 'finance' AND grade = 'C' AND status = 1 LIMIT 1`,
  );
  return rows[0]?.userId || null;
}

export async function resolveGmApprover(grade) {
  const rows = await query(
    `SELECT user_id AS userId FROM user_role
     WHERE role_code = 'gm' AND grade = :grade AND status = 1 LIMIT 1`,
    { grade },
  );
  if (rows[0]) return rows[0].userId;
  const any = await query(
    `SELECT user_id AS userId FROM user_role WHERE role_code = 'gm' AND status = 1
     ORDER BY FIELD(grade, 'C', 'B', 'A') LIMIT 1`,
  );
  return any[0]?.userId || null;
}

/** 总经理或财务C：可进入角色分配后台 */
export function canManageRoles(scope) {
  return (
    scope.primaryRole === ROLE_CODES.gm ||
    (scope.primaryRole === ROLE_CODES.finance && scope.primaryGrade === 'C')
  );
}

/** 仅总经理可分配/撤销总经理角色 */
export function canManageGmRoles(scope) {
  return scope.primaryRole === ROLE_CODES.gm;
}

export async function getUserAccessProfile(userId) {
  const scope = await resolveDataScope(userId);
  return {
    roles: scope.roles.map((r) => ({
      roleCode: r.roleCode,
      roleLabel: ROLE_LABELS[r.roleCode] || r.roleCode,
      grade: r.grade,
      gradeLabel: r.grade ? GRADE_LABELS[r.grade] : null,
      regionId: r.regionId,
      projectId: r.projectId,
    })),
    primaryRole: scope.primaryRole,
    primaryRoleLabel: ROLE_LABELS[scope.primaryRole],
    primaryGrade: scope.primaryGrade,
    scopeLevel: scope.level,
    scopeLabel: scope.scopeLabel,
    projectIds: scope.projectIds,
    /** 预算总览/项目看板：员工层级不可见 */
    canViewBudgetOverview: scope.primaryRole !== ROLE_CODES.employee,
    canManageRoles: canManageRoles(scope),
    canManageGmRoles: canManageGmRoles(scope),
    amountThresholds: APPROVAL_AMOUNT_THRESHOLDS,
  };
}
