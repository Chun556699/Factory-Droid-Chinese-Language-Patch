'use strict';
// Factory Desktop Simplified Chinese patcher / Factory Desktop 简体中文补丁
//
// Patches a locally installed copy of Factory in place: enables the built-in
// zh-CN locale, injects Chinese resources into the renderer and main process,
// and re-writes the embedded asar integrity hash. No Factory files are
// distributed with this tool.
//
// Usage: node dist/patcher.cjs [install|restore|status|report]
//        [--dir <app-x.y.z dir>] [--yes] [--no-launch] [--lang zh|en]

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const { execFileSync, spawn } = require('child_process');
const asar = require('@electron/asar');
const acorn = require('acorn');

const ROOT = path.resolve(__dirname, '..');
const DICT_PATH = path.join(ROOT, 'translations', 'zh-CN.json');
const UNTRANSLATED_PATH = path.join(ROOT, 'translations', 'untranslated.json');
const BACKUP_SUFFIX = '.zh-cn-backup';
const TMP_SUFFIX = '.zh-cn-tmp';
const ZH_ASSET = 'resources-zh-CN.js';
const ENUM_MARKER = '.ChineseSimplified="zh-CN"';
const PLURAL_SKIP = /_(zero|one|two|few|many)$/;
const HAS_LETTERS = /[A-Za-z]{2,}/;
const CJK_FONTS = '"Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC"';

// ---------------------------------------------------------------- i18n of this tool

