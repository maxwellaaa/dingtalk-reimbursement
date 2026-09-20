import { DWClient, EventAck } from 'dingtalk-stream';
import { config } from '../config.js';
import { handleOaInstanceEvent } from './approval.js';
import { normalizeOaInstanceEvent } from './dingtalkOa.js';

/** @type {DWClient | null} */
let client = null;

export function isStreamRunning() {
  return !!(client?.connected && client?.registered);
}

export async function startDingTalkStream() {
  if (!config.dingtalk.appKey || !config.dingtalk.appSecret) {
    console.warn('[stream] 钉钉凭证未配置，跳过 Stream 订阅');
    return;
  }
  if (process.env.DINGTALK_STREAM_ENABLED === 'false') {
    console.log('[stream] DINGTALK_STREAM_ENABLED=false，跳过');
    return;
  }

  client = new DWClient({
    clientId: config.dingtalk.appKey,
    clientSecret: config.dingtalk.appSecret,
    debug: config.nodeEnv !== 'production',
  });

  client.registerAllEventListener(async (message) => {
    try {
      const headerType = message?.headers?.eventType || message?.headers?.EventType;
      if (headerType && headerType !== 'bpms_instance_change' && !headerType.includes('bpms_instance')) {
        return { status: EventAck.SUCCESS };
      }

      const payload = normalizeOaInstanceEvent(message);
      if (!payload?.processInstanceId) {
        if (headerType?.includes?.('bpms_instance')) {
          console.warn('[stream] bpms 事件缺少 processInstanceId:', JSON.stringify(message?.data)?.slice(0, 200));
        }
        return { status: EventAck.SUCCESS };
      }

      await handleOaInstanceEvent(payload);
    } catch (err) {
      console.error('[stream] event error:', err.message);
      return { status: EventAck.LATER };
    }
    return { status: EventAck.SUCCESS };
  });

  client.connect().then(() => {
    console.log('[stream] 钉钉事件 Stream 已连接（OA 审批回写）');
  }).catch((err) => {
    console.error('[stream] 连接失败:', err.message);
  });
}

export function stopDingTalkStream() {
  client?.disconnect();
  client = null;
}
