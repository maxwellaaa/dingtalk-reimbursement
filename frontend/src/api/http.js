const TOKEN_KEY = 'reimb_token';

const USER_KEY = 'reimb_user';



export function getToken() {

  return localStorage.getItem(TOKEN_KEY);

}



export function setSession(token, user) {

  localStorage.setItem(TOKEN_KEY, token);

  localStorage.setItem(USER_KEY, JSON.stringify(user));

}



export function clearSession() {

  localStorage.removeItem(TOKEN_KEY);

  localStorage.removeItem(USER_KEY);

}



export function getStoredUser() {

  const raw = localStorage.getItem(USER_KEY);

  if (!raw) return null;

  try {

    return JSON.parse(raw);

  } catch {

    return null;

  }

}



async function request(path, options = {}) {

  const isForm = options.body instanceof FormData;

  const headers = { ...(options.headers || {}) };

  if (!isForm) {

    headers['Content-Type'] = 'application/json';

  }

  const token = getToken();

  if (token) {

    headers.Authorization = `Bearer ${token}`;

  }



  const res = await fetch(path, { ...options, headers });

  const data = await res.json().catch(() => ({}));



  if (!res.ok || (data.code !== undefined && data.code !== 0)) {
    const detail = data.message || data.errmsg || data.error || '';
    throw new Error(detail ? `${detail}（HTTP ${res.status}）` : `请求失败（HTTP ${res.status}）`);
  }

  return data.data;

}



async function download(path, options = {}) {

  const headers = { ...(options.headers || {}) };

  const token = getToken();

  if (token) {

    headers.Authorization = `Bearer ${token}`;

  }

  const res = await fetch(path, { ...options, headers });

  if (!res.ok) {

    const data = await res.json().catch(() => ({}));

    throw new Error(data.message || `下载失败 (${res.status})`);

  }

  return res;

}



