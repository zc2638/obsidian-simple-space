import {taskStorageConfig} from './task-content.js';
const doingMarker=/\s*<!--\s*desk:doing\s*-->/g;
const taskPattern=/^(\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+\[)([ xX/\-])(\]\s+)(.*)$/;
function lineContext(raw){
 const prefix=raw.match(/^[ \t]*(?:>[ \t]*)*/)[0];
 return {depth:(prefix.match(/>/g)||[]).length,indent:prefix.match(/[ \t]*$/)[0],body:raw.slice(prefix.length)};
}
function continuationContext(raw,depth){
 let body=raw;
 for(let i=0;i<depth;i++){
  const quote=body.match(/^[ \t]*>/);if(!quote)return null;
  body=body.slice(quote[0].length);
 }
 const indent=body.match(/^[ \t]*/)[0];
 return {indent,body:body.slice(indent.length)};
}
export function parseTasks(markdown,path){
 const result=[];let fence=null,active=null;
 const finish=()=>{
  if(!active)return;
  const lines=active.lines;
  while(lines.length&&!lines.at(-1).body.trim())lines.pop();
  while(lines.length&&!lines[0].body.trim())lines.shift();
  if(lines.length){
   const indent=lines.reduce((min,item)=>item.body.trim()?Math.min(min,item.indent.length):min,Infinity);
   active.task.detail=lines.map(item=>item.body.trim()?item.indent.slice(indent)+item.body:'').join('\n');
  }
  active=null;
 };
 for(const [line,raw] of markdown.split(/\r?\n/).entries()){
  if(fence&&raw.trim()&&!continuationContext(raw,fence.depth))fence=null;
  if(fence?.container&&raw.trim()){
   const continuation=continuationContext(raw,fence.container.depth);
   // 列表内的代码围栏随任务缩进容器结束，未闭合输入不能遮住下一次提交。
   if(!continuation||(continuation.body.trim()&&continuation.indent.length<=fence.container.indent))fence=null;
  }
  const context=lineContext(raw),block=(fence?continuationContext(raw,fence.depth)?.body:context.body)?.match(/^(`{3,}|~{3,})(.*)$/);
  const match=!fence&&!block?raw.match(taskPattern):null;
  if(active){
   const continuation=continuationContext(raw,active.depth);
   if(match||(!continuation&&raw.trim())||(continuation?.body.trim()&&continuation.indent.length<=active.indent))finish();
   else active.lines.push(continuation??{indent:'',body:''});
  }
  if(fence){if(block&&block[1][0]===fence.char&&block[1].length>=fence.length&&!block[2].trim())fence=null;continue;}
  if(block){fence={char:block[1][0],length:block[1].length,depth:context.depth,container:active?{depth:active.depth,indent:active.indent}:null};continue;}
  if(!match)continue;
  const status=/[xX]/.test(match[2])?'done':match[2]==='/'||match[2]==='-'||/<!--\s*desk:doing\s*-->/.test(match[4])?'doing':'todo';
  const task={path,line,original:raw,text:match[4].replace(doingMarker,'').trim(),status};
  result.push(task);active={task,depth:context.depth,indent:context.indent.length,lines:[]};
 }
 finish();
 return result;
}
export function changeTaskStatus(markdown,task,status){
 if(!['todo','doing','done'].includes(status))throw new Error('无效的任务状态');
 const tasks=parseTasks(markdown,task.path),same=tasks.filter(item=>item.original===task.original);
 let found=same.find(item=>item.line===task.line);
 if(!found){if(same.length!==1)throw new Error(same.length?'任务位置重复，无法准确定位，请刷新':'任务已被修改，请刷新后重试');found=same[0];}
 const lines=markdown.split(/(\r?\n)/),match=found.original.match(taskPattern);
 const body=match[4].replace(doingMarker,'').trimEnd();
 lines[found.line*2]=match[1]+(status==='done'?'x':' ')+match[3]+body+(status==='doing'?' <!-- desk:doing -->':'');
 return lines.join('');
}
export function withinFolder(path,folder){return !folder||folder==='.'||path.startsWith(folder+'/');}
const escapePattern=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const parent=path=>path.includes('/')?path.slice(0,path.lastIndexOf('/')):'.';
function noteFamily(path,base){return new RegExp('^'+escapePattern(base.replace(/\.md$/i,''))+'(?:-\\d{3,})?\\.md$','i').test(path);}
function periodFile(path,mode){
 const patterns={year:/^\d{4}(?:-\d{3,})?\.md$/i,quarter:/^\d{4}-Q[1-4](?:-\d{3,})?\.md$/i,month:/^\d{4}-(?:0[1-9]|1[0-2])(?:-\d{3,})?\.md$/i,day:/^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])(?:-\d{3,})?\.md$/i};
 const match=path.match(patterns[mode]||/$^/);if(!match)return false;
 if(mode!=='day')return true;
 const date=new Date(Number(match[1]),Number(match[2])-1,Number(match[3]));
 return date.getFullYear()===Number(match[1])&&date.getMonth()===Number(match[2])-1&&date.getDate()===Number(match[3]);
}
export function taskFiles(files,config={}){
 const storage=taskStorageConfig(config),sourceType=config.sourceType??'folder',source=config.source??storage.noteFolder;
 const attachmentFolder=(storage.noteFolder==='.'?'':storage.noteFolder+'/')+'附件';
 const target=(storage.noteFolder==='.'?'':storage.noteFolder+'/')+storage.notePath.slice(storage.notePath.lastIndexOf('/')+1);
 return files.filter(file=>{
  if(withinFolder(file.path,attachmentFolder))return false;
  if(sourceType==='folder'?withinFolder(file.path,source):file.path===source)return true;
  if(noteFamily(file.path,storage.notePath)||noteFamily(file.path,target))return true;
  // 旧单文件来源不扩大到保存根中恰好按日期命名的其他笔记。
  return config.saveMode!=null&&storage.saveMode!=='single'&&parent(file.path)===storage.noteFolder&&periodFile(file.path.slice(file.path.lastIndexOf('/')+1),storage.saveMode);
 });
}
