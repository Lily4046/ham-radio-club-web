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

/* ---------- PUT 到 GitHub API（写文件，带令牌） ---------- */
function githubPut(apiPath, payload, token) {
  const body = JSON.stringify(payload);
  return new Promise(function (resolve, reject) {
    const req = https.request({
      hostname: 'api.github.com',
      path: apiPath,
      method: 'PUT',
      headers: {
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Authorization': 'Bearer ' + token,
        'User-Agent': 'ham-radio-club-system',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
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
    req.write(body);
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

/* ---------- 参数校验 ---------- */
// 只允许常规文件路径，挡掉 .. 之类的越权路径
const SAFE_PATH = /^[A-Za-z0-9_\-/.]+$/;

function isValidPath(p) {
  return typeof p === 'string' && p.length > 0 && p.indexOf('..') === -1 && SAFE_PATH.test(p);
}

// 仓库坐标：环境变量优先。配了 REPO_OWNER / REPO_NAME / REPO_BRANCH 后，
// 前端传什么都会被忽略，避免只读令牌被拿去读同一用户名下的其他仓库。
function repoParams(body) {
  return {
    owner: process.env.REPO_OWNER || body.owner || 'Lily4046',
    repo: process.env.REPO_NAME || body.repo || 'ham-radio-club',
    branch: process.env.REPO_BRANCH || body.branch || 'main'
  };
}

// 游客只读代理允许读取的路径：
//   未配置 → 保持旧行为（三类数据文件都能读）
//   "*"    → 显式放开全部
//   逗号分隔（如 data/qsl-public.json）→ 只允许列出的路径，
//             这样「未授权的人」即使知道云函数地址也读不到其他数据。
function readAllowed(filePath) {
  const raw = process.env.PUBLIC_READ_PATHS;
  if (raw === undefined || String(raw).trim() === '') return true;
  const list = String(raw).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  if (list.indexOf('*') !== -1) return true;
  return list.indexOf(filePath) !== -1;
}

/* ---------- 游客只读：读取数据文件 ---------- */
async function handleRead(body) {
  const filePath = body.path;
  if (!isValidPath(filePath)) return jsonResp(400, { error: 'invalid path' });
  if (!readAllowed(filePath)) {
    return jsonResp(403, { error: 'path not allowed', message: '该数据文件未开放给只读代理。' });
  }

  const token = process.env.GITHUB_READ_TOKEN || '';
  if (!token) return jsonResp(500, { error: 'GITHUB_READ_TOKEN 未配置', message: '请在腾讯云函数环境变量中配置 GITHUB_READ_TOKEN（只读令牌）' });

  const { owner, repo, branch } = repoParams(body);
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
  if (!isValidPath(filePath)) return jsonResp(400, { error: 'invalid path' });
  if (!readAllowed(filePath)) {
    return jsonResp(403, { error: 'path not allowed', message: '该数据文件未开放给只读代理。' });
  }

  const token = process.env.GITHUB_READ_TOKEN || '';
  if (!token) return jsonResp(500, { error: 'GITHUB_READ_TOKEN 未配置', message: '请在腾讯云函数环境变量中配置 GITHUB_READ_TOKEN（只读令牌）' });

  const { owner, repo, branch } = repoParams(body);
  const apiPath = '/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo) +
    '/commits?path=' + encodeURIComponent(filePath) + '&sha=' + encodeURIComponent(branch) + '&per_page=50';

  try {
    const r = await githubGet(apiPath, token);
    return jsonResp(r.status, r.data);
  } catch (e) {
    return jsonResp(500, { error: 'internal error', message: String(e && e.message || e) });
  }
}

/* =========================================================================
 * 公开 QSL 登记：由云函数代写，提交者不需要任何令牌
 * -------------------------------------------------------------------------
 * 安全边界：
 *   - 只能写 PUBLIC_QSL_PATH（默认 data/qsl-public.json）这一个文件；
 *   - 只接受白名单字段，长度截断，必填项校验；
 *   - 只回执 {ok, id}，不返回文件内容，所以提交者看不到任何已有数据；
 *   - 简单限流 + 蜜罐字段，降低被灌数据的风险。
 * ========================================================================= */
const SUBMIT_FIELD_MAX = {
  callsign: 60,
  ourCallsign: 60,
  band: 20,
  mode: 20,
  date: 20,
  timeUtc: 10,
  rst: 40,
  submitter: 80,
  notes: 1000
};
const PUBLIC_QSL_MAX_ITEMS = 5000;
const SUBMIT_WINDOW_MS = 10 * 60 * 1000;
const SUBMIT_MAX_PER_WINDOW = 20;
const submitHits = new Map();

// 只保留白名单字段并补齐元信息；返回 { record } 或 { error }
function sanitizeSubmit(record) {
  if (!record || typeof record !== 'object') return { error: '缺少登记内容。' };

  const out = {};
  Object.keys(SUBMIT_FIELD_MAX).forEach(function (key) {
    let v = record[key];
    if (v === undefined || v === null) v = '';
    v = String(v).trim();
    if (v.length > SUBMIT_FIELD_MAX[key]) v = v.slice(0, SUBMIT_FIELD_MAX[key]);
    out[key] = v;
  });

  if (!out.callsign) return { error: '对方呼号为必填项。' };
  if (!out.date) return { error: '通联日期为必填项。' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(out.date)) return { error: '通联日期格式应为 YYYY-MM-DD。' };
  if (out.timeUtc && !/^\d{2}:\d{2}$/.test(out.timeUtc)) return { error: '时间格式应为 HH:MM（UTC）。' };
  if (!out.submitter) return { error: '提交人为必填项。' };

  out.id = 'pub_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  out.submittedAt = new Date().toISOString();
  out.updatedAt = out.submittedAt;
  out.updatedBy = out.submitter;
  out.source = 'public';
  return { record: out };
}

// 简单限流（云函数实例内有效，冷启动会重置；只用于挡明显的灌数据）
function submitRateLimited(ip) {
  const now = Date.now();
  const hits = (submitHits.get(ip) || []).filter(function (t) { return now - t < SUBMIT_WINDOW_MS; });
  if (hits.length >= SUBMIT_MAX_PER_WINDOW) {
    submitHits.set(ip, hits);
    return true;
  }
  hits.push(now);
  if (submitHits.size > 1000) submitHits.clear(); // 防止内存无限增长
  submitHits.set(ip, hits);
  return false;
}

async function handleSubmit(body, event) {
  // 蜜罐被填 → 当成机器人：假装成功，不写库
  if (body.hp) return jsonResp(200, { ok: true, id: null });

  const token = process.env.GITHUB_SUBMIT_TOKEN || '';
  if (!token) {
    return jsonResp(500, {
      error: 'GITHUB_SUBMIT_TOKEN 未配置',
      message: '请在云函数环境变量中配置 GITHUB_SUBMIT_TOKEN（Contents: Read and write），公开登记才能写入。'
    });
  }

  const checked = sanitizeSubmit(body.record);
  if (checked.error) return jsonResp(400, { error: 'invalid record', message: checked.error });
  const record = checked.record;

  const headers = (event && event.headers) || {};
  const ip = String(headers['x-forwarded-for'] || headers['X-Forwarded-For'] || headers['x-real-ip'] || 'unknown')
    .split(',')[0].trim();
  if (submitRateLimited(ip)) {
    return jsonResp(429, { error: 'too many requests', message: '提交过于频繁，请稍后再试。' });
  }

  const { owner, repo, branch } = repoParams(body);
  const filePath = process.env.PUBLIC_QSL_PATH || 'data/qsl-public.json';
  if (!isValidPath(filePath)) return jsonResp(500, { error: 'invalid PUBLIC_QSL_PATH' });

  const apiPath = '/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo) +
    '/contents/' + filePath;
  const commitMessage = '公开登记 QSL：' + record.callsign + ' ' + record.date;

  try {
    // 读取 → 追加 → 写回；409（他人同时写入）就重新读取再追加，最多 4 轮
    for (let round = 0; round < 4; round++) {
      const cur = await githubGet(apiPath + '?ref=' + encodeURIComponent(branch), token);
      let items = [];
      let sha = null;

      if (cur.status === 200) {
        const content = Buffer.from(String(cur.data.content || '').replace(/\s+/g, ''), 'base64').toString('utf8');
        try {
          const parsed = JSON.parse(content);
          items = Array.isArray(parsed) ? parsed : (parsed.items || []);
        } catch (e) {
          items = [];
        }
        sha = cur.data.sha;
      } else if (cur.status !== 404) {
        return jsonResp(cur.status, {
          error: 'github error',
          message: (cur.data && cur.data.message) || ('HTTP ' + cur.status)
        });
      }

      if (!Array.isArray(items)) items = [];
      if (items.length >= PUBLIC_QSL_MAX_ITEMS) {
        return jsonResp(409, {
          error: 'too many items',
          message: '公开登记文件已达上限，请联系管理员导出归档后再提交。'
        });
      }

      const payload = {
        message: commitMessage,
        content: Buffer.from(JSON.stringify({ items: items.concat([record]) }, null, 2), 'utf8').toString('base64'),
        branch: branch
      };
      if (sha) payload.sha = sha;

      const put = await githubPut(apiPath, payload, token);
      if (put.status === 200 || put.status === 201) {
        return jsonResp(200, { ok: true, id: record.id });
      }
      if (put.status !== 409) {
        return jsonResp(put.status, {
          error: 'github error',
          message: (put.data && put.data.message) || ('HTTP ' + put.status)
        });
      }
    }
    return jsonResp(409, { error: 'conflict', message: '当前登记的人较多，请稍后重试。' });
  } catch (e) {
    return jsonResp(500, { error: 'internal error', message: String(e && e.message || e) });
  }
}

/* ---------- 入口 ---------- */
exports.main_handler = async function (event) {
  const method = String(event.httpMethod || event.method || 'GET').toUpperCase();

  if (method === 'OPTIONS') {
    return {
      isBase64Encoded: false,
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      },
      body: ''
    };
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
    // 可选：配了 GITHUB_REDIRECT_URI 就带上，让 GitHub 校验回调地址，防止授权码被别处兑换
    if (process.env.GITHUB_REDIRECT_URI) params.append('redirect_uri', process.env.GITHUB_REDIRECT_URI);

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

  // 公开 QSL 登记：只能写，不返回任何已有数据
  if (path.indexOf('/submit') !== -1 && method === 'POST') {
    return handleSubmit(body, event);
  }

  return jsonResp(404, { error: 'not found' });
};

// 供本地自检使用（scripts/selftest.mjs），云函数运行时不会调用
exports._sanitizeSubmit = sanitizeSubmit;
exports._readAllowed = readAllowed;
