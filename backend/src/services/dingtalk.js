import crypto from 'crypto';
import { config } from '../config.js';

/** @type {{ token: string, expireAt: number } | null} */
let accessTokenCache = null;
/** @type {{ ticket: string, expireAt: number } | null} */
let jsapiTicketCache = null;

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || data.errmsg || `HTTP ${res.status}`);
  }
  return data;
}

/**
 * 获取企业内部应用 accessToken（缓存 7200s，提前 5 分钟刷新）
 * @see https://open.dingtalk.com/document/orgapp-server/obtain-orgapp-token
 */
export async function getAccessToken() {
  const now = Date.now();
  if (accessTokenCache && accessTokenCache.expireAt > now) {
    return accessTokenCache.token;
  }

  if (!config.dingtalk.appKey || !config.dingtalk.appSecret) {
    throw new Error('未配置 DINGTALK_APP_KEY / DINGTALK_APP_SECRET');
  }

  // 新版 OAuth2
  const data = await fetchJson('https://api.dingtalk.com/v1.0/oauth2/accessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      appKey: config.dingtalk.appKey,
      appSecret: config.dingtalk.appSecret,
    }),
  });

  if (!data.accessToken) {
    // 兼容旧版 gettoken
    const legacyUrl =
      `https://oapi.dingtalk.com/gettoken?appkey=${encodeURIComponent(config.dingtalk.appKey)}` +
      `&appsecret=${encodeURIComponent(config.dingtalk.appSecret)}`;
    const legacy = await fetchJson(legacyUrl);
    if (legacy.errcode && legacy.errcode !== 0) {
      throw new Error(
        `钉钉凭证无效(${legacy.errcode}): ${legacy.errmsg || data.message || data.code || '请检查 AppKey/AppSecret'}`,
      );
    }
    if (!legacy.access_token) {
      throw new Error(
        `钉钉凭证无效: ${data.message || data.code || 'invalidClientIdOrSecret'}。请到开放平台「凭证与基础信息」复制 Client ID / Client Secret 写入 .env`,
      );
    }
    accessTokenCache = {
      token: legacy.access_token,
      expireAt: now + (Number(legacy.expires_in || 7200) - 300) * 1000,
    };
    return accessTokenCache.token;
  }

  const token = data.accessToken;
  const expireIn = Number(data.expireIn || 7200);
  accessTokenCache = {
    token,
    expireAt: now + (expireIn - 300) * 1000,
  };
  return token;
}

/**
 * 通过免登 authCode 换取 userid
 * @see https://open.dingtalk.com/document/orgapp-server/obtain-the-userid-of-a-user-by-using-the-log-free
 */
export async function getUserInfoByAuthCode(authCode) {
  const accessToken = await getAccessToken();
  const url = `https://oapi.dingtalk.com/topapi/v2/user/getuserinfo?access_token=${encodeURIComponent(accessToken)}`;
  const data = await fetchJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: authCode }),
  });

  if (data.errcode !== 0) {
    throw new Error(
      `免登换用户失败[${data.errcode}]: ${data.errmsg || 'unknown'}（请确认 AppKey/Secret 与当前企业应用一致，且 authCode 未重复使用）`,
    );
  }

  return {
    userId: data.result.userid,
    unionId: data.result.unionid,
    name: data.result.name || '',
    sysLevel: data.result.sys_level,
  };
}

/**
 * 获取用户详情（姓名、部门等）
 */
export async function getUserDetail(userId) {
  const accessToken = await getAccessToken();
  const url = `https://oapi.dingtalk.com/topapi/v2/user/get?access_token=${encodeURIComponent(accessToken)}`;
  const data = await fetchJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userid: userId }),
  });

  if (data.errcode !== 0) {
    throw new Error(data.errmsg || `user/get failed: ${data.errcode}`);
  }

  const r = data.result;
  return {
    userId: r.userid,
    unionId: r.unionid,
    name: r.name,
    mobile: r.mobile,
    title: r.title,
    deptIdList: r.dept_id_list || [],
    avatar: r.avatar,
  };
}

async function getJsapiTicket() {
  const now = Date.now();
  if (jsapiTicketCache && jsapiTicketCache.expireAt > now) {
    return jsapiTicketCache.ticket;
  }

  const accessToken = await getAccessToken();
  const url = `https://oapi.dingtalk.com/get_jsapi_ticket?access_token=${encodeURIComponent(accessToken)}`;
  const data = await fetchJson(url);

  if (data.errcode !== 0) {
    throw new Error(data.errmsg || `get_jsapi_ticket failed: ${data.errcode}`);
  }

  jsapiTicketCache = {
    ticket: data.ticket,
    expireAt: now + (Number(data.expires_in || 7200) - 300) * 1000,
  };
  return jsapiTicketCache.ticket;
}

/**
 * 生成 dd.config 所需签名
 * @see https://open.dingtalk.com/document/orgapp-client/jsapi-authentication
 */
export async function buildJsConfig(pageUrl) {
  const ticket = await getJsapiTicket();
  const nonceStr = crypto.randomBytes(8).toString('hex');
  const timeStamp = Math.floor(Date.now() / 1000);
  const plain = `jsapi_ticket=${ticket}&noncestr=${nonceStr}&timestamp=${timeStamp}&url=${pageUrl}`;
  const signature = crypto.createHash('sha256').update(plain).digest('hex');

  return {
    agentId: config.dingtalk.agentId,
    corpId: config.dingtalk.corpId,
    clientId: config.dingtalk.appKey,
    timeStamp,
    nonceStr,
    signature,
    type: 0,
    jsApiList: [
      'runtime.info',
      'device.notification.toast',
      'biz.navigation.setTitle',
      'biz.navigation.close',
      'biz.util.openLink',
    ],
  };
}
