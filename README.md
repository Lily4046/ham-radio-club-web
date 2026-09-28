# 📡 业余无线电社团协作管理系统

一个**纯前端、零后端**的在线协作管理系统，为业余无线电社团管理四类数据：

| 模块 | 图标 | 数据文件 | 谁在用 |
|------|------|----------|--------|
| 实验室物品 | 🧪 | `data/lab-items.json` | 登录成员 |
| QSL 卡 | 📮 | `data/qsl-cards.json` | 登录成员 |
| 电台设备 | 📻 | `data/radio-equipment.json` | 登录成员 |
| QSL 登记（公开提交） | 📝 | 默认直接写主库的 `data/qsl-cards.json`（可选独立登记库） | 没有 GitHub 权限的人 / 访客提交，提交即入账 |

所有数据以 JSON 文件形式存储在**私有 GitHub 仓库**中，通过 **GitHub REST API** 读写；前端是静态页面，浏览器打开即可使用，支持社团成员在线增删改查、搜索、变更记录查看与导出。

前三类数据需要通行令牌（PAT / OAuth）才能读写，放在主数据仓库里。
第四类「QSL 登记」是给**没有权限的人**用的：他们不需要登录，只填一张表，
提交由云函数代写，**默认直接写进主库的 `data/qsl-cards.json`**，
成员刷新「QSL 卡」就能看到（卡片状态默认「未收到」、回信默认「未回信」、发信人填提交人）。
登记页面**不加载、不显示任何已有数据**。

如果更看重隔离，可以在 `config.js` 里填 `publicRepo`，改成
「先写独立登记库 → 成员核对后点『📥 并入 QSL 卡』」的两段式流程。

---

## 目录结构

```
ham-radio-club-system/
├── index.html              # 单页应用入口
├── config.js               # 全局默认配置（部署前改这里）
├── css/
│   └── styles.css          # 样式
├── js/
│   ├── auth.js             # 认证层（PAT + OAuth）
│   ├── github.js           # GitHub API 封装（读写/历史）
│   ├── models.js           # 各类数据的字段定义与校验
│   ├── store.js            # 数据仓库层（增删改 + 冲突合并）
│   ├── ui.js               # 通用 UI（toast/modal/确认框）
│   ├── views.js            # 视图层（表格/表单/历史/导出）
│   ├── submit.js           # 公开 QSL 登记页（无需登录，只提交不读取）
│   └── app.js              # 应用入口（登录/导航/设置）
├── workers/
│   ├── oauth-proxy.js      # OAuth 令牌交换代理（Cloudflare Worker）
│   └── wrangler.toml       # Worker 配置
├── scripts/
│   ├── init-repo.mjs       # Node 脚本：上传种子数据到仓库
│   └── selftest.mjs        # Node 自检：跑 models/store/云函数校验逻辑，不联网
├── data/                   # 各类数据的种子（示例）数据
│   ├── lab-items.json
│   ├── qsl-cards.json
│   └── radio-equipment.json
├── _headers                # 边缘平台安全头（可选）
└── .gitignore
```

---

## 工作原理

```
┌──────────────┐      GitHub REST API       ┌───────────────────┐
│  浏览器前端   │ ─────────────────────────▶ │  私有 GitHub 仓库   │
│ (静态页面)    │  GET/PUT .../contents/... │  data/*.json       │
└──────────────┘  (Bearer Token 认证)       └───────────────────┘
```

- **读取**：`GET /repos/{owner}/{repo}/contents/{path}`，返回的 base64 内容解码为 JSON。
- **写入**：`PUT /repos/{owner}/{repo}/contents/{path}`，携带 `sha` 与 base64 编码后的新内容。
- **并发保护**：每次写入携带文件的 `sha`，若他人已修改（返回 `409`），前端自动重新拉取并按 `id` 做三方合并后重试，尽量不覆盖他人改动。
- **历史**：`GET /repos/{owner}/{repo}/commits?path=...` 展示每个文件的提交记录。

---

## 快速开始

### 第 1 步：创建私有数据仓库

在 GitHub 新建一个 **Private** 仓库（例如 `ham-radio-club-data`），并把本项目的 `data/` 三个 JSON 文件上传进去（或直接用下方初始化脚本）。

