import { query, withTransaction } from '../db/pool.js';
import {
  occupyBudgetOnApproval,
  releaseBudgetOnReject,
  validateBudgetForReimbursement,
} from './budget.js';
import { buildDetailUrl, buildReimbursementFormValues, createOaApprovalInstance } from './dingtalkNotify.js';
import { sendWorkNotification } from './dingtalkNotify.js';
import { validateInvoicesForSubmit } from './invoice.js';
import { getApprovalMode, getProcessCode } from './sysConfig.js';
import { syncStatusLabel } from './dingtalkOa.js';
import { assertUserInCandidates, classifyNodeRole, resolveDefaultAssignee } from './approverCandidates.js';

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

async function getReimbursementForSubmit(id, userId) {
  const rows = await query(
    `SELECT r.*, p.code AS projectCode, p.name AS projectName, p.manager_user_id AS managerUserId,
            p.finance_user_id AS financeUserId,
            u.ding_user_id AS applicantDingUserId, u.name AS applicantName
     FROM reimbursement r
     JOIN project p ON p.id = r.project_id
     JOIN user_account u ON u.id = r.applicant_user_id
     WHERE r.id = :id AND r.applicant_user_id = :userId LIMIT 1`,
    { id, userId },
  );
  return rows[0] || null;
}

async function loadItemsForReimb(id) {
  return query(
    `SELECT ri.*, cc.name AS costCategoryName
     FROM reimbursement_item ri
     JOIN cost_category cc ON cc.id = ri.cost_category_id
     WHERE ri.reimbursement_id = :id ORDER BY line_no`,
    { id },
  );
}

async function resolveFlow(reimb) {
  const flows = await query(
    `SELECT id FROM approval_flow
     WHERE status = 1 AND (project_id = :projectId OR project_id IS NULL)
     ORDER BY project_id DESC, id ASC LIMIT 1`,
    { projectId: reimb.project_id },
  );
  if (!flows[0]) {
    throw new Error('未配置审批流，请运行 npm run db:seed');
  }
  const nodes = await query(
    `SELECT * FROM approval_flow_node WHERE flow_id = :flowId ORDER BY node_order ASC`,
    { flowId: flows[0].id },
  );
  return { flowId: flows[0].id, nodes };
}

async function resolveAssignee(node, reimb) {
  const {
    pickFinanceGradeByAmount,
    pickGmGradeByAmount,
    resolveFinanceApprover,
    resolveGmApprover,
  } = await import('./accessScope.js');

  if (node.approver_type === 'project_role' && node.approver_value === 'manager') {
    if (reimb.managerUserId) return reimb.managerUserId;
    return null;
  }
  if (node.approver_type === 'project_role' && node.approver_value === 'finance') {
    return resolveFinanceApprover(reimb, 'A');
  }
  if (node.approver_type === 'role') {
    const raw = String(node.approver_value || '');
    // finance | finance:A | finance:auto | gm | gm:B | gm:auto
    const [role, gradeRaw] = raw.split(':');
    if (role === 'finance') {
      const grade =
        !gradeRaw || gradeRaw === 'auto'
          ? pickFinanceGradeByAmount(reimb.reimburse_amount)
          : gradeRaw.toUpperCase();
      return resolveFinanceApprover(reimb, grade);
    }
    if (role === 'gm') {
      const grade =
        !gradeRaw || gradeRaw === 'auto'
          ? pickGmGradeByAmount(reimb.reimburse_amount)
          : gradeRaw.toUpperCase();
      // 小额可不经总经理：A档阈值内跳过
      if ((!gradeRaw || gradeRaw === 'auto') && Number(reimb.reimburse_amount) <= 5000) {
        return null;
      }
      return resolveGmApprover(grade);
    }
  }
  if (node.approver_type === 'fixed') {
    return Number(node.approver_value) || null;
  }
  if (node.approver_type === 'applicant') {
    return reimb.applicant_user_id;
  }
  return null;
}

