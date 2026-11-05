import {Modal, FuzzySuggestModal, Notice} from 'obsidian';
import {CARD_DEFINITIONS, createCard, validateDocument, validateVaultPath, normalizeDirectory} from './core/model.js';
import {ensureFolder} from './core/files.js';

const MAX_BYTES = 2_000_000;
const copy = value => JSON.parse(JSON.stringify(value));
const clear = element => element.replaceChildren();
function el(parent, tag, text, attrs = {}) { return parent.createEl(tag, {text, attr: attrs}); }
function control(parent, label, value, {type = 'text', multiline = false, options, onChange} = {}) {
 const row = el(parent, 'label', undefined, {class:'desk-form-field'});
 el(row, 'span', label);
 const field = el(row, options ? 'select' : multiline ? 'textarea' : 'input', undefined, {'aria-label':label});
 if(options) for(const [value, text] of Object.entries(options)) el(field,'option',text,{value});
 else if(!multiline) field.type = type;
 if(type === 'checkbox') field.checked = Boolean(value); else field.value = String(value ?? '');
 field.addEventListener(options || type === 'checkbox' ? 'change' : 'input', () => onChange?.(type === 'checkbox' ? field.checked : field.value));
 return field;
}
function action(parent, text, callback, primary = false) {
 const button = el(parent,'button',text,{type:'button'});
 if(primary) button.classList.add('mod-cta');
 button.addEventListener('click', callback);
 return button;
}
class DeskModal extends Modal {
 constructor(app, plugin) { super(app); this.plugin = plugin; this.busy = false; }
 prepare(title) { this.modalEl.classList.add('desk-modal'); this.setTitle(title); clear(this.contentEl); this.errorEl = el(this.contentEl,'p','',{class:'desk-inline-error',role:'alert'}); }
 fail(error) { this.errorEl.textContent = error?.message || String(error); }
 async run(operation) {
  if(this.busy) return;
  this.busy = true; this.errorEl.textContent = '';
  const controls = [...this.contentEl.querySelectorAll('button,input,select,textarea')].map(element=>[element,element.disabled]); controls.forEach(([element])=>{element.disabled=true;});
  try { await operation(); } catch(error) { this.fail(error); }
  finally { this.busy = false; controls.forEach(([element,disabled])=>{element.disabled=disabled;}); }
 }
}
function preview(parent, document) {
 el(parent,'p',`共 ${document.cards.length} 张卡片`);
 const list = el(parent,'ul');
 for(const card of document.cards) el(list,'li',`${CARD_DEFINITIONS[card.type].name} · ${card.title || '未命名'} · ${card.w} × ${card.h}`);
}

