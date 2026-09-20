/**
 * Sync DingTalk credentials into backend/.env and verify accessToken.
 * Usage: node scripts/sync-dingtalk-creds.js
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '../.env');

const updates = {
  DINGTALK_APP_KEY: process.env.SYNC_APP_KEY || 'dingiwa7gpxmyfk9g4ne',
  DINGTALK_APP_SECRET:
    process.env.SYNC_APP_SECRET ||
    'ZNFpD8QqeB6P4NxyXCCIU5X31z5jfVIz5l4kCZi_YMkRzo9dVWyPfqxhq6smuEmc',
  DINGTALK_AGENT_ID: process.env.SYNC_AGENT_ID || '4823915526',
};

function upsertEnv(raw, key, value) {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (re.test(raw)) return raw.replace(re, line);
  return `${raw.trimEnd()}\n${line}\n`;
}

function readKey(raw, key) {
  const m = raw.match(new RegExp(`^${key}=(.*)$`, 'm'));
  return m ? m[1].trim() : '';
}

if (!existsSync(envPath)) {
  console.error('Missing backend/.env — copy from .env.example first');
  process.exit(1);
}

let raw = readFileSync(envPath, 'utf8');
for (const [k, v] of Object.entries(updates)) {
  const old = readKey(raw, k);
  raw = upsertEnv(raw, k, v);
  const shown = k.includes('SECRET') ? `***len=${v.length}` : v;
  const oldShown =
    k.includes('SECRET') && old ? `***len=${old.length}` : old || '(empty)';
  console.log(`  ${k}: ${oldShown} -> ${shown}`);
}
writeFileSync(envPath, raw, 'utf8');
console.log('[sync] wrote backend/.env');

const corpId = readKey(raw, 'DINGTALK_CORP_ID');
const frontend = readKey(raw, 'FRONTEND_URL');
console.log(`[sync] DINGTALK_CORP_ID=${corpId || '(missing)'}`);
console.log(`[sync] FRONTEND_URL=${frontend || '(missing)'}`);
if (!corpId) {
  console.warn('[warn] 缺少 CorpId（ding 开头），免登会失败');
} else if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(corpId)) {
  console.warn('[warn] CorpId 误填成 App ID(UUID)，请改为企业 CorpId');
}

console.log('[test] accessToken…');
const res = await fetch('https://api.dingtalk.com/v1.0/oauth2/accessToken', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    appKey: updates.DINGTALK_APP_KEY,
    appSecret: updates.DINGTALK_APP_SECRET,
  }),
});
const data = await res.json().catch(() => ({}));
if (data.accessToken) {
  console.log('[ok] accessToken OK, expireIn=', data.expireIn);
  process.exit(0);
}

const legacyUrl =
  `https://oapi.dingtalk.com/gettoken?appkey=${encodeURIComponent(updates.DINGTALK_APP_KEY)}` +
  `&appsecret=${encodeURIComponent(updates.DINGTALK_APP_SECRET)}`;
const legacy = await fetch(legacyUrl).then((r) => r.json());
if (legacy.access_token) {
  console.log('[ok] legacy gettoken OK');
  process.exit(0);
}

console.error('[fail] new API:', JSON.stringify(data));
console.error('[fail] legacy:', JSON.stringify(legacy));
process.exit(1);
