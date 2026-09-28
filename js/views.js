/* =========================================================================
 * 视图层：三个数据集合的表格渲染、搜索、增删改表单、变更记录、导出
 * ========================================================================= */
(function () {
  'use strict';

  window.HAM = window.HAM || {};

  var currentCk = 'lab';
  var filters = {};                            // 字段筛选：{ fieldKey: value }，空值表示全部
  var sortState = { key: null, dir: 1 };       // 当前排序列与方向（1 升序 / -1 降序）

  function currentKey() {
    return currentCk;
  }

  function displayValue(v) {
    if (v === null || v === undefined || v === '') return '—';
    return v;
  }

  /* ---------- 筛选 / 排序 / 查重辅助 ---------- */
  function distinctValues(items, key) {
    var set = {};
    items.forEach(function (it) {
      var v = it[key];
      if (v !== null && v !== undefined && String(v).trim() !== '') set[String(v).trim()] = true;
    });
    return Object.keys(set).sort(function (a, b) { return a.localeCompare(b, 'zh-CN'); });
  }

  function fieldType(model, key) {
    var f = model.fields.filter(function (x) { return x.key === key; })[0];
    return f ? f.type : '';
  }

  function compareValues(a, b, type) {
    var av = (a === null || a === undefined) ? '' : a;
    var bv = (b === null || b === undefined) ? '' : b;
    if (av === '' && bv === '') return 0;
    if (av === '') return 1;   // 空值排最后（升序）
    if (bv === '') return -1;
    if (type === 'number') {
      var an = Number(av), bn = Number(bv);
      if (isFinite(an) && isFinite(bn)) return an - bn;
    }
    if (typeof av === 'number' && typeof bv === 'number') return av - bv;
    var as = String(av), bs = String(bv);
    // 只有日期/时间列按时间先后比较（否则 "3" 会被 Date.parse 当成 2001-03，排序错乱）
    if (type === 'date' || type === 'time') {
      var ad = Date.parse(as), bd = Date.parse(bs);
      if (!isNaN(ad) && !isNaN(bd)) return ad - bd;
    }
    return as.localeCompare(bs, 'zh-CN');
  }

  function findDuplicate(ck, patch, excludeId) {
    var model = HAM.Models.MODELS[ck];
    if (!model.dedup || !model.dedup.fields || !model.dedup.fields.length) return null;
    var data = HAM.Store.getCached(ck);
    var items = data ? data.items : [];
    function norm(v) { return String(v === null || v === undefined ? '' : v).trim().toLowerCase(); }
    var cmpKeys = model.dedup.fields.filter(function (k) { return norm(patch[k]) !== ''; });
    if (!cmpKeys.length) return null;
    return items.find(function (it) {
      if (excludeId && it.id === excludeId) return false;
      return cmpKeys.every(function (k) { return norm(it[k]) === norm(patch[k]); });
    }) || null;
  }

  /* ---------- 渲染主视图 ---------- */
  function renderCollection(ck) {
    currentCk = ck;
    filters = {};
    var model = HAM.Models.MODELS[ck];
    var isGuest = HAM.Auth.isGuest();
    // 默认排序：模型配置了 defaultSort 就用它，否则不排序
    sortState = (model.defaultSort) ? { key: model.defaultSort.key, dir: model.defaultSort.dir } : { key: null, dir: 1 };

    var container = document.getElementById('viewContainer');
    container.innerHTML =
      '<div class="toolbar">' +
        '<h2>' + model.icon + ' ' + HAM.UI.escapeHtml(model.title) + '</h2>' +
        '<div class="toolbar-right">' +
          '<input type="search" id="searchInput" class="search" placeholder="搜索…">' +
          '<button class="btn btn-ghost" id="btnRefresh">↻ 刷新</button>' +
          (HAM.Auth.isAdmin() ? '<button class="btn btn-ghost" id="btnHistory">🕘 变更记录</button>' : '') +
          (isGuest || ck !== 'publicQsl' ? '' : '<button class="btn btn-ghost" id="btnImport">📥 并入 QSL 卡</button>') +
          '<button class="btn btn-ghost" id="btnExport">⬇ 导出</button>' +
          (isGuest ? '' : '<button class="btn btn-primary" id="btnAdd">＋ 新增</button>') +
        '</div>' +
      '</div>' +
      (isGuest ? '<div class="guest-banner">👀 游客只读模式：仅可查看，无法新增 / 编辑 / 删除。</div>' : '') +
      '<div class="filter-bar" id="filterBar"></div>' +
      '<div class="meta-line" id="metaLine"></div>' +
      '<div class="table-wrap">' +
        '<table class="data-table">' +
          '<thead><tr>' +
            model.fields.map(function (f) {
              return '<th data-sort="' + HAM.UI.escapeHtml(f.key) + '" class="sortable">' +
                HAM.UI.escapeHtml(f.label) + '<span class="sort-arrow"></span></th>';
            }).join('') +
            '<th data-sort="updatedAt" class="sortable">更新人 / 时间<span class="sort-arrow"></span></th>' +
            '<th class="actions-col">操作</th>' +
          '</tr></thead>' +
          '<tbody id="tableBody"></tbody>' +
        '</table>' +
      '</div>' +
      '<div id="emptyState" class="empty hidden">暂无数据，点击右上角「新增」开始录入。</div>';

    renderFilterBar(ck);
    renderRows();
    updateCount();
    bindToolbar(ck);
    bindSort();
  }

  function renderRows() {
    var model = HAM.Models.MODELS[currentCk];
    var data = HAM.Store.getCached(currentCk);
    var items = data ? data.items : [];
    // 先同步筛选下拉（选项变化时可能清掉已失效的筛选值），再据此过滤，保证表格与筛选栏一致
    syncFilterOptions();
    var q = (document.getElementById('searchInput').value || '').trim().toLowerCase();

    var filtered = items.filter(function (it) {
      if (q && JSON.stringify(it).toLowerCase().indexOf(q) === -1) return false;
      var keys = Object.keys(filters);
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        if (!filters[k]) continue;
        var v = (it[k] === undefined || it[k] === null) ? '' : String(it[k]).trim();
        if (v !== filters[k]) return false;
      }
      return true;
    });

    if (sortState.key) {
      var key = sortState.key;
      var dir = sortState.dir;
      var type = (key === 'updatedAt') ? 'date' : fieldType(model, key);
      filtered.sort(function (a, b) { return compareValues(a[key], b[key], type) * dir; });
    }

    var body = document.getElementById('tableBody');
    body.innerHTML = filtered.map(function (it) { return rowHtml(model, it); }).join('');

    var empty = document.getElementById('emptyState');
    if (empty) {
      empty.classList.toggle('hidden', filtered.length > 0);
      if (filtered.length === 0) {
        empty.textContent = items.length > 0 ? '没有符合当前搜索/筛选条件的记录。' : '暂无数据，点击右上角「新增」开始录入。';
      }
    }

    var hint = document.getElementById('filterHint');
    if (hint) {
      var active = !!q || Object.keys(filters).some(function (k) { return !!filters[k]; });
      hint.textContent = active ? ('筛选/搜索后 ' + filtered.length + ' / 共 ' + items.length + ' 条') : '';
    }

    body.querySelectorAll('[data-action]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        handleAction(btn.getAttribute('data-action'), btn.getAttribute('data-id'));
      });
    });
  }

  function rowHtml(model, it) {
    var cells = model.fields.map(function (f) {
      return '<td data-label="' + HAM.UI.escapeHtml(f.label) + '">' + HAM.UI.escapeHtml(displayValue(it[f.key])) + '</td>';
    }).join('');
    var meta = HAM.UI.escapeHtml(it.updatedBy || '—') + ' · ' + HAM.UI.escapeHtml(HAM.UI.formatDate(it.updatedAt));
    return '<tr>' +
      cells +
      '<td data-label="更新">' + meta + '</td>' +
      '<td class="actions-col">' +
        (HAM.Auth.isGuest()
          ? '<span class="muted">只读</span>'
          : '<button class="btn btn-sm" data-action="edit" data-id="' + HAM.UI.escapeHtml(it.id) + '">编辑</button> ' +
            '<button class="btn btn-sm btn-danger" data-action="del" data-id="' + HAM.UI.escapeHtml(it.id) + '">删除</button>') +
      '</td>' +
      '</tr>';
  }

  function bindToolbar(ck) {
    var search = document.getElementById('searchInput');
    search.addEventListener('input', HAM.UI.debounce(renderRows, 200));

    document.getElementById('btnRefresh').addEventListener('click', function () { refreshCurrent(); });
    var addBtn = document.getElementById('btnAdd');
    if (addBtn) addBtn.addEventListener('click', function () { showForm(ck, null); });
    var historyBtn = document.getElementById('btnHistory');
    if (historyBtn) historyBtn.addEventListener('click', function () { showHistory(ck); });
    var importBtn = document.getElementById('btnImport');
    if (importBtn) importBtn.addEventListener('click', function () { importPublicQsl(); });
    document.getElementById('btnExport').addEventListener('click', function () { exportData(ck); });
  }

  /* ---------- 筛选栏 ---------- */
  function renderFilterBar(ck) {
    var model = HAM.Models.MODELS[ck];
    var selectFields = model.fields.filter(function (f) { return f.type === 'select'; });
    var bar = document.getElementById('filterBar');
    if (!bar) return;

    if (!selectFields.length) {
      bar.innerHTML = '';
      return;
    }

    bar.innerHTML =
      '<span class="filter-label">筛选：</span>' +
      selectFields.map(function (f) {
        return '<select class="filter-select" data-filter-key="' + HAM.UI.escapeHtml(f.key) +
          '" data-filter-label="' + HAM.UI.escapeHtml(f.label) + '"></select>';
      }).join('') +
      '<button class="btn btn-sm btn-ghost" id="btnClearFilter">✕ 清除</button>' +
      '<span class="filter-hint muted small" id="filterHint"></span>';

    syncFilterOptions();

    bar.querySelectorAll('.filter-select').forEach(function (sel) {
      sel.addEventListener('change', function () {
        filters[sel.getAttribute('data-filter-key')] = sel.value;
        renderRows();
      });
    });

    var clearBtn = bar.querySelector('#btnClearFilter');
    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        filters = {};
        bar.querySelectorAll('.filter-select').forEach(function (s) { s.value = ''; });
        renderRows();
      });
    }
  }

  function syncFilterOptions() {
    var data = HAM.Store.getCached(currentCk);
    var items = data ? data.items : [];
    document.querySelectorAll('#filterBar .filter-select').forEach(function (sel) {
      var key = sel.getAttribute('data-filter-key');
      var label = sel.getAttribute('data-filter-label') || key;
      var distinct = distinctValues(items, key);
      // 选项没变化就不重建 DOM（搜索时每次按键都重建 select 会打断下拉、也没必要）
      var signature = label + '\u0000' + distinct.join('\u0001');
      if (sel.getAttribute('data-sig') !== signature) {
        sel.setAttribute('data-sig', signature);
        sel.innerHTML = '<option value="">' + HAM.UI.escapeHtml(label) + '：全部</option>' +
          distinct.map(function (v) {
            return '<option value="' + HAM.UI.escapeHtml(v) + '">' + HAM.UI.escapeHtml(v) + '</option>';
          }).join('');
      }
      var selected = sel.value;
      // 之前选中的值已经被删光 → 同步清掉筛选条件，避免「界面显示全部、结果却是空」的错位
      if (selected && distinct.indexOf(selected) === -1) {
        selected = '';
        if (filters[key]) filters[key] = '';
      }
      if (sel.value !== selected) sel.value = selected;
    });
  }

  /* ---------- 表头排序 ---------- */
  function bindSort() {
    document.querySelectorAll('th[data-sort]').forEach(function (th) {
      th.addEventListener('click', function () {
        var key = th.getAttribute('data-sort');
        if (sortState.key === key) {
          sortState.dir = sortState.dir === 1 ? -1 : 1;
        } else {
          sortState.key = key;
          sortState.dir = 1;
        }
        renderSortIndicators();
        renderRows();
      });
    });
  }

  function renderSortIndicators() {
    document.querySelectorAll('th[data-sort]').forEach(function (th) {
      var key = th.getAttribute('data-sort');
      var arrow = th.querySelector('.sort-arrow');
      if (!arrow) return;
      if (sortState.key === key) {
        arrow.textContent = sortState.dir === 1 ? ' ▲' : ' ▼';
        th.classList.add('sorted');
      } else {
        arrow.textContent = '';
        th.classList.remove('sorted');
      }
    });
  }

  function refreshCurrent() {
    var ck = currentCk;
    HAM.UI.showLoading(true);
    HAM.Store.refresh(ck).then(function () {
      HAM.UI.showLoading(false);
      renderRows();
      updateCount();
      HAM.UI.toast('已刷新', 'success');
    }).catch(function (e) {
      HAM.UI.showLoading(false);
      HAM.UI.toast('刷新失败：' + e.message, 'error');
    });
  }

  function handleAction(action, id) {
    var data = HAM.Store.getCached(currentCk);
    if (!data) {
      HAM.UI.toast('数据尚未加载，请刷新后重试。', 'error');
      return;
    }
    var item = data.items.find(function (x) { return x.id === id; });
    if (!item) {
      HAM.UI.toast('该记录已不存在，请刷新。', 'error');
      return;
    }
    if (action === 'edit') {
      showForm(currentCk, item);
    } else if (action === 'del') {
      deleteItem(currentCk, item);
    }
  }

  /* ---------- 新增 / 编辑表单 ---------- */
  function showForm(ck, item) {
    var model = HAM.Models.MODELS[ck];
    var isEdit = !!item;
    var values = item ? Object.assign({}, item) : HAM.Models.newItem(ck);
    var fieldsHtml = HAM.UI.fieldsHtml(model, values);

    var modal = HAM.UI.openModal((isEdit ? '编辑' : '新增') + ' · ' + model.title, '' +
      '<form id="itemForm" onsubmit="return false;">' + fieldsHtml +
        '<div id="dedupWarn" class="dedup-warn hidden"></div>' +
        '<div class="modal-actions">' +
          '<button type="button" class="btn btn-ghost" data-close="modal">取消</button>' +
          '<button type="submit" class="btn btn-primary" id="btnSave">保存</button>' +
        '</div>' +
      '</form>');

    var btn = modal.querySelector('#btnSave');
    var dedupWarn = modal.querySelector('#dedupWarn');
    var dedupOverride = false;

    // 修改任一字段后，重置「忽略查重」状态，让下次保存重新查重
    modal.querySelector('#itemForm').addEventListener('input', function () {
      if (dedupOverride) {
        dedupOverride = false;
        if (dedupWarn) dedupWarn.classList.add('hidden');
        btn.textContent = '保存';
      }
    });

    modal.querySelector('#itemForm').addEventListener('submit', function (ev) {
      ev.preventDefault();
      // 表单取到的都是字符串，按字段类型规整后再校验/保存
      var patch = HAM.Models.normalize(ck, HAM.UI.readFields(modal.querySelector('#itemForm')));

      var errors = HAM.Models.validate(ck, patch);
      if (errors.length) {
        HAM.UI.toast(errors[0], 'error');
        return;
      }

      // 查重：命中且尚未确认忽略时，先提示、要求二次点击确认
      if (!dedupOverride) {
        var dup = findDuplicate(ck, patch, isEdit ? item.id : null);
        if (dup) {
          dedupOverride = true;
          var dupName = dup.callsign || dup[model.fields[0].key] || '—';
          dedupWarn.innerHTML = '⚠ 疑似重复：已存在「' +
            HAM.UI.escapeHtml(model.dedup ? model.dedup.label : '查重字段') +
            '」相同的记录（对方呼号「' + HAM.UI.escapeHtml(String(dupName)) + '」）。再次点击「保存」将忽略查重并保存。';
          dedupWarn.classList.remove('hidden');
          btn.textContent = '确认保存（忽略查重）';
          return;
        }
      }

      var user = HAM.Auth.getUser();
      var login = user ? user.login : '匿名';

      btn.disabled = true;
      btn.textContent = '保存中…';

      var p;
      if (isEdit) {
        patch.updatedAt = new Date().toISOString();
        patch.updatedBy = login;
        p = HAM.Store.updateItem(ck, item.id, patch, '更新 ' + model.title + '：' + patch[model.fields[0].key]);
      } else {
        var newRec = HAM.Models.newItem(ck);
        Object.keys(patch).forEach(function (k) { newRec[k] = patch[k]; });
        newRec.updatedAt = new Date().toISOString();
        newRec.updatedBy = login;
        p = HAM.Store.addItem(ck, newRec, '新增 ' + model.title + '：' + newRec[model.fields[0].key]);
      }

      p.then(function () {
        HAM.UI.closeModal();
        HAM.UI.toast('保存成功', 'success');
        renderRows();
        updateCount();
      }).catch(function (e) {
        btn.disabled = false;
        btn.textContent = '保存';
        HAM.UI.toast('保存失败：' + e.message, 'error');
      });
    });
  }

  function updateCount() {
    var model = HAM.Models.MODELS[currentCk];
    var data = HAM.Store.getCached(currentCk);
    var items = data ? data.items : [];
    var line = document.getElementById('metaLine');
    if (!line) return;

    var html = '共 <strong>' + items.length + '</strong> 条记录';
    if (model.stats) {
      var s = model.stats;
      var pos = items.filter(function (it) { return it[s.field] === s.positive; }).length;
      var neg = items.length - pos;
      var rate = items.length ? (pos / items.length * 100).toFixed(1) : '0.0';
      html += ' · ' + HAM.UI.escapeHtml(s.title) + '：' +
        '<span class="stat stat-ok">' + HAM.UI.escapeHtml(s.positiveLabel) + ' <strong>' + pos + '</strong></span>' +
        '<span class="stat stat-warn">' + HAM.UI.escapeHtml(s.negativeLabel) + ' <strong>' + neg + '</strong></span>' +
        '<span class="stat">' + HAM.UI.escapeHtml(s.rateLabel) + ' <strong>' + rate + '%</strong></span>';
    }
    line.innerHTML = html;
  }

  /* ---------- 删除 ---------- */
  function deleteItem(ck, item) {
    var model = HAM.Models.MODELS[ck];
    var name = item[model.fields[0].key] || item.id;
    HAM.UI.confirmDialog('确定要删除「' + name + '」吗？此操作不可撤销。').then(function (ok) {
      if (!ok) return;
      HAM.UI.showLoading(true);
      return HAM.Store.removeItem(ck, item.id, '删除 ' + model.title + '：' + name).then(function () {
        HAM.UI.showLoading(false);
        HAM.UI.toast('已删除', 'success');
        renderRows();
        updateCount();
      }).catch(function (e) {
        HAM.UI.showLoading(false);
        HAM.UI.toast('删除失败：' + e.message, 'error');
      });
    });
  }

  /* ---------- 变更记录 ---------- */
  function showHistory(ck) {
    var t = HAM.CONFIG.repoFor(ck);
    HAM.UI.showLoading(true);
    HAM.GitHub.listCommits(t.path, t).then(function (commits) {
      HAM.UI.showLoading(false);
      var list = (commits || []).map(function (c) {
        var sha = (c.sha || '').slice(0, 7);
        var author = c.commit && c.commit.author ? c.commit.author.name : '—';
        var date = c.commit && c.commit.author ? HAM.UI.formatDate(c.commit.author.date) : '—';
        var msg = c.commit ? c.commit.message : '';
        var url = c.html_url || '#';
        return '<li class="commit-item">' +
          '<a href="' + HAM.UI.escapeHtml(url) + '" target="_blank" rel="noopener">' + HAM.UI.escapeHtml(msg) + '</a>' +
          '<div class="commit-meta">' + HAM.UI.escapeHtml(author) + ' · ' + HAM.UI.escapeHtml(date) + ' · <code>' + sha + '</code></div>' +
          '</li>';
      }).join('');
      HAM.UI.openModal('变更记录 · ' + HAM.Models.MODELS[ck].title +
        (t.isPublicRepo ? '（登记库 ' + t.owner + '/' + t.repo + '）' : ''), '' +
        (list ? '<ul class="commit-list">' + list + '</ul>' : '<p class="muted">暂无提交记录。</p>'));
    }).catch(function (e) {
      HAM.UI.showLoading(false);
      HAM.UI.toast('获取记录失败：' + e.message, 'error');
    });
  }

  /* ---------- 公开登记 → 并入 QSL 卡 ---------- */
  function importPublicQsl() {
    var pending = HAM.Store.getCached('publicQsl');
    // 复制一份：并入过程中登记库会被就地清空，直接引用原数组会算错条数
    var items = ((pending && pending.items) || []).slice();
    var total = items.length;
    if (!total) {
      HAM.UI.toast('公开登记库是空的，没有需要并入的记录。', 'info');
      return;
    }
    var user = HAM.Auth.getUser();
    var login = user ? user.login : '';

    HAM.UI.confirmDialog('确定把公开登记库的 ' + total +
      ' 条记录并入「QSL 卡」，并从登记库删除吗？').then(function (ok) {
      if (!ok) return;
      HAM.UI.showLoading(true);
      // 先加载主库：并入时要靠 sourceId 判断哪些之前已经并入过
      return HAM.Store.load('qsl').then(function () {
        var main = HAM.Store.getCached('qsl');
        var imported = {};
        ((main && main.items) || []).forEach(function (it) {
          if (it.sourceId) imported[it.sourceId] = true;
        });
        var fresh = items.filter(function (it) { return !imported[it.id]; });
        var records = fresh.map(function (it) { return HAM.Models.toQslFromPublic(it, login); });
        var allIds = items.map(function (it) { return it.id; });

        return HAM.Store.addMany('qsl', records, '并入公开登记 ' + records.length + ' 条')
          .then(function () {
            // 主库写成功后再清理登记库；这一步失败也不会重复并入（有 sourceId 兜底）
            return HAM.Store.removeMany('publicQsl', allIds, '公开登记已并入 QSL 卡');
          })
          .then(function () {
            HAM.UI.showLoading(false);
            renderRows();
            updateCount();
            var extra = total - records.length;
            HAM.UI.toast('已并入 ' + records.length + ' 条' +
              (extra ? '（另有 ' + extra + ' 条之前已并入，一并清理）' : ''), 'success');
          });
      }).catch(function (e) {
        HAM.UI.showLoading(false);
        HAM.UI.toast('并入失败：' + e.message, 'error');
      });
    });
  }

  /* ---------- 导出 ---------- */
  function exportData(ck) {
    var data = HAM.Store.getCached(ck);
    var model = HAM.Models.MODELS[ck];
    if (!data) return;
    var json = JSON.stringify(data, null, 2);
    var blob = new Blob([json], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = ck + '-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
    HAM.UI.toast('已导出 ' + model.title, 'success');
  }

  HAM.Views = {
    currentKey: currentKey,
    renderCollection: renderCollection,
    renderRows: renderRows
  };
})();
