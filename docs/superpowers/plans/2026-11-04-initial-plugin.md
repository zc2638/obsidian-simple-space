# 独立工作台插件首版实现计划

**执行结果：** 项目最终命名为 Simple Space，目录 `~/docs/obsidian/plugins/simple-space`。实现、复核、118 项自动测试、构建及安装 ZIP 校验已完成；四端实际设备和同步服务验收待后续进行，详见 `docs/验收记录.md`。

> **执行：** 按已确认设计持续执行，使用 writing-plans、test-driven-development、dispatching-parallel-agents 与 verification-before-completion 技能；不发布、不提交、不安装到现有 vault。

**目标：** 在本目录创建可构建、可安装、具备六种卡片与双配置存储的独立 Obsidian 插件。

**架构：** 数据模型和配置存储为独立模块，卡片通过受控上下文挂载到持久化视图。配置同步更新按卡片 ID 协调，保留正在编辑或录音的灵感卡片。草稿使用设备 IndexedDB，避免 iCloud 同步隐藏目录时连草稿一起传输。

**技术栈：** JavaScript ESM、Obsidian API、esbuild、Node.js test runner；happy-dom 与 fake-indexeddb 仅用于开发测试。

## 隔离与文件归属

目标目录为新建空仓库，与 default vault 隔离；尚无 Git 提交基线，不能创建正常 worktree。使用 `feat/initial-workspace` 初始分支，不自行提交。模块实现按下列文件边界隔离，互不修改公共文件；主代理最后按依赖顺序整合。

1. 配置任务：`src/core/model.js`、`src/core/config-store.js` 及对应测试。先写默认卡片、路径校验、来源切换、外部变更和冲突保存测试，再实现。IO 接口为 loadData/saveData/read/write/exists/mkdir/backup；公开 WorkspaceStore 的 init、document、settings、update、switchStorage、externalChange、resolveConflict、replace、export 方法。配置文档格式为 `{format:'simple-space',version:1,revision,cards:[{id,type,title,w,h,config}]}`。
2. 灵感任务：`src/cards/capture.cjs`、`src/core/device-drafts.js`、`tests/capture.test.cjs`、`tests/device-drafts.test.js`。复用现有灵感交互和测试，替换写死路径并将草稿适配器移至设备 IndexedDB；测试先证明两种存储隔离、附件和录音中断恢复。
3. 欢迎和日历任务：`src/cards/welcome.js`、`src/cards/calendar.cjs`、`src/core/daily-notes.js` 及对应测试。内嵌农历代码保留 MIT；删除外部 JS/CSS 读取与执行；日记优先读取核心日记配置，默认路径可配置。不得依赖 Home Pages。
4. 主代理：`src/main.js`、`src/view.js`、`src/settings.js`、`src/cards/basic.js`、`src/core/tasks.js`、`src/core/files.js`、`styles.css`、测试辅助及集成测试。实现六类卡片、编辑、拖动及移动端按钮重排、尺寸和来源设置、导入预览、导出、配置发现和冲突选择。
5. 整合顺序为模型/存储 → 草稿/卡片 → 视图/设置/入口 → 构建和测试 → 规范与质量复核 → 打包与说明。

## 验证与交付

- 先运行对应测试，确认缺少实现时失败，再执行同组测试验证实现。
- `npm test` 检验存储、任务原文回写、草稿、录音恢复和生命周期。
- `npm run build` 生成可安装的 CommonJS main.js；生产运行仅依赖 Obsidian。
- `npm run package` 输出 dist/simple-space-0.1.0.zip，并核对文件和许可证。
- 用浏览器 DOM 环境验证添加卡片、设置和无损刷新；若可连接真实 Obsidian，再做新库验收。未连接的 Windows、手机真机明确列为待验收，不能宣称已通过四端测试。

本次不覆盖现有工作台、不读取同步凭据、不迁移历史笔记或草稿、不执行 Git 提交或线上发布。
