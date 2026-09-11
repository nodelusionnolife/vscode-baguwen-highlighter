'use strict';

const vscode = require('vscode');
const {
  CATEGORY_ORDER,
  CATEGORY_BY_ID,
  compile,
  resolveOverlaps,
  scanSegment,
} = require('./core');
const { PALETTES } = require('./data/baguwen');

/** @type {vscode.OutputChannel|undefined} */
let output;
/** @type {vscode.StatusBarItem|undefined} */
let statusBar;
/** @type {Map<string, vscode.TextEditorDecorationType>} */
const decorationTypes = new Map();

/** 输出通道按需创建：原生模式下扩展不做任何事，不该白建一个通道。 */
function getOutput() {
  if (!output) output = vscode.window.createOutputChannel('八股词表高亮');
  return output;
}

/** @type {ReturnType<typeof compile>|null} */
let compiled = null;
let compiledSignature = '';
let lastHitCount = 0;

/** @type {WeakMap<vscode.TextEditor, NodeJS.Timeout>} */
const scanTimers = new WeakMap();

// ─────────────────────────────────────────────────────────────────────────────
// 配置
// ─────────────────────────────────────────────────────────────────────────────

function cfg() {
  return vscode.workspace.getConfiguration('baguwen');
}

function isEnabled() {
  return cfg().get('enabled', true);
}

function enabledCategoryIds() {
  const c = cfg();
  // 默认全部开启：词表里有的词却不亮，会被当成扩展没生效。
  return CATEGORY_ORDER.filter((id) => c.get(`categories.${id}`, true) !== false);
}

function configSignature() {
  return JSON.stringify([enabledCategoryIds(), cfg().get('ignore', [])]);
}

// ─────────────────────────────────────────────────────────────────────────────
// 装饰器
// ─────────────────────────────────────────────────────────────────────────────

/** 把 #RRGGBB 变成带透明度的 #RRGGBBAA；已是 8 位则原样返回。 */
function withAlpha(hex, alpha) {
  if (typeof hex !== 'string' || hex[0] !== '#') return hex;
  if (hex.length === 9) return hex;
  if (hex.length === 4) {
    return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}${alpha}`;
  }
  if (hex.length === 7) return hex + alpha;
  return hex;
}

function disposeDecorationTypes() {
  for (const type of decorationTypes.values()) type.dispose();
  decorationTypes.clear();
}

function buildDecorationTypes() {
  disposeDecorationTypes();
  const style = cfg().get('style', 'both');
  const colorOverride = cfg().get('colors', {}) || {};
  const showRuler = cfg().get('overviewRuler', true);

  for (const cat of CATEGORY_ORDER.map((id) => CATEGORY_BY_ID.get(id))) {
    const color = colorOverride[cat.id] || cat.color;
    /** @type {vscode.DecorationRenderOptions} */
    const options = {};
    if (showRuler) {
      options.overviewRulerLane = vscode.OverviewRulerLane.Right;
      options.overviewRulerColor = color;
    }
    if (style === 'underline' || style === 'both') {
      // textDecoration 支持内联颜色：`underline wavy #c586c0`
      options.textDecoration = `underline wavy ${color}`;
      options.backgroundColor = withAlpha(color, '14');
    } else {
      options.backgroundColor = withAlpha(color, '40');
    }
    decorationTypes.set(cat.id, vscode.window.createTextEditorDecorationType(options));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 词表编译
// ─────────────────────────────────────────────────────────────────────────────

function ensureCompiled() {
  const signature = configSignature();
  if (signature === compiledSignature && compiled) return compiled;
  compiledSignature = signature;
  compiled = compile(enabledCategoryIds(), cfg().get('ignore', []) || []);
  getOutput().appendLine(
    `[词表] ${compiled.literalCount} 条字面量短语、${compiled.patternCount} 条结构句式；` +
      `启用类别：${compiled.enabled.join(', ') || '无'}`
  );
  return compiled;
}

