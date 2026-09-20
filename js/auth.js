/* =========================================================================
 * 认证层
 * -------------------------------------------------------------------------
 * 支持两种登录方式：
 *   1. PAT（个人访问令牌）：输入令牌直接登录，最简单，适合小团队/内网
 *   2. OAuth（GitHub 账号登录）：跳转 GitHub 授权，经 Cloudflare Worker
 *      换取令牌，适合成员各自登录（需先在 config.js 配置 OAuth 参数）
 *
 * 令牌只保存在当前浏览器的 localStorage 中，绝不外发到第三方。
 * ========================================================================= */
(function () {
  'use strict';

  window.HAM = window.HAM || {};

  var LS_KEY = 'ham.auth.v1';
  var state = load();

  function load() {
    try {
      return JSON.parse(localStorage.getItem(LS_KEY)) || {};
    } catch (e) {
      return {};
    }
  }

  function save() {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  }

  function getToken() {
    return state.token || null;
  }

  function getUser() {
    return state.user || null;
  }

  function isAuthed() {
    return !!state.token;
  }

  /* ---------- PAT 登录 ---------- */
  function loginWithToken(token) {
    return HAM.GitHub.getUser(token).then(function (user) {
      state = { mode: 'pat', token: token, user: user };
      save();
      return user;
    });
  }

  /* ---------- OAuth 登录 ---------- */
  function randomString(n) {
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    var out = '';
    for (var i = 0; i < n; i++) {
      out += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return out;
  }

  function startOAuth() {
    var cfg = HAM.CONFIG.get();
    if (!cfg.clientId || !cfg.redirectUri || !cfg.proxyUrl) {
      throw new Error('OAuth 未配置：请在 config.js 中填写 clientId、redirectUri、proxyUrl，并部署 Worker。');
    }
    var stateStr = randomString(16);
    sessionStorage.setItem('ham.oauth.state', stateStr);
    var url = 'https://github.com/login/oauth/authorize?client_id=' + encodeURIComponent(cfg.clientId) +
      '&redirect_uri=' + encodeURIComponent(cfg.redirectUri) +
      '&scope=repo&state=' + encodeURIComponent(stateStr);
    window.location.href = url;
  }

  // 处理 OAuth 回调（页面加载时若 URL 带 code 则调用）
  function handleOAuthCallback() {
    var params = new URLSearchParams(window.location.search);
    var code = params.get('code');
    var stateStr = params.get('state');
    if (!code) return Promise.resolve(false);

    var savedState = sessionStorage.getItem('ham.oauth.state');
    if (!savedState || savedState !== stateStr) {
      return Promise.reject(new Error('OAuth state 校验失败，可能存在 CSRF 风险。'));
    }

    var cfg = HAM.CONFIG.get();
    return fetch(cfg.proxyUrl + '/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code, state: stateStr })
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok || !data.access_token) {
          throw new Error((data && (data.error_description || data.error)) || '令牌交换失败');
        }
        // 清理地址栏中的 code/state，避免刷新重复交换
        window.history.replaceState(null, '', window.location.pathname + window.location.hash);
        sessionStorage.removeItem('ham.oauth.state');
        return loginWithToken(data.access_token);
      });
    });
  }

  function logout() {
    state = {};
    save();
    sessionStorage.removeItem('ham.oauth.state');
  }

  HAM.Auth = {
    getToken: getToken,
    getUser: getUser,
    isAuthed: isAuthed,
    loginWithToken: loginWithToken,
    startOAuth: startOAuth,
    handleOAuthCallback: handleOAuthCallback,
    logout: logout
  };
})();
