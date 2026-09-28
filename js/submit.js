/* =========================================================================
 * 公开 QSL 登记页
 * -------------------------------------------------------------------------
 * 给「没有 GitHub 权限的人」（含未登录访客）用的独立页面：
 *   - 只能提交一条 QSL 卡记录，不加载、不显示任何已有数据
 *   - 提交经云函数 /submit 代写，前端不接触任何令牌
 *   - 入口：登录页「📝 QSL 卡登记」按钮，或站点 ?submit=1 / #submit
 * ========================================================================= */
(function () {
  'use strict';

  window.HAM = window.HAM || {};

  var CK = 'publicQsl';

  function wrap() {
    return document.getElementById('submitFormWrap');
  }

  function todayLocal() {
    var d = new Date();
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function open() {
    var login = document.getElementById('loginScreen');
    var app = document.getElementById('appShell');
    var screen = document.getElementById('submitScreen');
    if (!screen) return;
    if (login) login.classList.add('hidden');
    if (app) app.classList.add('hidden');
    screen.classList.remove('hidden');
    renderForm();
  }

  function close() {
    var screen = document.getElementById('submitScreen');
    if (screen) screen.classList.add('hidden');
  }

  function backToLogin() {
    close();
    if (HAM.App && HAM.App.showLogin) HAM.App.showLogin();
  }

  function showError(form, msg) {
    var el = form.querySelector('#pubError');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  /* ---------- 表单 ---------- */
  function renderForm() {
    var model = HAM.Models.MODELS[CK];
    var root = wrap();
    if (!root) return;

    root.innerHTML =
      '<p class="muted small">无需登录即可登记一张 QSL 卡。' +
        '提交后由管理员核对并入账，这里<b>不会显示任何已有记录</b>。</p>' +
      '<form id="publicQslForm" onsubmit="return false;" autocomplete="off">' +
        HAM.UI.fieldsHtml(model, { date: todayLocal() }) +
        // 蜜罐：正常用户看不到也不会填，填了的一律当成机器人
        '<div style="position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden;" aria-hidden="true">' +
          '<label for="pubHp">网址</label>' +
          '<input type="text" id="pubHp" name="website" tabindex="-1" autocomplete="off">' +
        '</div>' +
        '<p id="pubError" class="error hidden"></p>' +
        '<button type="submit" class="btn btn-primary btn-block" id="pubSave">提交登记</button>' +
      '</form>' +
      '<button type="button" class="btn btn-ghost btn-block" id="pubBack" style="margin-top:10px;">← 返回登录</button>';

    var form = root.querySelector('#publicQslForm');
    var btn = root.querySelector('#pubSave');
    root.querySelector('#pubBack').addEventListener('click', backToLogin);

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var errEl = form.querySelector('#pubError');
      errEl.classList.add('hidden');

      var record = HAM.Models.normalize(CK, HAM.UI.readFields(form));
      var errors = HAM.Models.validate(CK, record);
      if (errors.length) {
        showError(form, errors[0]);
        return;
      }

      btn.disabled = true;
      btn.textContent = '提交中…';
      HAM.GitHub.submitPublicQsl(record, form.querySelector('#pubHp').value)
        .then(function (r) {
          renderDone(r && r.id);
        })
        .catch(function (e) {
          btn.disabled = false;
          btn.textContent = '提交登记';
          // 云函数还没更新到 /submit 时是 404，给一句能看懂的话
          var msg = (e.status === 404) ? '登记接口尚未部署，请联系管理员重新部署云函数后再试。' : e.message;
          showError(form, '提交失败：' + msg);
        });
    });
  }

  /* ---------- 提交成功 ---------- */
  function renderDone(id) {
    var root = wrap();
    if (!root) return;
    root.innerHTML =
      '<div class="done-box">' +
        '<p><b>✅ 登记已提交，感谢！</b></p>' +
        '<p class="small">管理员核对后会并入社团的 QSL 台账，无需重复提交。</p>' +
        (id ? '<p class="small">登记编号：<code>' + HAM.UI.escapeHtml(id) + '</code></p>' : '') +
      '</div>' +
      '<button type="button" class="btn btn-primary btn-block" id="pubAgain">再登记一张</button>' +
      '<button type="button" class="btn btn-ghost btn-block" id="pubBack" style="margin-top:10px;">← 返回登录</button>';
    root.querySelector('#pubAgain').addEventListener('click', renderForm);
    root.querySelector('#pubBack').addEventListener('click', backToLogin);
  }

  HAM.Submit = {
    open: open,
    close: close
  };
})();
