'use strict';

/**
 * 纯逻辑层：不依赖 vscode，可在 Node 中直接单元测试。
 * extension.js 只负责事件、装饰器与 UI，匹配算法全部在这里。
 */

const { AhoCorasick } = require('./matcher');
const { CATEGORIES, LITERALS, PATTERNS, PUNCT_PATTERNS } = require('./data/baguwen');

/** 类别优先级 = 数组顺序。字面量跨类别重复时，靠前者胜出。 */
const CATEGORY_ORDER = CATEGORIES.map((c) => c.id);
const CATEGORY_BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

/**
 * 噪音较大的类别：命中的是「极其 / 某种 / 仿佛 / 现在」这类高频虚词，
 * 在普通中文里出现密度很高。默认**仍然开启**——词表里有的词却不亮，
 * 用户会以为扩展没生效。它们的配色是低饱和灰，视觉上靠后，不抢重点。
 * 觉得干扰时：装饰器模式可在设置里取消勾选，原生模式用
 * `npm run build:grammar -- --default-only` 重新生成语法后重装。
 */
const NOISY_CATEGORIES = new Set(['function', 'punct']);

/**
 * 汇总所有字面量短语，按类别优先级去重。
 * @param {Set<string>} enabledIds
 * @param {Set<string>} ignore
 * @returns {Array<{word: string, categoryId: string}>}
 */
function buildLiteralEntries(enabledIds, ignore = new Set()) {
  const seen = new Set();
  const entries = [];
  for (const id of CATEGORY_ORDER) {
    if (!enabledIds.has(id)) continue;
    for (const word of LITERALS[id] || []) {
      if (!word || seen.has(word) || ignore.has(word)) continue;
      seen.add(word);
      entries.push({ word, categoryId: id });
    }
  }
  return entries;
}

/**
 * 取出本次启用的正则句式，并补上 categoryId。
 * 句式可在数据里用 categoryId 覆盖归属（例如数字类句式归到 number）。
 * @param {Set<string>} enabledIds
 */
function buildPatterns(enabledIds) {
  const list = [];
  if (enabledIds.has('pattern')) {
    for (const p of PATTERNS) list.push({ ...p, categoryId: p.categoryId || 'pattern' });
  }
  if (enabledIds.has('punct')) {
    for (const p of PUNCT_PATTERNS) list.push({ ...p, categoryId: p.categoryId || 'punct' });
  }
  // 覆盖类别若本身被关闭，则整条句式也不参与
  return list.filter((p) => enabledIds.has(p.categoryId));
}

/**
 * 编译成一次扫描可复用的结构。
 * @param {Iterable<string>} enabledIds
 * @param {Iterable<string>} [ignoreList]
 */
function compile(enabledIds, ignoreList = []) {
  const enabled = new Set(enabledIds);
  const ignore = new Set(ignoreList);
  const entries = buildLiteralEntries(enabled, ignore);
  const patterns = buildPatterns(enabled);
  return {
    matcher: entries.length > 0 ? new AhoCorasick(entries) : null,
    patterns,
    literalCount: entries.length,
    patternCount: patterns.length,
    enabled: [...enabled],
  };
}

/**
 * 长匹配优先的贪心去重叠。
 *
 * 实现要点：先按长度降序排，再用一个覆盖位图判断区间是否已被占用。
 * 早期版本用「有序数组 + 二分查找 + splice 插入」，命中数一多插入就成了
 * O(n²)——20 万字文本能跑 11 秒。位图把它压到线性。
 *
 * 同长度时字面量优先于句式：字面量是人工挑选的具体短语（如"1.5秒"），
 * 比通用正则（数字+单位）更精确。
 */
function resolveOverlaps(matches) {
  matches.sort((a, b) => {
    const lenDiff = b.end - b.start - (a.end - a.start);
    if (lenDiff !== 0) return lenDiff;
    if (a.start !== b.start) return a.start - b.start;
    return (a.categoryId === 'pattern' ? 1 : 0) - (b.categoryId === 'pattern' ? 1 : 0);
  });

  let maxEnd = 0;
  for (const m of matches) if (m.end > maxEnd) maxEnd = m.end;

  const covered = new Uint8Array(maxEnd);
  const kept = [];

  for (const m of matches) {
    let free = true;
    for (let i = m.start; i < m.end; i++) {
      if (covered[i] !== 0) {
        free = false;
        break;
      }
    }
    if (!free) continue;
    for (let i = m.start; i < m.end; i++) covered[i] = 1;
    kept.push(m);
  }

  kept.sort((a, b) => a.start - b.start);
  return kept;
}

/**
 * 扫描一段文本，返回绝对偏移的命中区间。
 * @param {string} text
 * @param {number} offset 该段文本在文档中的起始偏移
 * @param {{matcher: AhoCorasick|null, patterns: Array<{re: RegExp, name: string, categoryId: string}>}} compiled
 * @param {boolean} [resolve] 是否执行去重叠（分段扫描时应传 false，最后统一解一次）
 */
function scanSegment(text, offset, compiled, resolve = true) {
  const out = [];
  if (!text) return out;

  if (compiled.matcher) {
    for (const hit of compiled.matcher.search(text)) {
      out.push({
        start: hit.start + offset,
        end: hit.end + offset,
        categoryId: hit.categoryId,
        word: hit.word,
      });
    }
  }

  for (const p of compiled.patterns) {
    const re = p.re;
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex += 1;
        continue;
      }
      out.push({
        start: m.index + offset,
        end: m.index + m[0].length + offset,
        categoryId: p.categoryId,
        word: m[0],
        rule: p.name,
      });
    }
  }

  return resolve ? resolveOverlaps(out) : out;
}

/**
 * 扫描整个文档文本（单段），返回去重后的命中。
 */
function scanText(text, compiled) {
  return scanSegment(text, 0, compiled, true);
}

module.exports = {
  CATEGORY_ORDER,
  CATEGORY_BY_ID,
  NOISY_CATEGORIES,
  buildLiteralEntries,
  buildPatterns,
  compile,
  resolveOverlaps,
  scanSegment,
  scanText,
};
