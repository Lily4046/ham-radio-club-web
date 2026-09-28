#!/usr/bin/env node
/* =========================================================================
 * 轻量自检：在 Node 里直接跑 models / store 的逻辑，不联网、不需要浏览器
 * -------------------------------------------------------------------------
 * 用法：node scripts/selftest.mjs
 *
 * 覆盖点：
 *   1. 字段规整（normalize）与校验（validate）
 *   2. 切换 owner/repo/branch 后，旧缓存必须失效
 *   3. 游客只读：数据文件不存在时不尝试写入
 *   4. 写入失败必须回滚内存数据（不留「幽灵记录」）
 *   5. 409 冲突：重新拉取 + 按 id 三方合并后重试
 *   6. 删除记录
 *   7. 公开 QSL 登记：模型必填项 + 云函数入库校验/只读白名单
 * ========================================================================= */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

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

// 在 vm 沙箱里加载前端的 models.js / store.js，用假的 CONFIG/Auth/GitHub 驱动
function createApp() {
  const sandbox = { console, setTimeout, clearTimeout, Promise };
  sandbox.window = sandbox;
  sandbox.readCalls = 0;
  sandbox.writeCalls = 0;
  sandbox.HAM = {
    CONFIG: { get: () => Object.assign({}, sandbox._cfg) },
    Auth: { isGuest: () => !!sandbox._guest },
    GitHub: {
      readFile: (path) => { sandbox.readCalls++; return sandbox._readImpl(path); },
      writeFile: (path, data, sha, message) => { sandbox.writeCalls++; return sandbox._writeImpl(path, data, sha, message); }
    }
  };
  sandbox._readImpl = async () => ({ exists: false, sha: null, data: null });
  sandbox._writeImpl = async () => 'sha-default';
  vm.createContext(sandbox);
  for (const file of ['js/models.js', 'js/store.js']) {
    vm.runInContext(readFileSync(join(ROOT, file), 'utf8'), sandbox, { filename: file });
  }
  return sandbox;
}

function httpError(status, message) {
  const e = new Error(message || ('HTTP ' + status));
  e.status = status;
  return e;
}

const app = createApp();
app._cfg = {
  owner: 'me',
  repo: 'ham-radio-club',
  branch: 'main',
  files: { lab: 'data/lab-items.json', qsl: 'data/qsl-cards.json', radio: 'data/radio-equipment.json' }
};
app._guest = false;

console.log('\n[1] 字段规整 / 校验');
eq('数量字符串转数字', app.HAM.Models.normalize('lab', { name: ' 电烙铁 ', quantity: '3' }),
  { name: '电烙铁', quantity: 3 });
const labValid = { name: 'x', status: '在库' };
ok('数量为负 → 报错', app.HAM.Models.validate('lab', Object.assign({ quantity: -1 }, labValid)).length === 1);
ok('数量为小数 → 报错', app.HAM.Models.validate('lab', Object.assign({ quantity: 1.5 }, labValid)).length === 1);
ok('数量为空 → 必填报错', app.HAM.Models.validate('lab', Object.assign({ quantity: '' }, labValid)).length === 1);
eq('合法数据通过', app.HAM.Models.validate('lab', Object.assign({ quantity: 0 }, labValid)), []);

console.log('\n[2] 本地写入按 id 合并（409 冲突重试）');
app._readImpl = async () => {
  return { exists: true, sha: 'sha-remote-1', data: { items: [{ id: 'a', name: 'A', updatedAt: 'v1' }] } };
};
let rejectOnce = true;
app._writeImpl = async () => {
  if (rejectOnce) {
    rejectOnce = false;
    // 远程在这期间新增了 b
    app._readImpl = async () => {
      return {
        exists: true,
        sha: 'sha-remote-2',
        data: { items: [{ id: 'a', name: 'A', updatedAt: 'v1' }, { id: 'b', name: 'B（他人新增）' }] }
      };
    };
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
app._cfg.owner = 'another-user';
eq('切换 owner 后 cache 视为未命中', app.HAM.Store.isCached('lab'), false);
eq('getCached 返回 null（不暴露上个仓库的数据）', app.HAM.Store.getCached('lab'), null);
const before = app.readCalls;
await app.HAM.Store.load('lab');
eq('切仓库后确实重新拉取', app.readCalls, before + 1);

console.log('\n[5] 游客只读：文件不存在不写盘');
app._cfg.owner = 'me';
app._guest = true;
const guestWrites = app.writeCalls;
app._readImpl = async () => ({ exists: false, sha: null, data: null });
app._writeImpl = async () => 'x';
await app.HAM.Store.load('qsl', true);
eq('游客拿到空列表', app.HAM.Store.getCached('qsl').items, []);
eq('游客未尝试写入', app.writeCalls, guestWrites);

console.log('\n[6] 删除记录');
app._guest = false;
app._readImpl = async () => ({ exists: true, sha: 'sha-5', data: { items: [{ id: 'a' }, { id: 'b' }] } });
app._writeImpl = async () => 'sha-6';
await app.HAM.Store.refresh('radio');
await app.HAM.Store.removeItem('radio', 'a', '删 a');
eq('删除后只剩 b', app.HAM.Store.getCached('radio').items.map((i) => i.id), ['b']);

console.log('\n[7] 公开 QSL 登记（新数据文件 + 云函数代写）');
const publicModel = app.HAM.Models.MODELS.publicQsl;
ok('存在 publicQsl 模型', !!publicModel);
eq('必填字段只有呼号/日期/提交人',
  (publicModel.fields.filter((f) => f.required)).map((f) => f.key), ['callsign', 'date', 'submitter']);
ok('缺提交人 → 前端校验拦下',
  app.HAM.Models.validate('publicQsl', { callsign: 'JA1ABC', date: '2025-01-05' }).length === 1);
eq('完整记录通过前端校验',
  app.HAM.Models.validate('publicQsl', { callsign: 'JA1ABC', date: '2025-01-05', submitter: '张三' }), []);

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

delete process.env.PUBLIC_READ_PATHS;
eq('只读代理：未配置白名单时保持旧行为', scf._readAllowed('data/lab-items.json'), true);
process.env.PUBLIC_READ_PATHS = 'data/qsl-public.json';
eq('只读代理：白名单内放行', scf._readAllowed('data/qsl-public.json'), true);
eq('只读代理：白名单外拒绝（未授权者看不到其他数据）', scf._readAllowed('data/lab-items.json'), false);
process.env.PUBLIC_READ_PATHS = '*';
eq('只读代理：* 表示放开全部', scf._readAllowed('data/lab-items.json'), true);
delete process.env.PUBLIC_READ_PATHS;

console.log('\n' + (failed === 0 ? '✅ 全部通过' : '❌ 有失败项') + '：' + passed + ' 通过 / ' + failed + ' 失败\n');
process.exit(failed === 0 ? 0 : 1);
