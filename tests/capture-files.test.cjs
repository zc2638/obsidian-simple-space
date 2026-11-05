const test=require('node:test');
const assert=require('node:assert/strict');
let api={};try{api=require('../src/core/capture-files.cjs');}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;}
function fn(name){assert.equal(typeof api[name],'function',`${name} 尚未实现`);return api[name];}
const config=()=>({saveMode:'month',noteFolder:'收件箱/灵感',notePath:'收件箱/灵感.md',attachmentFolder:'收件箱/附件/灵感',splitBySize:true,maxFileSizeKB:1});
function fixture(contents={}){
 const files=new Map(Object.entries(contents).map(([path,text],index)=>[path,{path,text,stat:{mtime:index+1,size:Buffer.byteLength(text)}}]));const reads=[];
 return {files,reads,getMarkdownFiles:()=>[...files.values()],getAbstractFileByPath:path=>files.get(path)||null,
  read:async file=>{reads.push(file.path);return files.get(file.path).text;},cachedRead:async file=>{reads.push(file.path);return files.get(file.path).text;}};
}
test('默认目录为即时灵感，显式旧目录和旧笔记路径仍按原配置使用',()=>{
 const normalize=fn('normalizeCaptureConfig'),base=fn('targetBasePath'),date=new Date(2026,10,4);
 assert.deepEqual(normalize(),{saveMode:'single',noteFolder:'Simple Space/即时灵感',notePath:'Simple Space/即时灵感/灵感.md',attachmentFolder:'Simple Space/即时灵感/附件',splitBySize:true,maxFileSizeKB:1024});
 assert.equal(base({},date),'Simple Space/即时灵感/灵感.md');
 assert.equal(base({saveMode:'single'},date),'Simple Space/即时灵感/灵感.md');
 assert.equal(normalize(config()).noteFolder,'收件箱/灵感');
 assert.equal(normalize({notePath:'旧目录/旧灵感.md'}).noteFolder,'旧目录/旧灵感');
});
test('五种保存方式按本地日期命名，季度与跨年边界正确',()=>{
 const base=fn('targetBasePath'),date=new Date(2026,10,4,23,59);
 const expected={year:'2026.md',quarter:'2026-Q4.md',month:'2026-11.md',day:'2026-11-04.md',single:'灵感.md'};
 for(const [saveMode,name]of Object.entries(expected))assert.equal(base({...config(),saveMode},date),'收件箱/灵感/'+name);
 assert.equal(base({...config(),saveMode:'quarter',noteFolder:'.'},new Date(2026,2,31)),'2026-Q1.md');
 assert.equal(base({...config(),saveMode:'quarter',noteFolder:'.'},new Date(2026,3,1)),'2026-Q2.md');
 assert.equal(base({...config(),saveMode:'month'},new Date(2027,0,1)),'收件箱/灵感/2027-01.md');
});
test('旧配置默认单文件并从原文件路径推导目录，同时拒绝越界和非法阈值',()=>{
 const normalize=fn('normalizeCaptureConfig');
 const value=normalize({notePath:'想法/收集.md',attachmentFolder:'.'});
 assert.equal(value.saveMode,'single');assert.equal(value.noteFolder,'想法/收集');assert.equal(value.maxFileSizeKB,1024);assert.equal(value.splitBySize,true);
 for(const patch of [{noteFolder:'../x'},{saveMode:'week'},{maxFileSizeKB:0},{maxFileSizeKB:1.5},{splitBySize:'true'}])assert.throws(()=>normalize({...config(),...patch}));
});
test('只匹配配置目录内的日期文件与续卷，包含原单文件历史',async()=>{
 const list=fn('candidatePaths'),v=fixture({'收件箱/灵感.md':'历史','收件箱/灵感-002.md':'续卷','收件箱/灵感/2026-Q4.md':'季度','收件箱/灵感/2026-11.md':'月','收件箱/灵感/2026-11-002.md':'月续卷','收件箱/灵感/2026-11-04.md':'日','收件箱/灵感/别的.md':'忽略','收件箱/灵感2/2026-11.md':'忽略','收件箱/灵感/附件/2026-11.md':'忽略'});
 const paths=await list(v,config());assert.equal(paths.length,6);assert.ok(paths.includes('收件箱/灵感.md'));assert.ok(paths.includes('收件箱/灵感/2026-11-04.md'));
});
test('大小按UTF8字节计算，恰好上限不续卷，超出时使用递增编号',async()=>{
 const select=fn('selectTargetPath'),date=new Date(2026,10,4);
 const v=fixture({'收件箱/灵感/2026-11.md':'中'.repeat(300)});
 assert.equal(await select(v,config(),date,'a'.repeat(124)),'收件箱/灵感/2026-11.md');
 assert.equal(await select(v,config(),date,'a'.repeat(125)),'收件箱/灵感/2026-11-002.md');
 v.files.set('收件箱/灵感/2026-11-002.md',{path:'收件箱/灵感/2026-11-002.md',text:'x'.repeat(1024),stat:{mtime:9,size:1024}});
 assert.equal(await select(v,config(),date,'x'),'收件箱/灵感/2026-11-003.md');
});
test('关闭大小拆分继续原时间文件；单文件模式也支持续卷',async()=>{
 const select=fn('selectTargetPath'),v=fixture({'收件箱/灵感/2026-11.md':'a'.repeat(2000),'收件箱/灵感/灵感.md':'a'.repeat(1024)}),date=new Date(2026,10,4);
 assert.equal(await select(v,{...config(),splitBySize:false},date,'新内容'),'收件箱/灵感/2026-11.md');
 assert.equal(await select(v,{...config(),saveMode:'single'},date,'新内容'),'收件箱/灵感/灵感-002.md');
});
test('五种模式及续卷的附件目录始终在保存根下，与实际文件名对应',()=>{
 const folder=fn('attachmentDirectory'),date=new Date(2026,10,4),base=fn('targetBasePath');
 for(const saveMode of ['year','quarter','month','day','single']){
  const path=base({...config(),saveMode},date),stem=path.split('/').at(-1).replace(/\.md$/i,'');
  assert.equal(folder(path),'收件箱/灵感/附件/'+stem);
  assert.equal(folder(path.replace(/\.md$/i,'-002.md')),'收件箱/灵感/附件/'+stem+'-002');
 }
 assert.equal(folder('2026-11.md'),'附件/2026-11');
});
test('切换保存方式后，之前的单文件与所有时间文件仍在最近来源中',async()=>{
 const v=fixture({'收件箱/灵感/灵感.md':'单文件','收件箱/灵感/灵感-002.md':'续卷','收件箱/灵感/2026.md':'年'});
 const paths=await fn('candidatePaths')(v,config());assert.equal(paths.length,3);
});
test('保存根目录改变后，不沿用旧根下的待重试目标写入',async()=>{
 const path=await fn('selectTargetPath')(fixture(),{...config(),noteFolder:'新灵感'},new Date(2026,10,4),'内容','旧位置/2026-10.md');
 assert.equal(path,'新灵感/2026-11.md');
});
test('单文件名本身带数字后缀时，重试不会误认作已有卷号',async()=>{
 const c={...config(),saveMode:'single',notePath:'旧位置/想法-2026.md'};
 assert.equal(await fn('selectTargetPath')(fixture(),c,new Date(2026,10,4),'内容','收件箱/灵感/想法-2026.md'),'收件箱/灵感/想法-2026.md');
});
test('超大单条保持完整，不会因为一条内容本身超限而无限续卷',async()=>{
 const select=fn('selectTargetPath'),date=new Date(2026,10,4),big='大'.repeat(1500);
 assert.equal(await select(fixture(),config(),date,big),'收件箱/灵感/2026-11.md');
 const v=fixture({'收件箱/灵感/2026-11.md':'已有内容'});
 assert.equal(await select(v,config(),date,big),'收件箱/灵感/2026-11-002.md');
 assert.equal(fn('needsRollover')('# 灵感收件箱\n\n',big,config()),false);
});
test('跨周期重试保留第一次保存日期的目标，不因时钟前进落到另一月份',async()=>{
 const select=fn('selectTargetPath'),v=fixture({'收件箱/灵感/2026-12.md':'已有内容'});
 assert.equal(await select(v,config(),new Date(2026,11,1),'重试','收件箱/灵感/2026-11-002.md'),'收件箱/灵感/2026-11-002.md');
});
const parser=text=>{const entries=[];const lines=text.split('\n');for(let i=0;i<lines.length;i++){const match=lines[i].match(/^## (.+)/);if(match)entries.push({date:match[1],line:i,summary:lines[i+1]});}return entries;};
test('最近五条跨月跨续卷排序，并保留真实来源和行号',async()=>{
 const recent=fn('readRecentEntries'),v=fixture({'收件箱/灵感.md':'## 2026-01-01 10:00:00\n历史','收件箱/灵感/2026-10.md':'## 2026-10-31 23:59:00\n十月','收件箱/灵感/2026-11.md':'## 2026-11-01 00:00:00\n十一月','收件箱/灵感/2026-11-002.md':'## 2026-11-02 00:00:00\n第二卷'});
 const entries=await recent(v,config(),parser);assert.deepEqual(entries.map(e=>e.summary),['第二卷','十一月','十月','历史']);
 assert.equal(entries[0].path,'收件箱/灵感/2026-11-002.md');assert.equal(entries[0].line,0);
});
test('混合年份与月份模式时，不会漏掉年份文件中更晚的记录',async()=>{
 const recent=fn('readRecentEntries');
 const month=Array.from({length:5},(_,i)=>`## 2026-11-0${i+1} 00:00:00\n月${i}`).join('\n');
 const v=fixture({'收件箱/灵感/2026.md':'## 2026-12-01 00:00:00\n年度最新','收件箱/灵感/2026-11.md':month});
 const entries=await recent(v,config(),parser);assert.equal(entries[0].summary,'年度最新');assert.equal(entries.length,5);
});
test('单文件名称像年份时仍按无限时间来源处理，不漏掉后续较新的记录',async()=>{
 const c={...config(),notePath:'旧位置/2020.md'};
 const month=Array.from({length:5},(_,i)=>`## 2026-11-0${i+1} 00:00:00\n月${i}`).join('\n');
 const v=fixture({'收件箱/灵感/2020.md':'## 2026-12-01 00:00:00\n单文件最新','收件箱/灵感/2026-11.md':month});
 assert.equal((await fn('readRecentEntries')(v,c,parser))[0].summary,'单文件最新');
});
test('最新文件已有五条时跳过不可能更近的历史文件，缓存只保存摘要',async()=>{
 const recent=fn('readRecentEntries');const latest=Array.from({length:5},(_,i)=>`## 2026-11-0${i+1} 10:00:00\n新${i}`).join('\n');
 const v=fixture({'收件箱/灵感/2026-11.md':latest,'收件箱/灵感/2020-01.md':'旧文件'}),cache=new Map();
 await recent(v,config(),parser,{cache});assert.equal(v.reads.includes('收件箱/灵感/2020-01.md'),false);
 v.reads.length=0;await recent(v,config(),parser,{cache});assert.equal(v.reads.length,0);
 assert.equal(JSON.stringify([...cache.values()]).includes(latest),false);
});
test('旧记录延迟追加到文件尾部时，按记录时间取最新五条且缓存有界',async()=>{
 const days=['06','07','08','09','10','01'];
 const text=days.map(day=>`## 2026-11-${day} 10:00:00\n记录${day}`).join('\n'),v=fixture({'收件箱/灵感/2026-11.md':text}),cache=new Map();
 const result=await fn('readRecentEntries')(v,config(),parser,{cache});
 assert.deepEqual(result.map(entry=>entry.summary),['记录10','记录09','记录08','记录07','记录06']);
 assert.equal(cache.get('收件箱/灵感/2026-11.md').entries.length,5);
});
test('提交标记在旧月份、续卷或草稿记录的原目标中仍能查重',async()=>{
 const committed=fn('committedIds'),find=fn('findCommittedPath');
 const v=fixture({'收件箱/灵感/2026-10-002.md':'<!-- workspace-capture:a -->','旧位置/记录.md':'<!-- workspace-capture:b -->'});
 const ids=await committed(v,config(),['a','b','c'],['旧位置/记录.md']);
 assert.deepEqual([...ids].sort(),['a','b']);assert.equal(await find(v,config(),['b'],['旧位置/记录.md']),'旧位置/记录.md');
});


test('调用方自定义标题为空卷时允许超大单条，选卷与原子复查采用同一标题', async()=>{
 const header='# 待办\n\n',big='大'.repeat(1500),v=fixture({'收件箱/灵感/2026-11.md':header});
 assert.equal(fn('needsRollover')(header,big,config(),header),false);
 assert.equal(await fn('selectTargetPath')(v,config(),new Date(2026,10,4),big,null,header),'收件箱/灵感/2026-11.md');
 assert.equal(fn('needsRollover')(header+'已有记录',big,config(),header),true);
});