async function getDingUserId(userAccountId) {
  const rows = await query('SELECT ding_user_id FROM user_account WHERE id = :id LIMIT 1', {
    id: userAccountId,
  });
  return rows[0]?.ding_user_id || null;
}

export async function startInternalApproval(reimbId, reimbRow, overrides = {}) {
  const pmUserId =
    Number(overrides.pmUserId) || Number(reimbRow.managerUserId) || null;
  const financeUserId =
    Number(overrides.financeUserId) || Number(reimbRow.financeUserId) || null;
  if (!pmUserId) throw badRequest('项目未配置项目经理，请联系管理员');
  if (!financeUserId) throw badRequest('项目未配置财务，请联系管理员');

  await assertUserInCandidates(reimbRow, 'pm', pmUserId);
  await assertUserInCandidates(reimbRow, 'finance', financeUserId);

  const { flowId, nodes } = await resolveFlow(reimbRow);
  const assignees = [];

  for (const node of nodes) {
    const role = classifyNodeRole(node);
    let uid = null;
    if (role === 'pm') uid = pmUserId;
    else if (role === 'finance') uid = financeUserId;
    else uid = await resolveAssignee(node, reimbRow);
    if (uid) assignees.push({ node, userId: uid, role });
  }

  if (!assignees.length) {
    throw new Error('审批流未解析到任何审批人，请配置项目经理或固定审批人');
  }

  await withTransaction(async (conn) => {
    const [ins] = await conn.query(
      `INSERT INTO approval_instance (reimbursement_id, flow_id, status, current_node_order)
       VALUES (?, ?, 'pending', ?)`,
      [reimbId, flowId, assignees[0].node.node_order],
    );
    const instanceId = ins.insertId;

    for (const { node, userId } of assignees) {
      await conn.query(
        `INSERT INTO approval_task (instance_id, node_order, assignee_user_id, status)
         VALUES (?, ?, ?, ?)`,
        [instanceId, node.node_order, userId, node.node_order === assignees[0].node.node_order ? 'pending' : 'waiting'],
      );
    }

    await conn.query(
      `UPDATE reimbursement SET status = 'approving', submit_at = NOW(), approval_mode = 'A' WHERE id = ?`,
      [reimbId],
    );
  });

  const first = assignees[0];
  const dingIds = [];
  const ding = await getDingUserId(first.userId);
  if (ding) dingIds.push(ding);

  await sendWorkNotification(
    dingIds,
    `【待审批】${reimbRow.applicantName || ''} 提交了报销单 ${reimbRow.bill_no}，金额 ¥${reimbRow.reimburse_amount}，请处理。`,
  );

  try {
    const { notifyMobileApprovalTask } = await import('./pushNotify.js');
    await notifyMobileApprovalTask({
      userId: first.userId,
      billNo: reimbRow.bill_no,
      reimbId: reimbId,
    });
  } catch (pushErr) {
    console.warn('[approval] push notify:', pushErr.message);
  }

  return {
    mode: 'A',
    firstAssigneeId: first.userId,
    message: '已提交自研审批，审批人将在 H5「待办」中处理',
    overrides: { pmUserId, financeUserId },
  };
}

async function loadAttachmentsForReimb(id) {
  return query(
    `SELECT file_name AS fileName FROM file_attachment
     WHERE biz_type = 'reimbursement' AND biz_id = :id ORDER BY id`,
    { id },
  );
}

