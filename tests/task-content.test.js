import test from 'node:test';
import assert from 'node:assert/strict';
import {taskStorageConfig,formatTaskEntry,TASK_HEADER} from '../src/core/task-content.js';

test('待办保存配置默认单文件并保留旧文件路径和显式时间规则',()=>{
 assert.equal(TASK_HEADER,'# 待办任务\n\n');
 assert.deepEqual(taskStorageConfig({}),{saveMode:'single',noteFolder:'Simple Space/待办任务',notePath:'Simple Space/待办任务/待办任务.md',attachmentFolder:'Simple Space/待办任务/附件',splitBySize:true,maxFileSizeKB:1024});
 assert.equal(taskStorageConfig({inboxPath:'旧任务.md'}).noteFolder,'.');
 assert.equal(taskStorageConfig({inboxPath:'项目/任务.MD'}).notePath,'项目/任务.MD');
 assert.equal(taskStorageConfig({inboxPath:'项目/任务.MD'}).noteFolder,'项目');
 assert.equal(taskStorageConfig({noteFolder:'计划',inboxPath:'计划/任务.md',saveMode:'quarter',maxFileSizeKB:8}).saveMode,'quarter');
 assert.throws(()=>taskStorageConfig({inboxPath:'../越界.md'}),/路径|名称/);
});

test('多媒体任务保留标准复选框，说明和附件缩进且标记不出现在标题',()=>{
 const value=formatTaskEntry({text:'修复登录\n先检查回调\n\n再重新验证',links:['![[待办/附件/待办/复现.mp4]]','[[待办/附件/待办/日志.txt]]'],markers:'<!-- workspace-capture:submission-1 -->'});
 assert.equal(value,'\n<!-- workspace-capture:submission-1 -->\n- [ ] 修复登录\n  先检查回调\n  \n  再重新验证\n  ![[待办/附件/待办/复现.mp4]]\n  [[待办/附件/待办/日志.txt]]\n');
 assert.equal(formatTaskEntry({text:'文字任务'}),'\n- [ ] 文字任务\n');
 assert.match(formatTaskEntry({links:['![[语音.webm]]']}),/- \[ \] 附件待办\n  !\[\[语音.webm\]\]/);
});
