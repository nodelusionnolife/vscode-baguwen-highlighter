'use strict';

/**
 * 命令行报告器：不需要 VS Code，直接扫描文件并输出八股命中报告。
 * 与扩展共用 src/core.js，所以结果一致。
 *
 * 用法：
 *   node cli.js <文件路径> [--all] [--json]
 *
 *   --all   连同默认关闭的类别（高频虚词、符号增殖）一起统计
 *   --json  输出 JSON，便于二次处理
 */

const fs = require('fs');
const path = require('path');
const { CATEGORY_ORDER, CATEGORY_BY_ID, compile, scanText } = require('./src/core');

function parseArgs(argv) {
  const files = [];
  let all = false;
  let json = false;
  for (const a of argv) {
    if (a === '--all') all = true;
    else if (a === '--json') json = true;
    else files.push(a);
  }
  return { file: files[0], all, json };
}

function main() {
  const { file, all, json } = parseArgs(process.argv.slice(2));
  if (!file) {
    console.error('用法: node cli.js <文件路径> [--all] [--json]');
    process.exit(2);
  }
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) {
    console.error(`文件不存在: ${abs}`);
    process.exit(2);
  }

  const text = fs.readFileSync(abs, 'utf8');
  // 两个引擎现在都默认收录全部类别，CLI 保持一致
  const compiled = compile(CATEGORY_ORDER, []);
  const hits = scanText(text, compiled);

  // 计算行号
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') lineStarts.push(i + 1);
  }
  const locate = (offset) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, column: offset - lineStarts[lo] + 1 };
  };

  const byCategory = new Map();
  for (const h of hits) {
    if (!byCategory.has(h.categoryId)) byCategory.set(h.categoryId, []);
    byCategory.get(h.categoryId).push(h);
  }
  const sorted = [...byCategory.entries()].sort((a, b) => b[1].length - a[1].length);

  if (json) {
    console.log(
      JSON.stringify(
        {
          file: abs,
          chars: text.length,
          total: hits.length,
          categories: sorted.map(([id, list]) => ({
            id,
            name: CATEGORY_BY_ID.get(id)?.name || id,
            count: list.length,
          })),
          hits: hits.map((h) => ({
            ...locate(h.start),
            end: locate(h.end),
            categoryId: h.categoryId,
            word: h.word,
            rule: h.rule,
          })),
        },
        null,
        2
      )
    );
    return;
  }

  const DENSITY = 1000; // 每千字命中数
  console.log(`文件: ${abs}`);
  console.log(`篇幅: ${text.length} 字，命中 ${hits.length} 处，密度 ${((hits.length / text.length) * DENSITY).toFixed(1)} 处/千字`);
  console.log('─'.repeat(56));
  for (const [id, list] of sorted) {
    const cat = CATEGORY_BY_ID.get(id);
    const name = (cat ? cat.name : id).padEnd(20, ' ');
    console.log(`${name} ${String(list.length).padStart(5)} 处`);
  }
  console.log('─'.repeat(56));
  for (const [id, list] of sorted) {
    const cat = CATEGORY_BY_ID.get(id);
    console.log(`\n【${cat ? cat.name : id}】`);
    const detail = list.map((h) => ({ ...h, ...locate(h.start) })).sort((a, b) => a.line - b.line || a.column - b.column);
    for (const h of detail) {
      console.log(`  L${String(h.line).padStart(4)}:${String(h.column).padStart(3)}  ${(h.word || '').replace(/\s+/g, ' ')}`);
    }
  }
}

main();
