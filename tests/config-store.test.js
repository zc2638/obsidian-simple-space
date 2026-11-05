import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkspaceStore } from '../src/core/config-store.js';
import { createWorkspace } from '../src/core/model.js';

function environment(files = new Map()) {
  const device = { data: null, checkpoint: null, checkpointWrites: 0, dataWrites: 0, failLoad: false, failCheckpoint: false, failSave: false, failWrite: false, backups: [], writes: [] };
  const io = {
    async loadData() { if (device.failLoad) throw Error('malformed JSON'); return structuredClone(device.data); },
    async saveData(data) { if (device.failSave) throw Error('save failed'); device.dataWrites++; device.data = structuredClone(data); },
    async loadCheckpoint() { return structuredClone(device.checkpoint); },
    async saveCheckpoint(record) { if (device.failCheckpoint) throw Error('checkpoint failed'); device.checkpointWrites++; device.checkpoint = structuredClone(record); },
    async exists(path) { return files.has(path); },
    async read(path) { const value = files.get(path); if (typeof value !== 'string') throw Error('not a file'); return value; },
    async write(path, text) { if (device.failWrite) throw Error('write failed'); if (files.has(path) && typeof files.get(path) !== 'string') throw Error('not a file'); device.writes.push(path); files.set(path, text); },
    async mkdir(path) { if (files.has(path) && files.get(path) !== null) throw Error('not a directory'); files.set(path, null); },
    async backup(record) { device.backups.push(structuredClone(record)); }
  };
  return { files, device, io };
}
const title = store => store.document.cards[0].title;
const setTitle = name => doc => { doc.cards[0].title = name; };

test('first initialization persists defaults, stable vault id and independent getters', async () => {
  const env = environment(); const store = new WorkspaceStore(env.io); await store.init();
  assert.deepEqual(store.settings, { mode: 'folder', folder: 'Simple Space', openOnStartup: false });
  assert.equal(env.files.get('Simple Space'), null);
  assert.deepEqual(JSON.parse(env.files.get('Simple Space/workspace.json')), store.document);
  assert.equal(env.device.data.format, 'simple-space');
  assert.deepEqual(env.device.data.workspace, store.document);
  const id = store.vaultId; const view = store.document; view.cards.length = 0;
  assert.equal(store.document.cards.length, 6);
  const reopened = new WorkspaceStore(env.io); await reopened.init(); assert.equal(reopened.vaultId, id);
  assert.deepEqual(JSON.parse(store.export()), reopened.document);
});

test('new installations create the default folder source before saving its locator and cache', async () => {
  for (const data of [null, {}]) {
    const env = environment(); env.device.data = data;
    const saveData = env.io.saveData;
    env.io.saveData = async record => {
      assert.equal(env.files.get('Simple Space'), null);
      assert.deepEqual(JSON.parse(env.files.get('Simple Space/workspace.json')), record.workspace);
      assert.deepEqual(record.settings, { mode: 'folder', folder: 'Simple Space', openOnStartup: false });
      await saveData(record);
    };
    const store = new WorkspaceStore(env.io); await store.init();
    assert.equal(env.device.dataWrites, 1); assert.deepEqual(env.device.writes, ['Simple Space/workspace.json']);
    await store.update(setTitle('default folder edit'));
    assert.equal(JSON.parse(env.files.get('Simple Space/workspace.json')).cards[0].title, 'default folder edit');
  }
});

test('new installations adopt an existing default workspace without rewriting it', async () => {
  const env = environment(); const existing = createWorkspace(); existing.cards[0].title = 'already synced';
  const text = JSON.stringify(existing, null, 8);
  env.files.set('Simple Space', null); env.files.set('Simple Space/workspace.json', text);
  const store = new WorkspaceStore(env.io); await store.init();
  assert.equal(title(store), 'already synced'); assert.equal(store.settings.mode, 'folder');
  assert.equal(env.files.get('Simple Space/workspace.json'), text); assert.deepEqual(env.device.writes, []);
  assert.deepEqual(env.device.data.workspace, existing);
});

test('default initialization preserves empty, damaged, unsupported and directory-shaped targets', async () => {
  for (const target of ['', '  ', '{broken', JSON.stringify({ ...createWorkspace(), version: 999 }), null]) {
    const env = environment(); env.device.data = {};
    env.files.set('Simple Space', null); env.files.set('Simple Space/workspace.json', target);
    const store = new WorkspaceStore(env.io);
    await assert.rejects(store.init());
    assert.equal(env.files.get('Simple Space/workspace.json'), target);
    assert.deepEqual(env.device.data, {}); assert.equal(env.device.dataWrites, 0);
    assert.equal(env.device.checkpoint, null); assert.equal(store.document, null); assert.deepEqual(env.device.writes, []);
  }
});

