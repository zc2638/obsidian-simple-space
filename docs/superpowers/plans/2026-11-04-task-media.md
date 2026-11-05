# 待办媒体与统一保存配置实现计划

> **Execution:** Follow the repository workflow and the user's authorization. Use subagents only when explicitly requested or required by applicable instructions.

**Goal:** 待办支持图片、文件、音频、直接录音、视频和系统录屏文件上传，灵感与待办默认单文件保存。

**Architecture:** 复用灵感现有媒体采集、设备草稿和提交判重管线，以显式 composer 选项扩展内容格式。待办正文保持标准 Markdown 复选框，附件使用缩进的原生链接或嵌入；看板显示标题，详情中展示附件。配置共用保存目录和五种拆分方式，旧配置继续可读。

**Tech Stack:** Obsidian Vault API、MediaRecorder、IndexedDB、Node test runner、Happy DOM。

---

**执行结果：** 已完成，205 项全量测试通过，独立复核及修复后复验通过。安装包保持 0.1.0，见 `docs/验收记录.md`。

## 范围与隔离

录屏采用用户已选择的“上传系统录屏文件”，不新增屏幕采集权限。语音沿用直接录音及上传。所有正式内容保存在用户目录内，设备草稿不参与同步。仓库无初始提交，不能建立有效 worktree；按文件所有权并行开发，不提交、不清理用户已有文件。

## 任务一：保存配置

修改 `src/core/model.js`、`src/modals.js`、对应 model/modals 测试。新增待办默认配置：

```js
{ sourceType:'folder', source:'待办', inboxPath:'待办/待办.md', noteFolder:'待办', saveMode:'single', splitBySize:true, maxFileSizeKB:1024 }
```

旧三字段配置补齐保存设置，目录从原 inboxPath 的父目录推导，保留原文件名与来源。表单展示保存目录、保存方式、大小续卷；更改目录时同步更新读取目录和新增笔记目标，根目录用 `.`。

先写默认值、旧配置不变、目录表单及阈值验证的失败测试；执行 `node --test tests/model.test.js tests/modals.test.js` 确认失败后实现并通过。

## 任务二：复用媒体编辑器

修改 `src/cards/capture.cjs`、`src/core/capture-files.cjs` 与其测试。可选 `ctx.composer` 契约：

```js
{ editorOnly:true, noun:'待办', noteHeader:'# 待办\n\n',
  formatContent:({date,text,links,markers})=>String,
  onSaved:async path=>{} }
```

普通灵感行为保持默认。editorOnly 不展示最近灵感或内部创建/返回按钮，初始化后返回 `{focus(), suspend()}`；suspend 停止录音并等待最终块及草稿备份，可恢复编辑。格式化钩子与自定义标题参与分卷计算。视频根据 MIME 优先分类，扩展名作为后备，支持 video 预览和原生嵌入，音频 WebM 不被误认。保留提交版本、清理顺序、异常恢复与历史附件保护。

先补 editorOnly、Markdown 格式钩子、自定义标题超大单条、视频与 WebM 分类、录音恢复测试。执行 `node --test tests/capture.test.cjs tests/capture-files.test.cjs`，确认失败后实现并通过。

## 任务三：待办看板与附件详情

新增 `src/cards/tasks.js`、`src/core/task-content.js`；修改 `src/cards/basic.js` 导出、`src/core/tasks.js`、`src/core/files.js`、`styles.css`、UI/tasks 测试。

`taskStorageConfig(config)` 将待办字段映射成媒体保存配置，读取来源同时纳入其按规则生成的续卷。`formatTaskEntry({text,links,markers})` 第一行保存标题为复选框，其余正文与附件缩进，提交标记独立存放在同一任务块内。`parseTasks` 提供可选 detail，仅影响展示，不改变状态回写定位；详情通过 Obsidian MarkdownRenderer 渲染，并使用 Component 生命周期回收。

看板保留快速文字新增，标题栏“创建”打开复用编辑器，“返回”停止录音并备份。保存后更新看板，卡片来源修改、同步删除和卸载继续受 busy guard 保护。附件详情按需展开，视频不在看板自动播放。

先补多行任务与缩进附件、状态写回不改附件、默认新建文件和多级附件目录、创建/返回录音、上传视频保存、任务从续卷读取等测试。执行 `node --test tests/tasks.test.js tests/files.test.js tests/ui.test.js` 确认失败后实现并通过。

## 集成与交付

合并顺序：配置及媒体契约完成后接入待办，避免编辑重叠文件。独立复核保存、恢复、状态写回及媒体资源回收；修复发现后重跑相关测试。执行 `node --test --test-reporter=spec tests/*.test.js tests/*.test.cjs`、`npm run package`、`node --check main.js`、`git diff --check`；对 ZIP 六文件逐字节核对并更新 README 与验收记录，版本保持 0.1.0。真实麦克风、系统文件选择器及各平台视频编解码仍需真机验收。