const M = {
  zh: {
    unknownArg: (a) => `未知参数：${a}`,
    unknownCommand: (c) => `未知命令：${c}`,
    winOnly: '目前仅支持 Windows 版 Factory。',
    installDir: (d) => `Factory 安装目录：${d}\n`,
    notInstalled: (d) => `未找到 Factory 安装目录：${d}\n请确认已安装 Factory 桌面版，或使用 --dir 指定 app-x.y.z 目录。`,
    noVersions: (b) => `在 ${b} 中未找到可用的 Factory 版本目录（app-x.y.z）。`,
    missingFile: (f) => `缺少文件：${f}\n这似乎不是 Factory 的安装目录。`,
    stillRunning: 'Factory 正在运行，请先完全退出 Factory（包括系统托盘图标）后再运行。',
    closePrompt:
      '\n检测到 Factory 正在运行。请先完全退出 Factory（包括系统托盘图标），然后按回车继续。\n' +
      '输入 K 后回车可强制结束 Factory 进程（进行中的会话会被中断）：',
    integrityMismatch: 'factory-desktop.exe 与 app.asar 的完整性记录不一致，安装可能已损坏。请重新安装 Factory 后再试。',
    computedProp: '资源对象中出现了无法解析的计算属性。',
    templateLiteral: '资源对象中出现了无法解析的模板字符串。',
    unresolvableRef: (n) => `无法解析资源引用：${n}`,
    unresolvableNode: (t) => `资源对象中出现了无法解析的语法：${t}`,
    rendererEnCandidates: (n) => `无法定位英文界面资源（找到 ${n} 个候选）。`,
    mainEnCandidates: (n) => `无法定位主进程英文资源（找到 ${n} 个候选）。`,
    mainEnShape: '主进程英文资源结构不符合预期。',
    anchorFailed: (label, n) => `无法定位补丁位置「${label}」（找到 ${n} 处）。此 Factory 版本可能暂不受支持。`,
    anchorFailedOnce: (label) => `无法定位补丁位置「${label}」。此 Factory 版本可能暂不受支持。`,
    uniqueFailed: (label, n) => `无法定位${label}（找到 ${n} 个候选）。此 Factory 版本可能暂不受支持。`,
    badStructure: '应用结构不符合预期（缺少 .vite 构建目录）。',
    dictMissing: (p) => `缺少翻译文件：${p}`,
    unpackedMismatch: '重新打包后的解包文件集合与原版不一致，已中止。',
    repackCheckFailed: (rel) => `重新打包校验失败：${rel}`,
    patchedNoBackup: '当前 Factory 已被汉化，但找不到原版备份文件，无法重新打补丁。\n请重新安装 Factory 桌面版后再运行。',
    alreadyPatched: '检测到已安装过中文补丁，将基于原版备份重新打补丁。',
    backingUp: '正在备份原版文件...',
    extracting: '正在解包应用...',
    patching: '正在应用中文补丁...',
    repacking: '正在重新打包...',
    installing: '正在安装...',
    verifyFailed: '安装后校验失败，请运行「恢复英文原版」。',
    done: (pct, t, total) => `\n汉化完成！界面文本翻译覆盖率：${pct}%（${t}/${total}）`,
    langHint: '如果界面仍是英文，请在 Factory 的「设置 → 偏好设置 → 语言」中选择「简体中文」。',
    launchPrompt: '\n是否立即启动 Factory？[Y/n]：',
    alreadyEnglish: '当前已是英文原版，无需恢复。',
    noBackupRestore: '找不到原版备份文件，无法恢复。请重新安装 Factory 桌面版。',
    restoring: '正在恢复英文原版...',
    restored: '已恢复英文原版。',
    restoreVerifyFailed: '恢复后校验失败。',
    version: (v) => `版本：${v}`,
    patchState: (s) => `中文补丁：${s}`,
    installed: '已安装',
    notPatched: '未安装',
    backupState: (s) => `原版备份：${s}`,
    backupYes: '存在',
    backupNo: '无',
    dictEntries: (n) => `词典条目：${n}`,
    coverage: (t, total, n, p) => `覆盖率：${t}/${total}，未翻译的英文文本 ${n} 条已写入：${p}`,
    noAsar: '找不到原版 app.asar。',
    error: '[错误]',
    lblSupported: '支持的语言列表',
    lblLoader: '语言资源加载器',
    lblFlag: '界面语言功能开关',
    lblMainSupported: '主进程支持的语言列表',
    lblMainResources: '主进程语言资源',
    lblMainFlag: '主进程语言功能开关',
    lblRenderer: '渲染进程主脚本',
    lblMain: '主进程脚本',
  },
  en: {
    unknownArg: (a) => `Unknown argument: ${a}`,
    unknownCommand: (c) => `Unknown command: ${c}`,
    winOnly: 'Only the Windows edition of Factory is supported right now.',
    installDir: (d) => `Factory install directory: ${d}\n`,
    notInstalled: (d) => `Factory install directory not found: ${d}\nMake sure Factory Desktop is installed, or pass --dir <app-x.y.z dir>.`,
    noVersions: (b) => `No usable Factory version directory (app-x.y.z) found under ${b}.`,
    missingFile: (f) => `Missing file: ${f}\nThis does not look like a Factory install directory.`,
    stillRunning: 'Factory is running. Please quit Factory completely (including the tray icon) and try again.',
    closePrompt:
      '\nFactory is running. Please quit it completely (including the tray icon), then press Enter.\n' +
      'Type K and press Enter to force-kill the Factory process (in-progress sessions will be interrupted): ',
    integrityMismatch: 'The integrity record inside factory-desktop.exe does not match app.asar. The install may be corrupt; please reinstall Factory and try again.',
    computedProp: 'A computed property appeared inside a resource object.',
    templateLiteral: 'An unresolvable template literal appeared inside a resource object.',
    unresolvableRef: (n) => `Could not resolve resource reference: ${n}`,
    unresolvableNode: (t) => `Unresolvable syntax inside a resource object: ${t}`,
    rendererEnCandidates: (n) => `Could not locate the English UI resources (${n} candidates found).`,
    mainEnCandidates: (n) => `Could not locate the main-process English resources (${n} candidates found).`,
    mainEnShape: 'The main-process English resources do not have the expected shape.',
    anchorFailed: (label, n) => `Could not locate the patch point "${label}" (${n} matches). This Factory version may not be supported yet.`,
    anchorFailedOnce: (label) => `Could not locate the patch point "${label}". This Factory version may not be supported yet.`,
    uniqueFailed: (label, n) => `Could not locate ${label} (${n} candidates). This Factory version may not be supported yet.`,
    badStructure: 'Unexpected app structure (missing .vite build directory).',
    dictMissing: (p) => `Missing translation file: ${p}`,
    unpackedMismatch: 'The set of unpacked files after repacking does not match the original; aborted.',
    repackCheckFailed: (rel) => `Repack verification failed: ${rel}`,
    patchedNoBackup: 'This Factory is already patched, but the original backup files are missing.\nPlease reinstall Factory Desktop and run again.',
    alreadyPatched: 'The Chinese patch is already installed; re-patching from the original backups.',
    backingUp: 'Backing up original files...',
    extracting: 'Extracting the app...',
    patching: 'Applying the Chinese patch...',
    repacking: 'Repacking...',
    installing: 'Installing...',
    verifyFailed: 'Post-install verification failed. Please run the restore script.',
    done: (pct, t, total) => `\nDone! UI text translated: ${pct}% (${t}/${total})`,
    langHint: 'If the UI is still in English, choose 简体中文 (Simplified Chinese) under Settings -> Preferences -> Language.',
    launchPrompt: '\nLaunch Factory now? [Y/n]: ',
    alreadyEnglish: 'Factory is already the original English version; nothing to restore.',
    noBackupRestore: 'Original backup files not found. Please reinstall Factory Desktop.',
    restoring: 'Restoring the original English version...',
    restored: 'Original English version restored.',
    restoreVerifyFailed: 'Verification failed after restore.',
    version: (v) => `Version: ${v}`,
    patchState: (s) => `Chinese patch: ${s}`,
    installed: 'installed',
    notPatched: 'not installed',
    backupState: (s) => `Original backup: ${s}`,
    backupYes: 'present',
    backupNo: 'none',
    dictEntries: (n) => `Dictionary entries: ${n}`,
    coverage: (t, total, n, p) => `Coverage: ${t}/${total}. ${n} untranslated strings written to: ${p}`,
    noAsar: 'Original app.asar not found.',
    error: '[Error]',
    lblSupported: 'supported locale list',
    lblLoader: 'locale resource loader',
    lblFlag: 'AppLocalization feature flag',
    lblMainSupported: 'main-process supported locale list',
    lblMainResources: 'main-process locale resources',
    lblMainFlag: 'main-process AppLocalization flag',
    lblRenderer: 'renderer main bundle',
    lblMain: 'main-process bundle',
  },
};

