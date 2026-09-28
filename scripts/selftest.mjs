#!/usr/bin/env node
/* =========================================================================
 * 轻量自检：在 Node 里直接跑 config / models / store 的逻辑，不联网、不需要浏览器
 * -------------------------------------------------------------------------
 * 用法：node scripts/selftest.mjs
 *
 * 覆盖点：
 *   1. 字段规整（normalize）与校验（validate）
 *   2. 切换 owner/repo/branch 后，旧缓存必须失效
 *   3. 游客只读：数据文件不存在时不尝试写入
 *   4. 写入失败必须回滚内存数据（不留「幽灵记录」）
 *   5. 409 冲突：重新拉取 + 按 id 三方合并后重试
 *   6. 删除、批量新增/批量删除
 *   7. 公开登记：独立仓库隔离、字段映射、云函数入库校验与只读白名单
 * ========================================================================= */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const LS_KEY = 'ham.config.v1';

let passed = 0;
let failed = 0;

function ok(name, cond, detail) {
  if (cond) {
    passed++;
    console.log('  ✔ ' + name);
  } else {
    failed++;
    console.log('  ✘ ' + name + (detail === undefined ? '' : ' → ' + JSON.stringify(detail)));
  }
}

function eq(name, actual, expected) {
  ok(name, JSON.stringify(actual) === JSON.stringify(expected), { actual, expected });
}

// 在 vm 沙箱里加载前端的 config.js / models.js / store.js，
// 用假的 localStorage + 假的 GitHub 传输层驱动，这样 repoFor / 缓存 / 回滚都是真代码。
function createApp() {
  const ls = new Map();
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    Promise,
    localStorage: {
      getItem: (k) => (ls.has(k) ? ls.get(k) : null),
      setItem: (k, v) => { ls.set(k, String(v)); },
      removeItem: (k) => { ls.delete(k); }
    }
  };
  sandbox.window = sandbox;
  sandbox.reads = [];
  sandbox.writes = [];
  sandbox._guest = false;
  sandbox.HAM = {
    Auth: { isGuest: () => !!sandbox._guest },
    GitHub: {
      readFile: (path, target) => {
        sandbox.reads.push({ path: path, target: target });
        return sandbox._readImpl(path, target);
      },
      writeFile: (path, data, sha, message, target) => {
        sandbox.writes.push({ path: path, target: target });
        return sandbox._writeImpl(path, data, sha, message, target);
      }
    }
  };
  sandbox._readImpl = async () => ({ exists: false, sha: null, data: null });
  sandbox._writeImpl = async () => 'sha-default';
  vm.createContext(sandbox);
  for (const file of ['config.js', 'js/models.js', 'js/store.js']) {
    vm.runInContext(readFileSync(join(ROOT, file), 'utf8'), sandbox, { filename: file });
  }
  return sandbox;
}

// 模拟「设置面板」写入本地覆盖配置（config.js 会实时读取）
function setOverride(app, patch) {
  const raw = app.localStorage.getItem(LS_KEY);
  const cur = raw ? JSON.parse(raw) : {};
  app.localStorage.setItem(LS_KEY, JSON.stringify(Object.assign(cur, patch)));
}

function httpError(status, message) {
  const e = new Error(message || ('HTTP ' + status));
  e.status = status;
  return e;
}

const app = createApp();

console.log('\n[1] 字段规整 / 校验');
eq('数量字符串转数字', app.HAM.Models.normalize('lab', { name: ' 电烙铁 ', quantity: '3' }),
  { name: '电烙铁', quantity: 3 });
const labValid = { name: 'x', status: '在库' };
ok('数量为负 → 报错', app.HAM.Models.validate('lab', Object.assign({ quantity: -1 }, labValid)).length === 1);
ok('数量为小数 → 报错', app.HAM.Models.validate('lab', Object.assign({ quantity: 1.5 }, labValid)).length === 1);
ok('数量为空 → 必填报错', app.HAM.Models.validate('lab', Object.assign({ quantity: '' }, labValid)).length === 1);
eq('合法数据通过', app.HAM.Models.validate('lab', Object.assign({ quantity: 0 }, labValid)), []);

