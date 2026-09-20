import { query } from '../db/pool.js';

export async function upsertUserFromDingTalk(profile) {
  const dingUserId = profile.userId;
  if (!dingUserId) throw new Error('缺少 ding userId');

  await query(
    `INSERT INTO user_account (ding_user_id, ding_union_id, name, mobile, title, synced_at)
     VALUES (:dingUserId, :unionId, :name, :mobile, :title, NOW())
     ON DUPLICATE KEY UPDATE
       ding_union_id = VALUES(ding_union_id),
       name = VALUES(name),
       mobile = VALUES(mobile),
       title = VALUES(title),
       synced_at = NOW()`,
    {
      dingUserId,
      unionId: profile.unionId || null,
      name: profile.name || dingUserId,
      mobile: profile.mobile || null,
      title: profile.title || null,
    },
  );

  const rows = await query(
    'SELECT id, ding_user_id AS dingUserId, ding_union_id AS unionId, name, mobile, title FROM user_account WHERE ding_user_id = :dingUserId LIMIT 1',
    { dingUserId },
  );
  return rows[0];
}

export async function getUserById(id) {
  const rows = await query(
    `SELECT id, ding_user_id AS dingUserId, name, mobile, title, bank_account AS bankAccount, bank_name AS bankName
     FROM user_account WHERE id = :id AND status = 1 LIMIT 1`,
    { id },
  );
  return rows[0] || null;
}

export async function ensureDevUser() {
  return upsertUserFromDingTalk({
    userId: 'dev_user',
    unionId: 'dev_union',
    name: '开发测试员',
    mobile: '13800000000',
    title: '测试岗位',
  });
}
