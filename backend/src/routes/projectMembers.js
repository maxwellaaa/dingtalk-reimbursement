import { Router } from 'express';
import { authRequired } from '../middleware/auth.js';
import {
  addProjectMember,
  batchAddProjectMembers,
  batchRemoveProjectMembers,
  copyProjectMembers,
  exportProjectMembersWorkbook,
  getMembershipSummary,
  joinProjects,
  leaveProject,
  listManageableProjects,
  listMyJoinedProjects,
  listProjectMemberAudit,
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

router.get('/projects/:id/members/export', authRequired, async (req, res) => {
  try {
    const { buffer, filename } = await exportProjectMembersWorkbook(
      req.user.id,
      Number(req.params.id),
    );
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.send(Buffer.from(buffer));
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ code: status, message: err.message });
  }
});

router.get('/projects/:id/members/audit', authRequired, async (req, res) => {
  try {
    const list = await listProjectMemberAudit(
      req.user.id,
      Number(req.params.id),
      req.query.limit,
    );
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
    const projectId = Number(req.params.id);
    if (Array.isArray(req.body?.userIds) && req.body.userIds.length) {
      const data = await batchAddProjectMembers(req.user.id, projectId, req.body.userIds);
      return res.json({ code: 0, data });
    }
    const list = await addProjectMember(req.user.id, projectId, req.body?.userId);
    res.json({ code: 0, data: { list } });
  } catch (err) {
    const status = err.status || 400;
    res.status(status).json({ code: status, message: err.message });
  }
});

router.post('/projects/:id/members/batch-remove', authRequired, async (req, res) => {
  try {
    const data = await batchRemoveProjectMembers(
      req.user.id,
      Number(req.params.id),
      req.body?.userIds || [],
    );
    res.json({ code: 0, data });
  } catch (err) {
    const status = err.status || 400;
    res.status(status).json({ code: status, message: err.message });
  }
});

router.post('/projects/:id/members/copy-from', authRequired, async (req, res) => {
  try {
    const data = await copyProjectMembers(
      req.user.id,
      req.body?.sourceProjectId,
      Number(req.params.id),
    );
    res.json({ code: 0, data });
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