console.log('\n[2] 本地写入按 id 合并（409 冲突重试）');
app._readImpl = async () => ({ exists: true, sha: 'sha-remote-1', data: { items: [{ id: 'a', name: 'A', updatedAt: 'v1' }] } });
let rejectOnce = true;
app._writeImpl = async () => {
  if (rejectOnce) {
    rejectOnce = false;
    // 远程在这期间新增了 b
    app._readImpl = async () => ({
      exists: true,
      sha: 'sha-remote-2',
      data: { items: [{ id: 'a', name: 'A', updatedAt: 'v1' }, { id: 'b', name: 'B（他人新增）' }] }
    });
    throw httpError(409, 'sha does not match');
  }
  return 'sha-remote-3';
};

await app.HAM.Store.refresh('lab');
eq('初始缓存 1 条', app.HAM.Store.getCached('lab').items.length, 1);
await app.HAM.Store.updateItem('lab', 'a', { name: 'A2' }, '改 A');
eq('冲突后合并：本地改动 + 他人新增都在', app.HAM.Store.getCached('lab').items.map((i) => i.id), ['a', 'b']);
eq('本地改动保留', app.HAM.Store.getCached('lab').items[0].name, 'A2');

console.log('\n[3] 写入失败必须回滚');
app._readImpl = async () => ({ exists: true, sha: 'sha-4', data: { items: [{ id: 'a', name: 'A2' }] } });
app._writeImpl = async () => { throw httpError(403, 'no permission'); };
await app.HAM.Store.refresh('lab');
let err = null;
try {
  await app.HAM.Store.addItem('lab', { id: 'ghost', name: '幽灵' }, '新增');
} catch (e) {
  err = e;
}
ok('写入 403 会抛出友好错误', !!err && /无权限/.test(err.message), err && err.message);
eq('失败后缓存回滚，没有幽灵记录', app.HAM.Store.getCached('lab').items.map((i) => i.id), ['a']);

console.log('\n[4] 仓库配置变更 → 缓存失效');
eq('切换前已缓存', app.HAM.Store.isCached('lab'), true);
setOverride(app, { owner: 'another-user' });
eq('切换 owner 后 cache 视为未命中', app.HAM.Store.isCached('lab'), false);
eq('getCached 返回 null（不暴露上个仓库的数据）', app.HAM.Store.getCached('lab'), null);
app._readImpl = async () => ({ exists: true, sha: 'sha-x', data: { items: [] } });
const readsBefore = app.reads.length;
await app.HAM.Store.load('lab');
eq('切仓库后确实重新拉取', app.reads.length - readsBefore, 1);
app.localStorage.removeItem(LS_KEY);

console.log('\n[5] 游客只读：文件不存在不写盘');
app._guest = true;
const writesBefore = app.writes.length;
app._readImpl = async () => ({ exists: false, sha: null, data: null });
await app.HAM.Store.load('qsl', true);
eq('游客拿到空列表', app.HAM.Store.getCached('qsl').items, []);
eq('游客未尝试写入', app.writes.length - writesBefore, 0);
app._guest = false;

console.log('\n[6] 删除 / 批量增删');
app._readImpl = async () => ({ exists: true, sha: 'sha-5', data: { items: [{ id: 'a' }, { id: 'b' }] } });
app._writeImpl = async () => 'sha-6';
await app.HAM.Store.refresh('radio');
await app.HAM.Store.removeItem('radio', 'a', '删 a');
eq('删除后只剩 b', app.HAM.Store.getCached('radio').items.map((i) => i.id), ['b']);

