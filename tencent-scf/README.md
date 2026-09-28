# 腾讯云函数（SCF）版代理 —— 部署教程

这个函数做了三件事：
1. **OAuth 换令牌**：拿 `client_secret` 向 GitHub 换取 `access_token`，让成员点一下 GitHub 账号登录、不用输令牌；
2. **游客只读代理**：用只读令牌（存在云函数环境变量里）读取仓库数据，让游客能「只读浏览」，且**不把令牌写进前端代码**；
3. **公开 QSL 登记代写**：用写入令牌把「没有 GitHub 权限的人」提交的 QSL 卡记录追加到 `data/qsl-public.json`，只回执写入结果、**不返回任何已有数据**。

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

### 公开登记写入用（Fine-grained tokens）
再生成一个 **fine-grained 令牌**，给「无需登录的 QSL 登记」用：
- Repository access：**Only select repositories → `ham-radio-club`**
- Permissions → Repository permissions → **Contents → `Read and write`**（这个要能写）

> 安全说明：令牌只存在云函数环境变量里，函数只会往 `PUBLIC_QSL_PATH`（默认
> `data/qsl-public.json`）这一个文件追加记录，前端和提交者都拿不到令牌，也读不到已有数据。

---

## 二、部署腾讯云函数

1. 登录腾讯云控制台 → **云函数 SCF** → 函数 `ham-oauth-proxy`。
2. **函数代码**：把本目录 `index.js` 的内容粘贴进去（覆盖旧的）。
3. **函数配置 → 环境变量**，至少配置三个：
   - `GITHUB_CLIENT_ID` = 你的 Client ID
   - `GITHUB_CLIENT_SECRET` = 你的 Client Secret
   - `GITHUB_READ_TOKEN` = 上面的只读令牌
   - `GITHUB_SUBMIT_TOKEN` = 上面的「公开登记写入令牌」（不配的话，公开登记会提示未配置）

   可选（建议一起加上，用于收紧权限）：
   - `REPO_OWNER` = `Lily4046`、`REPO_NAME` = `ham-radio-club`、`REPO_BRANCH` = `main`
     钉死代理只能读这个仓库/分支，前端传什么都会被忽略，
     避免只读令牌被拿去读同一个用户名下的其他仓库。
   - `PUBLIC_QSL_PATH` = `data/qsl-public.json`
      公开登记写入的文件，**只能填一个路径**，函数不会写别的地方。
   - `PUBLIC_READ_PATHS` = 只读代理允许读取的路径，逗号分隔；`*` 表示全部放开。
      不配置 = 保持旧行为（三类数据文件都能读）。若要求「未授权的人看不到其他数据」，
      建议填 `data/qsl-public.json`（这样只读代理只剩公开登记文件可读）。
   - `GITHUB_REDIRECT_URI` = 与 GitHub OAuth App 回调地址完全一致
     （如 `https://lily4046.github.io/ham-radio-club-web/`）。
     配置后换令牌时会带上它，由 GitHub 校验，降低授权码被别的站点拿去兑换的风险。
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
- 公开登记：`POST /submit`，body：
  ```json
  {"record":{"callsign":"JA1ABC","date":"2026-09-28","submitter":"张三"},"hp":"","owner":"Lily4046","repo":"ham-radio-club"}
  ```
  应返回 `{"ok":true,"id":"pub_xxx"}`，并在仓库里看到一条新提交（返回里不含任何已有数据）。

---

## 四、前端 config.js

```js
clientId: 'Ov23liNW6OynAyeVvehv',
redirectUri: 'https://lily4046.github.io/ham-radio-club-web/',
proxyUrl: 'https://1493061864-6jpy3x99lf.ap-guangzhou.tencentscf.com',  // 末尾不加 /
```

`git add` + `commit` + `push` 推上线。配置了 `proxyUrl` 就会显示「游客登录」和
「QSL 卡登记（无需登录）」两个按钮（想关掉其中任意一个，把 `config.js` 里的
`guestRead` / `publicSubmit` 改成 `false`）。

---

## 五、让成员和游客用起来

- **成员**：已被加为 `ham-radio-club` 协作者 → 点「使用 GitHub 账号登录」授权。
- **游客**：点「游客登录（只读浏览）」→ 只能看，不能增删改。
- **没有权限的人**：点「📝 QSL 卡登记（无需登录）」→ 只看到一张表单，提交后只有一句回执，
  看不到任何已有记录；数据由云函数追加写入 `data/qsl-public.json`。
  也可以把直达链接发给对方：`https://你的站点/?submit=1`（或 `#submit`）。

---

## 常见问题

| 现象 | 原因 / 解决 |
|------|-------------|
| 游客提示 `GITHUB_READ_TOKEN 未配置` | 云函数环境变量没配 `GITHUB_READ_TOKEN` |
| 游客看不到数据 / 404 | 只读令牌没授权 `ham-radio-club`，或权限不是 Contents Read |
| 公开登记提示「未配置 GITHUB_SUBMIT_TOKEN」 | 云函数环境变量没配写入令牌，或没重新部署最新 `index.js` |
| 公开登记返回 403/404 | 写入令牌没有 Contents: Read and write 权限，或仓库名/branch 不对 |
| 只读代理返回「该数据文件未开放给只读代理」 | 配了 `PUBLIC_READ_PATHS` 且没包含这个路径（这是收紧后的预期行为） |
| `redirect_uri_mismatch` | 回调 URL 和 config.js 的 `redirectUri` 不一致 |
| `Invoking task timed out after 3 seconds` | 执行超时时间还是 3 秒，改成 30 秒 |
| 前端没出现 OAuth/游客按钮 | config.js 的 clientId/redirectUri/proxyUrl 没配齐 |