test('default initialization does not replace a file occupying its parent folder', async () => {
  const env = environment(); env.files.set('Simple Space', 'keep this note');
  const store = new WorkspaceStore(env.io); await assert.rejects(store.init());
  assert.equal(env.files.get('Simple Space'), 'keep this note'); assert.equal(env.files.has('Simple Space/workspace.json'), false);
  assert.equal(env.device.data, null); assert.equal(env.device.checkpoint, null);
});

test('default initialization leaves plugin data untouched on directory, file or cache write failures and can retry', async () => {
  for (const stage of ['mkdir', 'write', 'cache']) {
    const env = environment(); env.device.data = {};
    const mkdir = env.io.mkdir;
    if (stage === 'mkdir') env.io.mkdir = async () => { throw Error('mkdir failed'); };
    if (stage === 'write') env.device.failWrite = true;
    if (stage === 'cache') env.device.failSave = true;
    const store = new WorkspaceStore(env.io); await assert.rejects(store.init());
    assert.deepEqual(env.device.data, {}, stage); assert.equal(env.device.checkpoint, null, stage); assert.equal(store.document, null, stage);
    const created = env.files.get('Simple Space/workspace.json');
    if (stage === 'cache') assert.equal(typeof created, 'string');
    else assert.equal(created, undefined);
    const writes = env.device.writes.length;
    env.io.mkdir = mkdir; env.device.failWrite = false; env.device.failSave = false;
    const retry = stage === 'cache' ? new WorkspaceStore(env.io) : store;
    await retry.init(); assert.equal(retry.settings.folder, 'Simple Space');
    if (stage === 'cache') { assert.equal(env.files.get('Simple Space/workspace.json'), created); assert.equal(env.device.writes.length, writes); }
  }
});

test('default initialization rechecks the target after creating its parent folder', async () => {
  for (const target of ['valid', 'damaged']) {
    const env = environment(); const existing = createWorkspace(); existing.cards[0].title = 'arrived during mkdir';
    const text = target === 'valid' ? JSON.stringify(existing) : '{keep broken';
    const mkdir = env.io.mkdir;
    env.io.mkdir = async path => { await mkdir(path); env.files.set('Simple Space/workspace.json', text); };
    const store = new WorkspaceStore(env.io);
    if (target === 'valid') { await store.init(); assert.equal(title(store), 'arrived during mkdir'); }
    else { await assert.rejects(store.init()); assert.equal(env.device.data, null); }
    assert.equal(env.files.get('Simple Space/workspace.json'), text); assert.deepEqual(env.device.writes, []);
  }
});

test('existing explicit plugin and folder sources remain in place and legacy settings keep plugin defaults', async () => {
  for (const savedSettings of [{ mode: 'plugin', folder: '.', openOnStartup: true }, { mode: 'folder', folder: 'Existing', openOnStartup: false }, {}]) {
    const env = environment(); const existing = createWorkspace(); existing.cards[0].title = 'existing installation';
    env.device.data = { format: 'simple-space', vaultId: 'existing-vault', settings: savedSettings, workspace: existing, conflict: null };
    if (savedSettings.mode === 'folder') { env.files.set('Existing', null); env.files.set('Existing/workspace.json', JSON.stringify(existing)); }
    const data = structuredClone(env.device.data); const store = new WorkspaceStore(env.io); await store.init();
    assert.equal(title(store), 'existing installation'); assert.equal(store.vaultId, 'existing-vault');
    assert.deepEqual(store.settings, Object.keys(savedSettings).length ? savedSettings : { mode: 'plugin', folder: '.', openOnStartup: false });
    assert.deepEqual(env.device.data, data); assert.equal(env.files.has('Simple Space'), false); assert.deepEqual(env.device.writes, []);
  }
});

test('an empty plugin state initializes defaults while malformed nonempty data is preserved', async () => {
  const env = environment(); env.device.data = {};
  const store = new WorkspaceStore(env.io); await store.init(); assert.equal(store.document.cards.length, 6);
  env.device.data = { unexpected: true }; env.device.checkpoint = null; const broken = new WorkspaceStore(env.io);
  await assert.rejects(broken.init()); assert.deepEqual(env.device.data, { unexpected: true });
});

test('queued updates compose and failed plugin saves retain the prior configuration', async () => {
  const env = environment(); const store = new WorkspaceStore(env.io); await store.init();
  await store.switchStorage({ mode: 'plugin', folder: '.' });
  await Promise.all([store.update(d => { d.cards[0].w = 10; }), store.update(d => { d.cards[0].h = 6; })]);
  assert.equal(store.document.cards[0].w, 10); assert.equal(store.document.cards[0].h, 6);
  const before = store.export(); env.device.failSave = true;
  await assert.rejects(store.update(setTitle('lost'))); assert.equal(store.export(), before);
  env.device.failSave = false; await store.update(setTitle('saved')); assert.equal(title(store), 'saved');
});

