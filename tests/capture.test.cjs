const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const {spawnSync} = require('node:child_process');

class Element {
 constructor(tag, options = {}, doc) {
  this.tagName = tag.toUpperCase(); this.ownerDocument = doc; this.children = [];
  this.attributes = {...options.attr}; this.style = {}; this.value = ''; this.disabled = false;
  this.className = options.cls || ''; this.text = options.text || '';
  this.classList = {add: (...names) => {this.className += ' ' + names.join(' ');}, remove: (...names) => {this.className = this.className.split(' ').filter(n => !names.includes(n)).join(' ');}};
 }
 createEl(tag, options = {}) {const el = new Element(tag, options, this.ownerDocument); el.parent = this; this.children.push(el); return el;}
 createDiv(options) {return this.createEl('div', options);}
 createSpan(options) {return this.createEl('span', options);}
 addClass(...names) {this.classList.add(...names);}
 removeClass(...names) {this.classList.remove(...names);}
 setText(text) {this.text = String(text); this.children = [];}
 get textContent() {return this.text + this.children.map(c => c.textContent).join('');}
 setAttribute(key, value) {this.attributes[key] = String(value);}
 getAttribute(key) {return this.attributes[key] ?? null;}
 empty() {this.text = ''; this.children = [];}
 remove() {this.parent.children = this.parent.children.filter(c => c !== this);}
 click() {if (!this.disabled) return this.onclick?.({preventDefault() {}});}
 focus() {this.focusCount = (this.focusCount || 0) + 1;}
 pause() {this.paused = true;}
 load() {}
 removeAttribute(key) {delete this.attributes[key];}
 setRangeText(text) {this.value += text;}
 all() {return [this, ...this.children.flatMap(c => c.all())];}
}

const flush = () => new Promise(resolve => setImmediate(resolve));
const roots = new Set();
test.after(() => {for (const root of roots) fs.rmSync(root, {recursive: true, force: true});});
async function setup(t, options = {}) {
 const root = options.root || fs.mkdtempSync(path.join(os.tmpdir(), 'capture-media-')); roots.add(root);
 const draftRoot = root + '-device'; fs.mkdirSync(draftRoot, {recursive: true}); roots.add(draftRoot);
 const legacyPath = options.config?.notePath || '收件箱/灵感.md';
 const config = options.defaults ? {...options.config} : {saveMode: 'single', noteFolder: path.posix.dirname(legacyPath), splitBySize: false, notePath: legacyPath, attachmentFolder: '收件箱/附件/灵感', ...options.config};
 let clock = options.now === undefined ? null : new Date(options.now).getTime();
 class ClockDate extends Date {constructor(...args) {super(...(args.length ? args : clock === null ? [] : [clock]));} static now() {return clock === null ? Date.now() : clock;}}
 const busyGuards = [];
 const cleanups = [], intervals = [], streams = [], recorders = [], revoked = [];
 let failProcess = options.failProcess || 0, alive = true, closedDuringRead = false;
 const listeners = new Map(); let opened = null;
 const makeFile = p => {const stat = fs.statSync(path.join(root, p)); return {path: p, name: path.basename(p), basename: path.parse(p).name, extension: path.extname(p).slice(1), stat: {mtime: stat.mtimeMs, size: stat.size}, ...(stat.isDirectory() ? {children: []} : {})};};
 const vault = {
  configDir: '.obsidian',
  on(event, callback) {const ref = {event, callback}; listeners.set(ref, ref); return ref;},
  offref(ref) {listeners.delete(ref);},
  adapter: {
   async exists(p) {return fs.existsSync(path.join(root, p));},
   async mkdir(p) {fs.mkdirSync(path.join(root, p));},
   async list(p) {const entries = fs.readdirSync(path.join(root, p), {withFileTypes: true}); return {files: entries.filter(x => x.isFile()).map(x => p + '/' + x.name), folders: entries.filter(x => x.isDirectory()).map(x => p + '/' + x.name)};},
   async read(p) {
    if (options.closeDuringRead && !closedDuringRead && /snapshot-/.test(p)) {closedDuringRead = true; alive = false; await Promise.all(cleanups.map(fn => fn()));}
    return fs.readFileSync(path.join(root, p), 'utf8');
   },
   async write(p, text) {fs.writeFileSync(path.join(root, p), text);},
   async readBinary(p) {const b = fs.readFileSync(path.join(root, p)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);},
   async writeBinary(p, data) {if (options.failDraftBinary?.(p)) throw new Error('模拟附件备份失败'); fs.writeFileSync(path.join(root, p), Buffer.from(data));},
   async remove(p) {fs.unlinkSync(path.join(root, p));},
   async rmdir(p) {if (options.failCleanup) throw new Error('模拟草稿清理失败'); fs.rmSync(path.join(root, p), {recursive: true, force: true});},
   async stat(p) {if (!fs.existsSync(path.join(root, p))) return null; const s = fs.statSync(path.join(root, p)); return {type: s.isDirectory() ? 'folder' : 'file', size: s.size, mtime: s.mtimeMs};},
   getResourcePath(p) {return 'file://' + path.join(root, p);}
  },
  getMarkdownFiles() {return fs.readdirSync(root, {recursive: true}).map(String).filter(p => /\.md$/i.test(p) && fs.statSync(path.join(root, p)).isFile()).map(makeFile);},
  async rename(file, target) {const oldPath = file.path; fs.renameSync(path.join(root, oldPath), path.join(root, target)); file.path = target; for(const ref of listeners.values()) if(ref.event === 'rename') ref.callback(makeFile(target), oldPath);},
  getAbstractFileByPath(p) {return fs.existsSync(path.join(root, p)) ? makeFile(p) : null;},
  async createFolder(p) {fs.mkdirSync(path.join(root, p));},
  async create(p, content) {fs.writeFileSync(path.join(root, p), content, {flag: 'wx'}); return makeFile(p);},
  async createBinary(p, content) {fs.writeFileSync(path.join(root, p), Buffer.from(content), {flag: 'wx'}); return makeFile(p);},
  async read(file) {return fs.readFileSync(path.join(root, file.path), 'utf8');},
  async process(file, update) {if (failProcess-- > 0) throw new Error('模拟笔记写入失败'); const p = path.join(root, file.path); fs.writeFileSync(p, update(fs.readFileSync(p, 'utf8')));}
 };
 class Recorder {
  static isTypeSupported(type) {return type.startsWith('audio/webm');}
  constructor(stream, config = {}) {this.stream = stream; this.mimeType = config.mimeType || 'audio/webm'; this.state = 'inactive'; recorders.push(this);}
  start() {if (options.failStart) throw new Error('模拟录音启动失败'); this.state = 'recording';}
  emit(text) {return this.ondataavailable?.({data: new Blob([text], {type: this.mimeType})});}
  finishLater() {const finish = () => {this.ondataavailable?.({data: new Blob(['voice-bytes'], {type: this.mimeType})}); this.onstop?.();}; if (options.stopDelay) setTimeout(finish, options.stopDelay); else queueMicrotask(finish);}
  stop() {this.state = 'inactive'; this.finishLater();}
  fail() {this.state = 'inactive'; this.onerror?.(); this.finishLater();}
 }
 const getUserMedia = options.getUserMedia || (async () => {
  const track = {stopped: false, stop() {this.stopped = true;}};
  const stream = {getTracks: () => [track]}; streams.push(stream); return stream;
 });
 const win = {File, Blob, Date: ClockDate, URL: {createObjectURL: file => URL.createObjectURL(file), revokeObjectURL: url => {revoked.push(url); URL.revokeObjectURL(url);}}, navigator: {mediaDevices: {getUserMedia}}, MediaRecorder: Recorder};
 const doc = {defaultView: win}, card = new Element('article', {cls: 'hp-card-workspace-capture'}, doc);
 const header = card.createDiv({cls: 'hp-card-header'}), headerRight = header.createDiv({cls: 'hp-card-header-right'});
 const headerActions = headerRight.createSpan({cls: 'hp-card-actions'});
 const gear = headerRight.createEl('button', {attr: {type: 'button', 'aria-label': '配置组件'}});
 const body = card.createDiv({cls: 'hp-card-body'});
 const app = options.app || {vault, fileManager: {generateMarkdownLink(file, source, subpath, alias) {return `[[${file.path}${alias ? '|' + alias : ''}]]`;}}};
 const draftAdapter = Object.fromEntries(Object.entries(vault.adapter).filter(([name]) => name !== 'getResourcePath').map(([name, fn]) => [name, (...args) => fn(...args)]));
 const localPath = p => path.join(draftRoot, p);
 draftAdapter.exists = async p => fs.existsSync(localPath(p));
 draftAdapter.mkdir = async p => fs.mkdirSync(localPath(p));
 draftAdapter.list = async p => {const entries = fs.readdirSync(localPath(p), {withFileTypes: true}); return {files: entries.filter(x => x.isFile()).map(x => p + '/' + x.name), folders: entries.filter(x => x.isDirectory()).map(x => p + '/' + x.name)};};
 draftAdapter.read = async p => {if (options.closeDuringRead && !closedDuringRead && /snapshot-/.test(p)) {closedDuringRead = true; alive = false; await Promise.all(cleanups.map(fn => fn()));} return fs.readFileSync(localPath(p), 'utf8');};
 draftAdapter.write = async (p, text) => fs.writeFileSync(localPath(p), text);
 draftAdapter.readBinary = async p => {const b = fs.readFileSync(localPath(p)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);};
 draftAdapter.writeBinary = async (p, bytes) => {if (options.failDraftBinary?.(p)) throw new Error('模拟附件备份失败'); fs.writeFileSync(localPath(p), Buffer.from(bytes));};
 draftAdapter.remove = async p => fs.unlinkSync(localPath(p));
 draftAdapter.rmdir = async p => {if (options.failCleanup) throw new Error('模拟草稿清理失败'); fs.rmSync(localPath(p), {recursive: true, force: true});};
 draftAdapter.stat = async p => {if (!fs.existsSync(localPath(p))) return null; const st = fs.statSync(localPath(p)); return {type: st.isDirectory() ? 'folder' : 'file', size: st.size};};
 const ctx = {app, config, composer: options.composer, draftAdapter: options.noDraftAdapter ? undefined : (options.draftAdapter || draftAdapter), widget: {id: options.widgetId || 'capture-test'},
  registerBusyGuard: fn => busyGuards.push(fn),
  async openPath(p, opts) {opened = {path: p, options: opts};},
  addHeaderAction(icon, label, callback) {const el = headerActions.createEl('button', {cls: 'hp-card-action clickable-icon', attr: {type: 'button', 'aria-label': label, title: label}}); el.onclick = callback; return el;},
  isAlive: () => alive, isEditing: () => false, registerCleanup: fn => cleanups.push(fn),
  registerInterval: fn => {intervals.push(fn); cleanups.push(() => intervals.splice(intervals.indexOf(fn), 1));}};
 const sandbox = {module: {exports: {}}, require: request => request === 'obsidian' ? {setIcon() {}} : require(path.join(__dirname, '../src/cards', request)), console, File, Blob, URL: win.URL, Date: ClockDate, navigator: win.navigator, MediaRecorder: Recorder, window: win};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/cards/capture.cjs'), 'utf8'), sandbox);
 const definition = sandbox.module.exports;
 if (options.initialNote !== undefined) {fs.mkdirSync(path.dirname(path.join(root, config.notePath)), {recursive: true}); fs.writeFileSync(path.join(root, config.notePath), options.initialNote);}
 options.beforeRender?.({vault: app.vault, draftAdapter: ctx.draftAdapter});
 const controller = await definition.render(body, ctx);
 if (!options.recent) {const create = card.all().find(el => el.getAttribute('aria-label') === '创建灵感'); if (create) await create.click();}
 const find = predicate => card.all().find(predicate);
 const byLabel = label => {const el = find(x => x.getAttribute('aria-label') === label); assert.ok(el, `应提供“${label}”控件`); return el;};
 const input = find(x => x.tagName === 'TEXTAREA');
 const save = find(x => x.tagName === 'BUTTON' && x.textContent.includes('保存' + (options.composer?.noun || '灵感')));
 const picker = () => {const el = find(x => x.tagName === 'INPUT' && x.getAttribute('type') === 'file'); assert.ok(el, '应提供附件选择入口'); return el;};
 const add = async files => {const el = picker(); el.files = files; await el.onchange();};
 const dispose = async () => {if (!alive) return; alive = false; await Promise.all(cleanups.map(fn => fn()));};
 const crash = () => {alive = false;};
 t.after(dispose);
 return {root, draftRoot, draftAdapter, busyGuards, config, controller, setNow: value => {clock = new Date(value).getTime();}, app, card, body, headerActions, gear, input, save, byLabel, add, streams, recorders, revoked, definition, dispose, crash,
  get opened() {return opened;},
  visible: () => card.all().filter(el => {for(let parent = el; parent; parent = parent.parent) if(parent.hidden) return false; return true;}),
  async modifyNote(text) {fs.mkdirSync(path.dirname(path.join(root, config.notePath)), {recursive: true}); fs.writeFileSync(path.join(root, config.notePath), text); for(const ref of listeners.values()) if(ref.event === 'modify') ref.callback(makeFile(config.notePath)); await flush();},
  async modifyPath(filePath, text) {fs.mkdirSync(path.dirname(path.join(root, filePath)), {recursive: true}); fs.writeFileSync(path.join(root, filePath), text); for(const ref of listeners.values()) if(ref.event === 'modify') ref.callback(makeFile(filePath)); await flush();},
  listenerCount: () => listeners.size,
  note: () => fs.readFileSync(path.join(root, config.notePath), 'utf8'),
  attachments: () => fs.existsSync(path.join(root, '收件箱/附件/灵感')) ? fs.readdirSync(path.join(root, '收件箱/附件/灵感')) : []};
}

