import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query } from '../db/pool.js';

export function signToken(payload) {
  return jwt.sign(payload, config.jwt.secret, { expiresIn: config.jwt.expiresIn });
}

async function verifyReimbTokenVersion(payload) {
  const reimbUserId = payload.reimbUserId || payload.id || Number(payload.sub);
  if (!reimbUserId) return;
  const rows = await query(
    'SELECT COALESCE(token_version, 1) AS tv FROM user_account WHERE id = :id LIMIT 1',
    { id: reimbUserId },
  );
  const tv = rows[0]?.tv ?? 1;
  if (Number(payload.reimbTv ?? 1) !== Number(tv)) {
    throw Object.assign(new Error('登录已失效，请重新登录'), { code: 'token_version' });
  }
}

export function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ code: 401, message: '未登录' });
  }

  (async () => {
    try {
      const payload = jwt.verify(token, config.jwt.secret);
      await verifyReimbTokenVersion(payload);
      req.user = {
        ...payload,
        id: payload.reimbUserId || payload.id || Number(payload.sub),
      };
      next();
    } catch (err) {
      const msg = err.code === 'token_version' ? err.message : '登录已过期，请重新进入应用';
      res.status(401).json({ code: 401, message: msg });
    }
  })();
}
