import test from 'node:test';
import assert from 'node:assert/strict';
import {parseTasks,changeTaskStatus,taskFiles} from '../src/core/tasks.js';
import {formatTaskEntry} from '../src/core/task-content.js';

test('提取 Markdown 任务并忽略代码块，进行中保留普通未完成复选框',()=>{
 const text='# 今天\n- [ ] 第一件\n  - [ ] 正在做 <!-- desk:doing -->\n- [x] 已完成\n```md\n- [ ] 示例\n```\n1. [ ] 有序任务\n';
 const tasks=parseTasks(text,'待办.md');
 assert.equal(tasks.length,4);assert.deepEqual(tasks.map(t=>t.status),['todo','doing','done','todo']);
 assert.equal(tasks[1].text,'正在做');
});
test('任务移动后仍更新唯一原行，不改变其他正文或换行符',()=>{
 const text='说明\r\n- [ ] 做事\r\n';const task=parseTasks(text,'a.md')[0];
 const moved='新标题\r\n'+text;
 const doing=changeTaskStatus(moved,task,'doing');
 assert.equal(doing,'新标题\r\n说明\r\n- [ ] 做事 <!-- desk:doing -->\r\n');
 assert.equal(changeTaskStatus(doing,parseTasks(doing,'a.md')[0],'done'),'新标题\r\n说明\r\n- [x] 做事\r\n');
});
test('同步修改原任务后拒绝覆盖；重复任务移动后拒绝猜测',()=>{
 const task=parseTasks('- [ ] 做事\n','a.md')[0];
 assert.throws(()=>changeTaskStatus('- [x] 做事\n',task,'done'),/变化|修改/);
 assert.throws(()=>changeTaskStatus('# 新标题\n- [ ] 做事\n- [ ] 做事\n',task,'done'),/重复|定位/);
});
test('目录来源按目录边界筛选，不误包含同名前缀',()=>{
 const files=['项目/a.md','项目/子目录/b.md','项目2/c.md','待办.md'].map(path=>({path}));
 assert.equal(taskFiles(files,{sourceType:'folder',source:'项目'}).length,2);
 assert.equal(taskFiles(files,{sourceType:'folder',source:'.'}).length,4);
 assert.equal(taskFiles(files,{sourceType:'file',source:'待办.md'}).length,1);
});

test('任务详情包含缩进附件与代码块，并在下一任务和同级正文前结束',()=>{
 const text=['<!-- workspace-capture:a -->','- [ ] 整理资料','  ![[附件/录音.webm]]','  ![[附件/视频.mp4]]','', '  ```md','  - [ ] 代码示例','    保留代码缩进','  ```','  - [ ] 子任务','    ![[附件/图片.png]]','同级说明','  不属于子任务','<!-- workspace-capture:b -->','- [ ] 下一件','  [文件](附件/资料.pdf)','# 标题','  不属于下一件'].join('\n');
 const tasks=parseTasks(text,'待办.md');
 assert.deepEqual(tasks.map(task=>task.text),['整理资料','子任务','下一件']);
 assert.equal(tasks[0].detail,'![[附件/录音.webm]]\n![[附件/视频.mp4]]\n\n```md\n- [ ] 代码示例\n  保留代码缩进\n```');
 assert.equal(tasks[1].detail,'![[附件/图片.png]]');
 assert.equal(tasks[2].detail,'[文件](附件/资料.pdf)');
 assert.equal(tasks[0].original,'- [ ] 整理资料');assert.equal(tasks[0].line,1);
});

test('引用块任务保留详情，引用代码中的示例不产生任务',()=>{
 const text=['> - [ ] 引用任务','>   详情','>   ~~~md','>   - [ ] 引用代码示例','>   ~~~','> - [x] 完成','>   ![[图.png]]','普通正文','  不属于引用'].join('\n');
 const tasks=parseTasks(text,'a.md');
 assert.deepEqual(tasks.map(task=>task.text),['引用任务','完成']);
 assert.equal(tasks[0].detail,'详情\n~~~md\n- [ ] 引用代码示例\n~~~');
 assert.equal(tasks[1].detail,'![[图.png]]');
});

test('详情中的引用和代码引用符号不提前截断任务或闭合代码块',()=>{
 const text=['- [ ] 示例','  > 引用详情','  ```md','  > ```','  - [ ] 仍在代码块中','  ```','- [ ] 下一项'].join('\n');
 const tasks=parseTasks(text,'a.md');
 assert.deepEqual(tasks.map(task=>task.text),['示例','下一项']);
 assert.equal(tasks[0].detail,'> 引用详情\n```md\n> ```\n- [ ] 仍在代码块中\n```');
});

test('状态变更仅替换复选框首行，混合换行和附件正文逐字保留',()=>{
 const before='<!-- workspace-capture:a -->\r\n- [ ] 任务\n  ![[视频.mp4]]\r\n  ```md\n  - [ ] 示例\r\n  ```\n\r\n# 后续\n';
 const task=parseTasks(before,'a.md')[0];
 assert.equal(changeTaskStatus(before,task,'doing'),before.replace('- [ ] 任务','- [ ] 任务 <!-- desk:doing -->'));
});