export async function startOaApproval(reimbId, reimbRow, items, overrides = {}) {
  const processCode = await getProcessCode();
  if (!processCode) {
    console.warn('[oa] processCode 未配置，降级为方案 A 自研审批');
    const result = await startInternalApproval(reimbId, reimbRow, overrides);
    return { ...result, fallbackReason: 'processCode 未配置' };
  }

  if (!reimbRow.applicantDingUserId || reimbRow.applicantDingUserId === 'dev_user') {
    console.warn('[oa] 发起人非真实钉钉用户，降级为方案 A');
    const result = await startInternalApproval(reimbId, reimbRow, overrides);
    return { ...result, fallbackReason: '非真实钉钉用户' };
  }

  const reimb = {
    ...reimbRow,
    items,
    billNo: reimbRow.bill_no,
    reimburseAmount: reimbRow.reimburse_amount,
    expenseDate: reimbRow.expense_date,
    projectCode: reimbRow.projectCode,
    projectName: reimbRow.projectName,
  };

  const attachments = await loadAttachmentsForReimb(reimbId);
  const detailUrl = buildDetailUrl(reimbId);
  const formValues = buildReimbursementFormValues(reimb, {
    detailUrl,
    attachmentNames: attachments.map((a) => a.fileName),
  });

  let instanceId;
  let raw;
  try {
    ({ instanceId, raw } = await createOaApprovalInstance({
      processCode,
      originatorUserId: reimbRow.applicantDingUserId,
      deptId: reimbRow.dept_id || undefined,
      formComponentValues: formValues,
    }));
  } catch (err) {
    console.error('[oa] create instance failed:', err.message);
    await query(
      `INSERT INTO dingtalk_oa_mapping
       (reimbursement_id, process_code, sync_status, raw_create_response, originator_ding_user_id)
       VALUES (:reimbId, :processCode, 'failed', :raw, :dingUserId)
       ON DUPLICATE KEY UPDATE sync_status = 'failed', raw_create_response = VALUES(raw_create_response), updated_at = NOW()`,
      {
        reimbId,
        processCode,
        raw: JSON.stringify({ error: err.message }),
        dingUserId: reimbRow.applicantDingUserId,
      },
    );
    throw new Error(
      `钉钉 OA 审批发起失败：${err.message}。报销单仍为草稿，请检查 processCode、权限与表单字段后重试。`,
    );
  }

  await withTransaction(async (conn) => {
    await conn.query(
      `INSERT INTO dingtalk_oa_mapping
       (reimbursement_id, process_code, process_instance_id, originator_ding_user_id, sync_status, raw_create_response)
       VALUES (?, ?, ?, ?, 'synced', ?)
       ON DUPLICATE KEY UPDATE
         process_instance_id = VALUES(process_instance_id),
         sync_status = 'synced',
         raw_create_response = VALUES(raw_create_response),
         updated_at = NOW()`,
      [reimbId, processCode, instanceId, reimbRow.applicantDingUserId, JSON.stringify(raw)],
    );
    await conn.query(
      `UPDATE reimbursement SET status = 'approving', submit_at = NOW(), approval_mode = 'B' WHERE id = ?`,
      [reimbId],
    );
  });

  if (reimbRow.applicantDingUserId) {
    await sendWorkNotification(
      [reimbRow.applicantDingUserId],
      `报销单 ${reimbRow.bill_no} 已提交钉钉 OA 审批，请在「OA审批」中查看进度。`,
    );
  }

  return {
    mode: 'B',
    instanceId,
    detailUrl,
    message: '已提交钉钉 OA 审批，审批人将在钉钉「OA审批」中处理',
  };
}

export async function listMyPendingTasks(userId) {
  return query(
    `SELECT t.id AS taskId, t.node_order AS nodeOrder, t.status, t.created_at AS createdAt,
            n.node_name AS nodeName,
            r.id AS reimbursementId, r.bill_no AS billNo, r.title, r.reimburse_amount AS reimburseAmount,
            r.status AS reimbStatus, r.expense_date AS expenseDate,
            p.code AS projectCode, p.name AS projectName,
            u.name AS applicantName
     FROM approval_task t
     JOIN approval_instance ai ON ai.id = t.instance_id
     JOIN approval_flow_node n ON n.flow_id = ai.flow_id AND n.node_order = t.node_order
     JOIN reimbursement r ON r.id = ai.reimbursement_id
     JOIN project p ON p.id = r.project_id
     JOIN user_account u ON u.id = r.applicant_user_id
     WHERE t.assignee_user_id = :userId AND t.status = 'pending'
     ORDER BY t.created_at DESC`,
    { userId },
  );
}

