#!/usr/bin/env node
'use strict';

/**
 * 从 src/data/baguwen.js 生成 TextMate 语法。
 *
 * 产出两个文件，内容（patterns）完全相同，只是用途不同：
 *
 *   1. baguwen.tmLanguage.json          scopeName: source.baguwen
 *      用作**注入语法**。package.json 里用 injectTo 把规则塞进已有的语言
 *      （markdown / html / json / yaml 等），不替换对方语法。
 *      写法照 VS Code 自带的 markdown-math 扩展：只在 package.json 里声明
 *      injectTo，语法文件内**不写** injectionSelector。
 *
 *   2. baguwen-plaintext.tmLanguage.json  scopeName: source.baguwen.plaintext
 *      用作**纯文本语言的根语法**。VS Code 内核注册了 plaintext 语言
 *      （.txt 等），但内置扩展里没有任何 plaintext 语法文件，没有可注入的
 *      对象。所以这里直接给这个语言贡献一个根语法——它本来没有语法，
 *      我们的规则是纯增量，不会覆盖任何东西。
 *
 * 用法：
 *   node scripts/build-grammar.js                  # 收录**全部**类别（默认）
 *   node scripts/build-grammar.js --default-only   # 只收录装饰器模式默认开启的类别
 *
 * 为什么默认收录全部类别：TextMate 语法是静态的，装好之后没法在运行时按类别
 * 开关。若默认排除 function / punct，用户拿这些词来测就会以为"扩展没生效"。
 * 这两类在配色上是低饱和灰，视觉上靠后，不会盖过重点类别。
 */

const fs = require('fs');
const path = require('path');
const { CATEGORIES, LITERALS, PATTERNS, PUNCT_PATTERNS } = require('../src/data/baguwen');

const SYNTAX_DIR = path.join(__dirname, '..', 'syntaxes');
const SCOPE_PREFIX = 'baguwen';
/** 噪音较大的类别；只有加 --default-only 时才排除它们。 */
const NOISY_CATEGORIES = new Set(['function', 'punct']);

/** 一条 match 规则里最多塞多少个候选词，避免单条正则过长。 */
const CHUNK_SIZE = 40;

/**
 * 字面量按**长度分档**打块。
 *
 * 为什么分档：规则优先级用"该规则里最长短语的长度"表示。若一档里混着 20 字
 * 和 2 字的短语，整块就被按 20 计权，块内的短词于是被高估，反过来抢走本该
 * 由句式覆盖的长匹配（例如 6 字的「眼中闪过一丝」压过 9 字的「眼中闪过……」）。
 * 分档后块内长度接近，权重才代表真实长度。
 */
const LENGTH_BANDS = [
  [16, Infinity],
  [12, 15],
  [9, 11],
  [7, 8],
  [5, 6],
  [3, 4],
  [2, 2],
];

/** 按长度分档切块；每块内按长度降序（Oniguruma 择一分支按顺序试）。 */
function chunkWordsByLength(words) {
  const chunks = [];
  for (const [lo, hi] of LENGTH_BANDS) {
    const band = words.filter((w) => w.length >= lo && w.length <= hi);
    if (band.length === 0) continue;
    band.sort((a, b) => b.length - a.length);
    for (let i = 0; i < band.length; i += CHUNK_SIZE) {
      chunks.push(band.slice(i, i + CHUNK_SIZE));
    }
  }
  return chunks;
}

/** 注入语法的目标语言 scope。 */
const INJECT_TO = [
  'text.html.markdown', // markdown
  'text.html.derivative', // html
  'source.json',
  'source.yaml',
  'text.xml',
  'source.rst', // reStructuredText
  'text.log', // 日志
  'source.ini', // ini / properties / conf / .env 等
  'text.git-commit',
  'text.tex.latex',
  'source.dotenv',
  'source.makefile',
  'source.diff',
  'text.html.handlebars',
];

/** plaintext 语言使用我们贡献的根语法（VS Code 自身没有该语言的语法）。 */
const PLAINTEXT_LANGUAGE = 'plaintext';