> 说明：仓库同时存放前端代码与数据也可以；本项目结构即「代码 + `data/`」同仓，便于整体管理。

### 第 2 步：配置 `config.js`

打开根目录的 `config.js`，至少修改：

```js
owner: 'YOUR_GITHUB_USERNAME',   // 改成你的用户名/组织名
repo:  'ham-radio-club-data',    // 改成你的仓库名
branch: 'main',                  // 分支名
```

### 第 3 步：准备访问令牌

创建 Personal Access Token（PAT）：
1. GitHub → Settings → Developer settings → Personal access tokens。
2. 生成一个 **Fine-grained token**（或 classic token），授予该私有仓库的 **Contents: Read and write** 权限（classic 令牌选 `repo` 权限）。

> 小团队最简单：由管理员生成一个共享令牌，分发给成员；成员也可各自生成自己的令牌。

### 第 4 步：运行前端

任选其一：

- **本地直接打开**：双击 `index.html`（或 `npx serve .`）。
- **部署到静态托管**：见下文「部署」章节。

打开页面 → 输入 PAT 登录 → 即可增删改查。

---

## 部署

前端是纯静态文件，可部署到任意静态托管。推荐以下方式：

### 方式 A：本地 / 内网（最简单）

```bash
npx serve .
# 或
python -m http.server 8080
```

浏览器访问 `http://localhost:8080`。

### 方式 B：Cloudflare Pages / Netlify / Vercel（公开访问，推荐）

把整个项目推送到 GitHub 后，在对应平台连接该仓库，构建命令留空、输出目录设为根目录，即可获得公网地址。私有仓库也能连接（平台需授权）。

### 方式 C：GitHub Pages

> 注意：私有仓库的 GitHub Pages 需要 GitHub Pro 及以上。若为免费账户，可将前端代码放公开仓库、数据仍放私有仓库（前端只靠令牌访问私有仓库数据）。

1. 仓库 Settings → Pages → 选择分支与根目录 `/ (root)`。
2. 访问 `https://<owner>.github.io/<repo>/`。

---

## 认证方式（两种，可同时使用）

### 1. PAT（个人访问令牌）

- 最简，适合小团队或内网。
- 令牌只保存在成员各自浏览器 `localStorage`，不经过任何服务器。
- 登录界面输入 `ghp_...` 即可。

### 2. OAuth（GitHub 账号登录）

适合成员各自登录、权限可分别管理。需要额外的 Worker 代理（因为 OAuth 的 `client_secret` 不能放在浏览器里）。

**步骤：**

1. GitHub → Settings → Developer settings → OAuth Apps → New OAuth App。
   - Homepage URL：你的站点地址
   - Authorization callback URL：你的站点地址（首页即可，例如 `https://xxx.pages.dev/`）
2. 记录 Client ID / Client Secret。
3. 部署 Worker：

```bash
cd workers
npm i -g wrangler
wrangler login
wrangler secret put GITHUB_CLIENT_ID      # 粘贴 Client ID
wrangler secret put GITHUB_CLIENT_SECRET  # 粘贴 Client Secret
wrangler deploy
```

4. 在 `config.js` 填写：

```js
clientId: '你的ClientID',
redirectUri: 'https://xxx.pages.dev/',
proxyUrl: 'https://xxx.workers.dev'
```

5. 刷新页面，点击「使用 GitHub 账号登录」。

---

## 公开 QSL 登记（无需登录）

除了上面两种登录方式，还有一条给「没有 GitHub 权限的人」用的、**不需要登录**的入口：

1. 打开站点首页，点「📝 QSL 卡登记（无需登录）」；也可以直接把
   `https://你的站点/?submit=1`（或 `#submit`）发给对方。
2. 对方看到的只有一张表单：对方呼号、本台呼号、波段、模式、通联日期、时间 (UTC)、信号报告、提交人、备注。
3. 提交后前端调用云函数 `POST /submit`，由云函数用环境变量里的 `GITHUB_SUBMIT_TOKEN`
   把这条记录**直接追加到主数据库的 `data/qsl-cards.json`**，只回一句回执。
   **提交页不加载任何已有数据，回执里也不含已有数据。**
