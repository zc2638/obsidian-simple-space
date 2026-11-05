const FORMAT = 'simple-space';
const TYPES = ['welcome', 'capture', 'stats', 'links', 'tasks', 'recent'];
const clone = value => JSON.parse(JSON.stringify(value));
const fail = message => { throw new Error(message); };
function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(`${label} 必须是普通对象`);
  return value;
}
function keys(value, allowed, label) {
  object(value, label);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${label} 包含不支持的字段：${key}`);
}
function string(value, label, max = 1000, empty = true) {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) fail(`${label} 无效`);
  return value;
}
function integer(value, min, max, label) {
  if (!Number.isInteger(value) || value < min || value > max) fail(`${label} 必须介于 ${min} 和 ${max}`);
  return value;
}
function choice(value, allowed, label) { if (!allowed.includes(value)) fail(`${label} 无效`); return value; }
function strings(value, label, max = 100, length = 1000) {
  if (!Array.isArray(value) || value.length > max) fail(`${label} 数量超限`);
  return value.map(item => string(item, label, length));
}
export function normalizeDirectory(input) {
  string(input, '目录', 1000, false);
  const path = input.trim().replace(/\/+$/u, '');
  if (path === '.') return '.';
  if (!path || path.startsWith('/') || /[\\<>:"|?*\u0000-\u001f]/u.test(path)) fail('必须使用有效的 Vault 相对路径');
  const segments = path.split('/');
  if (segments.length > 40 || segments.some(part => !part || part === '.' || part === '..' || part.length > 255 || /[. ]$/u.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part))) fail('路径包含无效名称');
  return path;
}
export function validateVaultPath(input) {
  const path = normalizeDirectory(input);
  if (path === '.') fail('文件路径不能是根目录');
  return path;
}
function markdownPath(input, label) {
  const path = validateVaultPath(input);
  if (!/\.md$/iu.test(path)) fail(`${label} 必须是以 .md 结尾的 Markdown 笔记路径`);
  return path;
}
export function configPath(folder) { const path = normalizeDirectory(folder); return path === '.' ? 'workspace.json' : `${path}/workspace.json`; }
const definitions = {
  welcome: { name: '欢迎卡片', icon: 'sunrise', accent: '#6388c9', defaultSize: { w: 12, h: 4 }, defaultConfig: { name: '', quotes: ['每一天，都可以从一件小事开始。'], source: '', dailyFolder: '日记', dailyFormat: 'YYYY-MM-DD', dailyTemplate: '', useDailyNotes: true } },
  capture: { name: '即时灵感', icon: 'sparkles', accent: '#6695d8', defaultSize: { w: 6, h: 5 }, defaultConfig: { saveMode: 'single', noteFolder: 'Simple Space/即时灵感', notePath: 'Simple Space/即时灵感/灵感.md', attachmentFolder: 'Simple Space/即时灵感/附件', splitBySize: true, maxFileSizeKB: 1024 } },
  stats: { name: '统计卡片', icon: 'pie-chart', accent: '#d97706', defaultSize: { w: 6, h: 5 }, defaultConfig: { metrics: ['notes', 'tags', 'words', 'attachments'] } },
  links: { name: '快捷入口', icon: 'pin', accent: '#0d9488', defaultSize: { w: 12, h: 4 }, defaultConfig: { items: [], columns: 2 } },
  tasks: { name: '待办任务', icon: 'columns-3', accent: '#2563eb', defaultSize: { w: 7, h: 6 }, defaultConfig: { sourceType: 'folder', source: 'Simple Space/待办任务', inboxPath: 'Simple Space/待办任务/待办任务.md', noteFolder: 'Simple Space/待办任务', saveMode: 'single', splitBySize: true, maxFileSizeKB: 1024, showDoing: true } },
  recent: { name: '最近笔记', icon: 'history', accent: '#2563eb', defaultSize: { w: 5, h: 6 }, defaultConfig: { folder: '', limit: 8, sort: 'modified', excludeFolders: ['工作台配置'] } }
};
function freeze(value) { Object.values(value).forEach(item => { if (item && typeof item === 'object') freeze(item); }); return Object.freeze(value); }
export const CARD_DEFINITIONS = freeze(definitions);
function config(type, value) {
  const defaults = CARD_DEFINITIONS[type].defaultConfig;
  keys(value, Object.keys(defaults), `${type} 配置`);
  const missing = Object.keys(defaults).filter(key => !Object.hasOwn(value, key));
  const storageFields = ['saveMode', 'noteFolder', 'splitBySize', 'maxFileSizeKB'];
  const compatibleFields = type === 'tasks' ? [...storageFields, 'showDoing'] : storageFields;
  for (const key of missing) if (!['capture', 'tasks'].includes(type) || !compatibleFields.includes(key)) fail(`${type} 配置缺少 ${key}`);
  value = clone(value);
  const folder = path => path === '' ? '' : normalizeDirectory(path);
  switch (type) {
    case 'welcome':
      string(value.name, '名字', 200); strings(value.quotes, '引言', 50, 2000);
      string(value.source, '引言来源', 500); value.dailyFolder = folder(value.dailyFolder);
      if (value.source !== '') value.source = markdownPath(value.source, '引言来源');
      string(value.dailyFormat, '日记格式', 200, false);
      if (value.dailyTemplate !== '') value.dailyTemplate = validateVaultPath(value.dailyTemplate);
      if (typeof value.useDailyNotes !== 'boolean') fail('日记插件设置无效');
      break;
    case 'capture':
      value.notePath = markdownPath(value.notePath, '灵感笔记'); value.attachmentFolder = normalizeDirectory(value.attachmentFolder);
      for (const key of missing) value[key] = key === 'noteFolder' ? value.notePath.slice(0, -3) || defaults.noteFolder : defaults[key];
      choice(value.saveMode, ['year', 'quarter', 'month', 'day', 'single'], '灵感保存方式');
      value.noteFolder = normalizeDirectory(value.noteFolder);
      if (typeof value.splitBySize !== 'boolean') fail('按文件大小续卷设置无效');
      integer(value.maxFileSizeKB, 1, 1048576, '单文件上限（KB）');
      break;
    case 'stats': strings(value.metrics, '统计项', 4, 20).forEach(item => choice(item, ['notes', 'tags', 'words', 'attachments'], '统计项')); break;
    case 'links':
      integer(value.columns, 1, 6, '链接列数');
      if (!Array.isArray(value.items) || value.items.length > 100) fail('链接数量超限');
      for (const item of value.items) {
        keys(item, ['title', 'url', 'icon'], '链接'); string(item.title, '链接标题', 200, false); string(item.url, '链接地址', 2000, false);
        if (Object.hasOwn(item, 'icon')) {
          string(item.icon, '链接图标', 100, false);
          if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(item.icon)) fail('链接图标无效');
        }
        if (/^[a-z][a-z0-9+.-]*:/iu.test(item.url)) {
          if (!/^(https?:|obsidian:|mailto:)/iu.test(item.url)) fail('不支持的链接协议');
        } else item.url = validateVaultPath(item.url);
      }
      break;
    case 'tasks':
      choice(value.sourceType, ['file', 'folder'], '待办来源类型');
      if (value.sourceType === 'file') value.source = markdownPath(value.source, '待办来源'); else value.source = normalizeDirectory(value.source);
      value.inboxPath = markdownPath(value.inboxPath, '待办收件箱');
      for (const key of missing) value[key] = key === 'noteFolder' ? (value.inboxPath.includes('/') ? value.inboxPath.slice(0, value.inboxPath.lastIndexOf('/')) : '.') : defaults[key];
      if (typeof value.showDoing !== 'boolean') fail('显示进行中状态设置无效');
      choice(value.saveMode, ['year', 'quarter', 'month', 'day', 'single'], '待办保存方式');
      value.noteFolder = normalizeDirectory(value.noteFolder);
      if (typeof value.splitBySize !== 'boolean') fail('按文件大小续卷设置无效');
      integer(value.maxFileSizeKB, 1, 1048576, '单文件上限（KB）');
      break;
    case 'recent':
      value.folder = folder(value.folder); integer(value.limit, 1, 100, '最近笔记数量'); choice(value.sort, ['modified', 'created'], '排序');
      value.excludeFolders = strings(value.excludeFolders, '排除目录', 100).map(normalizeDirectory); break;
  }
  return clone(value);
}
function card(value) {
  keys(value, ['id', 'type', 'title', 'w', 'h', 'config'], '卡片');
  choice(value.type, TYPES, '卡片类型'); string(value.id, '卡片 ID', 100, false);
  if (!/^[a-zA-Z0-9_-]+$/u.test(value.id)) fail('卡片 ID 无效');
  // 只更新旧版默认标题，用户自定义标题继续保留。
  const title = value.type === 'tasks' && value.title === '待办卡片' ? '待办任务' : value.title;
  return { id: value.id, type: value.type, title: string(title, '卡片标题', 200), w: integer(value.w, 1, 12, '宽度'), h: integer(value.h, 1, 24, '高度'), config: config(value.type, value.config) };
}
export function createCard(type, overrides = {}) {
  choice(type, TYPES, '卡片类型'); keys(overrides, ['id', 'type', 'title', 'w', 'h', 'config'], '卡片选项');
  if (Object.hasOwn(overrides, 'type') && overrides.type !== type) fail('卡片类型不可覆盖');
  const definition = CARD_DEFINITIONS[type];
  return card({ id: overrides.id ?? globalThis.crypto.randomUUID(), type, title: overrides.title ?? definition.name, w: overrides.w ?? definition.defaultSize.w, h: overrides.h ?? definition.defaultSize.h, config: overrides.config ?? definition.defaultConfig });
}
export function createWorkspace() { return { format: FORMAT, version: 1, revision: globalThis.crypto.randomUUID(), history: [], cards: TYPES.map(type => createCard(type)) }; }
export function validateDocument(input) {
  keys(input, ['format', 'version', 'revision', 'history', 'cards'], '工作台');
  if (input.format !== FORMAT || input.version !== 1) fail('不支持的工作台格式或版本');
  string(input.revision, '修订号', 100, false);
  const history = Object.hasOwn(input, 'history') ? strings(input.history, '历史修订号', 128, 100) : [];
  history.forEach(revision => string(revision, '历史修订号', 100, false));
  if (!Array.isArray(input.cards) || input.cards.length > 100) fail('卡片数量超限');
  const cards = input.cards.map(card);
  if (new Set(cards.map(item => item.id)).size !== cards.length) fail('卡片 ID 重复');
  const document = { format: FORMAT, version: 1, revision: input.revision, history: [...history], cards };
  if (JSON.stringify(document, null, 2).length > 2_000_000) fail('配置文件过大');
  return document;
}