const OUTPUTS = [
  { file: 'baguwen.tmLanguage.json', scopeName: 'source.baguwen', name: '八股词表高亮 (BaGuWen)' },
  {
    file: 'baguwen-plaintext.tmLanguage.json',
    scopeName: 'source.baguwen.plaintext',
    name: '八股词表高亮 · 纯文本 (BaGuWen Plaintext)',
  },
];

/** 正则元字符转义（字面量短语用）。 */
const RE_META = /[\\^$.*+?()[\]{}|]/g;
const escapeRe = (s) => s.replace(RE_META, '\\$&');

/**
 * 估算一条正则最多能匹配多少字符，用来给规则排序。
 *
 * 为什么必须排序：TextMate 在同一位置有多条规则命中时，**按规则顺序取第一个**，
 * 不做"最长优先"。如果短词规则排在前面，就会出现「也许」（字面量）抢走
 * 「也许吧。但」（结构句式）的起始位置，导致长句式永远匹配不上。
 *
 * 三个关键细节：
 *   - 顶层择一分支取**最长分支**，不能累加。否则 `(?:命运|宿命)的?(?:齿轮|洪流|…)`
 *     会被算成 30 多个字符，抢走「命运的齿轮开始转动」这种精确长词。
 *   - 量词上界按 MAX_QUANTIFIER_WEIGHT 折算：`[^。]{0,40}` 若按 40 计权，
 *     会系统性压过精确字面量。折算值取 4 是实测出来的：8 的时候
 *     「命运的齿轮开始转动」会被「命运的…转动」句式抢走类别归属。
 *   - `+` / `*` 保守按 1 计，避免把开放量词撑成大权重。
 */
const MAX_QUANTIFIER_WEIGHT = 4;

/** 按顶层 `|` 切分（忽略括号内与转义的 `|`）。 */
function splitTopLevel(src) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '\\') {
      cur += ch + (src[i + 1] || '');
      i++;
      continue;
    }
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    if (ch === '|' && depth === 0) {
      parts.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  parts.push(cur);
  return parts;
}

/** 读取位置 i 处的量词，返回 {extra, next}；extra 是"在已计 1 的基础上再加多少"。 */
function readQuantifier(src, i) {
  const ch = src[i];
  if (ch === '{') {
    const m = /^\{(\d+)(?:,(\d*))?\}/.exec(src.slice(i));
    if (m) {
      const hasUpper = m[2] !== undefined && m[2] !== '';
      const max = hasUpper ? parseInt(m[2], 10) : m[2] === '' ? 60 : parseInt(m[1], 10);
      return { extra: Math.max(0, Math.min(max, MAX_QUANTIFIER_WEIGHT) - 1), next: i + m[0].length };
    }
    return { extra: 0, next: i };
  }
  if (ch === '+') return { extra: 1, next: i + 1 }; // 保守：开放量词只加 1
  if (ch === '*') return { extra: 1, next: i + 1 };
  if (ch === '?') return { extra: 0, next: i + 1 };
  return { extra: 0, next: i };
}

function estimateMaxLength(src) {
  const parts = splitTopLevel(src);
  if (parts.length > 1) return Math.max(...parts.map(estimateMaxLength));

  let total = 0;
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\\') {
      total += 1;
      const q = readQuantifier(src, i + 2);
      total += q.extra;
      i = q.next;
      continue;
    }
    if (ch === '(') {
      // 找到配对的右括号
      let depth = 1;
      let j = i + 1;
      while (j < src.length && depth > 0) {
        if (src[j] === '\\') {
          j += 2;
          continue;
        }
        if (src[j] === '(') depth++;
        else if (src[j] === ')') depth--;
        j++;
      }
      const inner = src.slice(i + 1, j - 1).replace(/^\?:/, '');
      const q = readQuantifier(src, j);
      total += estimateMaxLength(inner) + q.extra;
      i = q.next;
      continue;
    }
    if (ch === '[') {
      let j = i + 1;
      while (j < src.length && src[j] !== ']') {
        if (src[j] === '\\') j++;
        j++;
      }
      // 字符类最多匹配 1 个字符
      total += 1;
      const q = readQuantifier(src, j + 1);
      total += q.extra;
      i = q.next;
      continue;
    }
    if ('^$.|'.includes(ch)) {
      i++;
      continue;
    }
    total += 1;
    i++;
  }
  return total;
}

