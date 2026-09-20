/**
 * 审批人：按项目绑定的经理/财务；总经理按金额自动解析（不暴露档位）
 */
import { query } from '../db/pool.js';
import { pickGmGradeByAmount, resolveGmApprover } from './accessScope.js';

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

/** 根据流程节点判断审批角色 */
export function classifyNodeRole(node) {
  if (!node) return null;
  if (node.approver_type === 'project_role' && node.approver_value === 'manager') return 'pm';
  if (node.approver_type === 'project_role' && node.approver_value === 'finance') return 'finance';
  if (node.approver_type === 'role') {
    const role = String(node.approver_value || '').split(':')[0];
    if (role === 'finance') return 'finance';
    if (role === 'gm') return 'gm';
  }
  return null;
}

async function loadReimbContext(reimbursementId) {
  const rows = await query(
    `SELECT r.id, r.status, r.applicant_user_id AS applicantUserId,
            r.project_id AS project_id, r.reimburse_amount,
            p.manager_user_id AS managerUserId, p.finance_user_id AS financeUserId,
            p.code AS projectCode, p.name AS projectName
     FROM reimbursement r
     JOIN project p ON p.id = r.project_id
     WHERE r.id = :id LIMIT 1`,
    { id: reimbursementId },
  );
  return rows[0] || null;
}

async function loadUserBrief(userId) {
  if (!userId) return null;
  const rows = await query(
    `SELECT id AS userId, name, title FROM user_account WHERE id = :id AND status = 1 LIMIT 1`,
    { id: userId },
  );
  return rows[0] || null;
}

function mapUserRow(row, defaultId) {
  return {
    userId: row.userId,
    name: row.name,
    title: row.title || null,
    isDefault: defaultId != null && Number(row.userId) === Number(defaultId),
  };
}

async function assertCanListCandidates(reimb, actorUserId, forRole) {
  if (!reimb) throw badRequest('报销单不存在');

  if (reimb.status === 'draft' && Number(reimb.applicantUserId) === Number(actorUserId)) {
    if (forRole === 'pm' || forRole === 'finance') return;
    throw forbidden('草稿仅可查看项目经理与财务');
  }

  const pending = await query(
    `SELECT t.id, t.node_order AS nodeOrder, ai.flow_id AS flowId
     FROM approval_task t
     JOIN approval_instance ai ON ai.id = t.instance_id
     WHERE ai.reimbursement_id = :id AND t.assignee_user_id = :userId AND t.status = 'pending'
     LIMIT 1`,
    { id: reimb.id, userId: actorUserId },
  );
  if (pending[0]) {
    const next = await query(
      `SELECT n.approver_type, n.approver_value
       FROM approval_task t
       JOIN approval_flow_node n ON n.flow_id = :flowId AND n.node_order = t.node_order
       WHERE t.instance_id = (SELECT instance_id FROM approval_task WHERE id = :taskId)
         AND t.node_order > :nodeOrder AND t.status = 'waiting'
       ORDER BY t.node_order ASC LIMIT 1`,
      { flowId: pending[0].flowId, taskId: pending[0].id, nodeOrder: pending[0].nodeOrder },
    );
    const nextRole = classifyNodeRole(next[0]);
    if (nextRole === forRole) return;
    throw forbidden('当前审批环节不可查看该角色');
  }

  throw forbidden('当前状态不可查看审批人');
}

/** 仅本项目经理 */
async function listPmCandidates(reimb) {
  const defaultId = reimb.managerUserId || null;
  if (!defaultId) return [];
  const one = await loadUserBrief(defaultId);
  return one ? [mapUserRow(one, defaultId)] : [];
}

/** 仅本项目财务 */
async function listFinanceCandidates(reimb) {
  const defaultId = reimb.financeUserId || null;
  if (!defaultId) return [];
  const one = await loadUserBrief(defaultId);
  return one ? [mapUserRow(one, defaultId)] : [];
}

/** 总经理：按金额自动选一人，不返回档位 */
async function listGmCandidates(reimb) {
  const grade = pickGmGradeByAmount(reimb.reimburse_amount);
  const defaultId = await resolveGmApprover(grade);
  if (!defaultId) {
    const any = await query(
      `SELECT u.id AS userId, u.name, u.title
       FROM user_role ur
       JOIN user_account u ON u.id = ur.user_id
       WHERE ur.role_code = 'gm' AND ur.status = 1 AND u.status = 1
       ORDER BY FIELD(ur.grade, 'C', 'B', 'A') LIMIT 1`,
    );
    return any.map((r) => mapUserRow(r, r.userId));
  }
  const one = await loadUserBrief(defaultId);
  return one ? [mapUserRow(one, defaultId)] : [];
}

export async function listApproverCandidates(actorUserId, { reimbursementId, for: forRole }) {
  const role = String(forRole || '').toLowerCase();
  if (!['pm', 'finance', 'gm'].includes(role)) {
    throw badRequest('for 须为 pm | finance | gm');
  }
  const id = Number(reimbursementId);
  if (!id) throw badRequest('缺少 reimbursementId');

  const reimb = await loadReimbContext(id);
  await assertCanListCandidates(reimb, actorUserId, role);

  let list;
  if (role === 'pm') list = await listPmCandidates(reimb);
  else if (role === 'finance') list = await listFinanceCandidates(reimb);
  else list = await listGmCandidates(reimb);

  return { for: role, list, defaultUserId: list.find((x) => x.isDefault)?.userId || list[0]?.userId || null };
}

/** 草稿页展示：本项目审批路径（只读） */
export async function getProjectApproverPath(actorUserId, reimbursementId) {
  const reimb = await loadReimbContext(Number(reimbursementId));
  if (!reimb) throw badRequest('报销单不存在');
  if (Number(reimb.applicantUserId) !== Number(actorUserId) && reimb.status === 'draft') {
    throw forbidden('无权查看');
  }
  const [pm, finance] = await Promise.all([
    loadUserBrief(reimb.managerUserId),
    loadUserBrief(reimb.financeUserId),
  ]);
  return {
    projectCode: reimb.projectCode,
    projectName: reimb.projectName,
    pm: pm ? mapUserRow(pm, pm.userId) : null,
    finance: finance ? mapUserRow(finance, finance.userId) : null,
    canSubmit: !!(reimb.managerUserId && reimb.financeUserId),
  };
}

export async function assertUserInCandidates(reimb, forRole, userId) {
  const uid = Number(userId);
  if (!uid) {
    throw badRequest(
      forRole === 'pm'
        ? '项目未配置项目经理'
        : forRole === 'finance'
          ? '项目未配置财务'
          : '未配置总经理',
    );
  }

  let list;
  if (forRole === 'pm') list = await listPmCandidates(reimb);
  else if (forRole === 'finance') list = await listFinanceCandidates(reimb);
  else list = await listGmCandidates(reimb);

  if (!list.some((x) => Number(x.userId) === uid)) {
    throw badRequest('审批人须为本项目已分配人员');
  }
  return uid;
}

export async function resolveDefaultAssignee(reimb, forRole) {
  if (forRole === 'pm') {
    return reimb.managerUserId ? Number(reimb.managerUserId) : null;
  }
  if (forRole === 'finance') {
    return reimb.financeUserId ? Number(reimb.financeUserId) : null;
  }
  if (forRole === 'gm') {
    const list = await listGmCandidates(reimb);
    return list[0]?.userId ? Number(list[0].userId) : null;
  }
  return null;
}

export { loadReimbContext };
