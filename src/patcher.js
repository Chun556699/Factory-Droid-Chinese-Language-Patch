'use strict';
// Factory Desktop 简体中文补丁
// 在用户本机上对已安装的 Factory 进行汉化：启用应用内置的 zh-CN 语言、注入中文资源、
// 并同步更新 Electron 内嵌的 asar 完整性校验值。不分发任何 Factory 程序文件。
//
// 用法：node dist/patcher.cjs [install|restore|status|report] [--dir <app-x.y.z 目录>] [--yes] [--no-launch]

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

class PatchError extends Error {}
const fail = (message) => {
  throw new PatchError(message);
};
const log = (...args) => console.log(...args);
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------- CLI / environment

function parseArgs(argv) {
  const opts = { command: 'install', dir: null, yes: false, launch: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dir') opts.dir = argv[++i];
    else if (arg === '--yes' || arg === '-y') opts.yes = true;
    else if (arg === '--no-launch') opts.launch = false;
    else if (!arg.startsWith('-')) opts.command = arg;
    else fail(`未知参数：${arg}`);
  }
  if (!['install', 'restore', 'status', 'report'].includes(opts.command)) fail(`未知命令：${opts.command}`);
  return opts;
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

function locateAppDir(dirOpt) {
  if (dirOpt) return path.resolve(dirOpt);
  const base = factoryRoot();
  if (!fs.existsSync(base)) fail(`未找到 Factory 安装目录：${base}\n请确认已安装 Factory 桌面版，或使用 --dir 指定 app-x.y.z 目录。`);
  const versions = fs
    .readdirSync(base)
    .map((name) => /^app-(\d+(?:\.\d+)*)$/.exec(name))
    .filter((m) => m && fs.existsSync(path.join(base, m[0], 'resources', 'app.asar')))
    .sort((x, y) => compareVersions(y[1], x[1]));
  if (!versions.length) fail(`在 ${base} 中未找到可用的 Factory 版本目录（app-x.y.z）。`);
  return path.join(base, versions[0][0]);
}

function appPaths(appDir) {
  const res = path.join(appDir, 'resources');
  const p = {
    appDir,
    asar: path.join(res, 'app.asar'),
    unpacked: path.join(res, 'app.asar.unpacked'),
    exe: path.join(appDir, 'factory-desktop.exe'),
  };
  p.asarBackup = p.asar + BACKUP_SUFFIX;
  p.exeBackup = p.exe + BACKUP_SUFFIX;
  for (const f of [p.asar, p.exe]) if (!fs.existsSync(f)) fail(`缺少文件：${f}\n这似乎不是 Factory 的安装目录。`);
  return p;
}

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

async function ensureClosed(appDir, opts) {
  for (;;) {
    const procs = runningInstances(appDir);
    if (!procs.length) return;
    if (opts.yes) fail('Factory 正在运行，请先完全退出 Factory（包括系统托盘图标）后再运行。');
    const answer = await ask(
      '\n检测到 Factory 正在运行。请先完全退出 Factory（包括系统托盘图标），然后按回车继续。\n' +
        '输入 K 后回车可强制结束 Factory 进程（进行中的会话会被中断）：',
    );
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

// Electron 将 app.asar 头部的 SHA256 写在 exe 资源中（EnableEmbeddedAsarIntegrityValidation）。
function integrityInfo(asarFile, exeFile) {
  const hash = headerHash(asarFile);
  const exe = fs.readFileSync(exeFile);
  const count = countOccurrences(exe, Buffer.from(hash));
  if (count === 1) return { hash, exe, embedded: true };
  if (count === 0 && !exe.includes(Buffer.from('"file":"resources\\\\app.asar"'))) return { hash, exe, embedded: false };
  fail('factory-desktop.exe 与 app.asar 的完整性记录不一致，安装可能已损坏。请重新安装 Factory 后再试。');
}

function walkFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else out.push(full);
  }
  return out;
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

function makeEvaluator(decls) {
  const memo = new Map();
  const ev = (node) => {
    switch (node.type) {
      case 'ObjectExpression': {
        const out = {};
        for (const prop of node.properties) {
          if (prop.type === 'SpreadElement') Object.assign(out, ev(prop.argument));
          else if (!prop.computed) out[prop.key.type === 'Identifier' ? prop.key.name : String(prop.key.value)] = ev(prop.value);
          else fail('资源对象中出现了无法解析的计算属性。');
        }
        return out;
      }
      case 'ArrayExpression':
        return node.elements.map(ev);
      case 'Literal':
        return node.value;
      case 'TemplateLiteral':
        if (node.expressions.length) fail('资源对象中出现了无法解析的模板字符串。');
        return node.quasis[0].value.cooked;
      case 'Identifier': {
        if (!memo.has(node.name)) {
          const init = decls.get(node.name);
          if (!init) fail(`无法解析资源引用：${node.name}`);
          memo.set(node.name, ev(init));
        }
        return memo.get(node.name);
      }
      case 'CallExpression':
        if (isObjectAssign(node)) return Object.assign({}, ...node.arguments.map(ev));
        break;
    }
    fail(`资源对象中出现了无法解析的语法：${node.type}`);
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

// 渲染进程：const X = normalize({...Object.assign({"./common.json": ..., ...}), components: ...})
function extractRendererEnglish(src) {
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
  if (roots.length !== 1) fail(`无法定位英文界面资源（找到 ${roots.length} 个候选）。`);
  const raw = makeEvaluator(decls)(roots[0].arguments[0]);
  const out = {};
  for (const [key, value] of Object.entries(raw)) out[key.replace(/^.*\//, '').replace(/\.json$/, '')] = value;
  return out;
}

const MAIN_RESOURCES_RE = /([\w$]+)=\{\[([\w$]+)\.English\]:([\w$]+),\[\2\.Japanese\]:\{desktop:([\w$]+)\}\}/g;

// 主进程：X = {[L.English]: EN, [L.Japanese]: {desktop: JA}}
function extractMainEnglish(src) {
  const matches = [...src.matchAll(MAIN_RESOURCES_RE)];
  if (matches.length !== 1) fail(`无法定位主进程英文资源（找到 ${matches.length} 个候选）。`);
  const tree = makeEvaluator(topLevelDecls(parseProgram(src)))({ type: 'Identifier', name: matches[0][3] });
  if (!tree || typeof tree.desktop !== 'object') fail('主进程英文资源结构不符合预期。');
  return tree.desktop;
}

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

function replaceOnce(src, regex, replacer, label) {
  const matches = [...src.matchAll(new RegExp(regex.source, 'g'))];
  if (matches.length !== 1) fail(`无法定位补丁位置「${label}」（找到 ${matches.length} 处）。此 Factory 版本可能暂不受支持。`);
  const m = matches[0];
  return src.slice(0, m.index) + replacer(...m) + src.slice(m.index + m[0].length);
}

function replaceAll(src, regex, replacement, label) {
  const count = [...src.matchAll(new RegExp(regex.source, 'g'))].length;
  if (!count) fail(`无法定位补丁位置「${label}」。此 Factory 版本可能暂不受支持。`);
  return src.replace(new RegExp(regex.source, 'g'), replacement);
}

const SUPPORTED_RE = /([\w$]+)=\[([\w$]+)\.English,\2\.Japanese\]/;
const jsonLiteral = (obj) => `JSON.parse(${JSON.stringify(JSON.stringify(obj))})`;

function patchRenderer(src) {
  src = replaceOnce(src, SUPPORTED_RE, (_, name, e) => `${name}=[${e}.English,${e}.ChineseSimplified,${e}.Japanese]`, '支持的语言列表');
  src = replaceOnce(
    src,
    /\[([\w$]+)\.Japanese\]:(async\(\)=>await [\w$]+\(\(\)=>import\("\.\/)(resources-[\w$-]+\.js)("\),\[\],import\.meta\.url\))/,
    (m, e, head, _file, tail) => `[${e}.ChineseSimplified]:${head}${ZH_ASSET}${tail},${m}`,
    '语言资源加载器',
  );
  return replaceAll(src, /[\w$]+\([\w$]+\.AppLocalization\)/, '!0', '界面语言功能开关');
}

function patchMain(src, zhDesktop) {
  src = replaceOnce(src, SUPPORTED_RE, (_, name, e) => `${name}=[${e}.English,${e}.ChineseSimplified,${e}.Japanese]`, '主进程支持的语言列表');
  src = replaceOnce(
    src,
    MAIN_RESOURCES_RE,
    (_, name, e, en, ja) => `${name}={[${e}.English]:${en},[${e}.Japanese]:{desktop:${ja}},[${e}.ChineseSimplified]:{desktop:${jsonLiteral(zhDesktop)}}}`,
    '主进程语言资源',
  );
  return replaceAll(src, /[\w$]+\.getFlag\([\w$]+\.FactoryFeatureFlags\.AppLocalization\)/, '!0', '主进程语言功能开关');
}

function patchCss(src) {
  const re = /(--core-v2-font-family-sans:\s*"Geist",\s*system-ui,)(\s*sans-serif)/;
  return re.test(src) ? src.replace(re, `$1 ${CJK_FONTS},$2`) : null;
}

function findUnique(files, predicate, label) {
  const matches = files.filter((f) => predicate(fs.readFileSync(f, 'utf8')));
  if (matches.length !== 1) fail(`无法定位${label}（找到 ${matches.length} 个候选）。此 Factory 版本可能暂不受支持。`);
  return matches[0];
}

function locateSources(appDir) {
  const assetsDir = path.join(appDir, '.vite', 'renderer', 'main_window', 'assets');
  const buildDir = path.join(appDir, '.vite', 'build');
  if (!fs.existsSync(assetsDir) || !fs.existsSync(buildDir)) fail('应用结构不符合预期（缺少 .vite 构建目录）。');
  const assets = fs.readdirSync(assetsDir).map((f) => path.join(assetsDir, f));
  const builds = fs.readdirSync(buildDir).map((f) => path.join(buildDir, f)).filter((f) => f.endsWith('.js'));
  return {
    assetsDir,
    renderer: findUnique(assets.filter((f) => f.endsWith('.js')), (s) => s.includes(ENUM_MARKER) && s.includes('.AppLocalization'), '渲染进程主脚本'),
    main: findUnique(builds, (s) => s.includes(ENUM_MARKER) && s.includes('FactoryFeatureFlags.AppLocalization'), '主进程脚本'),
    css: assets.filter((f) => f.endsWith('.css')).find((f) => fs.readFileSync(f, 'utf8').includes('--core-v2-font-family-sans:')),
  };
}

function loadDictionary() {
  if (!fs.existsSync(DICT_PATH)) fail(`缺少翻译文件：${DICT_PATH}`);
  return JSON.parse(fs.readFileSync(DICT_PATH, 'utf8'));
}

function buildTranslations(sources, dict) {
  const rendererSrc = fs.readFileSync(sources.renderer, 'utf8');
  const mainSrc = fs.readFileSync(sources.main, 'utf8');
  const stats = { total: 0, translated: 0, missing: new Set() };
  const zhRenderer = translateTree(extractRendererEnglish(rendererSrc), dict, stats);
  const zhMain = translateTree(extractMainEnglish(mainSrc), dict, stats);
  return { rendererSrc, mainSrc, zhRenderer, zhMain, stats };
}

function applyPatches(appDir, dict) {
  const sources = locateSources(appDir);
  const t = buildTranslations(sources, dict);
  const outputs = [
    [sources.renderer, patchRenderer(t.rendererSrc)],
    [sources.main, patchMain(t.mainSrc, t.zhMain)],
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

async function packArchive(appDir, outFile, origHeaderString, changed) {
  await asar.createPackageWithOptions(appDir, outFile, { unpack: '*.node' });
  const orig = collectEntries(JSON.parse(origHeaderString));
  const next = collectEntries(JSON.parse(headerString(outFile)));
  const origUnpacked = [...orig].filter(([, e]) => e.unpacked).map(([k]) => k).sort();
  const nextUnpacked = [...next].filter(([, e]) => e.unpacked).map(([k]) => k).sort();
  if (origUnpacked.join('\n') !== nextUnpacked.join('\n')) fail('重新打包后的解包文件集合与原版不一致，已中止。');
  for (const [rel, entry] of orig) {
    if (entry.unpacked || changed.includes(rel)) continue;
    const n = next.get(rel);
    if (!n || n.size !== entry.size || n.integrity?.hash !== entry.integrity?.hash) fail(`重新打包校验失败：${rel}`);
  }
  // 保持解包文件（原生模块）的头部条目与原版逐字节一致。
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

async function prepareBackups(p) {
  if (isPatched(p.asar)) {
    if (!fs.existsSync(p.asarBackup) || !fs.existsSync(p.exeBackup))
      fail('当前 Factory 已被汉化，但找不到原版备份文件，无法重新打补丁。\n请重新安装 Factory 桌面版后再运行。');
    log('检测到已安装过中文补丁，将基于原版备份重新打补丁。');
  } else {
    integrityInfo(p.asar, p.exe);
    log('正在备份原版文件...');
    fs.copyFileSync(p.asar, p.asarBackup);
    fs.copyFileSync(p.exe, p.exeBackup);
  }
  return integrityInfo(p.asarBackup, p.exeBackup);
}

async function extractOriginal(p, work) {
  const srcDir = path.join(work, 'src');
  fs.mkdirSync(srcDir, { recursive: true });
  const archive = path.join(srcDir, 'app.asar');
  fs.copyFileSync(p.asarBackup, archive);
  if (fs.existsSync(p.unpacked)) fs.cpSync(p.unpacked, archive + '.unpacked', { recursive: true });
  const appDir = path.join(work, 'app');
  asar.extractAll(archive, appDir);
  return { appDir, origHeader: headerString(archive) };
}

async function install(p, opts) {
  const dict = loadDictionary();
  await ensureClosed(p.appDir, opts);
  const integrity = await prepareBackups(p);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-zh-cn-'));
  try {
    log('正在解包应用...');
    const { appDir, origHeader } = await extractOriginal(p, work);
    log('正在应用中文补丁...');
    const { stats, changed } = applyPatches(appDir, dict);
    log('正在重新打包...');
    const outAsar = path.join(work, 'out', 'app.asar');
    fs.mkdirSync(path.dirname(outAsar), { recursive: true });
    const newHash = await packArchive(appDir, outAsar, origHeader, changed);
    let exe = null;
    if (integrity.embedded) {
      exe = Buffer.from(integrity.exe);
      Buffer.from(newHash).copy(exe, exe.indexOf(Buffer.from(integrity.hash)));
    }
    await ensureClosed(p.appDir, opts);
    log('正在安装...');
    swapIn(p, outAsar, exe);
    if (headerHash(p.asar) !== newHash || (exe && !fs.readFileSync(p.exe).includes(Buffer.from(newHash)))) fail('安装后校验失败，请运行「恢复英文原版」。');
    const pct = ((100 * stats.translated) / Math.max(stats.total, 1)).toFixed(1);
    log(`\n汉化完成！界面文本翻译覆盖率：${pct}%（${stats.translated}/${stats.total}）`);
    log('如果界面仍是英文，请在 Factory 的「设置 → 偏好设置 → 语言」中选择「简体中文」。');
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
  if (opts.launch && !opts.yes && !opts.dir) {
    const answer = await ask('\n是否立即启动 Factory？[Y/n]：');
    if (!answer || /^y/i.test(answer)) {
      const stub = path.join(path.dirname(p.appDir), 'factory-desktop.exe');
      spawn(fs.existsSync(stub) ? stub : p.exe, [], { detached: true, stdio: 'ignore' }).unref();
    }
  }
}

async function restore(p, opts) {
  if (!fs.existsSync(p.asarBackup) || !fs.existsSync(p.exeBackup)) {
    if (!isPatched(p.asar)) return log('当前已是英文原版，无需恢复。');
    fail('找不到原版备份文件，无法恢复。请重新安装 Factory 桌面版。');
  }
  integrityInfo(p.asarBackup, p.exeBackup);
  await ensureClosed(p.appDir, opts);
  log('正在恢复英文原版...');
  swapIn(p, p.asarBackup, fs.readFileSync(p.exeBackup));
  if (headerHash(p.asar) !== headerHash(p.asarBackup)) fail('恢复后校验失败。');
  fs.rmSync(p.asarBackup, { force: true });
  fs.rmSync(p.exeBackup, { force: true });
  log('已恢复英文原版。');
}

function status(p) {
  const patched = isPatched(p.asar);
  const hasBackup = fs.existsSync(p.asarBackup) && fs.existsSync(p.exeBackup);
  log(`版本：${path.basename(p.appDir).replace(/^app-/, '')}`);
  log(`中文补丁：${patched ? '已安装' : '未安装'}`);
  log(`原版备份：${hasBackup ? '存在' : '无'}`);
  log(`词典条目：${Object.keys(loadDictionary()).length}`);
}

async function report(p) {
  const source = isPatched(p.asar) ? p.asarBackup : p.asar;
  if (!fs.existsSync(source)) fail('找不到原版 app.asar。');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-zh-cn-'));
  try {
    const archive = path.join(work, 'app.asar');
    fs.copyFileSync(source, archive);
    if (fs.existsSync(p.unpacked)) fs.cpSync(p.unpacked, archive + '.unpacked', { recursive: true });
    const appDir = path.join(work, 'app');
    asar.extractAll(archive, appDir);
    const { stats } = buildTranslations(locateSources(appDir), loadDictionary());
    const missing = Object.fromEntries([...stats.missing].sort().map((s) => [s, '']));
    fs.writeFileSync(UNTRANSLATED_PATH, JSON.stringify(missing, null, 2) + '\n');
    log(`覆盖率：${stats.translated}/${stats.total}，未翻译的英文文本 ${Object.keys(missing).length} 条已写入：${UNTRANSLATED_PATH}`);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (process.platform !== 'win32' && !opts.dir) fail('目前仅支持 Windows 版 Factory。');
  const p = appPaths(locateAppDir(opts.dir));
  log(`Factory 安装目录：${p.appDir}\n`);
  if (opts.command === 'install') await install(p, opts);
  else if (opts.command === 'restore') await restore(p, opts);
  else if (opts.command === 'status') status(p);
  else await report(p);
}

main().catch((err) => {
  console.error(err instanceof PatchError ? `\n[错误] ${err.message}` : err);
  process.exitCode = 1;
});
