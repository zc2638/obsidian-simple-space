import test from 'node:test';
import assert from 'node:assert/strict';

const api = await import('../src/core/daily-notes.js').catch(() => ({}));
const date = new Date(2026, 1, 17, 9, 8, 7);
function formatDate(value, pattern) {
  const tokens = { YYYY: value.getFullYear(), MM: String(value.getMonth() + 1).padStart(2, '0'), DD: String(value.getDate()).padStart(2, '0'), HH: String(value.getHours()).padStart(2, '0'), mm: String(value.getMinutes()).padStart(2, '0'), ss: String(value.getSeconds()).padStart(2, '0') };
  return pattern.replace(/YYYY|MM|DD|HH|mm|ss/g, token => tokens[token]);
}
function vaultFixture(core, initial = {}) {
  const entries = new Map(Object.entries(initial).map(([path, content]) => [path, { path, extension: 'md', content }]));
  const opened = [];
  const vault = {
    configDir: '.obsidian',
    adapter: { exists: async path => path === '.obsidian/daily-notes.json' && core !== undefined, read: async () => JSON.stringify(core) },
    getAbstractFileByPath: path => entries.get(path),
    read: async file => file.content,
    createFolder: async path => { if (entries.has(path)) throw new Error('already exists'); entries.set(path, { path, children: [] }); },
    create: async (path, content) => { if (entries.has(path)) throw new Error('already exists'); const file = { path, extension: 'md', content }; entries.set(path, file); return file; },
  };
  return { app: { vault }, entries, opened, openPath: async path => opened.push(path) };
}
function requireApi(name) { assert.equal(typeof api[name], 'function', `${name} 日记接口尚未实现`); return api[name]; }

test('模板支持日期、时间、自定义格式与标题', () => {
  const interpolate = requireApi('interpolateDailyTemplate');
  assert.equal(interpolate('{{date}} {{date:YYYY/MM/DD}} {{time}} {{time:HH:mm:ss}} {{title}}', date, '17', formatDate), '2026-02-17 2026/02/17 09:08 09:08:07 17');
});

test('核心日记配置优先，并保留根目录设置', async () => {
  const fixture = vaultFixture({ folder: '', format: 'YYYY/MM/DD', template: '模板/日记' });
  const settings = await requireApi('resolveDailyNoteSettings')(fixture.app, { dailyFolder: '日记', dailyFormat: 'YYYY-MM-DD', dailyTemplate: '' });
  assert.deepEqual(settings, { folder: '', format: 'YYYY/MM/DD', template: '模板/日记' });
});

test('无核心配置或禁用核心配置时使用卡片设置', async () => {
  const resolve = requireApi('resolveDailyNoteSettings');
  assert.deepEqual(await resolve(vaultFixture().app, {}), { folder: '日记', format: 'YYYY-MM-DD', template: '' });
  assert.deepEqual(await resolve(vaultFixture({ folder: '核心' }).app, { useDailyNotes: false, dailyFolder: '', dailyFormat: 'YYYY/MM/DD' }), { folder: '', format: 'YYYY/MM/DD', template: '' });
});

test('嵌套日期格式创建目录，模板路径自动补 md', async () => {
  const fixture = vaultFixture({ folder: '日记', format: 'YYYY/MM/DD', template: '模板/日记' }, { '模板/日记.md': '# {{title}}\n{{date}} {{time}}' });
  const path = await requireApi('openDailyNote')({ ...fixture, config: {}, date, formatDate });
  assert.equal(path, '日记/2026/02/17.md');
  assert.equal(fixture.entries.get(path).content, '# 17\n2026-02-17 09:08');
  assert.ok(fixture.entries.has('日记/2026/02'));
  assert.deepEqual(fixture.opened, [path]);
});

test('根目录日记不创建空目录', async () => {
  const fixture = vaultFixture({ folder: '', format: 'YYYY-MM-DD', template: '' });
  await requireApi('openDailyNote')({ ...fixture, config: {}, date, formatDate });
  assert.equal(fixture.entries.size, 1);
  assert.ok(fixture.entries.has('2026-02-17.md'));
});
test('卡片目录使用点表示根目录时，与模型设置保持一致',async()=>{
 const fixture=vaultFixture();
 const path=await requireApi('openDailyNote')({...fixture,config:{useDailyNotes:false,dailyFolder:'.'},date,formatDate});
 assert.equal(path,'2026-02-17.md');assert.equal(fixture.entries.size,1);
});

test('已有日记保持原文，即使模板不存在仍可打开', async () => {
  const fixture = vaultFixture({ folder: '', format: 'YYYY-MM-DD', template: '丢失的模板' }, { '2026-02-17.md': '用户已有内容' });
  await requireApi('openDailyNote')({ ...fixture, config: {}, date, formatDate });
  assert.equal(fixture.entries.get('2026-02-17.md').content, '用户已有内容');
});

test('指定的模板不存在时提示错误且不创建日记', async () => {
  const fixture = vaultFixture({ folder: '日记', format: 'YYYY-MM-DD', template: '不存在' });
  await assert.rejects(requireApi('openDailyNote')({ ...fixture, config: {}, date, formatDate }), /模板.*不存在/);
  assert.equal(fixture.entries.size, 0);
  assert.equal(fixture.opened.length, 0);
});

test('并发创建目录与日记时复查已有文件', async () => {
  const fixture = vaultFixture({ folder: '日记/2026', format: 'YYYY-MM-DD', template: '' });
  const open = requireApi('openDailyNote');
  const paths = await Promise.all([open({ ...fixture, config: {}, date, formatDate }), open({ ...fixture, config: {}, date, formatDate })]);
  assert.deepEqual(paths, ['日记/2026/2026-02-17.md', '日记/2026/2026-02-17.md']);
  assert.equal([...fixture.entries.values()].filter(value => value.extension === 'md').length, 1);
});

test('外部入口赢得创建竞态时读取已存在的日记，不覆盖内容', async () => {
  const fixture = vaultFixture({ folder: '日记', format: 'YYYY-MM-DD', template: '' });
  fixture.app.vault.createFolder = async path => {
    fixture.entries.set(path, { path, children: [] });
    throw new Error('目录被另一入口创建');
  };
  fixture.app.vault.create = async path => {
    fixture.entries.set(path, { path, extension: 'md', content: '另一入口的内容' });
    throw new Error('文件被另一入口创建');
  };
  const path = await requireApi('openDailyNote')({ ...fixture, config: {}, date, formatDate });
  assert.equal(fixture.entries.get(path).content, '另一入口的内容');
  assert.deepEqual(fixture.opened, [path]);
});

test('目录、日期路径、模板均禁止越出 vault', async () => {
  const open = requireApi('openDailyNote');
  for (const config of [ { dailyFolder: '../outside' }, { dailyFolder: '/tmp' }, { dailyFolder: 'C:\\tmp' }, { dailyFolder: 'obsidian://outside' }, { dailyFormat: '../YYYY' }, { dailyTemplate: '../secret' } ]) {
    const fixture = vaultFixture();
    await assert.rejects(open({ ...fixture, config, date, formatDate }), /路径/);
    assert.equal(fixture.entries.size, 0);
  }
});
