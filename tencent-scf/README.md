# 腾讯云函数（SCF）版 OAuth 代理 —— 部署教程

这个函数负责「拿 client_secret 向 GitHub 换取 access_token」，让成员可以**点一下 GitHub 账号登录、不用输入令牌**。它部署在腾讯云函数上，大陆能直接访问（解决了 Cloudflare Workers 的 `workers.dev` 被墙问题）。

---

## 一、先准备好 GitHub OAuth App 的信息

你需要两个值（GitHub → Settings → Developer settings → OAuth Apps → 你的 App）：

- **Client ID**：形如 `Ov23li...`（公开，可放在前端）
- **Client Secret**：形如 `xxxxxx`（保密，只放云函数环境变量）

> 回调 URL（Authorization callback URL）保持和 `config.js` 里的 `redirectUri` 一致：
> `https://lily4046.github.io/ham-radio-club-web/`

---

## 二、部署腾讯云函数

1. 登录腾讯云控制台，搜索并进入 **「云函数 SCF」**。
2. 点 **「函数服务」→「新建」**，选择 **「从头开始」**：
   - 函数名称：`ham-oauth-proxy`
   - 运行环境：**Node.js 16.13**（或 18.15）
   - 创建方式：**在线编辑**（把本目录 `index.js` 的内容粘贴进去）
3. 部署后，进入函数配置 **「环境变量」**，新增两个：
   - `GITHUB_CLIENT_ID` = 你的 Client ID
   - `GITHUB_CLIENT_SECRET` = 你的 Client Secret
4. 创建 **「触发器」→「API 网关」**：
   - 请求方法：**ANY**（或至少 POST + OPTIONS）
   - 发布路径：**`/exchange`**
   - 鉴权方式：**免鉴权**（开放访问）
5. 保存后，API 网关会给一个访问地址，形如：
   ```
   https://service-xxxxxxxx-xxxxxxxxxx.gz.apigw.tencentcs.com/release
   ```

---

## 三、测试函数是否部署成功

浏览器直接打开（或 `curl`）：

```
https://service-xxxxxxxx-xxxxxxxxxx.gz.apigw.tencentcs.com/release/exchange
```

- 显示 `{"error":"not found"}`（GET 方式）或 `{"error":"missing code"}`（POST 空 body）→ ✅ 部署成功；
- 打不开 / 超时 → 检查触发器和发布环境是否生效。

---

## 四、把地址填进 config.js

打开项目根目录 `config.js`，填三项：

```js
clientId: 'Ov23liNW6OynAyeVvehv',                                        // 你的 Client ID
redirectUri: 'https://lily4046.github.io/ham-radio-club-web/',          // 站点地址
proxyUrl: 'https://service-xxxxxxxx-xxxxxxxxxx.gz.apigw.tencentcs.com/release'  // 上面第 5 步的地址（去掉 /exchange，末尾不加 /）
```

然后 `git add` + `commit` + `push` 推上线。

---

## 五、让成员用起来

1. 确保成员已被加为私有仓库 `ham-radio-club` 的**协作者（Write 权限）**；
2. 成员打开网站 → 点 **「使用 GitHub 账号登录」** → 跳 GitHub 授权 → 自动回来登录成功。

---

## 常见问题

| 现象 | 原因 / 解决 |
|------|-------------|
| `redirect_uri_mismatch` | 回调 URL 和 config.js 的 `redirectUri` 不一致（末尾 `/`、大小写都要一致） |
| 云函数返回 500 / internal error | 环境变量没配、或 Client Secret 不对 |
| 函数能访问但换不到令牌 | 检查 `GITHUB_CLIENT_SECRET` 是否正确 |
| 前端没出现 OAuth 按钮 | config.js 三个值（clientId / redirectUri / proxyUrl）缺一个 |