test('explicit root folder switching initializes once and switching back migrates current layout', async () => {
  const env = environment(); const store = new WorkspaceStore(env.io); await store.init();
  await store.switchStorage({ mode: 'folder', folder: '.' });
  assert.ok(env.files.has('workspace.json')); assert.equal(store.settings.folder, '.');
  await store.update(setTitle('root layout'));
  const reopened = new WorkspaceStore(env.io); await reopened.init(); assert.equal(title(reopened), 'root layout');
  await store.switchStorage({ mode: 'plugin' }); assert.equal(title(store), 'root layout');
  assert.equal(env.device.data.workspace.cards[0].title, 'root layout'); assert.ok(env.files.has('workspace.json'));
});

test('switching adopts existing valid files and refuses damaged files or file-shaped folders without changing settings', async () => {
  const env = environment(); const store = new WorkspaceStore(env.io); await store.init();
  const other = createWorkspace(); other.cards[0].title = 'shared'; env.files.set('Shared', null); env.files.set('Shared/workspace.json', JSON.stringify(other));
  await store.switchStorage({ mode: 'folder', folder: 'Shared' }); assert.equal(title(store), 'shared');
  const settings = store.settings;
  for (const text of ['{bad', JSON.stringify({ ...other, version: 999 })]) {
    env.files.set('Bad', null); env.files.set('Bad/workspace.json', text);
    await assert.rejects(store.switchStorage({ mode: 'folder', folder: 'Bad' })); assert.deepEqual(store.settings, settings);
    assert.equal(env.files.get('Bad/workspace.json'), text);
  }
  env.files.set('File', 'content'); await assert.rejects(store.switchStorage({ mode: 'folder', folder: 'File' })); assert.deepEqual(store.settings, settings);
  env.files.set('Empty', null); env.files.set('Empty/workspace.json', ''); await store.switchStorage({ mode: 'folder', folder: 'Empty' }); assert.equal(title(store), 'shared');
});

test('failed storage transitions and file writes leave the original mode and document usable', async () => {
  const env = environment(); const store = new WorkspaceStore(env.io); await store.init(); await store.switchStorage({ mode: 'plugin', folder: '.' }); const original = store.export();
  env.device.failSave = true; await assert.rejects(store.switchStorage({ mode: 'folder', folder: 'New' }));
  assert.equal(store.settings.mode, 'plugin'); assert.equal(store.export(), original);
  env.device.failSave = false; await store.switchStorage({ mode: 'folder', folder: 'New' });
  env.device.failWrite = true; await assert.rejects(store.update(setTitle('lost'))); assert.equal(store.export(), original);
});

test('two devices detect concurrent edits, back up both previews and protect a third remote revision', async () => {
  const files = new Map(); const a = environment(files); const b = environment(files);
  const first = new WorkspaceStore(a.io); const second = new WorkspaceStore(b.io);
  await first.init(); await first.switchStorage({ mode: 'folder', folder: 'Shared' });
  await second.init(); await second.switchStorage({ mode: 'folder', folder: 'Shared' });
  await first.update(setTitle('first'));
  await assert.rejects(second.update(setTitle('second')));
  assert.equal(second.conflict.local.cards[0].title, 'second'); assert.equal(second.conflict.remote.cards[0].title, 'first');
  assert.equal(b.device.backups.length, 1); assert.equal(JSON.parse(files.get('Shared/workspace.json')).cards[0].title, 'first');
  await assert.rejects(second.update(setTitle('blocked')));
  await first.update(setTitle('third'));
  await assert.rejects(second.resolveConflict('local'));
  assert.equal(second.conflict.remote.cards[0].title, 'third');
  await second.resolveConflict('local'); assert.equal(title(second), 'second'); assert.equal(second.conflict, null);
  await first.externalChange(); assert.equal(title(first), 'second');
});

test('external malformed or missing files retain last valid document and never regenerate files', async () => {
  const env = environment(); const changes = []; const errors = [];
  const store = new WorkspaceStore(env.io, { onChange: d => changes.push(d), onError: e => errors.push(e) }); await store.init();
  await store.switchStorage({ mode: 'folder', folder: 'Sync' });
  const remote = store.document; remote.cards[0].title = 'remote'; remote.history = [remote.revision]; remote.revision = 'remote-revision'; env.files.set('Sync/workspace.json', JSON.stringify(remote));
  await store.externalChange(); assert.equal(title(store), 'remote');
  const writes = env.device.writes.length;
  env.files.set('Sync/workspace.json', '{bad'); await store.externalChange(); assert.equal(title(store), 'remote');
  env.files.delete('Sync/workspace.json'); await store.externalChange(); assert.equal(title(store), 'remote');
  assert.equal(env.device.writes.length, writes); assert.ok(errors.length >= 2); assert.ok(changes.length >= 2);
  const reopened = new WorkspaceStore(env.io, { onError: () => {} }); await reopened.init(); assert.ok(reopened.document.cards.length); assert.equal(env.files.has('Sync/workspace.json'), false);
});

