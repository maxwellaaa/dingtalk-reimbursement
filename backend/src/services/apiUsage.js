import { query } from '../db/pool.js';

export async function trackApiUsage(apiName) {
  const statMonth = new Date().toISOString().slice(0, 7);
  await query(
    `INSERT INTO dingtalk_api_usage (stat_month, api_name, call_count)
     VALUES (:statMonth, :apiName, 1)
     ON DUPLICATE KEY UPDATE call_count = call_count + 1`,
    { statMonth, apiName },
  );
}

export async function listApiUsage({ month } = {}) {
  const statMonth = month || new Date().toISOString().slice(0, 7);
  const rows = await query(
    `SELECT api_name AS apiName, call_count AS callCount, updated_at AS updatedAt
     FROM dingtalk_api_usage
     WHERE stat_month = :statMonth
     ORDER BY call_count DESC, api_name ASC`,
    { statMonth },
  );
  const total = rows.reduce((sum, row) => sum + Number(row.callCount), 0);
  return { statMonth, total, list: rows };
}
