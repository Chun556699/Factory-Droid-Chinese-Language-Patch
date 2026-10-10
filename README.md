**English** · [简体中文](README.zh-CN.md)

# Factory Desktop Simplified Chinese Patch

Turn **Factory Desktop** (the desktop client of the Droid CLI) into a Chinese UI with one click.

- Translates **~10,900 UI strings** (**98.6%** coverage): sidebar, menus, dialogs, sessions, settings, automations, Software Factory, tasks, analytics, and more
- Enables the app's built-in (but hidden) **Simplified Chinese** locale — switch between Chinese / English / Japanese anytime under **Settings → Preferences → Language**
- Automatically backs up the original files; one click restores the English version
- Keeps Electron's integrity verification working (updates the verification value instead of bypassing it)
- **This repository contains no Factory program files** — the patch only modifies the copy installed on your own machine

## Usage

1. Download the ZIP from the [Releases](../../releases) page (or **Code → Download ZIP**) and extract it anywhere.
2. Quit Factory completely (including the system tray icon).
3. **Double-click `一键汉化.bat`** ("Install Chinese Patch") and follow the prompts.
   - If Node.js is not installed, the script offers to install it automatically via winget (one-time, or install it manually from https://nodejs.org).
   - The script automatically finds the newest `app-x.y.z` install directory (`%LOCALAPPDATA%\Factory`).

To restore the original English version: quit Factory, then **double-click `恢复英文原版.bat`** ("Restore English").

All prompts appear in English on non-Chinese systems; force a language with `--lang en` or `--lang zh`.

## FAQ

**Chinese disappeared after a Factory update?**
Auto-updates overwrite the patch. Just run `一键汉化.bat` again after updating — the patcher locates patch points by code patterns, so it usually keeps working on new versions and aborts safely (without breaking anything) if it doesn't.

**Still in English after patching?**
If your system language is not Chinese, switch manually once: Settings → Preferences → Language → 简体中文.

**Antivirus / SmartScreen warnings?**
The patch modifies your local `app.asar` and `factory-desktop.exe`, so the original Microsoft signature no longer matches — some antivirus tools may flag it. All source code is open for review in `src/patcher.js`.

**What isn't translated?**
The remaining ~1.4% are product names, URLs, CLI examples and code snippets that should stay in English (same approach as the official Japanese locale). Anything untranslated falls back to English — no blanks, no errors.

## CLI usage (optional)

```
node dist\patcher.cjs status            # show current state
node dist\patcher.cjs install           # apply the patch (same as 一键汉化.bat)
node dist\patcher.cjs restore           # restore English (same as 恢复英文原版.bat)
node dist\patcher.cjs install --dir "D:\...\app-0.195.0" --yes --no-launch --lang en
```

## Help improve the translation

The dictionary is `translations/zh-CN.json` (a JSON map of `English source → Chinese`). Edit it and re-run the install script to apply your changes. Running `node dist\patcher.cjs report` writes `translations/untranslated.json` listing every untranslated string — PRs welcome.

## Maintainers: rebuild the patcher

```
npm install        # esbuild / @electron/asar / acorn
npm run build      # produces dist/patcher.cjs (single file, all deps bundled)
```

## Disclaimer

Unofficial community patch, not affiliated with Factory / Cognition. It only modifies the copy installed on your own machine; no Factory files are distributed. Use at your own risk — if anything goes wrong, run `恢复英文原版.bat` or reinstall Factory.

## License

MIT
