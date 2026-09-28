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
    return !!state.token || state.mode === 'guest';
  }

  function isGuest() {
    return state.mode === 'guest';
  }

  // 是否管理员（能看「变更记录」等管理功能）
  function isAdmin() {
    var cfg = HAM.CONFIG.get();
    var u = getUser();
    // GitHub 用户名不区分大小写，比较时统一小写
    return !!(u && cfg.adminLogin && u.login &&
      String(u.login).toLowerCase() === String(cfg.adminLogin).toLowerCase());
  }

  /* ---------- PAT 登录 ---------- */
  // options.deferUser：先拿令牌进入应用，用户信息在后台补。
  // OAuth 刚换完令牌时用得上——省掉一次「浏览器 → api.github.com」的跨太平洋往返，
  // 进入应用能快好几秒（令牌刚换出来，一定是有效的）。
  function loginWithToken(token, options) {
    token = String(token || '').trim();
    if (!token) {
      return Promise.reject(new Error('访问令牌不能为空。'));
    }
    if (options && options.deferUser) {
      state = { mode: 'pat', token: token, user: null };
      save();
      HAM.GitHub.getUser(token).then(function (user) {
        state.user = user;
        save();
        if (HAM.App && HAM.App.onUserLoaded) HAM.App.onUserLoaded();
      }).catch(function () {
        // 拿不到用户信息不影响使用，只是头顶不显示账号名
      });
      return Promise.resolve(null);
    }
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
  // 清掉地址栏里的 ?code=&state=：成功后不必再交换，失败后也要清，
  // 否则每次刷新都会拿同一个（已失效的）授权码重试，看起来像"一直登录不了"
  function clearOAuthQuery() {
    try {
      if (window.location.search.indexOf('code=') !== -1) {
        window.history.replaceState(null, '', window.location.pathname + window.location.hash);
      }
    } catch (e) { /* 忽略：清不掉也不影响功能 */ }
  }

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
      // 用 text() 读取，避免代理返回非 JSON 时 res.json() 抛错掩盖真实原因
      return res.text().then(function (text) {
        var data = {};
        try { data = JSON.parse(text) || {}; } catch (e) { data = { __raw: text }; }

        if (!res.ok || !data.access_token) {
          var errCode = data.error || data.errorCode;
          var errDesc = data.error_description || data.errorMessage || data.message ||
            (data.Error && (data.Error.Message || data.Error.Code));
          var msg;
          if (errCode === 'bad_verification_code') {
            msg = '授权码已过期或失效，请重新点击「使用 GitHub 账号登录」再试。';
          } else if (errDesc) {
            msg = errDesc + '（HTTP ' + res.status + '）';
          } else if (errCode) {
            msg = errCode + '（HTTP ' + res.status + '）';
          } else {
            msg = '令牌交换失败（HTTP ' + res.status + '）';
            if (data.__raw && String(data.__raw).trim()) {
              msg += '：' + String(data.__raw).trim().slice(0, 300);
            }
          }
          throw new Error(msg);
        }
        // 清理地址栏中的 code/state，避免刷新重复交换
        clearOAuthQuery();
        sessionStorage.removeItem('ham.oauth.state');
        // 令牌刚换出来一定有效，先直接进应用，用户信息后台补（省一次跨太平洋往返）
        return loginWithToken(data.access_token, { deferUser: true });
      });
    });
  }

  function logout() {
    state = {};
    save();
    sessionStorage.removeItem('ham.oauth.state');
  }

  // 游客（只读）登录：读取走腾讯云函数代理（令牌在云函数环境变量里），前端不存令牌
  function loginAsGuest() {
    state = { mode: 'guest', token: null, user: { login: '游客', name: '游客', avatar_url: '' } };
    save();
    return Promise.resolve(state.user);
  }

  HAM.Auth = {
    getToken: getToken,
    getUser: getUser,
    isAuthed: isAuthed,
    isGuest: isGuest,
    isAdmin: isAdmin,
    loginWithToken: loginWithToken,
    loginAsGuest: loginAsGuest,
    startOAuth: startOAuth,
    clearOAuthQuery: clearOAuthQuery,
    handleOAuthCallback: handleOAuthCallback,
    logout: logout
  };
})();
