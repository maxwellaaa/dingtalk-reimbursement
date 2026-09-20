import { Router } from 'express';
import { handleOaInstanceEvent } from '../services/approval.js';
import {
  buildWebhookChallengeResponse,
  isWebhookEncryptionConfigured,
  parseWebhookRequest,
} from '../services/dingtalkWebhook.js';

const router = Router();

function isUrlVerification(req) {
  const body = req.body || {};
  return !!(body.encrypt && !body.processInstanceId && !body.process_instance_id && !body.type);
}

/**
 * 钉钉 HTTP 事件订阅回调（bpms_instance_change 等）
 * 开发：POST 明文 JSON；生产：配置 Token + AES Key + CorpId 后自动解密
 */
async function handleOaWebhook(req, res) {
  try {
    if (req.method === 'GET' || isUrlVerification(req)) {
      const challenge = buildWebhookChallengeResponse(req);
      if (challenge.encrypted) return res.json(challenge.encrypted);
      return res.send(challenge.plain || 'success');
    }

    const payload = parseWebhookRequest(req);
    if (!payload?.processInstanceId) {
      return res.status(400).json({ code: 400, message: '无法解析 OA 事件载荷' });
    }

    if (payload.eventType && !payload.eventType.includes('bpms_instance')) {
      return res.json({ code: 0, message: 'ignored' });
    }

    const result = await handleOaInstanceEvent(payload);
    if (isWebhookEncryptionConfigured()) {
      const resp = buildWebhookChallengeResponse(req);
      return res.json(resp.encrypted || { success: true });
    }
    return res.json({ code: 0, message: 'ok', data: result });
  } catch (err) {
    console.error('[webhook/oa]', err.message);
    res.status(400).json({ code: 400, message: err.message });
  }
}

router.get('/dingtalk/oa', handleOaWebhook);
router.post('/dingtalk/oa', handleOaWebhook);

router.get('/dingtalk/oa/status', (_req, res) => {
  res.json({
    code: 0,
    data: {
      encryptionConfigured: isWebhookEncryptionConfigured(),
      callbackPath: '/api/webhooks/dingtalk/oa',
    },
  });
});

export default router;