function buildPatterns({ includeAll = false } = {}) {
  const patterns = [];
  const seen = new Set();
  const stats = [];

  for (const cat of CATEGORIES) {
    if (!includeAll && NOISY_CATEGORIES.has(cat.id)) continue;

    const words = [];
    for (const w of LITERALS[cat.id] || []) {
      if (!w || seen.has(w)) continue;
      seen.add(w);
      words.push(w);
    }
    if (words.length > 0) {
      const chunks = chunkWordsByLength(words);
      for (const chunk of chunks) {
        patterns.push({
          name: `${SCOPE_PREFIX}.${cat.id}`,
          match: `(?:${chunk.map(escapeRe).join('|')})`,
          weight: chunk[0].length, // 块内已按长度降序，首项即最长
        });
      }
      stats.push(`${cat.id}: ${words.length} 词 / ${chunks.length} 条规则`);
    }
  }

  // 结构句式直接复用装饰器模式的正则源串，两套引擎的语义保持一致
  let patternCount = 0;
  const addPattern = (p, categoryId) => {
    if (!includeAll && NOISY_CATEGORIES.has(categoryId)) return;
    patterns.push({
      name: `${SCOPE_PREFIX}.${categoryId}`,
      match: p.re.source,
      weight: estimateMaxLength(p.re.source),
    });
    patternCount++;
  };
  for (const p of PATTERNS) addPattern(p, p.categoryId || 'pattern');
  for (const p of PUNCT_PATTERNS) addPattern(p, p.categoryId || 'punct');
  stats.push(`结构句式: ${patternCount} 条规则`);

  // 关键一步：按最长可能匹配长度降序，弥补 TextMate 没有"最长优先"
  patterns.sort((a, b) => b.weight - a.weight);

  return { patterns, stats, literalTotal: seen.size, patternTotal: patternCount };
}

function build(options = {}) {
  const { patterns, stats, literalTotal, patternTotal } = buildPatterns(options);
  const grammars = OUTPUTS.map((o) => ({
    file: o.file,
    scopeName: o.scopeName,
    grammar: {
      $schema: 'https://raw.githubusercontent.com/martinring/tmlanguage/master/tmlanguage.json',
      name: o.name,
      scopeName: o.scopeName,
      patterns,
    },
  }));
  return { grammars, stats, literalTotal, patternTotal };
}

function main() {
  // 默认收录全部类别；加 --default-only 才退回"仅默认开启类别"
  const includeAll = !process.argv.includes('--default-only');
  const { grammars, stats, literalTotal, patternTotal } = build({ includeAll });

  fs.mkdirSync(SYNTAX_DIR, { recursive: true });
  console.log(`模式: ${includeAll ? '全部类别（含 function / punct）' : '仅默认开启类别'}`);
  console.log(`字面量短语 ${literalTotal} 条，结构句式 ${patternTotal} 条`);
  for (const g of grammars) {
    const out = path.join(SYNTAX_DIR, g.file);
    fs.writeFileSync(out, JSON.stringify(g.grammar, null, 2) + '\n', 'utf8');
    const size = fs.statSync(out).size;
    console.log(`  已生成 ${g.file}  scopeName=${g.scopeName}  ${g.grammar.patterns.length} 条规则  ${(size / 1024).toFixed(1)} KB`);
  }
  for (const s of stats) console.log('    - ' + s);
}

if (require.main === module) main();

module.exports = {
  build,
  buildPatterns,
  estimateMaxLength,
  INJECT_TO,
  PLAINTEXT_LANGUAGE,
  OUTPUTS,
  SYNTAX_DIR,
  SCOPE_PREFIX,
  escapeRe,
};
