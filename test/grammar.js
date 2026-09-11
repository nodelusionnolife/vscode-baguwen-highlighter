'use strict';

/**
 * 原生语法（TextMate 注入语法）端到端测试。
 *
 * 不是模拟：这里用真实的 Oniguruma 引擎（vscode-oniguruma）和真实的 TextMate
 * 解释器（vscode-textmate），宿主语法直接加载本机 VS Code 自带的 markdown 语法，
 * 再把生成的注入语法注进去分词，验证 scope 是否正确落到目标文字上。
 *
 * 关于注入方式：交付用的语法文件按 VS Code 内置 markdown-math 的写法，
 * 只在 package.json 里声明 injectTo、文件内不写 injectionSelector。
 * 测试环境没有 VS Code 的插件加载器，所以改用 TextMate 标准的宿主侧
 * injections 字段做等价注入——两种方式走的是同一套匹配与 scope 赋值逻辑。
 *
 * 运行：node test/grammar.js
 */

const fs = require('fs');
const path = require('path');

const failures = [];
let passed = 0;
function check(name, cond, detail) {
  if (cond) passed++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

// ── 依赖检查 ────────────────────────────────────────────────────────────────

let vsctm;
let oniguruma;
try {
  vsctm = require('vscode-textmate');
  oniguruma = require('vscode-oniguruma');
} catch {
  console.log('跳过原生语法测试：未安装 vscode-textmate / vscode-oniguruma。');
  console.log('需要时运行：npm install');
  process.exit(0);
}

// ── 定位本机 VS Code 自带的宿主语法 ─────────────────────────────────────────

const VSCODE_ROOTS = [
  process.env.VSCODE_APP_ROOT,
  'E:/Microsoft VS Code',
  'C:/Program Files/Microsoft VS Code',
  path.join('C:/Users', process.env.USERNAME || '', 'AppData/Local/Programs/Microsoft VS Code'),
  '/usr/share/code',
  '/Applications/Visual Studio Code.app/Contents/Resources/app',
].filter(Boolean);

/** VS Code 的资源目录可能直接在根下，也可能在形如 645f29cc31 的子目录里。 */
function locateHostGrammar() {
  for (const root of VSCODE_ROOTS) {
    if (!fs.existsSync(root)) continue;
    const candidates = [root];
    try {
      for (const e of fs.readdirSync(root, { withFileTypes: true })) {
        if (e.isDirectory()) candidates.push(path.join(root, e.name));
      }
    } catch {
      /* 忽略无权限目录 */
    }
    for (const c of candidates) {
      const p = path.join(c, 'resources/app/extensions/markdown-basics/syntaxes/markdown.tmLanguage.json');
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

const HOST_GRAMMAR_PATH = locateHostGrammar();
if (!HOST_GRAMMAR_PATH) {
  console.log('跳过原生语法测试：未找到本机 VS Code 自带的 markdown 语法文件。');
  console.log('可用环境变量 VSCODE_APP_ROOT 指定 VS Code 安装根目录。');
  process.exit(0);
}

// ── 启动真实引擎 ────────────────────────────────────────────────────────────

const wasmPath = path.join(
  path.dirname(require.resolve('vscode-oniguruma')),
  '..',
  'release',
  'onig.wasm'
);
const onigLib = oniguruma.loadWASM(fs.readFileSync(wasmPath).buffer).then(() => ({
  createOnigScanner: (patterns) => new oniguruma.OnigScanner(patterns),
  createOnigString: (s) => new oniguruma.OnigString(s),
}));

const OUR_GRAMMAR_PATH = path.join(__dirname, '..', 'syntaxes', 'baguwen.tmLanguage.json');
const PLAIN_GRAMMAR_PATH = path.join(__dirname, '..', 'syntaxes', 'baguwen-plaintext.tmLanguage.json');
const rawHostGrammar = JSON.parse(fs.readFileSync(HOST_GRAMMAR_PATH, 'utf8'));
const rawOurGrammar = JSON.parse(fs.readFileSync(OUR_GRAMMAR_PATH, 'utf8'));

const HOST_SCOPE = rawHostGrammar.scopeName;

/**
 * 用宿主语法分词。withInjection 为真时，在宿主语法上挂一条指向我们语法的注入规则。
 * @returns {Promise<Array<{text: string, scopes: string[]}>>}
 */
async function tokenize(text, withInjection) {
  const host = JSON.parse(JSON.stringify(rawHostGrammar));
  if (withInjection) {
    host.injections = { [`L:${HOST_SCOPE}`]: { include: rawOurGrammar.scopeName } };
  }

  const registry = new vsctm.Registry({
    onigLib,
    loadGrammar: async (scopeName) => {
      if (scopeName === rawOurGrammar.scopeName) return rawOurGrammar;
      if (scopeName === HOST_SCOPE) return host;
      return null;
    },
    getInjections: (scopeName) =>
      withInjection && scopeName === HOST_SCOPE ? [rawOurGrammar.scopeName] : undefined,
  });

  const grammar = await registry.loadGrammar(HOST_SCOPE);
  if (!grammar) throw new Error('宿主语法加载失败');

  const tokens = [];
  let stack = vsctm.INITIAL;
  for (const line of text.split('\n')) {
    const res = grammar.tokenizeLine(line, stack);
    stack = res.ruleStack;
    for (const t of res.tokens) {
      tokens.push({ text: line.slice(t.startIndex, t.endIndex), scopes: t.scopes });
    }
  }
  return tokens;
}

/**
 * 直接把某个语法当**根语法**分词——纯文本模式走的就是这条路：
 * VS Code 没有 plaintext 语法，我们贡献的就是它的根语法。
 */
async function tokenizeRoot(text, rawGrammar) {
  const registry = new vsctm.Registry({
    onigLib,
    loadGrammar: async (scopeName) => (scopeName === rawGrammar.scopeName ? rawGrammar : null),
  });
  const grammar = await registry.loadGrammar(rawGrammar.scopeName);
  if (!grammar) throw new Error(`根语法加载失败: ${rawGrammar.scopeName}`);

  const tokens = [];
  let stack = vsctm.INITIAL;
  for (const line of text.split('\n')) {
    const res = grammar.tokenizeLine(line, stack);
    stack = res.ruleStack;
    for (const t of res.tokens) {
      tokens.push({ text: line.slice(t.startIndex, t.endIndex), scopes: t.scopes });
    }
  }
  return tokens;
}

/** scope -> Set(被该 scope 命中的文本) */
function collectBaguwen(tokens) {
  const map = new Map();
  for (const t of tokens) {
    const scope = t.scopes.find((s) => s.startsWith('baguwen.'));
    if (!scope) continue;
    if (!map.has(scope)) map.set(scope, new Set());
    map.get(scope).add(t.text.trim());
  }
  return map;
}

// ── 断言 ────────────────────────────────────────────────────────────────────

const SAMPLE = [
  '然而，光线斜切进来。',
  '不是迟疑，而是某种近乎于条件反射的克制。',
  '骨节分明的手指搭在杯沿上，嘴角勾起一抹若有若无的弧度。',
  '由于门没关严的缘故，空气里浮着一层黏稠的东西，压在皮肤上，以至于他喉结上下滚动了一下。',
  '“我累了。”他开口，声音从喉咙里碾出来。',
  '他整个人僵在了原地，整整 1.5 秒。',
  '像受惊小鹿湿漉漉的眼睛里，命运的齿轮开始转动。',
  '一切，都结束了。也许吧。但他就是没办法放下。',
].join('\n');

(async () => {
  check('生成的语法文件存在', fs.existsSync(OUR_GRAMMAR_PATH));
  check('语法 scopeName 正确', rawOurGrammar.scopeName === 'source.baguwen', rawOurGrammar.scopeName);
  check('语法不含 injectionSelector（与内置 markdown-math 一致）',
    rawOurGrammar.injectionSelector === undefined);
  check('每条规则都有 name 与 match',
    rawOurGrammar.patterns.every((p) => typeof p.name === 'string' && typeof p.match === 'string'));

  const plainTokens = await tokenize(SAMPLE, false);
  check('宿主 markdown 语法可分词', plainTokens.length > 0, `${plainTokens.length} tokens`);
  check('未注入时无 baguwen scope', collectBaguwen(plainTokens).size === 0);

  const tokens = await tokenize(SAMPLE, true);
  const hits = collectBaguwen(tokens);
  check('注入后产生 baguwen scope', hits.size > 0, [...hits.keys()].join(','));

  /** 展平成 文本 -> scope，便于断言 */
  const flat = new Map();
  for (const [scope, set] of hits) for (const text of set) flat.set(text, scope);

  const expectScope = (needle, scopeId) => {
    const want = `baguwen.${scopeId}`;
    const ok = [...flat.entries()].some(([text, sc]) => sc === want && text.includes(needle));
    check(`命中 [${scopeId}] ${needle}`, ok,
      ok ? '' : `实际: ${[...flat.entries()].slice(0, 6).map(([t, s]) => `${s}:${t}`).join(' | ')}`);
  };

  // 各类别各挑代表
  expectScope('光线斜切进来', 'env');
  expectScope('骨节分明的手指', 'cliche');
  expectScope('嘴角勾起一抹若有若无的弧度', 'cliche');
  expectScope('喉结上下滚动', 'phrase');
  expectScope('命运的齿轮开始转动', 'myth');
  expectScope('像受惊小鹿湿漉漉的', 'metaphor');
  expectScope('他开口', 'dialogue');
  expectScope('喉咙里碾出来', 'dialogue');
  expectScope('1.5 秒', 'number');
  // 关联词：这是本次需求的重点
  expectScope('然而', 'pattern');
  expectScope('而是', 'pattern');
  expectScope('一切，都', 'pattern');
  expectScope('也许吧。但', 'pattern');
  expectScope('以至于', 'pattern');

  // 长词优先：不能被拆成更短的词
  check('长词优先：「骨节分明的手指」整段命中',
    [...flat.keys()].some((t) => t.includes('骨节分明的手指')),
    [...flat.keys()].filter((t) => t.includes('骨节')).join(' | '));

  // 关联词应整段覆盖，而不是只标后半截
  const patternSpans = [...flat.entries()].filter(([, s]) => s === 'baguwen.pattern').map(([t]) => t);
  check('关联词整段命中（不是…而是…）',
    patternSpans.some((t) => t.includes('不是') && t.includes('而是')),
    patternSpans.join(' | '));
  check('关联词整段命中（由于…以至于…）',
    patternSpans.some((t) => t.includes('由于') && t.includes('以至于')),
    patternSpans.join(' | '));

  // 语法现在是"全部类别"模式：词表里有的词必须都能亮，否则用户会以为没生效
  check('语法已收录 function 类别', [...hits.keys()].includes('baguwen.function'),
    [...hits.keys()].join(','));
  check('语法包含全部 13 个类别',
    new Set(rawOurGrammar.patterns.map((p) => p.name)).size === 13,
    [...new Set(rawOurGrammar.patterns.map((p) => p.name))].join(','));

  const pkgGrammars = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'))
    .contributes.grammars;
  const injectEntry = pkgGrammars.find((g) => g.scopeName === 'source.baguwen');
  check('注入目标已覆盖 15 个语言 scope', injectEntry.injectTo.length === 15,
    String(injectEntry.injectTo.length));

  // 正则句式不应吞掉整段
  let maxLen = 0;
  let maxText = '';
  for (const t of flat.keys()) if (t.length > maxLen) { maxLen = t.length; maxText = t; }
  check('最长命中不超过 60 字', maxLen <= 60, `${maxLen} 字: ${maxText}`);

  // ── 纯文本（.txt）：作为根语法直接分词 ────────────────────────────────────
  // VS Code 没有 plaintext 的语法，所以这块是给 plaintext 语言贡献的根语法。

  check('纯文本语法文件存在', fs.existsSync(PLAIN_GRAMMAR_PATH));
  const rawPlainGrammar = JSON.parse(fs.readFileSync(PLAIN_GRAMMAR_PATH, 'utf8'));
  check('纯文本语法 scopeName 正确',
    rawPlainGrammar.scopeName === 'source.baguwen.plaintext', rawPlainGrammar.scopeName);
  check('两个语法规则数一致',
    rawPlainGrammar.patterns.length === rawOurGrammar.patterns.length,
    `${rawPlainGrammar.patterns.length} vs ${rawOurGrammar.patterns.length}`);

  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const plainContribution = pkg.contributes.grammars.find((g) => g.language === 'plaintext');
  check('package.json 已给 plaintext 语言注册语法', Boolean(plainContribution),
    JSON.stringify(pkg.contributes.grammars.map((g) => g.language || g.scopeName)));
  check('plaintext 语法 scopeName 与文件一致',
    plainContribution && plainContribution.scopeName === rawPlainGrammar.scopeName);

  const TXT_SAMPLE = [
    '然而，光线斜切进来。',
    '骨节分明的手指搭在杯沿上，嘴角勾起一抹若有若无的弧度。',
    '不是迟疑，而是某种近乎于条件反射的克制。',
    '“我累了。”他开口，声音从喉咙里碾出来。',
    '像受惊小鹿湿漉漉的眼睛里，命运的齿轮开始转动。',
    '一切，都结束了。也许吧。但他就是没办法放下。',
  ].join('\n');

  const txtTokens = await tokenizeRoot(TXT_SAMPLE, rawPlainGrammar);
  check('纯文本根语法可分词', txtTokens.length > 0, `${txtTokens.length} tokens`);
  const txtHits = collectBaguwen(txtTokens);
  check('纯文本下产生 baguwen scope', txtHits.size > 0, [...txtHits.keys()].join(','));

  const txtFlat = new Map();
  for (const [scope, set] of txtHits) for (const text of set) txtFlat.set(text, scope);

  const expectTxt = (needle, scopeId) => {
    const want = `baguwen.${scopeId}`;
    const ok = [...txtFlat.entries()].some(([text, sc]) => sc === want && text.includes(needle));
    check(`纯文本命中 [${scopeId}] ${needle}`, ok, ok ? '' :
      `实际: ${[...txtFlat.entries()].slice(0, 6).map(([t, s]) => `${s}:${t}`).join(' | ')}`);
  };
  expectTxt('光线斜切进来', 'env');
  expectTxt('骨节分明的手指', 'cliche');
  expectTxt('而是', 'pattern');
  expectTxt('他开口', 'dialogue');
  expectTxt('命运的齿轮开始转动', 'myth');
  expectTxt('也许吧。但', 'pattern');

  // 纯文本下未命中部分应当没有 scope（根语法不能给全文乱套 scope）
  const txtUnscoped = txtTokens.filter(
    (t) => t.text.trim() && !t.scopes.some((s) => s.startsWith('baguwen.'))
  );
  check('纯文本下未命中片段不带 baguwen scope', txtUnscoped.length > 0,
    `未命中片段 ${txtUnscoped.length} 个`);

  // ── 回归：短词规则不得抢走长句式的起始位置 ────────────────────────────────
  // TextMate 在同一位置多条规则命中时，取"规则顺序的第一个"，不做最长优先。
  // 曾经因为「也许」（function 字面量）排在「也许吧。但」（结构句式）前面，
  // 导致该句式在原生模式下永远匹配不上。生成语法时已按最长可能长度降序排，
  // 这里用行为断言守住它。

  const conflictLine = '一切，都结束了。也许吧。但他就是没办法放下。';
  const conflictTokens = await tokenizeRoot(conflictLine, rawPlainGrammar);
  const conflictWords = new Set(
    conflictTokens
      .filter((t) => t.scopes.some((s) => s.startsWith('baguwen.')))
      .map((t) => t.text)
  );
  check('「也许吧。但」整段命中（不被短词「也许」截断）',
    [...conflictWords].some((t) => t.includes('也许吧。但')),
    [...conflictWords].join(' | '));

  // 用户实测过的那行：全部 20 个「程度·情态副词」在原生模式下都要亮
  const userLine = '不容质疑、几不可查、几不可闻、难以察觉、不容抗拒、几乎看不见、微不可察、一顿、确实、注定、必将、现在、接下来、悄然、陡然、骤然、毫无疑问、毋庸置疑、前所未有、显而易见';
  const userTokens = await tokenizeRoot(userLine, rawPlainGrammar);
  const userScoped = new Set(
    userTokens
      .filter((t) => t.scopes.some((s) => s.startsWith('baguwen.')))
      .map((t) => t.text.trim())
  );
  const userWords = userLine.split('、');
  const userMissed = userWords.filter((w) => ![...userScoped].some((t) => t === w || t.includes(w)));
  check('实测行 20 个词在原生模式下全部命中', userMissed.length === 0, userMissed.join('、'));

  // 同类风险：长短语不能被它自己的短前缀抢走（如「骨节分明的手指」vs「骨节」）
  const prefixLine = '骨节分明的手指搭在杯沿上。';
  const prefixTokens = await tokenizeRoot(prefixLine, rawPlainGrammar);
  const prefixWords = prefixTokens
    .filter((t) => t.scopes.some((s) => s.startsWith('baguwen.')))
    .map((t) => t.text);
  check('长短语不被短前缀截断（骨节分明的手指）',
    prefixWords.some((t) => t.includes('骨节分明的手指')),
    prefixWords.join(' | '));

  // 性能
  const big = Array.from({ length: 400 }, () => SAMPLE).join('\n');
  const t0 = Date.now();
  await tokenize(big, true);
  const elapsed = Date.now() - t0;

  console.log('八股高亮扩展 · 原生语法测试（真实 TextMate + Oniguruma）');
  console.log('─'.repeat(58));
  console.log(`宿主语法: ${HOST_GRAMMAR_PATH}`);
  console.log(`注入语法: ${path.relative(process.cwd(), OUR_GRAMMAR_PATH)}（${rawOurGrammar.patterns.length} 条规则）`);
  console.log(`命中 ${hits.size} 类 scope、${flat.size} 种片段；最长 ${maxLen} 字；400 行分词 ${elapsed}ms`);
  console.log('─'.repeat(58));
  for (const [scope, set] of [...hits.entries()].sort()) {
    console.log(`  ${scope.padEnd(22)} ${String(set.size).padStart(3)} 种片段`);
  }
  console.log('─'.repeat(58));

  if (failures.length === 0) {
    console.log(`✓ 全部通过（${passed} 项）`);
    process.exit(0);
  } else {
    console.log(`✗ 失败 ${failures.length} 项，通过 ${passed} 项：`);
    for (const f of failures) console.log('  - ' + f);
    process.exit(1);
  }
})();
