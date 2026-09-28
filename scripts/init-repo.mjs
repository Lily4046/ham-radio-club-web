#!/usr/bin/env node
/* =========================================================================
 * 初始化脚本：把本地 data/*.json 上传到私有 GitHub 仓库
 * -------------------------------------------------------------------------
 * 用法（PowerShell / 终端）：
 *   $env:GITHUB_TOKEN = "ghp_你的令牌"
 *   $env:REPO_OWNER  = "你的用户名"
 *   $env:REPO_NAME   = "ham-radio-club-data"
 *   node scripts/init-repo.mjs
 *
 * 或一次性传入：
 *   GITHUB_TOKEN=xxx REPO_OWNER=yyy REPO_NAME=zzz node scripts/init-repo.mjs
 *
 * 说明：仓库需已存在；令牌需具备 repo 权限。
 * 如果前端首次加载时文件不存在，它也会自动初始化空文件，本脚本主要用于
 * 一次性导入 data/ 下的种子（示例）数据。
 * ========================================================================= */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const TOKEN = process.env.GITHUB_TOKEN;
const OWNER = process.env.REPO_OWNER;
const REPO = process.env.REPO_NAME;
const BRANCH = process.env.REPO_BRANCH || 'main';

const FILES = [
  'data/lab-items.json',
  'data/qsl-cards.json',
  'data/radio-equipment.json'
];

if (!TOKEN || !OWNER || !REPO) {
  console.error('缺少环境变量：请设置 GITHUB_TOKEN、REPO_OWNER、REPO_NAME。');
  process.exit(1);
}

async function api(method, path, body) {
  const res = await fetch('https://api.github.com' + path, {
    method,
    headers: {
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Authorization': 'Bearer ' + TOKEN,
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) {
    const err = new Error(data && data.message ? data.message : ('HTTP ' + res.status));
    err.status = res.status;
    throw err;
  }
  return data;
}

function encodeBase64(str) {
  return Buffer.from(str, 'utf8').toString('base64');
}

async function currentSha(path) {
  try {
    const d = await api('GET', `/repos/${OWNER}/${REPO}/contents/${path}?ref=${BRANCH}`);
    return d.sha;
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

async function main() {
  for (const rel of FILES) {
    const content = await readFile(join(ROOT, rel), 'utf8');
    const sha = await currentSha(rel);
    const body = {
      message: `初始化 ${rel}`,
      content: encodeBase64(content),
      branch: BRANCH
    };
    if (sha) body.sha = sha;
    await api('PUT', `/repos/${OWNER}/${REPO}/contents/${rel}`, body);
    console.log(`✔ 已上传 ${rel}`);
  }
  console.log('\n初始化完成。请在 config.js 中确认 owner/repo/branch，然后打开 index.html。');
}

main().catch((e) => {
  console.error('初始化失败：', e.message);
  process.exit(1);
});
