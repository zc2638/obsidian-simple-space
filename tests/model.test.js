import test from 'node:test';
import assert from 'node:assert/strict';
import { CARD_DEFINITIONS, createCard, createWorkspace, validateDocument, normalizeDirectory, validateVaultPath, configPath } from '../src/core/model.js';

test('defaults contain six independent, portable cards', () => {
  const first = createWorkspace();
  assert.equal(first.format, 'simple-space');
  assert.equal(first.version, 1);
  assert.deepEqual(first.history, []);
  assert.deepEqual(first.cards.map(({ type, w, h }) => [type, w, h]), [
    ['welcome', 12, 4], ['capture', 6, 5], ['stats', 6, 5], ['links', 12, 4], ['tasks', 7, 6], ['recent', 5, 6]
  ]);
  first.cards[1].config.notePath = 'Changed.md';
  assert.equal(createWorkspace().cards[1].config.notePath, 'Simple Space/即时灵感/灵感.md');
  assert.equal(CARD_DEFINITIONS.capture.defaultConfig.notePath, 'Simple Space/即时灵感/灵感.md');
  assert.deepEqual(['welcome', 'capture', 'links', 'tasks', 'recent', 'stats'].map(type => CARD_DEFINITIONS[type].name), ['欢迎卡片', '即时灵感', '快捷入口', '待办任务', '最近笔记', '统计卡片']);
  assert.equal(new Set(first.cards.map(c => c.id)).size, 6);
});

test('卡片元数据沿用迁移前的图标和强调色', () => {
 assert.deepEqual(Object.fromEntries(Object.entries(CARD_DEFINITIONS).map(([type,{icon,accent}])=>[type,[icon,accent]])),{
  welcome:['sunrise','#6388c9'],capture:['sparkles','#6695d8'],stats:['pie-chart','#d97706'],links:['pin','#0d9488'],tasks:['columns-3','#2563eb'],recent:['history','#2563eb']
 });
});

test('快捷入口保留可选图标且兼容只含标题和地址的旧配置', () => {
 const legacy={title:'笔记',url:'笔记.md'},custom={title:'喜欢',url:'喜欢.md',icon:'heart'};
 const config={columns:2,items:[legacy,custom]};
 assert.deepEqual(createCard('links',{config}).config,config);
 assert.deepEqual(legacy,{title:'笔记',url:'笔记.md'});
 for(const icon of ['',null,12,'Heart','heart icon','<svg onload=alert(1)>','javascript:alert(1)','heart;alert(1)','a'.repeat(101)]) {
  assert.throws(()=>createCard('links',{config:{columns:2,items:[{...legacy,icon}]}}),/图标/u);
 }
});

test('统计默认包含附件并原样保留旧三项选择', () => {
 assert.deepEqual(createCard('stats').config.metrics,['notes','tags','words','attachments']);
 const metrics=['notes','tags','words'];
 assert.deepEqual(createCard('stats',{config:{metrics}}).config.metrics,metrics);
 assert.deepEqual(createCard('stats',{config:{metrics:['attachments']}}).config.metrics,['attachments']);
 assert.throws(()=>createCard('stats',{config:{metrics:['folders']}}),/统计项/u);
});

test('待办任务名称同步更新旧默认标题并保留用户自定义标题和来源',()=>{
 const config={sourceType:'file',source:'旧目录/任务.md',inboxPath:'旧目录/任务.md'};
 assert.equal(createCard('tasks').title,'待办任务');
 const old=createCard('tasks',{title:'待办卡片',config});
 assert.equal(old.title,'待办任务');assert.equal(old.config.inboxPath,'旧目录/任务.md');
 assert.equal(createCard('tasks',{title:'项目待办',config}).title,'项目待办');
});

