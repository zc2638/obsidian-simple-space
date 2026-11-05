import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Window} from 'happy-dom';
import {IDBFactory} from 'fake-indexeddb';

async function fixture(t,options={}){
 const window=new Window({url:'https://obsidian.local'}),doc=window.document;
 const proto=window.HTMLElement.prototype;
 proto.createEl=function(tag,options={}){const el=doc.createElement(tag);if(options.cls)el.className=options.cls;if(options.text!==undefined)el.textContent=options.text;for(const [k,v]of Object.entries(options.attr||{}))el.setAttribute(k,v);this.append(el);return el;};
 proto.createDiv=function(o){return this.createEl('div',o);};proto.createSpan=function(o){return this.createEl('span',o);};
 proto.addClass=function(...c){this.classList.add(...c);};proto.removeClass=function(...c){this.classList.remove(...c);};proto.setText=function(t){this.textContent=String(t);};proto.empty=function(){this.replaceChildren();};
 const handlers=new Map(),files=new Map(),data={value:null},locals=new Map(),views=new Map(),leaves=[],notices=[];
 const emit=async(event,file,old)=>{for(const fn of handlers.get(event)||[])await fn(file,old);};
 const vault={configDir:'.obsidian',getName:()=> 'test-vault',getAbstractFileByPath:p=>files.get(p)||null,getMarkdownFiles:()=>[...files.values()].filter(f=>f.extension==='md'),getAllLoadedFiles:()=>[...files.values()],
  on(event,fn){if(!handlers.has(event))handlers.set(event,new Set());handlers.get(event).add(fn);return {event,fn};},offref(ref){handlers.get(ref.event)?.delete(ref.fn);},
  async createFolder(path){if(files.has(path))throw Error('已存在');files.set(path,{path,children:[]});},
  async create(path,text){if(files.has(path))throw Error('已存在');await options.beforeCreate?.(path);const file={path,content:text,extension:path.split('.').at(-1),basename:path.split('/').at(-1).replace(/\.md$/,''),stat:{mtime:Date.now(),ctime:Date.now(),size:text.length}};files.set(path,file);await emit('create',file);return file;},
  async read(file){await options.beforeRead?.(file.path);return file.content;},async cachedRead(file){await options.beforeRead?.(file.path);return file.content;},async process(file,fn){file.content=fn(file.content);file.stat.mtime++;file.stat.size=file.content.length;await emit('modify',file);},
  async createBinary(path,bytes){const file={path,bytes,extension:path.split('.').at(-1),stat:{size:bytes.byteLength}};files.set(path,file);await emit('create',file);return file;},
 };
 vault.adapter={exists:async p=>files.has(p),stat:async p=>files.has(p)?{type:files.get(p).children?'folder':'file'}:null,
  read:async p=>{if(!files.has(p))throw Error('不存在');return files.get(p).content;},write:async(p,text)=>{if(files.has(p)){files.get(p).content=text;await emit('modify',files.get(p));}else await vault.create(p,text);},mkdir:async p=>vault.createFolder(p)};
 const app={vault,doc,metadataCache:{getFileCache:()=>null,on:()=>({}),offref(){}},loadLocalStorage:k=>locals.get(k),saveLocalStorage:(k,v)=>locals.set(k,v),
  fileManager:{generateMarkdownLink:(file,source,subpath,alias)=>`[[${file.path}${alias?'|'+alias:''}]]`},
  workspace:{onLayoutReady:fn=>{app.ready=fn;},getLeavesOfType:type=>leaves.filter(l=>l.type===type),revealLeaf:async()=>{},getLeaf:()=>{
   const leaf={containerEl:doc.body.createDiv(),async setViewState(state){this.type=state.type;this.view=views.get(state.type)(this);await this.view.onOpen();},async openFile(file){app.opened=file.path;},detach(){return this.view?.onClose();}};leaves.push(leaf);return leaf;
  },openLinkText:async path=>{app.opened=path;}},setting:{open(){},openTabById(){}}};
 class Plugin{
  constructor(app,manifest){this.app=app;this.manifest=manifest;this.cleanups=[];this.settingTabs=[];}
  loadData(){return Promise.resolve(data.value?structuredClone(data.value):null);}saveData(value){data.value=structuredClone(value);return Promise.resolve();}
  registerView(type,fn){views.set(type,fn);}addRibbonIcon(){}addCommand(){}addSettingTab(tab){this.settingTabs.push(tab);}
  registerEvent(ref){this.cleanups.push(()=>vault.offref(ref));}registerInterval(id){this.cleanups.push(()=>clearInterval(id));}
 }
 class ItemView{constructor(leaf){this.leaf=leaf;this.app=app;this.containerEl=leaf.containerEl;this.actionsEl=leaf.containerEl.createDiv({cls:'view-actions'});this.contentEl=leaf.containerEl.createDiv();}addAction(icon,label,callback){const button=this.actionsEl.createEl('button',{attr:{type:'button','aria-label':label,'data-icon':icon}});button.onclick=callback;return button;}}
 class Modal{constructor(app){this.app=app;this.containerEl=doc.body.createDiv({cls:'modal-container'});this.modalEl=this.containerEl.createDiv({cls:'modal'});this.contentEl=this.modalEl.createDiv({cls:'modal-content'});}setTitle(title){this.modalEl.createEl('h2',{text:title});return this;}open(){this.onOpen?.();}close(){this.onClose?.();this.containerEl.remove();}}
 class FuzzySuggestModal extends Modal{setPlaceholder(){}onOpen(){for(const item of this.getItems()){const b=this.contentEl.createEl('button',{text:this.getItemText(item)});b.onclick=()=>{this.onChooseItem(item);this.close();};}}}
 class Setting{
  constructor(body){this.settingEl=body.createDiv({cls:'setting-item'});this.infoEl=this.settingEl.createDiv();this.controlEl=this.settingEl.createDiv();}
  setName(t){this.infoEl.createDiv({text:t});return this;}setDesc(t){this.infoEl.createDiv({text:t});return this;}
  control(tag,fn,type){const el=this.controlEl.createEl(tag);if(type)el.type=type;const api={inputEl:el,selectEl:el,buttonEl:el,toggleEl:el,
   setValue:v=>{if(type==='checkbox')el.checked=v;else el.value=v;return api;},setPlaceholder:v=>{el.placeholder=v;return api;},setDisabled:v=>{el.disabled=v;return api;},
   addOption:(v,t)=>{el.createEl('option',{text:t,attr:{value:v}});return api;},addOptions:o=>{for(const [v,t]of Object.entries(o))api.addOption(v,t);return api;},
   setButtonText:t=>{el.textContent=t;return api;},setCta:()=>api,setIcon:()=>api,setTooltip:()=>api,
   onChange:cb=>{el.addEventListener(type==='checkbox'?'change':tag==='select'?'change':'input',()=>cb(type==='checkbox'?el.checked:el.value));return api;},onClick:cb=>{el.onclick=cb;return api;}};
   fn(api);return this;
  }
  addText(fn){return this.control('input',fn,'text');}addTextArea(fn){return this.control('textarea',fn);}addDropdown(fn){return this.control('select',fn);}addToggle(fn){return this.control('input',fn,'checkbox');}addButton(fn){return this.control('button',fn);}addExtraButton(fn){return this.addButton(fn);}
 }
 class PluginSettingTab{constructor(app,plugin){this.app=app;this.plugin=plugin;this.containerEl=doc.body.createDiv();}}
 class Component{load(){this.loaded=true;}unload(){this.loaded=false;}}
 const MarkdownRenderer={async render(app,text,element,source,component){app.renderedDetails={text,source,component};element.textContent=text;}};
 const obsidian={Component,MarkdownRenderer,Plugin,ItemView,Modal,FuzzySuggestModal,Setting,PluginSettingTab,Notice:class{constructor(message){notices.push(String(message));}},setIcon:(el,name)=>el.setAttribute('data-icon',name),getAllTags:()=>[],Platform:{isMobile:false},moment:date=>({format:format=>format.replace('YYYY',String(date.getFullYear())).replace('MM',String(date.getMonth()+1).padStart(2,'0')).replace('DD',String(date.getDate()).padStart(2,'0'))})};
 const original={window:globalThis.window,document:globalThis.document,indexedDB:globalThis.indexedDB};
 globalThis.window=window;globalThis.document=doc;globalThis.indexedDB=new IDBFactory();
 const code=await build({entryPoints:['src/main.js'],bundle:true,write:false,format:'cjs',platform:'node',external:['obsidian']});
 const module={exports:{}};Function('module','exports','require',code.outputFiles[0].text)(module,module.exports,name=>{assert.equal(name,'obsidian');return obsidian;});
 const plugin=new module.exports.default(app,{id:'simple-space',name:'Simple Space',version:'0.1.0'});await plugin.onload();
 t.after(async()=>{await plugin.onunload();plugin.cleanups.forEach(fn=>fn());await window.happyDOM.close();Object.assign(globalThis,original);});
 return {plugin,app,doc,files,data,notices,window};
}
const flush=()=>new Promise(r=>setTimeout(r,20));