test('format-only remote changes do not conflict, import validates and settings remain device local', async () => {
  const env = environment(); const store = new WorkspaceStore(env.io); await store.init(); await store.switchStorage({ mode: 'folder', folder: '.' });
  const remote = store.document; env.files.set('workspace.json', JSON.stringify(remote, null, 8));
  await store.update(setTitle('edited')); assert.equal(store.conflict, null);
  await store.updateSettings({ openOnStartup: true });
  const imported = createWorkspace(); const rev = imported.revision; await store.replace(imported);
  assert.notEqual(store.document.revision, rev); assert.equal(store.settings.openOnStartup, true);
  await assert.rejects(store.replace({ ...imported, settings: {} }));
  await assert.rejects(store.updateSettings(JSON.parse('{"__proto__":{}}')));
});

test('remote resolution adopts the remote preview and refuses to overwrite unreadable remotes', async () => {
  const env = environment(); const store = new WorkspaceStore(env.io); await store.init(); await store.switchStorage({ mode: 'folder', folder: '.' });
  const remote = store.document; remote.cards[0].title = 'remote'; env.files.set('workspace.json', JSON.stringify(remote));
  await assert.rejects(store.update(setTitle('local')));
  env.files.set('workspace.json', '{bad'); await assert.rejects(store.resolveConflict('local')); assert.ok(store.conflict);
  env.files.set('workspace.json', JSON.stringify(remote)); await store.resolveConflict('remote'); assert.equal(title(store), 'remote');
});

test('folder edits cache latest valid layout and rollback remote if caching fails', async () => {
  const env = environment(); const store = new WorkspaceStore(env.io); await store.init(); await store.switchStorage({ mode: 'folder', folder: '.' });
  await store.update(setTitle('last saved')); const text = env.files.get('workspace.json');
  env.device.failSave = true; await assert.rejects(store.update(setTitle('must roll back')));
  assert.equal(title(store), 'last saved'); assert.equal(env.files.get('workspace.json'), text);
  env.device.failSave = false; env.files.delete('workspace.json');
  const reopened = new WorkspaceStore(env.io); await reopened.init(); assert.equal(title(reopened), 'last saved');
});

test('unresolved conflicts survive reopening and continue to block ordinary writes', async () => {
  const env = environment(); const store = new WorkspaceStore(env.io); await store.init(); await store.switchStorage({ mode: 'folder', folder: '.' });
  const remote = store.document; remote.cards[0].title = 'remote'; env.files.set('workspace.json', JSON.stringify(remote));
  await assert.rejects(store.update(setTitle('local')));
  const reopened = new WorkspaceStore(env.io); await reopened.init(); assert.equal(reopened.conflict.local.cards[0].title, 'local');
  await assert.rejects(reopened.update(setTitle('blocked')));
  await reopened.resolveConflict('remote');
  const final = new WorkspaceStore(env.io); await final.init(); assert.equal(final.conflict, null); assert.equal(title(final), 'remote');
});

test('simultaneous devices preserve the losing write in a conflict backup', async () => {
  const files = new Map(); const a = environment(files); const b = environment(files);
  const first = new WorkspaceStore(a.io); const second = new WorkspaceStore(b.io);
  await first.init(); await first.switchStorage({ mode: 'folder', folder: '.' });
  await second.init(); await second.switchStorage({ mode: 'folder', folder: '.' });
  const results = await Promise.allSettled([first.update(setTitle('A')), second.update(setTitle('B'))]);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  const loser = first.conflict ? first : second;
  const backup = first.conflict ? a.device.backups : b.device.backups;
  assert.ok(backup.length > 0); assert.ok(loser.conflict.local); assert.ok(loser.conflict.remote);
  assert.notEqual(loser.conflict.local.cards[0].title, loser.conflict.remote.cards[0].title);
});

test('plugin conflicts preserve the remote layout and settings writes detect remote edits', async () => {
  const env = environment(); const first = new WorkspaceStore(env.io); await first.init();
  await first.switchStorage({ mode: 'plugin', folder: '.' });
  const second = new WorkspaceStore(env.io); await second.init(); await first.update(setTitle('remote'));
  await assert.rejects(second.updateSettings({ openOnStartup: true }));
  assert.equal(env.device.data.workspace.cards[0].title, 'remote');
  assert.ok(second.conflict); await second.resolveConflict('remote'); assert.equal(title(second), 'remote');
});

