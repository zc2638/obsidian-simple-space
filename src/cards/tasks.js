import {Component,MarkdownRenderer} from 'obsidian';
import capture from './capture.cjs';
import captureFiles from '../core/capture-files.cjs';
import {readTaskSource,ensureFolder} from '../core/files.js';
import {changeTaskStatus} from '../core/tasks.js';
import {TASK_HEADER,taskStorageConfig,formatTaskEntry} from '../core/task-content.js';

async function appendQuickTask(vault,config,text){
 const storage=taskStorageConfig(config),date=new Date(),content=formatTaskEntry({text});
 let target=null;
 for(let attempt=0;attempt<100;attempt++){
  target=await captureFiles.selectTargetPath(vault,storage,date,content,target,TASK_HEADER);
  await ensureFolder(vault,target.includes('/')?target.slice(0,target.lastIndexOf('/')):'.');
  let file=vault.getAbstractFileByPath(target);
  if(!file){try{file=await vault.create(target,TASK_HEADER);}catch(error){file=vault.getAbstractFileByPath(target);if(!file)throw error;}}
  if(Array.isArray(file.children))throw new Error('待办保存路径被目录占用');
  try{
   await vault.process(file,current=>{
    if(captureFiles.needsRollover(current,content,storage,TASK_HEADER)){const error=new Error('当前文件已满');error.code='TASK_ROLLOVER';throw error;}
    return current+(current&&!current.endsWith('\n')?'\n':'')+content;
   });return target;
  }catch(error){if(error.code!=='TASK_ROLLOVER')throw error;}
 }
 throw new Error('待办文件持续变化，请稍后重试');
}

