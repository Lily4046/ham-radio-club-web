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
  function readFile(path) {
    var cfg = HAM.CONFIG.get();
    // 加一个随时间变化的缓存穿透参数，避免 GitHub CDN 在刚写入后返回旧内容
    return request('GET', '/repos/' + encodeURIComponent(cfg.owner) + '/' + encodeURIComponent(cfg.repo) +
      '/contents/' + path + '?ref=' + encodeURIComponent(cfg.branch) +
      '&_=' + Date.now())
      .then(function (d) {
        var text = decodeBase64(d.content);
        return {
          sha: d.sha,
          data: JSON.parse(text),
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

  function writeFile(path, data, sha, message) {
    var cfg = HAM.CONFIG.get();
    var body = {
      message: message || ('更新 ' + path),
      content: encodeBase64(JSON.stringify(data, null, 2)),
      branch: cfg.branch
    };
    if (sha) body.sha = sha;

    return request('PUT', '/repos/' + encodeURIComponent(cfg.owner) + '/' + encodeURIComponent(cfg.repo) +
      '/contents/' + path, body)
      .then(function (d) {
        // 返回新 sha，供后续写入使用
        return d && d.content && d.content.sha ? d.content.sha : (d && d.commit && d.commit.sha);
      });
  }

  function listCommits(path) {
    var cfg = HAM.CONFIG.get();
    return request('GET', '/repos/' + encodeURIComponent(cfg.owner) + '/' + encodeURIComponent(cfg.repo) +
      '/commits?path=' + path + '&sha=' + encodeURIComponent(cfg.branch) + '&per_page=50');
  }

  function getUser(token) {
    return request('GET', '/user', undefined, token);
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
  function readFileStatus(path) {
    var cfg = HAM.CONFIG.get();
    return request('GET', '/repos/' + encodeURIComponent(cfg.owner) + '/' + encodeURIComponent(cfg.repo) +
      '/contents/' + path + '?ref=' + encodeURIComponent(cfg.branch))
      .then(function () { return 200; })
      .catch(function (e) { return e.status || 0; });
  }

  HAM.GitHub = {
    request: request,
    readFile: readFile,
    writeFile: writeFile,
    listCommits: listCommits,
    getUser: getUser,
    getRepo: getRepo,
    listMyRepos: listMyRepos,
    readFileStatus: readFileStatus,
    encodeBase64: encodeBase64,
    decodeBase64: decodeBase64
  };
})();
