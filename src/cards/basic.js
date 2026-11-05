import {setIcon,getAllTags} from 'obsidian';
import {withinFolder} from '../core/tasks.js';

function empty(body,text){body.createDiv({cls:'desk-empty',text});}
function openButton(body,text,path,ctx){
 const button=body.createEl('button',{cls:'hp-list-row is-clickable desk-note-link',attr:{type:'button',title:path}});
 setIcon(button.createSpan({cls:'hp-list-icon'}),'file-text');
 button.createDiv({cls:'hp-list-text'}).createSpan({cls:'hp-list-title',text});
 button.onclick=()=>ctx.openPath(path);return button;
}
export const linksCard={
 render(body,ctx){
  const grid=body.createDiv({cls:'hp-quicklinks desk-links'});grid.style.setProperty('--desk-link-columns',String(ctx.config.columns));grid.style.setProperty('--hp-cols',String(ctx.config.columns));
  if(!ctx.config.items.length)empty(grid,'点击卡片设置，添加常用笔记或链接。');
  for(const [index,item] of ctx.config.items.entries()){
   const button=grid.createEl('button',{cls:`hp-quicklink is-clickable hp-tone-${index%4}`,attr:{type:'button',title:item.url}});
   setIcon(button.createSpan({cls:'hp-quicklink-icon'}),item.icon||(/^(https?:|mailto:)/i.test(item.url)?'external-link':'file-text'));
   button.createSpan({cls:'hp-quicklink-label',text:item.title});
   button.onclick=()=>ctx.openPath(item.url);
  }
 }
};
export const recentCard={
 render(body,ctx){
  const list=body.createDiv({cls:'hp-list desk-note-list'});
  const refresh=()=>{
   if(!ctx.isAlive())return;list.empty();
   const {folder,excludeFolders,sort,limit}=ctx.config;
   const files=ctx.app.vault.getMarkdownFiles().filter(file=>withinFolder(file.path,folder)&&!excludeFolders.some(path=>withinFolder(file.path,path)));
   const key=sort==='created'?'ctime':'mtime';files.sort((a,b)=>(b.stat?.[key]||0)-(a.stat?.[key]||0)||a.path.localeCompare(b.path));
   if(!files.length)empty(list,'这里会显示最近的笔记。');
   for(const file of files.slice(0,limit)){
    const button=openButton(list,file.basename||file.path.split('/').at(-1).replace(/\.md$/i,''),file.path,ctx);
    button.createSpan({cls:'hp-list-meta desk-note-meta',text:new Date(file.stat?.[key]||Date.now()).toLocaleDateString()+' · '+file.path});
   }
  };
  refresh();ctx.registerDataRefresh(refresh);
 }
};
export {tasksCard} from './tasks.js';
export const statsCard={
 async render(body,ctx){
  const grid=body.createDiv({cls:'hp-stats desk-stats'}),message=body.createDiv({cls:'desk-status'});let token=0;
  grid.style.setProperty('--hp-cols','2');
  const names={notes:'篇笔记',tags:'个标签',words:'字 / 词',attachments:'个附件'};
  const refresh=async()=>{
   const generation=++token;
   try{
    const files=ctx.app.vault.getMarkdownFiles(),totals={notes:files.length,tags:0,words:0,attachments:0},tags=new Set();
    if(ctx.config.metrics.includes('attachments')){
     const allFiles=ctx.app.vault.getFiles?.()??ctx.app.vault.getAllLoadedFiles?.()??[];
     totals.attachments=allFiles.filter(file=>!Array.isArray(file.children)&&typeof file.path==='string'&&file.path!=='/'&&!/\.md$/iu.test(file.path)).length;
    }
    for(const file of files){
     if(!ctx.isAlive()||generation!==token)return;
     if(ctx.config.metrics.includes('tags'))for(const tag of getAllTags(ctx.app.metadataCache.getFileCache(file))||[])tags.add(tag);
     if(ctx.config.metrics.includes('words')){
      const cached=ctx.wordCounts.get(file.path),stamp=`${file.stat?.mtime}:${file.stat?.size}`;
      let words=cached?.stamp===stamp?cached.words:null;
      if(words===null){const text=await ctx.app.vault.cachedRead(file);words=(text.match(/[\u3400-\u9fff]|[\p{L}\p{N}_]+/gu)||[]).length;ctx.wordCounts.set(file.path,{stamp,words});}
      totals.words+=words;
     }
    }
    totals.tags=tags.size;if(!ctx.isAlive()||generation!==token)return;grid.empty();message.setText('');
    for(const [index,key] of ctx.config.metrics.entries()){const cell=grid.createDiv({cls:`hp-stat desk-stat hp-tone-${index%4}`});cell.createDiv({text:totals[key].toLocaleString(),cls:'hp-stat-value desk-stat-number'});cell.createDiv({text:names[key],cls:'hp-stat-label desk-note-meta'});}
   }catch(error){if(ctx.isAlive())message.setText('统计失败：'+error.message);}
  };
  ctx.registerDataRefresh(refresh);await refresh();
 }
};
