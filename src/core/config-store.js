import { createWorkspace, validateDocument, normalizeDirectory, configPath } from './model.js';

const FORMAT = 'simple-space';
const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}
// 修订号只标识一次保存；冲突依据实际内容，避免格式化或重复保存制造冲突。
function signature(document) { const { revision, history, ...content } = document; return JSON.stringify(stable(content)); }
function lineage(...documents) {
  const revisions = [...documents.flatMap(document => document.history), ...documents.map(document => document.revision)];
  return [...new Set(revisions.reverse())].reverse().slice(-128);
}
function error(message, code) { const value = new Error(message); value.code = code; return value; }
function settings(input, prior = { mode: 'plugin', folder: '.', openOnStartup: false }) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw error('设置必须是对象');
  for (const key of Object.keys(input)) if (!['mode', 'folder', 'openOnStartup'].includes(key)) throw error(`未知设置：${key}`);
  const next = { mode: input.mode ?? prior.mode, folder: input.folder ?? prior.folder, openOnStartup: input.openOnStartup ?? prior.openOnStartup };
  if (!['plugin', 'folder'].includes(next.mode) || typeof next.openOnStartup !== 'boolean') throw error('设置无效');
  next.folder = normalizeDirectory(next.folder);
  return next;
}
function metadata(data) {
  if (!data || typeof data !== 'object' || data.format !== FORMAT || typeof data.vaultId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/u.test(data.vaultId)) throw error('插件配置格式无效，原数据已保留');
  return { vaultId: data.vaultId, settings: settings(data.settings) };
}
function sameSource(first, second) {
  return first.vaultId === second.vaultId && first.settings.mode === second.settings.mode && first.settings.folder === second.settings.folder;
}
export class WorkspaceStore {
  constructor(io, options = {}) {
    this.io = io; this.options = options; this._document = null; this._state = null; this._baseline = null; this._conflict = null;
    this._queue = Promise.resolve();
  }
  get document() { return copy(this._document); }
  get settings() { return copy(this._state?.settings); }
  get vaultId() { return this._state?.vaultId; }
  get conflict() { return copy(this._conflict); }
  export() { this._ready(); return JSON.stringify(this._document, null, 2); }
  _ready() { if (!this._state || !this._document) throw error('请先初始化工作台'); }
  _enqueue(operation) {
    const result = this._queue.then(operation);
    this._queue = result.catch(() => {});
    return result;
  }
  _emit(name, value) { try { this.options[name]?.(value); } catch (cause) { if (name !== 'onError') { try { this.options.onError?.(cause); } catch {} } } }
  async _checkpoint(document = this._document) {
    if (typeof this.io.saveCheckpoint !== 'function') return;
    try { await this.io.saveCheckpoint({ vaultId: this.vaultId, settings: this.settings, workspace: copy(document) }); }
    catch (cause) { this._emit('onError', cause); }
  }
  async _loadCheckpoint() {
    if (typeof this.io.loadCheckpoint !== 'function') return null;
    try {
      const saved = await this.io.loadCheckpoint();
      if (saved == null) return null;
      const state = metadata({ format: FORMAT, vaultId: saved.vaultId, settings: saved.settings });
      return { state, workspace: validateDocument(saved.workspace) };
    } catch (cause) { this._emit('onError', cause); return null; }
  }
  async _changed(document, checkpoint = document) {
    this._document = copy(document); this._baseline = copy(document);
    await this._checkpoint(checkpoint); this._emit('onChange', this.document);
  }
  _serialized(state = this._state, document = this._document, conflict = this._conflict) { return { format: FORMAT, vaultId: state.vaultId, settings: copy(state.settings), workspace: copy(document), conflict: copy(conflict) }; }
  async _readFile(path) {
    if (!await this.io.exists(path)) throw error(`配置文件暂时不存在：${path}`, 'WORKSPACE_MISSING');
    const text = await this.io.read(path);
    if (typeof text !== 'string' || text.length > 2_000_000) throw error('配置文件过大或不是文本文件');
    return validateDocument(JSON.parse(text));
  }
  async _source() {
    try {
      const data = await this.io.loadData();
      const state = metadata(data);
      const document = state.settings.mode === 'folder' ? await this._readFile(configPath(state.settings.folder)) : validateDocument(data.workspace);
      return { state, document };
    } catch (cause) {
      const unavailable = error(`配置来源暂不可用：${cause.message}`, 'WORKSPACE_UNAVAILABLE'); unavailable.cause = cause; throw unavailable;
    }
  }
  async _remote() {
    const { state, document } = await this._source();
    if (!sameSource(state, this._state)) throw error('另一端已更改配置来源，请刷新后重试', 'WORKSPACE_SOURCE_CHANGED');
    return document;
  }
  init() {
    return this._enqueue(async () => {
      if (this._state) return this.document;
      const checkpoint = await this._loadCheckpoint();
      try {
        const data = await this.io.loadData();
        if (data == null || (typeof data === 'object' && !Array.isArray(data) && Object.getPrototypeOf(data) === Object.prototype && Object.keys(data).length === 0)) {
          if (checkpoint) throw error('插件配置暂时不存在，已保留设备恢复点', 'WORKSPACE_UNAVAILABLE');
          const state = { vaultId: globalThis.crypto.randomUUID(), settings: settings({ mode: 'folder', folder: 'Simple Space', openOnStartup: false }) };
          const path = configPath(state.settings.folder);
          let document;
          if (!await this.io.exists(path)) {
            await this.io.mkdir(state.settings.folder);
            // 创建目录期间同步可能已带来配置，重新检查后再决定是否首次写入。
            if (!await this.io.exists(path)) {
              document = createWorkspace();
              await this.io.write(path, JSON.stringify(document, null, 2));
            }
          }
          document ??= await this._readFile(path);
          await this.io.saveData(this._serialized(state, document)); this._state = state; await this._changed(document);
          return this.document;
        }
        const state = metadata(data);
        let document;
        try { document = validateDocument(data.workspace); } catch (cause) {
          if (state.settings.mode !== 'folder') throw cause;
          document = null;
        }
        const cached = checkpoint ? (sameSource(checkpoint.state, state) ? checkpoint.workspace : null) : (state.settings.mode === 'folder' ? document : null);
        if (state.settings.mode === 'folder') {
          try { document = await this._readFile(configPath(state.settings.folder)); }
          catch (cause) { this._emit('onError', cause); if (cached) document = cached; if (!document) throw cause; }
        }
        if (data.conflict == null && cached && signature(document) !== signature(cached) && !document.history.includes(cached.revision)) {
          this._state = state; await this._changed(cached);
          try { await this._recordConflict(cached, document); }
          catch (cause) { if (cause.code !== 'WORKSPACE_CONFLICT') this._emit('onError', cause); }
          return this.document;
        }
        if (data.conflict != null) {
          const saved = data.conflict;
          this._conflict = { local: validateDocument(saved.local), remote: validateDocument(saved.remote), path: state.settings.mode === 'folder' ? configPath(state.settings.folder) : null, vaultId: state.vaultId, createdAt: typeof saved.createdAt === 'string' ? saved.createdAt.slice(0, 100) : '' };
        }
        this._state = state; await this._changed(document, this._conflict?.local ?? document);
        if (this._conflict) this._emit('onConflict', this.conflict);
        return this.document;
      } catch (cause) {
        if (!checkpoint || this._state) throw cause;
        // 同步暂时移走或损坏配置时，只展示设备恢复点，等待来源恢复或用户明确切换。
        this._state = copy(checkpoint.state); this._document = copy(checkpoint.workspace); this._baseline = copy(checkpoint.workspace);
        const unavailable = error(`配置来源暂不可用，已恢复设备上的布局：${cause.message}`, 'WORKSPACE_UNAVAILABLE'); unavailable.cause = cause;
        this._emit('onError', unavailable); this._emit('onChange', this.document);
        return this.document;
      }
    });
  }
  async _recordConflict(local, remote) {
    try {
      for (let attempt = 0; attempt < 10; attempt++) {
        const record = { local: copy(local), remote: copy(remote), path: this._state.settings.mode === 'folder' ? configPath(this._state.settings.folder) : null, vaultId: this.vaultId, createdAt: new Date().toISOString() };
        this._conflict = record;
        await this._checkpoint(local);
        if (typeof this.io.backup !== 'function') throw error('缺少设备本地备份接口');
        await this.io.backup(copy(record));
        // 备份期间同步仍可能到达；先保留每个已观察版本，再刷新预览，避免回写过时来源。
        const latest = await this._source();
        if (!sameSource(latest.state, this._state) || signature(latest.document) !== signature(remote)) {
          this._state = latest.state; remote = latest.document; continue;
        }
        this._state = latest.state;
        await this.io.saveData(this._serialized(this._state, this._state.settings.mode === 'plugin' ? remote : this._document));
        throw error('检测到另一端修改，请选择保留本地或远端配置', 'WORKSPACE_CONFLICT');
      }
      throw error('配置持续变化，已保留冲突备份，请稍后重新确认', 'WORKSPACE_CONFLICT');
    } finally { this._emit('onConflict', this.conflict); }
  }
  async _changeConflictSource(state, remote) {
    // 来源变化前先保留旧冲突，新的预览必须再次确认，不能把旧选择直接写到新位置。
    if (typeof this.io.backup !== 'function') throw error('缺少设备本地备份接口');
    await this.io.backup(copy(this._conflict));
    const local = this._conflict.local;
    this._state = copy(state);
    await this._recordConflict(local, remote);
  }
  _unblocked() { this._ready(); if (this._conflict) throw error('请先解决配置冲突', 'WORKSPACE_CONFLICT'); }
  async _checkRemote(candidate) {
    const remote = await this._remote();
    if (signature(remote) !== signature(this._baseline)) await this._recordConflict(candidate, remote);
    return remote;
  }
  async _write(document, previous) {
    if (this._state.settings.mode === 'folder') {
      const path = configPath(this._state.settings.folder);
      await this.io.write(path, JSON.stringify(document, null, 2));
      const observed = await this._readFile(path);
      if (signature(observed) !== signature(document)) await this._recordConflict(document, observed);
      try { await this.io.saveData(this._serialized(this._state, document, null)); }
      catch (cause) {
        try {
          // 缓存事务失败时，只回滚仍然属于本次写入的版本，避免抹掉同步来的第三版。
          const current = await this._readFile(path);
          if (previous && signature(current) === signature(document)) await this.io.write(path, JSON.stringify(previous, null, 2));
        } catch (rollbackError) { this._emit('onError', rollbackError); }
        throw cause;
      }
    } else await this.io.saveData(this._serialized(this._state, document, null));
  }
  async _saveCandidate(candidate) {
    candidate = validateDocument(candidate); candidate.history = lineage(candidate, this._baseline); candidate.revision = globalThis.crypto.randomUUID();
    const previous = await this._checkRemote(candidate); await this._write(candidate, previous); await this._changed(candidate); return this.document;
  }
  update(mutator) {
    return this._enqueue(async () => {
      this._unblocked(); if (typeof mutator !== 'function') throw error('更新操作必须是函数');
      const draft = this.document; const result = await mutator(draft);
      return this._saveCandidate(result === undefined ? draft : result);
    });
  }
  replace(document) {
    return this._enqueue(async () => { this._unblocked(); return this._saveCandidate(validateDocument(document)); });
  }
  switchStorage(input) {
    return this._enqueue(async () => {
      this._unblocked();
      const target = settings(input, this._state.settings);
      if (target.mode === this._state.settings.mode && target.folder === this._state.settings.folder) return this.document;
      try { await this._checkRemote(this._document); }
      catch (cause) { if (cause.code !== 'WORKSPACE_UNAVAILABLE' || this._conflict) throw cause; }
      let document = this.document;
      if (target.mode === 'folder') {
        const path = configPath(target.folder);
        if (await this.io.exists(path)) {
          const text = await this.io.read(path);
          if (typeof text !== 'string' || text.length > 2_000_000) throw error('目标配置文件无效');
          if (text.trim()) document = validateDocument(JSON.parse(text));
          else await this.io.write(path, JSON.stringify(document, null, 2));
        } else {
          if (target.folder !== '.') {
            let prefix = '';
            for (const part of target.folder.split('/')) { prefix = prefix ? `${prefix}/${part}` : part; await this.io.mkdir(prefix); }
          }
          await this.io.write(path, JSON.stringify(document, null, 2));
        }
      }
      const state = { vaultId: this.vaultId, settings: target };
      await this.io.saveData(this._serialized(state, document));
      this._state = state; await this._changed(document); return this.document;
    });
  }
  updateSettings(patch) {
    return this._enqueue(async () => {
      this._unblocked(); const next = settings(patch, this._state.settings);
      if (next.mode !== this._state.settings.mode || next.folder !== this._state.settings.folder) throw error('请通过 switchStorage 更改配置位置');
      await this._checkRemote(this._document);
      const state = { vaultId: this.vaultId, settings: next };
      await this.io.saveData(this._serialized(state)); this._state = state; await this._checkpoint(); return this.settings;
    });
  }
  externalChange() {
    return this._enqueue(async () => {
      this._ready();
      try {
        const { state, document: remote } = await this._source();
        if (this._conflict) {
          if (!sameSource(state, this._state)) await this._changeConflictSource(state, remote);
          return this.document;
        }
        const changed = signature(remote) !== signature(this._baseline);
        const newSource = !sameSource(state, this._state);
        if (changed && !newSource && !remote.history.includes(this._baseline.revision)) await this._recordConflict(this._document, remote);
        if (changed || JSON.stringify(state) !== JSON.stringify(this._state)) {
          if (state.settings.mode === 'folder') {
            try { await this.io.saveData(this._serialized(state, remote)); } catch (cause) { this._emit('onError', cause); }
          }
          this._state = state;
          await this._changed(remote);
        }
      }
      catch (cause) { if (cause.code !== 'WORKSPACE_CONFLICT') this._emit('onError', cause); }
      return this.document;
    });
  }
  resolveConflict(choice) {
    return this._enqueue(async () => {
      this._ready(); if (!this._conflict) throw error('没有需要解决的冲突');
      if (!['local', 'remote'].includes(choice)) throw error('冲突选择无效');
      const { state, document: remote } = await this._source();
      if (!sameSource(state, this._state)) await this._changeConflictSource(state, remote);
      if (signature(remote) !== signature(this._conflict.remote)) await this._recordConflict(this._conflict.local, remote);
      let document = choice === 'local' ? copy(this._conflict.local) : remote;
      if (choice === 'local') { document.history = lineage(this._conflict.local, remote, this._baseline); document.revision = globalThis.crypto.randomUUID(); await this._write(document, remote); }
      else await this.io.saveData(this._serialized(this._state, document, null));
      this._conflict = null; await this._changed(document); return this.document;
    });
  }
}
