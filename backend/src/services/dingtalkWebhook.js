import crypto from 'crypto';
import { normalizeOaInstanceEvent } from './dingtalkOa.js';
import { config } from '../config.js';

function getCallbackConfig() {
  return {
    token: process.env.DINGTALK_CALLBACK_TOKEN || '',
    aesKey: process.env.DINGTALK_CALLBACK_AES_KEY || process.env.DINGTALK_AES_KEY || '',
    corpId: config.dingtalk.corpId || '',
  };
}

export function isWebhookEncryptionConfigured() {
  const { token, aesKey, corpId } = getCallbackConfig();
  return !!(token && aesKey && corpId);
}

function sha1(str) {
  return crypto.createHash('sha1').update(str).digest('hex');
}

function pkcs7Unpad(buf) {
  const pad = buf[buf.length - 1];
  if (pad < 1 || pad > 32) return buf;
  return buf.subarray(0, buf.length - pad);
}

function decryptDingTalkEncrypt(encrypt, encodingAesKey, corpId) {
  const aesKey = Buffer.from(`${encodingAesKey}=`, 'base64');
  const iv = aesKey.subarray(0, 16);
  const decipher = crypto.createDecipheriv('aes-256-cbc', aesKey, iv);
  decipher.setAutoPadding(false);
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encrypt, 'base64')),
    decipher.final(),
  ]);
  const unpadded = pkcs7Unpad(decrypted);
  const msgLen = unpadded.readUInt32BE(16);
  const msg = unpadded.subarray(20, 20 + msgLen).toString('utf8');
  const fromCorpId = unpadded.subarray(20 + msgLen).toString('utf8');
  if (fromCorpId !== corpId) {
    throw new Error('回调 corpId 校验失败');
  }
  return msg;
}

function encryptDingTalkReply(text, encodingAesKey, corpId) {
  const aesKey = Buffer.from(`${encodingAesKey}=`, 'base64');
  const iv = aesKey.subarray(0, 16);
  const random = crypto.randomBytes(16);
  const msgBuf = Buffer.from(text, 'utf8');
  const corpBuf = Buffer.from(corpId, 'utf8');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(msgBuf.length, 0);
  const raw = Buffer.concat([random, lenBuf, msgBuf, corpBuf]);
  const padLen = 32 - (raw.length % 32);
  const padded = Buffer.concat([raw, Buffer.alloc(padLen, padLen)]);
  const cipher = crypto.createCipheriv('aes-256-cbc', aesKey, iv);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(padded), cipher.final()]).toString('base64');
}

function verifySignature(token, timestamp, nonce, encrypt, signature) {
  const sorted = [token, timestamp, nonce, encrypt].sort().join('');
  return sha1(sorted) === signature;
}

function buildEncryptedResponse(plaintext, query) {
  const { token, aesKey, corpId } = getCallbackConfig();
  const timestamp = query.timestamp || String(Date.now());
  const nonce = query.nonce || crypto.randomBytes(8).toString('hex');
  const encrypt = encryptDingTalkReply(plaintext, aesKey, corpId);
  const signature = sha1([token, timestamp, nonce, encrypt].sort().join(''));
  return { msg_signature: signature, encrypt, timeStamp: timestamp, nonce };
}

/**
 * 解析 HTTP 回调请求体（开发环境明文 / 生产加密）
 */
export function parseWebhookRequest(req) {
  const query = req.query || {};
  const body = req.body || {};

  if (body.processInstanceId || body.process_instance_id) {
    return normalizeOaInstanceEvent(body);
  }

  if (body.eventType === 'bpms_instance_change' && body.data) {
    return normalizeOaInstanceEvent(body);
  }

  const encrypt = body.encrypt;
  if (encrypt && isWebhookEncryptionConfigured()) {
    const { token, aesKey, corpId } = getCallbackConfig();
    const signature = query.signature || query.msg_signature;
    const timestamp = query.timestamp || query.timeStamp;
    const nonce = query.nonce;
    if (!verifySignature(token, timestamp, nonce, encrypt, signature)) {
      throw new Error('回调签名校验失败');
    }
    const plain = decryptDingTalkEncrypt(encrypt, aesKey, corpId);
    const parsed = JSON.parse(plain);
    return normalizeOaInstanceEvent(parsed);
  }

  if (encrypt && !isWebhookEncryptionConfigured()) {
    throw new Error('收到加密回调但未配置 DINGTALK_CALLBACK_TOKEN / DINGTALK_CALLBACK_AES_KEY / DINGTALK_CORP_ID');
  }

  return normalizeOaInstanceEvent(body);
}

/** 钉钉 URL 验证 / 事件响应（加密 success） */
export function buildWebhookChallengeResponse(req) {
  const query = req.query || {};
  const body = req.body || {};
  const { aesKey, corpId } = getCallbackConfig();
  if (!isWebhookEncryptionConfigured()) {
    return { plain: 'success' };
  }
  const encrypt = body.encrypt || query.encrypt;
  if (!encrypt) {
    return { encrypted: buildEncryptedResponse('success', query) };
  }
  const { token } = getCallbackConfig();
  const signature = query.signature || query.msg_signature;
  const timestamp = query.timestamp || query.timeStamp;
  const nonce = query.nonce;
  if (!verifySignature(token, timestamp, nonce, encrypt, signature)) {
    throw new Error('回调签名校验失败');
  }
  const plain = decryptDingTalkEncrypt(encrypt, aesKey, corpId);
  return { encrypted: buildEncryptedResponse(plain === 'success' ? 'success' : plain, query) };
}
