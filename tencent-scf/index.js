'use strict';
/* =========================================================================
 * 腾讯云函数（SCF）版代理：OAuth 换令牌 + 游客只读读取
 * -------------------------------------------------------------------------
 * 环境变量（在腾讯云控制台配置）：
 *   GITHUB_CLIENT_ID       GitHub OAuth App 的 Client ID（OAuth 用）
 *   GITHUB_CLIENT_SECRET   GitHub OAuth App 的 Client Secret（OAuth 用）
 *   GITHUB_READ_TOKEN      游客只读令牌（fine-grained，Contents: Read-only）
 *
 * 接口：
 *   POST /exchange   用 code 向 GitHub 换 access_token
 *   POST /read       用 GITHUB_READ_TOKEN 读取仓库里的数据文件（游客只读）
 *   POST /commits    用 GITHUB_READ_TOKEN 读取文件提交历史（游客只读）
 * ========================================================================= */

const https = require('https');
const { URLSearchParams } = require('url');

/* ---------- 通用：解析请求体 ---------- */
function parseBody(event) {
  let body = event.body || {};
  if (typeof body === 'string') {
    let text = body;
    if (event.isBase64Encoded) {
      try { text = Buffer.from(body, 'base64').toString('utf8'); } catch (e) { text = body; }
    }
    try { body = JSON.parse(text); } catch (e) { body = {}; }
  }
  return body;
}

/* ---------- POST 到 GitHub（OAuth 换令牌） ---------- */
function postToGitHub(formBody) {
  return new Promise(function (resolve, reject) {
    const req = https.request({
      hostname: 'github.com',
      path: '/login/oauth/access_token',
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(formBody)
      }
    }, function (res) {
      let raw = '';
      res.on('data', function (c) { raw += c; });
      res.on('end', function () {
        let data;
        try { data = JSON.parse(raw); } catch (e) { data = { raw: raw }; }
        resolve({ status: res.statusCode, data: data });
      });
    });
    req.on('error', reject);
    req.write(formBody);
    req.end();
  });
}

/* ---------- GET 到 GitHub API（带只读令牌） ---------- */
function githubGet(apiPath, token) {
  return new Promise(function (resolve, reject) {
    const req = https.request({
      hostname: 'api.github.com',
      path: apiPath,
      method: 'GET',
      headers: {
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Authorization': 'Bearer ' + token,
        'User-Agent': 'ham-radio-club-system'
      }
    }, function (res) {
      let raw = '';
      res.on('data', function (c) { raw += c; });
      res.on('end', function () {
        let data;
        try { data = JSON.parse(raw); } catch (e) { data = { raw: raw }; }
        resolve({ status: res.statusCode, data: data });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

/* ---------- 统一响应（含 CORS 头） ---------- */
function jsonResp(status, obj) {
  return {
    isBase64Encoded: false,
    statusCode: status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    },
    body: JSON.stringify(obj)
  };
}

/* ---------- 游客只读：读取数据文件 ---------- */
async function handleRead(body) {
  const filePath = body.path;
  if (!filePath) return jsonResp(400, { error: 'missing path' });

  const token = process.env.GITHUB_READ_TOKEN || '';
  if (!token) return jsonResp(500, { error: 'GITHUB_READ_TOKEN 未配置', message: '请在腾讯云函数环境变量中配置 GITHUB_READ_TOKEN（只读令牌）' });

  const owner = body.owner || 'Lily4046';
  const repo = body.repo || 'ham-radio-club';
  const branch = body.branch || 'main';
  // 注意：contents 接口的路径不要 encodeURIComponent 斜杠，否则会被当成文件名里的 %2F
  const apiPath = '/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo) +
    '/contents/' + filePath + '?ref=' + encodeURIComponent(branch);

  try {
    const r = await githubGet(apiPath, token);
    if (r.status === 404) {
      return jsonResp(200, { exists: false, sha: null, data: null });
    }
    if (r.status !== 200) {
      return jsonResp(r.status, { error: 'github error', message: (r.data && r.data.message) || ('HTTP ' + r.status) });
    }
    const content = Buffer.from(String(r.data.content || '').replace(/\s+/g, ''), 'base64').toString('utf8');
    let parsed;
    try { parsed = JSON.parse(content); } catch (e) { parsed = { raw: content }; }
    return jsonResp(200, { exists: true, sha: r.data.sha, data: parsed });
  } catch (e) {
    return jsonResp(500, { error: 'internal error', message: String(e && e.message || e) });
  }
}

/* ---------- 游客只读：读取文件提交历史 ---------- */
async function handleCommits(body) {
  const filePath = body.path;
  if (!filePath) return jsonResp(400, { error: 'missing path' });

  const token = process.env.GITHUB_READ_TOKEN || '';
  if (!token) return jsonResp(500, { error: 'GITHUB_READ_TOKEN 未配置', message: '请在腾讯云函数环境变量中配置 GITHUB_READ_TOKEN（只读令牌）' });

  const owner = body.owner || 'Lily4046';
  const repo = body.repo || 'ham-radio-club';
  const branch = body.branch || 'main';
  const apiPath = '/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo) +
    '/commits?path=' + encodeURIComponent(filePath) + '&sha=' + encodeURIComponent(branch) + '&per_page=50';

  try {
    const r = await githubGet(apiPath, token);
    return jsonResp(r.status, r.data);
  } catch (e) {
    return jsonResp(500, { error: 'internal error', message: String(e && e.message || e) });
  }
}

/* ---------- 入口 ---------- */
exports.main_handler = async function (event) {
  const method = String(event.httpMethod || event.method || 'GET').toUpperCase();

  if (method === 'OPTIONS') {
    return jsonResp(204, {});
  }

  const path = String(event.path || '/');
  const body = parseBody(event);

  // OAuth 换令牌
  if (path.indexOf('/exchange') !== -1 && method === 'POST') {
    const code = body.code;
    if (!code) return jsonResp(400, { error: 'missing code' });

    const params = new URLSearchParams();
    params.append('client_id', process.env.GITHUB_CLIENT_ID || '');
    params.append('client_secret', process.env.GITHUB_CLIENT_SECRET || '');
    params.append('code', code);
    if (body.state) params.append('state', body.state);

    try {
      const r = await postToGitHub(params.toString());
      return jsonResp(r.status, r.data);
    } catch (e) {
      return jsonResp(500, { error: 'internal error', description: String(e && e.message || e) });
    }
  }

  // 游客只读：读取数据文件
  if (path.indexOf('/read') !== -1 && method === 'POST') {
    return handleRead(body);
  }

  // 游客只读：读取提交历史
  if (path.indexOf('/commits') !== -1 && method === 'POST') {
    return handleCommits(body);
  }

  return jsonResp(404, { error: 'not found' });
};
