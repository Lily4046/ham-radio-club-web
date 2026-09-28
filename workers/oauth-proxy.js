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
 *
 * 可选加固（wrangler secret put / [vars]）：
 *   ALLOWED_ORIGINS    允许调用的站点来源，逗号分隔（如 https://xxx.pages.dev）。
 *                      设置后其他站点调用会返回 403；不设置则不校验（兼容旧行为）。
 *   GITHUB_REDIRECT_URI  与 GitHub OAuth App 回调地址一致。设置后换令牌时会带上它，
 *                      由 GitHub 校验，降低授权码被别的站点拿去兑换的风险。
 * ========================================================================= */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS 预检
    if (request.method === 'OPTIONS') {
      return cors(new Response(null, { status: 204 }));
    }

    // 来源校验（可选）：配置了 ALLOWED_ORIGINS 才生效
    const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (allowed.length) {
      const origin = request.headers.get('Origin') || '';
      if (allowed.indexOf(origin) === -1) {
        return cors(json({ error: 'origin not allowed' }, 403));
      }
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
        if (env.GITHUB_REDIRECT_URI) form.set('redirect_uri', env.GITHUB_REDIRECT_URI);

        const res = await fetch('https://github.com/login/oauth/access_token', {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: form.toString()
        });

        // GitHub 出错时可能返回 HTML，直接 res.json() 会抛异常、掩盖真实原因
        const text = await res.text();
        let data;
        try {
          data = JSON.parse(text);
        } catch (e) {
          data = { error: 'bad_github_response', message: String(text).slice(0, 300) };
        }
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
