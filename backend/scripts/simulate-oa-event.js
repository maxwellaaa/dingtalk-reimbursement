#!/usr/bin/env node
/**
 * 开发环境模拟钉钉 OA bpms_instance_change 事件
 *
 * 用法：
 *   node scripts/simulate-oa-event.js --reimbId=1 --type=finish --result=agree
 *   node scripts/simulate-oa-event.js --instanceId=xxx --type=terminate
 *   node scripts/simulate-oa-event.js --reimbId=1 --type=finish --result=refuse --url=http://localhost:3000
 */
import { simulateOaInstanceEvent } from '../src/services/approval.js';

function parseArgs(argv) {
  const opts = {};
  for (const arg of argv) {
    const m = arg.match(/^--(\w+)=(.+)$/);
    if (m) opts[m[1]] = m[2];
  }
  return opts;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const reimbId = args.reimbId ? Number(args.reimbId) : undefined;
  const instanceId = args.instanceId || args.processInstanceId;
  const type = args.type;
  const result = args.result;
  const baseUrl = args.url || process.env.API_BASE || 'http://localhost:3000';

  if (!type) {
    console.error('用法: node scripts/simulate-oa-event.js --reimbId=1 --type=finish --result=agree');
    process.exit(1);
  }

  if (args.http === 'true' || args.http === '1') {
    const body = {
      reimbursementId: reimbId,
      processInstanceId: instanceId,
      type,
      result,
    };
    const headers = { 'Content-Type': 'application/json' };
    if (process.env.WEBHOOK_SECRET) {
      headers['x-webhook-secret'] = process.env.WEBHOOK_SECRET;
    }
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/approvals/webhooks/oa-instance`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    const data = await res.json();
    console.log('[simulate-http]', res.status, JSON.stringify(data, null, 2));
    if (!res.ok) process.exit(1);
    return;
  }

  const data = await simulateOaInstanceEvent({
    reimbursementId: reimbId,
    processInstanceId: instanceId,
    type,
    result,
  });
  console.log('[simulate]', JSON.stringify(data, null, 2));
}

main().catch((err) => {
  console.error('[simulate] failed:', err.message);
  process.exit(1);
});
