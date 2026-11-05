import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Window} from 'happy-dom';
import {createCard} from '../src/core/model.js';

async function fixture(t, entry = 'src/modals.js') {
 const window = new Window(), document = window.document;
 const proto = window.HTMLElement.prototype;
 proto.createEl = function(tag, options = {}) { const el = document.createElement(tag); if (options.text !== undefined) el.textContent = options.text; if (options.cls) el.className = options.cls; for (const [k,v] of Object.entries(options.attr || {})) el.setAttribute(k,v); this.append(el); return el; };
 proto.createDiv = function(options) { return this.createEl('div', options); };
 proto.empty = function() { this.replaceChildren(); };
 class Modal { constructor(app) { this.app = app; this.containerEl=document.body.createDiv(); this.modalEl=this.containerEl.createDiv(); this.contentEl = this.modalEl.createDiv(); } setTitle(value) { this.title = value; return this; } open() { this.onOpen?.(); } close() { this.closed = true; this.containerEl.remove(); this.onClose?.(); } }
 class FuzzySuggestModal extends Modal { setPlaceholder() {} }
 class PluginSettingTab { constructor(app, plugin) { this.app = app; this.plugin = plugin; this.containerEl = document.body.createDiv(); } }
 class Setting {
  constructor(body) { this.el = body.createDiv(); } setName(text) { this.el.createEl('span', {text}); return this; } setDesc(text) { this.el.createEl('span', {text}); return this; }
  control(tag, cb, type) { const el = this.el.createEl(tag); if(type) el.type=type; const api = {inputEl:el,selectEl:el,toggleEl:el,buttonEl:el,setValue(v){if(type==='checkbox') el.checked=v; else el.value=v; return api;},setPlaceholder(v){el.placeholder=v;return api;},setButtonText(v){el.textContent=v;return api;},setCta(){return api;},setDisabled(v){el.disabled=v;return api;},addOption(v,text){el.createEl('option',{text,attr:{value:v}});return api;},onChange(fn){el.addEventListener(type==='checkbox'||tag==='select'?'change':'input',()=>fn(type==='checkbox'?el.checked:el.value));return api;},onClick(fn){el.onclick=fn;return api;}}; cb(api); return this; }
  addText(cb){return this.control('input',cb,'text');} addDropdown(cb){return this.control('select',cb);} addToggle(cb){return this.control('input',cb,'checkbox');} addButton(cb){return this.control('button',cb);}
 }
 const notices=[], files=new Map();
 const app={vault:{getAbstractFileByPath:path=>files.get(path),getAllLoadedFiles:()=>[...files.values()],createFolder:async path=>{files.set(path,{path,children:[]});},create:async(path,content)=>{if(files.has(path)) throw Error('文件已存在');files.set(path,{path,content});}}};
 const plugin={store:{settings:{mode:'plugin',folder:'.',openOnStartup:false},document:{cards:[]},export:()=>JSON.stringify(workspace()),updateSettings:async value=>Object.assign(plugin.store.settings,value)},showError:error=>notices.push(error.message),importConfig:async value=>{plugin.imported=value;return true;},saveCard:async value=>{plugin.saved=value;return true;},removeCard:async()=>true,changeStorage:async value=>{plugin.storage=value;Object.assign(plugin.store.settings,value);return true;},resolveConflict:async value=>{plugin.choice=value;return true;},discoverConfigurations:async value=>{plugin.discovered=value;}};
 const result=await build({entryPoints:[entry],bundle:true,write:false,format:'cjs',platform:'node',external:['obsidian']});
 const module={exports:{}};
 Function('module','exports','require',result.outputFiles[0].text)(module,module.exports,()=>({Modal,FuzzySuggestModal,PluginSettingTab,Setting,Notice:class {constructor(message){notices.push(message);}}}));
 t.after(()=>window.happyDOM.close());
 return {window,document,app,plugin,files,notices,...module.exports};
}
function workspace(){return {format:'simple-space',version:1,revision:'test',cards:[createCard('links',{id:'links-1',title:'我的入口'})]};}
const button=(el,text)=>[...el.querySelectorAll('button')].find(item=>item.textContent===text);
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function input(f,el,label,value){const control=el.querySelector(`[aria-label="${label}"]`);assert.ok(control,label);control.value=value;control.dispatchEvent(new f.window.Event(control.tagName==='SELECT'?'change':'input'));return control;}

