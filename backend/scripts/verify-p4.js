import { normalizeOaInstanceEvent, maskProcessCode, syncStatusLabel } from '../src/services/dingtalkOa.js';
import { buildReimbursementFormValues } from '../src/services/dingtalkNotify.js';
import { query, withTransaction, closePool } from '../src/db/pool.js';
import { simulateOaInstanceEvent } from '../src/services/approval.js';
import { getApprovalConfig, syncProcessCodeFromEnv } from '../src/services/sysConfig.js';
import { createReimbursement } from '../src/services/reimbursement.js';
import express from 'express';
import configRoutes from '../src/routes/config.js';

async function testNormalizePayload() {
  const streamMsg = {
    type: 'EVENT',
    headers: { eventType: 'bpms_instance_change', messageId: 'm1' },
    data: JSON.stringify({
      eventType: 'bpms_instance_change',
      data: {
        processInstanceId: 'inst-stream-001',
        type: 'finish',
        result: 'agree',
        processCode: 'PROC-TEST-001',
      },
    }),
  };
  const httpBody = {
    EventType: 'bpms_instance_change',
    processInstanceId: 'inst-http-001',
    type: 'finish',
    result: 'refuse',
  };
  const s = normalizeOaInstanceEvent(streamMsg);
  const h = normalizeOaInstanceEvent(httpBody);
  if (s.processInstanceId !== 'inst-stream-001' || s.type !== 'finish') {
    throw new Error('Stream payload normalize failed');
  }
  if (h.processInstanceId !== 'inst-http-001' || h.result !== 'refuse') {
    throw new Error('HTTP payload normalize failed');
  }
  console.log('[ok] normalizeOaInstanceEvent');
}

async function testFormValues() {
  const values = buildReimbursementFormValues(
    {
      billNo: 'RB202607010001',
      projectCode: 'HD-2026-001',
      projectName: '测试项目',
      reimburseAmount: 100,
      expenseDate: '2026-07-01',
      description: '说明',
      items: [{ costCategoryName: '劳务费' }],
    },
    { detailUrl: 'http://localhost:5173/h5/reimb/1', attachmentNames: ['发票.pdf'] },
  );
  const names = values.map((v) => v.name);
  const required = ['报销单号', '项目编号', '项目名称', '费用类型', '报销金额', '费用发生日期', '报销说明', '详情链接'];
  for (const n of required) {
    if (!names.includes(n)) throw new Error(`form missing field: ${n}`);
  }
  if (!values.find((v) => v.name.includes('凭证') || v.name.includes('附件'))) {
    throw new Error('attachment field missing');
  }
  console.log('[ok] buildReimbursementFormValues labels');
}

async function testMaskAndSyncLabel() {
  const masked = maskProcessCode('PROC-ABCDE-FGHI');
  if (!masked.includes('****')) throw new Error('maskProcessCode failed');
  if (syncStatusLabel('synced') !== '已发起') throw new Error('syncStatusLabel failed');
  console.log('[ok] maskProcessCode & syncStatusLabel');
}

