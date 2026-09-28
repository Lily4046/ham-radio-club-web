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

    // 管理员 GitHub 用户名：只有管理员能看到「变更记录」按钮
    adminLogin: 'Lily4046',

    // ---- OAuth 登录模式（成员点「使用 GitHub 账号登录」，不用输入令牌）----
    // 三个值都填好才会显示 OAuth 按钮。proxyUrl 是腾讯云函数地址，见 tencent-scf/README.md。
    clientId: 'Ov23liNW6OynAyeVvehv',                                // GitHub OAuth App 的 Client ID
    redirectUri: 'https://lily4046.github.io/ham-radio-club-web/',  // 站点完整地址（回调）
    proxyUrl: 'https://1493061864-6jpy3x99lf.ap-guangzhou.tencentscf.com',  // 腾讯云函数地址（去掉 /exchange，末尾不加 /）

    // 游客（只读）登录：读取走腾讯云函数代理（只读令牌存在云函数环境变量 GITHUB_READ_TOKEN 里）
    // 配置了 proxyUrl 即显示「游客登录」按钮；无需在前端放令牌。
    // 不想开放「看全库」时改成 false，登录页就不显示游客按钮
    //（服务端要一起收紧的话，给云函数配 PUBLIC_READ_PATHS，见 tencent-scf/README.md）。
    guestRead: true,

    // 公开 QSL 登记：没有 GitHub 权限的人（或访客）无需登录即可提交 QSL 卡记录，
    // 提交页不加载、不显示任何已有数据，提交由云函数用环境变量里的令牌代写。
    // 数据落在下面这个「独立仓库」里（不是主数据库仓库），从根上隔离：
    // 写入用的令牌只授权这一个仓库，刷数据也碰不到主数据库。
    publicSubmit: true,

    // 公开登记专用仓库（与主数据库分开的独立仓库）
    // - 设为 Private：无权限的人只能「写」，看不到任何内容，全库也读不到这个仓库；
    // - 该仓库需要单独一个令牌（只授权它），放进云函数的 GITHUB_SUBMIT_TOKEN；
    // - 文件不存在时云函数首次提交会自动创建 data/qsl-public.json。
    publicRepo: {
      owner: 'Lily4046',
      repo: 'ham-radio-club-qsl',
      branch: 'main'
    },

    // 游客（只读浏览）是否也能看到「QSL 登记」这一栏：
    // 登记库是私有仓库，默认不给游客看（成员登录后才有）。想开放就改成 true。
    publicQslForGuest: false,

    // 成员读取数据是否走腾讯云函数代理。
    // 国内直连 api.github.com 常常要好几秒（有时直接卡住），打开这个开关后
    // 浏览器→腾讯云约 0.2 秒、腾讯云→GitHub 固定约 0.6 秒，列表加载会快很多。
    // 写入仍然用成员自己的令牌直连 GitHub，权限归属不变。
    readViaProxy: true,

    // 数据文件在仓库中的相对路径（一般无需修改）
    files: {
      lab: 'data/lab-items.json',
      qsl: 'data/qsl-cards.json',
      radio: 'data/radio-equipment.json',
      publicQsl: 'data/qsl-public.json'
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

  // 每个集合实际所在的仓库/分支/文件：publicQsl 走独立仓库，其余走主数据库。
  // 返回 { ck, owner, repo, branch, path }
  function repoFor(ck) {
    var cfg = getConfig();
    var main = {
      owner: cfg.owner,
      repo: cfg.repo,
      branch: cfg.branch
    };
    var target = main;
    if (ck === 'publicQsl' && cfg.publicRepo && cfg.publicRepo.repo) {
      target = {
        owner: cfg.publicRepo.owner || cfg.owner,
        repo: cfg.publicRepo.repo,
        branch: cfg.publicRepo.branch || cfg.branch
      };
    }
    return {
      ck: ck,
      owner: target.owner,
      repo: target.repo,
      branch: target.branch || 'main',
      path: cfg.files[ck],
      isPublicRepo: target !== main
    };
  }

  HAM.CONFIG = {
    DEFAULT: DEFAULT_CONFIG,
    get: getConfig,
    repoFor: repoFor,
    setOverrides: setOverrides,
    resetOverrides: resetOverrides
  };
})();
