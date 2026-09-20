import { reactive, readonly } from 'vue';
import { api, clearSession, getStoredUser, getToken, setSession } from '../api/http.js';
import { dingTalkLogin, isDingTalk, toast } from '../utils/dingtalk.js';

const IDENTITY_KEY = 'reimb_identity_confirmed';

const state = reactive({
  ready: false,
  loading: false,
  error: '',
  loginStep: '',
  user: getStoredUser(),
  inDingTalk: isDingTalk(),
  identityConfirmed: false,
  identityConfirming: false,
  membership: { needJoin: false, joinedCount: 0 },
});

function identityKeyForUser(user) {
  if (!user?.id) return IDENTITY_KEY;
  return `${IDENTITY_KEY}:${user.id}`;
}

function readIdentityConfirmed(user) {
  try {
    return sessionStorage.getItem(identityKeyForUser(user)) === '1';
  } catch {
    return false;
  }
}

function writeIdentityConfirmed(user, confirmed) {
  try {
    const key = identityKeyForUser(user);
    if (confirmed) sessionStorage.setItem(key, '1');
    else sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

function applyMembership(membership) {
  state.membership = membership || { needJoin: false, joinedCount: 0 };
}

export function useUserStore() {
  async function bootstrap() {
    state.loading = true;
    state.error = '';
    state.loginStep = '准备登录…';

    try {
      const token = getToken();
      if (token) {
        try {
          state.loginStep = '校验登录态…';
          const data = await api.me();
          state.user = data.user;
          applyMembership(data.membership);
          state.identityConfirmed = readIdentityConfirmed(data.user);
          state.ready = true;
          return;
        } catch {
          clearSession();
        }
      }

      if (!state.inDingTalk) {
        state.loginStep = '开发环境登录…';
        const data = await api.devLogin();
        setSession(data.token, data.user);
        state.user = data.user;
        applyMembership(data.membership);
        state.identityConfirmed = readIdentityConfirmed(data.user);
        state.ready = true;
        return;
      }

      const data = await dingTalkLogin((msg) => {
        state.loginStep = msg;
      });
      setSession(data.token, data.user);
      state.user = data.user;
      applyMembership(data.membership);
      state.identityConfirmed = readIdentityConfirmed(data.user);
      state.ready = true;
      toast(`欢迎，${data.user.name || data.user.userId}`);
    } catch (err) {
      state.error = err.message || '登录失败';
      state.ready = true;
    } finally {
      state.loading = false;
      state.loginStep = '';
    }
  }

  function logout() {
    writeIdentityConfirmed(state.user, false);
    clearSession();
    state.user = null;
    state.identityConfirmed = false;
    state.membership = { needJoin: false, joinedCount: 0 };
    state.ready = false;
    bootstrap();
  }

  function switchDevUser(user, token, membership) {
    writeIdentityConfirmed(state.user, false);
    setSession(token, user);
    state.user = user;
    applyMembership(membership);
    state.identityConfirmed = false;
  }

  function setMembership(membership) {
    applyMembership(membership);
  }

  async function confirmIdentity() {
    state.identityConfirming = true;
    try {
      const data = await api.confirmIdentity();
      if (data.user) {
        state.user = data.user;
        setSession(getToken(), data.user);
      }
      writeIdentityConfirmed(state.user, true);
      state.identityConfirmed = true;
      toast(data.message || '身份已确认');
      return data;
    } finally {
      state.identityConfirming = false;
    }
  }

  return {
    state: readonly(state),
    bootstrap,
    logout,
    switchDevUser,
    setMembership,
    confirmIdentity,
  };
}