test('document validation returns copies and rejects malformed or hostile input', () => {
  const input = createWorkspace();
  assert.deepEqual(validateDocument(input), input);
  assert.notEqual(validateDocument(input).cards, input.cards);
  for (const mutate of [
    d => { d.version = 2; }, d => { d.cards[0].type = 'unknown'; },
    d => { d.cards[0].w = 13; }, d => { d.cards[1].config.notePath = '../secrets'; },
    d => { d.cards[0].config.unexpected = true; }, d => { d.extra = true; },
    d => { d.cards[1].id = d.cards[0].id; }, d => { d.cards[4].config.sourceType = 'all'; }
  ]) {
    const invalid = structuredClone(input); mutate(invalid);
    assert.throws(() => validateDocument(invalid));
  }
  assert.throws(() => validateDocument(JSON.parse('{"__proto__":{},"format":"simple-space","version":1,"revision":"x","cards":[]}')));
  assert.throws(() => createCard('__proto__'));
  assert.throws(() => createCard('links', { config: { items: [{ title: 'bad', url: 'javascript:alert(1)' }], columns: 2 } }));
});

test('vault paths allow root explicitly and reject traversal and portable invalid names', () => {
  assert.equal(normalizeDirectory('.'), '.');
  assert.equal(normalizeDirectory('  工作台配置/布局/  '), '工作台配置/布局');
  assert.equal(validateVaultPath('收件箱/灵感.md'), '收件箱/灵感.md');
  assert.equal(configPath('.'), 'workspace.json');
  assert.equal(configPath('配置'), '配置/workspace.json');
  for (const path of ['', '/abs', '../x', 'x/../y', 'C:\\x', 'a\\b', 'a//b', 'a/./b', 'CON', 'folder/NUL.md', 'a:b', 'x.', 'a\u0000b']) {
    assert.throws(() => normalizeDirectory(path), path);
  }
  assert.throws(() => validateVaultPath('.'));
  const normalized = createCard('capture', { config: { notePath: '  收件箱/灵感.md  ', attachmentFolder: '收件箱/附件/' } });
  assert.deepEqual(normalized.config, { notePath: '收件箱/灵感.md', attachmentFolder: '收件箱/附件', saveMode: 'single', noteFolder: '收件箱/灵感', splitBySize: true, maxFileSizeKB: 1024 });
});

test('capture defaults use one storage root and preserve legacy destinations across all five save modes', () => {
  assert.deepEqual(createCard('capture').config, { saveMode: 'single', noteFolder: 'Simple Space/即时灵感', notePath: 'Simple Space/即时灵感/灵感.md', attachmentFolder: 'Simple Space/即时灵感/附件', splitBySize: true, maxFileSizeKB: 1024 });
  for (const saveMode of ['year', 'quarter', 'month', 'day', 'single']) {
    const config = { ...CARD_DEFINITIONS.capture.defaultConfig, saveMode, noteFolder: '  灵感/分卷/  ', notePath: '历史.MD', attachmentFolder: '  附件/  ', splitBySize: false, maxFileSizeKB: 1 };
    assert.deepEqual(createCard('capture', { config }).config, { ...config, noteFolder: '灵感/分卷', attachmentFolder: '附件' });
  }
  assert.equal(createCard('capture', { config: { ...CARD_DEFINITIONS.capture.defaultConfig, noteFolder: '.' } }).config.noteFolder, '.');
});

test('legacy capture configuration gains only new defaults without changing the imported document', () => {
  for (const [notePath, noteFolder] of [['  a/Inbox.md  ', 'a/Inbox'], ['Inbox.MD', 'Inbox'], ['.md', 'Simple Space/即时灵感']]) {
    const input = createWorkspace();
    input.cards[1].config = { notePath, attachmentFolder: '附件/' };
    const original = structuredClone(input);
    assert.deepEqual(validateDocument(input).cards[1].config, { notePath: notePath.trim(), attachmentFolder: '附件', saveMode: 'single', noteFolder, splitBySize: true, maxFileSizeKB: 1024 });
    assert.deepEqual(input, original);
  }
  const partial = { notePath: '旧.md', attachmentFolder: '.', saveMode: 'quarter', noteFolder: '.', splitBySize: false };
  assert.deepEqual(createCard('capture', { config: partial }).config, { ...partial, maxFileSizeKB: 1024 });
  for (const missing of ['notePath', 'attachmentFolder']) {
    const config = { notePath: '旧.md', attachmentFolder: '.' }; delete config[missing];
    assert.throws(() => createCard('capture', { config }), /缺少/u);
  }
});

