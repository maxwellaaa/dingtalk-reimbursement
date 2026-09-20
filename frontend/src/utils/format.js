export const STATUS_MAP = {
  draft: { label: '草稿', color: '#8f959e' },
  pending: { label: '待审批', color: '#1677ff' },
  approving: { label: '审批中', color: '#1677ff' },
  approved: { label: '已通过', color: '#00b578' },
  rejected: { label: '已驳回', color: '#ff4d4f' },
  paid: { label: '已付款', color: '#00b578' },
  cancelled: { label: '已撤销', color: '#8f959e' },
};

export function formatMoney(n) {
  const v = Number(n) || 0;
  return v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** 本地日历日 YYYY-MM-DD，避免 ISO/UTC 切片导致日期前移一天 */
export function formatDate(d) {
  if (!d) return '-';
  if (d instanceof Date && !Number.isNaN(d.getTime())) {
    return toLocalYmd(d);
  }
  const s = String(d).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}T/.test(s) || s.includes('GMT') || s.includes('UTC')) {
    const dt = new Date(s);
    if (!Number.isNaN(dt.getTime())) return toLocalYmd(dt);
  }
  return s.slice(0, 10);
}

export function todayStr() {
  return toLocalYmd(new Date());
}

function toLocalYmd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
