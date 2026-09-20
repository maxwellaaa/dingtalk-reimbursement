/**
 * P0–P2 HTTP smoke against running backend (default :3000)
 */
const BASE = process.env.API_BASE || 'http://localhost:3000';

async function req(method, path, { token, body, formData } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const opts = { method, headers };
  if (formData) {
    opts.body = formData;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, opts);
  const ct = res.headers.get('content-type') || '';
  let data = null;
  if (ct.includes('json')) data = await res.json();
  else if (ct.includes('text')) data = await res.text();
  return { status: res.status, data, ct };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const results = [];

  // P0
  const health = await req('GET', '/api/health');
  assert(health.status === 200 && health.data?.ok, 'health failed');
  assert(health.data?.db === true, 'health db=false');
  results.push(['P0 GET /api/health', 'pass', `phase=${health.data?.phase}`]);

  const devLogin = await req('POST', '/api/auth/dev-login', { body: {} });
  assert(devLogin.status === 200 && devLogin.data?.code === 0, 'dev-login applicant failed');
  const token = devLogin.data.data.token;
  results.push(['P0 POST /api/auth/dev-login (applicant)', 'pass', devLogin.data.data.user.name]);

  const mgrLogin = await req('POST', '/api/auth/dev-login', { body: { role: 'manager' } });
  assert(mgrLogin.status === 200 && mgrLogin.data?.code === 0, 'dev-login manager failed');
  const mgrToken = mgrLogin.data.data.token;
  results.push(['P0 POST /api/auth/dev-login (manager)', 'pass', mgrLogin.data.data.user.name]);

  const me = await req('GET', '/api/auth/me', { token });
  assert(me.status === 200 && me.data?.data?.user?.name, 'auth/me failed');
  assert(me.data?.data?.user?.access?.scopeLabel, 'auth/me missing access.scopeLabel');
  results.push(['P0 GET /api/auth/me', 'pass', me.data.data.user.access.scopeLabel]);

  const authCfg = await req('GET', '/api/auth/config');
  assert(authCfg.status === 200 && authCfg.data?.data?.corpId, 'auth/config failed');
  results.push(['P0 GET /api/auth/config', 'pass', 'corpId present']);

  // 填单用 apply 拿全量项目；默认 view 仅成员可见
  const projectsApply = await req('GET', '/api/projects?mode=apply', { token });
  assert(projectsApply.status === 200 && projectsApply.data?.data?.list?.length > 0, 'projects apply failed');
  const projectId = projectsApply.data.data.list.find((p) => p.code === 'HD-2026-001')?.id
    || projectsApply.data.data.list[0].id;
  results.push(['P1 GET /api/projects?mode=apply', 'pass', `${projectsApply.data.data.list.length} projects`]);

  const projects = await req('GET', '/api/projects', { token });
  assert(projects.status === 200 && projects.data?.data?.list?.length > 0, 'projects view failed');
  results.push(['P1 GET /api/projects', 'pass', `${projects.data.data.list.length} visible`]);

  const cats = await req('GET', '/api/cost-categories', { token });
  assert(cats.status === 200 && cats.data?.data?.list?.length > 0, 'cost-categories failed');
  const catId = cats.data.data.list[0].id;
  results.push(['P1 GET /api/cost-categories', 'pass', `${cats.data.data.list.length} categories`]);

  // P1 CRUD
  const create = await req('POST', '/api/reimbursements', {
    token,
    body: {
      projectId,
      title: 'E2E smoke',
      expenseDate: new Date().toISOString().slice(0, 10),
      items: [{ costCategoryId: catId, amount: 10, taxAmount: 0, invoiceNo: `INV-E2E-${Date.now()}` }],
    },
  });
  assert(create.status === 200 && create.data?.data?.id, 'create reimb failed');
  const reimbId = create.data.data.id;
  results.push(['P1 POST /api/reimbursements', 'pass', create.data.data.billNo]);

  const getOne = await req('GET', `/api/reimbursements/${reimbId}`, { token });
  assert(getOne.status === 200 && getOne.data?.data?.id === reimbId, 'get reimb failed');
  results.push(['P1 GET /api/reimbursements/:id', 'pass', getOne.data.data.status]);

  const update = await req('PUT', `/api/reimbursements/${reimbId}`, {
    token,
    body: {
      projectId,
      title: 'E2E smoke updated',
      expenseDate: new Date().toISOString().slice(0, 10),
      items: [{
        costCategoryId: catId,
        amount: 10,
        taxAmount: 0,
        invoiceNo: create.data.data.items?.[0]?.invoiceNo || `INV-E2E-${Date.now()}`,
      }],
    },
  });
  assert(update.status === 200 && update.data?.data?.title, `update reimb failed: ${JSON.stringify(update.data)}`);
  results.push(['P1 PUT /api/reimbursements/:id', 'pass', update.data.data.title]);

  const list = await req('GET', '/api/reimbursements', { token });
  assert(list.status === 200 && list.data?.data?.list?.some((r) => r.id === reimbId), 'list reimb failed');
  results.push(['P1 GET /api/reimbursements', 'pass', `total=${list.data.data.total}`]);

  // file upload
  const fd = new FormData();
  fd.append('file', new Blob(['test pdf content'], { type: 'application/pdf' }), 'e2e-test.pdf');
  const upload = await req('POST', '/api/files', { token, formData: fd });
  assert(upload.status === 200 && upload.data?.data?.id, 'file upload failed');
  const fileId = upload.data.data.id;
  results.push(['P1 POST /api/files', 'pass', `fileId=${fileId}`]);

  const fileGet = await req('GET', `/api/files/${fileId}`, { token });
  assert(fileGet.status === 200, 'file download failed');
  results.push(['P1 GET /api/files/:id', 'pass', fileGet.ct]);

  // P2 submit & approval（按项目自动审批人）
  const path = await req('GET', `/api/approvals/project-path?reimbursementId=${reimbId}`, { token });
  assert(path.status === 200 && path.data?.data?.canSubmit, `project-path failed: ${JSON.stringify(path.data)}`);
  results.push(['P2 GET /api/approvals/project-path', 'pass', `pm=${path.data.data.pm?.name}`]);

  const submit = await req('POST', `/api/reimbursements/${reimbId}/submit`, {
    token,
    body: {},
  });
  assert(submit.status === 200, `submit failed: ${JSON.stringify(submit.data)}`);
  results.push(['P2 POST /api/reimbursements/:id/submit', 'pass', submit.data.data.status]);

  const tasks = await req('GET', '/api/approvals/tasks', { token: mgrToken });
  assert(tasks.status === 200, 'approval tasks failed');
  const task = tasks.data?.data?.list?.find((t) => t.reimbursementId === reimbId);
  assert(task, 'manager task not found');
  results.push(['P2 GET /api/approvals/tasks', 'pass', `pending=${tasks.data.data.list.length}`]);

  const timeline = await req('GET', `/api/approvals/reimbursements/${reimbId}/timeline`, { token });
  assert(timeline.status === 200, 'timeline failed');
  results.push(['P2 GET approval timeline', 'pass', `steps=${timeline.data?.data?.steps?.length ?? 'n/a'}`]);

  const action = await req('POST', `/api/approvals/tasks/${task.taskId}/action`, {
    token: mgrToken,
    body: { action: 'approve', comment: 'E2E ok' },
  });
  assert(action.status === 200, `approve action failed: ${JSON.stringify(action.data)}`);
  results.push(['P2 POST /api/approvals/tasks/:id/action', 'pass', 'approve']);

  // P3 extras via HTTP
  const preview = await req('GET', `/api/budget/preview?projectId=${projectId}&costCategoryId=${catId}&amount=10`, { token });
  assert(preview.status === 200, 'budget preview failed');
  results.push(['P3 GET /api/budget/preview', 'pass', `strict=${preview.data?.data?.strict}`]);

  const invCheck = await req('GET', `/api/invoices/check?no=INV-NONE`, { token });
  assert(invCheck.status === 200, 'invoice check failed');
  results.push(['P3 GET /api/invoices/check', 'pass', `dup=${invCheck.data?.data?.duplicate}`]);

  const dash = await req('GET', `/api/projects/${projectId}/dashboard`, { token: mgrToken });
  assert(dash.status === 200, `dashboard failed: ${JSON.stringify(dash.data)}`);
  results.push(['P3 GET /api/projects/:id/dashboard', 'pass', `budgets=${dash.data?.data?.budgets?.length}`]);

  const summary = await req('GET', '/api/reports/summary', { token });
  assert(summary.status === 200, 'reports summary failed');
  results.push(['P3 GET /api/reports/summary', 'pass', `count=${summary.data?.data?.totalCount}`]);

  const usage = await req('GET', '/api/api-usage', { token });
  assert(usage.status === 200, 'api-usage failed');
  results.push(['P3 GET /api/api-usage', 'pass', 'ok']);

  const approvalCfg = await req('GET', '/api/config/approval');
  assert(approvalCfg.status === 200 && approvalCfg.data?.data?.mode, 'config/approval failed');
  results.push(['P4 GET /api/config/approval', 'pass', `mode=${approvalCfg.data.data.mode}`]);

  const whStatus = await req('GET', '/api/webhooks/dingtalk/oa/status');
  assert(whStatus.status === 200, 'webhook status failed');
  results.push(['P4 GET /api/webhooks/dingtalk/oa/status', 'pass', whStatus.data?.data?.callbackPath]);

  const whGet = await req('GET', '/api/webhooks/dingtalk/oa');
  assert(whGet.status === 200, 'webhook GET failed');
  results.push(['P4 GET /api/webhooks/dingtalk/oa', 'pass', String(whGet.data).slice(0, 20)]);

  // cleanup: cancel if submitted, else delete as applicant
  const after = await req('GET', `/api/reimbursements/${reimbId}`, { token });
  if (after.data?.data?.status === 'draft') {
    await req('DELETE', `/api/reimbursements/${reimbId}`, { token });
  }

  console.log('=== E2E Smoke Results ===');
  for (const [feature, status, notes] of results) {
    console.log(`${status.toUpperCase().padEnd(4)} | ${feature} | ${notes}`);
  }
  console.log(`\n[verify-e2e-smoke] ${results.length} checks passed`);
}

main()
  .then(() => undefined)
  .catch((err) => {
    console.error('[verify-e2e-smoke] FAILED:', err.message);
    process.exit(1);
  });