class PatchError extends Error {}
const fail = (message) => {
  throw new PatchError(message);
};
const log = (...args) => console.log(...args);
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------- CLI / environment

function parseArgs(argv) {
  const opts = { command: 'install', dir: null, yes: false, launch: true, lang: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dir') opts.dir = argv[++i];
    else if (arg === '--lang') opts.lang = argv[++i];
    else if (arg === '--yes' || arg === '-y') opts.yes = true;
    else if (arg === '--no-launch') opts.launch = false;
    else if (!arg.startsWith('-')) opts.command = arg;
    else fail(`Unknown argument: ${arg}`);
  }
  if (!['install', 'restore', 'status', 'report'].includes(opts.command)) fail(`Unknown command: ${opts.command}`);
  return opts;
}

function detectLang(cliLang) {
  const pick = cliLang || (process.env.FACTORY_ZH_LANG || '').slice(0, 2) || '';
  if (/^zh/i.test(pick)) return 'zh';
  if (/^en/i.test(pick)) return 'en';
  const loc = (Intl.DateTimeFormat().resolvedOptions().locale || '').toLowerCase();
  return loc.startsWith('zh') ? 'zh' : 'en';
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => (rl.close(), resolve(answer.trim()))));
}

function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

function factoryRoot() {
  return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Factory');
}

// Picks the newest app-x.y.z directory containing an asar (or uses --dir verbatim).
function locateAppDir(dirOpt, m) {
  if (dirOpt) return path.resolve(dirOpt);
  const base = factoryRoot();
  if (!fs.existsSync(base)) fail(m.notInstalled(base));
  const versions = fs
    .readdirSync(base)
    .map((name) => /^app-(\d+(?:\.\d+)*)$/.exec(name))
    .filter((x) => x && fs.existsSync(path.join(base, x[0], 'resources', 'app.asar')))
    .sort((x, y) => compareVersions(y[1], x[1]));
  if (!versions.length) fail(m.noVersions(base));
  return path.join(base, versions[0][0]);
}

function appPaths(appDir, m) {
  const res = path.join(appDir, 'resources');
  const p = {
    appDir,
    asar: path.join(res, 'app.asar'),
    unpacked: path.join(res, 'app.asar.unpacked'),
    exe: path.join(appDir, 'factory-desktop.exe'),
  };
  p.asarBackup = p.asar + BACKUP_SUFFIX;
  p.exeBackup = p.exe + BACKUP_SUFFIX;
  for (const f of [p.asar, p.exe]) if (!fs.existsSync(f)) fail(m.missingFile(f));
  return p;
}

