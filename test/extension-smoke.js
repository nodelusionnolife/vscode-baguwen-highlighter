'use strict';

/**
 * 扩展装配冒烟测试。
 *
 * VS Code 扩展无法在 Node 里直接跑，但把 `vscode` 模块打桩后可以真实调用
 * activate()，验证两条路径都接对了线：
 *   阶段一 · 原生模式（默认）—— 应当不建装饰器、不订阅事件
 *   阶段二 · 装饰器模式       —— 应当建 12 个装饰器并扫描
 *
 * 运行：node test/extension-smoke.js
 */

const Module = require('module');
const path = require('path');

const failures = [];
let passed = 0;
function check(name, cond, detail) {
  if (cond) passed++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

// ── vscode 打桩 ─────────────────────────────────────────────────────────────

const createdDecorationTypes = [];
const setDecorationsCalls = [];
const registeredCommands = new Map();
const subscriptions = [];
const outputLines = [];
const messages = [];
let statusBarState = null;

class Position {
  constructor(line, character) {
    this.line = line;
    this.character = character;
  }
}
class Range {
  constructor(start, end) {
    this.start = start;
    this.end = end;
  }
}
class Uri {
  constructor(fsPath) {
    this.fsPath = fsPath;
    this.scheme = 'file';
  }
  toString() {
    return `file://${this.fsPath}`;
  }
}

class FakeDocument {
  constructor(text, fsPath, languageId = 'markdown') {
    this._text = text;
    this.uri = new Uri(fsPath);
    this.fileName = fsPath;
    this.languageId = languageId;
    this._lineStarts = [0];
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '\n') this._lineStarts.push(i + 1);
    }
  }
  getText(range) {
    if (!range) return this._text;
    return this._text.slice(this.offsetAt(range.start), this.offsetAt(range.end));
  }
  offsetAt(pos) {
    const base = this._lineStarts[Math.min(pos.line, this._lineStarts.length - 1)];
    return Math.min(base + pos.character, this._text.length);
  }
  positionAt(offset) {
    let lo = 0;
    let hi = this._lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this._lineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return new Position(lo, offset - this._lineStarts[lo]);
  }
}

const SAMPLE = [
  '然而，光线斜切进来。',
  '不是迟疑，而是某种近乎于条件反射的克制。',
  '骨节分明的手指搭在杯沿上，嘴角勾起一抹若有若无的弧度。',
  '由于门没关严的缘故，空气里浮着一层黏稠的东西，压在皮肤上，以至于他喉结上下滚动了一下。',
  '“我累了。”他开口，声音从喉咙里碾出来。',
  '他整个人僵在了原地，整整 1.5 秒。',
].join('\n');

const fakeEditor = {
  document: new FakeDocument(SAMPLE, path.join(__dirname, 'sample.md')),
  visibleRanges: [new Range(new Position(0, 0), new Position(6, 0))],
  setDecorations(type, ranges) {
    setDecorationsCalls.push({ type, ranges });
  },
};

const configStore = {};
const vscodeStub = {
  Position,
  Range,
  Uri,
  OverviewRulerLane: { Right: 2 },
  StatusBarAlignment: { Right: 2 },
  ConfigurationTarget: { Global: 1 },
  workspace: {
    getConfiguration(section) {
      return {
        get(key, fallback) {
          const full = `${section}.${key}`;
          return Object.prototype.hasOwnProperty.call(configStore, full)
            ? configStore[full]
            : fallback;
        },
        update(key, value) {
          configStore[`${section}.${key}`] = value;
          return Promise.resolve();
        },
      };
    },
    onDidChangeTextDocument: () => ({ dispose() {} }),
    onDidChangeConfiguration: () => ({ dispose() {} }),
    onDidCloseTextDocument: () => ({ dispose() {} }),
  },
  window: {
    visibleTextEditors: [fakeEditor],
    activeTextEditor: fakeEditor,
    createOutputChannel() {
      return {
        appendLine: (l) => outputLines.push(l),
        clear: () => (outputLines.length = 0),
        show() {},
        dispose() {},
      };
    },
    createStatusBarItem() {
      statusBarState = { text: '', tooltip: '', command: '', show() {}, dispose() {} };
      return statusBarState;
    },
    createTextEditorDecorationType(options) {
      const t = { options, dispose() {} };
      createdDecorationTypes.push(t);
      return t;
    },
    onDidChangeActiveTextEditor: () => ({ dispose() {} }),
    onDidChangeVisibleTextEditors: () => ({ dispose() {} }),
    onDidChangeTextEditorVisibleRanges: () => ({ dispose() {} }),
    setStatusBarMessage: (m) => {
      messages.push(m);
      return { dispose() {} };
    },
    showInformationMessage: (m) => {
      messages.push(m);
      return Promise.resolve(undefined);
    },
    showErrorMessage: (m) => {
      messages.push(m);
      return Promise.resolve(undefined);
    },
    showQuickPick: async () => undefined,
  },
  commands: {
    registerCommand(id, handler) {
      registeredCommands.set(id, handler);
      return { dispose() {} };
    },
  },
};

const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === 'vscode') return 'vscode-stub';
  return origResolve.call(this, request, ...rest);
};
require.cache['vscode-stub'] = {
  id: 'vscode-stub',
  filename: 'vscode-stub',
  loaded: true,
  exports: vscodeStub,
};

// ── 加载扩展 ────────────────────────────────────────────────────────────────

const extension = require('../src/extension.js');
check('扩展导出 activate/deactivate',
  typeof extension.activate === 'function' && typeof extension.deactivate === 'function');

