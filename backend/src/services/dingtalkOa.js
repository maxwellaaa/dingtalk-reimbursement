/** OA 审批表单字段名（须与钉钉模板控件 label 完全一致） */
export const OA_FORM_FIELDS = {
  billNo: '报销单号',
  projectCode: '项目编号',
  projectName: '项目名称',
  expenseType: '费用类型',
  amount: '报销金额',
  expenseDate: '费用发生日期',
  description: '报销说明',
  detailUrl: '详情链接',
};

/** 附件控件默认 label；可通过 DINGTALK_OA_ATTACHMENT_LABEL 覆盖（如模板用「附件」） */
export function getAttachmentFieldLabel() {
  return process.env.DINGTALK_OA_ATTACHMENT_LABEL || '发票及凭证';
}

const SYNC_STATUS_LABEL = {
  pending: '待同步',
  synced: '已发起',
  finished: '已通过',
  rejected: '已驳回',
  failed: '发起失败',
};

export function syncStatusLabel(status) {
  return SYNC_STATUS_LABEL[status] || status;
}

function parseJsonSafe(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * 统一 Stream / HTTP 回调 / 开发模拟 的 bpms_instance_change 载荷
 * @see https://open.dingtalk.com/document/orgapp/event-bpms-instance-change
 */
export function normalizeOaInstanceEvent(input) {
  if (!input) return null;

  let envelope = input;
  let headerEventType = null;

  // dingtalk-stream EVENT 消息
  if (input.headers || input.type === 'EVENT') {
    headerEventType = input.headers?.eventType || input.headers?.EventType || null;
    envelope = parseJsonSafe(input.data) || {};
  }

  // Stream 新版：{ eventType, data: { processInstanceId, type, ... } }
  let body = envelope;
  if (body.data && typeof body.data === 'object' && !body.processInstanceId && !body.process_instance_id) {
    body = { ...body, ...body.data };
  }

  const processInstanceId = body.processInstanceId || body.process_instance_id || null;
  const type = body.type || null;
  const result = body.result || null;
  const eventType =
    body.eventType || body.EventType || headerEventType || (type ? 'bpms_instance_change' : null);

  if (!processInstanceId && !type) return null;

  return {
    processInstanceId,
    type,
    result,
    eventType,
    processCode: body.processCode || body.process_code || null,
    title: body.title || null,
    url: body.url || null,
    staffId: body.staffId || body.staff_id || null,
    raw: body,
  };
}

export function maskProcessCode(code) {
  if (!code) return '';
  if (code.length <= 8) return `${code.slice(0, 2)}****`;
  return `${code.slice(0, 5)}****${code.slice(-4)}`;
}
