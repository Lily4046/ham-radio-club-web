/* =========================================================================
 * GitHub API 封装层
 * -------------------------------------------------------------------------
 * 负责与 GitHub REST API 通信：
 *   - readFile    读取仓库中的 JSON 文件（自动 base64 解码）
 *   - writeFile   写入 JSON 文件（自动 base64 编码，携带 sha 实现并发保护）
 *   - listCommits 列出某个文件的历史提交
 *   - getUser     获取当前令牌对应的用户信息
 * ========================================================================= */
(function () {
  'use strict';

  window.HAM = window.HAM || {};

  var API_BASE = 'https://api.github.com';

  // 仓库坐标：不传 target 就用主数据仓库（config.js 的 owner/repo/branch）
  function repoCoords(target) {
    var cfg = HAM.CONFIG.get();
    return {
      owner: (target && target.owner) || cfg.owner,
      repo: (target && target.repo) || cfg.repo,
      branch: (target && target.branch) || cfg.branch
    };
  }

  function contentsUrl(path, target) {
    var c = repoCoords(target);
    return '/repos/' + encodeURIComponent(c.owner) + '/' + encodeURIComponent(c.repo) + '/contents/' + path;
  }

  /* ---------- 基础请求 ---------- */
  function request(method, path, body, tokenOverride) {
    var token = tokenOverride || HAM.Auth.getToken();
    if (!token) {
      return Promise.reject(new Error('未登录：请先在「设置」中配置访问令牌或登录。'));
    }

    var headers = {
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Authorization': 'Bearer ' + token
    };
    if (body !== undefined && body !== null) {
      headers['Content-Type'] = 'application/json';
    }

    return fetch(API_BASE + path, {
      method: method,
      headers: headers,
      cache: 'no-store',
      body: body !== undefined && body !== null ? JSON.stringify(body) : undefined
    }).then(function (res) {
      if (res.status === 204) return null;
      return res.text().then(function (text) {
        var data = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch (e) {
          data = { raw: text };
        }
        if (!res.ok) {
          var err = new Error(data && data.message ? data.message : ('HTTP ' + res.status));
          err.status = res.status;
          err.data = data;
          throw err;
        }
        return data;
      });
    });
  }

  /* ---------- UTF-8 安全的 base64 编解码 ---------- */
  function encodeBase64(str) {
    var bytes = new TextEncoder().encode(str);
    var binary = '';
    var CHUNK = 0x8000;
    for (var i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
  }

  function decodeBase64(b64) {
    var clean = String(b64).replace(/\s+/g, '');
    var binary = atob(clean);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
  }

  /* ---------- 高层 API ---------- */
  function readFile(path, target) {
    if (HAM.Auth.isGuest()) {
      return readFileViaProxy(path, target);
    }
    var coords = repoCoords(target);
    // 加一个随时间变化的缓存穿透参数，避免 GitHub CDN 在刚写入后返回旧内容
    return request('GET', contentsUrl(path, target) +
      '?ref=' + encodeURIComponent(coords.branch) +
      '&_=' + Date.now())
      .then(function (d) {
        var text = decodeBase64(d.content);
        var parsed;
        try {
          parsed = JSON.parse(text);
        } catch (e) {
          var perr = new Error('数据文件不是合法 JSON，无法解析：' + path);
          perr.parseError = true;
          throw perr;
        }
        return {
          sha: d.sha,
          data: parsed,
          exists: true,
          size: d.size
        };
      })
      .catch(function (e) {
        if (e.status === 404) {
          return { sha: null, data: null, exists: false };
        }
        throw e;
      });
  }

  // 游客只读：通过腾讯云函数代理读取数据文件（令牌存在云函数环境变量里）
  function readFileViaProxy(path, target) {
    var cfg = HAM.CONFIG.get();
    var coords = repoCoords(target);
    return fetch(cfg.proxyUrl + '/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: path, owner: coords.owner, repo: coords.repo, branch: coords.branch })
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) {
          var err = new Error((data && (data.message || data.error)) || ('HTTP ' + res.status));
          err.proxyMessage = true;
          err.status = res.status;
          throw err;
        }
        if (data.exists) {
          return { sha: data.sha, data: data.data, exists: true, size: 0 };
        }
        return { sha: null, data: null, exists: false };
      });
    });
  }

  function writeFile(path, data, sha, message, target) {
    if (HAM.Auth.isGuest()) {
      return Promise.reject(new Error('游客（只读）模式无法写入数据。'));
    }
    var coords = repoCoords(target);
    var body = {
      message: message || ('更新 ' + path),
      content: encodeBase64(JSON.stringify(data, null, 2)),
      branch: coords.branch
    };
    if (sha) body.sha = sha;

    return request('PUT', contentsUrl(path, target), body)
      .then(function (d) {
        // 返回新 sha，供后续写入使用
        return d && d.content && d.content.sha ? d.content.sha : (d && d.commit && d.commit.sha);
      });
  }

  function listCommits(path, target) {
    if (HAM.Auth.isGuest()) {
      return listCommitsViaProxy(path, target);
    }
    var coords = repoCoords(target);
    return request('GET', '/repos/' + encodeURIComponent(coords.owner) + '/' + encodeURIComponent(coords.repo) +
      '/commits?path=' + path + '&sha=' + encodeURIComponent(coords.branch) + '&per_page=50');
  }

  // 游客只读：通过腾讯云函数代理读取提交历史
  function listCommitsViaProxy(path, target) {
    var cfg = HAM.CONFIG.get();
    var coords = repoCoords(target);
    return fetch(cfg.proxyUrl + '/commits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: path, owner: coords.owner, repo: coords.repo, branch: coords.branch })
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) {
          var err = new Error((data && (data.message || data.error)) || ('HTTP ' + res.status));
          err.proxyMessage = true;
          err.status = res.status;
          throw err;
        }
        return data;
      });
    });
  }

  function getUser(token) {
    return request('GET', '/user', undefined, token);
  }

  // 公开登记：把一条记录交给云函数代写。
  // 提交者没有 GitHub 令牌，也拿不到任何已有数据，函数只回执写入结果。
  // 预热：打开登记页时先打一下，把云函数冷启动时间藏进「填表」的时间里
  function pingProxy() {
    var cfg = HAM.CONFIG.get();
    if (!cfg.proxyUrl) return Promise.resolve(false);
    return fetch(cfg.proxyUrl + '/ping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    }).then(function (r) { return r.ok; }).catch(function () { return false; });
  }

  function submitPublicQsl(record, honeypot) {
    var cfg = HAM.CONFIG.get();
    if (!cfg.proxyUrl) {
      return Promise.reject(new Error('未配置提交地址（config.js 里的 proxyUrl）。'));
    }
    // 目标是「公开登记专用仓库」，不是主数据库仓库
    var pub = HAM.CONFIG.repoFor('publicQsl');
    return fetch(cfg.proxyUrl + '/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        record: record,
        hp: honeypot || '',
        owner: pub.owner,
        repo: pub.repo,
        branch: pub.branch
      })
    }).then(function (res) {
      return res.text().then(function (text) {
        var data = {};
        try { data = JSON.parse(text) || {}; } catch (e) { data = { __raw: text }; }
        if (!res.ok || !data.ok) {
          var msg = data.message || data.error;
          if (!msg && data.__raw) msg = 'HTTP ' + res.status + '：' + String(data.__raw).trim().slice(0, 200);
          var err = new Error(msg || ('提交失败（HTTP ' + res.status + '）'));
          err.status = res.status;
          throw err;
        }
        return data;
      });
    });
  }

  // 获取仓库元信息（用于连接诊断：是否存在、默认分支、是否私有、是否为空）
  function getRepo() {
    var cfg = HAM.CONFIG.get();
    return request('GET', '/repos/' + encodeURIComponent(cfg.owner) + '/' + encodeURIComponent(cfg.repo));
  }

  // 列出当前令牌可见的所有仓库（诊断：确认仓库是否已创建、名字是否写对）
  function listMyRepos() {
    return request('GET', '/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member');
  }

  // 测试对某路径的读取状态码（区分「文件不存在」与「无 Contents 权限」）
  function readFileStatus(path, target) {
    var coords = repoCoords(target);
    return request('GET', contentsUrl(path, target) + '?ref=' + encodeURIComponent(coords.branch))
      .then(function () { return 200; })
      .catch(function (e) { return e.status || 0; });
  }

  HAM.GitHub = {
    request: request,
    readFile: readFile,
    writeFile: writeFile,
    listCommits: listCommits,
    getUser: getUser,
    pingProxy: pingProxy,
    submitPublicQsl: submitPublicQsl,
    getRepo: getRepo,
    listMyRepos: listMyRepos,
    readFileStatus: readFileStatus,
    encodeBase64: encodeBase64,
    decodeBase64: decodeBase64
  };
})();
