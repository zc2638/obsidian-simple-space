# 灵感按时间与文件大小分卷实现计划

**执行结果：** 已实现并发布为本地 0.1.0 安装包，152 项自动测试通过。已完成只读复核、构建与 ZIP 校验，详见 `docs/验收记录.md`；“发布”仅指本地打包，未上传社区或其他远端。

> **执行：** 使用 writing-plans、test-driven-development、dispatching-parallel-agents 与 verification-before-completion。仓库尚无提交基线，原有未跟踪文件全部保留；直接按文件归属隔离修改，不提交、不创建不可用的 worktree。

**目标：** 灵感默认按月保存，可选年、季度、月、日、单文件；文件达到配置大小后自动续卷，最近列表跨文件汇总。

**架构：** capture-files.cjs 统一处理配置默认值、时间桶、匹配范围、续卷和来源读取；capture.cjs 保持现有编辑/附件/录音逻辑，将提交目标与首次保存时间写入设备草稿，跨月和失败重试仍能查重。模型与设置独立更新，旧笔记不搬移、不删除。

**技术栈：** 现有 JavaScript/CJS、Obsidian Vault API、TextEncoder UTF-8 字节计数、Node 内置测试、设备 IndexedDB。

## 配置约定

capture.config 新增 `saveMode: 'year'|'quarter'|'month'|'day'|'single'`、`noteFolder`、`splitBySize`、`maxFileSizeKB`；保留 notePath 与 attachmentFolder。

- 新卡片默认 month、noteFolder=收件箱/灵感、splitBySize=true、maxFileSizeKB=1024。
- 旧配置缺少新增字段时升级为默认按月；noteFolder 从原 notePath 去掉 .md 推导，原 notePath 作为历史来源保留，原 notePath 只作为历史来源；single 使用其文件名并保存到所选根目录内。
- 时间文件依次为 YYYY.md、YYYY-QN.md、YYYY-MM.md、YYYY-MM-DD.md；续卷从 -002.md 开始，三位以上序号，避免与日期混淆。
- 文件大小按 UTF-8 Markdown 全文计算，不计独立附件；单条超限内容保持完整，可单独占一卷并在界面说明。

## 文件归属与顺序

1. 配置/设置任务：仅修改 src/core/model.js、src/modals.js 及 tests/model.test.js、tests/modals.test.js。补旧配置升级与五种模式/大小阈值验证测试，先失败后实现。设置表单显示模式、目录或单文件路径、大小拆分开关和 KB 阈值。
2. 主代理：src/core/capture-files.cjs、src/cards/capture.cjs、tests/capture-files.test.cjs、tests/capture.test.cjs、必要的 UI 回归。先写时间边界、跨文件最近内容、UTF-8 续卷与跨月重试测试，再实现。
3. 集成：保存目标、提交标记与时间进入草稿快照；最近记录携带真实来源路径和行号；附件链接以实际目标笔记生成；追加时重新检查大小以处理并发。
4. 只读复核后更新说明、版本与安装包，运行全量测试、构建和 ZIP 一致性校验。

## 保存目录的最终约定

用户进一步确认只配置一个保存根目录，笔记和附件都必须在其下。默认 `收件箱/灵感/2026-11.md`，附件对应 `收件箱/灵感/附件/2026-11/`；续卷同样对应 `2026-11-002`。旧 notePath 与 attachmentFolder 字段仅保留兼容信息，不再显示为独立路径输入。

## 关键验证

- 年、季度、月、日与单文件的命名、跨年/跨季度与根目录。
- 刚好达到阈值、中文多字节、单条超限、同周期多个续卷和多个卡片同时写入。
- 旧单文件与新时间文件均可显示最近内容，点击定位正确笔记和行号。
- 保存实际成功但抛错、清理草稿失败及跨月恢复均不重复写入。
- 原附件、录音、异常恢复与布局无损更新测试继续通过。

实际 Obsidian 与多端同步行为继续单独验收，不以测试替身代替真机结果。