test('capture validates explicit partition and size options including boundaries and hostile fields', () => {
  for (const maxFileSizeKB of [1, 1048576]) assert.equal(createCard('capture', { config: { ...CARD_DEFINITIONS.capture.defaultConfig, maxFileSizeKB } }).config.maxFileSizeKB, maxFileSizeKB);
  const invalid = {
    saveMode: ['', 'week', null, 1, undefined],
    noteFolder: ['', '../灵感', '/灵感', 'a//b', null, undefined],
    splitBySize: [0, 1, 'true', null, undefined],
    maxFileSizeKB: [0, -1, 1.5, 1048577, '1024', null, undefined]
  };
  for (const [key, values] of Object.entries(invalid)) for (const value of values) {
    assert.throws(() => createCard('capture', { config: { ...CARD_DEFINITIONS.capture.defaultConfig, [key]: value } }), `${key}: ${String(value)}`);
  }
  assert.throws(() => createCard('capture', { config: { notePath: '旧.txt', attachmentFolder: '.' } }), /\.md/u);
  assert.throws(() => createCard('capture', { config: { notePath: '旧.md', attachmentFolder: '../附件' } }));
  for (const extra of ['unknown', '__proto__', 'constructor', 'prototype']) {
    const config = { ...CARD_DEFINITIONS.capture.defaultConfig, [extra]: {} };
    assert.throws(() => createCard('capture', { config }));
  }
});

test('待办进行中显示默认开启，旧配置兼容补齐，显式关闭保留且拒绝非布尔值', () => {
  assert.equal(createCard('tasks').config.showDoing, true);
  const old = { ...CARD_DEFINITIONS.tasks.defaultConfig }; delete old.showDoing;
  assert.equal(createCard('tasks', { config: old }).config.showDoing, true);
  assert.equal(createCard('tasks', { config: { ...old, showDoing: false } }).config.showDoing, false);
  for (const showDoing of [0, 1, 'false', null, undefined]) assert.throws(() => createCard('tasks', { config: { ...old, showDoing } }));
});

test('待办默认单文件按保存目录收集，旧三字段配置仅补新增默认且保留旧来源', () => {
  assert.deepEqual(createCard('tasks').config, { sourceType: 'folder', source: 'Simple Space/待办任务', inboxPath: 'Simple Space/待办任务/待办任务.md', noteFolder: 'Simple Space/待办任务', saveMode: 'single', splitBySize: true, maxFileSizeKB: 1024, showDoing: true });
  for (const [inboxPath, noteFolder] of [['  旧目录/我的待办.MD  ', '旧目录'], ['旧待办.md', '.']]) {
    const config = { sourceType: 'file', source: '另一来源.md', inboxPath };
    const document = createWorkspace(); document.cards[4].config = config;
    const original = structuredClone(document);
    assert.deepEqual(validateDocument(document).cards[4].config, { ...config, inboxPath: inboxPath.trim(), noteFolder, saveMode: 'single', splitBySize: true, maxFileSizeKB: 1024, showDoing: true });
    assert.deepEqual(document, original);
  }
  const partial = { sourceType: 'folder', source: '旧来源', inboxPath: 'Inbox.md', noteFolder: '.', saveMode: 'quarter', splitBySize: false };
  assert.deepEqual(createCard('tasks', { config: partial }).config, { ...partial, maxFileSizeKB: 1024, showDoing: true });
  for (const missing of ['sourceType', 'source', 'inboxPath']) {
    const config = { sourceType: 'file', source: '旧.md', inboxPath: '旧.md' }; delete config[missing];
    assert.throws(() => createCard('tasks', { config }), /缺少/u);
  }
});