test('导入先显示验证预览，明确确认后才替换配置',async t=>{
 const f=await fixture(t),modal=new f.ImportModal(f.app,f.plugin);modal.open();
 input(f,modal.contentEl,'配置 JSON',JSON.stringify(workspace()));
 button(modal.contentEl,'预览配置').click();await flush();
 assert.equal(f.plugin.imported,undefined);assert.match(modal.contentEl.textContent,/我的入口/);assert.match(modal.contentEl.textContent,/12.*4/);
 button(modal.contentEl,'确认导入并替换布局').click();await flush();
 assert.equal(f.plugin.imported.cards[0].title,'我的入口');assert.equal(modal.closed,true);
});

test('卡片使用可视化类型表单，验证失败保留输入，切换类型重置专属配置',async t=>{
 const f=await fixture(t),modal=new f.CardSettingsModal(f.app,f.plugin,createCard('capture',{id:'capture-1'}));modal.open();
 input(f,modal.contentEl,'卡片标题','保留我的标题');input(f,modal.contentEl,'保存目录','../bad');
 button(modal.contentEl,'保存卡片').click();await flush();
 assert.equal(f.plugin.saved,undefined);assert.equal(modal.closed,undefined);assert.match(modal.contentEl.textContent,/路径/);
 assert.equal(modal.contentEl.querySelector('[aria-label="卡片标题"]').value,'保留我的标题');
 input(f,modal.contentEl,'卡片类型','stats');
 button(modal.contentEl,'保存卡片').click();await flush();
 assert.deepEqual(f.plugin.saved.config,{metrics:['notes','tags','words','attachments']});assert.equal(f.plugin.saved.title,'保留我的标题');assert.equal(modal.closed,true);
});

test('待办设置可关闭进行中状态且切换保存方式后仍保留开关',async t=>{
 const f=await fixture(t),modal=new f.CardSettingsModal(f.app,f.plugin,createCard('tasks'));modal.open();
 const toggle=modal.contentEl.querySelector('[aria-label="显示进行中状态"]');assert.ok(toggle);assert.equal(toggle.checked,true);
 toggle.checked=false;toggle.dispatchEvent(new f.window.Event('change'));
 input(f,modal.contentEl,'保存方式','month');
 assert.equal(modal.contentEl.querySelector('[aria-label="显示进行中状态"]').checked,false);
 button(modal.contentEl,'保存卡片').click();await flush();assert.equal(f.plugin.saved.config.showDoing,false);
});

test('统计设置可以切换附件数量且保留旧统计选择',async t=>{
 const f=await fixture(t),modal=new f.CardSettingsModal(f.app,f.plugin,createCard('stats',{config:{metrics:['notes','tags','words']}}));modal.open();
 const toggle=modal.contentEl.querySelector('[aria-label="显示附件数量"]');assert.ok(toggle);assert.equal(toggle.checked,false);
 toggle.checked=true;toggle.dispatchEvent(new f.window.Event('change'));
 button(modal.contentEl,'保存卡片').click();await flush();assert.deepEqual(f.plugin.saved.config.metrics,['notes','tags','words','attachments']);
});

test('编辑快捷入口标题和地址时保留已有图标',async t=>{
 const f=await fixture(t),modal=new f.CardSettingsModal(f.app,f.plugin,createCard('links',{config:{columns:2,items:[{title:'喜欢',url:'喜欢.md',icon:'heart'}]}}));modal.open();
 input(f,modal.contentEl,'链接 1 标题','新的喜欢');input(f,modal.contentEl,'链接 1 地址','新笔记.md');
 button(modal.contentEl,'保存卡片').click();await flush();assert.deepEqual(f.plugin.saved.config.items,[{title:'新的喜欢',url:'新笔记.md',icon:'heart'}]);
});

