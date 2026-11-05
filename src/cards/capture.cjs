const captureFiles=require('../core/capture-files.cjs');

// 两份快照交替覆盖，录音块独立写入；异常退出时不依赖任何退出回调。
async function openCaptureDraft(ctx,snapshot,config){
 const vault=ctx.app.vault,adapter=ctx.draftAdapter;
 if(!adapter)throw new Error('设备私有草稿存储不可用');
 const root='drafts';
 const owner=ctx.widget?.id||'workspace-capture';
 const registryKey=Symbol.for('workspace-capture-drafts');
 const registry=ctx.app[registryKey]||(ctx.app[registryKey]={active:new Set(),closing:new Set()});
 await Promise.allSettled([...registry.closing]);
 const uid=()=>`${Date.now()}-${Math.random().toString(36).slice(2,12)}`;
 const validId=id=>typeof id==='string'&&/^[\w-]+$/.test(id);
 const marker=id=>`<!-- workspace-capture:${id} -->`;
 const contentKey=data=>JSON.stringify([data.text,data.attachments.map(a=>[a.id,a.name??a.file.name,a.type??a.file.type])]);
 // v1 标记没有绑定内容版本，无法排除提交后又编辑；保守恢复，交由用户决定是否保存。
 const commitIds=state=>state.version===2&&state.submission?[state.submission.id]:[];
 async function mkdir(folder){
  const parts=folder.split('/');
  for(let i=1;i<=parts.length;i++){
   const path=parts.slice(0,i).join('/');
   if(!await adapter.exists(path))try{await adapter.mkdir(path);}catch(e){if(!await adapter.exists(path))throw e;}
  }
 }
 await mkdir(root);
 const candidates=[];
 for(const folder of (await adapter.list(root)).folders){
  const id=folder.slice(root.length+1);if(!validId(id)||registry.active.has(id))continue;
  const versions=[];
  for(const slot of ['a','b']){
   const path=`${folder}/snapshot-${slot}.json`;if(!await adapter.exists(path))continue;
   let state;
   try{state=JSON.parse(await adapter.read(path));}catch(e){if(e instanceof SyntaxError||e.name==='SyntaxError')continue;throw e;}
   if(![1,2].includes(state.version)||state.complete!==true||state.id!==id||state.owner!==owner||!Number.isInteger(state.revision)||typeof state.text!=='string'||!Array.isArray(state.attachments)||!Array.isArray(state.sources))continue;
   if(!state.sources.every(validId))continue;
   if(state.saveTime!=null&&(!Number.isFinite(state.saveTime)||!Number.isFinite(new Date(state.saveTime).getTime())))continue;
   if(state.targetPath!=null){try{captureFiles.normalizeCaptureConfig({...config,notePath:state.targetPath});}catch(e){continue;}}
   const local=p=>typeof p==='string'&&p.startsWith(root+'/')&&!p.includes('/../')&&!p.includes('\\');
   if(!state.attachments.every(a=>validId(a.id)&&typeof a.name==='string'&&typeof a.type==='string'&&(!a.draftPath||local(a.draftPath))&&(!a.chunkDir||local(a.chunkDir))))continue;
   if(state.version===2&&state.submission!=null&&(!validId(state.submission.id)||state.submission.key!==contentKey(state)))continue;
   versions.push(state);
  }
  versions.sort((a,b)=>b.revision-a.revision);
  const state=versions[0];
  if(state&&(state.text||state.attachments.length))candidates.push(state);
 }
 // 合并多个窗口留下的草稿时记录来源，避免合并中断后再次拼入同一份文字。
 const committed=await captureFiles.committedIds(vault,config,[...new Set(candidates.flatMap(commitIds))],candidates.map(state=>state.targetPath).filter(Boolean));
 const available=candidates.filter(state=>!registry.active.has(state.id)&&!commitIds(state).some(id=>committed.has(id)));
 const covered=new Set(candidates.flatMap(s=>s.sources.filter(id=>id!==s.id)));
 const recovered=available.filter(s=>!covered.has(s.id)).sort((a,b)=>a.updatedAt-b.updatedAt);
 let id=recovered.at(-1)?.id||uid(),revision=recovered.at(-1)?.revision||0;
 let sources=[...new Set(recovered.flatMap(s=>[s.id,...s.sources]))];
 const single=recovered.length===1&&recovered[0].version===2?recovered[0]:null;
 let targetPath=single?.targetPath||null,saveTime=single?.saveTime??null;
 let submission=single?.submission||null;
 [id,...sources].forEach(key=>registry.active.add(key));
 let tail=Promise.resolve();
 const enqueue=task=>{const result=tail.then(task);tail=result.catch(()=>{});return result;};
 const folder=()=>`${root}/${id}`;
 const ids=()=>[...new Set([id,...sources])];
 async function persistFile(entry){
  if(entry.draftPath||entry.chunkDir||entry.path)return;
  await mkdir(folder());
  const extension=entry.file.name.match(/\.[a-z0-9]{1,12}$/i)?.[0]||'.bin';
  const path=`${folder()}/${entry.id}${extension}`;
  await adapter.writeBinary(path,await entry.file.arrayBuffer());entry.draftPath=path;
 }
 async function checkpoint(){
  const data=snapshot(),next=revision+1;
  // 提交标识只对应不可变内容；报错后继续编辑必须生成新版本，不能被旧标记吞掉。
  if(submission&&submission.key!==contentKey(data)){
   for(const entry of data.attachments)if(entry.path)entry.preservePath=true;
   submission=null;targetPath=null;saveTime=null;
  }
  // 任一附件尚未备份时先重试，不能把只保存了文字的快照显示为全部已备份。
  for(const entry of data.attachments){
   await persistFile(entry);
   for(const [index,blob] of entry.pendingChunks||[]){await persistChunk(entry,blob,index);entry.pendingChunks.delete(index);}
  }
  const entries=data.attachments.filter(a=>a.draftPath||a.chunkDir||a.path).map(a=>({id:a.id,name:a.file.name,type:a.file.type,mode:a.mode||'file',draftPath:a.draftPath||null,chunkDir:a.chunkDir||null,path:a.path||null,preservePath:!!a.preservePath}));
  await mkdir(folder());
  await adapter.write(`${folder()}/snapshot-${next%2?'a':'b'}.json`,JSON.stringify({version:2,id,owner,revision:next,updatedAt:Date.now(),sources,text:data.text,attachments:entries,targetPath,saveTime,submission,complete:true}));
  revision=next;
 }
 async function persistChunk(entry,blob,index){
  const bytes=await blob.arrayBuffer();
  await adapter.writeBinary(`${entry.chunkDir}/chunk-${String(index).padStart(6,'0')}-${bytes.byteLength}.bin`,bytes);
 }
 const store={
  get id(){return id;},
  get ids(){return submission?[submission.id]:[];},
  get targetPath(){return targetPath;},
  get saveTime(){return saveTime;},
  setTarget:(path,time)=>enqueue(async()=>{if(!submission)submission={id:uid(),key:contentKey(snapshot())};targetPath=path;saveTime=time;await checkpoint();}),
  recovered:{text:recovered.map(s=>s.text).filter(Boolean).join('\n\n'),attachments:[...new Map(recovered.flatMap(s=>s.attachments.map(a=>({...a,preservePath:a.preservePath||s.version===1&&!!a.path}))).map(a=>[a.id,a])).values()]},
  checkpoint:()=>enqueue(checkpoint),
  flush:()=>tail,
  markers:()=>store.ids.map(marker).join('\n'),
  committed:text=>store.ids.some(key=>text.includes(marker(key))),
  storeFile:entry=>enqueue(async()=>{
   await persistFile(entry);
   await checkpoint();
  }),
  beginRecording:entry=>enqueue(async()=>{
   entry.mode='chunks';entry.chunkDir=`${folder()}/${entry.id}`;await mkdir(entry.chunkDir);
   // 开始采集前让两份快照都知道录音位置，损坏最新快照仍能找到已有片段。
   await checkpoint();await checkpoint();
  }),
  chunk:(entry,blob,index)=>enqueue(()=>persistChunk(entry,blob,index)),
  materialize:entry=>enqueue(async()=>{
   if(entry.mode!=='chunks')return true;
   const files=(await adapter.list(entry.chunkDir)).files.map(path=>({path,match:path.match(/\/chunk-(\d+)-(\d+)\.bin$/)})).filter(x=>x.match).sort((a,b)=>Number(a.match[1])-Number(b.match[1]));
   const complete=[];let expected=1,total=0;
   for(const item of files){
    const size=Number(item.match[2]),stat=await adapter.stat(item.path);
    if(Number(item.match[1])!==expected||stat?.size!==size)break;
    complete.push({...item,size});total+=size;expected++;
   }
   if(!total)return false;
   const bytes=new Uint8Array(total);let offset=0;
   for(const item of complete){
    const data=await adapter.readBinary(item.path);if(data.byteLength!==item.size)throw new Error('录音片段读取不完整');
    bytes.set(new Uint8Array(data),offset);offset+=item.size;
   }
   const extension=entry.file.name.match(/\.[a-z0-9]{1,12}$/i)?.[0]||'.bin';
   const path=`${entry.chunkDir}/complete${extension}`;
   await adapter.writeBinary(path,bytes.buffer);entry.draftPath=path;entry.mode='file';await checkpoint();return true;
  }),
  clear:()=>enqueue(async()=>{
   const old=ids(),primary=id;old.forEach(key=>registry.active.delete(key));id=uid();revision=0;sources=[];targetPath=null;saveTime=null;submission=null;registry.active.add(id);
   // 主快照保留来源覆盖关系；全部来源清理成功后才能删除，避免部分失败使旧草稿复活。
   let cleared=true;
   for(const key of old.filter(key=>key!==primary))try{await adapter.rmdir(`${root}/${key}`,true);}catch(e){cleared=false;}
   if(cleared)try{await adapter.rmdir(`${root}/${primary}`,true);}catch(e){/* 已提交的主快照保留后仍可按提交标记判重。 */}
  }),
  close:(wait,persist=true)=>{
   const closing=Promise.resolve(wait).then(()=> (typeof persist==='function'?persist():persist)?store.checkpoint():undefined).finally(()=>{ids().forEach(key=>registry.active.delete(key));registry.closing.delete(closing);});
   registry.closing.add(closing);return closing;
  }
 };
 return store;
}

