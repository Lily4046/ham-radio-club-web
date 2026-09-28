/* =========================================================================
 * 通用 UI 工具：转义、格式化、toast、modal、确认框、loading
 * ========================================================================= */
(function () {
  'use strict';

  window.HAM = window.HAM || {};

  function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function formatDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return d.toLocaleString('zh-CN', { hour12: false });
  }

  function debounce(fn, ms) {
    var t;
    return function () {
      var args = arguments;
      var self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }

  /* ---------- 表单字段渲染（登录后的弹窗表单、公开登记页共用同一套） ---------- */
  function fieldHtml(f, value) {
    var v = (value === null || value === undefined) ? '' : value;
    var label = '<label>' + escapeHtml(f.label) + (f.required ? ' <span class="req">*</span>' : '') + '</label>';
    var attrs = ' data-key="' + escapeHtml(f.key) + '"';

    if (f.type === 'select') {
      var opts = (f.options || []).map(function (o) {
        return '<option value="' + escapeHtml(o) + '"' + (String(v) === String(o) ? ' selected' : '') + '>' + escapeHtml(o) + '</option>';
      }).join('');
      return '<div class="form-field">' + label +
        '<select' + attrs + '><option value="">— 请选择 —</option>' + opts + '</select></div>';
    }
    if (f.type === 'textarea') {
      return '<div class="form-field">' + label +
        '<textarea' + attrs + ' rows="3">' + escapeHtml(v) + '</textarea></div>';
    }
    if (f.type === 'number') {
      return '<div class="form-field">' + label +
        '<input type="number"' + attrs + ' value="' + escapeHtml(v) + '"></div>';
    }
    var inputType = (f.type === 'date' || f.type === 'time') ? f.type : 'text';
    return '<div class="form-field">' + label +
      '<input type="' + inputType + '"' + attrs + ' value="' + escapeHtml(v) + '"></div>';
  }

  function fieldsHtml(model, values) {
    values = values || {};
    return model.fields.map(function (f) { return fieldHtml(f, values[f.key]); }).join('');
  }

  // 从表单容器里读出所有 [data-key] 字段（值为字符串，交给 Models.normalize 规整）
  function readFields(root) {
    var out = {};
    root.querySelectorAll('[data-key]').forEach(function (el) {
      out[el.getAttribute('data-key')] = el.value;
    });
    return out;
  }

  /* ---------- toast ---------- */
  function toast(msg, type) {
    type = type || 'info';
    var root = document.getElementById('toastRoot');
    var el = document.createElement('div');
    el.className = 'toast toast-' + type;
    el.textContent = msg;
    root.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('show'); });
    setTimeout(function () {
      el.classList.remove('show');
      setTimeout(function () { el.remove(); }, 300);
    }, 3200);
  }

  /* ---------- modal ---------- */
  function openModal(title, bodyHtml) {
    closeModal();
    document.body.classList.add('modal-open');
    var root = document.getElementById('modalRoot');
    root.innerHTML =
      '<div class="modal-backdrop" data-close="modal"></div>' +
      '<div class="modal" role="dialog" aria-modal="true">' +
        '<div class="modal-head">' +
          '<h3>' + escapeHtml(title) + '</h3>' +
          '<button class="modal-close" data-close="modal" aria-label="关闭">×</button>' +
        '</div>' +
        '<div class="modal-body">' + bodyHtml + '</div>' +
      '</div>';
    root.querySelectorAll('[data-close="modal"]').forEach(function (el) {
      el.addEventListener('click', closeModal);
    });
    return root.querySelector('.modal');
  }

  function closeModal() {
    var root = document.getElementById('modalRoot');
    if (root) root.innerHTML = '';
    document.body.classList.remove('modal-open');
  }

  function confirmDialog(message) {
    return new Promise(function (resolve) {
      var el = openModal('请确认', '' +
        '<p class="confirm-text">' + escapeHtml(message) + '</p>' +
        '<div class="modal-actions">' +
          '<button class="btn btn-ghost" id="confirmNo">取消</button>' +
          '<button class="btn btn-danger" id="confirmYes">确认</button>' +
        '</div>');
      el.querySelector('#confirmYes').addEventListener('click', function () { closeModal(); resolve(true); });
      el.querySelector('#confirmNo').addEventListener('click', function () { closeModal(); resolve(false); });
    });
  }

  /* ---------- loading ---------- */
  function showLoading(on) {
    var bar = document.getElementById('loadingBar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'loadingBar';
      bar.className = 'loading-bar';
      document.body.appendChild(bar);
    }
    bar.classList.toggle('active', !!on);
  }

  HAM.UI = {
    escapeHtml: escapeHtml,
    formatDate: formatDate,
    debounce: debounce,
    fieldHtml: fieldHtml,
    fieldsHtml: fieldsHtml,
    readFields: readFields,
    toast: toast,
    openModal: openModal,
    closeModal: closeModal,
    confirmDialog: confirmDialog,
    showLoading: showLoading
  };
})();