test('灵感默认单文件保存，五种保存方式共用唯一保存目录并保留历史引用',async t=>{
 const f=await fixture(t),card=createCard('capture',{config:{...createCard('capture').config,notePath:'旧目录/旧灵感.md',attachmentFolder:'旧附件'}}),modal=new f.CardSettingsModal(f.app,f.plugin,card);modal.open();
 const title=modal.contentEl.querySelector('[aria-label="卡片标题"]');
 const mode=modal.contentEl.querySelector('[aria-label="保存方式"]');
 assert.ok(mode);assert.equal(mode.value,'single');
 assert.deepEqual([...mode.options].map(option=>[option.value,option.textContent]),[['year','按年'],['quarter','按季度'],['month','按月'],['day','按日'],['single','单文件']]);
 input(f,modal.contentEl,'保存目录','灵感/分卷');
 for(const saveMode of ['single','year','day','month','quarter']) {
  input(f,modal.contentEl,'保存方式',saveMode);
  assert.equal(modal.contentEl.querySelector('[aria-label="保存目录"]').value,'灵感/分卷');
  for(const label of ['笔记路径','附件目录','历史灵感笔记（可保留）']) assert.equal(modal.contentEl.querySelector(`[aria-label="${label}"]`),null);
 }
 assert.match(modal.contentEl.textContent,/保存目录\/附件\/<笔记文件名去\.md>\//u);
 assert.match(modal.contentEl.textContent,/随续卷/u);
 assert.equal(modal.contentEl.querySelector('[aria-label="卡片标题"]'),title);
 button(modal.contentEl,'保存卡片').click();await flush();
 assert.equal(f.plugin.saved.config.saveMode,'quarter');assert.equal(f.plugin.saved.config.noteFolder,'灵感/分卷');assert.equal(f.plugin.saved.config.notePath,'旧目录/旧灵感.md');assert.equal(f.plugin.saved.config.attachmentFolder,'旧附件');
});

test('灵感单文件在根目录使用历史路径的文件名并支持大小续卷开关和阈值',async t=>{
 const f=await fixture(t),card=createCard('capture',{config:{...createCard('capture').config,notePath:'旧目录/我的灵感.md'}}),modal=new f.CardSettingsModal(f.app,f.plugin,card);modal.open();
 const checkbox=()=>modal.contentEl.querySelector('[aria-label="按文件大小自动续卷"]');
 assert.equal(checkbox().checked,true);
 const size=modal.contentEl.querySelector('[aria-label="单文件上限（KB）"]');
 assert.equal(size.type,'number');assert.equal(size.min,'1');assert.equal(size.value,'1024');
 assert.match(modal.contentEl.textContent,/附件不计入/u);assert.match(modal.contentEl.textContent,/单条.*完整.*单独/u);
 input(f,modal.contentEl,'单文件上限（KB）','256');
 checkbox().checked=false;checkbox().dispatchEvent(new f.window.Event('change'));
 assert.equal(modal.contentEl.querySelector('[aria-label="单文件上限（KB）"]'),null);
 checkbox().checked=true;checkbox().dispatchEvent(new f.window.Event('change'));
 assert.equal(modal.contentEl.querySelector('[aria-label="单文件上限（KB）"]').value,'256');
 input(f,modal.contentEl,'保存方式','single');input(f,modal.contentEl,'保存目录','.');
 assert.match(modal.contentEl.textContent,/单文件名：我的灵感\.md（位于保存目录下）/u);
 assert.equal(modal.contentEl.querySelector('[aria-label="笔记路径"]'),null);
 button(modal.contentEl,'保存卡片').click();await flush();
 assert.equal(f.plugin.saved.config.saveMode,'single');assert.equal(f.plugin.saved.config.noteFolder,'.');assert.equal(f.plugin.saved.config.notePath,'旧目录/我的灵感.md');assert.equal(f.plugin.saved.config.splitBySize,true);assert.equal(f.plugin.saved.config.maxFileSizeKB,256);
 const disabled=new f.CardSettingsModal(f.app,f.plugin,createCard('capture'));disabled.open();
 const toggle=disabled.contentEl.querySelector('[aria-label="按文件大小自动续卷"]');toggle.checked=false;toggle.dispatchEvent(new f.window.Event('change'));
 button(disabled.contentEl,'保存卡片').click();await flush();assert.equal(f.plugin.saved.config.splitBySize,false);
});

test('灵感大小阈值无效时保持窗口和输入，修正后可保存',async t=>{
 const f=await fixture(t),modal=new f.CardSettingsModal(f.app,f.plugin,createCard('capture'));modal.open();
 for(const value of ['0','1.5','1048577','']) {
  input(f,modal.contentEl,'单文件上限（KB）',value);button(modal.contentEl,'保存卡片').click();await flush();
  assert.equal(f.plugin.saved,undefined);assert.equal(modal.closed,undefined);assert.equal(modal.contentEl.querySelector('[aria-label="单文件上限（KB）"]').value,value);assert.match(modal.contentEl.textContent,/介于/u);
 }
 input(f,modal.contentEl,'单文件上限（KB）','1');button(modal.contentEl,'保存卡片').click();await flush();assert.equal(f.plugin.saved.config.maxFileSizeKB,1);
});

test('待办设置沿用五种保存方式且只有主动修改保存目录才迁移旧来源',async t=>{
 const f=await fixture(t),legacy={sourceType:'file',source:'旧来源/任务.md',inboxPath:'旧目录/我的任务.MD'},card=createCard('tasks',{config:legacy});
 const unchanged=new f.CardSettingsModal(f.app,f.plugin,card);unchanged.open();
 assert.equal(unchanged.contentEl.querySelector('[aria-label="保存目录"]').value,'旧目录');
 assert.match(unchanged.contentEl.textContent,/单文件名：我的任务\.MD（位于保存目录下）/u);
 for(const label of ['待办来源类型','待办来源路径','新待办写入笔记']) assert.equal(unchanged.contentEl.querySelector(`[aria-label="${label}"]`),null);
 input(f,unchanged.contentEl,'保存方式','quarter');button(unchanged.contentEl,'保存卡片').click();await flush();
 assert.equal(f.plugin.saved.config.sourceType,'file');assert.equal(f.plugin.saved.config.source,legacy.source);assert.equal(f.plugin.saved.config.inboxPath,legacy.inboxPath);
 const modal=new f.CardSettingsModal(f.app,f.plugin,card);modal.open();
 const mode=modal.contentEl.querySelector('[aria-label="保存方式"]');
 assert.deepEqual([...mode.options].map(option=>[option.value,option.textContent]),[['year','按年'],['quarter','按季度'],['month','按月'],['day','按日'],['single','单文件']]);
 input(f,modal.contentEl,'保存目录','任务/分卷');
 for(const saveMode of ['year','quarter','month','day','single']) {
  input(f,modal.contentEl,'保存方式',saveMode);
  assert.equal(modal.contentEl.querySelector('[aria-label="保存目录"]').value,'任务/分卷');
 }
 const toggle=()=>modal.contentEl.querySelector('[aria-label="按文件大小自动续卷"]');
 input(f,modal.contentEl,'单文件上限（KB）','256');toggle().checked=false;toggle().dispatchEvent(new f.window.Event('change'));
 assert.equal(modal.contentEl.querySelector('[aria-label="保存目录"]').value,'任务/分卷');assert.equal(modal.contentEl.querySelector('[aria-label="单文件上限（KB）"]'),null);
 toggle().checked=true;toggle().dispatchEvent(new f.window.Event('change'));assert.equal(modal.contentEl.querySelector('[aria-label="单文件上限（KB）"]').value,'256');
 button(modal.contentEl,'保存卡片').click();await flush();
 assert.deepEqual(f.plugin.saved.config,{sourceType:'folder',source:'任务/分卷',inboxPath:'任务/分卷/我的任务.MD',noteFolder:'任务/分卷',saveMode:'single',splitBySize:true,maxFileSizeKB:256,showDoing:true});
});

test('待办根目录沿用历史文件名，无效目录及大小不会丢失输入',async t=>{
 const f=await fixture(t),modal=new f.CardSettingsModal(f.app,f.plugin,createCard('tasks',{config:{sourceType:'folder',source:'历史目录',inboxPath:'旧目录/历史待办.md'}}));modal.open();
 input(f,modal.contentEl,'保存目录','../bad');input(f,modal.contentEl,'保存方式','month');
 button(modal.contentEl,'保存卡片').click();await flush();assert.equal(f.plugin.saved,undefined);assert.equal(modal.closed,undefined);assert.equal(modal.contentEl.querySelector('[aria-label="保存目录"]').value,'../bad');
 input(f,modal.contentEl,'保存目录','.');
 for(const value of ['0','1.5','1048577','']) {
  input(f,modal.contentEl,'单文件上限（KB）',value);button(modal.contentEl,'保存卡片').click();await flush();
  assert.equal(f.plugin.saved,undefined);assert.equal(modal.contentEl.querySelector('[aria-label="单文件上限（KB）"]').value,value);assert.match(modal.contentEl.textContent,/介于/u);
 }
 input(f,modal.contentEl,'单文件上限（KB）','1');button(modal.contentEl,'保存卡片').click();await flush();
 assert.equal(f.plugin.saved.config.sourceType,'folder');assert.equal(f.plugin.saved.config.source,'.');assert.equal(f.plugin.saved.config.noteFolder,'.');assert.equal(f.plugin.saved.config.inboxPath,'历史待办.md');assert.equal(f.plugin.saved.config.maxFileSizeKB,1);
});

test('正在编辑内容阻止删除卡片时保留设置窗口',async t=>{
 const f=await fixture(t);f.plugin.removeCard=async()=>false;
 const modal=new f.CardSettingsModal(f.app,f.plugin,createCard('capture'));modal.open();
 button(modal.contentEl,'删除卡片').click();await flush();
 assert.equal(modal.closed,undefined);assert.match(modal.contentEl.textContent,/尚未删除/);
});

test('导出展示只读 JSON，拒绝覆盖已有文件及不合法路径',async t=>{
 const f=await fixture(t),modal=new f.ExportModal(f.app,f.plugin);modal.open();
 assert.equal(modal.contentEl.querySelector('textarea').readOnly,true);
 f.files.set('Simple Space配置.json',{path:'Simple Space配置.json',content:'保留内容'});
 button(modal.contentEl,'保存到仓库').click();await flush();
 assert.equal(f.files.get('Simple Space配置.json').content,'保留内容');assert.match(modal.contentEl.textContent,/已存在/);
 input(f,modal.contentEl,'导出文件路径','../escape.json');button(modal.contentEl,'保存到仓库').click();await flush();assert.equal(f.files.has('../escape.json'),false);
 input(f,modal.contentEl,'导出文件路径','配置/导出.json');button(modal.contentEl,'保存到仓库').click();await flush();
 assert.equal(JSON.parse(f.files.get('配置/导出.json').content).cards[0].title,'我的入口');
});

test('冲突展示双方卡片，解决失败保留窗口并能重试',async t=>{
 const f=await fixture(t),local=workspace(),remote=workspace();remote.cards[0].title='同步入口';
 f.plugin.store.conflict={local,remote,path:'新配置/workspace.json'};f.plugin.resolveConflict=async()=>{throw Error('同步出现新版本');};
 const modal=new f.ConflictModal(f.app,f.plugin);modal.open();
 assert.match(modal.contentEl.textContent,/我的入口/);assert.match(modal.contentEl.textContent,/同步入口/);
 assert.match(modal.contentEl.textContent,/新配置\/workspace\.json/);
 button(modal.contentEl,'使用同步配置').click();await flush();assert.equal(modal.closed,undefined);assert.match(modal.contentEl.textContent,/新版本/);
 f.plugin.resolveConflict=async choice=>{f.plugin.choice=choice;return true;};button(modal.contentEl,'使用同步配置').click();await flush();assert.equal(f.plugin.choice,'remote');assert.equal(modal.closed,true);
});

test('配置发现只在用户选择后采用，根目录和现有目录均可选择',async t=>{
 const f=await fixture(t);f.files.set('笔记',{path:'笔记',children:[]});f.files.set('笔记/a.md',{path:'笔记/a.md'});
 const chooser=new f.FolderModal(f.app,folder=>{f.plugin.folder=folder;});
 assert.deepEqual(chooser.getItems(),['.','笔记']);assert.equal(chooser.getItemText('.'),'仓库根目录');chooser.onChooseItem('.');assert.equal(f.plugin.folder,'.');
 const modal=new f.DiscoveryModal(f.app,f.plugin,[{path:'workspace.json',document:workspace()},{path:'配置/workspace.json',document:workspace()}]);modal.open();
 assert.equal(f.plugin.storage,undefined);
 button(modal.contentEl,'使用 配置/workspace.json').click();await flush();
 assert.deepEqual(f.plugin.storage,{mode:'folder',folder:'配置'});assert.equal(modal.closed,true);
});

test('存储设置只在显式应用后切换，失败保留原设置与待重试的输入',async t=>{
 const f=await fixture(t,'src/settings.js'),tab=new f.DeskSettings(f.app,f.plugin);tab.display();
 input(f,tab.containerEl,'配置存储位置','folder');input(f,tab.containerEl,'配置目录','新目录/工作台');
 assert.equal(f.plugin.storage,undefined);assert.equal(f.files.size,0);
 f.plugin.changeStorage=async()=>{throw Error('写入失败');};button(tab.containerEl,'应用存储设置').click();await flush();
 assert.equal(f.plugin.store.settings.mode,'plugin');assert.match(tab.containerEl.textContent,/写入失败/);
 assert.equal(tab.containerEl.querySelector('[aria-label="配置目录"]').value,'新目录/工作台');
 f.plugin.changeStorage=async value=>{f.plugin.storage=value;Object.assign(f.plugin.store.settings,value);return true;};
 button(tab.containerEl,'应用存储设置').click();await flush();
 assert.deepEqual(f.plugin.storage,{mode:'folder',folder:'新目录/工作台'});
 const toggle=tab.containerEl.querySelector('[aria-label="启动时打开 Simple Space"]');toggle.checked=true;toggle.dispatchEvent(new f.window.Event('change'));await flush();assert.equal(f.plugin.store.settings.openOnStartup,true);
 button(tab.containerEl,'发现已有配置').click();await flush();assert.equal(f.plugin.discovered,true);
});