// ─────────────────────────────────────────────────────────────────────────────
// 扫描
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {vscode.TextDocument} doc
 * @param {vscode.TextEditor} [editor]
 */
function collectMatches(doc, editor) {
  const c = ensureCompiled();
  if (!c.matcher && c.patterns.length === 0) return [];

  const maxChars = Math.max(0, cfg().get('maxFileSizeKB', 2048)) * 1024;
  const fullText = doc.getText();

  // 超大文件只扫可见区域，避免每次输入都全文扫描
  if (fullText.length > maxChars && editor) {
    const collected = [];
    for (const range of editor.visibleRanges) {
      collected.push(
        ...scanSegment(doc.getText(range), doc.offsetAt(range.start), c, false)
      );
    }
    return resolveOverlaps(collected);
  }

  return scanSegment(fullText, 0, c, true);
}

// ─────────────────────────────────────────────────────────────────────────────
// 应用高亮
// ─────────────────────────────────────────────────────────────────────────────

function clearDecorations(editor) {
  if (!editor) return;
  for (const type of decorationTypes.values()) editor.setDecorations(type, []);
}

function shouldSkip(editor) {
  if (!editor) return true;
  const scheme = editor.document.uri.scheme;
  if (scheme === 'output' || scheme === 'vscode-terminal' || scheme === 'debug') return true;
  const langs = cfg().get('languages', []);
  if (Array.isArray(langs) && langs.length > 0 && !langs.includes(editor.document.languageId)) {
    return true;
  }
  return false;
}

function decorate(editor) {
  if (!editor) return;
  if (!isEnabled() || shouldSkip(editor)) {
    clearDecorations(editor);
    updateStatusBar(0);
    return;
  }

  const doc = editor.document;
  const matches = collectMatches(doc, editor);

  /** @type {Map<string, vscode.Range[]>} */
  const byCategory = new Map();
  for (const m of matches) {
    const range = new vscode.Range(doc.positionAt(m.start), doc.positionAt(m.end));
    let list = byCategory.get(m.categoryId);
    if (!list) {
      list = [];
      byCategory.set(m.categoryId, list);
    }
    list.push(range);
  }

  for (const id of CATEGORY_ORDER) {
    const type = decorationTypes.get(id);
    if (!type) continue;
    editor.setDecorations(type, byCategory.get(id) || []);
  }

  lastHitCount = matches.length;
  updateStatusBar(matches.length, byCategory);
}

function scheduleScan(editor) {
  if (!editor) return;
  const existing = scanTimers.get(editor);
  if (existing) clearTimeout(existing);
  const delay = Math.max(0, cfg().get('debounceMs', 200));
  scanTimers.set(
    editor,
    setTimeout(() => {
      scanTimers.delete(editor);
      decorate(editor);
    }, delay)
  );
}

function scanVisibleEditors() {
  for (const editor of vscode.window.visibleTextEditors) decorate(editor);
}