test('external plugin metadata changes switch sources transactionally and adopt vault identity', async () => {
  const env = environment(); const store = new WorkspaceStore(env.io); await store.init();
  await store.switchStorage({ mode: 'plugin', folder: '.' });
  const remote = createWorkspace(); remote.cards[0].title = 'another source';
  env.files.set('Remote', null); env.files.set('Remote/workspace.json', JSON.stringify(remote));
  env.device.data.settings = { mode: 'folder', folder: 'Remote', openOnStartup: true };
  env.device.data.vaultId = 'synced-vault-id';
  await store.externalChange(); assert.equal(title(store), 'another source'); assert.equal(store.settings.folder, 'Remote'); assert.equal(store.vaultId, 'synced-vault-id');
  env.device.data.settings = { mode: 'folder', folder: 'Missing', openOnStartup: false };
  await store.externalChange(); assert.equal(store.settings.folder, 'Remote'); assert.equal(title(store), 'another source'); assert.equal(env.files.has('Missing/workspace.json'), false);
  await assert.rejects(store.update(setTitle('should not write old source')));
  env.device.data.settings = { mode: 'plugin', folder: '.', openOnStartup: false };
  env.device.data.workspace = createWorkspace(); env.device.data.workspace.cards[0].title = 'plugin source';
  await store.externalChange(); assert.equal(store.settings.mode, 'plugin'); assert.equal(title(store), 'plugin source');
});

test('lineage detects a delayed competing write after both devices report successful saves', async () => {
  const files = new Map(); const a = environment(files); const b = environment(files);
  const first = new WorkspaceStore(a.io); const second = new WorkspaceStore(b.io);
  await first.init(); await first.switchStorage({ mode: 'folder', folder: '.' });
  await second.init(); await second.switchStorage({ mode: 'folder', folder: '.' });
  let release; let reached;
  const blocked = new Promise(resolve => { release = resolve; });
  const atWrite = new Promise(resolve => { reached = resolve; });
  const originalWrite = b.io.write;
  b.io.write = async (...args) => { reached(); await blocked; return originalWrite(...args); };
  const pending = second.update(setTitle('B'));
  await atWrite; await first.update(setTitle('A'));
  const firstSaved = first.document; release(); await pending;
  assert.equal(title(first), 'A'); assert.equal(title(second), 'B');
  await first.externalChange();
  assert.equal(title(first), 'A');
  assert.equal(first.conflict.local.cards[0].title, 'A');
  assert.equal(first.conflict.remote.cards[0].title, 'B');
  assert.equal(a.device.backups.length, 1);
  await first.resolveConflict('local');
  assert.ok(first.document.history.includes(firstSaved.revision));
  assert.ok(first.document.history.includes(second.document.revision));
  await second.externalChange(); assert.equal(title(second), 'A'); assert.equal(second.conflict, null);
});

test('ordered saves propagate automatically and imports retain the current layout ancestry', async () => {
  const files = new Map(); const a = environment(files); const b = environment(files);
  const first = new WorkspaceStore(a.io); const second = new WorkspaceStore(b.io);
  await first.init(); await first.switchStorage({ mode: 'folder', folder: '.' });
  await second.init(); await second.switchStorage({ mode: 'folder', folder: '.' });
  const ancestor = first.document.revision;
  await first.update(setTitle('A')); const firstSaved = first.document.revision;
  assert.ok(first.document.history.includes(ancestor));
  await second.externalChange(); assert.equal(title(second), 'A'); assert.equal(second.conflict, null);
  await second.update(setTitle('B'));
  assert.ok(second.document.history.includes(firstSaved));
  await first.externalChange(); assert.equal(title(first), 'B'); assert.equal(first.conflict, null);
  const beforeImport = first.document.revision;
  await first.replace(createWorkspace()); assert.ok(first.document.history.includes(beforeImport));
});

test('reopening preserves a cached branch when the shared file changed without its revision ancestry', async () => {
  const env = environment(); const store = new WorkspaceStore(env.io); await store.init(); await store.switchStorage({ mode: 'folder', folder: '.' });
  const common = store.document;
  await store.update(setTitle('cached A'));
  const other = structuredClone(common); other.cards[0].title = 'remote B'; other.history = [common.revision]; other.revision = 'other-device-revision';
  env.files.set('workspace.json', JSON.stringify(other));
  const reopened = new WorkspaceStore(env.io); await reopened.init();
  assert.equal(title(reopened), 'cached A'); assert.equal(reopened.conflict.remote.cards[0].title, 'remote B');
  assert.equal(env.device.backups.length, 1);
});