export const api = {

  getJsConfig(url) {

    return request(`/api/auth/js-config?url=${encodeURIComponent(url)}`);

  },

  login(authCode) {

    return request('/api/auth/login', {

      method: 'POST',

      body: JSON.stringify({ authCode }),

    });

  },

  devLogin(role) {

    return request('/api/auth/dev-login', {

      method: 'POST',

      body: JSON.stringify(role ? { role } : {}),

    });

  },

  me() {

    return request('/api/auth/me');

  },

  confirmIdentity(note) {

    return request('/api/auth/confirm-identity', {

      method: 'POST',

      body: JSON.stringify(note ? { note } : {}),

    });

  },

  config() {

    return request('/api/auth/config');

  },

  health() {

    return request('/api/health');

  },

  listProjects(params = {}) {
    const q = new URLSearchParams();
    if (params.mode) q.set('mode', params.mode);
    const qs = q.toString();
    return request(`/api/projects${qs ? `?${qs}` : ''}`);
  },

  listMyProjects() {
    return request('/api/me/projects');
  },

  getMembership() {
    return request('/api/me/membership');
  },

  joinProjects(projectIds) {
    return request('/api/me/projects/join', {
      method: 'POST',
      body: JSON.stringify({ projectIds }),
    });
  },

  leaveProject(projectId) {
    return request(`/api/me/projects/${projectId}`, { method: 'DELETE' });
  },

  listManageableProjects() {
    return request('/api/projects/manageable');
  },

  listProjectMembers(projectId) {
    return request(`/api/projects/${projectId}/members`);
  },

  searchMemberCandidates(projectId, q) {
    const qs = new URLSearchParams();
    if (q) qs.set('q', q);
    const s = qs.toString();
    return request(`/api/projects/${projectId}/member-candidates${s ? `?${s}` : ''}`);
  },

  addProjectMember(projectId, userId) {
    return request(`/api/projects/${projectId}/members`, {
      method: 'POST',
      body: JSON.stringify({ userId }),
    });
  },

  removeProjectMember(projectId, userId) {
    return request(`/api/projects/${projectId}/members/${userId}`, { method: 'DELETE' });
  },

  listCostCategories() {
    return request('/api/cost-categories');
  },

  getProjectDashboard(id) {

    return request(`/api/projects/${id}/dashboard`);

  },

  getReimbursementSummary(params = {}) {

    const q = new URLSearchParams();

    if (params.projectId) q.set('projectId', params.projectId);
    if (params.dateFrom) q.set('dateFrom', params.dateFrom);
    if (params.dateTo) q.set('dateTo', params.dateTo);

    const qs = q.toString();

    return request(`/api/reports/summary${qs ? `?${qs}` : ''}`);

  },

  exportReimbursementSummaryCsv(params = {}) {

    const q = new URLSearchParams({ format: 'csv' });

    if (params.projectId) q.set('projectId', params.projectId);
    if (params.dateFrom) q.set('dateFrom', params.dateFrom);
    if (params.dateTo) q.set('dateTo', params.dateTo);

    return download(`/api/reports/summary/export?${q.toString()}`);

  },

  getOverview(params = {}) {

    const q = new URLSearchParams();

    if (params.projectId) q.set('projectId', params.projectId);
    if (params.period) q.set('period', params.period);
    if (params.dateFrom) q.set('dateFrom', params.dateFrom);
    if (params.dateTo) q.set('dateTo', params.dateTo);

    const qs = q.toString();

    return request(`/api/reports/overview${qs ? `?${qs}` : ''}`);

  },

  exportOverviewCsv(params = {}) {

    const q = new URLSearchParams({ format: 'csv' });

    if (params.projectId) q.set('projectId', params.projectId);
    if (params.period) q.set('period', params.period);
    if (params.dateFrom) q.set('dateFrom', params.dateFrom);
    if (params.dateTo) q.set('dateTo', params.dateTo);
    if (params.sections) q.set('sections', params.sections);

    return download(`/api/reports/overview/export?${q.toString()}`);

  },

  ocrInvoice(fileId) {

    return request('/api/invoices/ocr', {

      method: 'POST',

      body: JSON.stringify({ fileId }),

    });

  },

  checkInvoiceDuplicate(params = {}) {

    const q = new URLSearchParams();

    if (params.no) q.set('no', params.no);
    if (params.code) q.set('code', params.code);
    if (params.excludeReimbId) q.set('excludeReimbId', params.excludeReimbId);

    return request(`/api/invoices/check?${q.toString()}`);

  },

  previewBudget(params = {}) {

    const q = new URLSearchParams();

    q.set('projectId', params.projectId);
    if (params.expenseDate) q.set('expenseDate', params.expenseDate);
    if (params.items) q.set('items', JSON.stringify(params.items));

    return request(`/api/budget/preview?${q.toString()}`);

  },

  getApiUsage(params = {}) {

    const q = new URLSearchParams();

    if (params.month) q.set('month', params.month);

    const qs = q.toString();

    return request(`/api/api-usage${qs ? `?${qs}` : ''}`);

  },

  listCostCategories() {

    return request('/api/cost-categories');

  },

  uploadFile(file) {

    const fd = new FormData();

    fd.append('file', file);

    return request('/api/files', { method: 'POST', body: fd });

  },

  listReimbursements(params = {}) {

    const q = new URLSearchParams();

    if (params.status) q.set('status', params.status);

    if (params.page) q.set('page', params.page);

    const qs = q.toString();

    return request(`/api/reimbursements${qs ? `?${qs}` : ''}`);

  },

  getReimbursement(id) {

    return request(`/api/reimbursements/${id}`);

  },

  createReimbursement(body) {

    return request('/api/reimbursements', { method: 'POST', body: JSON.stringify(body) });

  },

  updateReimbursement(id, body) {

    return request(`/api/reimbursements/${id}`, { method: 'PUT', body: JSON.stringify(body) });

  },

  submitReimbursement(id, body = {}) {
    return request(`/api/reimbursements/${id}/submit`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  listApproverCandidates({ reimbursementId, for: forRole }) {
    const q = new URLSearchParams();
    if (reimbursementId != null) q.set('reimbursementId', String(reimbursementId));
    if (forRole) q.set('for', forRole);
    return request(`/api/approvals/candidates?${q}`);
  },

  getProjectApproverPath(reimbursementId) {
    return request(`/api/approvals/project-path?reimbursementId=${reimbursementId}`);
  },

  deleteReimbursement(id) {

    return request(`/api/reimbursements/${id}`, { method: 'DELETE' });

  },

  cancelReimbursement(id) {
    return request(`/api/reimbursements/${id}/cancel`, { method: 'POST', body: '{}' });
  },

  reopenRejectedReimbursement(id) {
    return request(`/api/reimbursements/${id}/reopen`, { method: 'POST', body: '{}' });
  },

  listMyApprovalTasks() {

    return request('/api/approvals/tasks');

  },

  actOnApprovalTask(taskId, body) {

    return request(`/api/approvals/tasks/${taskId}/action`, {

      method: 'POST',

      body: JSON.stringify(body),

    });

  },

  adminMeta() {

    return request('/api/admin/meta');

  },

  adminSearchUsers(params = {}) {

    const q = new URLSearchParams();

    if (params.q) q.set('q', params.q);

    if (params.page) q.set('page', String(params.page));

    if (params.pageSize) q.set('pageSize', String(params.pageSize));

    const qs = q.toString();

    return request(`/api/admin/users${qs ? `?${qs}` : ''}`);

  },

  adminUserRoles(userId) {

    return request(`/api/admin/users/${userId}/roles`);

  },

  adminAssignRole(userId, body) {

    return request(`/api/admin/users/${userId}/roles`, {

      method: 'POST',

      body: JSON.stringify(body),

    });

  },

  adminRevokeRole(roleId) {

    return request(`/api/admin/roles/${roleId}`, { method: 'DELETE' });

  },

};