async function testOaEventFlow() {
  const user = await query('SELECT id FROM user_account WHERE ding_user_id = :id LIMIT 1', { id: 'dev_user' });
  const project = await query('SELECT id FROM project WHERE code = :code LIMIT 1', { code: 'HD-2026-001' });
  const category = await query('SELECT id FROM cost_category LIMIT 1');
  if (!user[0] || !project[0] || !category[0]) {
    throw new Error('seed data missing, run npm run db:seed');
  }

  const reimb = await createReimbursement(user[0].id, {
    projectId: project[0].id,
    title: 'P4 OA 模拟验证',
    expenseDate: new Date().toISOString().slice(0, 10),
    items: [{ costCategoryId: category[0].id, amount: 88, taxAmount: 0, invoiceNo: `INV-P4-${Date.now()}` }],
  });

  const instanceId = `sim-inst-${reimb.id}-${Date.now()}`;
  await withTransaction(async (conn) => {
    await conn.query(
      `UPDATE reimbursement SET status = 'approving', approval_mode = 'B', submit_at = NOW() WHERE id = ?`,
      [reimb.id],
    );
    await conn.query(
      `INSERT INTO dingtalk_oa_mapping
       (reimbursement_id, process_code, process_instance_id, sync_status, originator_ding_user_id)
       VALUES (?, 'PROC-SIM', ?, 'synced', 'dev_user')`,
      [reimb.id, instanceId],
    );
  });

  let r = await simulateOaInstanceEvent({ processInstanceId: instanceId, type: 'start' });
  if (r.status !== 'approving') throw new Error('start event failed');

  r = await simulateOaInstanceEvent({ processInstanceId: instanceId, type: 'finish', result: 'agree' });
  if (r.status !== 'approved') throw new Error('finish agree failed');

  const statusRow = await query('SELECT status FROM reimbursement WHERE id = :id', { id: reimb.id });
  if (statusRow[0].status !== 'approved') throw new Error('reimb not approved');

  const ledger = await query(
    `SELECT COUNT(*) AS c FROM budget_ledger WHERE reimbursement_id = :id AND biz_type = 'occupy'`,
    { id: reimb.id },
  );
  if (Number(ledger[0].c) < 1) throw new Error('budget occupy missing');

  r = await simulateOaInstanceEvent({ reimbursementId: reimb.id, type: 'finish', result: 'agree' });
  if (!r.duplicate) console.log('[ok] duplicate finish handled (or first pass)');

  // reject flow
  const reimb2 = await createReimbursement(user[0].id, {
    projectId: project[0].id,
    title: 'P4 OA 驳回验证',
    expenseDate: new Date().toISOString().slice(0, 10),
    items: [{ costCategoryId: category[0].id, amount: 50, taxAmount: 0, invoiceNo: `INV-P4-R-${Date.now()}` }],
  });
  const instanceId2 = `sim-inst-${reimb2.id}-${Date.now()}`;
  await query(
    `INSERT INTO dingtalk_oa_mapping (reimbursement_id, process_code, process_instance_id, sync_status)
     VALUES (:id, 'PROC-SIM', :inst, 'synced')`,
    { id: reimb2.id, inst: instanceId2 },
  );
  await query(`UPDATE reimbursement SET status = 'approving', approval_mode = 'B' WHERE id = :id`, { id: reimb2.id });
  r = await simulateOaInstanceEvent({ processInstanceId: instanceId2, type: 'finish', result: 'refuse' });
  if (r.status !== 'rejected') throw new Error('finish refuse failed');
  console.log('[ok] OA event agree/refuse simulation');

  // cleanup
  for (const rid of [reimb.id, reimb2.id]) {
    await query('DELETE FROM budget_ledger WHERE reimbursement_id = :id', { id: rid });
    await query('DELETE FROM dingtalk_oa_mapping WHERE reimbursement_id = :id', { id: rid });
    await query('DELETE FROM reimbursement_item WHERE reimbursement_id = :id', { id: rid });
    await query('DELETE FROM reimbursement WHERE id = :id', { id: rid });
  }
}

async function testConfigApi() {
  const app = express();
  app.use('/api/config', configRoutes);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/config/approval`);
    const json = await res.json();
    if (json.code !== 0 || !json.data?.mode) throw new Error('config/approval API failed');
    console.log('[ok] GET /api/config/approval mode=', json.data.mode);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

async function testSyncProcessCode() {
  const prev = process.env.DINGTALK_PROCESS_CODE;
  process.env.DINGTALK_PROCESS_CODE = 'PROC-VERIFY-TEST-CODE';
  await syncProcessCodeFromEnv();
  const cfg = await getApprovalConfig();
  if (!cfg.processCodeConfigured) throw new Error('processCode sync failed');
  if (process.env.DINGTALK_PROCESS_CODE) {
    await query(`UPDATE sys_config SET config_value = '' WHERE config_key = 'dingtalk.process_code'`);
  }
  if (prev) process.env.DINGTALK_PROCESS_CODE = prev;
  else delete process.env.DINGTALK_PROCESS_CODE;
  console.log('[ok] syncProcessCodeFromEnv');
}

async function main() {
  await testNormalizePayload();
  await testFormValues();
  await testMaskAndSyncLabel();
  await testSyncProcessCode();
  await testConfigApi();
  await testOaEventFlow();
  console.log('[verify-p4] all passed');
}

main()
  .then(async () => {
    await closePool();
  })
  .catch(async (err) => {
    console.error('[verify-p4] failed:', err.message);
    try {
      await closePool();
    } catch {
      /* ignore */
    }
    process.exit(1);
  });