// Factory processes whose executable lives inside the given app directory.
function runningInstances(appDir) {
  if (process.platform !== 'win32') return [];
  const script =
    "Get-CimInstance Win32_Process -Filter \"Name='factory-desktop.exe'\" | ForEach-Object { '{0}|{1}' -f $_.ProcessId, $_.ExecutablePath }";
  const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' });
  const target = path.resolve(appDir).toLowerCase() + path.sep;
  return out
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [pid, exePath = ''] = line.split('|');
      return { pid, exePath };
    })
    .filter(({ exePath }) => !exePath || path.resolve(exePath).toLowerCase().startsWith(target));
}

async function ensureClosed(appDir, opts, m) {
  for (;;) {
    const procs = runningInstances(appDir);
    if (!procs.length) return;
    if (opts.yes) fail(m.stillRunning);
    const answer = await ask(m.closePrompt);
    if (answer.toLowerCase() === 'k') {
      const args = procs.flatMap(({ pid }) => ['/PID', pid]);
      try {
        execFileSync('taskkill', ['/F', ...args], { stdio: 'ignore' });
      } catch {}
      await sleep(2000);
    }
  }
}

// ---------------------------------------------------------------- asar / exe helpers

const headerString = (asarFile) => asar.getRawHeader(asarFile).headerString;
const headerHash = (asarFile) => sha256(headerString(asarFile));
const isPatched = (asarFile) => headerString(asarFile).includes(`"${ZH_ASSET}"`);

function countOccurrences(buf, needle) {
  let count = 0;
  for (let i = buf.indexOf(needle); i !== -1; i = buf.indexOf(needle, i + 1)) count++;
  return count;
}

// Electron stores the app.asar header SHA256 inside the exe resources
// (EnableEmbeddedAsarIntegrityValidation). Returns whether the exe needs patching.
function integrityInfo(asarFile, exeFile, m) {
  const hash = headerHash(asarFile);
  const exe = fs.readFileSync(exeFile);
  const count = countOccurrences(exe, Buffer.from(hash));
  if (count === 1) return { hash, exe, embedded: true };
  if (count === 0 && !exe.includes(Buffer.from('"file":"resources\\\\app.asar"'))) return { hash, exe, embedded: false };
  fail(m.integrityMismatch);
}

function collectEntries(header, prefix = '', out = new Map()) {
  for (const [name, entry] of Object.entries(header.files || {})) {
    const rel = prefix ? `${prefix}/${name}` : name;
    if (entry.files) collectEntries(entry, rel, out);
    else out.set(rel, entry);
  }
  return out;
}

// ---------------------------------------------------------------- English resource extraction
//
// Factory bundles its i18next resources as plain JS object literals inside the
// minified bundles. We parse the bundle with acorn and evaluate only the
// literals (plus Object.assign calls and identifier references) to recover the
// resource trees — the same technique used to extract the Japanese bundle.

function parseProgram(src) {
  try {
    return acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module' });
  } catch {
    return acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true });
  }
}

function topLevelDecls(ast) {
  const decls = new Map();
  for (const node of ast.body) {
    if (node.type !== 'VariableDeclaration') continue;
    for (const d of node.declarations) if (d.id.type === 'Identifier' && d.init) decls.set(d.id.name, d.init);
  }
  return decls;
}

function makeEvaluator(decls, m) {
  const memo = new Map();
  const ev = (node) => {
    switch (node.type) {
      case 'ObjectExpression': {
        const out = {};
        for (const prop of node.properties) {
          if (prop.type === 'SpreadElement') Object.assign(out, ev(prop.argument));
          else if (!prop.computed) out[prop.key.type === 'Identifier' ? prop.key.name : String(prop.key.value)] = ev(prop.value);
          else fail(m.computedProp);
        }
        return out;
      }
      case 'ArrayExpression':
        return node.elements.map(ev);
      case 'Literal':
        return node.value;
      case 'TemplateLiteral':
        if (node.expressions.length) fail(m.templateLiteral);
        return node.quasis[0].value.cooked;
      case 'Identifier': {
        if (!memo.has(node.name)) {
          const init = decls.get(node.name);
          if (!init) fail(m.unresolvableRef(node.name));
          memo.set(node.name, ev(init));
        }
        return memo.get(node.name);
      }
      case 'CallExpression':
        if (isObjectAssign(node)) return Object.assign({}, ...node.arguments.map(ev));
        break;
    }
    fail(m.unresolvableNode(node.type));
  };
  return ev;
}

