import { Router } from 'express';
import { authRequired } from '../middleware/auth.js';
import {
  cancelReimbursement,
  createReimbursement,
  deleteReimbursement,
  getReimbursement,
  listReimbursements,
  reopenRejectedReimbursement,
  submitReimbursement,
  updateReimbursement,
} from '../services/reimbursement.js';

const router = Router();

router.get('/', authRequired, async (req, res) => {
  try {
    const data = await listReimbursements(req.user.id, {
      status: req.query.status,
      page: Number(req.query.page) || 1,
      pageSize: Number(req.query.pageSize) || 100,
      mine: req.query.mine === '1' || req.query.mine === 'true',
    });
    res.json({ code: 0, data });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

router.get('/:id', authRequired, async (req, res) => {
  try {
    const row = await getReimbursement(Number(req.params.id), req.user.id);
    if (!row) {
      return res.status(404).json({ code: 404, message: '报销单不存在' });
    }
    res.json({ code: 0, data: row });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

router.post('/', authRequired, async (req, res) => {
  try {
    const data = await createReimbursement(req.user.id, req.body);
    res.json({ code: 0, data });
  } catch (err) {
    res.status(400).json({ code: 400, message: err.message });
  }
});

router.put('/:id', authRequired, async (req, res) => {
  try {
    const data = await updateReimbursement(Number(req.params.id), req.user.id, req.body);
    res.json({ code: 0, data });
  } catch (err) {
    res.status(400).json({ code: 400, message: err.message });
  }
});

router.post('/:id/submit', authRequired, async (req, res) => {
  try {
    const data = await submitReimbursement(Number(req.params.id), req.user.id, {
      pmUserId: req.body?.pmUserId,
      financeUserId: req.body?.financeUserId,
    });
    res.json({ code: 0, data });
  } catch (err) {
    const status = err.status || 400;
    res.status(status).json({ code: status, message: err.message });
  }
});

router.post('/:id/cancel', authRequired, async (req, res) => {
  try {
    const data = await cancelReimbursement(Number(req.params.id), req.user.id);
    res.json({ code: 0, data });
  } catch (err) {
    res.status(400).json({ code: 400, message: err.message });
  }
});

router.post('/:id/reopen', authRequired, async (req, res) => {
  try {
    const data = await reopenRejectedReimbursement(Number(req.params.id), req.user.id);
    res.json({ code: 0, data });
  } catch (err) {
    res.status(400).json({ code: 400, message: err.message });
  }
});

router.delete('/:id', authRequired, async (req, res) => {
  try {
    const data = await deleteReimbursement(Number(req.params.id), req.user.id);
    res.json({ code: 0, data });
  } catch (err) {
    res.status(400).json({ code: 400, message: err.message });
  }
});

export default router;
