import * as dd from 'dingtalk-jsapi';
import { api } from '../api/http.js';

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label}超时（${ms / 1000}s）`)), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

function requestAuthCode(corpId, clientId) {
  return new Promise((resolve, reject) => {
    const params = {
      corpId,
      onSuccess: (result) => resolve(result.code),
      onFail: (err) => {
        const msg =
          err?.errorMessage ||
          err?.message ||
          (typeof err === 'string' ? err : JSON.stringify(err)) ||
          '获取 authCode 失败';
        reject(new Error(msg));
      },
    };
    if (clientId) params.clientId = clientId;

    if (typeof dd.requestAuthCode === 'function') {
      dd.requestAuthCode(params);
      return;
    }
    if (dd.runtime?.permission?.requestAuthCode) {
      dd.runtime.permission.requestAuthCode(params);
      return;
    }
    reject(new Error('当前钉钉版本不支持 requestAuthCode'));
  });
}

function waitDdReady(ms = 8000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('钉钉 JSAPI ready 超时')), ms);
    try {
      dd.ready(() => {
        clearTimeout(t);
        resolve();
      });
    } catch (e) {
      clearTimeout(t);
      reject(e);
    }
  });
}

/** 是否在钉钉客户端内 */
export function isDingTalk() {
  return dd.env.platform !== 'notInDingTalk';
}

/** 当前页 URL（不含 hash），用于 JSAPI 签名 */
export function getSignUrl() {
  return window.location.href.split('#')[0];
}

/**
 * 初始化免登。
 * 注意：requestAuthCode 不需要 dd.config；旧逻辑在 config 失败时会一直卡住「正在登录」。
 */
export async function dingTalkLogin(onProgress) {
  const progress = (msg) => {
    if (typeof onProgress === 'function') onProgress(msg);
  };

  if (!isDingTalk()) {
    throw new Error('请在钉钉客户端内打开本应用');
  }

  progress('读取企业配置…');
  const pub = await withTimeout(api.config(), 12000, '读取 /api/auth/config');
  const corpId = pub.corpId;
  const clientId = pub.clientId;
  if (!corpId) {
    throw new Error('未配置 CorpId，请在 backend/.env 填写 DINGTALK_CORP_ID（形如 ding…）');
  }
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(String(corpId))) {
    throw new Error(
      'DINGTALK_CORP_ID 格式不像企业 CorpId（应为 ding 开头）。请到开放平台「凭证与基础信息」复制正确 CorpId',
    );
  }

  progress('等待钉钉容器…');
  await waitDdReady(10000);

  progress('获取免登授权码…');
  const authCode = await withTimeout(
    requestAuthCode(corpId, clientId),
    15000,
    'requestAuthCode',
  );

  progress('向服务器换取登录态…');
  const session = await withTimeout(api.login(authCode), 15000, '登录接口');

  // 非阻塞：后续 toast/setTitle 可能用到；失败不影响登录
  try {
    const signUrl = getSignUrl();
    const jsConfig = await api.getJsConfig(signUrl);
    dd.config({
      agentId: jsConfig.agentId,
      corpId: jsConfig.corpId,
      timeStamp: jsConfig.timeStamp,
      nonceStr: jsConfig.nonceStr,
      signature: jsConfig.signature,
      type: jsConfig.type ?? 0,
      jsApiList: jsConfig.jsApiList || [],
    });
  } catch (e) {
    console.warn('[dingTalkLogin] dd.config skipped:', e?.message || e);
  }

  return session;
}

export function setNavTitle(title) {
  if (!isDingTalk()) {
    document.title = title;
    return;
  }
  try {
    dd.biz.navigation.setTitle({ title });
  } catch {
    document.title = title;
  }
}

export function toast(message) {
  if (!isDingTalk()) {
    console.log('[toast]', message);
    return;
  }
  try {
    dd.device.notification.toast({
      icon: '',
      text: message,
      duration: 2,
    });
  } catch {
    console.log('[toast]', message);
  }
}
