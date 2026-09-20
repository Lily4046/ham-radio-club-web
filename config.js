/* =========================================================================
 * 业余无线电社团协作管理系统 —— 全局配置
 * -------------------------------------------------------------------------
 * 本文件是全局默认配置。部署前请把下面三处「必填」改成你自己的值。
 * 成员也可以在前端「设置」面板中临时覆盖（仅保存在各自浏览器 localStorage）。
 * ========================================================================= */
(function () {
  'use strict';

  window.HAM = window.HAM || {};

  var LS_KEY = 'ham.config.v1';

  var DEFAULT_CONFIG = {
    // ---- 必填 1：数据仓库（私有仓库）所属的 GitHub 用户名/组织名 ----
    owner: 'Lily4046',

    // ---- 必填 2：数据仓库名 ----
    repo: 'ham-radio-club',

    // 默认分支（绝大多数新仓库是 main，老仓库可能是 master）
    branch: 'main',

    // ---- 可选：OAuth 登录模式（用于成员各自用 GitHub 账号登录）----
    // 如果只想用「个人访问令牌 PAT」登录，这三项保持为空字符串即可。
    clientId: '',      // GitHub OAuth App 的 Client ID
    redirectUri: '',   // 站点完整地址，例如 https://<owner>.github.io/<repo>/
    proxyUrl: '',      // Cloudflare Worker 地址，例如 https://xxx.workers.dev

    // 数据文件在仓库中的相对路径（一般无需修改）
    files: {
      lab: 'data/lab-items.json',
      qsl: 'data/qsl-cards.json',
      radio: 'data/radio-equipment.json'
    }
  };

  function getConfig() {
    var over = {};
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (raw) over = JSON.parse(raw) || {};
    } catch (e) {
      over = {};
    }

    var merged = {};
    var k;
    for (k in DEFAULT_CONFIG) {
      if (Object.prototype.hasOwnProperty.call(DEFAULT_CONFIG, k)) {
        merged[k] = DEFAULT_CONFIG[k];
      }
    }
    for (k in over) {
      if (Object.prototype.hasOwnProperty.call(over, k)) {
        merged[k] = over[k];
      }
    }

    // files 是嵌套对象，做一层深合并，避免覆盖后丢失其它键
    merged.files = {};
    for (k in DEFAULT_CONFIG.files) {
      if (Object.prototype.hasOwnProperty.call(DEFAULT_CONFIG.files, k)) {
        merged.files[k] = DEFAULT_CONFIG.files[k];
      }
    }
    if (over && over.files) {
      for (k in over.files) {
        if (Object.prototype.hasOwnProperty.call(over.files, k)) {
          merged.files[k] = over.files[k];
        }
      }
    }
    return merged;
  }

  function setOverrides(patch) {
    var cur = {};
    try {
      cur = JSON.parse(localStorage.getItem(LS_KEY)) || {};
    } catch (e) {
      cur = {};
    }
    var k;
    for (k in patch) {
      if (Object.prototype.hasOwnProperty.call(patch, k)) {
        cur[k] = patch[k];
      }
    }
    localStorage.setItem(LS_KEY, JSON.stringify(cur));
  }

  function resetOverrides() {
    localStorage.removeItem(LS_KEY);
  }

  HAM.CONFIG = {
    DEFAULT: DEFAULT_CONFIG,
    get: getConfig,
    setOverrides: setOverrides,
    resetOverrides: resetOverrides
  };
})();
