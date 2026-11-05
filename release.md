# Simple Space 构建与发布

在插件源码目录执行，需安装 Node.js、npm、Make、Git 和 `zip`；GitHub 发布另需 [GitHub CLI](https://cli.github.com/) 和 [actionlint](https://github.com/rhysd/actionlint)。macOS 可执行 `brew install actionlint`。Windows 开发环境可使用 WSL。普通用户安装插件不需要这些开发工具。

```sh
make deps           # 按 package-lock.json 安装依赖
make check          # UTC／上海两时区测试、构建、语法检查
make package        # 生成 dist/simple-space-版本.zip
make lint-workflows # 检查 Actions 语法及表达式上下文
make release-check  # 检查版本、Git、登录状态并展示发布计划，不上传
make release-draft  # 测试、构建、推送版本标签、上传 Release 草稿
make release        # 测试、构建、推送版本标签、正式发布 Release
```

首次发布前，在 GitHub 创建仓库，为本地仓库配置 `origin`，提交源码并将当前分支推送到 GitHub，然后执行 `gh auth login`。面向 Obsidian／BRAT 发布时，默认分支根目录也应包含当前版本的 `manifest.json`。脚本不会自动提交或推送分支；工作区必须没有未提交文件，当前分支的 HEAD 必须与 `origin` 对应分支一致。

版本直接读取 `manifest.json`，标签为 `0.1.1` 这样的原始版本号，不添加 `v`。更新版本时同步修改 `manifest.json`、`package.json`、`package-lock.json` 顶层及根包版本，并在 `versions.json` 中维护“插件版本 → 最低 Obsidian 版本”。脚本会检查一致性，允许同一提交上的已有标签重试，拒绝覆盖指向其他提交的标签。

市场 Release 只上传 `main.js`、`manifest.json`、`styles.css`，不上传 ZIP，以免出现不支持的附件提示。ZIP 仍通过 `make package` 生成在本地 `dist/`，用于手动安装。Release 说明由 GitHub 自动生成。`make release-draft` 会推送远端版本标签并上传草稿附件，草稿确认后需在 GitHub 点击 Publish，才能供其他人安装；它不是纯本地预览。已有 Release 不会被脚本覆盖，上传失败后的残留 Release 需在 GitHub 检查处理后再重试。[GitHub Release 命令说明](https://cli.github.com/manual/gh_release_create)

发布 GitHub Release 与提交 Obsidian 社区目录是两个步骤。本脚本不自动提交社区市场，也不上传用户的 `data.json`、`workspace.json`、笔记或附件。

## 构建来源证明

先将 `.github/workflows/attest-release.yml` 与代码一起提交并推送到默认分支。发布命令会先执行 actionlint，拦截 YAML 解析发现不了的表达式上下文错误。正式发布 Release（或将草稿点 Publish）后，GitHub Actions 自动检查对应版本标签、安装锁定依赖，在 UTC／Asia/Shanghai 分别测试，再重新构建。安装、两种时区测试和构建分成独立步骤，失败时可直接定位。下载的三个已发布附件必须与该次源码构建逐字节一致，随后才通过 `actions/attest@v4` 为它们生成来源证明；不会额外上传证明 JSON 到 Release 附件。

在仓库 Actions 中查看 **Attest release assets**。流程结束前，市场扫描可能仍提示缺少证明；运行时失败可查看对应步骤后重跑。若旧任务的工作流或测试本身需要修复，重跑旧任务仍会读取旧文件；先推送修复，再执行 `gh workflow run attest-release.yml --ref main`（默认分支为 main 时）。它从修复后的固定提交运行，以 manifest 的版本作为目标，自动核对构建输入与原标签一致，再重建并比对三个已发布附件。允许只改工作流、测试或文档来补充现有版本的证明；运行代码或构建输入已变化时会拒绝，需另发新版本，不覆盖旧标签或附件。证明中的源提交为实际执行提交，构建输入与原标签的等同性由校验步骤保证。

验证命令需支持 attestations 的新版 GitHub CLI，例如 `gh attestation verify main.js -R 用户名/仓库名`。README 的 Actions 状态徽章链接到此工作流；旧任务失败状态会在新任务成功后更新，徽章本身不代表市场已通过审核。

证明需要工作流中的 `contents: read`、`id-token: write`、`attestations: write` 权限。普通 GitHub 套餐对此功能要求公开仓库。此机制与 Obsidian 市场审核分开；本地运行测试不能代替 GitHub 实际签发证明。[GitHub 官方文档](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations)

## 社区市场审核

默认分支根目录的 `manifest.json` 与正式 Release 标签必须同版本。先推送代码，再运行 `make release-check`、`make release`。在社区目录添加 GitHub 仓库并发布条目；按扫描反馈修复后递增补丁版本，不能仅更新本地文件而继续提交旧 Release。

描述应简短、不包含 Obsidian、最多250字符并以英文 `. ! ?` 结尾；发布预检会校验这些规则。README.md 提供英文用户说明，README.zh-CN.md 保留完整中文指南。CSS 使用选择器优先级，避免 `!important`。全库文件枚举仍可能出现在扫描权限说明中，这是最近笔记、全库统计和来源选择所需；两份 README 已列明用途与本地处理范围，不通过删功能来隐藏提示。

## GitHub CLI 兼容与排查

发布脚本兼容本机旧版 gh 2.5.2：登录预检使用 `gh auth status --hostname github.com`，不依赖新版的 `--active`；发布前由 Git 校验远端版本标签，并通过 `--target` 固定源提交，不依赖 `--verify-tag`。检查失败时会提示执行独立诊断命令，不再一律误报为未登录。

建议用 Homebrew 管理 GitHub CLI：首次执行 `brew install gh`，以后执行 `brew upgrade gh`。如果以前从源码安装在 `~/go/bin/gh`，用 `which -a gh` 确认路径优先级，安装成功后将旧文件改名备份或调整 PATH，重新打开终端再用 `gh --version` 确认。