await app.HAM.Store.refresh('qsl');
let batchWrites = app.writes.length;
await app.HAM.Store.addMany('qsl', [{ id: 'x1' }, { id: 'x2' }], '批量新增 2 条');
eq('批量新增只提交一次', app.writes.length - batchWrites, 1);
eq('批量新增结果', app.HAM.Store.getCached('qsl').items.map((i) => i.id), ['a', 'b', 'x1', 'x2']);
batchWrites = app.writes.length;
await app.HAM.Store.removeMany('qsl', ['x1', 'x2'], '批量删除');
eq('批量删除只提交一次', app.writes.length - batchWrites, 1);
eq('批量删除结果', app.HAM.Store.getCached('qsl').items.map((i) => i.id), ['a', 'b']);

console.log('\n[7] 公开登记：独立仓库隔离 + 字段映射');
const pubTarget = app.HAM.CONFIG.repoFor('publicQsl');
const mainTarget = app.HAM.CONFIG.repoFor('qsl');
eq('公开登记落在独立仓库', [pubTarget.owner, pubTarget.repo, pubTarget.branch],
  ['Lily4046', 'ham-radio-club-qsl', 'main']);
eq('主库仍是主数据库', [mainTarget.owner, mainTarget.repo, mainTarget.branch],
  ['Lily4046', 'ham-radio-club', 'main']);
ok('mainTarget 标记为公开仓库', mainTarget.isPublicRepo === false && pubTarget.isPublicRepo === true);

app._readImpl = async () => ({
  exists: true,
  sha: 'p1',
  data: { items: [{ id: 'pub_1', callsign: 'JA1ABC', date: '2026-09-28', timeUtc: '08:30', submitter: '张三', notes: '野外架台', submittedAt: '2026-09-28T09:00:00.000Z' }] }
});
await app.HAM.Store.refresh('publicQsl');
const lastRead = app.reads[app.reads.length - 1];
eq('读取公开登记确实打到独立仓库', [lastRead.target.owner, lastRead.target.repo],
  ['Lily4046', 'ham-radio-club-qsl']);
eq('读取公开登记的文件路径', lastRead.path, 'data/qsl-public.json');
eq('默认不给游客看登记库', app.HAM.CONFIG.get().publicQslForGuest, false);

const pubItem = app.HAM.Store.getCached('publicQsl').items[0];
const mapped = app.HAM.Models.toQslFromPublic(pubItem, 'lily');
eq('并入后保留呼号/日期/时间', [mapped.callsign, mapped.date, mapped.timeUtc], ['JA1ABC', '2026-09-28', '08:30']);
eq('并入后默认状态', [mapped.cardStatus, mapped.replied], ['未收到', '未回信']);
eq('并入后记录来源 id（用于去重）', mapped.sourceId, 'pub_1');
ok('并入后备注带溯源信息', mapped.notes.indexOf('公开登记') !== -1, mapped.notes);

// 登记表字段：呼号（原「对方呼号」）+ 卡片信息，不再有「本台呼号」「提交人」
const pubFields = app.HAM.Models.MODELS.publicQsl.fields.map((f) => f.key);
eq('登记表字段', pubFields,
  ['callsign', 'senderName', 'band', 'mode', 'date', 'timeUtc', 'rst',
    'cardStatus', 'replied', 'senderAddress', 'contact', 'notes']);
eq('「对方呼号」已改名为「呼号」',
  app.HAM.Models.MODELS.publicQsl.fields[0].label, '呼号');
ok('登记表删掉了「本台呼号」', pubFields.indexOf('ourCallsign') === -1);
ok('登记表删掉了「提交人」', pubFields.indexOf('submitter') === -1);
eq('登记表只剩呼号与日期必填',
  app.HAM.Models.MODELS.publicQsl.fields.filter((f) => f.required).map((f) => f.key),
  ['callsign', 'date']);
eq('只有呼号+日期也能通过校验',
  app.HAM.Models.validate('publicQsl', { callsign: 'JA1ABC', date: '2026-09-28' }), []);

