import { Router } from 'express';
import { authRequired } from '../middleware/auth.js';
import {
  actOnTask,
  handleOaInstanceEvent,
  listApprovalTimeline,
  listMyPendingTasks,
  simulateOaInstanceEvent,
} from '../services/approval.js';
import { listApproverCandidates, getProjectApproverPath } from '../services/approverCandidates.js';
import { normalizeOaInstanceEvent } from '../services/dingtalkOa.js';

const router = Router();

router.get('/tasks', authRequired, async (req, res) => {
  try {
    const list = await listMyPendingTasks(req.user.id);
    res.json({ code: 0, data: { list } });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

router.get('/candidates', authRequired, async (req, res) => {
  try {
    const data = await listApproverCandidates(req.user.id, {
      reimbursementId: req.query.reimbursementId,
      for: req.query.for,
    });
    res.json({ code: 0, data });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ code: status, message: err.message });
  }
});

router.get('/project-path', authRequired, async (req, res) => {
  try {
    const data = await getProjectApproverPath(req.user.id, req.query.reimbursementId);
    res.json({ code: 0, data });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ code: status, message: err.message });
  }
});

router.post('/tasks/:id/action', authRequired, async (req, res) => {
  try {
    const { action, comment, nextAssigneeUserId } = req.body || {};
    const data = await actOnTask(Number(req.params.id), req.user.id, action, comment, {
      nextAssigneeUserId,
    });
    res.json({ code: 0, data });
  } catch (err) {
    const status = err.status || 400;
    res.status(status).json({ code: status, message: err.message });
  }
});

router.get('/reimbursements/:id/timeline', authRequired, async (req, res) => {
  try {
    const data = await listApprovalTimeline(Number(req.params.id));
    res.json({ code: 0, data });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

/** 开发/运维：手动模拟 OA 事件回写 */
router.post('/webhooks/oa-instance', async (req, res) => {
  if (process.env.NODE_ENV === 'production' && !process.env.WEBHOOK_SECRET) {
    return res.status(403).json({ code: 403, message: 'Forbidden' });
  }
  if (process.env.WEBHOOK_SECRET && req.headers['x-webhook-secret'] !== process.env.WEBHOOK_SECRET) {
    return res.status(403).json({ code: 403, message: 'Invalid secret' });
  }
  try {
    const body = req.body || {};
    let data;
    if (body.reimbursementId || (body.type && !body.processInstanceId && !body.process_instance_id)) {
      data = await simulateOaInstanceEvent({
        reimbursementId: body.reimbursementId,
        processInstanceId: body.processInstanceId || body.process_instance_id,
        type: body.type,
        result: body.result,
      });
    } else {
      const payload = normalizeOaInstanceEvent(body);
      if (!payload?.processInstanceId) {
        return res.status(400).json({ code: 400, message: '缺少 processInstanceId 或 reimbursementId' });
      }
      data = await handleOaInstanceEvent(payload);
    }
    res.json({ code: 0, message: 'ok', data });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

export default router;
