import { query } from '../db/pool.js';
import { maskProcessCode } from './dingtalkOa.js';
import { isWebhookEncryptionConfigured } from './dingtalkWebhook.js';
import { config } from '../config.js';

const cache = new Map();

export async function getConfig(key, defaultValue = '') {
  if (cache.has(key)) return cache.get(key);
  const rows = await query('SELECT config_value FROM sys_config WHERE config_key = :key LIMIT 1', {
    key,
  });
  const value = rows[0]?.config_value ?? defaultValue;
  cache.set(key, value);
  return value;
}

export async function getApprovalMode() {
  const mode = (await getConfig('approval.mode', 'B')).toUpperCase();
  return mode === 'A' ? 'A' : 'B';
}

export async function getProcessCode() {
  return getConfig('dingtalk.process_code', '');
}

export function clearConfigCache() {
  cache.clear();
}

/** 启动时从环境变量同步 processCode 到 sys_config */
export async function syncProcessCodeFromEnv() {
  const code = process.env.DINGTALK_PROCESS_CODE?.trim();
  if (!code) return false;
  await query(
    `UPDATE sys_config SET config_value = :value, updated_at = NOW() WHERE config_key = 'dingtalk.process_code'`,
    { value: code },
  );
  clearConfigCache();
  console.log('[config] synced dingtalk.process_code from DINGTALK_PROCESS_CODE');
  return true;
}

export async function getApprovalConfig() {
  const mode = await getApprovalMode();
  const processCode = await getProcessCode();
  const streamEnabled =
    process.env.DINGTALK_STREAM_ENABLED !== 'false' &&
    !!(config.dingtalk.appKey && config.dingtalk.appSecret);

  let streamConnected = false;
  try {
    const { isStreamRunning } = await import('./dingtalkStream.js');
    streamConnected = isStreamRunning();
  } catch {
    streamConnected = false;
  }

  return {
    mode,
    processCodeConfigured: !!processCode,
    processCodeMasked: processCode ? maskProcessCode(processCode) : '',
    streamEnabled,
    streamConnected,
    webhookEncryptionConfigured: isWebhookEncryptionConfigured(),
    webhookPath: '/api/webhooks/dingtalk/oa',
    attachmentFieldLabel: process.env.DINGTALK_OA_ATTACHMENT_LABEL || '发票及凭证',
    dingtalkCredentialsConfigured: !!(config.dingtalk.appKey && config.dingtalk.appSecret),
  };
}
