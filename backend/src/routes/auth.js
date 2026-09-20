import { Router } from 'express';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { authRequired, signToken } from '../middleware/auth.js';
import { buildJsConfig, getUserDetail, getUserInfoByAuthCode } from '../services/dingtalk.js';
import { ensureDevUser, upsertUserFromDingTalk } from '../services/user.js';
import { getUserAccessProfile } from '../services/accessScope.js';
import { getMembershipSummary, listManageableProjects } from '../services/projectMember.js';

const router = Router();

/** 开发身份 → ding_user_id */
const DEV_ROLE_MAP = {
  employee: 'dev_user',
  applicant: 'dev_user',
  manager: 'dev_manager',
  'pm:A': 'dev_manager',
  'pm:a': 'dev_manager',
  'project_manager:A': 'dev_manager',
  'pm:B': 'dev_pm_b',
  'pm:b': 'dev_pm_b',
  'pm:C': 'dev_pm_c',
  'pm:c': 'dev_pm_c',
  'finance:A': 'dev_finance_a',
  'finance:a': 'dev_finance_a',
  'finance:B': 'dev_finance_b',
  'finance:b': 'dev_finance_b',
  'finance:C': 'dev_finance_c',
  'finance:c': 'dev_finance_c',
  'gm:A': 'dev_gm_a',
  'gm:a': 'dev_gm_a',
  'gm:B': 'dev_gm_b',
  'gm:b': 'dev_gm_b',
  'gm:C': 'dev_gm_c',
  'gm:c': 'dev_gm_c',
};

async function tokenResponse(user) {
  const access = await getUserAccessProfile(user.id);
  const membership = await getMembershipSummary(user.id);
  const manageable = await listManageableProjects(user.id);
  access.canManageProjectMembers = manageable.length > 0;
  const token = signToken({
    id: user.id,
    dingUserId: user.dingUserId,
    name: user.name,
  });
  return {
    token,
    user: {
      id: user.id,
      userId: user.dingUserId,
      unionId: user.unionId,
      name: user.name,
      mobile: user.mobile,
      title: user.title,
      bankAccount: user.bankAccount,
      bankName: user.bankName,
      access,
    },
    membership,
  };
}

/**
 * GET /api/auth/js-config?url=当前页完整URL（不含#）
 * 供前端 dd.config 鉴权
 */
router.get('/js-config', async (req, res) => {
  try {
    const pageUrl = String(req.query.url || '');
    if (!pageUrl) {
      return res.status(400).json({ code: 400, message: '缺少 url 参数' });
    }
    const jsConfig = await buildJsConfig(pageUrl);
    res.json({ code: 0, data: jsConfig });
  } catch (err) {
    console.error('[js-config]', err);
    res.status(500).json({ code: 500, message: err.message || 'JSAPI 配置失败' });
  }
});

/**
 * POST /api/auth/login
 * body: { authCode: string }
 */
router.post('/login', async (req, res) => {
  try {
    const { authCode } = req.body || {};
    if (!authCode) {
      return res.status(400).json({ code: 400, message: '缺少 authCode' });
    }

    const basic = await getUserInfoByAuthCode(authCode);
    let profile = basic;

    try {
      profile = await getUserDetail(basic.userId);
    } catch (detailErr) {
      console.warn('[login] getUserDetail fallback:', detailErr.message);
    }

    const user = await upsertUserFromDingTalk(profile);

    res.json({
      code: 0,
      data: await tokenResponse(user),
    });
  } catch (err) {
    console.error('[login]', err);
    res.status(500).json({ code: 500, message: err.message || '登录失败' });
  }
});

/** GET /api/auth/me — 当前登录用户 + 可见范围 */
router.get('/me', authRequired, async (req, res) => {
  try {
    const access = await getUserAccessProfile(req.user.id);
    const membership = await getMembershipSummary(req.user.id);
    const manageable = await listManageableProjects(req.user.id);
    access.canManageProjectMembers = manageable.length > 0;
    res.json({
      code: 0,
      data: {
        user: {
          id: req.user.id,
          userId: req.user.dingUserId,
          name: req.user.name,
          access,
        },
        membership,
      },
    });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

/**
 * POST /api/auth/confirm-identity — 后台确认当前登录身份与可见范围
 * 写入审计日志，返回完整 access 供前端展示
 */
router.post('/confirm-identity', authRequired, async (req, res) => {
  try {
    const access = await getUserAccessProfile(req.user.id);
    const confirmedAt = new Date().toISOString();
    await query(
      `INSERT INTO sys_audit_log (user_id, action, biz_type, detail_json)
       VALUES (:userId, 'confirm_identity', 'auth', :detail)`,
      {
        userId: req.user.id,
        detail: JSON.stringify({
          confirmedAt,
          primaryRole: access.primaryRole,
          primaryGrade: access.primaryGrade,
          scopeLevel: access.scopeLevel,
          scopeLabel: access.scopeLabel,
          projectIds: access.projectIds,
          clientNote: req.body?.note || null,
        }),
      },
    );
    res.json({
      code: 0,
      data: {
        confirmedAt,
        user: {
          id: req.user.id,
          userId: req.user.dingUserId,
          name: req.user.name,
          access,
        },
        message: '身份已确认',
      },
    });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

/**
 * POST /api/auth/dev-login — 仅开发环境
 * body: { role?: 'employee'|'manager'|'pm:A'|'pm:B'|'pm:C'|'finance:A'|'finance:B'|'finance:C'|'gm:A'|'gm:B'|'gm:C' }
 */
router.post('/dev-login', async (req, res) => {
  if (config.nodeEnv === 'production') {
    return res.status(403).json({ code: 403, message: '生产环境不可用' });
  }
  try {
    const role = String(req.body?.role || 'employee');
    const dingUserId = DEV_ROLE_MAP[role];
    if (!dingUserId) {
      return res.status(400).json({
        code: 400,
        message: `未知 role，可选: ${Object.keys(DEV_ROLE_MAP).filter((k) => !k.includes(':a') && !k.includes(':b') && !k.includes(':c')).join(', ')}`,
      });
    }

    let user;
    if (dingUserId === 'dev_user') {
      user = await ensureDevUser();
    } else {
      const rows = await query(
        `SELECT id, ding_user_id AS dingUserId, ding_union_id AS unionId, name, mobile, title
         FROM user_account WHERE ding_user_id = :dingUserId LIMIT 1`,
        { dingUserId },
      );
      user = rows[0];
      if (!user) {
        return res.status(404).json({
          code: 404,
          message: `用户 ${dingUserId} 不存在，请先执行 npm run db:seed`,
        });
      }
    }
    res.json({ code: 0, data: await tokenResponse(user) });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

/** GET /api/auth/config — 前端需要的公开配置 */
router.get('/config', (_req, res) => {
  res.json({
    code: 0,
    data: {
      corpId: config.dingtalk.corpId,
      agentId: config.dingtalk.agentId,
      clientId: config.dingtalk.appKey,
    },
  });
});

export default router;
