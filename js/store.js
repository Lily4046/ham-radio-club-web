/* =========================================================================
 * 数据仓库层
 * -------------------------------------------------------------------------
 * 把「三类数据 JSON 文件」映射为内存中的可编辑集合，并负责：
 *   - load        从 GitHub 读取（文件不存在时自动初始化空文件）
 *   - addItem     新增一条记录
 *   - updateItem  更新一条记录
 *   - removeItem  删除一条记录
 *   - 乐观并发 + 冲突合并：写入携带 sha，若他人同时修改（HTTP 409），
 *     自动重新拉取并做按 id 的三方合并后重试，尽量不覆盖他人改动。
 * ========================================================================= */
(function () {
  'use strict';

  window.HAM = window.HAM || {};

  // 每个集合的内存缓存：{ data: {items:[]}, sha, base: [] }
  var cache = {};

  function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function deepEqual(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  // 判断是否为可重试的瞬时错误（网络抖动 / 限流 / 5xx）；确定性错误（404/403/422）不重试
  function isTransient(e) {
    return !e || !e.status || e.status === 429 || (e.status >= 500 && e.status < 600);
  }

  // 简单重试：仅对瞬时错误重试，避免偶发网络问题导致「刚切换就报错」
  function retry(fn, times) {
    return fn().catch(function (e) {
      if (times <= 0 || !isTransient(e)) throw e;
      return new Promise(function (resolve) {
        setTimeout(function () { resolve(retry(fn, times - 1)); }, 600);
      });
    });
  }

  /* ---------- 错误信息友好化 ---------- */
  function friendly(e, path) {
    if (!e || !e.status) return e;
    if (e.status === 401) {
      return new Error('认证失败（401）：访问令牌无效或已过期，请重新登录。');
    }
    if (e.status === 403) {
      return new Error('无权限（403）：令牌缺少 repo 权限，或未授权访问该仓库。');
    }
    if (e.status === 404) {
      return new Error('找不到仓库或文件（404）：请检查 owner/repo/branch 配置与令牌权限（私有仓库无权限时也会返回 404）。文件路径：' + path);
    }
    return e;
  }

  function ensure(ck) {
    if (!cache[ck]) {
      throw new Error('数据尚未加载，请先调用 load()。');
    }
    return cache[ck];
  }

  /* ---------- 加载 ---------- */
  var inflight = {};

  function load(ck, force) {
    var cfg = HAM.CONFIG.get();
    var path = cfg.files[ck];

    // 命中缓存时直接返回，避免每次切换标签都重新请求 GitHub（切换菜单慢的主因）
    if (!force && cache[ck]) {
      return Promise.resolve(cache[ck].data);
    }

    // 去重：同一集合的并发加载共享同一个 Promise，避免预加载与点击切换重复请求
    if (!force && inflight[ck]) {
      return inflight[ck];
    }

    var p = retry(function () { return HAM.GitHub.readFile(path); }, 1).then(function (r) {
      if (!r.exists) {
        var empty = { items: [] };
        return retry(function () { return HAM.GitHub.writeFile(path, empty, null, '初始化 ' + path); }, 2).then(function (sha) {
          cache[ck] = { data: empty, sha: sha, base: [] };
          return empty;
        }).catch(function (e) {
          var hint = '';
          if (e && e.status === 404) {
            hint = ' 可能是：仓库不存在、仓库为空（还没有任何提交/分支）、或 branch 填错（main/master）。请在「设置 → 测试仓库连接」确认。';
          } else if (e && e.status === 403) {
            hint = ' 可能是：令牌缺少写权限（需 Contents: Read and write 或 repo 权限）。';
          } else if (e && e.status === 422) {
            hint = ' 可能是：branch 名称与仓库默认分支不一致。';
          }
          throw new Error('数据文件不存在且无法自动创建。' + hint + ' 原始错误：' + e.message);
        });
      }

      var data = r.data;
      if (Array.isArray(data)) {
        data = { items: data }; // 兼容裸数组格式
      }
      if (!data || !Array.isArray(data.items)) {
        data = { items: [] };
      }
      cache[ck] = { data: data, sha: r.sha, base: deepClone(data.items) };
      return data;
    }).catch(function (e) {
      throw friendly(e, path);
    });

    if (!force) {
      inflight[ck] = p;
      p.then(function () { delete inflight[ck]; }, function () { delete inflight[ck]; });
    }
    return p;
  }

  function getCached(ck) {
    return cache[ck] ? cache[ck].data : null;
  }

  // 是否已缓存（用于切换标签时跳过网络请求）
  function isCached(ck) {
    return !!cache[ck];
  }

  // 强制重新从 GitHub 拉取（手动刷新 / 查看他人改动）
  function refresh(ck) {
    return load(ck, true);
  }

  /* ---------- 按 id 的三方合并 ---------- */
  function mergeItems(base, local, latest) {
    var latestMap = new Map();
    var baseMap = new Map();
    var localMap = new Map();
    var result = [];
    var seen = new Set();

    latest.forEach(function (it) { latestMap.set(it.id, it); });
    base.forEach(function (it) { baseMap.set(it.id, it); });
    local.forEach(function (it) { localMap.set(it.id, it); });

    // 遍历本地顺序
    local.forEach(function (locItem) {
      var id = locItem.id;
      var baseItem = baseMap.get(id);
      var latItem = latestMap.get(id);

      if (baseItem === undefined) {
        // 本地新增
        if (latItem === undefined) {
          result.push(locItem);
        } else if (deepEqual(locItem, latItem)) {
          result.push(latItem);
        } else {
          result.push(latItem); // id 冲突，保留远端
        }
      } else if (latItem === undefined) {
        // 远端已删除该条
        if (deepEqual(baseItem, locItem)) {
          // 本地未改动 → 尊重远端删除（跳过）
        } else {
          result.push(locItem); // 本地改动过 → 重新加回
        }
      } else {
        var localChanged = !deepEqual(baseItem, locItem);
        var latestChanged = !deepEqual(baseItem, latItem);
        if (localChanged && !latestChanged) {
          result.push(locItem);
        } else if (!localChanged && latestChanged) {
          result.push(latItem);
        } else if (deepEqual(locItem, latItem)) {
          result.push(latItem);
        } else {
          result.push(latItem); // 双方都改且不一致 → 保守保留远端
        }
      }
      seen.add(id);
    });

    // 远端有而本地没有的条目
    latest.forEach(function (latItem) {
      var id = latItem.id;
      if (!localMap.has(id)) {
        var baseItem = baseMap.get(id);
        if (baseItem === undefined) {
          result.push(latItem); // 远端新增
        } else if (!deepEqual(baseItem, latItem)) {
          result.push(latItem); // 本地删除、但远端也改过 → 保留远端
        } else {
          // 本地删除、远端未变 → 尊重本地删除（跳过）
        }
      }
    });

    return result;
  }

  /* ---------- 提交（带冲突重试） ---------- */
  function commit(ck, message) {
    var cfg = HAM.CONFIG.get();
    var path = cfg.files[ck];
    var entry = ensure(ck);

    function attempt(round) {
      return HAM.GitHub.writeFile(path, entry.data, entry.sha, message).then(function (sha) {
        entry.sha = sha;
        entry.base = deepClone(entry.data.items);
        return true;
      }).catch(function (e) {
        if (e.status === 409 && round < 5) {
          // 冲突：重新拉取并三方合并后重试
          return HAM.GitHub.readFile(path).then(function (r) {
            var latestItems = [];
            if (r.exists && r.data) {
              var d = r.data;
              if (Array.isArray(d)) latestItems = d;
              else latestItems = d.items || [];
            }
            var merged = mergeItems(entry.base || [], entry.data.items, latestItems);
            entry.data.items = merged;
            entry.sha = r.sha;
            return attempt(round + 1);
          });
        }
        if (e.status === 409) {
          throw new Error('多次合并仍冲突：数据被其他成员频繁修改，请刷新后重试。');
        }
        throw friendly(e, path);
      });
    }

    return attempt(0);
  }

  /* ---------- 增删改 ---------- */
  function addItem(ck, item, message) {
    var entry = ensure(ck);
    entry.data.items.push(item);
    return commit(ck, message || '新增条目').then(function () { return item; });
  }

  function updateItem(ck, id, patch, message) {
    var entry = ensure(ck);
    var target = entry.data.items.find(function (x) { return x.id === id; });
    if (!target) throw new Error('条目不存在（可能已被删除）。');
    Object.keys(patch).forEach(function (k) { target[k] = patch[k]; });
    return commit(ck, message || '更新条目').then(function () { return target; });
  }

  function removeItem(ck, id, message) {
    var entry = ensure(ck);
    entry.data.items = entry.data.items.filter(function (x) { return x.id !== id; });
    return commit(ck, message || '删除条目');
  }

  HAM.Store = {
    load: load,
    getCached: getCached,
    isCached: isCached,
    refresh: refresh,
    addItem: addItem,
    updateItem: updateItem,
    removeItem: removeItem,
    commit: commit
  };
})();
