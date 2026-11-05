import {PluginSettingTab, Setting, Notice} from 'obsidian';
import {normalizeDirectory, configPath} from './core/model.js';
import {FolderModal, ImportModal, ExportModal, ConflictModal} from './modals.js';

export class DeskSettings extends PluginSettingTab {
 constructor(app,plugin) { super(app,plugin);this.plugin=plugin;this.busy=false; }
 display() {
  const body=this.containerEl;body.replaceChildren();
  body.createEl('h2',{text:'Simple Space'});
  body.createEl('p',{text:'配置只保存布局与卡片设置。笔记正文和附件保存在各卡片指定的仓库位置。'});
  const errorEl=body.createEl('p',{attr:{class:'desk-inline-error',role:'alert'}});
  const settings=this.plugin.store.settings;
  let mode=settings.mode,folder=settings.folder,folderInput;
  const run=async operation=>{
   if(this.busy)return;
   this.busy=true;errorEl.textContent='';
   const controls=[...body.querySelectorAll('button,input,select,textarea')].map(element=>[element,element.disabled]);controls.forEach(([element])=>{element.disabled=true;});
   try{await operation();}catch(error){errorEl.textContent=error?.message||String(error);}
   finally{this.busy=false;controls.forEach(([element,disabled])=>{element.disabled=disabled;});}
  };
  new Setting(body).setName('配置存储位置').setDesc('新安装默认使用 Simple Space/workspace.json，随普通文件同步；也可切回插件配置目录。').addDropdown(dropdown=>{
   dropdown.addOption('plugin','插件配置目录').addOption('folder','仓库目录中的 workspace.json').setValue(mode).onChange(value=>{mode=value;});
   dropdown.selectEl.setAttribute('aria-label','配置存储位置');
  });
  new Setting(body).setName('配置目录').setDesc('填写仓库相对目录，或使用 . 表示仓库根目录。新目录只在点击应用时创建。').addText(text=>{
   text.setValue(folder).setPlaceholder('例如：Simple Space，或 .').onChange(value=>{folder=value;});
   text.inputEl.setAttribute('aria-label','配置目录');folderInput=text.inputEl;
  }).addButton(button=>button.setButtonText('选择已有目录').onClick(()=>{
   new FolderModal(this.app,value=>{folder=value;folderInput.value=value;}).open();
  }));
  new Setting(body).setName('应用配置位置').setDesc(`当前：${settings.mode==='folder'?configPath(settings.folder):'插件配置目录'}。已有配置会在应用后加载。`).addButton(button=>button.setButtonText('应用存储设置').setCta().onClick(()=>run(async()=>{
   const target={mode,folder:normalizeDirectory(folder)};
   const result=await this.plugin.changeStorage(target);
   if(result===false)throw Error('存储设置尚未应用，请先完成正在编辑的内容后重试');
   new Notice('Simple Space 存储设置已应用');this.display();
  })));
  new Setting(body).setName('启动时打开 Simple Space').setDesc('在 Obsidian 工作区就绪后打开工作台。').addToggle(toggle=>{
   toggle.setValue(settings.openOnStartup).onChange(value=>run(async()=>{
    try{await this.plugin.store.updateSettings({openOnStartup:value});}
    finally{toggle.setValue(this.plugin.store.settings.openOnStartup);}
   }));
   (toggle.toggleEl||toggle.inputEl)?.setAttribute('aria-label','启动时打开 Simple Space');
  });
  new Setting(body).setName('发现配置').setDesc('搜索仓库中的有效 workspace.json，由你选择是否使用。').addButton(button=>button.setButtonText('发现已有配置').onClick(()=>run(()=>this.plugin.discoverConfigurations(true))));
  new Setting(body).setName('导入与导出').setDesc('导入前可预览卡片；导出不包含笔记正文和附件。').addButton(button=>button.setButtonText('导入配置').onClick(()=>new ImportModal(this.app,this.plugin).open())).addButton(button=>button.setButtonText('导出配置').onClick(()=>new ExportModal(this.app,this.plugin).open()));
  if(this.plugin.store.conflict)new Setting(body).setName('配置同步冲突').setDesc('此设备和同步配置均已保留，请选择要使用的版本。').addButton(button=>button.setButtonText('处理配置冲突').onClick(()=>new ConflictModal(this.app,this.plugin).open()));
 }
}