export async function listApprovalTimeline(reimbursementId) {
  const instanceRows = await query(
    `SELECT ai.id, ai.status, ai.started_at AS startedAt, ai.finished_at AS finishedAt,
            f.name AS flowName
     FROM approval_instance ai
     JOIN approval_flow f ON f.id = ai.flow_id
     WHERE ai.reimbursement_id = :id
     ORDER BY ai.id DESC LIMIT 1`,
    { id: reimbursementId },
  );
  if (!instanceRows[0]) {
    const oaRows = await query(
      `SELECT process_instance_id AS processInstanceId, process_code AS processCode,
              sync_status AS syncStatus, last_event_type AS lastEventType,
              last_event_at AS lastEventAt, raw_last_event AS rawLastEvent
       FROM dingtalk_oa_mapping WHERE reimbursement_id = :id LIMIT 1`,
      { id: reimbursementId },
    );
    const oa = oaRows[0] || null;
    if (oa) {
      let oaUrl = null;
      try {
        const raw = typeof oa.rawLastEvent === 'string' ? JSON.parse(oa.rawLastEvent) : oa.rawLastEvent;
        oaUrl = raw?.url || raw?.raw?.url || null;
      } catch {
        /* ignore */
      }
      return {
        mode: 'B',
        instance: null,
        oa: {
          ...oa,
          syncStatusLabel: syncStatusLabel(oa.syncStatus),
          oaUrl,
        },
        tasks: [],
      };
    }
    return { mode: 'B', instance: null, oa: null, tasks: [] };
  }

  const tasks = await query(
    `SELECT t.id, t.node_order AS nodeOrder, t.status, t.comment, t.acted_at AS actedAt,
            n.node_name AS nodeName, u.name AS assigneeName
     FROM approval_task t
     JOIN approval_flow_node n ON n.flow_id = (SELECT flow_id FROM approval_instance WHERE id = t.instance_id)
       AND n.node_order = t.node_order
     JOIN user_account u ON u.id = t.assignee_user_id
     WHERE t.instance_id = :instanceId
     ORDER BY t.node_order`,
    { instanceId: instanceRows[0].id },
  );

  return { mode: 'A', instance: instanceRows[0], oa: null, tasks };
}

/** 详情页：当前待办 + 下一环选人上下文 */
export async function enrichPendingTaskContext(pendingTask) {
  if (!pendingTask?.taskId) return null;
  const rows = await query(
    `SELECT t.id AS taskId, t.node_order AS nodeOrder, t.instance_id AS instanceId, ai.flow_id AS flowId
     FROM approval_task t
     JOIN approval_instance ai ON ai.id = t.instance_id
     WHERE t.id = :id AND t.status = 'pending' LIMIT 1`,
    { id: pendingTask.taskId },
  );
  const cur = rows[0];
  if (!cur) return { ...pendingTask, nextApproverRole: null, nextAssigneeUserId: null };

  const next = await query(
    `SELECT t.id, t.assignee_user_id AS assigneeUserId,
            n.approver_type, n.approver_value, n.node_name AS nodeName
     FROM approval_task t
     JOIN approval_flow_node n ON n.flow_id = :flowId AND n.node_order = t.node_order
     WHERE t.instance_id = :instanceId AND t.node_order > :nodeOrder AND t.status = 'waiting'
     ORDER BY t.node_order ASC LIMIT 1`,
    { flowId: cur.flowId, instanceId: cur.instanceId, nodeOrder: cur.nodeOrder },
  );
  const n = next[0];
  const nextApproverRole = n ? classifyNodeRole(n) : null;
  return {
    taskId: cur.taskId,
    nodeOrder: cur.nodeOrder,
    nextApproverRole: nextApproverRole === 'finance' || nextApproverRole === 'gm' ? nextApproverRole : null,
    nextAssigneeUserId: n?.assigneeUserId || null,
    nextNodeName: n?.nodeName || null,
  };
}