4. 成员在「📮 QSL 卡」里点一下「↻ 刷新」就能看到新记录（默认卡片状态「未收到」、
   回信「未回信」、发信人＝提交人），之后按正常流程编辑即可。

### 可选：改成「独立登记库 + 手动并入」

如果担心写入口被滥用，可以改成两段式：提交先落独立仓库，成员核对后再并入主库。
（`Lily4046` 下已经有一个现成的私有库 `ham-radio-club-qsl` 可用。）

1. 在 `config.js` 里填上登记仓库（留空 `null` 就是默认的"直接写主库"）：
   ```js
   publicRepo: { owner: '你的用户名', repo: 'ham-radio-club-qsl', branch: 'main' }
   ```
2. 给云函数加环境变量 `PUBLIC_REPO_OWNER` / `PUBLIC_REPO_NAME` / `PUBLIC_REPO_BRANCH`，
   并把 `GITHUB_SUBMIT_TOKEN` 换成只授权这个登记仓库的令牌。
3. 成员要能看到/清理登记库：把成员加为这个仓库的协作者（游客默认看不到这一栏）。
4. 之后「📝 QSL 登记」栏会重新出现，核对完点「📥 并入 QSL 卡」并入主库并从登记库删除。

几个可调项：

| 位置 | 配置 | 作用 |
|------|------|------|
| `config.js` | `publicSubmit: false` | 首页不显示登记入口 |
| `config.js` | `guestRead: false` | 首页不显示「游客登录（只读浏览）」 |
| `config.js` | `publicRepo` | 留空＝直接写主库 QSL 卡文件；填了＝先写独立登记库再手动并入 |
| `config.js` | `readViaProxy` | 成员读取也走腾讯云代理（国内直连 api.github.com 慢时打开，列表加载会快很多） |
| 云函数环境变量 | `PUBLIC_REPO_OWNER` / `PUBLIC_REPO_NAME` / `PUBLIC_REPO_BRANCH` | 只有用「独立登记库」模式时才需要配 |
| 云函数环境变量 | `PUBLIC_QSL_PATH` | 写入的文件路径；默认主库模式 `data/qsl-cards.json`、登记库模式 `data/qsl-public.json` |
| 云函数环境变量 | `PUBLIC_READ_PATHS` | 只读代理允许读哪些文件；填 `data/qsl-public.json` 即「未授权的人只能读公开登记文件」，填 `*` 放开全部，不填＝保持旧行为 |

> 云函数的部署与这些环境变量见 [tencent-scf/README.md](tencent-scf/README.md)。
> 注意：公开登记写入用的是云函数里的令牌，前端和提交者都接触不到任何令牌。
>
> 提交要跨太平洋访问 GitHub，正常需要几秒；已做的提速（少一次往返、连接复用、打开页面预热云函数）
> 和还能在腾讯云侧调的开关，见 [tencent-scf/README.md](tencent-scf/README.md) 的「六、提交速度慢怎么办」。

---

## 数据文件格式

每个文件是一个 JSON 对象，内含 `items` 数组：

```json
{
  "items": [
    {
      "id": "id_xxx",
      "name": "万用表",
      "category": "仪器仪表",
      "quantity": 2,
      "location": "仪器柜 2 层",
      "status": "在库",
      "updatedAt": "2025-01-01T00:00:00.000Z",
      "updatedBy": "用户名"
    }
  ]
}
```

- 字段定义在 `js/models.js`，可自由增删字段（前端表单与表格会自动跟随）。
- `id` 必须唯一；`updatedAt` / `updatedBy` 由前端自动写入。
- 若文件不存在，前端首次加载会自动创建空文件（需令牌具备写权限）。

### 初始化种子数据（可选）

```bash
# PowerShell
$env:GITHUB_TOKEN = "ghp_你的令牌"
$env:REPO_OWNER  = "你的用户名"
$env:REPO_NAME   = "ham-radio-club-data"
node scripts/init-repo.mjs
```

会把 `data/` 下的示例数据上传到仓库对应路径。

---

## 主要功能

