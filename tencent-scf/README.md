# 腾讯云函数（SCF）版代理 —— 部署教程

这个函数做了两件事：
1. **OAuth 换令牌**：拿 `client_secret` 向 GitHub 换取 `access_token`，让成员点一下 GitHub 账号登录、不用输令牌；
2. **游客只读代理**：用只读令牌（存在云函数环境变量里）读取仓库数据，让游客能「只读浏览」，且**不把令牌写进前端代码**。

部署在腾讯云函数上，大陆能直接访问（解决了 Cloudflare Workers 的 `workers.dev` 被墙问题）。

---

## 一、准备信息

### OAuth 用（GitHub → Settings → Developer settings → OAuth Apps）
- **Client ID**：形如 `Ov23li...`（公开）
- **Client Secret**：形如 `xxxxxx`（保密）

> 回调 URL 保持和 `config.js` 里的 `redirectUri` 一致：
> `https://lily4046.github.io/ham-radio-club-web/`

### 游客只读用（GitHub → Settings → Developer settings → Fine-grained tokens）
生成一个 **fine-grained 令牌**：
- Repository access：**Only select repositories → `ham-radio-club`**
- Permissions → Repository permissions → **Contents → `Read-only`**（只读！）

记下这个令牌值（`github_pat_...`），它只放进云函数环境变量，**不要写进前端 config.js**。

---

## 二、部署腾讯云函数

1. 登录腾讯云控制台 → **云函数 SCF** → 函数 `ham-oauth-proxy`。
2. **函数代码**：把本目录 `index.js` 的内容粘贴进去（覆盖旧的）。
3. **函数配置 → 环境变量**，配置三个：
   - `GITHUB_CLIENT_ID` = 你的 Client ID
   - `GITHUB_CLIENT_SECRET` = 你的 Client Secret
   - `GITHUB_READ_TOKEN` = 上面的只读令牌
4. **执行超时时间**改成 **30 秒**（要连 github.com，3 秒不够）。
5. 函数已经开好「函数 URL」（公网 + CORS），如果之前没有，去「函数 URL」新建：
   - 公网访问 ✅、CORS ✅、Allow-Origin `*`、Allow-Headers `*`、Expose-Headers `*`、授权类型「开放」、参数兼容「启用」
6. 记下访问地址，形如：
   ```
   https://1493061864-6jpy3x99lf.ap-guangzhou.tencentscf.com
   ```

---

## 三、测试

浏览器打开（或 curl）：

- OAuth：`POST /exchange`，空 body 应返回 `{"error":"missing code"}`
- 游客读取：`POST /read`，body `{"path":"data/lab-items.json","owner":"Lily4046","repo":"ham-radio-club"}`，应返回 `{"exists":true,"sha":"...","data":{"items":[...]}}`

---

## 四、前端 config.js

```js
clientId: 'Ov23liNW6OynAyeVvehv',
redirectUri: 'https://lily4046.github.io/ham-radio-club-web/',
proxyUrl: 'https://1493061864-6jpy3x99lf.ap-guangzhou.tencentscf.com',  // 末尾不加 /
```

`git add` + `commit` + `push` 推上线。配置了 `proxyUrl` 就会显示「游客登录」按钮。

---

## 五、让成员和游客用起来

- **成员**：已被加为 `ham-radio-club` 协作者 → 点「使用 GitHub 账号登录」授权。
- **游客**：点「游客登录（只读浏览）」→ 只能看，不能增删改。

---

## 常见问题

| 现象 | 原因 / 解决 |
|------|-------------|
| 游客提示 `GITHUB_READ_TOKEN 未配置` | 云函数环境变量没配 `GITHUB_READ_TOKEN` |
| 游客看不到数据 / 404 | 只读令牌没授权 `ham-radio-club`，或权限不是 Contents Read |
| `redirect_uri_mismatch` | 回调 URL 和 config.js 的 `redirectUri` 不一致 |
| `Invoking task timed out after 3 seconds` | 执行超时时间还是 3 秒，改成 30 秒 |
| 前端没出现 OAuth/游客按钮 | config.js 的 clientId/redirectUri/proxyUrl 没配齐 |
