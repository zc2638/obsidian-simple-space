import {ItemView,setIcon,Notice} from 'obsidian';
import welcome from './cards/welcome.js';
import capture from './cards/capture.cjs';
import {linksCard,tasksCard,recentCard,statsCard} from './cards/basic.js';
import {CARD_DEFINITIONS} from './core/model.js';
import {CardSettingsModal,ImportModal,ExportModal} from './modals.js';

export const VIEW_TYPE='simple-space-workspace';
const renderers={welcome,capture,links:linksCard,tasks:tasksCard,recent:recentCard,stats:statsCard};
const legacyKinds={welcome:'workspace-welcome',capture:'workspace-capture',links:'quicklinks',tasks:'kanban',recent:'recent',stats:'stats'};
const sameContent=(a,b)=>a.type===b.type&&JSON.stringify(a.config)===JSON.stringify(b.config);

class CardHost{
 constructor(view,card){
  this.view=view;this.plugin=view.plugin;this.card=card;this.cleanups=[];this.guards=[];this.refreshers=[];this.generation=0;this.disposed=false;this.pending=undefined;
  this.el=view.grid.createEl('article',{cls:'desk-card hp-card',attr:{'data-card-id':card.id}});
  this.header=this.el.createDiv({cls:'hp-card-header'});
  this.icon=this.header.createSpan({cls:'hp-card-icon'});this.title=this.header.createSpan({cls:'hp-card-title'});
  const right=this.header.createDiv({cls:'hp-card-header-right'});this.actions=right.createSpan({cls:'hp-card-actions'});
  const gear=right.createEl('button',{cls:'hp-card-action clickable-icon',attr:{type:'button','aria-label':'卡片设置',title:'卡片设置'}});setIcon(gear,'settings-2');gear.onclick=()=>new CardSettingsModal(view.app,this.plugin,this.currentDefinition()).open();
  this.pendingHint=this.el.createDiv({cls:'desk-pending',attr:{role:'status'}});this.pendingHint.hidden=true;
  this.body=this.el.createDiv({cls:'hp-card-body'});
  this.editbar=this.el.createDiv({cls:'desk-card-editbar'});
  this.up=this.editButton('arrow-up','向前移动',()=>this.plugin.moveCard(this.card.id,-1));
  this.down=this.editButton('arrow-down','向后移动',()=>this.plugin.moveCard(this.card.id,1));
  this.size=this.editbar.createSpan({cls:'desk-card-size'});
  this.editButton('minus','缩小宽度',()=>this.plugin.resizeCard(this.card.id,this.currentDefinition().w-1,this.currentDefinition().h));
  this.editButton('plus','增加宽度',()=>this.plugin.resizeCard(this.card.id,this.currentDefinition().w+1,this.currentDefinition().h));
  this.editButton('trash-2','删除卡片',()=>this.plugin.removeCard(this.card.id));
  this.resizer=this.el.createEl('button',{cls:'desk-card-resize',attr:{type:'button','aria-label':'拖动调整卡片大小',title:'拖动调整卡片大小'}});setIcon(this.resizer,'move-diagonal-2');this.bindResize();
  this.el.ondragstart=event=>{
   if(!view.editing)return;
   if(event.defaultPrevented||event.target?.closest?.('button,input,select,textarea,a')){event.preventDefault();return;}
   view.dragId=this.card.id;event.dataTransfer?.setData('text/x-simple-space-card',this.card.id);this.el.addClass('is-dragging');
  };
  this.el.ondragend=()=>{view.dragId=null;this.el.removeClass('is-dragging');view.grid.querySelectorAll('.is-drop-target').forEach(el=>el.removeClass('is-drop-target'));};
  this.el.ondragover=event=>{if(view.editing&&view.dragId&&view.dragId!==this.card.id){event.preventDefault();this.el.addClass('is-drop-target');}};
  this.el.ondragleave=()=>this.el.removeClass('is-drop-target');
  this.el.ondrop=event=>{if(!view.editing||!view.dragId)return;event.preventDefault();event.stopPropagation();const from=view.dragId;view.dragId=null;this.el.removeClass('is-drop-target');void this.plugin.moveCardTo(from,this.plugin.store.document.cards.findIndex(card=>card.id===this.card.id));};
  this.ready=this.mount(card);
 }
 currentDefinition(){return this.plugin.store.document.cards.find(card=>card.id===this.card.id)||this.pending||this.card;}
 editButton(icon,label,callback){const button=this.editbar.createEl('button',{cls:'clickable-icon',attr:{type:'button','aria-label':label,title:label}});setIcon(button,icon);button.onclick=callback;return button;}
 busy(){return this.guards.some(guard=>{try{return guard();}catch{return true;}});}
 metadata(card){
  this.el.className=`desk-card hp-card hp-card-${legacyKinds[card.type]}`;
  this.el.style.setProperty('--desk-card-width',String(card.w));this.el.style.setProperty('--desk-card-height',String(card.h));
  this.el.style.setProperty('--hp-accent',CARD_DEFINITIONS[card.type].accent);
  this.title.setText(card.title||CARD_DEFINITIONS[card.type].name);setIcon(this.icon,CARD_DEFINITIONS[card.type].icon);
  this.size.setText(`${card.w} 列 × ${card.h} 行`);this.el.draggable=this.view.editing;this.editbar.hidden=!this.view.editing;this.resizer.hidden=!this.view.editing;
 }
 async mount(card){
  this.disposeContents();this.card=structuredClone(card);this.pending=undefined;this.pendingHint.hidden=true;this.metadata(card);this.body.empty();this.body.className='hp-card-body';this.actions.empty();
  const generation=++this.generation,doc=this.body.ownerDocument;
  const ctx={app:this.view.app,widget:{id:card.id},config:structuredClone(card.config),draftAdapter:this.plugin.drafts,wordCounts:this.plugin.wordCounts,
   isAlive:()=>!this.disposed&&generation===this.generation&&this.el.isConnected,isEditing:()=>this.view.editing,
   registerCleanup:fn=>this.cleanups.push(fn),registerBusyGuard:fn=>this.guards.push(fn),registerDataRefresh:fn=>this.refreshers.push(fn),
   registerInterval:(fn,ms)=>{const id=doc.defaultView.setInterval(fn,ms);this.cleanups.push(()=>doc.defaultView.clearInterval(id));},
   openPath:(path,options)=>this.plugin.openPath(path,options),
   addHeaderAction:(icon,label,callback)=>{const button=this.actions.createEl('button',{cls:'hp-card-action clickable-icon',attr:{type:'button','aria-label':label,title:label}});setIcon(button,icon);button.onclick=callback;return button;}
  };
  try{await renderers[card.type].render(this.body,ctx);}catch(error){if(ctx.isAlive()){this.body.createDiv({cls:'desk-status',text:'卡片加载失败：'+error.message});this.plugin.showError(error);}}
 }
 apply(card){
  if(!card){
   if(this.busy()){this.pending=null;this.pendingHint.setText('同步已移除此卡片，请先保存当前内容。');this.pendingHint.hidden=false;return;}
   this.dispose();this.view.hosts.delete(this.card.id);return;
  }
  this.metadata(card);
  if(sameContent(this.card,card)){this.pending=undefined;this.pendingHint.hidden=true;return;}
  if(this.busy()){this.pending=card;this.pendingHint.setText('设置已有更新，请先保存当前内容，随后自动应用。');this.pendingHint.hidden=false;return;}
  this.ready=this.mount(card);
 }
 refreshData(){for(const refresh of this.refreshers)Promise.resolve(refresh()).catch(error=>this.plugin.showError(error));
  if(this.card.type==='welcome'){const meta=this.body.querySelector('.ws-welcome-meta');if(meta)meta.setText(`${this.view.app.vault.getMarkdownFiles().length.toLocaleString()} 篇笔记 · 专注当下，记录每一天`);}
 }
 flushPending(){if(this.pending!==undefined&&!this.busy())this.apply(this.pending);}
 disposeContents(){this.generation++;const cleanups=this.cleanups.splice(0);this.guards=[];this.refreshers=[];for(const cleanup of cleanups)try{const result=cleanup();if(result?.catch)result.catch(error=>this.plugin.showError(error));}catch(error){this.plugin.showError(error);}}
 dispose(){if(this.disposed)return;this.disposed=true;this.stopResize?.();this.disposeContents();this.el.remove();}
 bindResize(){
  this.resizer.onpointerdown=event=>{
   if(!this.view.editing)return;event.preventDefault();event.stopPropagation();this.stopResize?.();
   const doc=this.el.ownerDocument,start=this.currentDefinition(),x=event.clientX,y=event.clientY;
   const column=Math.max(20,this.view.grid.getBoundingClientRect().width/12),row=52;let w=start.w,h=start.h;
   const move=e=>{w=Math.max(1,Math.min(12,start.w+Math.round((e.clientX-x)/column)));h=Math.max(1,Math.min(24,start.h+Math.round((e.clientY-y)/row)));this.metadata({...start,w,h});};
   const stop=()=>{doc.removeEventListener('pointermove',move);doc.removeEventListener('pointerup',up);doc.removeEventListener('pointercancel',cancel);this.stopResize=null;};
   const up=()=>{stop();void this.plugin.resizeCard(start.id,w,h);};const cancel=()=>{stop();this.metadata(start);};
   this.stopResize=cancel;doc.addEventListener('pointermove',move);doc.addEventListener('pointerup',up);doc.addEventListener('pointercancel',cancel);
  };
 }
}

