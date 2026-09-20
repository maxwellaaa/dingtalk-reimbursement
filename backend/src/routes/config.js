import { Router } from 'express';
import { getApprovalConfig } from '../services/sysConfig.js';

const router = Router();

/** GET /api/config/approval — 审批模式与 OA 连通性概览 */
router.get('/approval', async (_req, res) => {
  try {
    const data = await getApprovalConfig();
    res.json({ code: 0, data });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

export default router;