export class CardSettingsModal extends DeskModal {
 constructor(app, plugin, card = null) { super(app,plugin); this.existing = Boolean(card); this.card = card ? copy(card) : createCard('welcome'); }
 onOpen() {
  this.prepare(this.existing ? '编辑卡片' : '添加卡片');
  const card = this.card;
  control(this.contentEl,'卡片类型',card.type,{options:Object.fromEntries(Object.entries(CARD_DEFINITIONS).map(([key,value])=>[key,value.name])),onChange:type=>{
   card.type = type; card.config = copy(CARD_DEFINITIONS[type].defaultConfig); this.renderConfig();
  }});
  control(this.contentEl,'卡片标题',card.title,{onChange:value=>{card.title=value;}});
  const width = control(this.contentEl,'宽度（1–12）',card.w,{type:'number',onChange:value=>{card.w=Number(value);}}); width.min='1'; width.max='12'; width.step='1';
  const height = control(this.contentEl,'高度（1–24）',card.h,{type:'number',onChange:value=>{card.h=Number(value);}}); height.min='1'; height.max='24'; height.step='1';
  this.configEl = el(this.contentEl,'div',undefined,{class:'desk-card-config'}); this.renderConfig();
  action(this.contentEl,'保存卡片',()=>this.run(async()=>{
   const document = validateDocument({format:'simple-space',version:1,revision:'preview',cards:[card]});
   const result = await this.plugin.saveCard(document.cards[0]);
   if(result === false) throw Error('卡片尚未保存，请先完成正在编辑的内容后重试');
   this.close();
  }),true);
  if(this.existing) action(this.contentEl,'删除卡片',()=>this.run(async()=>{
   const result = await this.plugin.removeCard(card.id);
   if(result === false) throw Error('卡片尚未删除，请先保存正在编辑的内容后重试');
   this.close();
  }));
 }
 renderConfig() {
  clear(this.configEl);
  const config = this.card.config;
  const field = (key,label,options={}) => control(this.configEl,label,config[key],{...options,onChange:value=>{config[key]=options.type==='number'?Number(value):value;}});
  const lines = (key,label) => control(this.configEl,label,config[key].join('\n'),{multiline:true,onChange:value=>{config[key]=value.split(/\r?\n/u).map(line=>line.trim()).filter(Boolean);}});
  switch(this.card.type) {
   case 'welcome':
    field('name','显示名字'); lines('quotes','引言（每行一条）'); field('source','引言来源');
    field('useDailyNotes','使用核心日记插件设置',{type:'checkbox'});
    el(this.configEl,'p','启用后优先使用核心日记插件的目录、格式和模板；以下设置作为备用。');
    field('dailyFolder','日记目录'); field('dailyFormat','日记文件名格式'); field('dailyTemplate','日记模板路径');
    break;
   case 'capture':
   case 'tasks': {
    const tasks=this.card.type==='tasks';
    if(tasks){
     field('showDoing','显示进行中状态',{type:'checkbox'});
     el(this.configEl,'p','关闭后仅显示待办和完成；已有进行中任务归到待办列展示，原笔记状态保留。');
    }
    control(this.configEl,'保存方式',config.saveMode,{options:{year:'按年',quarter:'按季度',month:'按月',day:'按日',single:'单文件'},onChange:value=>{config.saveMode=value;this.renderConfig();}});
    control(this.configEl,'保存目录',config.noteFolder,{onChange:value=>{
     config.noteFolder=value;
     if(tasks) {
      // 仅在用户主动修改目录时统一读写范围，打开旧卡片不会迁移原来源。
      const folder=value.trim().replace(/\/+$/u,'');
      const filename=config.inboxPath.split('/').pop();
      config.sourceType='folder';config.source=value;config.inboxPath=folder==='.'?filename:`${folder}/${filename}`;
     }
    }});
    if(config.saveMode==='single') el(this.configEl,'p',`单文件名：${(tasks?config.inboxPath:config.notePath).split('/').pop()}（位于保存目录下）`);
    el(this.configEl,'p',`笔记和附件统一放在保存目录下，可填写 . 使用仓库根目录。附件自动存放于保存目录/附件/<笔记文件名去.md>/，随续卷对应；原有${tasks?'待办':'灵感'}笔记自动纳入历史。`);
    control(this.configEl,'按文件大小自动续卷',config.splitBySize,{type:'checkbox',onChange:value=>{config.splitBySize=value;this.renderConfig();}});
    if(config.splitBySize) {
     const size=field('maxFileSizeKB','单文件上限（KB）',{type:'number'});size.min='1';size.max='1048576';size.step='1';
    }
    el(this.configEl,'p',`默认上限为 1024 KB（1 KB = 1024 字节），附件不计入；单条${tasks?'待办':'灵感'}大于上限时会保留完整内容并单独占卷。`);
    break;
   }
   case 'links': {
    const columns=field('columns','链接列数',{type:'number'}); columns.min='1'; columns.max='6'; columns.step='1';
    const items=el(this.configEl,'div');
    const renderItems=()=>{
     clear(items);
     config.items.forEach((item,index)=>{
      const row=el(items,'div',undefined,{class:'desk-link-row'});
      control(row,`链接 ${index+1} 标题`,item.title,{onChange:value=>{item.title=value;}});
      control(row,`链接 ${index+1} 地址`,item.url,{onChange:value=>{item.url=value;}});
      action(row,`移除链接 ${index+1}`,()=>{config.items.splice(index,1);renderItems();});
     });
    };
    renderItems(); action(this.configEl,'添加链接',()=>{config.items.push({title:'',url:''});renderItems();});
    el(this.configEl,'p','支持仓库内笔记路径、https、http、obsidian 和 mailto 链接。'); break;
   }
   case 'recent': {
    field('folder','笔记目录（留空为全仓库）');
    const limit=field('limit','显示数量',{type:'number'}); limit.min='1'; limit.max='100'; limit.step='1';
    field('sort','排序方式',{options:{modified:'最近修改',created:'最近创建'}}); lines('excludeFolders','排除目录（每行一个）'); break;
   }
   case 'stats':
    for(const [key,label] of Object.entries({notes:'显示笔记数量',tags:'显示标签数量',words:'显示字数',attachments:'显示附件数量'})) control(this.configEl,label,config.metrics.includes(key),{type:'checkbox',onChange:value=>{config.metrics=value?[...new Set([...config.metrics,key])]:config.metrics.filter(item=>item!==key);}});
    break;
  }
 }
}

