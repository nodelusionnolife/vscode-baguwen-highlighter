'use strict';

/**
 * 规则级覆盖审计。
 *
 * 前两个审计管的是"词"：
 *   - coverage.js    ：世界书里出现过的**短语**有没有收全
 *   - user-terms.js  ：用户点名的**词**在不在
 *
 * 这个审计管的是"规则"：世界书每条规则都要求 AI 产出某种东西，但有些规则
 * 没给固定词表，只给了行为描述或示例句。这类最容易漏——因为按短语核对时，
 * 它们一条都不产生。本测试逐条检查：每条规则是否至少有一个可被引擎识别的
 * 表面形式（把示例里的占位符填上后送去检测）。
 *
 * 确实无法靠词面检测的规则（如"段落首尾呼应""整句重复"）走显式清单，
 * 每项必须写明理由——不允许用清单糊弄过去。
 *
 * 运行：node test/rule-coverage.js
 */

const fs = require('fs');
const path = require('path');
const { compile, scanText, CATEGORY_ORDER } = require('../src/core');

const WORLDBOOK_CANDIDATES = [
  process.env.BAGUWEN_WORLDBOOK,
  'C:/Users/G/Downloads/b8939d30c90ee79e.json',
  path.join(__dirname, '..', 'b8939d30c90ee79e.json'),
].filter(Boolean);

/**
 * 确认无法靠词面检测的规则。键为 `${uid}#${规则号}`，值必须写清理由。
 */
const BEHAVIORAL_RULES = new Map([
  ['0#总纲', '核心指令，只规定整体文风，无具体词面'],
  ['0#30', '段落首尾呼应需要比较段首与段尾，属跨句语义，词面无法判断'],
  ['0#27', '单个文言虚词（之/其/亦/乃…）若逐字标注会误伤几乎所有中文句子'],
  ['0#输出格式', '输出格式要求，非叙事内容'],
  ['0#禁止事项', '禁止清单，规定的是"不要出现什么"'],
  ['1#23', '语调突变需要比较同段内前两句与第三句的语气，属跨句语义'],
  ['1#24', '段落开头强制转折已由 pattern 的段首转折覆盖，本条只规定频率'],
  ['1#26', '跨段首尾复读需要跨段落比较，属结构语义'],
  ['1#27', '整句重复需要全文比对，属结构语义'],
  ['1#28', '同义词替换伪重复需要跨句比对语义，属结构语义'],
  ['2#23', '同 uid1 第 23 条：语调突变属跨句语义'],
  ['2#24', '同 uid1 第 24 条：只规定频率'],
  ['2#26', '同 uid1 第 26 条：跨段复读'],
  ['2#27', '同 uid1 第 27 条：整句重复'],
  ['2#28', '同 uid1 第 28 条：语义重复'],
  ['3#26', '只规定"环境句插在哪"，具体环境句已由 env 类别覆盖'],
  ['3#27', '只规定"环境句要与上下文无关"，属语义判断'],
  ['3#38', '同 uid1 第 23 条：语调突变属跨句语义'],
  ['3#42', '同 uid1 第 26 条：跨段首尾复读'],
  ['3#43', '同 uid1 第 27 条：整句重复'],
  ['3#44', '同 uid1 第 28 条：同义词替换伪重复'],
  ['3#50', '翻译腔为可选句式池，已由 trans-* 三条句式覆盖'],
  ['3#60', '并列模糊动作已由 xiangshi-youxiang 句式覆盖'],
  ['3#62', '已由 psy-yebeiba 句式覆盖'],
  ['2#34', '本条即 face-tianbiao 句式的原文出处；审计把 [部位] 实例化成通用词，无法命中该句式的部位枚举'],
  ['3#56', '同 uid2 第 34 条：已由 face-tianbiao 句式覆盖'],
  ['1#禁止事项', '禁止清单，规定的是"不要出现什么"（AI在处理文本 / 在故意反讽 都是元描述）'],
  ['2#禁止事项', '禁止清单；引号里的"知道了""嗯""好""行"是要避免的口语词，不是要标注的八股词'],
  ['3#禁止事项', '同 uid2 禁止事项'],
  ['3#36', '与 uid1/uid2 第 21 条同义，已由 dlg-fanwen 句式覆盖；本条未给示例句'],
  ['3#37', '与 uid1/uid2 第 22 条同义，已由 dlg-fudu 句式覆盖；本条未给示例句'],
]);

/**
 * 判定"这条引号内容不是短语"的规则。
 * 注意：**不能**把含 `……` `[x]` `XX` 的引号排除掉——那些正是需要
 * 实例化后送去检测的句式模板。
 */
