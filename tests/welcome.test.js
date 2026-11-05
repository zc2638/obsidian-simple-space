import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

const welcomePath = new URL('../src/cards/welcome.js', import.meta.url);
const calendarPath = new URL('../src/cards/calendar.cjs', import.meta.url);

test('欢迎卡片静态打包日历，不读取旧组件脚本或样式', async () => {
  const source = await readFile(welcomePath, 'utf8').catch(() => '');
  assert.match(source, /import calendar from ['"]\.\/calendar\.cjs['"]/);
  assert.doesNotMatch(source, /mountWorkspaceStyles|new Function|\beval\(|工作台组件\//);
});

test('日历保留春节与节气算法，静态调用日记服务', async () => {
  const source = await readFile(calendarPath, 'utf8').catch(() => '');
  assert.match(source, /openDailyNote/);
  const result = await build({ stdin: { contents: `${source}\nmodule.exports.lunar=WorkspaceLunar;`, resolveDir: new URL('../src/cards/', import.meta.url).pathname, loader: 'js' }, bundle: true, write: false, platform: 'node', format: 'cjs', external: ['obsidian'] });
  assert.ok(/MIT License[\s\S]*Copyright \(c\) 2018 6tail/.test(result.outputFiles[0].text), '打包后必须保留农历库 MIT 声明');
  const module = { exports: {} };
  Function('module', 'exports', 'require', result.outputFiles[0].text)(module, module.exports, () => ({}));
  const lunar = module.exports.lunar;
  assert.ok(lunar.Solar.fromYmd(2026, 2, 17).getLunar().getFestivals().includes('春节'));
  assert.equal(lunar.Solar.fromYmd(2026, 4, 5).getLunar().getJieQi(), '清明');
});

test('欢迎台历打开抽屉，选择日期不建文件，独立按钮才创建日记', async () => {
  const window = new Window();
  const document = window.document;
  const prototype = window.HTMLElement.prototype;
  prototype.addClass = function (...classes) { this.classList.add(...classes); };
  prototype.setText = function (text) { this.textContent = text; };
  prototype.empty = function () { this.replaceChildren(); };
  prototype.createEl = function (tag, options = {}) {
    const element = document.createElement(tag);
    if (options.cls) element.className = options.cls;
    if (options.text) element.textContent = options.text;
    for (const [name, value] of Object.entries(options.attr || {})) element.setAttribute(name, value);
    this.append(element);
    return element;
  };
  prototype.createDiv = function (options) { return this.createEl('div', options); };
  prototype.createSpan = function (options) { return this.createEl('span', options); };
  const modals = [];
  class Modal {
    constructor() {
      this.containerEl = document.createElement('div');
      this.modalEl = this.containerEl.createDiv();
      this.contentEl = this.modalEl.createDiv();
      modals.push(this);
    }
    setTitle(title) { this.title = title; }
    open() { document.body.append(this.containerEl); this.onOpen(); }
    close() { this.containerEl.remove(); this.onClose(); }
  }
  const result = await build({ entryPoints: [welcomePath.pathname], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['obsidian'] });
  const module = { exports: {} };
  const moment = date => ({ format: pattern => pattern.replace('YYYY', String(date.getFullYear())).replace('MM', String(date.getMonth() + 1).padStart(2, '0')).replace('DD', String(date.getDate()).padStart(2, '0')) });
  Function('module', 'exports', 'require', result.outputFiles[0].text)(module, module.exports, () => ({ Modal, moment }));
  const files = new Map();
  let created = 0;
  const opened = [], cleanups = [], intervals = [];
  const vault = {
    configDir: '.obsidian', adapter: { exists: async () => false }, getMarkdownFiles: () => [],
    getAbstractFileByPath: path => files.get(path),
    create: async (path, content) => { created++; const file = { path, content, extension: 'md' }; files.set(path, file); return file; },
  };
  const body = document.body.createDiv();
  await module.exports.default.render(body, { app: { vault }, config: { dailyFolder: '' }, isAlive: () => true, isEditing: () => false, registerCleanup: callback => cleanups.push(callback), registerInterval: callback => intervals.push(callback), openPath: async path => opened.push(path) });
  const trigger = body.querySelector('.ws-desk-calendar');
  assert.ok(trigger);
  assert.equal(created, 0);
  trigger.click();
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');
  const modal = modals[0];
  modal.contentEl.querySelector('.ws-day').click();
  assert.equal(created, 0);
  const dateText = modal.contentEl.querySelector('.ws-calendar-selected-date').textContent.slice(0, 10);
  modal.contentEl.querySelector('.mod-cta').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(created, 1);
  assert.deepEqual(opened, [`${dateText}.md`]);
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(intervals.length, 2);
  cleanups.forEach(cleanup => cleanup());
  await window.happyDOM.close();
});
