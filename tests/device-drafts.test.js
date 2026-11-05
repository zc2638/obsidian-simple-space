import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {IDBFactory, IDBObjectStore} from 'fake-indexeddb';
import {DeviceDraftAdapter} from '../src/core/device-drafts.js';

function setup(t, namespace = 'vault-card') {
 const indexedDB = new IDBFactory();
 const adapter = new DeviceDraftAdapter(namespace, {indexedDB});
 t.after(() => adapter.close());
 return {adapter, indexedDB};
}

test('设备草稿在同一命名空间重建恢复，其他空间无法读取', async t => {
 const {adapter, indexedDB} = setup(t);
 await adapter.mkdir('drafts'); await adapter.write('drafts/snapshot-a.json', '{"text":"设备草稿"}');
 await adapter.close();
 const restored = new DeviceDraftAdapter('vault-card', {indexedDB}); t.after(() => restored.close());
 assert.equal(await restored.read('drafts/snapshot-a.json'), '{"text":"设备草稿"}');
 const other = new DeviceDraftAdapter('another-vault', {indexedDB}); t.after(() => other.close());
 assert.equal(await other.exists('drafts/snapshot-a.json'), false);
 await assert.rejects(other.read('drafts/snapshot-a.json'), /不存在/);
});

test('目录只列直接子项，统计按UTF8字节计数并允许幂等建目录', async t => {
 const {adapter} = setup(t);
 assert.equal(await adapter.exists(''), true);
 await adapter.mkdir('drafts'); await adapter.mkdir('drafts'); await adapter.mkdir('drafts/nested');
 await adapter.write('drafts/文字.txt', '中文'); await adapter.write('drafts/nested/a.txt', 'deep');
 assert.deepEqual(await adapter.list('drafts'), {files: ['drafts/文字.txt'], folders: ['drafts/nested']});
 assert.deepEqual(await adapter.stat('drafts/文字.txt'), {type: 'file', size: 6});
 assert.deepEqual(await adapter.stat('drafts'), {type: 'folder', size: 0});
 assert.equal(await adapter.stat('missing'), null);
 await assert.rejects(adapter.write('missing/a.txt', 'x'), /目录/);
 await assert.rejects(adapter.mkdir('drafts/文字.txt'), /文件/);
});

test('二进制ArrayBuffer与视图保真，不受写入前后外部修改影响', async t => {
 const {adapter} = setup(t); await adapter.mkdir('drafts');
 const original = new Uint8Array([0, 255, 128, 1, 0]);
 const saving = adapter.writeBinary('drafts/chunk.bin', original.buffer); original[1] = 7; await saving;
 const first = await adapter.readBinary('drafts/chunk.bin');
 assert.ok(first instanceof ArrayBuffer); assert.deepEqual([...new Uint8Array(first)], [0, 255, 128, 1, 0]);
 new Uint8Array(first)[0] = 9;
 assert.deepEqual([...new Uint8Array(await adapter.readBinary('drafts/chunk.bin'))], [0, 255, 128, 1, 0]);
 await adapter.writeBinary('drafts/view.bin', new Uint8Array([9, 3, 4, 8]).subarray(1, 3));
 assert.deepEqual([...new Uint8Array(await adapter.readBinary('drafts/view.bin'))], [3, 4]);
 assert.equal((await adapter.stat('drafts/chunk.bin')).size, 5);
});

test('快照事务中断时保留上一条完整记录，不能报告写入成功', async t => {
 const {adapter} = setup(t); await adapter.mkdir('drafts');
 await adapter.write('drafts/snapshot-a.json', '{"revision":1,"complete":true}');
 const originalPut = IDBObjectStore.prototype.put;
 IDBObjectStore.prototype.put = function (...args) {
  const request = originalPut.apply(this, args); this.transaction.abort(); return request;
 };
 try {await assert.rejects(adapter.write('drafts/snapshot-a.json', '{"revision":2,"complete":true}'));}
 finally {IDBObjectStore.prototype.put = originalPut;}
 assert.deepEqual(JSON.parse(await adapter.read('drafts/snapshot-a.json')), {revision: 1, complete: true});
});

test('递归删除在同一事务清理子项并保护相邻目录', async t => {
 const {adapter} = setup(t); await adapter.mkdir('drafts'); await adapter.mkdir('drafts/one'); await adapter.mkdir('drafts/one-more');
 await adapter.write('drafts/one/a', 'a'); await adapter.write('drafts/one-more/b', 'b');
 await assert.rejects(adapter.rmdir('drafts/one', false), /非空/);
 await assert.rejects(adapter.remove('drafts/one'), /目录/);
 await adapter.rmdir('drafts/one', true);
 assert.equal(await adapter.exists('drafts/one/a'), false); assert.equal(await adapter.exists('drafts/one'), false);
 assert.equal(await adapter.read('drafts/one-more/b'), 'b');
 await adapter.remove('drafts/one-more/b'); await adapter.rmdir('drafts/one-more');
 assert.deepEqual(await adapter.list('drafts'), {files: [], folders: []});
});

test('非法路径与缺失IndexedDB明确报错，不使用Node或vault后备存储', async t => {
 const {adapter} = setup(t);
 for (const value of ['../escape', '/absolute', 'drafts/../escape', 'drafts\\escape']) await assert.rejects(adapter.write(value, 'x'), /路径/);
 const missing = new DeviceDraftAdapter('no-backend', {indexedDB: null});
 await assert.rejects(missing.write('x', 'x'), /IndexedDB/); await missing.close();
 await adapter.close(); await assert.rejects(adapter.exists(''), /关闭/);
});


test('跨窗口或vm产生的ArrayBuffer仍保留原始字节', async t => {
 const {adapter} = setup(t); const bytes = vm.runInNewContext('new Uint8Array([0, 128, 255]).buffer');
 await adapter.writeBinary('cross-window.bin', bytes);
 assert.deepEqual([...new Uint8Array(await adapter.readBinary('cross-window.bin'))], [0, 128, 255]);
});