const fakeContext = { subscriptions: { push: (...items) => subscriptions.push(...items) } };

// ── 阶段一：原生模式（默认） ────────────────────────────────────────────────

let phase1Error = null;
try {
  extension.activate(fakeContext);
} catch (e) {
  phase1Error = e;
}
check('原生模式 activate() 不抛异常', phase1Error === null, phase1Error && phase1Error.stack);
check('原生模式：未创建任何装饰器', createdDecorationTypes.length === 0,
  String(createdDecorationTypes.length));
check('原生模式：未创建状态栏', statusBarState === null);
check('原生模式：注册 5 个命令', registeredCommands.size === 5, [...registeredCommands.keys()].join(','));
check('原生模式：只登记命令订阅（5 项）', subscriptions.length === 5, String(subscriptions.length));
check('原生模式：未触发扫描', setDecorationsCalls.length === 0, String(setDecorationsCalls.length));
check('原生模式命令齐全',
  ['baguwen.toggle', 'baguwen.rescan', 'baguwen.report', 'baguwen.showOutput', 'baguwen.applyPalette']
    .every((c) => registeredCommands.has(c)));

// 原生模式下 report 仍应可用，并惰性创建输出通道
outputLines.length = 0;
let reportOk = true;
try {
  registeredCommands.get('baguwen.report')();
} catch (e) {
  reportOk = false;
}
check('原生模式：report 命令可用', reportOk && outputLines.join('\n').includes('结构句式·关联词'),
  outputLines.slice(0, 2).join(' | '));

// 原生模式下 toggle 应给出说明而不是静默无效
messages.length = 0;
registeredCommands.get('baguwen.toggle')();
check('原生模式：toggle 给出说明', messages.some((m) => m.includes('扩展面板')), messages.join(' | '));

// ── 阶段二：装饰器模式 ──────────────────────────────────────────────────────

configStore['baguwen.engine'] = 'decoration';
setDecorationsCalls.length = 0;
createdDecorationTypes.length = 0;

let phase2Error = null;
try {
  extension.activate(fakeContext);
} catch (e) {
  phase2Error = e;
}
check('装饰器模式 activate() 不抛异常', phase2Error === null, phase2Error && phase2Error.stack);
check('装饰器模式：创建 13 个装饰器类型', createdDecorationTypes.length === 13,
  String(createdDecorationTypes.length));
check('装饰器带波浪下划线', createdDecorationTypes.every((t) => typeof t.options.textDecoration === 'string'));
check('装饰器带概览标尺颜色', createdDecorationTypes.every((t) => Boolean(t.options.overviewRulerColor)));
check('装饰器模式：状态栏已初始化', statusBarState !== null && statusBarState.text.includes('八股'),
  statusBarState && statusBarState.text);
check('装饰器模式：setDecorations 调用 13 次', setDecorationsCalls.length === 13,
  String(setDecorationsCalls.length));

const totalRanges = setDecorationsCalls.reduce((n, c) => n + c.ranges.length, 0);
check('装饰器模式：样例命中 > 10 处', totalRanges > 10, String(totalRanges));

const hitTexts = new Set();
for (const call of setDecorationsCalls) {
  for (const r of call.ranges) hitTexts.add(fakeEditor.document.getText(r));
}
check('命中含「光线斜切进来」', hitTexts.has('光线斜切进来'), [...hitTexts].slice(0, 6).join('|'));
check('命中含「骨节分明的手指」', hitTexts.has('骨节分明的手指'));
check('命中含关联词整段', [...hitTexts].some((t) => t.includes('而是')));
check('命中含「由于…以至于」整段', [...hitTexts].some((t) => t.startsWith('由于') && t.includes('以至于')));

// toggle 在装饰器模式下应真正翻转配置
check('装饰器模式：初始未配置 enabled', configStore['baguwen.enabled'] === undefined);
registeredCommands.get('baguwen.toggle')();
check('装饰器模式：toggle 写入 enabled=false', configStore['baguwen.enabled'] === false,
  String(configStore['baguwen.enabled']));
check('关闭后状态栏切换', statusBarState.text.includes('circle-slash'), statusBarState.text);
registeredCommands.get('baguwen.toggle')();
check('再次 toggle 写入 enabled=true', configStore['baguwen.enabled'] === true);

let rescanError = null;
try {
  registeredCommands.get('baguwen.rescan')();
} catch (e) {
  rescanError = e;
}
check('rescan 不抛异常', rescanError === null, rescanError && rescanError.message);

let paletteError = null;
try {
  registeredCommands.get('baguwen.applyPalette')();
} catch (e) {
  paletteError = e;
}
check('applyPalette 不抛异常（用户取消时静默返回）', paletteError === null,
  paletteError && paletteError.message);

let deactivateError = null;
try {
  extension.deactivate();
} catch (e) {
  deactivateError = e;
}
check('deactivate 不抛异常', deactivateError === null, deactivateError && deactivateError.message);

// ── 汇总 ────────────────────────────────────────────────────────────────────

console.log('八股高亮扩展 · 装配冒烟测试');
console.log('─'.repeat(56));
console.log(`原生模式：装饰器 0 个、命令 ${registeredCommands.size} 个、订阅 0 项事件`);
console.log(`装饰器模式：装饰器 ${createdDecorationTypes.length} 个、样例命中 ${totalRanges} 处`);
console.log('─'.repeat(56));

if (failures.length === 0) {
  console.log(`✓ 全部通过（${passed} 项）`);
  process.exit(0);
} else {
  console.log(`✗ 失败 ${failures.length} 项，通过 ${passed} 项：`);
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
}
