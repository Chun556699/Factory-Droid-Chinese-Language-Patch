[English](README.md) · **简体中文**

# Factory Desktop 简体中文补丁

让 **Factory Desktop**（Droid CLI 的桌面客户端）一键变成中文界面。

- 翻译约 **10,900** 条界面文本（覆盖率 **98.6%**）：侧边栏、菜单、对话框、会话、设置、自动化、软件工厂等
- 启用应用内置但被隐藏的「简体中文」语言选项，可在 **设置 → 偏好设置 → 语言** 中自由切换中 / 英 / 日
- 自动备份原版文件，可随时一键恢复英文
- 保留 Electron 的完整性校验机制（更新校验值而非绕过），不关闭任何安全特性
- **本仓库不包含任何 Factory 程序文件**——补丁只修改你自己电脑上已安装的副本

## 使用方法

1. 下载补丁：到 [Releases](../../releases) 页面下载最新 ZIP，或点击右上角 **Code → Download ZIP**，解压到任意位置。
2. 完全退出 Factory（包括右下角的系统托盘图标）。
3. **双击 `一键汉化.bat`**，按提示操作即可。
   - 如果电脑上没有安装 Node.js，脚本会询问是否用 winget 自动安装（只需装一次，也可先到 https://nodejs.org 手动安装）。
   - 脚本会自动找到最新版本的 `app-x.y.z` 安装目录（`%LOCALAPPDATA%\Factory`）。

恢复英文原版：完全退出 Factory 后，**双击 `恢复英文原版.bat`**。

## 常见问题

**Factory 更新后中文消失了？**
Factory 自动更新会覆盖补丁。更新完成后重新双击 `一键汉化.bat` 即可（补丁按内容特征定位修改点，通常兼容新版本；如遇到不支持的新版本会安全中止，不会弄坏程序）。

**安装后仍是英文？**
你的系统语言不是中文时，首次需要手动切换：设置 → 偏好设置 → 语言 → 简体中文。

**杀毒软件 / SmartScreen 提示？**
补丁会修改本地 `app.asar` 和 `factory-desktop.exe`，原本的微软数字签名自然失效，少数杀软可能提示。这是正常现象；本工具全部代码开源，可自行审查 `src/patcher.js`。

**哪些没翻译？**
约 1.4% 未翻译的内容均为产品名、URL、命令行示例、代码片段等应保留英文的文本（与官方日语版的处理方式一致）。未覆盖到的词条会自动回退显示英文，不会出现空白或报错。

## 命令行用法（可选）

```
node dist\patcher.cjs status            # 查看当前状态
node dist\patcher.cjs install           # 汉化（同 一键汉化.bat）
node dist\patcher.cjs restore           # 恢复英文（同 恢复英文原版.bat）
node dist\patcher.cjs install --dir "D:\...\app-0.195.0" --yes --no-launch
```

## 帮助改进翻译

翻译词典是 `translations/zh-CN.json`（`英文原文 → 中文` 的 JSON 对象）。修改后重新运行 `一键汉化.bat` 即可生效。运行 `node dist\patcher.cjs report` 会生成 `translations/untranslated.json`，列出所有尚未翻译的英文文本，欢迎提交 PR 补全。

## 维护者：重新打包补丁

```
npm install        # 安装 esbuild / @electron/asar / acorn
npm run build      # 生成 dist/patcher.cjs（单文件，含全部依赖）
```

## 免责声明

本项目为非官方社区补丁，与 Factory / Cognition 无关。仅修改你自己电脑上已安装的程序副本，不分发、不修改任何 Factory 官方文件。使用风险自负；如出现问题，请先运行 `恢复英文原版.bat` 或重新安装 Factory。

## License

MIT
