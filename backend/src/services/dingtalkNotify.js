import { config } from '../config.js';
import { getAccessToken } from './dingtalk.js';
import { trackApiUsage } from './apiUsage.js';
import { OA_FORM_FIELDS, getAttachmentFieldLabel } from './dingtalkOa.js';

async function fetchOapi(path, body) {
  const accessToken = await getAccessToken();
  const url = `https://oapi.dingtalk.com${path}?access_token=${encodeURIComponent(accessToken)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.errcode !== 0) {
    throw new Error(data.errmsg || `钉钉 API 失败: ${data.errcode}`);
  }
  return data;
}

async function fetchOpenApi(path, body, apiName) {
  const accessToken = await getAccessToken();
  const res = await fetch(`https://api.dingtalk.com${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-acs-dingtalk-access-token': accessToken,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || data.code || `HTTP ${res.status}`);
  }
  if (apiName) await trackApiUsage(apiName);
  return data;
}

/**
 * 发送工作通知（文本）
 * @see https://open.dingtalk.com/document/orgapp-server/asynchronous-sending-of-enterprise-session-messages
 */
export async function sendWorkNotification(dingUserIds, content) {
  if (!dingUserIds.length) return;
  if (!config.dingtalk.agentId) {
    console.warn('[notify] DINGTALK_AGENT_ID 未配置，跳过通知');
    return;
  }

  try {
    await fetchOapi('/topapi/message/corpconversation/asyncsend_v2', {
      agent_id: Number(config.dingtalk.agentId),
      userid_list: dingUserIds.join(','),
      msg: {
        msgtype: 'text',
        text: { content },
      },
    });
    await trackApiUsage('workNotification');
  } catch (err) {
    console.error('[notify]', err.message);
  }
}

/**
 * 发起钉钉 OA 审批实例（方案 B）
 */
export async function createOaApprovalInstance({
  processCode,
  originatorUserId,
  deptId,
  formComponentValues,
}) {
  const body = {
    originatorUserId,
    processCode,
    formComponentValues,
  };
  if (deptId) body.deptId = deptId;
  if (config.dingtalk.agentId) body.microappAgentId = Number(config.dingtalk.agentId);

  const data = await fetchOpenApi('/v1.0/workflow/processInstances', body, 'createProcessInstance');
  return {
    instanceId: data.instanceId || data.processInstanceId || data.id,
    raw: data,
  };
}

/**
 * 构建 OA 表单字段（label 须与钉钉模板完全一致）
 * 附件控件：免费方案仅填入文件名列表；原生附件需钉盘 upload API（见 docs/P4-OA对接指南.md）
 */
export function buildReimbursementFormValues(reimb, { detailUrl, attachmentNames = [] } = {}) {
  const categorySummary = [...new Set((reimb.items || []).map((i) => i.costCategoryName))].join('、');
  const values = [
    { name: OA_FORM_FIELDS.billNo, value: reimb.billNo },
    { name: OA_FORM_FIELDS.projectCode, value: reimb.projectCode || '' },
    { name: OA_FORM_FIELDS.projectName, value: reimb.projectName || '' },
    { name: OA_FORM_FIELDS.expenseType, value: categorySummary || '综合' },
    { name: OA_FORM_FIELDS.amount, value: String(reimb.reimburseAmount ?? 0) },
    { name: OA_FORM_FIELDS.expenseDate, value: String(reimb.expenseDate || '').slice(0, 10) },
    { name: OA_FORM_FIELDS.description, value: reimb.description || reimb.title || '' },
  ];
  if (detailUrl) {
    values.push({ name: OA_FORM_FIELDS.detailUrl, value: detailUrl });
  }
  if (attachmentNames.length) {
    values.push({
      name: getAttachmentFieldLabel(),
      value: attachmentNames.join('\n'),
    });
  }
  return values;
}

export function buildDetailUrl(reimbId) {
  const base = config.frontendUrl.replace(/\/$/, '');
  return `${base}/h5/reimb/${reimbId}`;
}