function updateStatusBar(count, byCategory) {
  if (!statusBar) return;
  if (!isEnabled()) {
    statusBar.text = '$(circle-slash) 八股高亮';
    statusBar.tooltip = '八股词表高亮已关闭（点击切换）';
    return;
  }
  let top = '';
  if (byCategory && byCategory.size > 0) {
    const sorted = [...byCategory.entries()].sort((a, b) => b[1].length - a[1].length);
    const [id, list] = sorted[0];
    const cat = CATEGORY_BY_ID.get(id);
    top = `\n最多：${cat ? cat.name : id}（${list.length} 处）`;
  }
  statusBar.text = `$(paintcan) 八股 ${count}`;
  statusBar.tooltip = `当前文件命中 ${count} 处八股标记${top}\n点击开 / 关高亮`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 报告
// ─────────────────────────────────────────────────────────────────────────────

function buildReport(editor) {
  if (!editor) return '没有活动编辑器。';
  const doc = editor.document;
  const matches = collectMatches(doc, editor);
  if (matches.length === 0) return `《${doc.fileName}》未发现八股标记。`;

  const byCategory = new Map();
  for (const m of matches) {
    if (!byCategory.has(m.categoryId)) byCategory.set(m.categoryId, []);
    byCategory.get(m.categoryId).push(m);
  }

  const lines = [];
  lines.push(`文件：${doc.uri.fsPath || doc.uri.toString()}`);
  lines.push(`总计命中：${matches.length} 处`);
  lines.push('');
  lines.push('按类别统计：');
  const sorted = [...byCategory.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [id, list] of sorted) {
    const cat = CATEGORY_BY_ID.get(id);
    lines.push(`  ${cat ? cat.name : id}（${id}）：${list.length}`);
  }
  lines.push('');
  lines.push('明细（按行号）：');
  for (const [id, list] of sorted) {
    const cat = CATEGORY_BY_ID.get(id);
    lines.push(`── ${cat ? cat.name : id} ──`);
    const detail = list
      .map((m) => ({ ...m, pos: doc.positionAt(m.start) }))
      .sort((a, b) => a.pos.line - b.pos.line || a.pos.character - b.pos.character);
    for (const m of detail) {
      const snippet = (m.word || '').replace(/\s+/g, ' ').slice(0, 40);
      lines.push(`  第 ${m.pos.line + 1} 行:${m.pos.character + 1}  ${snippet}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// 配色写入（可选命令）
// ─────────────────────────────────────────────────────────────────────────────

/** 按配色方案生成 textMateRules。 */
function buildTokenRules(paletteName) {
  const palette = PALETTES[paletteName] || PALETTES.vivid;
  return CATEGORY_ORDER.map((id) => {
    const cat = CATEGORY_BY_ID.get(id);
    /** @type {{foreground: string, fontStyle?: string}} */
    const settings = { foreground: palette[id] };
    if (cat && cat.bold) settings.fontStyle = 'bold underline';
    return { scope: `baguwen.${id}`, settings };
  });
}

function readTokenColorCustomizations() {
  const raw = vscode.workspace.getConfiguration('editor').get('tokenColorCustomizations');
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof raw === 'object' ? { ...raw } : {};
}

/**
 * 把配色写进用户 settings.json。保留用户已有的、非 baguwen 的 token 规则。
 * token 颜色无法按主题自动切换，所以给浅色/深色各准备一套供选择。
 */
async function applyPalette() {
  const picked = await vscode.window.showQuickPick(
    [
      { label: '鲜艳（默认）', description: '高饱和，深色主题下最醒目', palette: 'vivid' },
      { label: '柔和', description: '中间调，浅色与深色底都能读，适合嫌吵', palette: 'soft' },
      { label: '浅色主题', description: '压深一档，保证白底上的对比度', palette: 'light' },
    ],
    { placeHolder: '选择配色方案，将写入用户 settings.json 的 editor.tokenColorCustomizations' }
  );
  if (!picked) return;

  const current = readTokenColorCustomizations();
  const existing = Array.isArray(current.textMateRules) ? current.textMateRules : [];
  const isOurs = (rule) => typeof rule.scope === 'string' && rule.scope.startsWith('baguwen.');
  const kept = existing.filter((rule) => !isOurs(rule));
  const next = { ...current, textMateRules: [...kept, ...buildTokenRules(picked.palette)] };

  await vscode.workspace
    .getConfiguration('editor')
    .update('tokenColorCustomizations', next, vscode.ConfigurationTarget.Global);

  const base = `八股高亮：已写入${picked.label}`;
  vscode.window.showInformationMessage(
    kept.length === existing.length ? base : `${base}（保留了你原有的 ${kept.length} 条 token 规则）`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 生命周期
// ─────────────────────────────────────────────────────────────────────────────

/** 命令在任何引擎下都注册，但它们只在装饰器模式或手动调用时才做事。 */
function registerCommands(context, engine) {
  context.subscriptions.push(
    vscode.commands.registerCommand('baguwen.toggle', () => {
      if (engine === 'native') {
        vscode.window.showInformationMessage(
          '原生语法模式下高亮由 VS Code 语法引擎直接产出，请在扩展面板里启用/禁用本扩展；' +
            '若需要运行时开关，把 baguwen.engine 改成 decoration 并重新加载窗口。'
        );
        return;
      }
      const next = !isEnabled();
      cfg().update('enabled', next, vscode.ConfigurationTarget.Global);
      if (!next) {
        for (const editor of vscode.window.visibleTextEditors) clearDecorations(editor);
        updateStatusBar(0);
      } else {
        scanVisibleEditors();
      }
      vscode.window.setStatusBarMessage(next ? '八股高亮：已开启' : '八股高亮：已关闭', 2000);
    }),

    vscode.commands.registerCommand('baguwen.rescan', () => {
      compiledSignature = '';
      ensureCompiled();
      scanVisibleEditors();
      vscode.window.setStatusBarMessage(`八股高亮：已重新扫描（命中 ${lastHitCount} 处）`, 2000);
    }),

    vscode.commands.registerCommand('baguwen.report', () => {
      const channel = getOutput();
      channel.clear();
      channel.appendLine(buildReport(vscode.window.activeTextEditor));
      channel.show(true);
    }),

    vscode.commands.registerCommand('baguwen.showOutput', () => getOutput().show(true)),

    vscode.commands.registerCommand('baguwen.applyPalette', () => {
      applyPalette().catch((e) =>
        vscode.window.showErrorMessage(`八股高亮：写入配色失败 — ${e && e.message}`)
      );
    })
  );
}

function activate(context) {
  const engine = cfg().get('engine', 'native');
  registerCommands(context, engine);

  if (engine === 'native') {
    // 原生模式：高亮由 TextMate 注入语法 + configurationDefaults 直接产出，
    // 这里不建装饰器、不订阅事件、不扫描，装好启用即生效。
    console.log(
      '[八股高亮] 原生语法模式：高亮由 VS Code 语法引擎产出，运行时零开销。' +
        '需要逐类别开关 / 忽略词 / 波浪线时，把 baguwen.engine 设为 decoration。'
    );
    return;
  }

  console.log(`[八股高亮] activate() 开始（引擎：${engine}）`);
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = 'baguwen.toggle';
  statusBar.show();
  context.subscriptions.push(statusBar);

  buildDecorationTypes();
  ensureCompiled();
  scanVisibleEditors();

  console.log(
    `[八股高亮] 已激活：${compiled ? compiled.literalCount : 0} 条短语、` +
      `${compiled ? compiled.patternCount : 0} 条句式，` +
      `装饰器 ${decorationTypes.size} 个，当前可见编辑器 ${vscode.window.visibleTextEditors.length} 个`
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      scanVisibleEditors();
      if (editor) scheduleScan(editor);
    }),

    vscode.window.onDidChangeVisibleTextEditors(() => scanVisibleEditors()),

    vscode.workspace.onDidChangeTextDocument((event) => {
      const editor = vscode.window.visibleTextEditors.find((e) => e.document === event.document);
      if (editor) scheduleScan(editor);
    }),

    vscode.window.onDidChangeTextEditorVisibleRanges((event) => scheduleScan(event.textEditor)),

    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration('baguwen')) return;
      if (event.affectsConfiguration('baguwen.engine')) {
        vscode.window.showInformationMessage('八股高亮：引擎已切换，请重新加载窗口（Developer: Reload Window）后生效。');
        return;
      }
      buildDecorationTypes();
      compiledSignature = '';
      ensureCompiled();
      scanVisibleEditors();
    }),

    vscode.workspace.onDidCloseTextDocument((doc) => {
      for (const editor of vscode.window.visibleTextEditors) {
        if (editor.document === doc) clearDecorations(editor);
      }
    })
  );
}

function deactivate() {
  disposeDecorationTypes();
  if (output) {
    output.dispose();
    output = undefined;
  }
}

module.exports = { activate, deactivate };
