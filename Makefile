.DEFAULT_GOAL := help
.PHONY: help deps build test check package release-check release-draft release

help:
	@echo "make deps           安装固定版本的开发依赖"
	@echo "make build          构建 main.js"
	@echo "make test           运行测试"
	@echo "make check          运行测试、构建和语法检查"
	@echo "make package        生成本地安装 ZIP"
	@echo "make release-check  检查发布条件并展示计划（不上传）"
	@echo "make release-draft  检查、测试、打包并创建 GitHub Release 草稿"
	@echo "make release        检查、测试、打包并正式发布 GitHub Release"

deps:
	npm ci

build:
	npm run build

test:
	npm test

check: test build
	node --check main.js

package:
	npm run package

release-check:
	node scripts/release.mjs --check

release-draft:
	node scripts/release.mjs --draft

release:
	node scripts/release.mjs