export class DeskView extends ItemView{
 constructor(leaf,plugin){super(leaf);this.plugin=plugin;this.hosts=new Map();this.editing=false;this.closed=false;}
 getViewType(){return VIEW_TYPE;}getDisplayText(){return 'Simple Space';}getIcon(){return 'home';}
 async onOpen(){
  this.closed=false;this.plugin.views.add(this);this.contentEl.addClass('hp-view','desk-view');this.contentEl.empty();
  this.root=this.contentEl.createDiv({cls:'hp-root desk-root'});
  const toolbar=this.root.createDiv({cls:'desk-toolbar'});this.toolbar=toolbar;toolbar.hidden=!this.editing;toolbar.createEl('h1',{text:'编辑工作台'});
  const controls=toolbar.createDiv({cls:'desk-toolbar-actions'});
  const action=(icon,label,callback,text)=>{const button=controls.createEl('button',{cls:'desk-toolbar-button',attr:{type:'button','aria-label':label,title:label}});setIcon(button.createSpan(),icon);if(text)button.createSpan({text});button.onclick=callback;return button;};
  action('plus','添加卡片',()=>new CardSettingsModal(this.app,this.plugin).open(),'添加卡片');
  this.editButton=action('pencil','编辑布局',()=>this.toggleEditing(),'编辑布局');
  action('upload','导入配置',()=>new ImportModal(this.app,this.plugin).open());action('download','导出配置',()=>new ExportModal(this.app,this.plugin).open());
  action('settings-2','插件设置',()=>{this.app.setting.open();this.app.setting.openTabById(this.plugin.manifest.id);});
  for(const button of this.nativeActions||[])button?.remove();
  this.nativeActions=[
   this.addAction('refresh-cw','刷新工作台',()=>this.refreshData()),
   this.addAction('plus','添加卡片',()=>new CardSettingsModal(this.app,this.plugin).open()),
   this.addAction('pencil','编辑布局',()=>this.toggleEditing()),
   this.addAction('settings-2','插件设置',()=>{this.app.setting.open();this.app.setting.openTabById(this.plugin.manifest.id);})
  ];
  this.status=this.root.createDiv({cls:'desk-workspace-status',attr:{role:'status'}});this.grid=this.root.createDiv({cls:'hp-grid desk-grid'});
  this.empty=this.root.createDiv({cls:'desk-empty-workspace',text:'工作台还没有卡片，点击“添加卡片”开始。'});
  this.reconcile();await Promise.all([...this.hosts.values()].map(host=>host.ready));
  if(this.closed)return;
  this.pendingTimer=this.contentEl.ownerDocument.defaultView.setInterval(()=>{for(const host of this.hosts.values())host.flushPending();},750);
 }
 reconcile(){
  if(this.closed||!this.grid)return;
  const document=this.plugin.store.document,ids=new Set(document.cards.map(card=>card.id)),previous=[...this.grid.children],ordered=[];
  for(const [id,host]of [...this.hosts])if(!ids.has(id))host.apply(null);
  for(const card of document.cards){let host=this.hosts.get(card.id);if(!host){host=new CardHost(this,card);this.hosts.set(card.id,host);}else host.apply(card);ordered.push(host.el);}
  // 等待保存后删除的卡片暂留原位，其余卡片仍遵循同步后的顺序。
  previous.forEach((el,index)=>{if(el.parentElement===this.grid&&!ids.has(el.dataset.cardId))ordered.splice(index,0,el);});
  this.orderCards(ordered);
  this.empty.hidden=this.hosts.size>0;this.status.setText(this.plugin.store.conflict?'配置存在冲突，请选择需要保留的版本。':this.editing?'拖动卡片排序，或使用箭头移动；通过卡片设置调整尺寸。':'');
 }
 orderCards(elements){
  const focused=this.grid.ownerDocument.activeElement?.closest?.('.desk-card'),pivot=elements.indexOf(focused);
  // 不拆下焦点所在卡片，避免丢失选区或中断输入法合成；仅移动它两侧的兄弟。
  let next=pivot<0?null:focused;
  for(let i=(pivot<0?elements.length:pivot)-1;i>=0;i--){const el=elements[i];if(el.nextSibling!==next)this.grid.insertBefore(el,next);next=el;}
  if(pivot<0)return;
  let previous=focused;
  for(let i=pivot+1;i<elements.length;i++){const el=elements[i];if(previous.nextSibling!==el)this.grid.insertBefore(el,previous.nextSibling);previous=el;}
 }
 toggleEditing(){this.editing=!this.editing;this.toolbar.hidden=!this.editing;this.root.classList.toggle('is-editing',this.editing);this.editButton.setAttribute('aria-pressed',String(this.editing));this.editButton.setAttribute('aria-label',this.editing?'完成编辑':'编辑布局');this.editButton.querySelector('span:last-child')?.setText(this.editing?'完成':'编辑布局');this.reconcile();}
 busy(id){return id?Boolean(this.hosts.get(id)?.busy()):[...this.hosts.values()].some(host=>host.busy());}
 refreshData(){for(const host of this.hosts.values())host.refreshData();}
 async onClose(){if(this.closed)return;this.closed=true;this.plugin.views.delete(this);if(this.pendingTimer)this.contentEl.ownerDocument.defaultView.clearInterval(this.pendingTimer);for(const host of this.hosts.values())host.dispose();this.hosts.clear();for(const button of this.nativeActions||[])button?.remove();this.nativeActions=[];this.contentEl.empty();}
}
