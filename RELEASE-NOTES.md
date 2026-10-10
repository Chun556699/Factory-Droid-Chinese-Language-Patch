# Factory Desktop Simplified Chinese Patch v1.0.0 · Factory Desktop 简体中文补丁

**English** | [简体中文](#简体中文)

---

## English

One-click Simplified Chinese localization for **Factory Desktop** (the Droid CLI desktop client).

### What's translated

- **~10,900 UI strings** translated, **98.6%** coverage: sidebar, menus, dialogs, sessions, settings, automations, Software Factory, tasks, analytics
- The native menu bar (File / Edit / View / Window / Help) is localized too
- The remaining ~1.4% are product names, URLs, CLI examples and code snippets that should stay in English; untranslated entries fall back to English
- Tested on Factory **0.195.0** (Windows)

### How to use

1. Download **`Factory-Droid-Chinese-Patch-v1.0.0.zip`** below and extract it
2. Quit Factory completely (including the tray icon)
3. **Double-click `一键汉化.bat`** ("Install Chinese Patch")

> If Node.js is missing, the script offers to install it via winget (one-time).

To revert: quit Factory, then double-click `恢复英文原版.bat` ("Restore English").
If the UI is still English, switch manually under **Settings → Preferences → Language → 简体中文**.

### What the patch does

- Enables the app's built-in (but feature-flag-hidden) Simplified Chinese locale
- Injects Chinese resources into the renderer and the main process
- Updates the embedded Electron asar integrity hash (no verification disabled)
- Backs up the original `app.asar` and `factory-desktop.exe` next to the install for one-click restore
- **Contains no Factory files** — only patches the copy installed on your machine

### Notes

- **Windows only** for now
- Factory auto-updates overwrite the patch — re-run the bat file after updating
- Non-official community patch; use at your own risk

---

## 简体中文

让 **Factory Desktop**（Droid CLI 桌面客户端）一键变成中文界面。

### 本版本翻译覆盖

- **约 10,900 条**界面文本已翻译为简体中文，覆盖率 **98.6%**
- 覆盖范围：侧边栏、顶部菜单、对话框、会话、设置、自动化、软件工厂（Software Factory）、任务、分析等
- 顶部原生菜单（文件 / 编辑 / 视图 / 窗口 / 帮助）同样已中文化
- 未翻译的约 1.4% 为产品名、URL、命令行示例、代码片段等应保留英文的文本；未覆盖词条自动回退英文显示
- 已在 Factory `0.195.0`（Windows 版）上实测通过

### 使用方法

1. 下载下方 Assets 中的 **`Factory-Droid-Chinese-Patch-v1.0.0.zip`** 并解压
2. 完全退出 Factory（包括右下角系统托盘图标）
3. **双击 `一键汉化.bat`**，按提示操作即可

> 没有安装 Node.js 的电脑，脚本会询问是否通过 winget 自动安装（按回车即可，只需装一次）。

恢复英文原版：完全退出 Factory 后，**双击 `恢复英文原版.bat`**。

界面仍为英文时，在 Factory 的 **设置 → 偏好设置 → 语言** 中手动选择「简体中文」（中 / 英 / 日可随时切换）。

### 补丁做了什么

- 启用应用内置但被功能开关隐藏的「简体中文」语言
- 向渲染进程与主进程注入中文语言资源
- 同步更新 Electron 内嵌的 asar 完整性校验值（不绕过校验、不关闭安全特性）
- 自动备份原版 `app.asar` 与 `factory-desktop.exe` 到安装目录，可随时一键恢复
- **不包含任何 Factory 程序文件**：补丁只修改你本机已安装的副本

### 注意事项

- 目前仅支持 **Windows** 版 Factory
- Factory 自动更新后中文会被覆盖，更新后重新双击 `一键汉化.bat` 即可（补丁按代码特征定位，通常兼容新版本；不支持的版本会安全中止，不会损坏程序）
- 补丁会修改本地程序文件，微软数字签名随之失效，个别杀软可能提示，属正常现象
- 非官方社区补丁，与 Factory / Cognition 无关，使用风险自负

### 已知待翻译项

「Mission」（多智能体大任务）与「Task」（单项工作）当前均译为「任务」。欢迎在 Issue / PR 中讨论更合适的译法。运行 `node dist\patcher.cjs report` 可列出全部待翻译文本。