test('全新安装独立插件即可打开六种卡片，不创建内容笔记',async t=>{
 const f=await fixture(t);await f.plugin.openWorkspace();await flush();
 assert.equal(f.doc.querySelectorAll('.desk-card').length,6);assert.deepEqual([...f.files.keys()].sort(),['Simple Space','Simple Space/workspace.json']);
 assert.equal(f.plugin.store.settings.mode,'folder');assert.equal(f.plugin.store.settings.folder,'Simple Space');
 assert.equal(f.data.value.format,'simple-space');assert.ok(f.doc.querySelector('.ws-desk-calendar'));
 assert.ok(f.doc.querySelector('textarea[aria-label="灵感内容"]'));
});

test('待办关闭进行中后两列展示、不漏历史任务，恢复开关保留原状态且仍能完成任务',async t=>{
 const f=await fixture(t),source='Simple Space/待办任务/待办任务.md';
 const original='- [ ] 待办甲\r\n- [ ] 进行中乙 <!-- desk:doing -->\r\n  ![[附件/说明.png]]\r\n- [/] 进行中丙\r\n- [x] 完成丁\r\n';
 const file=await f.app.vault.create(source,original),card=f.plugin.store.document.cards.find(c=>c.type==='tasks');
 const view=await f.plugin.openWorkspace();await flush();
 const host=()=>f.doc.querySelector('.hp-card-kanban');
 const configure=async showDoing=>{await f.plugin.store.update(doc=>{doc.cards.find(c=>c.id===card.id).config.showDoing=showDoing;});await view.hosts.get(card.id).ready;};
 assert.equal(host().querySelectorAll('.desk-task-column').length,3);
 await configure(false);
 let columns=host().querySelectorAll('.desk-task-column');assert.equal(columns.length,2);
 assert.match(columns[0].querySelector('.desk-task-heading').textContent,/待办 3/);assert.match(columns[1].querySelector('.desk-task-heading').textContent,/完成 1/);
 assert.equal(host().querySelector('.desk-task-board').style.getPropertyValue('--desk-task-columns'),'2');
 for(const select of host().querySelectorAll('.desk-task-row select'))assert.deepEqual([...select.options].map(o=>o.value),['todo','done']);
 assert.equal(file.content,original);
 await configure(true);
 columns=host().querySelectorAll('.desk-task-column');assert.equal(columns.length,3);assert.match(columns[1].querySelector('.desk-task-heading').textContent,/进行中 2/);assert.equal(file.content,original);
 await configure(false);
 const select=host().querySelector('select[aria-label="任务状态：进行中乙"]');select.value='done';await select.onchange();await flush();
 assert.equal(file.content,original.replace('- [ ] 进行中乙 <!-- desk:doing -->','- [x] 进行中乙'));
});

