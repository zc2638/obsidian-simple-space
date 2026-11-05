import test from 'node:test';
import assert from 'node:assert/strict';
import {ensureFolder,appendToNote,readTaskSource} from '../src/core/files.js';

function mockVault(){
 const data=new Map();
 return {data,getAbstractFileByPath:path=>data.has(path)?{path,extension:path.split('.').at(-1),children:data.get(path)===null?[]:undefined}:null,
  getMarkdownFiles:()=>[...data.keys()].filter(p=>p.endsWith('.md')).map(path=>({path})),
  async createFolder(path){if(data.has(path))throw Error('已存在');data.set(path,null);},
  async create(path,text){if(data.has(path))throw Error('已存在');data.set(path,text);return {path};},
  async read(file){return data.get(file.path);},async process(file,fn){data.set(file.path,fn(data.get(file.path)));}};
}
test('首次实际保存才创建嵌套目录，追加保留原文',async()=>{
 const v=mockVault();await appendToNote(v,'收件箱/待办.md','- [ ] A\n');
 await appendToNote(v,'收件箱/待办.md','- [ ] B\n');
 assert.equal(v.data.get('收件箱/待办.md'),'- [ ] A\n- [ ] B\n');
});
test('路径冲突和越界不会被当成目录或新笔记',async()=>{
 const v=mockVault();v.data.set('目录','正文');
 await assert.rejects(ensureFolder(v,'目录'),/目录|文件/);
 await assert.rejects(appendToNote(v,'../outside.md','x'),/路径|名称/);
});
test('目录任务读取返回任务来源位置',async()=>{
 const v=mockVault();v.data.set('项目/a.md','- [ ] 买书\n');v.data.set('项目/b.md','- [x] 读书\n');
 const tasks=await readTaskSource(v,{sourceType:'folder',source:'项目'});
 assert.deepEqual(tasks.map(t=>t.path),['项目/a.md','项目/b.md']);
});

test('读取保存目录中的多行任务但不把 Markdown 附件当作任务来源',async()=>{
 const v=mockVault();v.data.set('Simple Space/待办任务/待办任务.md','<!-- workspace-capture:a -->\n- [ ] 开会\n  ![[Simple Space/待办任务/附件/会议.webm]]\n');
 v.data.set('Simple Space/待办任务/项目/第二项.md','- [ ] 跟进\n  补充说明\n');v.data.set('Simple Space/待办任务/附件/文档.md','- [ ] 附件中的示例\n');
 const tasks=await readTaskSource(v,{});
 assert.deepEqual(tasks.map(task=>[task.path,task.text,task.detail]),[['Simple Space/待办任务/待办任务.md','开会','![[Simple Space/待办任务/附件/会议.webm]]'],['Simple Space/待办任务/项目/第二项.md','跟进','补充说明']]);
});

test('旧目录来源仍可读到其他保存目录中的新任务续卷',async()=>{
 const v=mockVault();v.data.set('旧来源/a.md','- [ ] 历史任务\n');v.data.set('新增/待办-002.md','- [ ] 新任务\n  ![[新增/附件/录音.webm]]\n');v.data.set('新增/附件/文档.md','- [ ] 示例\n');
 const tasks=await readTaskSource(v,{sourceType:'folder',source:'旧来源',inboxPath:'新增/待办.md'});
 assert.deepEqual(tasks.map(task=>task.text),['历史任务','新任务']);
});