export async function actOnTask(taskId, userId, action, comment, options = {}) {
  const tasks = await query(
    `SELECT t.*, ai.reimbursement_id, ai.id AS instanceId, ai.flow_id AS flowId
     FROM approval_task t
     JOIN approval_instance ai ON ai.id = t.instance_id
     WHERE t.id = :taskId AND t.assignee_user_id = :userId AND t.status = 'pending' LIMIT 1`,
    { taskId, userId },
  );
  const task = tasks[0];
  if (!task) throw new Error('待办不存在或已处理');

  const reimbRows = await query(
    `SELECT r.*, p.manager_user_id AS managerUserId, p.finance_user_id AS financeUserId,
            u.ding_user_id AS applicantDingUserId, u.name AS applicantName
     FROM reimbursement r
     JOIN project p ON p.id = r.project_id
     JOIN user_account u ON u.id = r.applicant_user_id
     WHERE r.id = :id LIMIT 1`,
    { id: task.reimbursement_id },
  );
  const reimb = reimbRows[0];

  if (action === 'reject') {
    await withTransaction(async (conn) => {
      await conn.query(
        `UPDATE approval_task SET status = 'rejected', comment = ?, acted_at = NOW() WHERE id = ?`,
        [comment || '驳回', taskId],
      );
      await conn.query(
        `UPDATE approval_task SET status = 'cancelled'
         WHERE instance_id = ? AND status IN ('pending', 'waiting') AND id != ?`,
        [task.instanceId, taskId],
      );
      await conn.query(
        `UPDATE approval_instance SET status = 'rejected', finished_at = NOW() WHERE id = ?`,
        [task.instanceId],
      );
      await conn.query(
        `UPDATE reimbursement SET status = 'rejected' WHERE id = ?`,
        [task.reimbursement_id],
      );
    });
    await releaseBudgetOnReject(task.reimbursement_id, '驳回释放');
    const applicantDing = reimb.applicantDingUserId;
    if (applicantDing) {
      await sendWorkNotification(
        [applicantDing],
        `您的报销单 ${reimb.bill_no} 已被驳回。${comment ? `意见：${comment}` : ''}`,
      );
    }
    return { status: 'rejected' };
  }

  if (action !== 'approve') throw new Error('无效操作');

  const nextTasks = await query(
    `SELECT t.id, t.assignee_user_id AS assigneeUserId, t.node_order AS nodeOrder,
            n.approver_type, n.approver_value
     FROM approval_task t
     JOIN approval_flow_node n ON n.flow_id = :flowId AND n.node_order = t.node_order
     WHERE t.instance_id = :instanceId AND t.node_order > :nodeOrder AND t.status = 'waiting'
     ORDER BY t.node_order ASC LIMIT 1`,
    { instanceId: task.instanceId, nodeOrder: task.node_order, flowId: task.flowId },
  );

  const next = nextTasks[0];
  if (next) {
    const nextRole = classifyNodeRole(next);
    if (nextRole === 'finance' || nextRole === 'gm') {
      let nextAssigneeUserId =
        Number(options.nextAssigneeUserId) ||
        Number(next.assigneeUserId) ||
        (await resolveDefaultAssignee(reimb, nextRole));
      if (!nextAssigneeUserId) {
        throw badRequest(
          nextRole === 'finance' ? '项目未配置财务审批人' : '未配置总经理审批人',
        );
      }
      if (nextRole === 'finance') {
        await assertUserInCandidates(reimb, nextRole, nextAssigneeUserId);
      }
      await query(`UPDATE approval_task SET assignee_user_id = :uid WHERE id = :id`, {
        uid: nextAssigneeUserId,
        id: next.id,
      });
    }
  }

  await query(
    `UPDATE approval_task SET status = 'approved', comment = ?, acted_at = NOW() WHERE id = :taskId`,
    { taskId, comment: comment || '同意' },
  );

  if (next) {
    await query(`UPDATE approval_task SET status = 'pending' WHERE id = :id`, { id: next.id });
    const nextAssignee = await query(
      'SELECT assignee_user_id FROM approval_task WHERE id = :id',
      { id: next.id },
    );
    const ding = await getDingUserId(nextAssignee[0].assignee_user_id);
    if (ding) {
      await sendWorkNotification(
        [ding],
        `【待审批】报销单 ${reimb.bill_no} 金额 ¥${reimb.reimburse_amount} 请您审批。`,
      );
    }
    return { status: 'approving' };
  }

  await query(`UPDATE approval_instance SET status = 'approved', finished_at = NOW() WHERE id = :id`, {
    id: task.instanceId,
  });
  await query(
    `UPDATE reimbursement SET status = 'approved', approved_at = NOW() WHERE id = :id`,
    { id: task.reimbursement_id },
  );
  await occupyBudgetOnApproval(task.reimbursement_id);

  if (reimb.applicantDingUserId) {
    await sendWorkNotification(
      [reimb.applicantDingUserId],
      `您的报销单 ${reimb.bill_no} 已审批通过。`,
    );
  }
  return { status: 'approved' };
}

