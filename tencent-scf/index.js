'use strict';
/* =========================================================================
 * 腾讯云函数（SCF）版 OAuth 换令牌代理
 * -------------------------------------------------------------------------
 * 作用：GitHub OAuth 需要 client_secret，而浏览器端无法安全保存该密钥。
 * 本函数部署到腾讯云函数后，前端拿到 code 后 POST 到这里，
 * 由函数携带 secret 向 GitHub 换取 access_token。
 *
 * 部署前需在腾讯云控制台配置两个环境变量：
 *   GITHUB_CLIENT_ID      你的 GitHub OAuth App 的 Client ID
 *   GITHUB_CLIENT_SECRET  你的 GitHub OAuth App 的 Client Secret
 * ========================================================================= */

const https = require('https');
const { URLSearchParams } = require('url');

/* ---------- 调用 GitHub 换取令牌 ---------- */
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

/* ---------- 入口 ---------- */
exports.main_handler = async function (event) {
  const method = String(event.httpMethod || event.method || 'GET').toUpperCase();

  // CORS 预检
  if (method === 'OPTIONS') {
    return jsonResp(204, {});
  }

  const path = String(event.path || '/');

  if (path.indexOf('/exchange') !== -1 && method === 'POST') {
    let body = event.body || {};
    if (typeof body === 'string') {
      // 部分 API 网关会把 body 做 base64 编码
      let text = body;
      if (event.isBase64Encoded) {
        try { text = Buffer.from(body, 'base64').toString('utf8'); } catch (e) { text = body; }
      }
      try { body = JSON.parse(text); } catch (e) { body = {}; }
    }

    const code = body.code;
    if (!code) {
      return jsonResp(400, { error: 'missing code' });
    }

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

  return jsonResp(404, { error: 'not found' });
};