export class ImportModal extends DeskModal {
 onOpen() {
  this.prepare('导入 Simple Space 配置');
  el(this.contentEl,'p','导入只替换卡片布局与配置，不导入笔记正文和附件。请先预览，再确认替换。');
  const file = control(this.contentEl,'选择 JSON 文件','',{type:'file'}); file.accept = '.json,application/json';
  const textarea = control(this.contentEl,'配置 JSON','',{multiline:true,onChange:()=>this.invalidate()});
  textarea.rows = 10;
  file.addEventListener('change', () => this.run(async () => {
   this.invalidate();
   const selected = file.files?.[0]; if(!selected) return;
   if(selected.size > MAX_BYTES) throw Error('配置文件不能超过 2 MB');
   textarea.value = await selected.text();
  }));
  const body = el(this.contentEl,'div',undefined,{class:'desk-import-preview'});
  action(this.contentEl,'预览配置',()=>this.run(async()=>{
   this.invalidate();
   if(new TextEncoder().encode(textarea.value).byteLength > MAX_BYTES) throw Error('配置文件不能超过 2 MB');
   this.document = validateDocument(JSON.parse(textarea.value));
   preview(body,this.document);
   this.confirmButton.hidden = false;
  }));
  this.confirmButton = action(this.contentEl,'确认导入并替换布局',()=>this.run(async()=>{
   if(!this.document) throw Error('请先预览有效配置');
   const result = await this.plugin.importConfig(copy(this.document));
   if(result === false) throw Error('配置尚未导入，请先完成正在编辑的内容后重试');
   this.close();
  }),true);
  this.confirmButton.hidden = true;
  this.previewEl = body;
 }
 invalidate() { this.document = null; if(this.previewEl) clear(this.previewEl); if(this.confirmButton) this.confirmButton.hidden = true; }
}

export class ExportModal extends DeskModal {
 onOpen() {
  this.prepare('导出 Simple Space 配置');
  el(this.contentEl,'p','导出文件只包含卡片布局与配置，不包含笔记正文、图片和附件。');
  let exported;
  try { exported=this.plugin.store.export(); } catch(error) { this.fail(error); return; }
  const textarea=control(this.contentEl,'导出配置 JSON',exported,{multiline:true}); textarea.readOnly=true; textarea.rows=12;
  const path=control(this.contentEl,'导出文件路径','Simple Space配置.json');
  action(this.contentEl,'保存到仓库',()=>this.run(async()=>{
   const target=validateVaultPath(path.value);
   if(!target.toLowerCase().endsWith('.json')) throw Error('导出路径必须以 .json 结尾');
   if(this.app.vault.getAbstractFileByPath(target)) throw Error('文件已存在，请选择其他导出路径');
   await ensureFolder(this.app.vault,target.includes('/')?target.slice(0,target.lastIndexOf('/')):'.');
   await this.app.vault.create(target,exported);
   new Notice(`Simple Space 配置已导出到 ${target}`); this.close();
  }),true);
 }
}

export class ConflictModal extends DeskModal {
 onOpen() {
  this.prepare('选择要保留的 Simple Space 配置');
  el(this.contentEl,'p','此设备与同步配置发生冲突，两份配置均已保留。请选择完整保留哪一份；稍后处理只关闭窗口，不写入配置。');
  const conflict=this.plugin.store.conflict;
  if(!conflict) { el(this.contentEl,'p','当前没有待解决的冲突。'); action(this.contentEl,'关闭',()=>this.close()); return; }
  el(this.contentEl,'p',`当前配置位置：${conflict.path || '插件配置目录'}`);
  el(this.contentEl,'h3','此设备配置'); preview(this.contentEl,conflict.local);
  el(this.contentEl,'h3','同步配置'); preview(this.contentEl,conflict.remote);
  for(const [choice,label] of [['local','使用此设备配置'],['remote','使用同步配置']]) action(this.contentEl,label,()=>this.run(async()=>{
   const result=await this.plugin.resolveConflict(choice);
   if(result===false) throw Error('冲突尚未解决，请先完成正在编辑的内容后重试');
   this.close();
  }));
  action(this.contentEl,'稍后处理',()=>this.close());
 }
}

export class DiscoveryModal extends DeskModal {
 constructor(app,plugin,candidates) { super(app,plugin);this.candidates=candidates; }
 onOpen() {
  this.prepare('发现 Simple Space 配置');
  el(this.contentEl,'p','以下配置不会自动采用。选择后将切换存储位置并加载对应布局。');
  if(!this.candidates.length) el(this.contentEl,'p','未发现可用配置。');
  for(const candidate of this.candidates) {
   const row=el(this.contentEl,'div',undefined,{class:'desk-discovery-item'});
   el(row,'p',`${candidate.path} · ${candidate.document.cards.length} 张卡片`);
   action(row,`使用 ${candidate.path}`,()=>this.run(async()=>{
    const path=validateVaultPath(candidate.path);
    const folder=normalizeDirectory(path.includes('/')?path.slice(0,path.lastIndexOf('/')):'.');
    const result=await this.plugin.changeStorage({mode:'folder',folder});
    if(result===false) throw Error('尚未切换配置，请先完成正在编辑的内容后重试');
    this.close();
   }));
  }
 }
}

export class FolderModal extends FuzzySuggestModal {
 constructor(app,onChoose) { super(app);this.onChoose=onChoose;this.setPlaceholder('选择配置目录（可选择仓库根目录）'); }
 getItems() { return ['.',...this.app.vault.getAllLoadedFiles().filter(file=>Array.isArray(file.children)&&file.path&&file.path!=='/').map(file=>file.path).sort((a,b)=>a.localeCompare(b))]; }
 getItemText(folder) { return folder==='.'?'仓库根目录':folder; }
 onChooseItem(folder) { this.onChoose(folder); }
}