test('a private checkpoint preserves the local branch after sync replaces the entire plugin state', async () => {
  const env = environment(); const store = new WorkspaceStore(env.io); await store.init();
  await store.switchStorage({ mode: 'plugin', folder: '.' });
  const common = store.document;
  await store.update(setTitle('local A'));
  assert.equal(env.device.checkpoint.workspace.cards[0].title, 'local A');
  const remote = structuredClone(common); remote.cards[0].title = 'remote B'; remote.history = [common.revision]; remote.revision = 'remote-branch';
  env.device.data = { ...structuredClone(env.device.data), workspace: remote, conflict: null };
  const reopened = new WorkspaceStore(env.io); await reopened.init();
  assert.equal(title(reopened), 'local A'); assert.equal(reopened.conflict.local.cards[0].title, 'local A'); assert.equal(reopened.conflict.remote.cards[0].title, 'remote B');
});

test('checkpoint errors report failure without rolling back an already committed remote write', async () => {
  const env = environment(); const errors = [];
  const store = new WorkspaceStore(env.io, { onError: cause => errors.push(cause) }); await store.init(); await store.switchStorage({ mode: 'folder', folder: '.' });
  env.device.failCheckpoint = true;
  await store.update(setTitle('committed'));
  assert.equal(title(store), 'committed'); assert.equal(JSON.parse(env.files.get('workspace.json')).cards[0].title, 'committed');
  assert.ok(errors.some(cause => /checkpoint/u.test(cause.message)));
});

test('a private checkpoint from a different source does not block a synced source switch at startup', async () => {
  const env = environment(); const store = new WorkspaceStore(env.io); await store.init(); await store.update(setTitle('previous source'));
  const remote = createWorkspace(); remote.cards[0].title = 'new source'; env.files.set('New', null); env.files.set('New/workspace.json', JSON.stringify(remote));
  env.device.data.settings = { mode: 'folder', folder: 'New', openOnStartup: false };
  const reopened = new WorkspaceStore(env.io); await reopened.init();
  assert.equal(title(reopened), 'new source'); assert.equal(reopened.conflict, null);
});

