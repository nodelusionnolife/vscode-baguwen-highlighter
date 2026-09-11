'use strict';

/**
 * 用户指定词表核对。
 *
 * test/fixtures/user-requested-terms.txt 记录了用户明确要求必须能高亮的词，
 * 每行一条。本测试逐条检查是否已被词表（字面量或正则句式）覆盖。
 *
 * 这是独立于世界书审计的第二道防线：世界书审计保证"原文有的都收了"，
 * 这里保证"用户点名的都在"。
 *
 * 运行：node test/user-terms.js
 */

const fs = require('fs');
const path = require('path');
const { LITERALS, PATTERNS, PUNCT_PATTERNS } = require('../src/data/baguwen');

const FIXTURE = path.join(__dirname, 'fixtures', 'user-requested-terms.txt');

/** 含占位符的行用句式核对，不按字面量比。键是原文，值是应命中的句式 id。 */
const PLACEHOLDER_EXPECTATIONS = new Map([
  ['像一把XX插入XX', 'xiang-yi-ba'],
  ['像一条XX精准地XX', 'xiang-yi-tiao'],
  ['身体像一张拉满的弓', 'shenti-xiang-gong'],
  ['这种XX比任何XX还/都要XX', 'zhezhong-bi-renhe'],
  ['在这个充满了XX和XX的XX里', 'zai-chongman'],
  ['那不是XX而是XX', 'na-er-shi'],
  ['设想过……会……会……会……，唯独没有想过', 'shexiangguo-wei'],
  ['明明只是……却像……', 'mingming-que'],
  ['本应是……可是……', 'benying-keshi'],
  ['如果……我就……', 'ruguo-wo-jiu'],
  ['他的眼神/目光在某人身上停留了X秒', 'mugguang-tingliu'],
  ['声音不大/轻，却带着……', 'shengyin-buda'],
  ['很轻地……了一下', 'henqing-yixia'],
  ['真正的……才刚刚开始', 'zhenzheng-caikaishi'],
  ['眼中闪烁着……的光芒', 'yanzhong-shanshuo'],
  ['声音变得……', 'shengyin-biande'],
  ['他/她知道……', 'tazhidao'],
  ['眼中闪过一丝……', 'yanzhong-shanguo'],
  ['心中涌起一股……', 'xinzhong-yongqi'],
  ['目光/视线/眼神落在XX身上/某处', 'muguang-luozai'],
  ['喉间溢出一声……', 'houjian-yichu'],
  ['淬了/淬着X', 'cui-le-zhe'],
  ['那是……怎样的眼睛', 'nashi-yishuang'],
  ['他/她知道……', 'tazhidao'],
]);

function main() {
  if (!fs.existsSync(FIXTURE)) {
    console.log(`跳过用户词表核对：未找到 ${FIXTURE}`);
    process.exit(0);
  }

  const lines = fs
    .readFileSync(FIXTURE, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));

  const literals = new Set();
  for (const id of Object.keys(LITERALS)) for (const w of LITERALS[id]) literals.add(w);

  const byId = new Map();
  for (const p of [...PATTERNS, ...PUNCT_PATTERNS]) byId.set(p.id, p);

  const missing = [];
  for (const term of lines) {
    if (literals.has(term)) continue;
    const expectedPattern = PLACEHOLDER_EXPECTATIONS.get(term);
    if (expectedPattern) {
      if (!byId.has(expectedPattern)) missing.push(`${term}  → 缺少句式 ${expectedPattern}`);
      continue;
    }
    // 兜底：能被某条句式直接匹配也算覆盖
    const hit = [...byId.values()].some((p) => {
      try {
        return new RegExp(p.re.source).test(term);
      } catch {
        return false;
      }
    });
    if (!hit) missing.push(term);
  }

  console.log('用户指定词表核对');
  console.log('─'.repeat(52));
  console.log(`词条 ${lines.length} 条（字面量 + 句式占位项）`);
  console.log('─'.repeat(52));

  if (missing.length === 0) {
    console.log('✓ 用户点名的词已全部覆盖');
    process.exit(0);
  }

  console.log(`✗ 未覆盖 ${missing.length} 条：`);
  for (const m of missing) console.log('    ' + m);
  process.exit(1);
}

main();
