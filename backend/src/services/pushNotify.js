/**
 * 移动端 Push 通知（P3 占位：JPush 接入前仅日志）
 * 环境变量 PUSH_PROVIDER=jpush 时预留扩展
 */

export async function notifyMobileApprovalTask({
  userId,
  billNo,
  reimbId,
  title,
  body,
}) {
  const provider = String(process.env.PUSH_PROVIDER || 'stub').toLowerCase();
  const payload = {
    userId,
    billNo,
    reimbId,
    title: title || `待审批报销 ${billNo || ''}`,
    body: body || '您有一条报销待审批',
  };

  if (provider === 'jpush') {
    // TODO: 接入 JPush REST API（需 JPUSH_APP_KEY / JPUSH_MASTER_SECRET）
    console.warn('[push] JPush 未配置完整，降级 stub', payload);
    return { ok: false, stub: true, reason: 'jpush_not_configured' };
  }

  if (process.env.NODE_ENV !== 'production') {
    console.log('[push] stub', payload);
  }
  return { ok: true, stub: true };
}
