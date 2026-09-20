/**
 * P4 HTTP webhook smoke: POST /api/approvals/webhooks/oa-instance
 */
import { query, withTransaction, closePool } from '../src/db/pool.js';
import { createReimbursement } from '../src/services/reimbursement.js';

const BASE = process.env.API_BASE || 'http://localhost:3000';

async function main() {
  const user = await query('SELECT id FROM user_account WHERE ding_user_id = :id LIMIT 1', { id: 'dev_user' });
  const project = await query('SELECT id FROM project WHERE code = :code LIMIT 1', { code: 'HD-2026-001' });
  const category = await query('SELECT id FROM cost_category LIMIT 1');
  if (!user[0] || !project[0] || !category[0]) throw new Error('seed data missing');

  const reimb = await createReimbursement(user[0].id, {
    projectId: project[0].id,
    title: 'P4 HTTP webhook 验证',
    expenseDate: new Date().toISOString().slice(0, 10),
    items: [{ costCategoryId: category[0].id, amount: 12, taxAmount: 0, invoiceNo: `INV-P4HTTP-${Date.now()}` }],
  });

  const instanceId = `http-inst-${reimb.id}-${Date.now()}`;
  await withTransaction(async (conn) => {
    await conn.query(`UPDATE reimbursement SET status = 'approving', approval_mode = 'B' WHERE id = ?`, [reimb.id]);
    await conn.query(
      `INSERT INTO dingtalk_oa_mapping (reimbursement_id, process_code, process_instance_id, sync_status)
       VALUES (?, 'PROC-SIM', ?, 'synced')`,
      [reimb.id, instanceId],
    );
  });

  const res = await fetch(`${BASE}/api/approvals/webhooks/oa-instance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ processInstanceId: instanceId, type: 'finish', result: 'agree' }),
  });
  const data = await res.json();
  if (res.status !== 200 || data.code !== 0) {
    throw new Error(`HTTP webhook failed: ${res.status} ${JSON.stringify(data)}`);
  }
  console.log('[ok] POST /api/approvals/webhooks/oa-instance', data.data?.status);

  const whRes = await fetch(`${BASE}/api/webhooks/dingtalk/oa`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ processInstanceId: instanceId, type: 'finish', result: 'agree' }),
  });
  const whData = await whRes.json();
  if (whRes.status !== 200) {
    throw new Error(`dingtalk/oa webhook failed: ${whRes.status}`);
  }
  console.log('[ok] POST /api/webhooks/dingtalk/oa', whData.message || whData.code);

  await query('DELETE FROM budget_ledger WHERE reimbursement_id = :id', { id: reimb.id });
  await query('DELETE FROM dingtalk_oa_mapping WHERE reimbursement_id = :id', { id: reimb.id });
  await query('DELETE FROM reimbursement_item WHERE reimbursement_id = :id', { id: reimb.id });
  await query('DELETE FROM reimbursement WHERE id = :id', { id: reimb.id });
  console.log('[verify-p4-http] all passed');
}

main()
  .then(async () => {
    await closePool();
  })
  .catch(async (err) => {
    console.error('[verify-p4-http] failed:', err.message);
    try {
      await closePool();
    } catch {
      /* ignore */
    }
    process.exit(1);
  });
