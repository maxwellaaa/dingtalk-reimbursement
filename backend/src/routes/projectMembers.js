import { Router } from 'express';
import { authRequired } from '../middleware/auth.js';
import {
  addProjectMember,
  getMembershipSummary,
  joinProjects,
  leaveProject,
  listManageableProjects,
  listMyJoinedProjects,
  listProjectMembers,
  removeProjectMember,
  searchUsersForMember,
} from '../services/projectMember.js';

const router = Router();

router.get('/me/projects', authRequired, async (req, res) => {
  try {
    const list = await listMyJoinedProjects(req.user.id);
    const membership = await getMembershipSummary(req.user.id);
    res.json({ code: 0, data: { list, membership } });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

router.get('/me/membership', authRequired, async (req, res) => {
  try {
    const data = await getMembershipSummary(req.user.id);
    res.json({ code: 0, data });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

router.post('/me/projects/join', authRequired, async (req, res) => {
  try {
    const data = await joinProjects(req.user.id, req.body?.projectIds || [], { source: 'self' });
    res.json({ code: 0, data });
  } catch (err) {
    const status = err.status || 400;
    res.status(status).json({ code: status, message: err.message });
  }
});

router.delete('/me/projects/:projectId', authRequired, async (req, res) => {
  try {
    const data = await leaveProject(req.user.id, Number(req.params.projectId));
    res.json({ code: 0, data });
  } catch (err) {
    const status = err.status || 400;
    res.status(status).json({ code: status, message: err.message });
  }
});

router.get('/projects/manageable', authRequired, async (req, res) => {
  try {
    const list = await listManageableProjects(req.user.id);
    res.json({ code: 0, data: { list } });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

router.get('/projects/:id/members', authRequired, async (req, res) => {
  try {
    const list = await listProjectMembers(req.user.id, Number(req.params.id));
    res.json({ code: 0, data: { list } });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ code: status, message: err.message });
  }
});

router.get('/projects/:id/member-candidates', authRequired, async (req, res) => {
  try {
    const list = await searchUsersForMember(req.user.id, Number(req.params.id), req.query.q);
    res.json({ code: 0, data: { list } });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ code: status, message: err.message });
  }
});

router.post('/projects/:id/members', authRequired, async (req, res) => {
  try {
    const list = await addProjectMember(req.user.id, Number(req.params.id), req.body?.userId);
    res.json({ code: 0, data: { list } });
  } catch (err) {
    const status = err.status || 400;
    res.status(status).json({ code: status, message: err.message });
  }
});

router.delete('/projects/:id/members/:userId', authRequired, async (req, res) => {
  try {
    const list = await removeProjectMember(
      req.user.id,
      Number(req.params.id),
      Number(req.params.userId),
    );
    res.json({ code: 0, data: { list } });
  } catch (err) {
    const status = err.status || 400;
    res.status(status).json({ code: status, message: err.message });
  }
});

export default router;