console.log('\n[8] 云函数：公开登记入库校验 + 写入目标钉死');
const scf = require(join(ROOT, 'tencent-scf/index.js'));
ok('云函数：缺必填被拒', !!scf._sanitizeSubmit({ callsign: '', date: '2025-01-05', submitter: 'x' }).error);
ok('云函数：日期格式非法被拒', !!scf._sanitizeSubmit({ callsign: 'a', date: '2025/01/05', submitter: 'b' }).error);
const submit = scf._sanitizeSubmit({
  callsign: ' JA1ABC ', date: '2025-01-05', timeUtc: '08:30', submitter: '张三',
  notes: 'x'.repeat(5000), evil: '不该被写进文件'
});
ok('云函数：合法记录通过', !submit.error);
eq('云函数：字段去首尾空格', submit.record.callsign, 'JA1ABC');
eq('云函数：备注截断到 1000 字', submit.record.notes.length, 1000);
eq('云函数：白名单外字段被丢弃', submit.record.evil, undefined);
ok('云函数：自动补 id / 时间 / 来源',
  /^pub_/.test(submit.record.id) && !!submit.record.updatedAt && submit.record.source === 'public');

const full = scf._sanitizeSubmit({
  callsign: 'JA1ABC', date: '2026-01-05', submitter: '田中',
  senderName: '田中太郎', senderAddress: '东京都xx区', contact: 'ja1abc@example.com',
  cardStatus: '已寄出', replied: '已回信'
});
eq('云函数：保留登记人填的卡片状态与回信情况',
  [full.record.cardStatus, full.record.replied], ['已寄出', '已回信']);
eq('云函数：保留回信地址与联系方式',
  [full.record.senderAddress, full.record.contact], ['东京都xx区', 'ja1abc@example.com']);
eq('云函数：保留发信人姓名', full.record.senderName, '田中太郎');
const noSubmitter = scf._sanitizeSubmit({ callsign: 'JA1ABC', date: '2026-01-05', senderName: '' });
ok('云函数：没填提交人也能收下', !noSubmitter.error);
eq('云函数：发信人姓名缺失时回落到呼号', noSubmitter.record.senderName, 'JA1ABC');
eq('云函数：更新人同样回落到呼号', noSubmitter.record.updatedBy, 'JA1ABC');
const bad = scf._sanitizeSubmit({
  callsign: 'JA1ABC', date: '2026-01-05', submitter: '田中',
  cardStatus: '乱填的状态', replied: '乱填'
});
eq('云函数：非法状态回落到默认值', [bad.record.cardStatus, bad.record.replied], ['未收到', '未回信']);
eq('云函数：没填发信人姓名时用提交人补', bad.record.senderName, '田中');

process.env.PUBLIC_REPO_NAME = 'ham-radio-club-qsl';
eq('云函数：配了环境变量后，前端传主库也写不进主库',
  scf._publicRepoParams({ repo: 'ham-radio-club' }).repo, 'ham-radio-club-qsl');
delete process.env.PUBLIC_REPO_NAME;
eq('云函数：没配环境变量时用请求里的登记仓库',
  scf._publicRepoParams({ repo: 'staging' }).repo, 'staging');

delete process.env.PUBLIC_READ_PATHS;
eq('只读代理：未配置白名单时保持旧行为', scf._readAllowed('data/lab-items.json'), true);
process.env.PUBLIC_READ_PATHS = 'data/qsl-public.json';
eq('只读代理：白名单内放行', scf._readAllowed('data/qsl-public.json'), true);
eq('只读代理：白名单外拒绝（未授权者看不到其他数据）', scf._readAllowed('data/lab-items.json'), false);
process.env.PUBLIC_READ_PATHS = '*';
eq('只读代理：* 表示放开全部', scf._readAllowed('data/lab-items.json'), true);
delete process.env.PUBLIC_READ_PATHS;