- ✅ 三类数据（实验室物品 / QSL 卡 / 电台设备）的**增、删、改、查**
- ✅ 第四类「QSL 登记」：**没有 GitHub 权限的人无需登录即可提交**，成员在标签页里查看、修改、删除（单独存 `data/qsl-public.json`）
- ✅ 关键词**搜索**（匹配任意字段）
- ✅ 表格**筛选**（按下拉字段过滤）与**排序**（点击表头升降序）
- ✅ QSL 卡**查重**（保存时按「呼号 + 日期 + 波段 + 模式」提示疑似重复）
- ✅ QSL 卡新增「发信人」「来信地址」字段（登记来信人姓名与回信地址）
- ✅ 每个文件的**变更记录**（提交历史，含提交人/时间）
- ✅ **导出** JSON 备份
- ✅ 多人协作时的**乐观并发 + 自动冲突合并**（按记录 `id` 三方合并）
- ✅ PAT 与 OAuth 双登录
- ✅ 配置可在前端「设置」面板按成员本地覆盖

---

## 安全须知

1. **令牌即密码**：PAT 拥有仓库读写权限，务必仅分发给可信成员，泄露后立即吊销。
2. **令牌存于浏览器**：本系统把令牌保存在成员各自浏览器的 `localStorage`，不经过任何第三方服务器（OAuth 模式的 Worker 仅用于换取令牌，不存储令牌）。
3. **私有仓库**：强烈建议数据仓库保持 **Private**；免费账户使用 GitHub Pages 时注意 Private Pages 需 Pro。
4. **OAuth secret 不入前端**：`client_secret` 只存放在 Worker 的环境变量中。
5. 定期在 GitHub 设置中审查并回收不再使用的令牌。
6. **公开登记是唯一的对外写入口**：云函数用 `GITHUB_SUBMIT_TOKEN` 代写，只允许写
   `PUBLIC_QSL_PATH` 这一个文件（默认就是主库的 `data/qsl-cards.json`），只接受白名单字段并做了
   长度截断、限流和蜜罐；前端与提交者全程拿不到令牌，也读不到任何已有数据。
   也就是说，外部只能往 QSL 卡数据里**追加一条格式固定的记录**，改不了别的文件、别的数据。
   如果想连这点风险也避免，就切到「独立登记库 + 手动并入」模式（见上一节）。
7. **只想给未授权者看部分数据**：给云函数配 `PUBLIC_READ_PATHS`（逗号分隔的路径白名单），
   或在 `config.js` 里把 `guestRead` 设为 `false` 关掉游客只读入口。

---

## 自检

改完 `js/models.js` / `js/store.js` 后，可以跑一遍不需要网络、也不依赖浏览器的自检：

```bash
node scripts/selftest.mjs
```

覆盖：字段规整与校验、切换 owner/repo/branch 后缓存失效、游客只读不建文件、写入失败回滚、409 冲突三方合并、删除记录。

---

## 常见问题（FAQ）

**Q：登录后提示 404「找不到仓库或文件」？**
A：私有仓库无权限时 GitHub 也返回 404。请检查 `owner`/`repo`/`branch` 是否写对，以及令牌是否被授权访问该仓库。

**Q：提示 403 无权限？**
A：令牌缺少 `repo`（或 Contents 读写）权限，重新生成令牌并授权。

**Q：提示 401 认证失败？**
A：令牌无效或已过期/被吊销，请重新登录。

**Q：多人同时编辑会不会互相覆盖？**
A：不会直接覆盖。写入带 `sha` 校验，冲突时前端会自动重新拉取并按记录 `id` 合并后重试；若冲突过于频繁，会提示刷新重试。

**Q：能加字段吗？**
A：能。修改 `js/models.js` 中对应数组，前端表格与表单会自动同步；已存在的旧数据缺少该字段会显示为「—」。

---

## 技术栈

- 原生 HTML / CSS / JavaScript（无框架、无构建步骤、零运行时依赖）
- GitHub REST API（Contents / Commits 接口）
- Cloudflare Worker（可选，用于 OAuth 令牌交换）

---

## 许可证

本项目为社团内部工具，可自由修改与分发。