function isObjectAssign(node) {
  return (
    node.type === 'CallExpression' &&
    node.callee.type === 'MemberExpression' &&
    node.callee.object.type === 'Identifier' &&
    node.callee.object.name === 'Object' &&
    node.callee.property.name === 'assign'
  );
}

// Renderer: const X = normalize({...Object.assign({"./common.json": ..., ...}), components: ...})
function extractRendererEnglish(src, m) {
  const decls = topLevelDecls(parseProgram(src));
  const isGlob = (node) =>
    node &&
    isObjectAssign(node) &&
    node.arguments[0]?.type === 'ObjectExpression' &&
    node.arguments[0].properties.some((p) => p.type === 'Property' && p.key.type === 'Literal' && p.key.value === './common.json');
  const roots = [...decls.values()].filter(
    (init) =>
      init.type === 'CallExpression' &&
      init.arguments[0]?.type === 'ObjectExpression' &&
      init.arguments[0].properties.some((p) => p.type === 'SpreadElement' && isGlob(p.argument)),
  );
  if (roots.length !== 1) fail(m.rendererEnCandidates(roots.length));
  const raw = makeEvaluator(decls, m)(roots[0].arguments[0]);
  const out = {};
  for (const [key, value] of Object.entries(raw)) out[key.replace(/^.*\//, '').replace(/\.json$/, '')] = value;
  return out;
}

const MAIN_RESOURCES_RE = /([\w$]+)=\{\[([\w$]+)\.English\]:([\w$]+),\[\2\.Japanese\]:\{desktop:([\w$]+)\}\}/g;

// Main process: X = {[L.English]: EN, [L.Japanese]: {desktop: JA}}
function extractMainEnglish(src, m) {
  const matches = [...src.matchAll(MAIN_RESOURCES_RE)];
  if (matches.length !== 1) fail(m.mainEnCandidates(matches.length));
  const tree = makeEvaluator(topLevelDecls(parseProgram(src)), m)({ type: 'Identifier', name: matches[0][3] });
  if (!tree || typeof tree.desktop !== 'object') fail(m.mainEnShape);
  return tree.desktop;
}

// Builds the zh resource tree by mapping each English leaf through the dictionary.
function translateTree(node, dict, stats) {
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (value && typeof value === 'object') {
      const sub = translateTree(value, dict, stats);
      if (Object.keys(sub).length) out[key] = sub;
    } else if (typeof value === 'string' && !PLURAL_SKIP.test(key)) {
      stats.total++;
      if (Object.prototype.hasOwnProperty.call(dict, value) && dict[value]) {
        out[key] = dict[value];
        stats.translated++;
      } else if (HAS_LETTERS.test(value)) stats.missing.add(value);
    }
  }
  return out;
}

// ---------------------------------------------------------------- source patching
//
// Patch points are located by content patterns (locale enum member access is
// stable across minifier renames), so the patcher usually survives app updates.
// Every pattern must match exactly once, otherwise we abort without writing.

function replaceOnce(src, regex, replacer, label, m) {
  const matches = [...src.matchAll(new RegExp(regex.source, 'g'))];
  if (matches.length !== 1) fail(m.anchorFailed(label, matches.length));
  const x = matches[0];
  return src.slice(0, x.index) + replacer(...x) + src.slice(x.index + x[0].length);
}

function replaceAll(src, regex, replacement, label, m) {
  const count = [...src.matchAll(new RegExp(regex.source, 'g'))].length;
  if (!count) fail(m.anchorFailedOnce(label));
  return src.replace(new RegExp(regex.source, 'g'), replacement);
}

const SUPPORTED_RE = /([\w$]+)=\[([\w$]+)\.English,\2\.Japanese\]/;
const jsonLiteral = (obj) => `JSON.parse(${JSON.stringify(JSON.stringify(obj))})`;

function patchRenderer(src, m) {
  src = replaceOnce(src, SUPPORTED_RE, (_, name, e) => `${name}=[${e}.English,${e}.ChineseSimplified,${e}.Japanese]`, m.lblSupported, m);
  src = replaceOnce(
    src,
    /\[([\w$]+)\.Japanese\]:(async\(\)=>await [\w$]+\(\(\)=>import\("\.\/)(resources-[\w$-]+\.js)("\),\[\],import\.meta\.url\))/,
    (x, e, head, _file, tail) => `[${e}.ChineseSimplified]:${head}${ZH_ASSET}${tail},${x}`,
    m.lblLoader,
    m,
  );
  return replaceAll(src, /[\w$]+\([\w$]+\.AppLocalization\)/, '!0', m.lblFlag, m);
}

function patchMain(src, zhDesktop, m) {
  src = replaceOnce(src, SUPPORTED_RE, (_, name, e) => `${name}=[${e}.English,${e}.ChineseSimplified,${e}.Japanese]`, m.lblMainSupported, m);
  src = replaceOnce(
    src,
    MAIN_RESOURCES_RE,
    (_, name, e, en, ja) => `${name}={[${e}.English]:${en},[${e}.Japanese]:{desktop:${ja}},[${e}.ChineseSimplified]:{desktop:${jsonLiteral(zhDesktop)}}}`,
    m.lblMainResources,
    m,
  );
  return replaceAll(src, /[\w$]+\.getFlag\([\w$]+\.FactoryFeatureFlags\.AppLocalization\)/, '!0', m.lblMainFlag, m);
}

function patchCss(src) {
  const re = /(--core-v2-font-family-sans:\s*"Geist",\s*system-ui,)(\s*sans-serif)/;
  return re.test(src) ? src.replace(re, `$1 ${CJK_FONTS},$2`) : null;
}

function findUnique(files, predicate, label, m) {
  const matches = files.filter((f) => predicate(fs.readFileSync(f, 'utf8')));
  if (matches.length !== 1) fail(m.uniqueFailed(label, matches.length));
  return matches[0];
}

// Locates the renderer bundle, the main-process bundle and the stylesheet by
// their content rather than by hashed filenames.
function locateSources(appDir, m) {
  const assetsDir = path.join(appDir, '.vite', 'renderer', 'main_window', 'assets');
  const buildDir = path.join(appDir, '.vite', 'build');
  if (!fs.existsSync(assetsDir) || !fs.existsSync(buildDir)) fail(m.badStructure);
  const assets = fs.readdirSync(assetsDir).map((f) => path.join(assetsDir, f));
  const builds = fs.readdirSync(buildDir).map((f) => path.join(buildDir, f)).filter((f) => f.endsWith('.js'));
  return {
    assetsDir,
    renderer: findUnique(assets.filter((f) => f.endsWith('.js')), (s) => s.includes(ENUM_MARKER) && s.includes('.AppLocalization'), m.lblRenderer, m),
    main: findUnique(builds, (s) => s.includes(ENUM_MARKER) && s.includes('FactoryFeatureFlags.AppLocalization'), m.lblMain, m),
    css: assets.filter((f) => f.endsWith('.css')).find((f) => fs.readFileSync(f, 'utf8').includes('--core-v2-font-family-sans:')),
  };
}

function loadDictionary(m) {
  if (!fs.existsSync(DICT_PATH)) fail(m.dictMissing(DICT_PATH));
  return JSON.parse(fs.readFileSync(DICT_PATH, 'utf8'));
}

function buildTranslations(sources, dict, m) {
  const rendererSrc = fs.readFileSync(sources.renderer, 'utf8');
  const mainSrc = fs.readFileSync(sources.main, 'utf8');
  const stats = { total: 0, translated: 0, missing: new Set() };
  const zhRenderer = translateTree(extractRendererEnglish(rendererSrc, m), dict, stats);
  const zhMain = translateTree(extractMainEnglish(mainSrc, m), dict, stats);
  return { rendererSrc, mainSrc, zhRenderer, zhMain, stats };
}

function applyPatches(appDir, dict, m) {
  const sources = locateSources(appDir, m);
  const t = buildTranslations(sources, dict, m);
  const outputs = [
    [sources.renderer, patchRenderer(t.rendererSrc, m)],
    [sources.main, patchMain(t.mainSrc, t.zhMain, m)],
    [path.join(sources.assetsDir, ZH_ASSET), `const resources=${jsonLiteral(t.zhRenderer)};export{resources};\n`],
  ];
  const css = sources.css && patchCss(fs.readFileSync(sources.css, 'utf8'));
  if (css) outputs.push([sources.css, css]);
  for (const [file, content] of outputs) {
    if (file.endsWith('.js')) parseProgram(content);
    fs.writeFileSync(file, content);
  }
  return { stats: t.stats, changed: outputs.map(([file]) => path.relative(appDir, file).split(path.sep).join('/')) };
}

// ---------------------------------------------------------------- packing

// Repacks the tree, then verifies that every file we did not touch still has
// the exact same integrity hash as in the original header. Unpacked native
// modules keep their original header entries byte-for-byte.
async function packArchive(appDir, outFile, origHeaderString, changed, m) {
  await asar.createPackageWithOptions(appDir, outFile, { unpack: '*.node' });
  const orig = collectEntries(JSON.parse(origHeaderString));
  const next = collectEntries(JSON.parse(headerString(outFile)));
  const origUnpacked = [...orig].filter(([, e]) => e.unpacked).map(([k]) => k).sort();
  const nextUnpacked = [...next].filter(([, e]) => e.unpacked).map(([k]) => k).sort();
  if (origUnpacked.join('\n') !== nextUnpacked.join('\n')) fail(m.unpackedMismatch);
  for (const [rel, entry] of orig) {
    if (entry.unpacked || changed.includes(rel)) continue;
    const n = next.get(rel);
    if (!n || n.size !== entry.size || n.integrity?.hash !== entry.integrity?.hash) fail(m.repackCheckFailed(rel));
  }
  let buf = fs.readFileSync(outFile);
  for (const rel of origUnpacked) {
    const from = Buffer.from(JSON.stringify(next.get(rel)));
    const to = Buffer.from(JSON.stringify(orig.get(rel)));
    if (from.equals(to) || from.length !== to.length || countOccurrences(buf, from) !== 1) continue;
    to.copy(buf, buf.indexOf(from));
  }
  fs.writeFileSync(outFile, buf);
  buf = null;
  JSON.parse(headerString(outFile));
  return headerHash(outFile);
}

// ---------------------------------------------------------------- commands

// Installs the new asar first and the exe second; a failure between them leaves
// a consistent state and rolls the asar back to the backup.
function swapIn(p, asarSource, exeBuffer) {
  const asarTmp = p.asar + TMP_SUFFIX;
  const exeTmp = p.exe + TMP_SUFFIX;
  fs.copyFileSync(asarSource, asarTmp);
  if (exeBuffer) fs.writeFileSync(exeTmp, exeBuffer);
  fs.renameSync(asarTmp, p.asar);
  if (!exeBuffer) return;
  try {
    fs.renameSync(exeTmp, p.exe);
  } catch (err) {
    fs.copyFileSync(p.asarBackup, p.asar);
    fs.rmSync(exeTmp, { force: true });
    throw err;
  }
}

// Ensures backup copies of the ORIGINAL asar + exe exist next to the install.
// If Factory is already patched we repatch from the backups (idempotent).
async function prepareBackups(p, m) {
  if (isPatched(p.asar)) {
    if (!fs.existsSync(p.asarBackup) || !fs.existsSync(p.exeBackup)) fail(m.patchedNoBackup);
    log(m.alreadyPatched);
  } else {
    integrityInfo(p.asar, p.exe, m);
    log(m.backingUp);
    fs.copyFileSync(p.asar, p.asarBackup);
    fs.copyFileSync(p.exe, p.exeBackup);
  }
  return integrityInfo(p.asarBackup, p.exeBackup, m);
}

async function extractOriginal(p, work) {
  const srcDir = path.join(work, 'src');
  fs.mkdirSync(srcDir, { recursive: true });
  const archive = path.join(srcDir, 'app.asar');
  fs.copyFileSync(p.asarBackup, archive);
  // asar looks for "<archive>.unpacked" next to the archive when extracting.
  if (fs.existsSync(p.unpacked)) fs.cpSync(p.unpacked, archive + '.unpacked', { recursive: true });
  const appDir = path.join(work, 'app');
  asar.extractAll(archive, appDir);
  return { appDir, origHeader: headerString(archive) };
}

async function install(p, opts, m) {
  const dict = loadDictionary(m);
  await ensureClosed(p.appDir, opts, m);
  const integrity = await prepareBackups(p, m);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-zh-cn-'));
  try {
    log(m.extracting);
    const { appDir, origHeader } = await extractOriginal(p, work);
    log(m.patching);
    const { stats, changed } = applyPatches(appDir, dict, m);
    log(m.repacking);
    const outAsar = path.join(work, 'out', 'app.asar');
    fs.mkdirSync(path.dirname(outAsar), { recursive: true });
    const newHash = await packArchive(appDir, outAsar, origHeader, changed, m);
    let exe = null;
    if (integrity.embedded) {
      exe = Buffer.from(integrity.exe);
      Buffer.from(newHash).copy(exe, exe.indexOf(Buffer.from(integrity.hash)));
    }
    await ensureClosed(p.appDir, opts, m);
    log(m.installing);
    swapIn(p, outAsar, exe);
    if (headerHash(p.asar) !== newHash || (exe && !fs.readFileSync(p.exe).includes(Buffer.from(newHash)))) fail(m.verifyFailed);
    const pct = ((100 * stats.translated) / Math.max(stats.total, 1)).toFixed(1);
    log(m.done(pct, stats.translated, stats.total));
    log(m.langHint);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
  if (opts.launch && !opts.yes && !opts.dir) {
    const answer = await ask(m.launchPrompt);
    if (!answer || /^y/i.test(answer)) {
      const stub = path.join(path.dirname(p.appDir), 'factory-desktop.exe');
      spawn(fs.existsSync(stub) ? stub : p.exe, [], { detached: true, stdio: 'ignore' }).unref();
    }
  }
}

async function restore(p, opts, m) {
  if (!fs.existsSync(p.asarBackup) || !fs.existsSync(p.exeBackup)) {
    if (!isPatched(p.asar)) return log(m.alreadyEnglish);
    fail(m.noBackupRestore);
  }
  integrityInfo(p.asarBackup, p.exeBackup, m);
  await ensureClosed(p.appDir, opts, m);
  log(m.restoring);
  swapIn(p, p.asarBackup, fs.readFileSync(p.exeBackup));
  if (headerHash(p.asar) !== headerHash(p.asarBackup)) fail(m.restoreVerifyFailed);
  fs.rmSync(p.asarBackup, { force: true });
  fs.rmSync(p.exeBackup, { force: true });
  log(m.restored);
}

function status(p, m) {
  const patched = isPatched(p.asar);
  const hasBackup = fs.existsSync(p.asarBackup) && fs.existsSync(p.exeBackup);
  log(m.version(path.basename(p.appDir).replace(/^app-/, '')));
  log(m.patchState(patched ? m.installed : m.notPatched));
  log(m.backupState(hasBackup ? m.backupYes : m.backupNo));
  log(m.dictEntries(Object.keys(loadDictionary(m)).length));
}

// Writes translations/untranslated.json: every English string with no Chinese
// entry yet — the to-do list for contributors after Factory updates.
async function report(p, m) {
  const source = isPatched(p.asar) ? p.asarBackup : p.asar;
  if (!fs.existsSync(source)) fail(m.noAsar);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-zh-cn-'));
  try {
    const archive = path.join(work, 'app.asar');
    fs.copyFileSync(source, archive);
    if (fs.existsSync(p.unpacked)) fs.cpSync(p.unpacked, archive + '.unpacked', { recursive: true });
    const appDir = path.join(work, 'app');
    asar.extractAll(archive, appDir);
    const { stats } = buildTranslations(locateSources(appDir, m), loadDictionary(m), m);
    const missing = Object.fromEntries([...stats.missing].sort().map((s) => [s, '']));
    fs.writeFileSync(UNTRANSLATED_PATH, JSON.stringify(missing, null, 2) + '\n');
    log(m.coverage(stats.translated, stats.total, Object.keys(missing).length, UNTRANSLATED_PATH));
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const m = M[detectLang(opts.lang)];
  if (process.platform !== 'win32' && !opts.dir) fail(m.winOnly);
  const p = appPaths(locateAppDir(opts.dir, m), m);
  log(m.installDir(p.appDir));
  if (opts.command === 'install') await install(p, opts, m);
  else if (opts.command === 'restore') await restore(p, opts, m);
  else if (opts.command === 'status') status(p, m);
  else await report(p, m);
}

main().catch((err) => {
  let lang = 'en';
  try {
    lang = detectLang(parseArgs(process.argv.slice(2)).lang);
  } catch {}
  console.error(err instanceof PatchError ? `\n${M[lang].error} ${err.message}` : err);
  process.exitCode = 1;
});
