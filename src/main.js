import {Plugin,Notice} from 'obsidian';
import {WorkspaceStore} from './core/config-store.js';
import {DeviceDraftAdapter} from './core/device-drafts.js';
import {createCard,validateDocument,configPath} from './core/model.js';
import {DeskView,VIEW_TYPE} from './view.js';
import {DeskSettings} from './settings.js';
import {CardSettingsModal,ImportModal,ExportModal,ConflictModal,DiscoveryModal} from './modals.js';

export default class SimpleSpacePlugin extends Plugin{
 async onload(){
  this.views=new Set();this.wordCounts=new Map();this.active=true;this.errorTimes=new Map();this.configTimer=null;this.dataTimer=null;this.discoveryTimer=null;this.conflictModal=null;
  let deviceKey=this.app.loadLocalStorage('simple-space-device-key');
  if(typeof deviceKey!=='string'){deviceKey=globalThis.crypto.randomUUID();this.app.saveLocalStorage('simple-space-device-key',deviceKey);}
  this.drafts=new DeviceDraftAdapter(deviceKey);
  const adapter=this.app.vault.adapter;
  this.store=new WorkspaceStore({loadData:()=>this.loadData(),saveData:data=>this.saveData(data),exists:path=>adapter.exists(path),read:path=>adapter.read(path),write:(path,text)=>adapter.write(path,text),
   mkdir:async path=>{if(await adapter.exists(path)){if((await adapter.stat(path))?.type!=='folder')throw new Error(`${path} 是文件，不能创建目录`);return;}try{await adapter.mkdir(path);}catch(error){if((await adapter.stat(path))?.type!=='folder')throw error;}},
   backup:async record=>{await this.drafts.mkdir('conflicts');await this.drafts.write(`conflicts/${Date.now()}-${globalThis.crypto.randomUUID()}.json`,JSON.stringify(record));},
   loadCheckpoint:async()=>await this.drafts.exists('configuration/checkpoint.json')?JSON.parse(await this.drafts.read('configuration/checkpoint.json')):null,
   saveCheckpoint:async record=>{await this.drafts.mkdir('configuration');await this.drafts.write('configuration/checkpoint.json',JSON.stringify(record));}
  },{onChange:()=>{if(this.active)this.refreshViews();},onConflict:()=>{if(this.active){this.refreshViews();queueMicrotask(()=>this.showConflict());}},onError:error=>this.showError(error)});
  this.ready=this.store.init();await this.ready;
  this.registerView(VIEW_TYPE,leaf=>new DeskView(leaf,this));
  this.addRibbonIcon('home','打开工作台',()=>void this.openWorkspace());
  this.addCommand({id:'open-workspace',name:'打开工作台',callback:()=>void this.openWorkspace()});
  this.addCommand({id:'add-card',name:'添加卡片',callback:()=>new CardSettingsModal(this.app,this).open()});
  this.addCommand({id:'import-config',name:'导入工作台配置',callback:()=>new ImportModal(this.app,this).open()});
  this.addCommand({id:'export-config',name:'导出工作台配置',callback:()=>new ExportModal(this.app,this).open()});
  this.addCommand({id:'resolve-conflict',name:'处理工作台配置冲突',callback:()=>this.showConflict()});
  this.addCommand({id:'discover-config',name:'查找工作台配置文件',callback:()=>void this.discoverConfigurations(true)});
  this.addSettingTab(new DeskSettings(this.app,this));
  const changed=(file,oldPath)=>{
   const path=file?.path||'',old=oldPath||'';
   if(this.store.settings.mode==='folder'){
    const target=configPath(this.store.settings.folder);if(path===target||old===target||target.startsWith(path+'/')||old&&target.startsWith(old+'/'))this.scheduleConfigRead();
   }
   if(file?.extension==='md'||path.endsWith('.md')||old.endsWith('.md'))this.scheduleDataRefresh();
   if((path==='workspace.json'||path.endsWith('/workspace.json'))&&this.store.settings.mode==='plugin')this.scheduleDiscovery();
  };
  for(const event of ['modify','create','delete','rename'])this.registerEvent(this.app.vault.on(event,changed));
  this.registerEvent(this.app.metadataCache.on('resolved',()=>this.scheduleDataRefresh()));
  this.registerInterval(window.setInterval(()=>void this.store.externalChange(),30000));
  this.app.workspace.onLayoutReady(async()=>{if(!this.active)return;if(this.store.settings.openOnStartup)await this.openWorkspace();await this.discoverConfigurations(false);});
 }
 async onUserEnable(){await this.ready;if(this.active)await this.openWorkspace();}
 showError(error){if(!this.active)return;const text=error?.message||String(error),now=Date.now();if(now-(this.errorTimes.get(text)||0)<10000)return;this.errorTimes.set(text,now);new Notice(`Simple Space：${text}`,7000);}
 async attempt(operation){try{return await operation();}catch(error){this.showError(error);this.refreshViews();if(error?.code==='WORKSPACE_CONFLICT')this.showConflict();return false;}}
 refreshViews(){for(const view of this.views)view.reconcile();}
 async openWorkspace(){
  await this.ready;if(!this.active)return;
  const existing=this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
  if(existing){await this.app.workspace.revealLeaf(existing);return existing.view;}
  const leaf=this.app.workspace.getLeaf('tab');await leaf.setViewState({type:VIEW_TYPE,active:true});await this.app.workspace.revealLeaf(leaf);return leaf.view;
 }
 async openPath(path,options={}){
  if(/^(https?:|obsidian:|mailto:)/i.test(path)){window.open(path,'_blank','noopener,noreferrer');return;}
  const file=this.app.vault.getAbstractFileByPath(path);
  if(file&&!Array.isArray(file.children)){const leaf=this.app.workspace.getLeaf('tab');await leaf.openFile(file,{active:true,eState:typeof options.line==='number'?{line:options.line}:undefined});return;}
  await this.app.workspace.openLinkText(path,'',true);
 }
 busy(id){return [...this.views].some(view=>view.busy(id));}
 requireIdle(id){if(this.busy(id))throw new Error('请先保存正在编辑的内容或停止录音，再修改来源、导入或删除卡片。');}
 async update(mutator){return this.attempt(()=>this.store.update(mutator));}
 async addCard(type){return this.update(doc=>{doc.cards.push(createCard(type));});}
 async saveCard(card){
  const prior=this.store.document.cards.find(item=>item.id===card.id);
  if(prior&&(prior.type!==card.type||JSON.stringify(prior.config)!==JSON.stringify(card.config)))this.requireIdle(card.id);
  const result=await this.store.update(doc=>{const index=doc.cards.findIndex(item=>item.id===card.id);if(index<0)doc.cards.push(card);else doc.cards[index]=card;});return result;
 }
 async removeCard(id){return this.attempt(async()=>{this.requireIdle(id);await this.store.update(doc=>{doc.cards=doc.cards.filter(card=>card.id!==id);});return true;});}
 async moveCard(id,delta){const cards=this.store.document.cards,index=cards.findIndex(card=>card.id===id);return this.moveCardTo(id,index+delta);}
 async moveCardTo(id,to){
  const cards=this.store.document.cards,from=cards.findIndex(card=>card.id===id);to=Math.max(0,Math.min(cards.length-1,to));if(from<0||from===to)return;
  return this.update(doc=>{const at=doc.cards.findIndex(card=>card.id===id);if(at<0)return;const [card]=doc.cards.splice(at,1);doc.cards.splice(to,0,card);});
 }
 async resizeCard(id,w,h){return this.update(doc=>{const card=doc.cards.find(item=>item.id===id);if(card){card.w=Math.max(1,Math.min(12,w));card.h=Math.max(1,Math.min(24,h));}});}
 async importConfig(document){this.requireIdle();await this.store.replace(validateDocument(document));return true;}
 async changeStorage(input){this.requireIdle();await this.store.switchStorage(input);this.refreshViews();return true;}
 async resolveConflict(choice){await this.store.resolveConflict(choice);this.refreshViews();return true;}
 showConflict(){
  if(!this.active||!this.store?.conflict)return;
  if(this.conflictModal){this.conflictModal.onOpen();return;}
  const modal=new ConflictModal(this.app,this);this.conflictModal=modal;const closed=modal.onClose?.bind(modal);modal.onClose=()=>{closed?.();this.conflictModal=null;};modal.open();
 }
 scheduleConfigRead(){if(this.configTimer)window.clearTimeout(this.configTimer);this.configTimer=window.setTimeout(()=>{this.configTimer=null;if(this.active)void this.store.externalChange();},250);}
 scheduleDataRefresh(){if(this.dataTimer)window.clearTimeout(this.dataTimer);this.dataTimer=window.setTimeout(()=>{this.dataTimer=null;for(const view of this.views)view.refreshData();},350);}
 scheduleDiscovery(){if(this.discoveryTimer)window.clearTimeout(this.discoveryTimer);this.discoveryTimer=window.setTimeout(()=>{this.discoveryTimer=null;if(this.active)void this.discoverConfigurations(false);},1000);}
 async discoverConfigurations(force=false){
  if(!this.active||this.discoveryOpen)return;
  if(!force&&this.store.settings.mode!=='plugin')return;
  const candidates=[];
  for(const file of this.app.vault.getAllLoadedFiles()){
   if(!file.path||!(file.path==='workspace.json'||file.path.endsWith('/workspace.json'))||Array.isArray(file.children))continue;
   try{const text=await this.app.vault.read(file);if(text.length>2_000_000)continue;const document=validateDocument(JSON.parse(text));candidates.push({path:file.path,document});}catch{}
  }
  if(!this.active)return;
  if(!candidates.length){if(force)new Notice('没有找到 Simple Space 的 workspace.json 配置文件。');return;}
  const fingerprint=candidates.map(item=>item.path).sort().join('\n');
  if(!force&&this.app.loadLocalStorage('simple-space-discovery-seen')===fingerprint)return;
  this.app.saveLocalStorage('simple-space-discovery-seen',fingerprint);this.discoveryOpen=true;
  const modal=new DiscoveryModal(this.app,this,candidates);const closed=modal.onClose?.bind(modal);modal.onClose=()=>{closed?.();this.discoveryOpen=false;};modal.open();
 }
 async onExternalSettingsChange(){await this.ready;if(this.active)await this.store.externalChange();}
 async onunload(){
  if(!this.active)return;this.active=false;
  for(const timer of [this.configTimer,this.dataTimer,this.discoveryTimer])if(timer)window.clearTimeout(timer);
  this.conflictModal?.close();for(const view of [...this.views])await view.onClose();
  for(const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE))leaf.detach();
  const registry=this.app[Symbol.for('workspace-capture-drafts')];if(registry?.closing)await Promise.allSettled([...registry.closing]);
  await this.drafts?.close();
 }
}
