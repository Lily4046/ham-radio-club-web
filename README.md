# 📡 业余无线电社团协作管理系统

一个**纯前端、零后端**的在线协作管理系统，为业余无线电社团管理三类数据：

| 模块 | 图标 | 数据文件 |
|------|------|----------|
| 实验室物品 | 🧪 | `data/lab-items.json` |
| QSL 卡 | 📮 | `data/qsl-cards.json` |
| 电台设备 | 📻 | `data/radio-equipment.json` |

所有数据以 JSON 文件形式存储在**私有 GitHub 仓库**中，通过 **GitHub REST API** 读写；前端是静态页面，浏览器打开即可使用，支持社团成员在线增删改查、搜索、变更记录查看与导出。

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
│   ├── models.js           # 三类数据的字段定义与校验
│   ├── store.js            # 数据仓库层（增删改 + 冲突合并）
│   ├── ui.js               # 通用 UI（toast/modal/确认框）
│   ├── views.js            # 视图层（表格/表单/历史/导出）
│   └── app.js              # 应用入口（登录/导航/设置）
├── workers/
│   ├── oauth-proxy.js      # OAuth 令牌交换代理（Cloudflare Worker）
│   └── wrangler.toml       # Worker 配置
├── scripts/
│   └── init-repo.mjs       # Node 脚本：上传种子数据到仓库
├── data/                   # 三类数据的种子（示例）数据
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
- ✅ 关键词**搜索**（匹配任意字段）
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