test('文字与原始链接一起保存，原有笔记不覆盖', async t => {
 const h = await setup(t); fs.mkdirSync(path.join(h.root, '收件箱')); fs.writeFileSync(path.join(h.root, '收件箱/灵感.md'), '# 原有内容\n');
 h.input.value = '参考 https://example.com/path?q=1\n新想法'; await h.save.click();
 assert.match(h.note(), /^# 原有内容/); assert.match(h.note(), /https:\/\/example.com\/path\?q=1/); assert.match(h.note(), /新想法/);
});

test('链接预览保留有效括号，排除 Markdown 自身的闭合括号', async t => {
 const h = await setup(t);
 h.input.value = '[参考](https://example.com/article) https://example.com/wiki/test_(demo)'; h.input.oninput();
 const urls = h.body.all().filter(el => el.tagName === 'A').map(el => el.getAttribute('href'));
 assert.deepEqual(urls, ['https://example.com/article', 'https://example.com/wiki/test_(demo)']);
});

test('仅附件也可保存，图片和音频嵌入、普通文件生成链接', async t => {
 const h = await setup(t);
 await h.add([new File(['image-bytes'], '图片.png', {type: 'image/png'}), new File(['audio-bytes'], '语音.m4a', {type: 'audio/mp4'}), new File(['document-bytes'], '方案.pdf', {type: 'application/pdf'})]);
 assert.equal(h.attachments().length, 0, '点击保存前不落盘'); await h.save.click();
 assert.equal(h.attachments().length, 3);
 const note = h.note(); assert.match(note, /!\[\[.*图片\.png/); assert.match(note, /!\[\[.*语音\.m4a/); assert.match(note, /(?:^|\n)\[\[.*方案\.pdf/);
 const bytes = h.attachments().map(name => fs.readFileSync(path.join(h.root, '收件箱/附件/灵感', name), 'utf8')).sort();
 assert.deepEqual(bytes, ['audio-bytes', 'document-bytes', 'image-bytes']);
});

test('移除待保存附件不会写文件，同名附件各自保留', async t => {
 const h = await setup(t);
 await h.add([new File(['remove'], '删除.png', {type: 'image/png'})]); await h.byLabel('移除 删除.png').click();
 await h.add([new File(['one'], '同名.txt'), new File(['two'], '同名.txt')]); await h.save.click();
 assert.equal(h.attachments().length, 2); assert.doesNotMatch(h.note(), /删除/);
});

test('粘贴图片同时保留剪贴板文字，拖入文件可保存', async t => {
 const h = await setup(t); assert.equal(typeof h.input.onpaste, 'function', '应接收图片粘贴');
 let prevented = false;
 h.input.onpaste({clipboardData: {files: [new File(['paste'], '粘贴.png', {type: 'image/png'})], getData: () => '图片说明'}, preventDefault() {prevented = true;}});
 assert.ok(prevented); assert.equal(typeof h.body.ondrop, 'function', '应接收文件拖入');
 h.body.ondrop({dataTransfer: {files: [new File(['drop'], '拖入.txt')]}, preventDefault() {}, stopPropagation() {}});
 await h.save.click(); assert.equal(h.attachments().length, 2); assert.match(h.note(), /图片说明/);
});

test('笔记写入失败后保留草稿，重试不重复写附件', async t => {
 const h = await setup(t, {failProcess: 1}); h.input.value = '待保存';
 await h.add([new File(['retry'], '重试.png', {type: 'image/png'})]); await h.save.click();
 assert.equal(h.input.value, '待保存'); assert.equal(h.attachments().length, 1);
 await h.save.click(); assert.equal(h.attachments().length, 1); assert.equal((h.note().match(/待保存/g) || []).length, 1); assert.equal(h.input.value, '');
});

test('连续保存只生成一条记录，后台刷新不清空附件草稿', async t => {
 const h = await setup(t); assert.equal(h.definition.liveRefresh, false);
 h.input.value = '只保存一次'; await Promise.all([h.save.onclick(), h.save.onclick()]);
 assert.equal((h.note().match(/只保存一次/g) || []).length, 1);
});

test('录音停止后可试听并保存，麦克风随之关闭', async t => {
 const h = await setup(t); await h.byLabel('开始录音').click(); assert.equal(h.save.disabled, true);
 await h.byLabel('停止录音').click(); await flush();
 assert.ok(h.streams.every(s => s.getTracks().every(track => track.stopped)));
 assert.ok(h.body.all().some(el => el.tagName === 'AUDIO'), '应能试听录音');
 await h.save.click(); assert.equal(h.attachments().length, 1); assert.match(h.note(), /!\[\[.*录音.*\.webm/);
});

test('拒绝录音授权后可继续输入和保存', async t => {
 const h = await setup(t, {getUserMedia: async () => {throw Object.assign(new Error('denied'), {name: 'NotAllowedError'});}});
 await h.byLabel('开始录音').click(); assert.equal(h.save.disabled, false);
 h.input.value = '普通灵感仍能保存'; await h.save.click(); assert.match(h.note(), /普通灵感仍能保存/);
});

test('卸载时释放录音和预览资源，授权晚到也立即停止', async t => {
 const h = await setup(t); await h.add([new File(['preview'], '预览.png', {type: 'image/png'})]);
 await h.byLabel('开始录音').click(); h.dispose(); await flush();
 assert.ok(h.streams.every(s => s.getTracks().every(track => track.stopped))); assert.ok(h.revoked.length > 0);
 let grant; const track = {stopped: false, stop() {this.stopped = true;}};
 const late = await setup(t, {getUserMedia: () => new Promise(resolve => {grant = resolve;})});
 const pending = late.byLabel('开始录音').click(); late.dispose(); grant({getTracks: () => [track]}); await pending;
 assert.equal(track.stopped, true); assert.equal(late.recorders.length, 0);
});

test('移除正在试听的音频会停止播放并释放音频源', async t => {
 const h = await setup(t); await h.add([new File(['music'], '试听.mp3', {type: 'audio/mpeg'})]);
 const audio = h.body.all().find(el => el.tagName === 'AUDIO'); audio.paused = false;
 await h.byLabel('移除 试听.mp3').click();
 assert.equal(audio.paused, true); assert.equal(audio.getAttribute('src'), null);
});

test('录音停止异常也释放麦克风，之后可继续保存文字', async t => {
 const h = await setup(t); await h.byLabel('开始录音').click();
 h.recorders[0].stop = () => {throw new Error('模拟录音设备异常');};
 await assert.doesNotReject(() => h.byLabel('停止录音').click());
 assert.ok(h.streams.every(s => s.getTracks().every(track => track.stopped)));
 h.input.value = '异常后保留灵感'; await h.save.click(); assert.match(h.note(), /异常后保留灵感/);
});

test('文字不依赖退出事件自动落盘，异常重建后恢复', async t => {
 const h = await setup(t); h.input.value = '还没来得及点保存'; await h.input.oninput(); await flush(); h.crash();
 const reopened = await setup(t, {root: h.root}); assert.equal(reopened.input.value, '还没来得及点保存');
 await reopened.save.click(); assert.match(reopened.note(), /还没来得及点保存/);
});

test('未手动保存的附件异常重建后可恢复并保存原字节', async t => {
 const h = await setup(t); await h.add([new File(['durable-image'], '自动草稿.png', {type: 'image/png'})]); await flush(); h.crash();
 const reopened = await setup(t, {root: h.root});
 assert.ok(reopened.body.all().some(el => el.textContent === '自动草稿.png')); await reopened.save.click();
 assert.equal(reopened.attachments().length, 1);
 assert.equal(fs.readFileSync(path.join(h.root, '收件箱/附件/灵感', reopened.attachments()[0]), 'utf8'), 'durable-image');
});

test('未触发停止的录音完整片段可从磁盘恢复，残缺末块被忽略', async t => {
 const h = await setup(t); await h.byLabel('开始录音').click();
 await h.recorders[0].emit('first-part'); await h.recorders[0].emit('second-part'); await flush();
 assert.ok(fs.existsSync(path.join(h.draftRoot, 'drafts')), '录音草稿目录应已创建');
 const allFiles = fs.readdirSync(path.join(h.draftRoot, 'drafts'), {recursive: true}).map(p => String(p));
 const chunk = allFiles.find(p => /chunk-000002-/.test(p)); assert.ok(chunk, '第二个录音片段应已单独落盘');
 fs.writeFileSync(path.join(h.draftRoot, 'drafts', chunk), 'broken'); h.crash();
 const reopened = await setup(t, {root: h.root}); await reopened.save.click();
 assert.equal(reopened.attachments().length, 1);
 assert.equal(fs.readFileSync(path.join(h.root, '收件箱/附件/灵感', reopened.attachments()[0]), 'utf8'), 'first-part');
});

test('最新草稿快照损坏时恢复上一份有效文字', async t => {
 const h = await setup(t); h.input.value = '上一份'; await h.input.oninput(); await flush();
 h.input.value = '最新一份'; await h.input.oninput(); await flush();
 const base = path.join(h.draftRoot, 'drafts');
 assert.ok(fs.existsSync(base), '文字草稿应在输入时落盘');
 const snapshots = fs.readdirSync(base, {recursive: true}).map(p => path.join(base, String(p))).filter(p => /snapshot-[ab]\.json$/.test(p)).map(p => ({p, data: JSON.parse(fs.readFileSync(p, 'utf8'))})).sort((a, b) => b.data.revision - a.data.revision);
 assert.equal(snapshots.length, 2); fs.writeFileSync(snapshots[0].p, '{"broken"'); h.crash();
 const reopened = await setup(t, {root: h.root}); assert.equal(reopened.input.value, '上一份');
});

test('正式笔记写入后清理草稿失败，再打开不会重复恢复', async t => {
 const h = await setup(t, {failCleanup: true}); h.input.value = '只入库一次'; await h.input.oninput(); await flush();
 assert.ok(fs.existsSync(path.join(h.draftRoot, 'drafts')), '提交前应已有自动草稿');
 await h.save.click(); h.crash();
 const reopened = await setup(t, {root: h.root}); assert.equal(reopened.input.value, '');
 assert.equal((reopened.note().match(/只入库一次/g) || []).length, 1);
});

test('正常关闭会保存录音最终块，另一个活跃卡片不接管草稿', async t => {
 const h = await setup(t); h.input.value = '活跃草稿'; await h.input.oninput(); await flush();
 const other = await setup(t, {root: h.root, app: h.app}); assert.equal(other.input.value, ''); await other.dispose();
 await h.byLabel('开始录音').click(); await h.recorders[0].emit('live-part'); await h.dispose(); await flush();
 const reopened = await setup(t, {root: h.root}); assert.equal(reopened.input.value, '活跃草稿'); await reopened.save.click();
 assert.equal(fs.readFileSync(path.join(h.root, '收件箱/附件/灵感', reopened.attachments()[0]), 'utf8'), 'live-partvoice-bytes');
});

test('录音启动失败后仍可正常关闭，不留下未完成的等待', async t => {
 const h = await setup(t, {failStart: true}); await h.byLabel('开始录音').click();
 const closed = await Promise.race([h.dispose().then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 80))]);
 assert.equal(closed, true); assert.ok(h.streams.every(s => s.getTracks().every(track => track.stopped)));
});

test('附件备份失败后文字备份会重试附件，持续失败不会误报成功', async t => {
 let failures = 1;
 const h = await setup(t, {failDraftBinary: () => failures-- > 0});
 await h.add([new File(['retry-draft'], '需重试.png', {type: 'image/png'})]);
 h.input.value = '继续输入'; await h.input.oninput(); await flush(); h.crash();
 const reopened = await setup(t, {root: h.root}); assert.ok(reopened.body.all().some(el => el.textContent === '需重试.png'));
 const broken = await setup(t, {failDraftBinary: () => true}); await broken.add([new File(['fail'], '失败.png', {type: 'image/png'})]);
 broken.input.value = '不能误报'; await broken.input.oninput();
 const indicator = broken.body.all().find(el => el.className.includes('ws-capture-draft-state'));
 assert.match(indicator.textContent, /失败/);
});

test('录音元数据最新快照损坏时仍能恢复之前写下的音频块', async t => {
 const h = await setup(t); h.input.value = '录音前的文字'; await h.input.oninput();
 await h.byLabel('开始录音').click(); await h.recorders[0].emit('preserved-audio'); await flush();
 const base = path.join(h.draftRoot, 'drafts');
 const snapshots = fs.readdirSync(base, {recursive: true}).map(p => path.join(base, String(p))).filter(p => /snapshot-[ab]\.json$/.test(p)).map(p => ({p, data: JSON.parse(fs.readFileSync(p, 'utf8'))})).sort((a,b) => b.data.revision - a.data.revision);
 fs.writeFileSync(snapshots[0].p, '{'); h.crash();
 const reopened = await setup(t, {root: h.root}); await reopened.save.click(); assert.equal(reopened.attachments().length, 1);
 assert.equal(fs.readFileSync(path.join(h.root, '收件箱/附件/灵感', reopened.attachments()[0]), 'utf8'), 'preserved-audio');
});

test('手动停止后立即关闭仍等待原生最终数据块', async t => {
 const h = await setup(t, {stopDelay: 30}); await h.byLabel('开始录音').click(); await h.recorders[0].emit('prefix-');
 await h.byLabel('停止录音').click(); await h.dispose(); await new Promise(resolve => setTimeout(resolve, 45));
 const reopened = await setup(t, {root: h.root}); await reopened.save.click();
 assert.equal(fs.readFileSync(path.join(h.root, '收件箱/附件/灵感', reopened.attachments()[0]), 'utf8'), 'prefix-voice-bytes');
});

test('录音错误事件先于最后数据到达时仍保存最终片段', async t => {
 const h = await setup(t, {stopDelay: 30}); await h.byLabel('开始录音').click(); await h.recorders[0].emit('prefix-');
 h.recorders[0].fail(); await h.dispose(); await new Promise(resolve => setTimeout(resolve, 45));
 const reopened = await setup(t, {root: h.root}); await reopened.save.click();
 assert.equal(fs.readFileSync(path.join(h.root, '收件箱/附件/灵感', reopened.attachments()[0]), 'utf8'), 'prefix-voice-bytes');
});

test('恢复过程中关闭卡片不会用空界面覆盖已有草稿', async t => {
 const h = await setup(t); h.input.value = '不能被空界面覆盖'; await h.input.oninput(); h.crash();
 await setup(t, {root: h.root, closeDuringRead: true});
 const reopened = await setup(t, {root: h.root}); assert.equal(reopened.input.value, '不能被空界面覆盖');
});

test('录音块持续备份失败时，继续输入文字也不能显示已全部备份', async t => {
 const h = await setup(t, {failDraftBinary: p => /chunk-/.test(p)}); await h.byLabel('开始录音').click();
 await h.recorders[0].emit('unwritten'); await flush();
 h.input.value = '仍需保留录音'; await h.input.oninput(); await flush();
 const indicator = h.body.all().find(el => el.className.includes('ws-capture-draft-state')); assert.match(indicator.textContent, /失败/);
});

test('生成的 WebM 音频中断后，恢复出的前缀仍可实际解码', async t => {
 if (spawnSync('ffmpeg', ['-version']).status !== 0) {t.skip('当前环境没有 ffmpeg'); return;}
 const h = await setup(t), sample = path.join(h.root, 'sample.webm');
 const encoded = spawnSync('ffmpeg', ['-v','error','-f','lavfi','-i','sine=frequency=440:duration=5','-c:a','libopus','-f','webm',sample]);
 assert.equal(encoded.status, 0, encoded.stderr.toString());
 const full = fs.readFileSync(sample), prefix = full.subarray(0, Math.floor(full.length * 0.7));
 await h.byLabel('开始录音').click();
 for (let offset = 0; offset < prefix.length; offset += 2048) await h.recorders[0].emit(prefix.subarray(offset, offset + 2048));
 h.crash(); const reopened = await setup(t, {root: h.root}); await reopened.save.click();
 const file = path.join(h.root, '收件箱/附件/灵感', reopened.attachments()[0]); assert.deepEqual(fs.readFileSync(file), prefix);
 const decoded = spawnSync('ffmpeg', ['-v','error','-i',file,'-progress','pipe:1','-f','null','-']);
 assert.equal(decoded.status, 0, decoded.stderr.toString());
 const times = [...decoded.stdout.toString().matchAll(/out_time_us=(\d+)/g)].map(m => Number(m[1]));
 assert.ok(Math.max(...times) > 100000, '恢复的音频应包含可解码声音');
});

test('默认展示最近内容，点击创建才出现原有编辑操作', async t => {
 const h = await setup(t, {recent: true, initialNote: '# 灵感收件箱\n\n## 2026/11/4 10:00:00\n\n最近的灵感\n'});
 assert.ok(h.visible().some(el => el.textContent === '最近的灵感'));
 assert.equal(h.visible().includes(h.input), false); assert.equal(h.visible().includes(h.save), false);
 await h.byLabel('创建灵感').click();
 assert.ok(h.visible().includes(h.input)); assert.ok(h.visible().includes(h.save));
 assert.ok(h.visible().includes(h.byLabel('开始录音')));
});

test('最近列表倒序最多五条，不显示提交标识，点击定位记录行', async t => {
 const entries = Array.from({length: 7}, (_, i) => `## 2026/11/4 10:0${i}:00\n\n<!-- workspace-capture:test-${i} -->\n\n灵感第${i + 1}条\n`);
 const note = '# 灵感收件箱\n\n' + entries.join('\n');
 const h = await setup(t, {recent: true, initialNote: note});
 const rows = h.visible().filter(el => el.tagName === 'BUTTON' && el.getAttribute('aria-label')?.startsWith('打开灵感：'));
 assert.equal(rows.length, 5); assert.match(rows[0].textContent, /灵感第7条/); assert.match(rows[4].textContent, /灵感第3条/);
 assert.ok(rows.every(el => !el.textContent.includes('workspace-capture'))); await rows[0].click();
 assert.equal(h.opened.path, '收件箱/灵感.md'); assert.equal(h.opened.options.line, note.split('\n').findIndex(line => line === '## 2026/11/4 10:06:00'));
});

test('正文内普通标题和代码块里的日期标题不拆成新灵感，附件能显示类型', async t => {
 const note = '# 灵感收件箱\n\n## 2026/11/4 10:00:00\n\n这是正文\n## 分析\n更多正文\n```md\n## 2026/11/4 23:59:59\n示例\n```\n![[附件/图片.png]]\n![[附件/录音.webm]]\n[[附件/说明.pdf]]\n';
 const h = await setup(t, {recent: true, initialNote: note});
 const rows = h.visible().filter(el => el.tagName === 'BUTTON' && el.getAttribute('aria-label')?.startsWith('打开灵感：'));
 assert.equal(rows.length, 1); assert.match(rows[0].textContent, /这是正文/); assert.match(rows[0].textContent, /图片/); assert.match(rows[0].textContent, /音频/); assert.match(rows[0].textContent, /附件/);
});

test('返回列表保留草稿，创建继续编辑，保存后自动返回并更新列表', async t => {
 const h = await setup(t, {recent: true, initialNote: '# 灵感收件箱\n\n## 2026/11/4 09:00:00\n\n已有内容\n'}); await h.byLabel('创建灵感').click(); h.input.value = '切换保留的灵感'; await h.input.oninput();
 await h.byLabel('返回最近内容').click(); assert.equal(h.visible().includes(h.input), false);
 await h.byLabel('创建灵感').click(); assert.equal(h.input.value, '切换保留的灵感'); await h.save.click();
 assert.equal(h.visible().includes(h.input), false); assert.ok(h.visible().some(el => el.textContent === '切换保留的灵感'));
});

test('列表状态有恢复草稿时仍保持默认列表，继续创建不丢已恢复内容', async t => {
 const h = await setup(t, {initialNote: '# 灵感收件箱\n\n## 2026/11/4 09:00:00\n\n已有内容\n'}); h.input.value = '上次的草稿'; await h.input.oninput(); h.crash();
 const reopened = await setup(t, {root: h.root, recent: true}); assert.equal(reopened.visible().includes(reopened.input), false);
 assert.ok(reopened.visible().some(el => el.textContent.includes('草稿'))); await reopened.byLabel('创建灵感').click(); assert.equal(reopened.input.value, '上次的草稿');
});

test('列表响应来源笔记更新，卸载时清理事件监听', async t => {
 const h = await setup(t, {recent: true, initialNote: '# 灵感收件箱\n\n## 2026/11/4 09:00:00\n\n已有内容\n'});
 await h.modifyNote('# 灵感收件箱\n\n## 2026/11/4 12:00:00\n\n外部追加的灵感\n');
 assert.ok(h.visible().some(el => el.textContent === '外部追加的灵感')); assert.ok(h.listenerCount() > 0);
 await h.dispose(); assert.equal(h.listenerCount(), 0);
});

test('录音中返回先等待最终块备份，重新创建仍可保存整段录音', async t => {
 const h = await setup(t, {stopDelay: 30, initialNote: '# 灵感收件箱\n\n## 2026/11/4 09:00:00\n\n已有内容\n'}); await h.byLabel('开始录音').click(); await h.recorders[0].emit('recording-');
 await h.byLabel('返回最近内容').click(); assert.equal(h.visible().includes(h.input), false);
 assert.ok(h.streams.every(s => s.getTracks().every(track => track.stopped)));
 await h.byLabel('创建灵感').click(); await h.save.click();
 assert.equal(fs.readFileSync(path.join(h.root, '收件箱/附件/灵感', h.attachments()[0]), 'utf8'), 'recording-voice-bytes');
});

test('一条灵感的未闭合代码块不会吞掉之后正式保存的新记录', async t => {
 const h = await setup(t); h.input.value = '第一条的代码\n```js\nconst value = 1;'; await h.save.click();
 await h.byLabel('创建灵感').click(); h.input.value = '下一条正常灵感'; await h.save.click();
 const rows = h.visible().filter(el => el.tagName === 'BUTTON' && el.getAttribute('aria-label')?.startsWith('打开灵感：'));
 assert.equal(rows.length, 2); assert.match(rows[0].textContent, /下一条正常灵感/); assert.doesNotMatch(rows[1].textContent, /下一条正常灵感/);
});

test('从最近列表直接拖入附件会进入创建界面，不把附件藏进不可见草稿', async t => {
 const h = await setup(t, {recent: true, initialNote: '# 灵感收件箱\n\n## 2026/11/4 09:00:00\n\n已有内容\n'});
 h.body.ondrop({dataTransfer: {files: [new File(['dropped'], '拖入创建.txt')]}, preventDefault() {}, stopPropagation() {}}); await flush();
 assert.ok(h.visible().includes(h.input)); assert.ok(h.visible().some(el => el.textContent === '拖入创建.txt'));
 await h.save.click(); assert.equal(h.attachments().length, 1);
});

test('创建入口位于设置左侧的原生标题操作区，正文没有重复标题', async t => {
 const h = await setup(t, {recent: true, initialNote: '# 灵感收件箱\n\n## 2026/11/4 09:00:00\n\n已有内容\n'});
 const create = h.byLabel('创建灵感'); assert.ok(create.parent === h.headerActions, '创建入口应使用卡片原生标题操作区');
 const siblings = h.gear.parent.children; assert.ok(siblings.indexOf(h.headerActions) < siblings.indexOf(h.gear));
 assert.equal(h.body.all().some(el => el.text === '最近灵感'), false);
});

test('没有笔记、空笔记和仅标题的笔记都默认打开创建界面', async t => {
 for (const initialNote of [undefined, '', '# 灵感收件箱\n\n']) {
  const h = await setup(t, {recent: true, initialNote}); assert.ok(h.visible().includes(h.input)); assert.ok(h.visible().includes(h.save));
  assert.equal(h.visible().some(el => el.text === '最近灵感'), false);
 }
});

test('列表内容被清空后自动进入创建界面', async t => {
 const h = await setup(t, {recent: true, initialNote: '# 灵感收件箱\n\n## 2026/11/4 09:00:00\n\n已有内容\n'});
 await h.modifyNote('# 灵感收件箱\n\n'); assert.ok(h.visible().includes(h.input)); assert.ok(h.visible().includes(h.save));
});


test('即时灵感提供可配置来源并将所有草稿保留在设备适配器', async t => {
 const h = await setup(t, {config: {notePath: '资料/想法/收集.md', noteFolder: '资料/想法', attachmentFolder: '资料/图片'}, initialNote: '# 自定来源\n'});
 assert.equal(h.definition.name, '即时灵感');
 assert.equal(h.definition.defaultConfig().notePath, 'Simple Space/即时灵感/灵感.md');
 h.input.value = '保存至自定义路径'; await h.input.oninput();
 await h.add([new File(['private-png'], '私密.png', {type: 'image/png'})]);
 assert.equal(fs.existsSync(path.join(h.root, '.obsidian')), false);
 assert.equal(fs.existsSync(path.join(h.root, 'drafts')), false);
 assert.ok(fs.existsSync(path.join(h.draftRoot, 'drafts')));
 assert.ok(h.busyGuards.some(guard => guard()));
 await h.save.click();
 assert.match(h.note(), /保存至自定义路径/);
 assert.equal(fs.readdirSync(path.join(h.root, '资料/想法/附件/收集')).length, 1);
 assert.equal(fs.existsSync(path.join(h.root, '收件箱')), false);
 assert.ok(h.busyGuards.every(guard => !guard()));
});

test('恢复附件通过设备字节生成 Blob 预览，配置来源内的标记防止重复恢复', async t => {
 const options = {config: {notePath: '自定/灵感.md', attachmentFolder: '自定/附件'}, failCleanup: true};
 const h = await setup(t, options); await h.add([new File(['private-preview'], '恢复图片.png', {type: 'image/png'})]); h.crash();
 const reopened = await setup(t, {...options, root: h.root});
 const image = reopened.body.all().find(el => el.tagName === 'IMG');
 assert.match(image.getAttribute('src'), /^blob:/);
 assert.equal(await (await fetch(image.getAttribute('src'))).text(), 'private-preview');
 await reopened.save.click(); reopened.crash();
 const again = await setup(t, {...options, root: h.root}); assert.equal(again.input.value, '');
 assert.equal(again.body.all().some(el => el.textContent === '恢复图片.png'), false);
});

test('缺少设备草稿适配器时禁止悄悄写入 vault 草稿', async t => {
 const h = await setup(t, {noDraftAdapter: true});
 assert.match(h.body.textContent, /草稿备份失败/);
 assert.equal(fs.existsSync(path.join(h.root, '.obsidian')), false);
});


test('真实IndexedDB适配器支持录音、崩溃恢复和正式内容保存', async t => {
 const {IDBFactory} = await import('fake-indexeddb');
 const {DeviceDraftAdapter} = await import('../src/core/device-drafts.js');
 const indexedDB = new IDBFactory();
 const first = new DeviceDraftAdapter('integration', {indexedDB});
 const h = await setup(t, {draftAdapter: first});
 h.input.value = 'IndexedDB内的灵感'; await h.input.oninput();
 await h.byLabel('开始录音').click(); await h.recorders[0].emit('durable-idb-audio'); h.crash();
 const recoveredAdapter = new DeviceDraftAdapter('integration', {indexedDB});
 const restored = await setup(t, {root: h.root, draftAdapter: recoveredAdapter});
 assert.equal(restored.input.value, 'IndexedDB内的灵感');
 const audio = restored.body.all().find(el => el.tagName === 'AUDIO'); assert.ok(audio, restored.body.textContent); assert.match(audio.getAttribute('src'), /^blob:/);
 await restored.save.click(); assert.match(restored.note(), /IndexedDB内的灵感/);
 assert.equal(fs.readFileSync(path.join(h.root, '收件箱/附件/灵感', restored.attachments()[0]), 'utf8'), 'durable-idb-audio');
 assert.equal(fs.existsSync(path.join(h.root, '.obsidian')), false);
 assert.equal(fs.existsSync(path.join(h.draftRoot, 'drafts')), false);
 await restored.dispose(); await first.close(); await recoveredAdapter.close();
});


test('统一保存根为点时笔记在vault根，附件按笔记归入根下附件目录', async t => {
 const h = await setup(t, {config: {notePath: '根灵感.md', noteFolder: '.', attachmentFolder: '不再使用/旧配置'}});
 const folders = [], files = [], vault = h.app.vault;
 const createFolder = vault.createFolder.bind(vault), createBinary = vault.createBinary.bind(vault);
 vault.createFolder = async path => {folders.push(path); assert.notEqual(path, '.'); return createFolder(path);};
 vault.createBinary = async (path, bytes) => {files.push(path); return createBinary(path, bytes);};
 await h.add([new File(['root-attachment'], '根附件.png', {type: 'image/png'})]); await h.save.click();
 assert.equal(files.length, 1); assert.doesNotMatch(files[0], /^\.\//);
 assert.match(files[0], /^附件\/根灵感\//); assert.deepEqual(folders, ['附件', '附件/根灵感']);
 assert.equal(fs.existsSync(path.join(h.root, '不再使用')), false);
 assert.equal(fs.readFileSync(path.join(h.root, files[0]), 'utf8'), 'root-attachment');
 assert.match(h.note(), /!\[\[/); assert.doesNotMatch(h.note(), /\[\[\.\//);
});


test('非Markdown来源在读取文件或初始化草稿之前拒绝，原JSON及图片保持不变', async t => {
 for (const notePath of ['workspace.json', '图片/照片.png']) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-reject-nonmd-')); roots.add(root);
  const original = notePath.endsWith('.json') ? '{"layout":"original"}' : 'original-image-bytes';
  let vaultTouches = 0, draftTouches = 0;
  await assert.rejects(setup(t, {root, config: {notePath}, initialNote: original, beforeRender({vault, draftAdapter}) {
   for (const name of ['getAbstractFileByPath', 'read', 'process', 'create', 'createBinary']) {
    const method = vault[name].bind(vault); vault[name] = (...args) => {vaultTouches++; return method(...args);};
   }
   for (const [name, method] of Object.entries(draftAdapter)) draftAdapter[name] = (...args) => {draftTouches++; return method(...args);};
  }}), /灵感来源.*\.md.*Markdown/);
  assert.equal(vaultTouches, 0); assert.equal(draftTouches, 0);
  assert.equal(fs.readFileSync(path.join(root, notePath), 'utf8'), original);
  assert.equal(fs.existsSync(path.join(root + '-device', 'drafts')), false);
 }
});

test('根目录与嵌套Markdown来源允许大小写扩展名', async t => {
 for (const notePath of ['灵感.md', '资料/灵感.MD']) {
  const h = await setup(t, {config: {notePath}}); h.input.value = '有效来源'; await h.save.click();
  assert.match(h.note(), /有效来源/);
 }
});

function testRoot() {const root = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-volumes-')); roots.add(root); return root;}
function writeNote(root, filePath, text) {fs.mkdirSync(path.dirname(path.join(root, filePath)), {recursive: true}); fs.writeFileSync(path.join(root, filePath), text);}
const captureRows = h => h.visible().filter(el => el.tagName === 'BUTTON' && el.getAttribute('aria-label')?.startsWith('打开灵感：'));

test('默认单文件保存且只在点击保存后创建统一根与附件目录', async t => {
 const h = await setup(t, {defaults: true, now: '2026-11-04T10:00:00+08:00'});
 assert.equal(h.definition.defaultConfig().saveMode, 'single');
 assert.equal(h.definition.defaultConfig().noteFolder, 'Simple Space/即时灵感');
 assert.equal(fs.readdirSync(h.root).length, 0);
 h.input.value = '默认单文件记录'; await h.add([new File(['monthly-image'], '月份.png', {type: 'image/png'})]);
 assert.equal(fs.readdirSync(h.root).length, 0); await h.save.click();
 assert.match(fs.readFileSync(path.join(h.root, 'Simple Space/即时灵感/灵感.md'), 'utf8'), /默认单文件记录/);
 assert.equal(fs.readdirSync(path.join(h.root, 'Simple Space/即时灵感/附件/灵感')).length, 1);
 assert.equal(fs.existsSync(path.join(h.root, '收件箱/灵感.md')), false);
});

test('五种保存方式按本地日期分桶，季度边界和跨年正确，单文件使用根下旧文件名', async t => {
 const cases = [
  ['year', '2027-01-01T12:00:00+08:00', '2027.md'],
  ['quarter', '2026-03-31T12:00:00+08:00', '2026-Q1.md'],
  ['quarter', '2026-04-01T12:00:00+08:00', '2026-Q2.md'],
  ['quarter', '2026-12-31T12:00:00+08:00', '2026-Q4.md'],
  ['quarter', '2027-01-01T12:00:00+08:00', '2027-Q1.md'],
  ['month', '2026-12-31T12:00:00+08:00', '2026-12.md'],
  ['day', '2027-01-01T12:00:00+08:00', '2027-01-01.md'],
  ['single', '2027-01-01T12:00:00+08:00', '旧手记.MD']
 ];
 for (const [saveMode, now, filename] of cases) {
  const h = await setup(t, {now, config: {saveMode, noteFolder: '新根', notePath: '旧根/旧手记.MD'}});
  h.input.value = `${saveMode}对应内容`; await h.save.click();
  assert.match(fs.readFileSync(path.join(h.root, '新根', filename), 'utf8'), /对应内容/);
  assert.equal(fs.existsSync(path.join(h.root, '旧根')), false);
 }
});

test('最近五条跨时间分卷及历史来源排序，点击定位真实文件与行，来源更新使缓存失效', async t => {
 const root = testRoot(), legacy = '# 历史\n\n## 2026/11/4 11:00:00\n\n历史内容\n';
 writeNote(root, '旧根/灵感.md', legacy);
 writeNote(root, '新根/2026-10.md', '# 灵感\n\n## 2026/10/31 23:00:00\n\n十月旧内容\n');
 const current = '# 灵感\n\n' + Array.from({length: 6}, (_, i) => `## 2026/11/4 10:0${i}:00\n\n当月${i}\n`).join('\n');
 writeNote(root, '新根/2026-11-002.md', current);
 const h = await setup(t, {root, recent: true, config: {saveMode: 'month', noteFolder: '新根', notePath: '旧根/灵感.md'}});
 const rows = captureRows(h); assert.equal(rows.length, 5); assert.match(rows[0].textContent, /历史内容/); assert.match(rows[1].textContent, /当月5/);
 await rows[1].click(); assert.equal(h.opened.path, '新根/2026-11-002.md'); assert.equal(h.opened.options.line, current.split('\n').indexOf('## 2026/11/4 10:05:00'));
 await h.modifyPath('新根/2026-11-002.md', '# 灵感\n\n## 2026/11/4 12:00:00\n\n外部更新分卷\n');
 assert.match(captureRows(h)[0].textContent, /外部更新分卷/);
 assert.equal(fs.readFileSync(path.join(root, '旧根/灵感.md'), 'utf8'), legacy);
});

test('按UTF8 Markdown大小自动续卷，附件各归对应笔记且超大单条不拆散', async t => {
 const h = await setup(t, {now: '2026-11-04T10:00:00+08:00', config: {saveMode: 'month', noteFolder: '归档', splitBySize: true, maxFileSizeKB: 1}});
 const linkSources = [], generate = h.app.fileManager.generateMarkdownLink;
 h.app.fileManager.generateMarkdownLink = (file, source, ...args) => {linkSources.push(source); return generate(file, source, ...args);};
 for (const label of ['第一条', '第二条']) {
  h.input.value = label + '中'.repeat(180); await h.add([new File(['attachment'.repeat(1000)], label + '.png', {type: 'image/png'})]); await h.save.click();
  if(label === '第一条') await h.byLabel('创建灵感').click();
 }
 const first = fs.readFileSync(path.join(h.root, '归档/2026-11.md'), 'utf8'), second = fs.readFileSync(path.join(h.root, '归档/2026-11-002.md'), 'utf8');
 assert.match(first, /第一条/); assert.doesNotMatch(first, /第二条/); assert.match(second, /第二条/);
 assert.ok(Buffer.byteLength(first) <= 1024); assert.ok(Buffer.byteLength(second) <= 1024);
 assert.equal(fs.readdirSync(path.join(h.root, '归档/附件/2026-11')).length, 1); assert.equal(fs.readdirSync(path.join(h.root, '归档/附件/2026-11-002')).length, 1);
 assert.ok(linkSources.includes('归档/2026-11-002.md'));
 await h.byLabel('创建灵感').click(); h.input.value = '完整超长' + '大'.repeat(800); await h.save.click();
 const third = fs.readFileSync(path.join(h.root, '归档/2026-11-003.md'), 'utf8'); assert.match(third, new RegExp('大'.repeat(800))); assert.ok(Buffer.byteLength(third) > 1024);
 assert.equal(h.input.value, '');
});

test('跨月首attempt失败后锁定原月份和时间，崩溃恢复重试仍写同一分卷', async t => {
 const config = {saveMode: 'month', noteFolder: '分月', splitBySize: true, maxFileSizeKB: 1};
 const h = await setup(t, {now: '2026-10-31T23:59:00+08:00', config, failProcess: 1});
 h.input.value = '十月首尝试'; await h.input.oninput(); await h.save.click(); assert.equal(h.input.value, '十月首尝试'); h.crash();
 const restored = await setup(t, {root: h.root, now: '2026-11-01T00:01:00+08:00', config});
 assert.equal(restored.input.value, '十月首尝试'); await restored.save.click();
 const saved = fs.readFileSync(path.join(h.root, '分月/2026-10.md'), 'utf8'); assert.match(saved, /十月首尝试/); assert.match(saved, /2026\/10\/31/);
 assert.equal(fs.existsSync(path.join(h.root, '分月/2026-11.md')), false);
});

test('process实际追加后抛错，原卡重试及改根重启都不重复入库', async t => {
 const config = {saveMode: 'month', noteFolder: '已写入', splitBySize: true, maxFileSizeKB: 1};
 const h = await setup(t, {now: '2026-11-04T10:00:00+08:00', config, failCleanup: true});
 let first = true; const original = h.app.vault.process.bind(h.app.vault);
 h.app.vault.process = async (...args) => {await original(...args); if(first) {first = false; throw new Error('写入完成后模拟中断');}};
 h.input.value = '提交成功但回调失败'; await h.input.oninput(); await h.save.click(); assert.equal(h.input.value, '提交成功但回调失败');
 h.setNow('2026-12-01T00:00:00+08:00'); await h.save.click(); assert.equal(h.input.value, ''); h.crash();
 const restored = await setup(t, {root: h.root, config: {...config, noteFolder: '另一个根'}}); assert.equal(restored.input.value, '');
 const text = fs.readFileSync(path.join(h.root, '已写入/2026-11.md'), 'utf8'); assert.equal((text.match(/提交成功但回调失败/g) || []).length, 1);
 assert.equal(fs.existsSync(path.join(h.root, '已写入/2026-12.md')), false);
});

test('实际追加后报错，继续编辑并加附件重试会保存新版本', async t => {
 const h = await setup(t);
 let first = true; const original = h.app.vault.process.bind(h.app.vault);
 h.app.vault.process = async (...args) => {await original(...args); if(first) {first = false; throw new Error('实际追加后报错');}};
 h.input.value = '已写入的初稿'; await h.input.oninput(); await h.save.click();
 assert.equal(h.input.value, '已写入的初稿');
 h.input.value += '，继续补充'; await h.input.oninput();
 await h.add([new File(['after-error-bytes'], '报错后附件.txt')]); await h.save.click();
 assert.match(h.note(), /已写入的初稿，继续补充/);
 assert.equal((h.note().match(/继续补充/g) || []).length, 1);
 assert.equal(h.attachments().length, 1);
 assert.equal(fs.readFileSync(path.join(h.root, '收件箱/附件/灵感', h.attachments()[0]), 'utf8'), 'after-error-bytes');
 assert.equal(h.input.value, '');
});

test('实际追加后报错并继续编辑，异常重启恢复新增文字和附件', async t => {
 const h = await setup(t);
 const original = h.app.vault.process.bind(h.app.vault);
 h.app.vault.process = async (...args) => {await original(...args); throw new Error('实际追加后报错');};
 h.input.value = '原始已提交文字'; await h.input.oninput(); await h.save.click();
 h.input.value += '，重启前新增'; await h.input.oninput();
 await h.add([new File(['restart-edit-bytes'], '重启前附件.txt')]); h.crash();
 const restored = await setup(t, {root: h.root});
 assert.equal(restored.input.value, '原始已提交文字，重启前新增');
 assert.ok(restored.body.all().some(el => el.textContent === '重启前附件.txt'));
 await restored.save.click();
 assert.equal((restored.note().match(/重启前新增/g) || []).length, 1);
 assert.equal(restored.attachments().length, 1);
});

test('实际追加后只变更附件也生成新版本，跨月保存保留旧附件链接', async t => {
 const config = {saveMode: 'month', noteFolder: '版本附件'};
 const h = await setup(t, {now: '2026-10-31T23:59:00+08:00', config});
 let first = true; const original = h.app.vault.process.bind(h.app.vault);
 h.app.vault.process = async (...args) => {await original(...args); if(first) {first = false; throw new Error('实际追加后报错');}};
 h.input.value = '附件版本'; await h.add([new File(['original-bytes'], '原附件.txt')]); await h.save.click();
 const oldPath = '版本附件/2026-10.md', oldNote = fs.readFileSync(path.join(h.root, oldPath), 'utf8');
 const oldAttachment = oldNote.match(/\[\[([^|\]]+)\|/)[1];
 h.setNow('2026-11-01T00:01:00+08:00'); await h.add([new File(['new-bytes'], '新附件.txt')]); await h.save.click();
 assert.equal(fs.readFileSync(path.join(h.root, oldAttachment), 'utf8'), 'original-bytes');
 assert.equal(fs.readFileSync(path.join(h.root, oldPath), 'utf8'), oldNote);
 const next = fs.readFileSync(path.join(h.root, '版本附件/2026-11.md'), 'utf8');
 assert.match(next, /原附件\.txt/); assert.match(next, /新附件\.txt/);
 assert.equal(fs.readdirSync(path.join(h.root, '版本附件/附件/2026-11')).length, 2);
});

test('旧格式未提交草稿恢复后升级，保存再重启不会重复恢复', async t => {
 const h = await setup(t); h.input.value = '旧格式草稿'; await h.input.oninput(); h.crash();
 const base = path.join(h.draftRoot, 'drafts');
 for(const file of fs.readdirSync(base, {recursive: true}).map(String).filter(file => /snapshot-[ab]\.json$/.test(file))) {
  const filePath = path.join(base, file), state = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  state.version = 1; delete state.submission; fs.writeFileSync(filePath, JSON.stringify(state));
 }
 const restored = await setup(t, {root: h.root, failCleanup: true});
 assert.equal(restored.input.value, '旧格式草稿'); await restored.save.click(); restored.crash();
 const again = await setup(t, {root: h.root}); assert.equal(again.input.value, '');
 assert.equal((again.note().match(/旧格式草稿/g) || []).length, 1);
});

function downgradeToCommittedLegacyDraft(h) {
 const base = path.join(h.draftRoot, 'drafts'); let legacyId;
 for(const file of fs.readdirSync(base, {recursive: true}).map(String).filter(file => /snapshot-[ab]\.json$/.test(file))) {
  const filePath = path.join(base, file), state = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  legacyId = state.id; state.version = 1; delete state.submission;
  state.targetPath = h.config.notePath; state.saveTime = Date.now();
  state.attachments.forEach(entry => {delete entry.preservePath;});
  fs.writeFileSync(filePath, JSON.stringify(state));
 }
 const marker = `<!-- workspace-capture:${legacyId} -->`;
 fs.writeFileSync(path.join(h.root, h.config.notePath), h.note().replace(/<!-- workspace-capture:[\w-]+ -->/, marker));
 return marker;
}

test('旧格式已有提交标记但追加了文字时，恢复待保存草稿并使用全新标记', async t => {
 const h = await setup(t), original = h.app.vault.process.bind(h.app.vault);
 h.app.vault.process = async (...args) => {await original(...args); throw new Error('实际追加后报错');};
 h.input.value = '旧版已提交'; await h.input.oninput(); await h.save.click();
 h.input.value += '，旧版随后编辑'; await h.input.oninput();
 const legacyMarker = downgradeToCommittedLegacyDraft(h), originalNote = h.note(); h.crash();
 const restored = await setup(t, {root: h.root});
 assert.equal(restored.input.value, '旧版已提交，旧版随后编辑');
 assert.equal(restored.note(), originalNote, '恢复不能自动改动正式笔记');
 await restored.save.click();
 assert.match(restored.note(), /旧版随后编辑/);
 assert.equal(restored.note().split(legacyMarker).length - 1, 1, '升级保存不得复用旧提交标记');
 assert.equal((restored.note().match(/<!-- workspace-capture:/g) || []).length, 2);
});

test('旧格式已有提交标记但附件发生变化时，恢复所有附件并保留历史路径', async t => {
 const h = await setup(t), original = h.app.vault.process.bind(h.app.vault);
 h.app.vault.process = async (...args) => {await original(...args); throw new Error('实际追加后报错');};
 h.input.value = '旧版附件'; await h.add([new File(['legacy-original'], '旧版原附件.txt')]); await h.save.click();
 await h.add([new File(['legacy-new'], '旧版新增附件.txt')]);
 const legacyMarker = downgradeToCommittedLegacyDraft(h), originalNote = h.note(); h.crash();
 const restored = await setup(t, {root: h.root});
 assert.equal(restored.input.value, '旧版附件');
 assert.ok(restored.body.all().some(el => el.textContent === '旧版新增附件.txt'));
 assert.equal(restored.note(), originalNote);
 await restored.save.click();
 assert.match(restored.note(), /旧版新增附件\.txt/);
 assert.equal(restored.attachments().length, 2);
 assert.equal(restored.note().split(legacyMarker).length - 1, 1);
 assert.equal((restored.note().match(/<!-- workspace-capture:/g) || []).length, 2);
});

test('合并多个来源草稿后提交，即使清理失败也不恢复旧来源或重复正文', async t => {
 const first = await setup(t); first.input.value = '来源甲'; await first.input.oninput();
 const second = await setup(t, {root: first.root, app: first.app}); second.input.value = '来源乙'; await second.input.oninput();
 first.crash(); second.crash();
 const merged = await setup(t, {root: first.root, failCleanup: true});
 assert.match(merged.input.value, /来源甲/); assert.match(merged.input.value, /来源乙/);
 await merged.save.click(); merged.crash();
 const again = await setup(t, {root: first.root});
 assert.equal(again.input.value, '');
 assert.equal((again.note().match(/来源甲/g) || []).length, 1);
 assert.equal((again.note().match(/来源乙/g) || []).length, 1);
});

test('合并提交后仅来源目录清理失败时，保留主快照防止已保存来源复活', async t => {
 const first = await setup(t); first.input.value = '部分清理来源甲'; await first.input.oninput();
 const second = await setup(t, {root: first.root, app: first.app}); second.input.value = '部分清理来源乙'; await second.input.oninput();
 first.crash(); second.crash();
 const merged = await setup(t, {root: first.root});
 const base = path.join(merged.draftRoot, 'drafts');
 const state = fs.readdirSync(base, {recursive: true}).map(String).filter(file => /snapshot-[ab]\.json$/.test(file))
  .map(file => JSON.parse(fs.readFileSync(path.join(base, file), 'utf8')))
  .filter(state => state.text.includes('来源甲') && state.text.includes('来源乙')).sort((a, b) => b.revision - a.revision)[0];
 assert.ok(state);
 const source = state.sources.find(id => id !== state.id), remove = merged.draftAdapter.rmdir;
 assert.ok(source);
 merged.draftAdapter.rmdir = async (folder, ...args) => {
  if(folder === `drafts/${source}`)throw new Error('仅一个来源目录删除失败');
  return remove(folder, ...args);
 };
 await merged.save.click(); assert.equal(merged.input.value, ''); merged.crash();
 const again = await setup(t, {root: first.root});
 assert.equal(again.input.value, '', '部分清理失败也不能重新恢复已保存来源');
 assert.ok(fs.existsSync(path.join(base, state.id)), '来源未清理完成时必须保留主快照');
 assert.equal((again.note().match(/部分清理来源甲/g) || []).length, 1);
 assert.equal((again.note().match(/部分清理来源乙/g) || []).length, 1);
});

test('并发追加在process内再次检查大小，重新选卷时已写附件迁到新卷目录', async t => {
 const h = await setup(t, {now: '2026-11-04T10:00:00+08:00', config: {saveMode: 'month', noteFolder: '竞争', splitBySize: true, maxFileSizeKB: 1}});
 const original = h.app.vault.process.bind(h.app.vault); let raced = false;
 h.app.vault.process = async (file, update) => {
  if(!raced) {raced = true; fs.appendFileSync(path.join(h.root, file.path), '\n## 2026/11/4 09:00:00\n\n并发写入' + '先'.repeat(220) + '\n');}
  return original(file, update);
 };
 h.input.value = '当前记录' + '后'.repeat(150); await h.add([new File(['move-bytes'], '迁移.png', {type: 'image/png'})]); await h.save.click();
 const old = fs.readFileSync(path.join(h.root, '竞争/2026-11.md'), 'utf8'), next = fs.readFileSync(path.join(h.root, '竞争/2026-11-002.md'), 'utf8');
 assert.match(old, /并发写入/); assert.doesNotMatch(old, /当前记录/); assert.match(next, /当前记录/);
 assert.deepEqual(fs.readdirSync(path.join(h.root, '竞争/附件/2026-11')), []);
 const files = fs.readdirSync(path.join(h.root, '竞争/附件/2026-11-002')); assert.equal(files.length, 1);
 assert.equal(fs.readFileSync(path.join(h.root, '竞争/附件/2026-11-002', files[0]), 'utf8'), 'move-bytes');
 assert.match(next, /竞争\/附件\/2026-11-002\//); assert.equal(h.input.value, '');
});

test('两张卡片并发保存同月份，process原子复核保留所有记录并自动续卷', async t => {
 const config = {saveMode: 'month', noteFolder: '双卡', splitBySize: true, maxFileSizeKB: 1}, now = '2026-11-04T10:00:00+08:00';
 const first = await setup(t, {now, config, widgetId: 'parallel-a'});
 const second = await setup(t, {now, config, root: first.root, app: first.app, widgetId: 'parallel-b'});
 first.input.value = '卡片甲' + '甲'.repeat(180); second.input.value = '卡片乙' + '乙'.repeat(180);
 await Promise.all([first.save.click(), second.save.click()]);
 assert.equal(first.input.value, ''); assert.equal(second.input.value, '');
 const files = first.app.vault.getMarkdownFiles().filter(file => file.path.startsWith('双卡/'));
 assert.equal(files.length, 2);
 const all = files.map(file => fs.readFileSync(path.join(first.root, file.path), 'utf8'));
 assert.ok(all.every(text => Buffer.byteLength(text) <= 1024));
 assert.equal((all.join('\n').match(/卡片甲/g) || []).length, 1); assert.equal((all.join('\n').match(/卡片乙/g) || []).length, 1);
});

test('实际追加后立即崩溃，恢复按快照原目标查重，改保存根也不恢复已提交文字', async t => {
 const config = {saveMode: 'month', noteFolder: '原目标', splitBySize: true, maxFileSizeKB: 1};
 const h = await setup(t, {now: '2026-11-04T10:00:00+08:00', config});
 const process = h.app.vault.process.bind(h.app.vault);
 h.app.vault.process = async (...args) => {await process(...args); throw new Error('提交后未返回');};
 h.input.value = '崩溃后不能重复'; await h.input.oninput(); await h.save.click(); h.crash();
 const restored = await setup(t, {root: h.root, config: {...config, noteFolder: '新目标'}, now: '2026-12-01T10:00:00+08:00'});
 assert.equal(restored.input.value, '');
 assert.equal((fs.readFileSync(path.join(h.root, '原目标/2026-11.md'), 'utf8').match(/崩溃后不能重复/g) || []).length, 1);
 assert.equal(fs.existsSync(path.join(h.root, '新目标')), false);
});

test('来源笔记及父目录重命名刷新最近列表且保留历史原文', async t => {
 const root = testRoot(), original = '# 灵感\n\n## 2026/11/4 10:00:00\n\n重命名前的内容\n';
 writeNote(root, '分卷/2026-11.md', original);
 const h = await setup(t, {root, recent: true, config: {saveMode: 'month', noteFolder: '分卷'}});
 assert.equal(captureRows(h).length, 1);
 await h.app.vault.rename(h.app.vault.getAbstractFileByPath('分卷/2026-11.md'), '分卷/2026-11-002.md'); await flush();
 await captureRows(h)[0].click(); assert.equal(h.opened.path, '分卷/2026-11-002.md');
 await h.app.vault.rename(h.app.vault.getAbstractFileByPath('分卷'), '已改名'); await flush();
 assert.equal(captureRows(h).length, 0); assert.ok(h.visible().includes(h.input));
 assert.equal(fs.readFileSync(path.join(root, '已改名/2026-11-002.md'), 'utf8'), original);
});

test('最近五条按记录时间排序，末尾追加较旧草稿不会挤掉较新记录', async t => {
 const root = testRoot();
 const dates = ['06', '07', '08', '09', '10', '01'];
 writeNote(root, '倒序/2026-11.md', '# 灵感\n\n' + dates.map(day => `## 2026/11/${day} 10:00:00\n\n记录${day}\n`).join('\n'));
 const h = await setup(t, {root, recent: true, config: {saveMode: 'month', noteFolder: '倒序'}});
 const rows = captureRows(h);
 assert.equal(rows.length, 5);
 assert.deepEqual(rows.map(row => row.children.find(child => child.className.includes('ws-capture-recent-summary')).textContent), ['记录10', '记录09', '记录08', '记录07', '记录06']);
 await rows[4].click();
 assert.equal(h.opened.path, '倒序/2026-11.md'); assert.equal(h.opened.options.line, 2);
});


test('共享编辑器直接输入待办，不创建卡片动作或读取和监听最近记录', async t => {
 let reads = 0;
 const h = await setup(t, {recent: true, composer: {editorOnly: true, noun: '待办'}, initialNote: '已有待办', beforeRender({vault}) {
  const read = vault.read.bind(vault); vault.read = async (...args) => {reads++; return read(...args);};
 }});
 assert.ok(h.visible().includes(h.input)); assert.equal(h.input.getAttribute('aria-label'), '待办内容');
 assert.equal(h.save.textContent, '保存待办 ↗'); h.byLabel('添加附件（图片、文件、音频、视频）');
 assert.equal(h.headerActions.children.length, 0); assert.equal(h.listenerCount(), 0); assert.equal(reads, 0);
 assert.equal(typeof h.controller.focus, 'function'); assert.equal(typeof h.controller.suspend, 'function');
 const count = h.input.focusCount || 0; h.input.value = '已有输入'; h.controller.focus();
 assert.equal(h.input.focusCount, count + 1); assert.equal(h.input.value, '已有输入');
});

test('自定义格式收到已trim文字与附件链接，提交和清理后通知，编辑器留空可继续输入', async t => {
 const calls = [], saved = []; let h;
 const composer = {editorOnly: true, noun: '待办', noteHeader: '# 待办\n\n',
  formatContent: data => {calls.push(data); return `\n- [ ] ${data.text}\n${data.markers}\n${data.links.join('\n')}\n`;},
  onSaved: async filePath => {assert.equal(h.input.value, ''); assert.ok(h.busyGuards.every(guard => !guard())); saved.push(filePath); throw new Error('回调失败');}};
 h = await setup(t, {composer}); h.input.value = '  准备演示  ';
 await h.add([new File(['screen'], '系统录屏.mp4', {type: 'video/mp4'})]); await h.save.click();
 assert.match(h.note(), /^# 待办\n\n\n- \[ \] 准备演示/); assert.match(h.note(), /workspace-capture:/);
 assert.match(h.note(), /!\[\[.*系统录屏\.mp4/); assert.ok(calls.every(data => data.text === '准备演示'));
 const final = calls.at(-1); assert.equal(final.links.length, 1); assert.match(final.links[0], /^!\[\[/); assert.ok(Number.isFinite(final.date.getTime()));
 assert.deepEqual(saved, ['收件箱/灵感.md']); assert.ok(h.visible().includes(h.input)); assert.equal(h.input.value, '');
 assert.doesNotMatch(h.body.textContent, /保存失败/); assert.match(h.body.textContent, /已保存/);
 h.input.value = '第二条'; await h.save.click(); assert.match(h.note(), /第二条/);
});

test('自定义格式完整字节参与续卷，自定义空标题允许超大单条首次写入', async t => {
 const header = '# 待办\n\n', composer = {editorOnly: true, noun: '待办', noteHeader: header,
  formatContent: ({text, markers}) => `\n- [ ] ${text}\n${markers}\n${'长'.repeat(500)}\n`};
 const h = await setup(t, {composer, initialNote: header, config: {splitBySize: true, maxFileSizeKB: 1}});
 h.input.value = '首次'; await h.save.click(); assert.match(h.note(), /首次/);
 assert.equal(fs.existsSync(path.join(h.root, '收件箱/灵感-002.md')), false);
 h.input.value = '第二次'; await h.save.click();
 const second = fs.readFileSync(path.join(h.root, '收件箱/灵感-002.md'), 'utf8'); assert.match(second, /^# 待办/); assert.match(second, /第二次/); assert.doesNotMatch(h.note(), /第二次/);
});

test('媒体按MIME优先再按后缀分类，视频可控制预览且移除清理资源', async t => {
 const h = await setup(t);
 await h.add([new File(['video'], '录屏.webm', {type: 'video/webm'}), new File(['voice'], '语音.mp4', {type: 'audio/mp4'}), new File(['image'], '截图.mp4', {type: 'image/png'}), new File(['mov'], '录屏.mov'), new File(['fallback'], '录屏.mkv'), new File(['webm'], '未标类型.webm')]);
 const video = h.body.all().filter(el => el.tagName === 'VIDEO'); assert.equal(video.length, 4);
 assert.ok(video.every(el => el.getAttribute('controls') === ''));
 assert.equal(h.body.all().filter(el => el.tagName === 'AUDIO').length, 1); assert.equal(h.body.all().filter(el => el.tagName === 'IMG').length, 1);
 video[0].paused = false; await h.byLabel('移除 录屏.webm').click(); assert.equal(video[0].paused, true); assert.equal(video[0].getAttribute('src'), null);
 await h.save.click(); assert.match(h.note(), /!\[\[.*录屏\.mov/); assert.match(h.note(), /!\[\[.*录屏\.mkv/);
});

test('suspend等待录音最终块备份并停止视频预览，focus复用草稿且卸载后安全', async t => {
 const composer = {editorOnly: true, noun: '待办'};
 const h = await setup(t, {composer, stopDelay: 30}); h.input.value = '待办录音';
 await h.add([new File(['clip'], '演示.mp4', {type: 'video/mp4'})]);
 const video = h.body.all().find(el => el.tagName === 'VIDEO'); assert.ok(video); video.paused = false;
 await h.byLabel('开始录音').click(); await h.recorders[0].emit('prefix-');
 await h.controller.suspend(); assert.equal(video.paused, true); assert.match(h.body.all().find(el => el.tagName === 'VIDEO').getAttribute('src'), /^blob:/, '暂停后仍能通过已有控件恢复播放');
 assert.ok(h.streams.every(s => s.getTracks().every(track => track.stopped))); assert.ok(h.busyGuards.some(guard => guard()));
 h.controller.focus(); assert.equal(h.input.value, '待办录音'); h.crash();
 const reopened = await setup(t, {root: h.root, composer}); await reopened.save.click();
 const folder = path.join(h.root, '收件箱/附件/灵感'); const audio = fs.readdirSync(folder).find(name => /录音/.test(name));
 assert.equal(fs.readFileSync(path.join(folder, audio), 'utf8'), 'prefix-voice-bytes');
 await reopened.dispose(); assert.doesNotThrow(() => reopened.controller.focus()); await assert.doesNotReject(() => reopened.controller.suspend());
});

test('最近媒体摘要识别常见视频附件', async t => {
 const h = await setup(t, {recent: true, initialNote: '# 灵感收件箱\n\n## 2026/11/4 10:00:00\n\n![[附件/录屏.mp4]]\n![[附件/片段.mov]]\n'});
 assert.match(captureRows(h)[0].textContent, /视频 2/);
});


test('suspend草稿备份失败时拒绝离开，保留可见错误与原输入，空草稿无需备份', async t => {
 const h = await setup(t, {composer: {editorOnly: true, noun: '待办'}});
 h.draftAdapter.write = async () => {throw new Error('模拟暂停备份失败');};
 await assert.doesNotReject(() => h.controller.suspend(), '空编辑器不需要生成快照');
 h.input.value = '尚未备份的待办';
 await assert.rejects(() => h.controller.suspend(), /草稿.*备份/);
 assert.equal(h.input.value, '尚未备份的待办'); assert.ok(h.visible().includes(h.input));
 assert.match(h.body.textContent, /模拟暂停备份失败/); assert.match(h.body.textContent, /请保留当前窗口，检查设备存储后重试，或移除未备份附件/); assert.doesNotMatch(h.body.textContent, /请手动保存/); assert.equal(h.input.disabled, false); assert.equal(h.save.disabled, false);
});

test('suspend有草稿但设备存储不可用时拒绝离开', async t => {
 const h = await setup(t, {composer: {editorOnly: true, noun: '待办'}, noDraftAdapter: true});
 h.input.value = '设备错误时保留';
 await assert.rejects(() => h.controller.suspend(), /草稿.*备份/);
 assert.equal(h.input.value, '设备错误时保留'); assert.equal(h.input.disabled, false);
});

test('suspend备份等待时锁定编辑与录音，并发暂停共享同一等待直到备份完成', async t => {
 const h = await setup(t, {composer: {editorOnly: true, noun: '待办'}});
 h.input.value = '备份期间不能开始录音';
 await h.add([new File(['durable'], '暂停附件.txt')]);
 const write = h.draftAdapter.write.bind(h.draftAdapter);
 let release, entered;
 const gate = new Promise(resolve => {release = resolve;}), writing = new Promise(resolve => {entered = resolve;});
 h.draftAdapter.write = async (...args) => {entered(); await gate; return write(...args);};
 const first = h.controller.suspend(), second = h.controller.suspend();
 await writing;
 const record = h.byLabel('开始录音'), attach = h.byLabel('添加附件（图片、文件、音频、视频）');
 const remove = h.byLabel('移除 暂停附件.txt');
 const locked = h.input.disabled && h.save.disabled && record.disabled && attach.disabled && remove.disabled;
 const attempt = record.onclick(); remove.onclick(); await flush();
 const started = h.recorders.length;
 release(); await Promise.all([first, second, attempt]);
 assert.ok(locked, '草稿写入等待期间所有编辑动作应禁用'); assert.equal(started, 0, '绕过按钮点击也不能重新开始录音');
 assert.equal(first, second, '并发暂停复用同一promise，不能提前解除禁用');
 assert.equal(h.input.disabled, false); assert.equal(h.save.disabled, false); assert.equal(record.disabled, false); assert.equal(remove.disabled, false);
 assert.ok(h.body.all().some(el => el.textContent === '暂停附件.txt'));
});
