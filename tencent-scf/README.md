# 腾讯云函数（SCF）版代理 —— 部署教程

这个函数做了三件事：
1. **OAuth 换令牌**：拿 `client_secret` 向 GitHub 换取 `access_token`，让成员点一下 GitHub 账号登录、不用输令牌；
2. **游客只读代理**：用只读令牌（存在云函数环境变量里）读取仓库数据，让游客能「只读浏览」，且**不把令牌写进前端代码**；
3. **公开 QSL 登记代写**：用写入令牌把「没有 GitHub 权限的人」提交的 QSL 卡记录追加到
   **独立登记仓库**（例如 `ham-radio-club-public`）的 `data/qsl-public.json`，
   只回执写入结果、**不返回任何已有数据**。写入令牌只授权这个登记仓库，
   所以无权限的人怎么提交都碰不到主数据库。

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
先单独建一个**私有登记仓库**（本社团已建好 `Lily4046/ham-radio-club-qsl`；
不用手动建文件，云函数第一次提交会自动创建 `data/qsl-public.json`），
然后为它生成一个 **fine-grained 令牌**（点这里：GitHub → 头像 → Settings →
Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token）：
- Repository access：**Only select repositories → 只勾这个登记仓库**（**不要**勾主数据库仓库）
- Permissions → Repository permissions → **Contents → `Read and write`**（这个要能写）
- 有效期建议 1 年，生成后**只粘贴到云函数的环境变量里**，不要贴进聊天、代码或前端配置。

> 安全说明：令牌只存在云函数环境变量里，且**只授权登记仓库**，函数只会往
> `PUBLIC_QSL_PATH`（默认 `data/qsl-public.json`）这一个文件追加记录。
> 前端和提交者都拿不到令牌，也读不到已有数据；主数据库仓库的写权限完全不在这条链路上。

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
   - `PUBLIC_REPO_OWNER` = `Lily4046`、`PUBLIC_REPO_NAME` = `ham-radio-club-qsl`、
     `PUBLIC_REPO_BRANCH` = `main`
     钉死公开登记的写入目标仓库；配了以后前端传的仓库坐标一律忽略。
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
  {"record":{"callsign":"JA1ABC","date":"2026-09-28","submitter":"张三"},"hp":"","owner":"Lily4046","repo":"ham-radio-club-qsl"}
  ```
  应返回 `{"ok":true,"id":"pub_xxx"}`，并在**登记仓库**里看到一条新提交
  （返回里不含任何已有数据；配了 `PUBLIC_REPO_*` 后 body 里的仓库会被忽略）。

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
  看不到任何已有记录；数据由云函数追加写入**独立登记仓库**的 `data/qsl-public.json`。
  也可以把直达链接发给对方：`https://你的站点/?submit=1`（或 `#submit`）。
- **成员核对并入账**：在「📝 QSL 登记」标签页点「📥 并入 QSL 卡」，
  记录会写进主数据库的 `data/qsl-cards.json`，并从登记库删除（按 `sourceId` 去重，点两次不会重复）。
  > 成员要能读写登记库才能完成这一步：把成员加为登记仓库的协作者，或给他们的 PAT 授权该仓库。

**谁能看到什么**（登记库设为私有后）：

| 角色 | 需要令牌吗 | 能看到 |
|------|-----------|--------|
| 无权限的人（公众） | 不需要，任何令牌都接触不到 | 只有登记表单，提交后一句回执 |
| 成员（PAT / OAuth） | 用自己登录的令牌 | 全部四类数据，含待核对的登记 |
| 游客（只读浏览） | 不用登录 | 默认只有前三类；想让它也看登记，把 `config.js` 的 `publicQslForGuest` 改成 `true`，并让 `GITHUB_READ_TOKEN` 也授权登记仓库 |

写入侧的令牌（`GITHUB_SUBMIT_TOKEN`）只存在于云函数环境变量里：公众提交时由云函数自动带上，
**使用者不需要输入、也拿不到任何令牌**。

---

## 六、提交速度慢怎么办

先看清慢在哪一段（实测参考值，供对照）：

| 环节 | 典型耗时 | 说明 |
|------|---------|------|
| 浏览器 → 云函数 | 0.1–0.3 秒 | 国内线路，一般不是瓶颈 |
| 云函数冷启动 | 1–3 秒 | 函数闲置几分钟后，第一次调用要重新拉起容器 |
| 云函数 → GitHub（读） | 0.6–1.5 秒 | 跨太平洋，物理延迟，省不掉 |
| 云函数 → GitHub（写） | 0.6–1.5 秒 | 提交必须等它落盘，否则回执就是假的 |

### 代码里已经做的优化（新版 `index.js` 自带，无需配置）

1. **少一次往返**：热实例里缓存登记文件的内容和 `sha`，提交时直接写；万一期间别人也提交过，
   GitHub 会返回 409，函数会自动重新读取最新内容再追加（不会覆盖别人的数据）。
2. **连接复用**：keep-alive 复用 HTTPS 连接，省掉每轮的 TLS 握手；连接被云平台回收时自动换新连接重试一次。
3. **前端预热**：打开登记页时先调一次 `POST /ping` 把函数叫醒，冷启动时间被藏在对方填表的时间里。
4. **防重复提交 + 等待计时**：按钮会显示「已等待 N 秒」，按回车也不会重复提交。

### 还能在腾讯云侧做（可选，按需付费）

- **定时触发器预热**：给函数加一个每 5 分钟触发一次的定时触发器、请求 `/ping`，让实例一直热着。
- **预置并发**：函数配置 → 并发管理 → 预置并发设 1，基本消除冷启动。
- **内存调大**：128MB → 256MB，CPU 配额随之提高，编解码会快一点。
- **执行超时**保持 30 秒（3 秒会直接超时）。

### 数据侧

登记文件越大，每次「读 + 写」传输的内容越多。定期点「📥 并入 QSL 卡」会把登记库清空，
是最有效的一次性提速手段；建议单文件保持在几百条以内。

---

## 常见问题

| 现象 | 原因 / 解决 |
|------|-------------|
| 游客提示 `GITHUB_READ_TOKEN 未配置` | 云函数环境变量没配 `GITHUB_READ_TOKEN` |
| 游客看不到数据 / 404 | 只读令牌没授权 `ham-radio-club`，或权限不是 Contents Read |
| 登录慢、登录后列表加载慢 | 成员原来是直连 api.github.com 拉数据；`config.js` 里 `readViaProxy` 默认已开，读取走云函数（浏览器→腾讯云 0.2 秒 + 腾讯云→GitHub 0.6 秒）。若被关掉过，把它设回 `true` |
| 公开登记提示「未配置 GITHUB_SUBMIT_TOKEN」 | 云函数环境变量没配写入令牌，或没重新部署最新 `index.js` |
| 公开登记返回 403/404 | 写入令牌没有勾选「登记仓库」的 Contents: Read and write 权限，或登记仓库名/branch 不对 |
| 成员点「并入 QSL 卡」报 403/404 | 成员令牌没有登记仓库的写权限（没被加为协作者），或主数据库仓库没有写权限 |
| 只读代理返回「该数据文件未开放给只读代理」 | 配了 `PUBLIC_READ_PATHS` 且没包含这个路径（这是收紧后的预期行为） |
| `redirect_uri_mismatch` | 回调 URL 和 config.js 的 `redirectUri` 不一致 |
| `Invoking task timed out after 3 seconds` | 执行超时时间还是 3 秒，改成 30 秒 |
| 前端没出现 OAuth/游客按钮 | config.js 的 clientId/redirectUri/proxyUrl 没配齐 |