test('待办验证五种保存方式、目录和大小续卷选项并拒绝未知字段', () => {
  for (const saveMode of ['year', 'quarter', 'month', 'day', 'single']) {
    const config = { ...CARD_DEFINITIONS.tasks.defaultConfig, saveMode, noteFolder: '  任务/分卷/  ', maxFileSizeKB: 1, splitBySize: false };
    assert.deepEqual(createCard('tasks', { config }).config, { ...config, noteFolder: '任务/分卷' });
  }
  assert.equal(createCard('tasks', { config: { ...CARD_DEFINITIONS.tasks.defaultConfig, maxFileSizeKB: 1048576 } }).config.maxFileSizeKB, 1048576);
  const invalid = { saveMode: ['', 'week', null, 1, undefined], noteFolder: ['', '../任务', '/任务', 'a//b', null, undefined], splitBySize: [0, 1, 'true', null, undefined], maxFileSizeKB: [0, -1, 1.5, 1048577, '1024', null, undefined] };
  for (const [key, values] of Object.entries(invalid)) for (const value of values) assert.throws(() => createCard('tasks', { config: { ...CARD_DEFINITIONS.tasks.defaultConfig, [key]: value } }), `${key}: ${String(value)}`);
  for (const extra of ['unknown', '__proto__', 'constructor', 'prototype']) assert.throws(() => createCard('tasks', { config: { ...CARD_DEFINITIONS.tasks.defaultConfig, [extra]: {} } }));
});

test('documents cannot exceed the reader size budget through many individually valid fields', () => {
  const document = createWorkspace();
  document.cards = Array.from({ length: 25 }, (_, index) => createCard('welcome', {
    id: `large-${index}`, config: { ...CARD_DEFINITIONS.welcome.defaultConfig, quotes: Array(50).fill('字'.repeat(2000)) }
  }));
  assert.throws(() => validateDocument(document), /过大/u);
});

test('revision histories accept legacy documents and enforce a bounded list of revision strings', () => {
  const document = createWorkspace(); delete document.history;
  assert.deepEqual(validateDocument(document).history, []);
  for (const history of [null, 'old', Array(129).fill('old'), [''], [42]]) {
    assert.throws(() => validateDocument({ ...document, history }));
  }
  const valid = validateDocument({ ...document, history: ['ancestor'] });
  assert.deepEqual(valid.history, ['ancestor']);
});

test('note destinations and file sources require Markdown paths before settings can be saved or imported', () => {
  const fields = [['capture', 'notePath'], ['tasks', 'source'], ['tasks', 'inboxPath'], ['welcome', 'source']];
  for (const [type, field] of fields) {
    for (const path of ['workspace.json', 'README', 'notes/file.txt', 'notes/file.md.json']) {
      const card = createCard(type); if (type === 'tasks' && field === 'source') card.config.sourceType = 'file'; card.config[field] = path;
      assert.throws(() => createCard(type, { config: card.config }), /\.md/u, `${type}.${field}: ${path}`);
      const document = createWorkspace(); document.cards = [card];
      assert.throws(() => validateDocument(document), /\.md/u);
    }
    const config = { ...CARD_DEFINITIONS[type].defaultConfig, ...(type === 'tasks' && field === 'source' ? { sourceType: 'file' } : {}), [field]: '  notes/NOTE.MD  ' };
    assert.equal(createCard(type, { config }).config[field], 'notes/NOTE.MD');
  }
  assert.equal(createCard('welcome').config.source, '');
  assert.equal(createCard('welcome', { config: { ...CARD_DEFINITIONS.welcome.defaultConfig, dailyTemplate: 'Templates/Daily' } }).config.dailyTemplate, 'Templates/Daily');
  assert.equal(createCard('tasks', { config: { ...CARD_DEFINITIONS.tasks.defaultConfig, sourceType: 'folder', source: 'Projects' } }).config.source, 'Projects');
});
