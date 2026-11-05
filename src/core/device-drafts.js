function localPath(value) {
 if (typeof value !== 'string' || value.startsWith('/') || value.includes('\\') || value.split('/').some(part => part === '.' || part === '..')) throw new Error('设备草稿路径无效');
 return value.split('/').filter(Boolean).join('/');
}

const parentPath = path => path.slice(0, Math.max(0, path.lastIndexOf('/')));
const rootRecord = {path: '', type: 'folder', size: 0};

// IndexedDB 属于当前设备的 Obsidian 浏览器存储，不会跟随 vault 文件同步。
export class DeviceDraftAdapter {
 constructor(namespace, {indexedDB = globalThis.indexedDB} = {}) {
  if (typeof namespace !== 'string' || !namespace.trim()) throw new Error('设备草稿命名空间不能为空');
  this.namespace = namespace;
  this.indexedDB = indexedDB;
  this.database = null;
  this.closed = false;
 }

 async _open() {
  if (this.closed) throw new Error('设备草稿存储已关闭');
  if (!this.indexedDB) throw new Error('当前设备无法使用 IndexedDB 草稿存储');
  if (!this.database) this.database = new Promise((resolve, reject) => {
   const request = this.indexedDB.open(`desk-device-drafts:${this.namespace}`, 1);
   request.onupgradeneeded = () => request.result.createObjectStore('entries', {keyPath: 'path'});
   request.onerror = () => reject(request.error || new Error('无法打开设备草稿存储'));
   request.onblocked = () => reject(new Error('设备草稿数据库被旧窗口占用'));
   request.onsuccess = () => {
    const db = request.result;
    db.onversionchange = () => db.close();
    if (this.closed) db.close();
    resolve(db);
   };
  });
  return this.database;
 }

 async _transaction(mode, action) {
  const db = await this._open();
  if (this.closed) throw new Error('设备草稿存储已关闭');
  return new Promise((resolve, reject) => {
   const tx = db.transaction('entries', mode), store = tx.objectStore('entries');
   let result, failure;
   const fail = error => {failure = error; try {tx.abort();} catch {reject(error);}};
   const request = (operation, next) => {
    operation.onsuccess = () => {try {next(operation.result);} catch (error) {fail(error);}};
   };
   // 只有事务提交后才确认成功，单条快照覆盖失败会自动回滚到上次完整记录。
   tx.oncomplete = () => resolve(result);
   tx.onabort = () => reject(failure || tx.error || new Error('设备草稿事务中断'));
   tx.onerror = () => {failure ||= tx.error;};
   try {action(store, request, value => {result = value;});} catch (error) {fail(error);}
  });
 }

 async _get(value) {
  const path = localPath(value);
  return this._transaction('readonly', (store, request, done) => {
   if (!path) {done(rootRecord); return;}
   request(store.get(path), done);
  });
 }

 async exists(path) {return !!await this._get(path);}

 async mkdir(value) {
  const path = localPath(value);
  return this._transaction('readwrite', (store, request) => {
   if (!path) return;
   const checkParent = parent => {
    if (parent?.type !== 'folder') throw new Error('父目录不存在');
    request(store.get(path), current => {
     if (current && current.type !== 'folder') throw new Error('同名文件已存在');
     if (!current) store.put({path, type: 'folder', size: 0});
    });
   };
   const parent = parentPath(path);
   if (parent) request(store.get(parent), checkParent); else checkParent(rootRecord);
  });
 }

 async list(value) {
  const path = localPath(value);
  return this._transaction('readonly', (store, request, done) => {
   request(store.getAll(), records => {
    if (path && !records.some(row => row.path === path && row.type === 'folder')) throw new Error('目录不存在');
    const children = records.filter(row => row.path !== path && parentPath(row.path) === path).sort((a, b) => a.path.localeCompare(b.path));
    done({files: children.filter(row => row.type === 'file').map(row => row.path), folders: children.filter(row => row.type === 'folder').map(row => row.path)});
   });
  });
 }

 async read(path) {
  const entry = await this._get(path);
  if (entry?.type !== 'file') throw new Error('草稿文件不存在');
  return typeof entry.data === 'string' ? entry.data : new TextDecoder().decode(entry.data);
 }

 async readBinary(path) {
  const entry = await this._get(path);
  if (entry?.type !== 'file') throw new Error('草稿文件不存在');
  return typeof entry.data === 'string' ? new TextEncoder().encode(entry.data).buffer : entry.data.slice(0);
 }

 async _put(value, data, size) {
  const path = localPath(value);
  if (!path) throw new Error('不能覆盖根目录');
  return this._transaction('readwrite', (store, request) => {
   const checkParent = parent => {
    if (parent?.type !== 'folder') throw new Error('父目录不存在');
    request(store.get(path), current => {
     if (current?.type === 'folder') throw new Error('同名目录已存在');
     store.put({path, type: 'file', size, data});
    });
   };
   const parent = parentPath(path);
   if (parent) request(store.get(parent), checkParent); else checkParent(rootRecord);
  });
 }

 async write(path, text) {
  if (typeof text !== 'string') throw new TypeError('草稿文字必须为字符串');
  return this._put(path, text, new TextEncoder().encode(text).byteLength);
 }

 async writeBinary(path, bytes) {
  let data;
  if (ArrayBuffer.isView(bytes)) data = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength).slice().buffer;
  else {
   try {data = ArrayBuffer.prototype.slice.call(bytes, 0);}
   catch {throw new TypeError('草稿二进制必须为 ArrayBuffer 或视图');}
  }
  return this._put(path, data, data.byteLength);
 }

 async remove(value) {
  const path = localPath(value);
  return this._transaction('readwrite', (store, request) => {
   if (!path) throw new Error('不能删除根目录');
   request(store.get(path), current => {
    if (current?.type === 'folder') throw new Error('请使用 rmdir 删除目录');
    store.delete(path);
   });
  });
 }

 async rmdir(value, recursive = false) {
  const path = localPath(value);
  return this._transaction('readwrite', (store, request) => {
   if (!path) throw new Error('不能删除根目录');
   request(store.getAll(), records => {
    const current = records.find(row => row.path === path);
    if (!current) return;
    if (current.type !== 'folder') throw new Error('此路径不是目录');
    const descendants = records.filter(row => row.path.startsWith(path + '/'));
    if (descendants.length && !recursive) throw new Error('目录非空');
    for (const row of descendants) store.delete(row.path);
    store.delete(path);
   });
  });
 }

 async stat(path) {
  const entry = await this._get(path);
  return entry ? {type: entry.type, size: entry.size} : null;
 }

 async close() {
  this.closed = true;
  if (this.database) {const db = await this.database.catch(() => null); db?.close();}
 }
}