test('默认目录递归读取并排除保存根中的附件笔记',()=>{
 const files=['Simple Space/待办任务/a.md','Simple Space/待办任务/项目/b.md','Simple Space/待办任务/附件/伪任务.md','Simple Space/待办任务/附件/子目录/伪任务.md','Simple Space/待办2/c.md'].map(path=>({path}));
 assert.deepEqual(taskFiles(files,{}).map(file=>file.path),['Simple Space/待办任务/a.md','Simple Space/待办任务/项目/b.md']);
});

test('旧单文件来源仅包含指定来源与保存目标续卷，不读取根目录的日期笔记',()=>{
 const files=['来源.md','旧/收件箱.md','旧/收件箱-002.md','收件箱.md','收件箱-002.md','2026.md','2026-11.md','2026-11-04.md','附件/伪任务.md','无关.md'].map(path=>({path}));
 const config={sourceType:'file',source:'来源.md',inboxPath:'旧/收件箱.md',noteFolder:'.',saveMode:'single'};
 assert.deepEqual(taskFiles(files,config).map(file=>file.path),['来源.md','旧/收件箱.md','旧/收件箱-002.md','收件箱.md','收件箱-002.md']);
});

test('显式分月文件来源包含月份与续卷，排除其他模式和附件',()=>{
 const files=['历史.md','任务/待办.md','任务/待办-002.md','任务/2026-11.md','任务/2026-11-002.md','任务/2026.md','任务/2026-Q4.md','任务/2026-11-04.md','任务/2026-13.md','任务/附件/2026-11.md','任务2/2026-11.md'].map(path=>({path}));
 const config={sourceType:'file',source:'历史.md',inboxPath:'旧/待办.md',noteFolder:'任务',saveMode:'month'};
 assert.deepEqual(taskFiles(files,config).map(file=>file.path),['历史.md','任务/待办.md','任务/待办-002.md','任务/2026-11.md','任务/2026-11-002.md']);
});

test('年季度和每日文件来源按显式模式收集并排除无效日期',()=>{
 const files=['任务/2026.md','任务/2026-002.md','任务/2026-Q1.md','任务/2026-Q4-002.md','任务/2026-Q5.md','任务/2026-02-28.md','任务/2026-02-28-002.md','任务/2024-02-29.md','任务/2026-02-29.md','任务/2026-04-31.md'].map(path=>({path}));
 const config={sourceType:'file',source:'历史.md',inboxPath:'任务/待办.md',noteFolder:'任务'};
 for(const [saveMode,expected]of [['year',['任务/2026.md','任务/2026-002.md']],['quarter',['任务/2026-Q1.md','任务/2026-Q4-002.md']],['day',['任务/2026-02-28.md','任务/2026-02-28-002.md','任务/2024-02-29.md']]])assert.deepEqual(taskFiles(files,{...config,saveMode}).map(file=>file.path),expected);
});

test('任务详情未闭合代码块不吞掉下一次提交，根级代码块继续忽略示例任务',()=>{
 const text=formatTaskEntry({text:'前一项\n```js\nconsole.log(1)'})+formatTaskEntry({text:'后一项',markers:'<!-- workspace-capture:b -->'});
 const tasks=parseTasks(text,'a.md');
 assert.deepEqual(tasks.map(task=>task.text),['前一项','后一项']);
 assert.equal(tasks[0].detail,'```js\nconsole.log(1)');
 assert.equal(parseTasks('```md\n- [ ] 示例\n','a.md').length,0);
 assert.equal(changeTaskStatus(text,tasks[1],'done'),text.replace('- [ ] 后一项','- [x] 后一项'));
});

test('旧目录来源继续包含旧目录并纳入不同目录的新目标与续卷',()=>{
 const files=['旧来源/a.md','旧来源/子/b.md','新增/待办.md','新增/待办-002.md','新增/2026-11.md','新增/附件/文档.md','无关.md'].map(path=>({path}));
 const config={sourceType:'folder',source:'旧来源',inboxPath:'新增/待办.md'};
 assert.deepEqual(taskFiles(files,config).map(file=>file.path),['旧来源/a.md','旧来源/子/b.md','新增/待办.md','新增/待办-002.md']);
 assert.deepEqual(taskFiles(files,{...config,saveMode:'month'}).map(file=>file.path),['旧来源/a.md','旧来源/子/b.md','新增/待办.md','新增/待办-002.md','新增/2026-11.md']);
});

test('未闭合引用围栏在退出其引用层后不再隐藏外部任务',()=>{
 const text='> ```md\n> 示例\n- [ ] 外部待办';
 assert.deepEqual(parseTasks(text,'a.md').map(task=>task.text),['外部待办']);
 assert.equal(parseTasks('> ```md\n> - [ ] 同引用层示例\n','a.md').length,0);
 assert.equal(parseTasks('```md\n- [ ] 根围栏示例\n','a.md').length,0);
});

test('任务详情中的更深引用围栏不隐藏退回父引用层的子任务',()=>{
 const nested='> - [ ] 父任务\n>   > ```md\n>   > 示例\n>   - [ ] 子任务';
 assert.deepEqual(parseTasks(nested,'a.md').map(task=>task.text),['父任务','子任务']);
});
