# GugleAI 开发要求

## 项目结构

- 本项目是 Tauri 2 + Vue 3 + TypeScript 桌面应用。
- 前端主要逻辑和界面位于 `src/App.vue`，原生命令位于 `src-tauri/src/lib.rs`。
- 使用 `pnpm` 管理 Node.js 依赖，使用 Cargo 管理 Rust 依赖。不要混用 npm、Yarn 或其他锁文件。
- `dist/`、`node_modules/`、`src-tauri/target/` 和 `src-tauri/gen/` 是生成内容，不要手工修改或提交构建产物。

## 网络与兼容性

- API 请求必须使用 `src/App.vue` 中封装的 `fetch`，不要直接使用浏览器全局 `fetch`。该封装负责调用 Tauri HTTP 插件并应用系统代理。
- 不得在日志、错误信息或提交内容中暴露 API Key、Authorization 请求头、完整 base64 数据或其他凭据。
- 保持 OpenAI 兼容接口行为：文生图使用 `/images/generations`，图片编辑使用 `/images/edits`，Chat 模式使用 `/chat/completions`。
- API 端点没有版本路径时会自动补充 `/v1`。修改 URL 处理时必须兼容裸域名、已有版本路径和第三方中转服务。
- 生成结果需要继续兼容 `b64_json`、绝对或相对图片 URL、Chat 消息图片和内嵌 base64。
- 自动重试只用于生成请求，不应用于更新检查或结果下载。默认关闭，默认错误码为 `[504]`，默认重试 5 次；只重试用户配置的 HTTP 状态码。
- 新增 Tauri 插件或外部访问范围时，同步检查 `src-tauri/capabilities/default.json` 的最小权限配置。

## 设置与界面

- 新增用户设置时，必须同时提供默认值、从 `localStorage` 恢复，并加入设置持久化的 `watch`。
- 用户界面文案以简体中文为主。界面变更应保持当前紧凑的桌面工具布局，并检查窄窗口下无文字遮挡或控件溢出。
- 功能或使用方式变化时同步更新 `README.md` 和 `README.en.md`。

## 版本与发布

- 遵循语义化版本。面向用户的新功能提升次版本，兼容性修复提升修订版本，破坏性变更提升主版本。
- 在用户准备推送到远程仓库之前，不要主动修改版本号；仅在用户明确要求修改版本号时进行变更。
- 版本号必须在以下文件中保持一致：
  - `package.json`
  - `src-tauri/Cargo.toml`
  - `src-tauri/tauri.conf.json`
  - `src-tauri/Cargo.lock` 中的 `gugle-ai` 包条目
- 修改 Rust 包版本后通过 Cargo 刷新 `Cargo.lock`，不要在锁文件中进行无关的依赖升级。
- 发布工作流从 `src-tauri/tauri.conf.json` 读取版本，并为 main 分支构建生成 `<version>+build.<run_number>` 预发布标签。

## 验证要求

- 所有前端修改至少运行 `pnpm build`，确保 `vue-tsc --noEmit` 和 Vite 构建通过。
- 修改 Rust、Tauri 配置、权限或版本时，运行 `cargo check --manifest-path src-tauri/Cargo.toml`。
- 完成修改后运行 `git diff --check`，并确认没有意外修改生成目录或用户已有的无关变更。
- 涉及 API 行为时，应覆盖 Images、Edits 和 Chat 三条路径中受影响的分支，并确认错误响应仍能保留最终状态码和可读错误信息。

## 更新日志

- Release notes 参考 dsh-launcher，从 Git commit 标题自动生成，保留提交原文并跳过 merge commit，不维护独立中英文变更日志文件。
- 构建 tag 使用 `<version>+build.N`（也兼容 `v` 前缀），以目标提交可达的更早版本/构建 tag 为基线；正式 tag 只使用更早的正式版本作为基线。
- 首次发布无基线时列出全部提交；prepare 固定目标提交和比较基线，最终生成下载表时复用，避免重跑/并发混入未来变更。
- 更新日志逻辑位于 `scripts/release-notes.mjs`，测试位于 `tests/release-notes.test.ts`；改动时运行 `pnpm test`，同时检查所有平台下载格式。
- 不为生成日志而主动改版本号，也不覆盖历史 Release。