export async function handleOaInstanceEvent(payload) {
  const processInstanceId = payload.processInstanceId || payload.process_instance_id;
  const type = payload.type || payload.eventType;
  const result = payload.result;

  if (!processInstanceId) return { skipped: true, reason: 'no processInstanceId' };

  const maps = await query(
    'SELECT * FROM dingtalk_oa_mapping WHERE process_instance_id = :id LIMIT 1',
    { id: processInstanceId },
  );
  const mapping = maps[0];
  if (!mapping) {
    console.warn('[oa-event] 未找到映射:', processInstanceId);
    return { skipped: true, reason: 'mapping not found' };
  }

  const reimbRows = await query('SELECT id, status FROM reimbursement WHERE id = :id LIMIT 1', {
    id: mapping.reimbursement_id,
  });
  const reimb = reimbRows[0];
  if (!reimb) return { skipped: true, reason: 'reimbursement not found' };

  await query(
    `UPDATE dingtalk_oa_mapping SET last_event_type = :type, last_event_at = NOW(), raw_last_event = :raw WHERE id = :id`,
    { type, raw: JSON.stringify(payload.raw || payload), id: mapping.id },
  );

  if (type === 'start') {
    if (reimb.status === 'draft') {
      await query(`UPDATE reimbursement SET status = 'approving' WHERE id = :id`, { id: mapping.reimbursement_id });
    }
    return { status: 'approving', type };
  }

  if (type === 'finish') {
    if (reimb.status === 'approved' || reimb.status === 'rejected') {
      return { status: reimb.status, type, duplicate: true };
    }
    if (result === 'agree') {
      await query(
        `UPDATE reimbursement SET status = 'approved', approved_at = NOW() WHERE id = :id`,
        { id: mapping.reimbursement_id },
      );
      await occupyBudgetOnApproval(mapping.reimbursement_id);
      await query(`UPDATE dingtalk_oa_mapping SET sync_status = 'finished' WHERE id = :id`, {
        id: mapping.id,
      });
      return { status: 'approved', type, result };
    }
    await query(`UPDATE reimbursement SET status = 'rejected' WHERE id = :id`, {
      id: mapping.reimbursement_id,
    });
    await releaseBudgetOnReject(mapping.reimbursement_id, 'OA驳回释放');
    await query(`UPDATE dingtalk_oa_mapping SET sync_status = 'rejected' WHERE id = :id`, {
      id: mapping.id,
    });
    return { status: 'rejected', type, result: result || 'refuse' };
  }

  if (type === 'terminate' || type === 'delete') {
    if (reimb.status !== 'cancelled') {
      await query(`UPDATE reimbursement SET status = 'cancelled' WHERE id = :id`, {
        id: mapping.reimbursement_id,
      });
      await releaseBudgetOnReject(mapping.reimbursement_id, 'OA撤销释放');
    }
    await query(`UPDATE dingtalk_oa_mapping SET sync_status = 'finished' WHERE id = :id`, {
      id: mapping.id,
    });
    return { status: 'cancelled', type };
  }

  return { status: reimb.status, type, unhandled: true };
}

