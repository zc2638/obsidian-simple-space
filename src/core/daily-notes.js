import {normalizeDirectory,validateVaultPath} from './model.js';
const defaults = { folder: '日记', format: 'YYYY-MM-DD', template: '' };

function vaultPath(value, { empty = false } = {}) {
  if (typeof value !== 'string') throw new Error('路径必须是文本');
  if(empty&&!value.trim())return '';
  const path=empty?normalizeDirectory(value):validateVaultPath(value);
  return path==='.'?'':path;
}

export async function resolveDailyNoteSettings(app, config = {}) {
  const settings = {
    folder: config.dailyFolder ?? defaults.folder,
    format: config.dailyFormat || defaults.format,
    template: config.dailyTemplate ?? defaults.template,
  };
  if (config.useDailyNotes === false) return settings;
  const adapter = app.vault.adapter;
  const configPath = `${app.vault.configDir || '.obsidian'}/daily-notes.json`;
  if (!await adapter.exists(configPath)) return settings;
  let core;
  try { core = JSON.parse(await adapter.read(configPath)); }
  catch (error) { throw new Error(`无法读取核心日记设置：${error.message}`); }
  if (!core || typeof core !== 'object' || Array.isArray(core)) throw new Error('核心日记设置格式无效');
  for (const key of ['folder', 'format', 'template']) {
    if (typeof core[key] === 'string') settings[key] = core[key];
  }
  if (!settings.format) settings.format = defaults.format;
  return settings;
}

export function interpolateDailyTemplate(template, date, title, formatDate) {
  return template.replace(/\{\{(date|time)(?::([^}]+))?\}\}|\{\{title\}\}/g, (match, kind, format) => {
    if (match === '{{title}}') return title;
    return formatDate(date, format || (kind === 'date' ? 'YYYY-MM-DD' : 'HH:mm'));
  });
}

function requireFile(file, path) {
  if (!file || typeof file.extension !== 'string') throw new Error(`路径不是笔记文件：${path}`);
  return file;
}

async function ensureFolders(vault, directory) {
  if (!directory) return;
  const parts = directory.split('/');
  for (let index = 1; index <= parts.length; index++) {
    const path = parts.slice(0, index).join('/');
    let folder = vault.getAbstractFileByPath(path);
    if (!folder) {
      try { await vault.createFolder(path); }
      catch (error) {
        // 同一日记可从多个工作台同时打开，创建冲突后确认目录确实存在。
        if (!vault.getAbstractFileByPath(path)) throw error;
      }
      folder = vault.getAbstractFileByPath(path);
    }
    if (!folder || !Array.isArray(folder.children)) throw new Error(`路径已被文件占用：${path}`);
  }
}

export async function openDailyNote({ app, config = {}, date, formatDate, openPath }) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new Error('日期无效');
  const settings = await resolveDailyNoteSettings(app, config);
  const folder = vaultPath(settings.folder, { empty: true });
  const formatted = vaultPath(formatDate(date, settings.format));
  const filename = /\.md$/i.test(formatted) ? formatted : `${formatted}.md`;
  const path = vaultPath([folder, filename].filter(Boolean).join('/'));
  const templatePath = settings.template ? vaultPath(settings.template) : '';
  const vault = app.vault;
  let file = vault.getAbstractFileByPath(path);
  if (!file) {
    let content = '';
    if (templatePath) {
      const fullPath = /\.md$/i.test(templatePath) ? templatePath : `${templatePath}.md`;
      const template = vault.getAbstractFileByPath(fullPath);
      if (!template || template.extension !== 'md') throw new Error(`模板不存在：${fullPath}`);
      const title = filename.split('/').at(-1).replace(/\.md$/i, '');
      content = interpolateDailyTemplate(await vault.read(template), date, title, formatDate);
    }
    await ensureFolders(vault, path.split('/').slice(0, -1).join('/'));
    // 目录与模板读取期间可能已有另一入口创建了文件，不覆盖现有内容。
    file = vault.getAbstractFileByPath(path);
    if (!file) {
      try { file = await vault.create(path, content); }
      catch (error) {
        file = vault.getAbstractFileByPath(path);
        if (!file) throw error;
      }
    }
  }
  requireFile(file, path);
  await openPath(path);
  return path;
}
