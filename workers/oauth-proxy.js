/* =========================================================================
 * OAuth 令牌交换代理（Cloudflare Worker）
 * -------------------------------------------------------------------------
 * 作用：GitHub OAuth 需要 client_secret，而浏览器端无法安全保存该密钥。
 * 本 Worker 部署到 Cloudflare，前端拿到 code 后 POST 到这里，
 * 由 Worker 携带 secret 向 GitHub 换取 access_token。
 *
 * 部署步骤：
 *   1. 在 GitHub 创建 OAuth App，拿到 Client ID / Client Secret。
 *   2. cd workers
 *   3. npm i -g wrangler && wrangler login
 *   4. wrangler secret put GITHUB_CLIENT_ID
 *   5. wrangler secret put GITHUB_CLIENT_SECRET
 *   6. wrangler deploy
 *   7. 把得到的 *.workers.dev 地址填到 config.js 的 proxyUrl。
 * ========================================================================= */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS 预检
    if (request.method === 'OPTIONS') {
      return cors(new Response(null, { status: 204 }));
    }

    if (url.pathname === '/exchange' && request.method === 'POST') {
      try {
        const body = await request.json();
        const code = body.code;
        const state = body.state;

        if (!code) {
          return cors(json({ error: 'missing code' }, 400));
        }

        const form = new URLSearchParams({
          client_id: env.GITHUB_CLIENT_ID,
          client_secret: env.GITHUB_CLIENT_SECRET,
          code: code,
          state: state || ''
        });

        const res = await fetch('https://github.com/login/oauth/access_token', {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: form.toString()
        });

        const data = await res.json();
        return cors(json(data, res.status));
      } catch (e) {
        return cors(json({ error: 'internal error', description: e.message }, 500));
      }
    }

    return cors(json({ error: 'not found' }, 404));
  }
};

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function cors(res) {
  res.headers.set('Access-Control-Allow-Origin', '*');
  res.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type');
  return res;
}
