import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Window} from 'happy-dom';

async function fixture(t) {
 const window=new Window(),document=window.document,proto=window.HTMLElement.prototype;
 proto.createEl=function(tag,options={}) {const el=document.createElement(tag);if(options.cls)el.className=options.cls;if(options.text!==undefined)el.textContent=options.text;for(const [key,value] of Object.entries(options.attr||{}))el.setAttribute(key,value);this.append(el);return el;};
 proto.createDiv=function(options){return this.createEl('div',options);};proto.createSpan=function(options){return this.createEl('span',options);};proto.empty=function(){this.replaceChildren();};proto.setText=function(text){this.textContent=text;};
 const result=await build({entryPoints:['src/cards/basic.js'],bundle:true,write:false,format:'cjs',platform:'node',external:['obsidian']});
 const module={exports:{}};
 Function('module','exports','require',result.outputFiles[0].text)(module,module.exports,()=>({setIcon:(el,icon)=>{el.dataset.icon=icon;},getAllTags:cache=>cache?.tags||[]}));
 t.after(()=>window.happyDOM.close());
 return {document,...module.exports};
}

test('快捷入口按迁移前的色调轮换并优先显示配置图标',async t=>{
 const f=await fixture(t),body=f.document.body,opened=[];
 const items=[{title:'喜欢',url:'喜欢.md',icon:'heart'},{title:'灵感',url:'灵感.md',icon:'sparkles'},{title:'网站',url:'https://example.com'},{title:'笔记',url:'笔记.md'},{title:'更多',url:'更多.md'}];
 f.linksCard.render(body,{config:{columns:2,items},openPath:path=>opened.push(path)});
 const buttons=[...body.querySelectorAll('.hp-quicklink')];assert.equal(buttons.length,5);
 buttons.forEach((button,index)=>{assert.ok(button.classList.contains('is-clickable'));assert.ok(button.classList.contains(`hp-tone-${index%4}`));});
 assert.deepEqual([...body.querySelectorAll('.hp-quicklink-icon')].map(el=>el.dataset.icon),['heart','sparkles','external-link','file-text','file-text']);
 assert.equal(body.querySelector('.hp-quicklinks').style.getPropertyValue('--hp-cols'),'2');
 buttons[0].click();assert.deepEqual(opened,['喜欢.md']);
});

test('最近笔记恢复旧列表结构且保持来源筛选、排序、数量和点击行为',async t=>{
 const f=await fixture(t),body=f.document.body,opened=[];
 const files=[
  {path:'笔记/旧.md',basename:'旧',stat:{mtime:1,ctime:5}},
  {path:'笔记/新.md',basename:'新',stat:{mtime:3,ctime:1}},
  {path:'笔记/隐藏/秘密.md',basename:'秘密',stat:{mtime:8,ctime:8}},
  {path:'笔记之外/别的.md',basename:'别的',stat:{mtime:9,ctime:9}}
 ];
 const ctx={app:{vault:{getMarkdownFiles:()=>files}},config:{folder:'笔记',excludeFolders:['笔记/隐藏'],sort:'modified',limit:1},isAlive:()=>true,openPath:path=>opened.push(path),registerDataRefresh:fn=>{ctx.refresh=fn;}};
 f.recentCard.render(body,ctx);
 const row=body.querySelector('.hp-list .hp-list-row.is-clickable');assert.ok(row);
 assert.equal(row.querySelector('.hp-list-title').textContent,'新');assert.equal(row.querySelector('.hp-list-title').tagName,'SPAN');
 assert.equal(row.querySelector('.hp-list-icon').dataset.icon,'file-text');assert.ok(row.querySelector('.hp-list-text'));assert.ok(row.querySelector('.hp-list-meta'));
 assert.equal(body.querySelectorAll('.hp-list-row').length,1);row.click();assert.deepEqual(opened,['笔记/新.md']);
 ctx.config.sort='created';ctx.refresh();assert.equal(body.querySelector('.hp-list-title').textContent,'旧');
});

for(const api of ['getFiles','getAllLoadedFiles']) test(`统计卡片恢复 DOM 类与四种色调并通过 ${api} 统计附件`,async t=>{
 const f=await fixture(t),body=f.document.body;
 const notes=[{path:'一.md',extension:'md',stat:{mtime:1,size:2}},{path:'二.MD',extension:'MD',stat:{mtime:1,size:3}}];
 const all=[...notes,{path:'图.png',extension:'png'},{path:'附件/文档.pdf',extension:'pdf'}];
 if(api==='getAllLoadedFiles')all.push({path:'附件',children:[]},{path:'/',children:[]});
 const ctx={app:{vault:{getMarkdownFiles:()=>notes,[api]:()=>all,cachedRead:async()=> '你好 hello'},metadataCache:{getFileCache:()=>({tags:['#一个']})}},config:{metrics:['notes','tags','words','attachments']},wordCounts:new Map(),isAlive:()=>true,registerDataRefresh:fn=>{ctx.refresh=fn;}};
 await f.statsCard.render(body,ctx);
 const cells=[...body.querySelectorAll('.hp-stats .hp-stat')];assert.equal(cells.length,4);
 cells.forEach((cell,index)=>{assert.ok(cell.classList.contains(`hp-tone-${index}`));assert.ok(cell.querySelector('.hp-stat-label'));});
 assert.deepEqual(cells.map(cell=>cell.querySelector('.hp-stat-value').textContent),['2','1','6','2']);
 assert.equal(body.querySelector('.hp-stats').style.getPropertyValue('--hp-cols'),'2');
});