test('工作台正常浏览隐藏编辑工具栏，并可从原生标题操作进入编辑',async t=>{
 const f=await fixture(t);const view=await f.plugin.openWorkspace();
 assert.equal(view.contentEl.querySelector('.desk-toolbar').hidden,true);
 assert.equal(view.status.textContent,'');
 const edit=view.actionsEl.querySelector('[aria-label="编辑布局"]');assert.ok(edit);edit.click();
 assert.equal(view.editing,true);assert.equal(view.contentEl.querySelector('.desk-toolbar').hidden,false);
 view.editButton.click();assert.equal(view.editing,false);assert.equal(view.contentEl.querySelector('.desk-toolbar').hidden,true);
 const capture=f.plugin.store.document.cards.find(card=>card.type==='capture');
 assert.equal(view.hosts.get(capture.id).el.style.getPropertyValue('--hp-accent'),'#6695d8');
 await view.onClose();await view.onOpen();assert.equal(view.actionsEl.querySelectorAll('[aria-label="编辑布局"]').length,1);
});
test('添加和移动卡片持久化，布局同步不重建正在输入的灵感',async t=>{
 const f=await fixture(t);await f.plugin.openWorkspace();await flush();
 const input=f.doc.querySelector('textarea[aria-label="灵感内容"]');input.value='不要丢失的草稿';
 await f.plugin.addCard('links');await flush();
 assert.equal(f.data.value.workspace.cards.length,7);
 assert.equal(f.doc.querySelector('textarea[aria-label="灵感内容"]'),input);assert.equal(input.value,'不要丢失的草稿');
 const id=f.plugin.store.document.cards.at(-1).id;await f.plugin.moveCard(id,-1);
 assert.equal(f.data.value.workspace.cards.at(-2).id,id);
});
test('有未保存内容时删除卡片被阻止，配置更新先等待草稿保存',async t=>{
 const f=await fixture(t);await f.plugin.openWorkspace();await flush();
 const input=f.doc.querySelector('textarea[aria-label="灵感内容"]');input.value='草稿';
 const capture=f.plugin.store.document.cards.find(c=>c.type==='capture');
 await f.plugin.removeCard(capture.id);assert.equal(f.plugin.store.document.cards.length,6);
 await f.plugin.store.update(doc=>{doc.cards.find(c=>c.id===capture.id).config.notePath='新灵感.md';});await flush();
 assert.equal(f.doc.querySelector('textarea[aria-label="灵感内容"]'),input);assert.match(f.doc.body.textContent,/保存.*更新|更新.*保存/);
});
test('设置界面支持显式选择根目录并创建workspace.json',async t=>{
 const f=await fixture(t);const tab=f.plugin.settingTabs[0];tab.display();
 const select=tab.containerEl.querySelector('[aria-label="配置存储位置"]');assert.ok(select);
 select.value='folder';select.dispatchEvent(new f.window.Event('change'));
 const input=tab.containerEl.querySelector('[aria-label="配置目录"]');assert.ok(input);input.value='.';input.dispatchEvent(new f.window.Event('input'));
 const save=[...tab.containerEl.querySelectorAll('button')].find(b=>b.textContent==='应用存储设置');assert.ok(save);save.click();
 await flush();assert.ok(f.files.has('workspace.json'));assert.equal(f.plugin.store.settings.mode,'folder');
});
test('保存待办期间继续输入的下一条内容不会被成功回调清空',async t=>{
 let release,started;const began=new Promise(resolve=>{started=resolve;});const gate=new Promise(resolve=>{release=resolve;});
 const f=await fixture(t,{beforeCreate:async path=>{if(path==='Simple Space/待办任务/待办任务.md'){started();await gate;}}});
 await f.plugin.openWorkspace();await flush();
 const input=f.doc.querySelector('input[aria-label="新任务"]'),form=input.closest('form');
 input.value='第一条';form.dispatchEvent(new f.window.Event('submit',{cancelable:true}));await began;
 input.value='第二条';release();await flush();
 assert.match(f.files.get('Simple Space/待办任务/待办任务.md').content,/- \[ \] 第一条\n/);assert.equal(input.value,'第二条');
});
test('卡片异步初始化期间关闭工作台，完成后不遗留轮询定时器',async t=>{
 let release,started;const began=new Promise(resolve=>{started=resolve;});const gate=new Promise(resolve=>{release=resolve;});
 const f=await fixture(t,{beforeRead:async path=>{if(path==='Simple Space/即时灵感/灵感.md'){started();await gate;}}});
 await f.app.vault.create('Simple Space/即时灵感/灵感.md','# 灵感\n');
 const opening=f.plugin.openWorkspace();await began;
 const view=[...f.plugin.views][0];await view.onClose();release();await opening;
 assert.equal(view.closed,true);assert.equal(view.pendingTimer,undefined);
});
test('普通模式拖动待办到完成列实际写回，编辑布局时只允许卡片排序',async t=>{
 const f=await fixture(t);await f.app.vault.create('Simple Space/待办任务/待办任务.md','- [ ] 做事\n');
 const view=await f.plugin.openWorkspace();await flush();
 const row=f.doc.querySelector('.desk-task-row'),transfer=new f.window.DataTransfer();
 const drag=(type,dataTransfer=transfer)=>{const event=new f.window.DragEvent(type,{bubbles:true,cancelable:true});Object.defineProperty(event,'dataTransfer',{value:dataTransfer});return event;};
 const start=drag('dragstart');
 assert.equal(row.dispatchEvent(start),true);assert.equal(start.defaultPrevented,false);assert.equal(transfer.getData('text/plain'),'任务');
 const done=f.doc.querySelectorAll('.desk-task-column')[2];
 const over=drag('dragover');done.dispatchEvent(over);assert.equal(over.defaultPrevented,true);
 done.dispatchEvent(drag('drop'));await flush();
 assert.equal(f.files.get('Simple Space/待办任务/待办任务.md').content,'- [x] 做事\n');
 view.toggleEditing();
 const blocked=drag('dragstart');f.doc.querySelector('.desk-task-row').dispatchEvent(blocked);
 assert.equal(blocked.defaultPrevented,true);assert.ok(!view.dragId);
 const cards=[...view.grid.children],cardTransfer=new f.window.DataTransfer();
 cards[0].querySelector('.hp-card-header').dispatchEvent(drag('dragstart',cardTransfer));
 assert.equal(cardTransfer.getData('text/x-simple-space-card'),cards[0].dataset.cardId);
 cards[1].dispatchEvent(drag('drop',cardTransfer));await flush();
 assert.equal(f.data.value.workspace.cards[1].id,cards[0].dataset.cardId);
});
test('无关标题和尺寸更新不打断灵感焦点及选区',async t=>{
 const f=await fixture(t);const view=await f.plugin.openWorkspace();await flush();
 const input=f.doc.querySelector('textarea[aria-label="灵感内容"]');input.value='正在输入的草稿';input.focus();input.setSelectionRange(2,5,'backward');
 let blurred=false;input.addEventListener('blur',()=>{blurred=true;});
 const card=f.plugin.store.document.cards.find(card=>card.type==='links');
 await f.plugin.saveCard({...card,title:'新标题',w:card.w-1});
 assert.ok(f.doc.activeElement===input,'标题/尺寸同步后焦点仍在原输入框');assert.equal(input.selectionStart,2);assert.equal(input.selectionEnd,5);assert.equal(input.selectionDirection,'backward');assert.equal(blurred,false);
 assert.equal(view.hosts.get(card.id).title.textContent,'新标题');
 assert.equal(view.hosts.get(card.id).el.style.getPropertyValue('--desk-card-width'),String(card.w-1));
});
test('布局重排保留正在合成的输入焦点和选区，同时立即达到配置顺序',async t=>{
 const f=await fixture(t);const view=await f.plugin.openWorkspace();await flush();
 const input=f.doc.querySelector('textarea[aria-label="灵感内容"]'),capture=f.plugin.store.document.cards.find(card=>card.type==='capture');
 input.value='正在合成';input.focus();input.setSelectionRange(1,3);input.dispatchEvent(new f.window.CompositionEvent('compositionstart',{bubbles:true}));
 let blurred=false;input.addEventListener('blur',()=>{blurred=true;});
 await f.plugin.moveCardTo(capture.id,5);
 assert.ok(f.doc.activeElement===input,'重排不移走合成输入的焦点');assert.equal(input.selectionStart,1);assert.equal(input.selectionEnd,3);assert.equal(blurred,false);
 assert.deepEqual([...view.grid.children].map(el=>el.dataset.cardId),f.plugin.store.document.cards.map(card=>card.id));
 await f.plugin.moveCardTo(capture.id,0);
 assert.ok(f.doc.activeElement===input);assert.deepEqual([...view.grid.children].map(el=>el.dataset.cardId),f.plugin.store.document.cards.map(card=>card.id));
 input.dispatchEvent(new f.window.CompositionEvent('compositionend',{bubbles:true}));
});
test('同步删除有草稿卡片时保留其位置，保存后删除且其余卡片顺序一致',async t=>{
 const f=await fixture(t);const view=await f.plugin.openWorkspace();await flush();
 const capture=f.plugin.store.document.cards.find(card=>card.type==='capture'),host=view.hosts.get(capture.id),initial=[...view.grid.children].map(el=>el.dataset.cardId);
 const input=host.body.querySelector('textarea');input.value='同步删除前的草稿';input.focus();
 await f.plugin.store.update(doc=>{doc.cards=doc.cards.filter(card=>card.id!==capture.id);});
 assert.ok(view.hosts.get(capture.id)===host);assert.equal(host.pending,null);assert.ok(f.doc.activeElement===input);
 assert.deepEqual([...view.grid.children].map(el=>el.dataset.cardId),initial);
 await f.plugin.moveCardTo(f.plugin.store.document.cards.at(-1).id,0);
 assert.ok(view.grid.children[1]===host.el);assert.ok(f.doc.activeElement===input);
 assert.deepEqual([...view.grid.children].filter(el=>el!==host.el).map(el=>el.dataset.cardId),f.plugin.store.document.cards.map(card=>card.id));
 await host.body.querySelector('.ws-capture-save').onclick();await flush();
 assert.ok([...f.files.values()].some(file=>file.content?.includes('同步删除前的草稿')));
 host.flushPending();assert.equal(view.hosts.has(capture.id),false);
 assert.deepEqual([...view.grid.children].map(el=>el.dataset.cardId),f.plugin.store.document.cards.map(card=>card.id));
});

