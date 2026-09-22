import { Router } from 'express';
import { authRequired } from '../middleware/auth.js';
import {
  assignRole,
  assertCanManageRoles,
  dedupeUserRoles,
  getUserRolesDetail,
  listAdminMeta,
  revokeRole,
  searchUsers,
} from '../services/roleAdmin.js';

const router = Router();

router.use(authRequired);

router.use(async (req, res, next) => {
  try {
    await assertCanManageRoles(req.user.id);
    next();
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ code: status, message: err.message });
  }
});

router.get('/meta', async (_req, res) => {
  try {
    const data = await listAdminMeta();
    res.json({ code: 0, data });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

router.get('/users', async (req, res) => {
  try {
    const data = await searchUsers({
      q: req.query.q,
      page: req.query.page,
      pageSize: req.query.pageSize,
    });
    res.json({ code: 0, data });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

router.get('/users/:id/roles', async (req, res) => {
  try {
    const data = await getUserRolesDetail(Number(req.params.id));
    res.json({ code: 0, data });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ code: status, message: err.message });
  }
});

router.post('/users/:id/roles/dedupe', async (req, res) => {
  try {
    const userId = Number(req.params.id);
    const result = await dedupeUserRoles(userId);
    const data = await getUserRolesDetail(userId);
    res.json({ code: 0, data: { ...result, ...data } });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ code: status, message: err.message });
  }
});

router.post('/users/:id/roles', async (req, res) => {
  try {
    const data = await assignRole(req.user.id, Number(req.params.id), req.body || {});
    res.json({ code: 0, data });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ code: status, message: err.message });
  }
});

router.delete('/roles/:roleId', async (req, res) => {
  try {
    const data = await revokeRole(req.user.id, Number(req.params.roleId));
    res.json({ code: 0, data });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ code: status, message: err.message });
  }
});

export default router;