test('an update waits for the private checkpoint before reporting completion', async () => {
  const env = environment(); const store = new WorkspaceStore(env.io); await store.init();
  let reached; let release; let completed = false;
  const atCheckpoint = new Promise(resolve => { reached = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  const save = env.io.saveCheckpoint;
  env.io.saveCheckpoint = async record => { reached(); await blocked; return save(record); };
  const update = store.update(setTitle('wait for persistence')).then(() => { completed = true; });
  await atCheckpoint; assert.equal(completed, false); release(); await update;
  assert.equal(env.device.checkpoint.workspace.cards[0].title, 'wait for persistence');
});

test('adapters without optional checkpoint hooks retain the basic store API', async () => {
  const env = environment(); delete env.io.loadCheckpoint; delete env.io.saveCheckpoint;
  const store = new WorkspaceStore(env.io); await store.init(); await store.update(setTitle('compatible'));
  assert.equal(title(store), 'compatible');
});

test('missing, empty and damaged plugin data recover private checkpoints without overwriting persisted state', async () => {
  for (const kind of ['missing', 'empty', 'metadata', 'workspace', 'read-error']) {
    const env = environment(); const original = new WorkspaceStore(env.io); await original.init(); await original.switchStorage({ mode: 'plugin', folder: '.' }); await original.update(setTitle('我的已保存布局'));
    const goodData = structuredClone(env.device.data); const checkpoint = structuredClone(env.device.checkpoint);
    if (kind === 'missing') env.device.data = null;
    if (kind === 'empty') env.device.data = {};
    if (kind === 'metadata') env.device.data = { malformed: true };
    if (kind === 'workspace') env.device.data.workspace = { version: 999 };
    if (kind === 'read-error') env.device.failLoad = true;
    const badData = structuredClone(env.device.data); const dataWrites = env.device.dataWrites; const checkpointWrites = env.device.checkpointWrites;
    const errors = []; const recovered = new WorkspaceStore(env.io, { onError: cause => errors.push(cause) });
    await recovered.init();
    assert.equal(title(recovered), '我的已保存布局', kind); assert.equal(recovered.vaultId, original.vaultId, kind);
    assert.deepEqual(env.device.data, badData, kind); assert.deepEqual(env.device.checkpoint, checkpoint, kind);
    assert.equal(env.device.dataWrites, dataWrites, kind); assert.equal(env.device.checkpointWrites, checkpointWrites, kind); assert.ok(errors.length, kind);
    await assert.rejects(recovered.update(setTitle('blocked while unavailable')));
    assert.deepEqual(env.device.checkpoint, checkpoint, kind);
    env.device.failLoad = false; env.device.data = goodData;
    const remote = structuredClone(goodData.workspace); remote.history = [...remote.history, remote.revision]; remote.revision = `restored-${kind}`; remote.cards[0].title = '来源恢复后的同步'; env.device.data.workspace = remote;
    await recovered.externalChange(); assert.equal(title(recovered), '来源恢复后的同步', kind); assert.equal(recovered.conflict, null, kind);
    await recovered.update(setTitle('恢复后可继续保存')); assert.equal(env.device.data.workspace.cards[0].title, '恢复后可继续保存', kind);
  }
});

test('a private default-folder checkpoint prevents rebuilding when plugin data and its shared file disappear', async () => {
  for (const data of [null, {}]) {
    const env = environment(); const original = new WorkspaceStore(env.io); await original.init(); await original.update(setTitle('saved default folder'));
    const checkpoint = structuredClone(env.device.checkpoint); const dataWrites = env.device.dataWrites; const writes = env.device.writes.length;
    env.device.data = data; env.files.delete('Simple Space/workspace.json');
    const recovered = new WorkspaceStore(env.io); await recovered.init();
    assert.equal(recovered.settings.folder, 'Simple Space'); assert.equal(title(recovered), 'saved default folder');
    assert.deepEqual(env.device.data, data); assert.deepEqual(env.device.checkpoint, checkpoint);
    assert.equal(env.device.dataWrites, dataWrites); assert.equal(env.device.writes.length, writes); assert.equal(env.files.has('Simple Space/workspace.json'), false);
    await assert.rejects(recovered.update(setTitle('must remain unavailable')));
    assert.equal(env.files.has('Simple Space/workspace.json'), false);
  }
});

test('users can explicitly switch recovered layouts to a new source while the original source is unavailable', async () => {
  const env = environment(); const original = new WorkspaceStore(env.io); await original.init(); await original.update(setTitle('saved layout'));
  env.device.data = null;
  const recovered = new WorkspaceStore(env.io); await recovered.init();
  await recovered.switchStorage({ mode: 'folder', folder: 'Recovered' });
  assert.equal(recovered.settings.folder, 'Recovered'); assert.equal(title(recovered), 'saved layout'); assert.equal(recovered.vaultId, original.vaultId);
  assert.equal(JSON.parse(env.files.get('Recovered/workspace.json')).cards[0].title, 'saved layout');
});

test('missing folder targets reopen from valid cache without recreating files even without checkpoint hooks', async () => {
  const env = environment(); delete env.io.loadCheckpoint; delete env.io.saveCheckpoint;
  const original = new WorkspaceStore(env.io); await original.init(); await original.switchStorage({ mode: 'folder', folder: 'Sync' }); await original.update(setTitle('folder layout'));
  env.files.delete('Sync/workspace.json'); const writes = env.device.writes.length; const dataWrites = env.device.dataWrites;
  const recovered = new WorkspaceStore(env.io); await recovered.init();
  assert.equal(title(recovered), 'folder layout'); assert.equal(recovered.vaultId, original.vaultId); assert.equal(env.files.has('Sync/workspace.json'), false);
  assert.equal(env.device.writes.length, writes); assert.equal(env.device.dataWrites, dataWrites);
  await assert.rejects(recovered.update(setTitle('blocked'))); assert.equal(env.files.has('Sync/workspace.json'), false);
});

test('pending conflicts follow a synced source change without losing either old branch', async () => {
  for (const choice of ['local', 'remote']) {
    const env = environment(); const store = new WorkspaceStore(env.io); await store.init();
    await store.switchStorage({ mode: 'folder', folder: 'Old' });
    const oldRemote = store.document; oldRemote.cards[0].title = 'old remote'; oldRemote.revision = 'old-remote';
    env.files.set('Old/workspace.json', JSON.stringify(oldRemote));
    await assert.rejects(store.update(setTitle('unsaved local')), { code: 'WORKSPACE_CONFLICT' });
    const oldText = env.files.get('Old/workspace.json');
    const next = createWorkspace(); next.cards[0].title = 'new source';
    env.files.set('New', null); env.files.set('New/workspace.json', JSON.stringify(next));
    env.device.data.settings = { ...env.device.data.settings, mode: 'folder', folder: 'New' };
    await store.externalChange();
    assert.equal(store.settings.folder, 'New');
    assert.equal(store.conflict.local.cards[0].title, 'unsaved local');
    assert.equal(store.conflict.remote.cards[0].title, 'new source');
    assert.equal(store.conflict.path, 'New/workspace.json');
    assert.ok(env.device.backups.some(record => record.remote.cards[0].title === 'old remote'));
    assert.equal(env.files.get('Old/workspace.json'), oldText);
    assert.equal(JSON.parse(env.files.get('New/workspace.json')).cards[0].title, 'new source');
    await store.resolveConflict(choice);
    assert.equal(store.conflict, null);
    assert.equal(title(store), choice === 'local' ? 'unsaved local' : 'new source');
    await store.update(setTitle('normal edits work again'));
    assert.equal(JSON.parse(env.files.get('New/workspace.json')).cards[0].title, 'normal edits work again');
  }
});

test('resolving after an unobserved source change refreshes the preview before applying a choice', async () => {
  for (const choice of ['local', 'remote']) {
    const env = environment(); const store = new WorkspaceStore(env.io); await store.init();
    await store.switchStorage({ mode: 'folder', folder: 'Old' });
    const oldRemote = store.document; oldRemote.cards[0].title = 'old remote';
    env.files.set('Old/workspace.json', JSON.stringify(oldRemote));
    await assert.rejects(store.update(setTitle('local choice')), { code: 'WORKSPACE_CONFLICT' });
    const next = createWorkspace(); next.cards[0].title = 'new plugin source';
    env.device.data.settings = { mode: 'plugin', folder: '.', openOnStartup: false };
    env.device.data.workspace = next;
    await assert.rejects(store.resolveConflict(choice), { code: 'WORKSPACE_CONFLICT' });
    assert.equal(store.settings.mode, 'plugin');
    assert.equal(store.conflict.remote.cards[0].title, 'new plugin source');
    assert.equal(env.device.data.workspace.cards[0].title, 'new plugin source');
    const reopened = new WorkspaceStore(env.io); await reopened.init();
    assert.equal(reopened.conflict.local.cards[0].title, 'local choice');
    await reopened.resolveConflict(choice);
    assert.equal(title(reopened), choice === 'local' ? 'local choice' : 'new plugin source');
  }
});

test('an unavailable new source or failed conflict backup cannot discard the pending conflict', async () => {
  const env = environment(); const errors = []; const store = new WorkspaceStore(env.io, { onError: cause => errors.push(cause) }); await store.init();
  await store.switchStorage({ mode: 'plugin', folder: '.' });
  const oldRemote = store.document; oldRemote.cards[0].title = 'old remote'; env.device.data.workspace = oldRemote;
  await assert.rejects(store.update(setTitle('local branch')), { code: 'WORKSPACE_CONFLICT' });
  const prior = store.conflict;
  env.device.data.settings = { mode: 'folder', folder: 'New', openOnStartup: false };
  await store.externalChange();
  assert.equal(store.settings.mode, 'plugin'); assert.deepEqual(store.conflict, prior); assert.ok(errors.length);
  const next = createWorkspace(); env.files.set('New', null); env.files.set('New/workspace.json', JSON.stringify(next));
  env.io.backup = async () => { throw Error('backup failed'); };
  await store.externalChange();
  assert.equal(store.settings.mode, 'plugin'); assert.deepEqual(store.conflict, prior);
  assert.ok(errors.some(cause => /backup failed/u.test(cause.message)));
  await assert.rejects(store.resolveConflict('local'), /backup failed/u);
  assert.deepEqual(store.conflict, prior);
});

test('another source arriving during conflict backups is preserved and previewed before any write', async () => {
  for (const stage of ['old', 'new']) {
    const env = environment(); const store = new WorkspaceStore(env.io); await store.init();
    await store.switchStorage({ mode: 'plugin', folder: '.' });
    const oldRemote = store.document; oldRemote.cards[0].title = 'old remote'; env.device.data.workspace = oldRemote;
    await assert.rejects(store.update(setTitle('local branch')), { code: 'WORKSPACE_CONFLICT' });
    const next = createWorkspace(); next.cards[0].title = 'intermediate B';
    env.files.set('B', null); env.files.set('B/workspace.json', JSON.stringify(next));
    env.device.data.settings = { mode: 'folder', folder: 'B', openOnStartup: false };
    const latest = createWorkspace(); latest.cards[0].title = 'latest plugin C';
    const backup = env.io.backup; let injected = false;
    env.io.backup = async record => {
      await backup(record);
      if (!injected && (stage === 'old' ? record.path === null : record.path === 'B/workspace.json')) {
        injected = true;
        env.device.data = { ...env.device.data, vaultId: 'new-vault-C', settings: { mode: 'plugin', folder: '.', openOnStartup: true }, workspace: latest, conflict: null };
      }
    };
    await store.externalChange();
    assert.equal(injected, true);
    assert.equal(store.vaultId, 'new-vault-C');
    assert.equal(store.settings.mode, 'plugin'); assert.equal(store.settings.openOnStartup, true);
    assert.equal(store.conflict.local.cards[0].title, 'local branch');
    assert.equal(store.conflict.remote.cards[0].title, 'latest plugin C');
    assert.equal(env.device.data.workspace.cards[0].title, 'latest plugin C');
    assert.ok(env.device.backups.some(record => record.remote.cards[0].title === 'old remote'));
    assert.ok(env.device.backups.some(record => record.remote.cards[0].title === 'latest plugin C'));
    await store.resolveConflict('remote'); assert.equal(title(store), 'latest plugin C');
    assert.equal(store.conflict, null);
  }
});