test('待办创建上传视频和文件，默认单文件保存且详情可以展开',async t=>{
 const f=await fixture(t);const view=await f.plugin.openWorkspace();await flush();
 const task=f.plugin.store.document.cards.find(card=>card.type==='tasks'),host=view.hosts.get(task.id);
 const create=host.header.querySelector('[aria-label="创建待办"]');assert.ok(create,'提供待办创建入口');create.click();await flush();
 const input=host.body.querySelector('textarea[aria-label="待办内容"]');assert.ok(input);assert.equal(input.closest('.desk-task-editor').hidden,false);
 input.value='修复登录\n检查视频中的复现过程';input.dispatchEvent(new f.window.Event('input'));
 const picker=host.body.querySelector('input[type="file"]');assert.ok(picker);
 Object.defineProperty(picker,'files',{configurable:true,value:[new f.window.File(['screen-bytes'],'录屏.webm',{type:'video/webm'}),new f.window.File(['log-bytes'],'日志.txt',{type:'text/plain'})]});
 await picker.onchange();
 const save=host.body.querySelector('.ws-capture-save');await save.onclick();await flush();
 const note=f.files.get('Simple Space/待办任务/待办任务.md');assert.ok(note);assert.match(note.content,/- \[ \] 修复登录\n  检查视频中的复现过程/);
 assert.match(note.content,/!\[\[Simple Space\/待办任务\/附件\/待办任务\/.*录屏.webm/);
 assert.match(note.content,/\[\[Simple Space\/待办任务\/附件\/待办任务\/.*日志.txt/);
 assert.equal(host.body.querySelector('.desk-task-editor').hidden,true);
 const row=[...host.body.querySelectorAll('.desk-task-row')].find(row=>row.textContent.includes('修复登录'));assert.ok(row);
 const detail=row.querySelector('details');assert.ok(detail,'多媒体任务提供展开详情');detail.open=true;await detail.ontoggle();
 assert.match(f.app.renderedDetails.text,/录屏.webm/);assert.equal(f.app.renderedDetails.source,'Simple Space/待办任务/待办任务.md');
 const select=row.querySelector('select');select.value='done';await select.onchange();
 assert.match(note.content,/- \[x\] 修复登录/);assert.match(note.content,/录屏.webm/);
});

test('待办返回看板保留未保存草稿，来源修改受保护，重新创建继续编辑',async t=>{
 const f=await fixture(t);const view=await f.plugin.openWorkspace();await flush();
 const task=f.plugin.store.document.cards.find(card=>card.type==='tasks'),host=view.hosts.get(task.id);
 host.header.querySelector('[aria-label="创建待办"]').click();await flush();
 const input=host.body.querySelector('textarea[aria-label="待办内容"]');input.value='未保存的多媒体任务';input.dispatchEvent(new f.window.Event('input'));await flush();
 await host.header.querySelector('[aria-label="返回待办列表"]').onclick();
 assert.equal(host.body.querySelector('.desk-task-editor').hidden,true);
 await assert.rejects(f.plugin.saveCard({...task,config:{...task.config,noteFolder:'新待办'}}),/先保存/);
 host.header.querySelector('[aria-label="创建待办"]').click();assert.equal(input.value,'未保存的多媒体任务');
 await host.body.querySelector('.ws-capture-save').onclick();await flush();
 assert.match(f.files.get('Simple Space/待办任务/待办任务.md').content,/未保存的多媒体任务/);
});

test('待办录音返回时等待最终片段，重新创建后可保存音频附件',async t=>{
 const f=await fixture(t);let stopped=false;
 Object.defineProperty(f.window.navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>({getTracks:()=>[{stop(){stopped=true;}}]})}});
 f.window.MediaRecorder=class{
  static isTypeSupported(type){return type.startsWith('audio/webm');}
  constructor(){this.mimeType='audio/webm';this.state='inactive';}
  start(){this.state='recording';}
  stop(){this.state='inactive';queueMicrotask(()=>{this.ondataavailable?.({data:new f.window.Blob(['task-voice-bytes'],{type:'audio/webm'})});this.onstop?.();});}
 };
 const view=await f.plugin.openWorkspace();const task=f.plugin.store.document.cards.find(card=>card.type==='tasks'),host=view.hosts.get(task.id);
 host.header.querySelector('[aria-label="创建待办"]').click();
 host.body.querySelector('textarea').value='语音任务';
 await host.body.querySelector('[aria-label="开始录音"]').onclick();
 await host.header.querySelector('[aria-label="返回待办列表"]').onclick();assert.equal(stopped,true);
 host.header.querySelector('[aria-label="创建待办"]').click();assert.ok(host.body.querySelector('audio'));
 await host.body.querySelector('.ws-capture-save').onclick();
 assert.match(f.files.get('Simple Space/待办任务/待办任务.md').content,/- \[ \] 语音任务/);
 assert.match(f.files.get('Simple Space/待办任务/待办任务.md').content,/!\[\[Simple Space\/待办任务\/附件\/待办任务\/.*录音-.*webm/);
 const audio=[...f.files.values()].find(file=>file.path.startsWith('Simple Space/待办任务/附件/')&&file.extension==='webm');assert.ok(audio);assert.ok(audio.bytes.byteLength>0);
});

test('快速文字待办按大小续卷，所有卷中的任务继续汇总展示',async t=>{
 const f=await fixture(t);await f.plugin.store.update(doc=>{doc.cards.find(card=>card.type==='tasks').config.maxFileSizeKB=1;});
 await f.app.vault.create('Simple Space/待办任务/待办任务.md','# 待办\n\n- [ ] 旧卷任务\n'+'.'.repeat(1024));
 const view=await f.plugin.openWorkspace();const task=f.plugin.store.document.cards.find(card=>card.type==='tasks'),host=view.hosts.get(task.id);
 const form=host.body.querySelector('form'),input=form.querySelector('input');input.value='新卷任务';await form.onsubmit(new f.window.Event('submit',{cancelable:true}));
 assert.match(f.files.get('Simple Space/待办任务/待办任务-002.md').content,/- \[ \] 新卷任务/);
 assert.match(host.body.textContent,/旧卷任务/);assert.match(host.body.textContent,/新卷任务/);
});

test('关闭再打开工作台恢复待办视频草稿，恢复期间不提前创建正式文件',async t=>{
 const f=await fixture(t);const view=await f.plugin.openWorkspace();const task=f.plugin.store.document.cards.find(card=>card.type==='tasks');
 let host=view.hosts.get(task.id);host.header.querySelector('[aria-label="创建待办"]').click();
 const input=host.body.querySelector('textarea');input.value='稍后处理的录屏';await input.oninput();
 const picker=host.body.querySelector('input[type="file"]');Object.defineProperty(picker,'files',{value:[new f.window.File(['restore-video-bytes'],'待恢复.mp4',{type:'video/mp4'})]});await picker.onchange();
 assert.deepEqual([...f.files.keys()].sort(),['Simple Space','Simple Space/workspace.json']);await view.onClose();await view.onOpen();
 host=view.hosts.get(task.id);host.header.querySelector('[aria-label="创建待办"]').click();
 assert.equal(host.body.querySelector('textarea').value,'稍后处理的录屏');assert.ok(host.body.querySelector('video'));assert.deepEqual([...f.files.keys()].sort(),['Simple Space','Simple Space/workspace.json']);
 await host.body.querySelector('.ws-capture-save').onclick();
 assert.match(f.files.get('Simple Space/待办任务/待办任务.md').content,/稍后处理的录屏/);
 const video=[...f.files.values()].find(file=>file.extension==='mp4');assert.ok(video);assert.equal(video.bytes.byteLength,'restore-video-bytes'.length);
});

test('待办草稿备份失败时返回仍保留编辑器和错误提示',async t=>{
 const f=await fixture(t);const view=await f.plugin.openWorkspace(),task=f.plugin.store.document.cards.find(card=>card.type==='tasks'),host=view.hosts.get(task.id);
 host.header.querySelector('[aria-label="创建待办"]').click();
 const write=f.plugin.drafts.write.bind(f.plugin.drafts);f.plugin.drafts.write=async()=>{throw Error('磁盘暂不可写');};
 try{
  const input=host.body.querySelector('textarea');input.value='不能隐藏的未备份任务';await input.oninput();
  await host.header.querySelector('[aria-label="返回待办列表"]').onclick();
  assert.equal(host.body.querySelector('.desk-task-editor').hidden,false);
  assert.equal(input.value,'不能隐藏的未备份任务');assert.match(host.body.querySelector('.ws-capture-status').textContent,/备份|保存|磁盘/);
 }finally{f.plugin.drafts.write=write;}
});