export async function cancelInternalApproval(reimbId) {
  await withTransaction(async (conn) => {
    const [instances] = await conn.query(
      `SELECT id FROM approval_instance WHERE reimbursement_id = ? AND status = 'pending' LIMIT 1`,
      [reimbId],
    );
    if (!instances[0]) return;

    await conn.query(
      `UPDATE approval_instance SET status = 'cancelled', finished_at = NOW() WHERE id = ?`,
      [instances[0].id],
    );
    await conn.query(
      `UPDATE approval_task SET status = 'cancelled'
       WHERE instance_id = ? AND status IN ('pending', 'waiting')`,
      [instances[0].id],
    );
  });
}

export async function submitApprovalFlow(reimbId, userId, overrides = {}) {
  const reimb = await getReimbursementForSubmit(reimbId, userId);
  if (!reimb) throw new Error('报销单不存在');
  if (reimb.status !== 'draft') throw new Error('仅草稿可提交');

  await validateInvoicesForSubmit(reimbId);
  await validateBudgetForReimbursement(reimbId);

  const items = await loadItemsForReimb(reimbId);
  const mode = await getApprovalMode();

  const pick = {
    pmUserId: overrides.pmUserId,
    financeUserId: overrides.financeUserId,
  };

  if (mode === 'A') {
    return startInternalApproval(reimbId, reimb, pick);
  }
  return startOaApproval(reimbId, reimb, items, pick);
}

/** 开发/运维：按 reimbursementId 或 processInstanceId 模拟 OA 事件 */
export async function simulateOaInstanceEvent({ reimbursementId, processInstanceId, type, result }) {
  let instanceId = processInstanceId;
  if (!instanceId && reimbursementId) {
    const rows = await query(
      'SELECT process_instance_id FROM dingtalk_oa_mapping WHERE reimbursement_id = :id LIMIT 1',
      { id: reimbursementId },
    );
    instanceId = rows[0]?.process_instance_id;
    if (!instanceId) {
      throw new Error('该报销单无 OA 实例映射，请先以方案 B 提交或手动写入 dingtalk_oa_mapping');
    }
  }
  if (!instanceId) throw new Error('缺少 processInstanceId 或 reimbursementId');
  if (!type) throw new Error('缺少 type（start/finish/terminate/delete）');

  return handleOaInstanceEvent({
    processInstanceId: instanceId,
    type,
    result,
    eventType: 'bpms_instance_change',
  });
}

export async function canViewReimbursement(reimbId, userId) {
  const own = await query(
    'SELECT id FROM reimbursement WHERE id = :id AND applicant_user_id = :userId LIMIT 1',
    { id: reimbId, userId },
  );
  if (own[0]) return true;

  const task = await query(
    `SELECT t.id FROM approval_task t
     JOIN approval_instance ai ON ai.id = t.instance_id
     WHERE ai.reimbursement_id = :id AND t.assignee_user_id = :userId LIMIT 1`,
    { id: reimbId, userId },
  );
  if (task[0]) return true;

  const { resolveDataScope } = await import('./accessScope.js');
  const scope = await resolveDataScope(userId);
  if (scope.level === 'all') return true;
  if (scope.level === 'projects' && scope.projectIds.length) {
    const row = await query(
      `SELECT id FROM reimbursement WHERE id = :id AND project_id IN (${scope.projectIds.map((_, i) => `:p${i}`).join(',')}) LIMIT 1`,
      Object.fromEntries([['id', reimbId], ...scope.projectIds.map((pid, i) => [`p${i}`, pid])]),
    );
    return !!row[0];
  }
  return false;
}