function recentCaptureEntries(markdown){
 const entries=[];let current=null,fence=null;
 const lines=markdown.split(/\r?\n/);
 for(const [line,text] of lines.entries()){
  const heading=text.match(/^##[ \t]+(\d{4}[-/年]\d{1,2}[-/月]\d{1,2}日?[ T]+\d{1,2}:\d{2}(?::\d{2})?.*)$/);
  let committedBoundary=false;
  if(heading){
   let next=line+1;while(next<lines.length&&!lines[next].trim())next++;
   committedBoundary=/^<!-- workspace-capture:[\w-]+ -->$/.test(lines[next]?.trim()||'');
  }
  // 正式记录的提交标识优先于正文围栏，前一条未闭合代码不应吞掉新记录。
  if(heading&&(!fence||committedBoundary)){current={date:heading[1],line,lines:[]};entries.push(current);fence=null;continue;}
  const block=text.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
  if(fence){
   if(current)current.lines.push(text);
   if(block&&block[1][0]===fence.char&&block[1].length>=fence.length&&!block[2].trim())fence=null;
   continue;
  }
  if(block){fence={char:block[1][0],length:block[1].length};if(current)current.lines.push(text);continue;}
  if(current)current.lines.push(text);
 }
 return entries.map(entry=>{
  const counts={image:0,audio:0,video:0,file:0};
  const media=(target,embedded)=>{
   const clean=target.split('|')[0].replace(/[?#].*$/,'');
   if(embedded&&/\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(clean)){counts.image++;return true;}
   if(embedded&&/\.(mp4|mov|mkv|m4v|avi|ogv|mpeg|mpg)$/i.test(clean)){counts.video++;return true;}
   if(embedded&&/\.(mp3|wav|m4a|ogg|oga|flac|webm|aac)$/i.test(clean)){counts.audio++;return true;}
   if(!/^https?:/i.test(target)&&/\.[\w]+$/.test(clean)){counts.file++;return true;}
   return false;
  };
  const summary=entry.lines.join('\n').replace(/<!--[\s\S]*?-->/g,'')
   .replace(/(!?)\[\[([^\]]+)\]\]/g,(_,embed,target)=>media(target,!!embed)?'':target.split('|').at(-1))
   .replace(/(!?)\[([^\]]*)\]\(([^)]+)\)/g,(_,embed,label,target)=>media(target,!!embed)?'':label||target)
   .replace(/^\s*(?:#{1,6}\s+|[-*>]\s*)/gm,'').replace(/(?:\*\*|__|~~|`)/g,'').replace(/\s+/g,' ').trim();
  const labels=[];
  if(counts.image)labels.push(`图片 ${counts.image}`);
  if(counts.audio)labels.push(`音频 ${counts.audio}`);
  if(counts.video)labels.push(`视频 ${counts.video}`);
  if(counts.file)labels.push(`附件 ${counts.file}`);
  return {...entry,summary:summary||'附件记录',media:labels.join(' · ')};
 });
}

module.exports = {
 kind:'workspace-capture',name:'即时灵感',icon:'sparkles',accent:'#6695d8',defaultSize:{w:6,h:4},defaultConfig:()=>({saveMode:'single',noteFolder:'Simple Space/即时灵感',notePath:'Simple Space/即时灵感/灵感.md',attachmentFolder:'Simple Space/即时灵感/附件',splitBySize:true,maxFileSizeKB:1024}),
 // 附件写入和其他笔记变化不应触发重绘，否则会丢失草稿、打断录音。
 liveRefresh:false,
 async render(body,ctx){
  if(ctx.config.notePath!==undefined&&(typeof ctx.config.notePath!=='string'||!/\.md$/i.test(ctx.config.notePath)))throw new Error('灵感来源必须是以 .md 结尾的 Markdown 笔记路径');
  const {setIcon}=require('obsidian');
  const win=body.ownerDocument.defaultView,vault=ctx.app.vault;
  const config=captureFiles.normalizeCaptureConfig(ctx.config),recentCache=new Map();
  const composer=ctx.composer||{},editorOnly=!!composer.editorOnly,noun=composer.noun||'灵感',noteHeader=composer.noteHeader??captureFiles.NOTE_HEADER;
  let attachments=[],saving=false,disposed=false,starting=false,stopping=false,loading=true,initialized=false,returning=false,mode=editorOnly?'editor':'recent',recentToken=0,hasRecent=false;
  let finishInitialization;
  const initializationDone=new Promise(resolve=>{finishInitialization=resolve;});
  let recorder=null,stream=null,recordedAt=0,players=[],removers=[],journal=null,recordingDone=null,resolveRecording=null,savingDone=null,resolveSaving=null,startingDone=null,resolveStarting=null,startToken=0,suspending=null;
  const uid=()=>`${Date.now()}-${Math.random().toString(36).slice(2,12)}`;
  const back=editorOnly?null:ctx.addHeaderAction('arrow-left','返回最近内容',returnRecent);
  if(back){back.addClass('ws-capture-header-action');back.createSpan({text:'返回'});back.hidden=true;}
  const create=editorOnly?null:ctx.addHeaderAction('plus','创建灵感',()=>{if(!loading&&!saving&&!returning&&!ctx.isEditing())showMode('editor');});
  if(create)create.addClass('ws-capture-header-action','ws-capture-create');
  const createLabel=create?.createSpan({text:'创建'});
  const recent=body.createDiv({cls:'ws-capture-recent',attr:{'aria-label':'最近灵感'}});recent.hidden=editorOnly;
  const editor=body.createDiv({cls:'ws-capture-editor'});editor.hidden=!editorOnly;
  const input=editor.createEl('textarea',{attr:{placeholder:editorOnly?'写下待办或粘贴链接，也可拖入图片、文件、音频、视频…':'写下想法或粘贴链接，也可拖入图片、文件、音频…','aria-label':noun+'内容',rows:'3'}});
  input.style.width='100%';
  const links=editor.createDiv({cls:'ws-capture-links'});links.hidden=true;
  const previews=editor.createDiv({cls:'ws-capture-attachments',attr:{'aria-label':'待保存附件'}});previews.hidden=true;
  const picker=editor.createEl('input',{attr:{type:'file',multiple:'','aria-label':editorOnly?'选择图片、文件、音频或视频':'选择图片、文件或音频',tabindex:'-1'}});picker.hidden=true;
  const footer=editor.createDiv({cls:'ws-capture-footer'});
  const draftStatus=footer.createSpan({cls:'ws-hint ws-capture-draft-state'});
  const actions=footer.createDiv({cls:'ws-capture-actions'});
  function action(icon,label){
   const el=actions.createEl('button',{cls:'ws-capture-action',attr:{type:'button','aria-label':label,title:label}});
   setIcon(el,icon);return el;
  }
  const attach=action('paperclip',editorOnly?'添加附件（图片、文件、音频、视频）':'添加图片、文件或音频');
  const record=action('mic','开始录音');
  const button=actions.createEl('button',{text:'保存'+noun+' ↗',cls:'mod-cta ws-capture-save',attr:{type:'button'}});
  const status=editor.createDiv({cls:'ws-hint ws-capture-status',attr:{role:'status'}});
  const say=text=>{if(!disposed)status.setText(text);};
  const backupError=e=>{if(!disposed){draftStatus.setText('自动备份失败');say('草稿备份失败：'+e.message+'。请保留当前窗口，检查设备存储后重试，或移除未备份附件。');}};
  const backedUp=()=>{if(!disposed)draftStatus.setText('草稿已自动备份');};
  const backup=()=>journal?journal.checkpoint().then(()=>{backedUp();return true;}).catch(e=>{backupError(e);return false;}):Promise.resolve(false);
  const hasDraft=()=>!!input.value.trim()||attachments.length>0;
  ctx.registerBusyGuard?.(()=>saving||starting||stopping||!!recorder||hasDraft());
  async function loadRecent(){
   const token=++recentToken;
   try{
    const entries=await captureFiles.readRecentEntries(vault,config,recentCaptureEntries,{limit:5,cache:recentCache});
    if(disposed||token!==recentToken)return;
    recent.empty();
    hasRecent=entries.length>0;
    if(!hasRecent&&mode==='recent')showMode('editor',false);else updateControls();
    for(const entry of entries){
     const row=recent.createEl('button',{cls:'ws-capture-recent-row',attr:{type:'button','aria-label':`打开灵感：${entry.date} ${entry.summary.slice(0,32)}`}});
     row.createSpan({cls:'ws-capture-recent-date',text:entry.date});
     row.createSpan({cls:'ws-capture-recent-summary',text:entry.summary});
     if(entry.media)row.createSpan({cls:'ws-capture-recent-media',text:entry.media});
     row.onclick=async()=>{try{await ctx.openPath(entry.path,{line:entry.line});}catch(e){if(!disposed)recent.createDiv({cls:'ws-hint',text:'打开失败：'+e.message});}};
    }
   }catch(e){
    if(disposed||token!==recentToken)return;
    recent.empty();recent.createDiv({cls:'ws-hint',text:'最近内容读取失败：'+e.message});
    recent.createEl('button',{text:'重试',attr:{type:'button'}}).onclick=loadRecent;
   }
  }
  function showMode(next,focus=true){
   if(disposed)return;
   mode=next;editor.hidden=next!=='editor';recent.hidden=next!=='recent';
   if(next==='editor'){drawAttachments();if(focus)input.focus();}else stopPreviews();
   updateControls();
  }
  async function returnRecent(){
   if(editorOnly||!hasRecent||loading||saving||returning||starting||stopping||disposed)return;
   returning=true;updateControls();
   try{
    if(recorder){stopRecording();await recordingDone;}
    if(hasDraft()&&!await backup())return;
    showMode('recent');await loadRecent();
   }finally{returning=false;updateControls();}
  }
  const kind=file=>{
   if(file.type.startsWith('video/'))return 'video';
   if(file.type.startsWith('audio/'))return 'audio';
   if(file.type.startsWith('image/'))return 'image';
   if(/\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(file.name))return 'image';
   if(/\.(mp4|webm|mov|mkv|m4v|avi|ogv|mpeg|mpg)$/i.test(file.name))return 'video';
   if(/\.(mp3|wav|m4a|ogg|oga|flac|webm|aac)$/i.test(file.name))return 'audio';
   return 'file';
  };
  const release=entry=>{if(entry.url){win.URL.revokeObjectURL(entry.url);entry.url=null;}};
  const stopPreviews=()=>{
   for(const player of players){player.pause();player.removeAttribute('src');player.load();}
   players=[];
  };
  function updateControls(){
   if(disposed)return;
   input.disabled=saving||loading||returning;picker.disabled=saving||loading||returning;attach.disabled=saving||loading||returning;
   button.disabled=saving||loading||returning||starting||stopping||!!recorder;
   record.disabled=saving||loading||returning||starting||stopping;
   for(const remove of removers)remove.disabled=saving||loading||returning||!!recorder;
   if(back){back.disabled=saving||loading||returning||starting||stopping;back.hidden=mode!=='editor'||!hasRecent;}
   if(create){create.disabled=saving||loading||returning;create.hidden=mode!=='recent';createLabel.setText(hasDraft()?'继续创建':'创建');}
   const label=recorder?'停止录音':'开始录音';
   record.setAttribute('aria-label',label);record.setAttribute('title',label);
   record.setAttribute('aria-pressed',String(!!recorder));setIcon(record,recorder?'square':'mic');
   if(recorder)record.addClass('is-recording');else record.removeClass('is-recording');
  }
  function drawAttachments(){
   if(disposed)return;
   stopPreviews();previews.empty();removers=[];previews.hidden=attachments.length===0;
   for(const entry of attachments){
    const card=previews.createDiv({cls:'ws-capture-attachment'}),type=kind(entry.file);
    const src=entry.url;
    if(type==='image'&&src)card.createEl('img',{attr:{src,alt:entry.file.name}});
    const content=card.createDiv({cls:'ws-capture-attachment-content'});
    content.createSpan({cls:'ws-capture-filename',text:entry.file.name,attr:{title:entry.file.name}});
    if((type==='audio'||type==='video')&&src)players.push(content.createEl(type,{attr:{src,controls:'',preload:'metadata','aria-label':(type==='video'?'预览 ':'试听 ')+entry.file.name}}));
    const remove=card.createEl('button',{cls:'ws-capture-remove',attr:{type:'button','aria-label':'移除 '+entry.file.name,title:'移除此附件'}});
    removers.push(remove);setIcon(remove,'x');remove.disabled=saving||loading||returning||!!recorder;
    remove.onclick=()=>{if(saving||loading||returning||recorder||disposed)return;release(entry);attachments=attachments.filter(x=>x!==entry);drawAttachments();return backup();};
   }
  }
  async function preview(entry){
   if(!entry.url&&entry.draftPath&&kind(entry.file)!=='file'){
    const bytes=await ctx.draftAdapter.readBinary(entry.draftPath);
    if(!disposed)entry.url=win.URL.createObjectURL(new win.Blob([bytes],{type:entry.file.type}));
   }
  }
  async function addFiles(files){
   if(saving||loading||returning||disposed)return;
   const pending=[];
   for(const file of Array.from(files||[])){
    const entry={id:uid(),file,path:null,url:null};
    if(kind(file)!=='file'){
     try{entry.url=win.URL.createObjectURL(file);}catch(e){console.error('工作台：附件预览不可用',e);}
    }
    attachments.push(entry);
    if(journal)pending.push(journal.storeFile(entry).then(backedUp).catch(backupError));
   }
   say(attachments.length?`已添加 ${attachments.length} 个附件，保存后写入收件箱`:'');drawAttachments();
   await Promise.all(pending);
  }
  function drawLinks(){
   if(disposed)return;
   links.empty();
   const trimURL=url=>{
    let value=url.replace(/[.,;!?，。；！？]+$/g,'');
    const pairs={')':'(',']':'[','}':'{'};
    while(pairs[value.slice(-1)]){
     const close=value.slice(-1),open=pairs[close];
     if(value.split(close).length<=value.split(open).length)break;
     value=value.slice(0,-1);
    }
    return value;
   };
   const urls=new Set((input.value.match(/https?:\/\/[^\s<>"']+/gi)||[]).map(trimURL));
   links.hidden=urls.size===0;
   for(const url of urls)links.createEl('a',{text:url,attr:{href:url,target:'_blank',rel:'noopener noreferrer',title:url}});
  }
  attach.onclick=()=>{if(!saving)picker.click();};
  picker.onchange=()=>{const pending=addFiles(picker.files);picker.value='';return pending;};
  input.oninput=()=>{drawLinks();return backup();};
  input.onpaste=e=>{
   const files=e.clipboardData?.files;if(!files?.length||saving)return;
   e.preventDefault();
   const text=e.clipboardData.getData('text/plain');
   if(text)input.setRangeText(text,input.selectionStart,input.selectionEnd,'end');
   addFiles(files);drawLinks();backup();
  };
  body.ondragover=e=>{if(Array.from(e.dataTransfer?.types||[]).includes('Files')){e.preventDefault();body.addClass('is-dragging-files');}};
  body.ondragleave=()=>body.removeClass('is-dragging-files');
  body.ondrop=e=>{
   body.removeClass('is-dragging-files');
   if(!e.dataTransfer?.files?.length)return;
   e.preventDefault();e.stopPropagation();
   if(loading||saving||returning||ctx.isEditing())return;
   if(mode==='recent')showMode('editor');
   addFiles(e.dataTransfer.files);
  };
  const stopStream=()=>{if(stream){stream.getTracks().forEach(track=>track.stop());stream=null;}};
  function stopRecording(){
   const current=recorder;if(!current){stopStream();return;}
   stopping=true;updateControls();
   // inactive 只表示停止请求已接收；最终数据和 stop 事件仍可能尚未到达。
   try{if(current.state!=='inactive')current.stop();}
   catch(e){
    current.ondataavailable=null;current.onstop=null;current.onerror=null;
    recorder=null;stopping=false;say('录音已中断，已生成的片段会保留在草稿。');resolveRecording?.();updateControls();
   }finally{stopStream();}
  }
  record.onclick=async()=>{
   if(saving||loading||returning||starting||stopping||disposed)return;
   if(recorder){stopRecording();return;}
   if(!journal){say('自动备份不可用，请先解决草稿错误再录音。');return;}
   const Recorder=win.MediaRecorder,devices=win.navigator?.mediaDevices;
   if(!Recorder||!devices?.getUserMedia){say('当前环境不支持直接录音，请用回形针上传音频。');return;}
   const token=++startToken;
   startingDone=new Promise(resolve=>{resolveStarting=resolve;});
   starting=true;updateControls();say('请允许麦克风访问…');
   try{
    const acquired=await devices.getUserMedia({audio:true});
    if(disposed||token!==startToken){acquired.getTracks().forEach(track=>track.stop());return;}
    stream=acquired;
    const mime=['audio/webm;codecs=opus','audio/mp4','audio/webm','audio/ogg;codecs=opus'].find(type=>Recorder.isTypeSupported?.(type));
    const current=new Recorder(stream,mime?{mimeType:mime}:undefined);
    const type=current.mimeType||mime||'audio/webm',extension=type.includes('mp4')?'m4a':type.includes('ogg')?'ogg':'webm';
    const stamp=new Date().toISOString().replace(/[:.]/g,'-');
    const entry={id:uid(),file:{name:`录音-${stamp}.${extension}`,type},path:null,url:null,pendingChunks:new Map()};
    attachments.push(entry);await journal.beginRecording(entry);
    if(disposed||token!==startToken){stopStream();return;}
    let failed=false,finished=false,chunkIndex=0;recorder=current;
    recordingDone=new Promise(resolve=>{resolveRecording=resolve;});
    const finish=async()=>{
     if(finished)return;finished=true;stopStream();stopping=true;updateControls();
     try{
      await journal.flush();
      for(const [index,blob] of entry.pendingChunks){await journal.chunk(entry,blob,index);entry.pendingChunks.delete(index);}
      if(await journal.materialize(entry)){
       await preview(entry);
       say(failed?'录音已中断，已有内容已备份。':'录音已自动备份，可试听后保存。');backedUp();
      }else{attachments=attachments.filter(a=>a!==entry);await journal.checkpoint();say('没有录到声音，请重试。');}
     }catch(e){backupError(e);}
     finally{recorder=null;stopping=false;drawAttachments();updateControls();resolveRecording?.();}
    };
    current.ondataavailable=e=>{
     if(!e.data.size)return;
     const index=++chunkIndex;entry.pendingChunks.set(index,e.data);
     return journal.chunk(entry,e.data,index).then(()=>{entry.pendingChunks.delete(index);backedUp();}).catch(e=>{backupError(e);stopRecording();});
    };
    current.onstop=finish;
    current.onerror=()=>{
     failed=true;say('录音失败，请重试或上传音频。');
     try{if(current.state!=='inactive')current.stop();}catch(e){finish();}finally{stopStream();}
    };
    current.start(1000);recordedAt=Date.now();say('录音中 00:00 · 点击停止结束');
   }catch(e){
    stopStream();recorder=null;stopping=false;
    resolveRecording?.();
    say(e.name==='NotAllowedError'?'未获得麦克风权限，可重试或上传音频。':'无法开始录音：'+e.message);
   }finally{starting=false;resolveStarting?.();updateControls();}
  };
  ctx.registerInterval(()=>{
   if(!recorder||stopping||disposed)return;
   const seconds=Math.floor((Date.now()-recordedAt)/1000),pad=n=>String(n).padStart(2,'0');
   say(`录音中 ${pad(Math.floor(seconds/60))}:${pad(seconds%60)} · 点击停止结束`);
  },1000);
  async function ensureFolder(folder){
   const parts=folder.split('/');
   for(let i=1;i<=parts.length;i++){
    const path=parts.slice(0,i).join('/');
    if(!vault.getAbstractFileByPath(path)){
     try{await vault.createFolder(path);}catch(e){if(!vault.getAbstractFileByPath(path))throw e;}
    }
   }
  }
  function safeName(name){
   const clean=name.normalize('NFC').replace(/[\\/:*?"<>|#^\[\]\x00-\x1f]/g,'_').replace(/^\.+/,'').trim()||'附件';
   const dot=clean.lastIndexOf('.'),ext=dot>0&&clean.length-dot<=12?clean.slice(dot):'';
   return (ext?clean.slice(0,dot):clean).slice(0,60)+ext;
  }
  async function attachmentLink(entry,notePath){
   const name=safeName(entry.file.name),folder=captureFiles.attachmentDirectory(notePath);
   const path=`${folder}/${entry.id}-${name}`;
   await ensureFolder(folder);
   let file=vault.getAbstractFileByPath(path);
   const previous=entry.path&&entry.path!==path?vault.getAbstractFileByPath(entry.path):null;
   // 旧版本可能已经落笔记；新版本改卷时复制附件，保留旧记录引用的路径。
   if(!file&&previous&&!entry.preservePath){
    await vault.rename(previous,path);file=vault.getAbstractFileByPath(path);
   }
   if(!file){
    const bytes=entry.draftPath?await ctx.draftAdapter.readBinary(entry.draftPath):previous?await vault.adapter.readBinary(previous.path):await entry.file.arrayBuffer();
    file=await vault.createBinary(path,bytes);
   }
   entry.path=path;file=file||vault.getAbstractFileByPath(path);
   if(!file)throw new Error('附件写入后无法读取，请重试');
   const link=ctx.app.fileManager.generateMarkdownLink(file,notePath,undefined,name);
   return (kind(entry.file)==='file'?'':'!')+link;
  }
  button.onclick=async()=>{
   if(saving||loading||returning||starting||stopping||recorder||disposed)return;
   const text=input.value.trim(),pending=attachments.slice();
   if(!text&&!pending.length){say('写下一点想法，或添加图片、文件、音频。');return;}
   saving=true;updateControls();drawAttachments();say('正在保存…');
   savingDone=new Promise(resolve=>{resolveSaving=resolve;});
   let savedPath=null;
   try{
    if(journal){
     await journal.flush();
     for(const entry of pending.slice()){
      for(const [index,blob] of entry.pendingChunks||[]){await journal.chunk(entry,blob,index);entry.pendingChunks.delete(index);}
      if(entry.mode==='chunks'&&!await journal.materialize(entry)){
       pending.splice(pending.indexOf(entry),1);attachments=attachments.filter(a=>a!==entry);
      }
     }
     await journal.checkpoint();
    }
    if(!text&&!pending.length){say('录音尚无完整片段，请重新录制。');return;}
    const saveTime=journal?.saveTime??Date.now(),date=new Date(saveTime);
    let target=journal?.targetPath||null,completed=false;
    // 已写入但调用方未收到成功时，先检查提交标记，再决定是否继续写附件。
    if(target){
     const committed=await captureFiles.findCommittedPath(vault,config,journal.ids,[target]);
     if(committed){target=committed;completed=true;}
    }
    const contentFor=links=>composer.formatContent?composer.formatContent({date,text,links,markers:journal?journal.markers():''}):'\n## '+date.toLocaleString('zh-CN')+'\n\n'+(journal?journal.markers()+'\n\n':'')+[...(text?[text]:[]),...links].join('\n\n')+'\n';
    let content=contentFor([]);
    if(!completed&&journal)await journal.setTarget(target,saveTime);
    for(let attempt=0;!completed&&attempt<100;attempt++){
     target=await captureFiles.selectTargetPath(vault,config,date,content,target,noteHeader);
     if(journal)await journal.setTarget(target,saveTime);
     const parts=[];
     for(const entry of pending)parts.push(await attachmentLink(entry,target));
     if(journal)await journal.checkpoint();
     content=contentFor(parts);
     const actual=await captureFiles.selectTargetPath(vault,config,date,content,target,noteHeader);
     if(actual!==target){target=actual;continue;}
     if(target.includes('/'))await ensureFolder(target.slice(0,target.lastIndexOf('/')));
     let note=vault.getAbstractFileByPath(target);
     if(!note){
      try{note=await vault.create(target,noteHeader);}catch(e){note=vault.getAbstractFileByPath(target);if(!note)throw e;}
     }
     try{
      await vault.process(note,old=>{
       if(journal?.committed(old))return old;
       // 选卷后其它卡片仍可能追加；在原子更新回调中复查完整 Markdown 字节数。
       if(captureFiles.needsRollover(old,content,config,noteHeader)){
        const error=new Error('当前灵感文件已满，正在自动续卷');error.code='CAPTURE_ROLLOVER';throw error;
       }
       return old+content;
      });
      completed=true;
     }catch(e){if(e.code!=='CAPTURE_ROLLOVER')throw e;}
    }
    if(!completed)throw new Error('灵感文件持续变化，自动续卷重试已达上限，请稍后保存');
    pending.forEach(release);attachments=[];input.value='';
    if(journal)await journal.clear();
    savedPath=target;
    if(!disposed){recentCache.delete(target);draftStatus.setText('');drawLinks();drawAttachments();say('已保存到 '+target);if(!editorOnly){showMode('recent');await loadRecent();}}
   }catch(e){say('保存失败：'+e.message+'。内容已保留，可重试。');}
   finally{saving=false;updateControls();drawAttachments();resolveSaving?.();}
   if(savedPath&&composer.onSaved){
    try{await composer.onSaved(savedPath);}catch(e){say('已保存到 '+savedPath+'，后续操作失败：'+e.message);}
   }
  };
  input.onkeydown=e=>{if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){e.preventDefault();if(!button.disabled)button.click();}};
  const controller={
   focus(){if(!disposed)input.focus();},
   suspend(){
    if(disposed)return Promise.resolve();
    if(suspending)return suspending;
    returning=true;startToken++;updateControls();
    // 多次返回请求共用同一等待，最后一份录音和草稿完成前不能重新采集。
    suspending=Promise.resolve().then(async()=>{
     if(starting)await startingDone;
     if(recorder){stopRecording();await recordingDone;}
     if(saving)await savingDone;
     if(disposed)return;
     // 返回编辑器时复用原控件；仅暂停播放，移除和卸载才释放媒体源。
     for(const player of players)player.pause();
     if(hasDraft()&&(!journal||!await backup())){
      const error=new Error('草稿尚未成功备份，请解决备份错误后重试。');
      if(!journal)say(error.message);
      throw error;
     }
    }).finally(()=>{returning=false;suspending=null;updateControls();});
    return suspending;
   }
  };
  ctx.registerCleanup(()=>{
   disposed=true;startToken++;
   recentToken++;
   stopRecording();stopPreviews();attachments.forEach(release);
   return journal?journal.close(Promise.all([initializationDone,recordingDone,savingDone]),()=>initialized).catch(backupError):undefined;
  });
  if(!editorOnly)for(const event of ['create','modify','delete','rename']){
   const ref=vault.on(event,(file,oldPath)=>{
    const changed=[file.path,oldPath].filter(Boolean);
    for(const path of changed)for(const cached of recentCache.keys())if(cached===path||cached.startsWith(path+'/'))recentCache.delete(cached);
    const roots=[config.noteFolder,config.notePath.includes('/')?config.notePath.slice(0,config.notePath.lastIndexOf('/')):'.'];
    const relevant=changed.some(path=>captureFiles.isCapturePath(config,path)||roots.some(root=>root!=='.'&&(root===path||root.startsWith(path+'/'))));
    if(mode==='recent'&&relevant)loadRecent();
   });
   ctx.registerCleanup(()=>vault.offref(ref));
  }
  updateControls();
  try{
   journal=await openCaptureDraft(ctx,()=>({text:input.value,attachments}),config);
   if(disposed){await journal.close(undefined,false);return controller;}
   input.value=journal.recovered.text;
   attachments=journal.recovered.attachments.map(a=>({...a,file:{name:a.name,type:a.type},url:null}));
   for(const entry of attachments.slice()){
    if(entry.mode==='chunks'&&!await journal.materialize(entry))attachments=attachments.filter(a=>a!==entry);
    if(disposed)return controller;
    await preview(entry);
   }
   if(input.value||attachments.length){await journal.checkpoint();backedUp();say('已恢复上次未保存的草稿。');}
   drawLinks();drawAttachments();
   initialized=true;
  }catch(e){backupError(e);}
  finally{loading=false;finishInitialization();updateControls();}
  if(!editorOnly)await loadRecent();
  return controller;
 }
};