console.log('\n[9] 云函数路由：预热 / 预检 / 缺令牌提示（不联网）');
const ping = await scf.main_handler({ path: '/ping', httpMethod: 'POST', body: '{}' });
eq('POST /ping 返回 200', ping.statusCode, 200);
eq('/ping 回执含 warm 标记', JSON.parse(ping.body).warm, true);
const opt = await scf.main_handler({ path: '/', httpMethod: 'OPTIONS' });
eq('OPTIONS 预检返回 204', opt.statusCode, 204);
delete process.env.GITHUB_SUBMIT_TOKEN;
const noToken = await scf.main_handler({
  path: '/submit',
  httpMethod: 'POST',
  body: JSON.stringify({ record: { callsign: 'JA1ABC', date: '2026-01-01', submitter: '张三' } })
});
eq('没配写入令牌时 /submit 返回 500', noToken.statusCode, 500);
ok('没配写入令牌时给出中文提示',
  String(JSON.parse(noToken.body).message || '').indexOf('GITHUB_SUBMIT_TOKEN') !== -1);

console.log('\n[10] 提交提速：热实例缓存 sha，少一次 GitHub 往返');
// 用假的 https 层顶掉真实网络，检查「第一次读+写，第二次只写」
function fakeGithub(responder) {
  const httpsMod = require('node:https');
  const { EventEmitter } = require('node:events');
  const calls = [];
  let lastBody = null;
  const original = httpsMod.request;
  httpsMod.request = function (opts, cb) {
    const req = new EventEmitter();
    req.write = function (b) { lastBody = b; };
    req.end = function () {
      const out = responder(opts, calls, lastBody) || {};
      const res = new EventEmitter();
      res.statusCode = out.status || 200;
      cb(res);
      setImmediate(function () {
        res.emit('data', JSON.stringify(out.data || {}));
        res.emit('end');
      });
    };
    calls.push({ method: opts.method, path: opts.path });
    return req;
  };
  return { calls, restore: function () { httpsMod.request = original; } };
}

const fileBody = Buffer.from(JSON.stringify({ items: [{ id: 'seed' }] }), 'utf8').toString('base64');
let conflictNext = false;
const gh = fakeGithub(function (opts, calls, bodyText) {
  if (opts.method === 'GET') return { status: 200, data: { content: fileBody, sha: 'sha-1' } };
  if (conflictNext) {
    // 模拟「别人刚好也提交了」，这一次写入冲突
    conflictNext = false;
    return { status: 409, data: { message: 'sha does not match' } };
  }
  const sent = JSON.parse(bodyText);
  return { status: 201, data: { content: { sha: 'sha-' + sent.content.length } } };
});

process.env.GITHUB_SUBMIT_TOKEN = 'fake-token';
const sub = (callsign) => scf.main_handler({
  path: '/submit',
  httpMethod: 'POST',
  headers: { 'x-forwarded-for': '10.0.0.' + callsign.length },
  body: JSON.stringify({ record: { callsign: callsign, date: '2026-01-02', submitter: '张三' } })
});

eq('第一次提交成功', (await sub('JA1AAA')).statusCode, 200);
eq('第一次：读 1 次 + 写 1 次',
  [gh.calls.filter((c) => c.method === 'GET').length, gh.calls.filter((c) => c.method === 'PUT').length], [1, 1]);

const before = gh.calls.length;
eq('第二次提交（命中缓存）也成功', (await sub('JA2BBB')).statusCode, 200);
eq('第二次提交没有再去读 GitHub',
  gh.calls.slice(before).filter((c) => c.method === 'GET').length, 0);

const before3 = gh.calls.length;
conflictNext = true;
eq('第三次提交（写冲突）自动重读后成功', (await sub('JA3CCC')).statusCode, 200);
eq('冲突后确实重新读了一次最新内容',
  gh.calls.slice(before3).filter((c) => c.method === 'GET').length, 1);

gh.restore();
delete process.env.GITHUB_SUBMIT_TOKEN;

console.log('\n' + (failed === 0 ? '✅ 全部通过' : '❌ 有失败项') + '：' + passed + ' 通过 / ' + failed + ' 失败\n');
process.exit(failed === 0 ? 0 : 1);