const NON_PHRASE = [
  /(?:AI|Show|Tell)/,
  /^[A-Za-z\s]+$/,
  /^(?:说明|示例|注意|禁止|可替换|均可|这类|此条|该条|必须|不得|不要|每段|每句|全篇|至少|优先|允许)/,
];

/** 把占位符填成可匹配的实词。 */
function instantiate(s) {
  return s
    .replace(/…+/g, '某物')
    .replace(/\[[^\]]*\]/g, '某物')
    .replace(/XX/gi, '某物')
    .replace(/A(?=[，,、]|的)/g, '甲')
    .replace(/(?<=[，,、])B/g, '乙');
}

function loadWorldbook() {
  for (const p of WORLDBOOK_CANDIDATES) {
    if (fs.existsSync(p)) return { path: p, data: JSON.parse(fs.readFileSync(p, 'utf8')) };
  }
  return null;
}

function extractQuoted(content) {
  const out = [];
  const re = /\u201c([^\u201c\u201d]+)\u201d/g;
  let m;
  while ((m = re.exec(content)) !== null) out.push(m[1].trim());
  return out;
}

function splitRules(content) {
  const lines = content.split('\n');
  let cur = { id: '总纲', txt: [] };
  const rules = [cur];
  for (const ln of lines) {
    const m = ln.match(/^\s*(\d{1,2})[\.、]\s*(.*)$/);
    if (m) {
      cur = { id: m[1], txt: [m[2]] };
      rules.push(cur);
    } else {
      cur.txt.push(ln);
    }
  }
  // 输出格式 / 禁止事项 是独立的标题段，单独识别
  const extra = [];
  const text = content;
  for (const key of ['输出格式', '禁止事项']) {
    const idx = text.indexOf(`【${key}】`);
    if (idx >= 0) extra.push({ id: key, txt: [text.slice(idx)] });
  }
  return rules.concat(extra);
}

function main() {
  const wb = loadWorldbook();
  if (!wb) {
    console.log('跳过规则级审计：未找到原始世界书 JSON。');
    process.exit(0);
  }

  const compiled = compile(CATEGORY_ORDER, []);
  const detectable = (text) => scanText(text, compiled).length > 0;

  const entries = wb.data.entries || {};
  const failures = [];
  const behavioral = [];
  let ruleTotal = 0;
  let coveredRules = 0;

  for (const key of Object.keys(entries).sort((a, b) => Number(a) - Number(b))) {
    const e = entries[key];
    const rules = splitRules(e.content || '');
    for (const rule of rules) {
      const body = rule.txt.join('\n').trim();
      if (!body) continue;
      ruleTotal++;
      const tag = `${e.uid}#${rule.id}`;

      const quotes = extractQuoted(body).filter(
        (q) => q.length >= 2 && !NON_PHRASE.some((re) => re.test(q))
      );
      const candidates = quotes.length > 0 ? quotes : [body];

      const hit = candidates.some((q) => {
        const inst = instantiate(q);
        if (detectable(inst)) return true;
        // 整句示例里往往只有半截是可识别的；再按标点切成小段试一次
        return inst
          .split(/[。！？、，,\/]/)
          .map((s) => s.trim())
          .filter((s) => s.length >= 2)
          .some((s) => detectable(s));
      });
      if (hit) {
        coveredRules++;
        continue;
      }

      if (BEHAVIORAL_RULES.has(tag)) {
        behavioral.push({ tag, reason: BEHAVIORAL_RULES.get(tag) });
        continue;
      }
      failures.push({ tag, body: body.replace(/\s+/g, ' ').slice(0, 120), quotes: quotes.slice(0, 6) });
    }
  }

  console.log('规则级覆盖审计（对照原始世界书）');
  console.log('─'.repeat(60));
  console.log(`世界书: ${wb.path}`);
  console.log(`规则总数 ${ruleTotal}；词面可识别 ${coveredRules}；纯行为规则（清单内）${behavioral.length}`);
  console.log('─'.repeat(60));

  if (failures.length === 0) {
    console.log('✓ 每条规则都有可识别的表面形式，或已在纯行为清单中说明理由');
  } else {
    console.log(`✗ ${failures.length} 条规则既没有可识别词面，也不在纯行为清单里：`);
    for (const f of failures) {
      console.log(`\n  [${f.tag}] ${f.body}`);
      if (f.quotes.length) console.log(`      引号内容: ${f.quotes.join(' / ')}`);
    }
  }
  console.log('─'.repeat(60));

  if (failures.length > 0) {
    console.log('处理方式：补词元/句式，或把该条加进 BEHAVIORAL_RULES 并写明理由。');
    process.exit(1);
  }
  process.exit(0);
}

main();
