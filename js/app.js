/* =========================================================================
 * 应用入口：登录、导航、设置面板、标签页切换
 * ========================================================================= */
(function () {
  'use strict';

  window.HAM = window.HAM || {};

  var COLLECTIONS = ['lab', 'qsl', 'radio'];
  var currentCk = 'lab';

  /* ---------- 初始化 ---------- */
  function init() {
    var params = new URLSearchParams(window.location.search);

    // OAuth 回调
    if (params.get('code')) {
      showLogin();
      showOAuthLoading();
      HAM.Auth.handleOAuthCallback().then(function () {
        enterApp();
      }).catch(function (e) {
        hideOAuthLoading();
        showLoginError(e.message);
      });
      return;
    }

    if (HAM.Auth.isAuthed()) {
      enterApp();
    } else {
      showLogin();
    }
  }

  function showLogin() {
    document.getElementById('loginScreen').classList.remove('hidden');
    document.getElementById('appShell').classList.add('hidden');
  }

  function showApp() {
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('appShell').classList.remove('hidden');
  }

  function showLoginError(msg) {
    var el = document.getElementById('loginError');
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  function showOAuthLoading() {
    var el = document.getElementById('oauthLoading');
    if (el) el.classList.remove('hidden');
  }

  function hideOAuthLoading() {
    var el = document.getElementById('oauthLoading');
    if (el) el.classList.add('hidden');
  }

  /* ---------- 进入应用 ---------- */
  function enterApp() {
    showApp();
    renderUser();
    renderTabs();
    switchTab(currentCk);
    preloadAll();
  }

  // 登录后后台并行预加载其余模块，让第一次切换标签也秒开
  function preloadAll() {
    COLLECTIONS.forEach(function (ck) {
      if (HAM.Store.isCached(ck)) return;
      HAM.Store.load(ck).catch(function () {
        // 静默失败：真正切换过去时若仍失败会再次尝试并提示
      });
    });
  }

  function renderUser() {
    var u = HAM.Auth.getUser();
    var badge = document.getElementById('userBadge');
    if (u) {
      var avatar = u.avatar_url ? '<img src="' + HAM.UI.escapeHtml(u.avatar_url) + '" alt="">' : '';
      badge.innerHTML = avatar + '<span>' + HAM.UI.escapeHtml(u.login) + '</span>';
      badge.title = u.name || u.login;
    } else {
      badge.textContent = '';
    }
  }

  function renderTabs() {
    var tabs = document.getElementById('tabs');
    tabs.innerHTML = COLLECTIONS.map(function (ck) {
      var m = HAM.Models.MODELS[ck];
      return '<button class="tab" data-ck="' + ck + '">' + m.icon + ' ' + HAM.UI.escapeHtml(m.title) + '</button>';
    }).join('');
    tabs.querySelectorAll('.tab').forEach(function (t) {
      t.addEventListener('click', function () { switchTab(t.getAttribute('data-ck')); });
    });
  }

  function switchTab(ck) {
    currentCk = ck;
    document.querySelectorAll('.tab').forEach(function (t) {
      t.classList.toggle('active', t.getAttribute('data-ck') === ck);
    });
    // 已缓存的集合直接渲染，秒切换；未缓存的才走网络请求
    if (HAM.Store.isCached(ck)) {
      HAM.Views.renderCollection(ck);
      return;
    }
    HAM.UI.showLoading(true);
    HAM.Store.load(ck).then(function () {
      HAM.UI.showLoading(false);
      HAM.Views.renderCollection(ck);
    }).catch(function (e) {
      HAM.UI.showLoading(false);
      document.getElementById('viewContainer').innerHTML =
        '<div class="error-box">加载失败：' + HAM.UI.escapeHtml(e.message) + '</div>';
      HAM.UI.toast('加载失败：' + e.message, 'error');
    });
  }

  /* ---------- 登录表单绑定 ---------- */
  function bindLogin() {
    document.getElementById('btnLoginToken').addEventListener('click', function () {
      var token = document.getElementById('loginToken').value.trim();
      var err = document.getElementById('loginError');
      err.classList.add('hidden');
      if (!token) {
        showLoginError('请输入个人访问令牌（PAT）。');
        return;
      }
      this.disabled = true;
      this.textContent = '登录中…';
      HAM.Auth.loginWithToken(token).then(function () {
        enterApp();
      }).catch(function (e) {
        this.disabled = false;
        this.textContent = '使用令牌登录';
        showLoginError('登录失败：' + e.message);
      }.bind(this));
    }.bind(document.getElementById('btnLoginToken')));

    document.getElementById('btnLoginOAuth').addEventListener('click', function () {
      try {
        HAM.Auth.startOAuth();
      } catch (e) {
        showLoginError(e.message);
      }
    });

    document.getElementById('btnLoginGuest').addEventListener('click', function () {
      var err = document.getElementById('loginError');
      err.classList.add('hidden');
      HAM.Auth.loginAsGuest().then(function () {
        enterApp();
      }).catch(function (e) {
        showLoginError('游客登录失败：' + e.message);
      });
    });

    // 回车登录
    document.getElementById('loginToken').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') document.getElementById('btnLoginToken').click();
    });
  }

  /* ---------- 设置面板 ---------- */
  function bindSettings() {
    document.getElementById('btnSettings').addEventListener('click', openSettings);
  }

  function openSettings() {
    var cfg = HAM.CONFIG.get();
    var u = HAM.Auth.getUser();

    var modal = HAM.UI.openModal('⚙ 设置', '' +
      '<div class="settings-block">' +
        '<h4>当前身份</h4>' +
        '<p>' + (u ? '<img class="avatar" src="' + HAM.UI.escapeHtml(u.avatar_url) + '" alt=""> ' + HAM.UI.escapeHtml(u.login) : '未登录') + '</p>' +
      '</div>' +

      '<div class="settings-block">' +
        '<h4>访问令牌（PAT）</h4>' +
        '<div class="form-field"><input type="password" id="setToken" placeholder="ghp_...（留空则不变）"></div>' +
        '<button class="btn btn-primary" id="setSaveToken">更新令牌</button>' +
      '</div>' +

      '<div class="settings-block">' +
        '<h4>GitHub 账号登录（OAuth）</h4>' +
        '<button class="btn" id="setOAuth">使用 GitHub 账号登录</button>' +
        '<p class="muted small">' + (cfg.clientId ? '已配置 OAuth。' : '未配置 OAuth（config.js 中 clientId 为空）。') + '</p>' +
      '</div>' +

      '<div class="settings-block">' +
        '<h4>仓库配置（覆盖默认，仅存本机）</h4>' +
        '<div class="form-field"><label>owner（用户名/组织）</label><input id="setOwner" value="' + HAM.UI.escapeHtml(cfg.owner) + '"></div>' +
        '<div class="form-field"><label>repo（仓库名）</label><input id="setRepo" value="' + HAM.UI.escapeHtml(cfg.repo) + '"></div>' +
        '<div class="form-field"><label>branch（分支）</label><input id="setBranch" value="' + HAM.UI.escapeHtml(cfg.branch) + '"></div>' +
        '<div class="btn-row">' +
          '<button class="btn btn-primary" id="setSaveCfg">保存配置</button>' +
          '<button class="btn btn-ghost" id="setResetCfg">恢复默认</button>' +
        '</div>' +
      '</div>' +

      '<div class="settings-block">' +
        '<h4>连接诊断</h4>' +
        '<button class="btn" id="setTest">测试仓库连接</button>' +
        '<div id="testResult" class="small" style="margin-top:8px;"></div>' +
      '</div>' +

      '<div class="modal-actions">' +
        '<button class="btn btn-ghost" data-close="modal">关闭</button>' +
        '<button class="btn btn-danger" id="setLogout">退出登录</button>' +
      '</div>');

    modal.querySelector('#setSaveToken').addEventListener('click', function () {
      var token = modal.querySelector('#setToken').value.trim();
      if (!token) { HAM.UI.toast('请输入令牌', 'error'); return; }
      HAM.Auth.loginWithToken(token).then(function () {
        HAM.UI.closeModal();
        HAM.UI.toast('令牌已更新', 'success');
        enterApp();
      }).catch(function (e) {
        HAM.UI.toast('令牌无效：' + e.message, 'error');
      });
    });

    modal.querySelector('#setOAuth').addEventListener('click', function () {
      try {
        HAM.Auth.startOAuth();
      } catch (e) {
        HAM.UI.toast(e.message, 'error');
      }
    });

    modal.querySelector('#setSaveCfg').addEventListener('click', function () {
      HAM.CONFIG.setOverrides({
        owner: modal.querySelector('#setOwner').value.trim(),
        repo: modal.querySelector('#setRepo').value.trim(),
        branch: modal.querySelector('#setBranch').value.trim() || 'main'
      });
      HAM.UI.closeModal();
      HAM.UI.toast('配置已保存，重新加载数据…', 'success');
      switchTab(currentCk);
    });

    modal.querySelector('#setTest').addEventListener('click', function () {
      var btn = this;
      var out = modal.querySelector('#testResult');
      btn.disabled = true;
      btn.textContent = '检测中…';
      out.innerHTML = '';
      HAM.GitHub.getRepo().then(function (r) {
        var kind = r.private ? '私有' : '公开';
        var html = '✔ 仓库存在（' + kind + '），默认分支：<code>' + HAM.UI.escapeHtml(r.default_branch || '（无）') + '</code>';
        if (!r.size && !r.default_branch) {
          html += '<br><span class="error">⚠ 仓库为空（还没有任何提交）。请在 GitHub 网页上先创建第一个文件（如 README）。</span>';
          out.innerHTML = html;
          return;
        }
        if (r.default_branch && r.default_branch !== HAM.CONFIG.get().branch) {
          html += '<br><span class="error">⚠ 配置的 branch 是 <code>' + HAM.UI.escapeHtml(HAM.CONFIG.get().branch) +
            '</code>，但仓库默认分支是 <code>' + HAM.UI.escapeHtml(r.default_branch) + '</code>，请修改 config.js 的 branch。</span>';
          out.innerHTML = html;
          return;
        }
        html += '<br>✅ 分支匹配。';
        out.innerHTML = html + '<div id="contentsTest" style="margin-top:6px;">正在测试数据文件读取权限…</div>';
        return HAM.GitHub.readFileStatus(HAM.CONFIG.get().files.lab).then(function (status) {
          var t = document.getElementById('contentsTest');
          if (!t) return;
          if (status === 200) t.innerHTML = '✅ Contents 权限正常，数据文件可读取。';
          else if (status === 403) t.innerHTML = '<span class="error">⚠ 能访问仓库，但无 Contents 权限（403）。请在令牌设置中给 Contents 设「Read and write」。</span>';
          else if (status === 404) t.innerHTML = '⚠ 数据文件不存在（404，首次使用属正常，系统会自动创建）。若仓库已非空却仍报 404，可能是令牌缺 Contents 权限。';
          else t.innerHTML = '⚠ 读取测试返回状态码 ' + status;
        });
      }).catch(function (e) {
        var msg;
        if (e.status === 404) msg = '✘ 仓库不存在（404），或令牌无权访问该私有仓库。请检查 owner/repo，确认仓库已创建且非空。';
        else if (e.status === 401) msg = '✘ 令牌无效（401），请重新登录。';
        else if (e.status === 403) msg = '✘ 无权限（403），令牌缺少 repo 权限。';
        else msg = '✘ ' + e.message;
        out.innerHTML = '<span class="error">' + HAM.UI.escapeHtml(msg) + '</span>';
        if (e.status === 404) {
          HAM.GitHub.listMyRepos().then(function (repos) {
            var names = (repos || []).map(function (r) { return r.name; });
            var list = names.length ? names.join('、') : '（无）';
            out.innerHTML += '<div style="margin-top:8px;">当前令牌可见的仓库：<code>' + HAM.UI.escapeHtml(list) + '</code></div>';
          }).catch(function () { /* 忽略列表失败 */ });
        }
      }).finally(function () {
        btn.disabled = false;
        btn.textContent = '测试仓库连接';
      });
    });

    modal.querySelector('#setResetCfg').addEventListener('click', function () {
      HAM.CONFIG.resetOverrides();
      HAM.UI.closeModal();
      HAM.UI.toast('已恢复默认配置', 'info');
      switchTab(currentCk);
    });

    modal.querySelector('#setLogout').addEventListener('click', function () {
      HAM.Auth.logout();
      HAM.UI.closeModal();
      location.reload();
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    bindLogin();
    bindSettings();
    applyLoginMode();
    init();
  });

  // 仅当 OAuth 三项（clientId/redirectUri/proxyUrl）都配齐时才显示「使用 GitHub 账号登录」按钮
  function applyLoginMode() {
    var cfg = HAM.CONFIG.get();
    var oauthReady = !!(cfg.clientId && cfg.redirectUri && cfg.proxyUrl);
    if (!oauthReady) {
      var oauthBtn = document.getElementById('btnLoginOAuth');
      var divider = document.getElementById('loginDivider');
      if (oauthBtn) oauthBtn.classList.add('hidden');
      if (divider) divider.classList.add('hidden');
    }
    // 游客登录：配置了 guestToken 才显示
    var guestBtn = document.getElementById('btnLoginGuest');
    if (guestBtn) {
      if (cfg.guestToken) guestBtn.classList.remove('hidden');
      else guestBtn.classList.add('hidden');
    }
  }
})();
