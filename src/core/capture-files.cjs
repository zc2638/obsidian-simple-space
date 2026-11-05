const NOTE_HEADER='# 灵感收件箱\n\n';
const modes=['year','quarter','month','day','single'];
const bytes=value=>new TextEncoder().encode(value).byteLength;
const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const parent=path=>path.includes('/')?path.slice(0,path.lastIndexOf('/')):'.';
const name=path=>path.slice(path.lastIndexOf('/')+1);
const under=(folder,file)=>(folder==='.'?'':folder+'/')+file;
function cleanPath(value,folder=false){
 if(typeof value!=='string')throw new Error('灵感路径必须是文本');
 const result=value.trim().replace(/\/+$/,'');
 if(folder&&result==='.')return result;
 if(!result||result.startsWith('/')||/[\\<>:"|?*\u0000-\u001f]/.test(result)||result.split('/').some(part=>!part||part==='.'||part==='..'||/[. ]$/.test(part)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)))throw new Error('灵感路径必须位于当前仓库内且名称有效');
 if(!folder&&!/\.md$/i.test(result))throw new Error('灵感笔记必须以 .md 结尾');
 return result;
}
function normalizeCaptureConfig(input={}){
 const notePath=cleanPath(input.notePath??'Simple Space/即时灵感/灵感.md');
 const config={saveMode:input.saveMode??'single',noteFolder:cleanPath(input.noteFolder??(input.notePath==null?'Simple Space/即时灵感':notePath.replace(/\.md$/i,'')||'Simple Space/即时灵感'),true),notePath,
  attachmentFolder:cleanPath(input.attachmentFolder??'Simple Space/即时灵感/附件',true),splitBySize:input.splitBySize??true,maxFileSizeKB:input.maxFileSizeKB??1024};
 if(!modes.includes(config.saveMode))throw new Error('灵感保存方式无效');
 if(typeof config.splitBySize!=='boolean'||!Number.isInteger(config.maxFileSizeKB)||config.maxFileSizeKB<1||config.maxFileSizeKB>1048576)throw new Error('灵感续卷大小必须是 1–1048576 的整数 KB');
 return config;
}
function targetBasePath(input,date){
 const config=normalizeCaptureConfig(input);if(!date||!Number.isFinite(date.getTime()))throw new Error('灵感日期无效');
 if(config.saveMode==='single')return under(config.noteFolder,name(config.notePath));
 const year=String(date.getFullYear()).padStart(4,'0'),month=String(date.getMonth()+1).padStart(2,'0'),day=String(date.getDate()).padStart(2,'0');
 const bucket=config.saveMode==='year'?year:config.saveMode==='quarter'?`${year}-Q${Math.floor(date.getMonth()/3)+1}`:config.saveMode==='day'?`${year}-${month}-${day}`:`${year}-${month}`;
 return (config.noteFolder==='.'?'':config.noteFolder+'/')+bucket+'.md';
}
function attachmentDirectory(notePath){return under(parent(cleanPath(notePath)),'附件/'+name(notePath).replace(/\.md$/i,''));}
function partInfo(path){
 const stem=path.replace(/\.md$/i,''),raw=stem.match(/^(.*)-(\d{3,})$/),match=raw&&Number.isSafeInteger(Number(raw[2]))?raw:null;
 return match?{base:match[1]+'.md',sequence:Number(match[2])}:{base:path,sequence:1};
}
function periodEnd(path){
 const stem=name(partInfo(path).base).replace(/\.md$/i,'');
 const match=stem.match(/^(\d{4})(?:-Q([1-4])|-(0[1-9]|1[0-2])(?:-(0[1-9]|[12]\d|3[01]))?)?$/);
 if(!match)return null;
 const year=Number(match[1]),quarter=Number(match[2]),month=Number(match[3]),day=Number(match[4]);
 const end=quarter?new Date(year,quarter*3,0,23,59,59,999):day?new Date(year,month-1,day,23,59,59,999):month?new Date(year,month,0,23,59,59,999):new Date(year,11,31,23,59,59,999);
 if(day&&(end.getMonth()!==month-1||end.getDate()!==day))return null;
 return end.getTime();
}
function singleInfo(config,path){
 for(const base of new Set([under(config.noteFolder,name(config.notePath)),config.notePath])){
  const match=path.match(new RegExp('^'+escape(base.replace(/\.md$/i,''))+'(?:-(\\d{3,}))?\\.md$','i'));
  if(match)return {base,sequence:match[1]&&Number.isSafeInteger(Number(match[1]))?Number(match[1]):1};
 }
 return null;
}
function isCapturePath(input,path){
 const config=normalizeCaptureConfig(input);if(typeof path!=='string'||!/\.md$/i.test(path))return false;
 return Boolean(singleInfo(config,path))||(parent(path)===config.noteFolder&&periodEnd(path)!==null);
}
async function directoryFiles(vault,folder){
 if(typeof vault.getMarkdownFiles==='function')return vault.getMarkdownFiles().filter(file=>parent(file.path)===folder).map(file=>file.path);
 if(!vault.adapter?.list)return [];
 if(folder!=='.'&&vault.adapter.exists&&!await vault.adapter.exists(folder))return [];
 return (await vault.adapter.list(folder==='.'?'':folder)).files;
}
async function candidatePaths(vault,input,extra=[]){
 const config=normalizeCaptureConfig(input),all=new Set();
 for(const folder of new Set([config.noteFolder,parent(config.notePath)]))for(const path of await directoryFiles(vault,folder))if(isCapturePath(config,path))all.add(path);
 for(const path of [config.notePath,under(config.noteFolder,name(config.notePath)),...extra]){
  if(!path)continue;cleanPath(path);
  if(vault.getAbstractFileByPath(path)||await vault.adapter?.exists?.(path))all.add(path);
 }
 return [...all];
}
async function readNote(vault,path,cached=false){
 const file=vault.getAbstractFileByPath(path);
 if(file){if(Array.isArray(file.children))throw new Error(`灵感笔记路径被目录占用：${path}`);return cached&&vault.cachedRead?vault.cachedRead(file):vault.read(file);}
 if(await vault.adapter?.exists?.(path))return vault.adapter.read(path);
 return null;
}
function needsRollover(current,content,input,header=NOTE_HEADER){
 const config=normalizeCaptureConfig(input);
 return config.splitBySize&&Boolean(current.trim())&&current.trim()!==header.trim()&&bytes(current+content)>config.maxFileSizeKB*1024;
}
async function selectTargetPath(vault,input,date,content,pinned=null,header=NOTE_HEADER){
 const config=normalizeCaptureConfig(input),single=under(config.noteFolder,name(config.notePath));
 if(pinned&&(parent(cleanPath(pinned))!==config.noteFolder||!isCapturePath(config,pinned)))pinned=null;
 const singleMatch=pinned?.match(new RegExp('^'+escape(single.replace(/\.md$/i,''))+'(?:-(\\d{3,}))?\\.md$','i'));
 const base=pinned?(singleMatch?single:partInfo(pinned).base):targetBasePath(config,date);
 if(!config.splitBySize)return pinned||base;
 const matcher=new RegExp('^'+escape(base.replace(/\.md$/i,''))+'(?:-(\\d{3,}))?\\.md$','i');
 let sequence=singleMatch?(singleMatch[1]?Number(singleMatch[1]):1):pinned?partInfo(pinned).sequence:1;
 for(const path of await directoryFiles(vault,parent(base))){const match=path.match(matcher);if(match){const found=match[1]?Number(match[1]):1;if(Number.isSafeInteger(found))sequence=Math.max(sequence,found);}}
 if(sequence>=Number.MAX_SAFE_INTEGER)throw new Error('灵感续卷数量超限');
 const path=sequence===1?base:base.replace(/\.md$/i,'')+'-'+String(sequence).padStart(3,'0')+'.md';
 const current=await readNote(vault,path);
 return current!==null&&needsRollover(current,content,config,header)?base.replace(/\.md$/i,'')+'-'+String(sequence+1).padStart(3,'0')+'.md':path;
}
function entryTime(date){
 const match=String(date).match(/(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
 return match?new Date(Number(match[1]),Number(match[2])-1,Number(match[3]),Number(match[4]),Number(match[5]),Number(match[6]||0)).getTime():0;
}
async function readRecentEntries(vault,input,parseEntries,{limit=5,cache=new Map()}={}){
 const config=normalizeCaptureConfig(input),paths=await candidatePaths(vault,config),entries=[];
 const sources=paths.map(path=>{const single=singleInfo(config,path);return {path,bound:single?Infinity:parent(path)===config.noteFolder?periodEnd(path)??Infinity:Infinity,sequence:single?.sequence??partInfo(path).sequence,file:vault.getAbstractFileByPath(path)};});
 sources.sort((a,b)=>b.bound-a.bound||b.sequence-a.sequence||b.path.localeCompare(a.path));
 for(const source of sources){
  entries.sort((a,b)=>b.time-a.time||b.modified-a.modified||b.sequence-a.sequence||b.line-a.line||a.path.localeCompare(b.path));
  if(entries.length>=limit&&source.bound<entries[limit-1].time)break;
  const stamp=source.file?.stat?`${source.file.stat.mtime}:${source.file.stat.size}`:null;
  let parsed=stamp!==null&&cache.get(source.path)?.stamp===stamp?cache.get(source.path).entries:null;
  if(!parsed){
   const text=await readNote(vault,source.path,true);if(text===null)continue;
   parsed=parseEntries(text).map(entry=>{const {lines,...summary}=entry;return {...summary,summary:typeof entry.summary==='string'?entry.summary.slice(0,600):'',time:entryTime(entry.date)};}).sort((a,b)=>b.time-a.time||b.line-a.line).slice(0,limit);
   if(stamp!==null)cache.set(source.path,{stamp,entries:parsed});
  }
  for(const entry of parsed)entries.push({...entry,path:source.path,sequence:source.sequence,modified:source.file?.stat?.mtime||0});
 }
 const current=new Set(paths);for(const path of cache.keys())if(!current.has(path))cache.delete(path);
 return entries.sort((a,b)=>b.time-a.time||b.modified-a.modified||b.sequence-a.sequence||b.line-a.line||a.path.localeCompare(b.path)).slice(0,limit);
}
async function committedIds(vault,input,ids,extra=[]){
 const requested=new Set(ids),found=new Set();if(!requested.size)return found;
 for(const path of await candidatePaths(vault,input,extra)){
  const text=await readNote(vault,path);if(text===null)continue;
  for(const id of requested)if(text.includes(`<!-- workspace-capture:${id} -->`)){found.add(id);requested.delete(id);}
  if(!requested.size)break;
 }
 return found;
}
async function findCommittedPath(vault,input,ids,extra=[]){
 if(!ids.length)return null;
 const paths=[...new Set([...extra.filter(Boolean),...await candidatePaths(vault,input)])];
 for(const path of paths){cleanPath(path);const text=await readNote(vault,path);if(text!==null&&ids.some(id=>text.includes(`<!-- workspace-capture:${id} -->`)))return path;}
 return null;
}
module.exports={NOTE_HEADER,normalizeCaptureConfig,targetBasePath,attachmentDirectory,isCapturePath,candidatePaths,needsRollover,selectTargetPath,readRecentEntries,committedIds,findCommittedPath,byteLength:bytes};