export const tasksCard={
 async render(body,ctx){
  let token=0,dragged=null,saving=false,editing=false,disposed=false,controller=null;
  const showDoing=ctx.config.showDoing!==false;
  const components=new Set(),labels=showDoing?{todo:'待办',doing:'进行中',done:'完成'}:{todo:'待办',done:'完成'};
  const create=ctx.addHeaderAction('plus','创建待办',()=>showEditor());create.addClass('ws-capture-header-action','ws-capture-create');create.createSpan({text:'创建'});
  const back=ctx.addHeaderAction('arrow-left','返回待办列表',()=>returnBoard());back.addClass('ws-capture-header-action');back.createSpan({text:'返回'});back.hidden=true;
  const list=body.createDiv({cls:'desk-task-list'}),editor=body.createDiv({cls:'desk-task-editor'});editor.hidden=true;
  const form=list.createEl('form',{cls:'desk-task-form'});
  const input=form.createEl('input',{attr:{type:'text',placeholder:'快速添加文字待办…','aria-label':'新任务',maxlength:'1000'}});
  const add=form.createEl('button',{text:'添加',attr:{type:'submit'}});
  const board=list.createDiv({cls:'hp-kanban desk-task-board'}),status=list.createDiv({cls:'desk-status',attr:{role:'status'}});
  board.style.setProperty('--desk-task-columns',String(Object.keys(labels).length));
  const say=text=>{if(!disposed&&ctx.isAlive())status.setText(text);};
  const stopMedia=element=>{for(const media of element.querySelectorAll('audio,video'))media.pause();};
  const clearDetails=()=>{stopMedia(board);for(const component of components)component.unload();components.clear();};
  ctx.registerBusyGuard(()=>saving||Boolean(input.value.trim()));
  ctx.registerCleanup(()=>{disposed=true;token++;clearDetails();});
  function showEditor(){
   if(disposed||saving||!controller||ctx.isEditing())return;
   editing=true;stopMedia(board);list.hidden=true;editor.hidden=false;create.hidden=true;back.hidden=false;controller.focus();
  }
  async function returnBoard(){
   if(disposed||saving||back.disabled||!controller)return;
   back.disabled=true;
   try{await controller.suspend();if(!disposed){editing=false;editor.hidden=true;list.hidden=false;create.hidden=false;back.hidden=true;await refresh();}}
   catch(error){editor.querySelector('.ws-capture-status')?.setText('返回失败：'+error.message);say(error.message);}
   finally{if(!disposed)back.disabled=false;}
  }
  const change=async(task,next)=>{
   if(saving)return;saving=true;
   try{
    const file=ctx.app.vault.getAbstractFileByPath(task.path);if(!file)throw new Error('来源笔记暂时不可用');
    await ctx.app.vault.process(file,text=>changeTaskStatus(text,task,next));say('');await refresh();
   }catch(error){say(error.message);}finally{saving=false;}
  };
  const refresh=async()=>{
   const generation=++token;
   try{
    const tasks=await readTaskSource(ctx.app.vault,ctx.config);
    if(disposed||!ctx.isAlive()||generation!==token)return;clearDetails();board.empty();
    for(const [state,label] of Object.entries(labels)){
     // 两状态视图合并未完成任务，仅在用户操作状态时回写原笔记。
     const column=board.createDiv({cls:'hp-kanban-column desk-task-column',attr:{'data-state':state}}),current=tasks.filter(task=>(!showDoing&&task.status==='doing'?'todo':task.status)===state);
     column.createDiv({cls:'desk-task-heading',text:`${label} ${current.length}`});
     if(!current.length)column.createDiv({cls:'desk-empty',text:'暂无任务'});
     column.ondragover=event=>{if(dragged&&!ctx.isEditing())event.preventDefault();};
     column.ondrop=event=>{if(!dragged||ctx.isEditing())return;event.preventDefault();void change(dragged,state);dragged=null;};
     for(const task of current){
      const row=column.createDiv({cls:'desk-task-row'});row.draggable=!ctx.isEditing();
      row.ondragstart=event=>{if(ctx.isEditing()||event.target?.closest?.('details')){event.preventDefault();return;}dragged=task;event.dataTransfer?.setData('text/plain','任务');};
      row.ondragend=()=>{dragged=null;};
      const title=row.createEl('button',{cls:'desk-note-link',text:task.text,attr:{type:'button',title:task.path}});title.onclick=()=>ctx.openPath(task.path,{line:task.line});
      const select=row.createEl('select',{attr:{'aria-label':`任务状态：${task.text}`}});
      for(const [value,name] of Object.entries(labels))select.createEl('option',{text:name,attr:{value}});
      select.value=state;select.onchange=async()=>{select.disabled=true;await change(task,select.value);if(ctx.isAlive())select.disabled=false;};
      if(task.detail){
       const detail=row.createEl('details',{cls:'desk-task-details'});detail.createEl('summary',{text:'查看详情与附件'});
       const content=detail.createDiv({cls:'desk-task-detail-content markdown-rendered'});let rendered=false;
       detail.ontoggle=async()=>{
        if(!detail.open){stopMedia(content);return;}
        if(rendered||disposed||!row.isConnected)return;rendered=true;
        const component=new Component();components.add(component);component.load();
        try{await MarkdownRenderer.render(ctx.app,task.detail,content,task.path,component);if(disposed||generation!==token){stopMedia(content);component.unload();components.delete(component);}}
        catch(error){if(!disposed&&generation===token)content.setText('详情加载失败：'+error.message);component.unload();components.delete(component);rendered=false;}
       };
      }
     }
    }
   }catch(error){say('读取待办失败：'+error.message);}
  };
  form.onsubmit=async event=>{
   event.preventDefault();const submitted=input.value,text=submitted.trim();if(!text||saving||editing)return;saving=true;add.disabled=true;create.disabled=true;
   try{await appendQuickTask(ctx.app.vault,ctx.config,text);if(ctx.isAlive()&&input.value===submitted)input.value='';say('');await refresh();}
   catch(error){say('保存失败：'+error.message);}finally{saving=false;if(ctx.isAlive()){add.disabled=false;create.disabled=false;}}
  };
  ctx.registerDataRefresh(refresh);create.disabled=true;
  controller=await capture.render(editor,{...ctx,widget:{id:(ctx.widget?.id||'tasks')+'-task'},config:taskStorageConfig(ctx.config),composer:{editorOnly:true,noun:'待办',noteHeader:TASK_HEADER,formatContent:formatTaskEntry,
   onSaved:async()=>{if(disposed)return;editing=false;editor.hidden=true;list.hidden=false;create.hidden=false;back.hidden=true;await refresh();}},
   addHeaderAction:()=>{throw new Error('待办编辑器不能创建重复标题操作');}});
  if(!disposed){create.disabled=false;await refresh();}
 }
};
