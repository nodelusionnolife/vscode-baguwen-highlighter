'use strict';

/**
 * 词表覆盖率审计（回归守卫）。
 *
 * 从原始八股世界书 JSON 抽出所有引号短语，检查是否已被
 * src/data/baguwen.js 收录。数据是手工归类的，必须能自动核对，
 * 否则会像「程度·情态副词」那样整组漏收而没人发现。
 *
 * 判定规则：
 *   - 命中字面量，或被某条正则句式匹配       → 已收录
 *   - 含占位符（…… [名词] xx）、含句末标点、超长句 → 视为示例句/元描述
 *   - 已被某条已收录短语包含（包含串≥3字）  → 视为示例句
 *   - 其余短条目                            → **判定为遗漏，测试失败**
 *
 * 运行：
 *   node test/coverage.js           # 报告，遗漏则退出码 1
 *   node test/coverage.js --report  # 只报告，不做失败判定
 */

const fs = require('fs');
const path = require('path');
const { LITERALS, PATTERNS, PUNCT_PATTERNS } = require('../src/data/baguwen');

const WORLDBOOK_CANDIDATES = [
  process.env.BAGUWEN_WORLDBOOK,
  'C:/Users/G/Downloads/b8939d30c90ee79e.json',
  path.join(__dirname, '..', 'b8939d30c90ee79e.json'),
].filter(Boolean);

/** 含占位符 / 属规则自身用语的字符串，不参与覆盖检查。 */
const META_PATTERNS = [
  /…/, // 占位符模板
  /\[/, /\(/, /（/,
  /\//, // 斜杠表示候选写法，如「淬了/淬着X」
  /xx/i, // 长年xx的薄茧
  /^[A-Za-z\s]+$/,
  /。/, /！/, /？/, // 带句末标点的整句
  /(?:AI|Show|Tell)/, // 元描述（讲"AI 在做什么"）
  /^(?:说明|示例|注意|禁止|可替换|均可|这类|此条|该条)/,
];

/**
 * 人工确认跳过的字符串：属于「规则示例」或「元描述」，本就不该被高亮。
 * 每项都要有理由，否则这里会变成藏污纳垢的地方。
 */
const SKIP = new Map([
  ['冰冷的、坚硬的桌面', '第四版第 13 条"两个的字定语"的示例短语'],
  ['长年xx的薄茧', '含 xx 占位符，是句式模板的一部分'],
  ['他掐灭了烟', '第 27 条"整句重复"的示例句，非固定短语'],
  ['他坐着没动', '示例句'],
  ['怕你没听懂', '规则在解释"读起来啰嗦"的原因，不是短语'],
  ['他坐下', '第 5 条的示例动作'],
  ['他心跳快了', '第 5 条的示例动作'],
  ['笨拙', '第 35 条在描述风格，不是短语'],
  ['知道了', '属于"禁止使用的口语"清单，是要避免的词'],
  ['嗯', '属于"禁止使用的口语"清单'],
  ['好', '属于"禁止使用的口语"清单'],
  ['行', '属于"禁止使用的口语"清单'],
  ['决定性瞬间', '规则在描述触发条件'],
  ['这里很重要', '规则在描述触发条件'],
  ['这里该有情绪了', '规则在描述触发条件'],
  ['这句动物塑完全不必要', '规则在描述预期效果'],
  ['这句删掉完全不影响叙事', '规则在描述预期效果'],
  ['这光到底从哪切的', '规则在描述预期效果'],
  ['回音壁', '规则给效果起的名字'],
  ['这段我是不是读过', '规则在描述预期效果'],
  ['这个词被AI玩坏', '规则在描述预期效果'],
  ['AI在自我检查', '元描述'],
  ['AI突然不想装了', '元描述'],
  ['AI突然不想装了的', '元描述'],
  ['AI以为换了个词就算不同', '元描述'],
  ['AI在硬塞词汇', '元描述'],
  ['这词用在这里很别扭', '元描述'],
  ['AI在处理文本', '元描述'],
  ['先Show后Tell', '术语名'],
  ['在故意反讽', '元描述'],
  ['AI是认真的，它真的以为这样写很好', '元描述'],
  ['AI是认真的，它真的以为这样写很动人', '元描述'],
  ['勉强像人话的片段', '元描述'],
  ['明显机械重复的片段', '元描述'],
  ['勉强像那么回事的情感片段', '元描述'],
  ['明显机械堆砌的修饰重复', '元描述'],
  ['在这潮湿得令人窒息的空气里', '第 23 条句式模板的填充示例'],
  ['一枚灰尘在空气中漂浮', '第 28 条"漂浮"的示例句'],
  ['进行了一次凝视', '第 32 条"进行"的示例搭配'],
  ['使得空气变得凝重', '第 32 条"使得"的示例搭配'],
  ['他打开门，以至于风灌了进来', '第 7 条"以至于"的示例句'],
  ['他喝了一口水，水顺着喉咙流入躯体', '第 29 条人体词硬塞的示例句'],
  ['他低沉：‘我饿了。’', '第 33 条说字替换的示例'],
  ['他缓缓打了个喷嚏', '输出格式里"缓缓"的示例'],
  ['他站着没动。', '第 26 条回声壁的示例句'],
  ['他依然站着没动。', '第 26 条回声壁的示例句'],
  ['与刚才他系鞋带时不同，现在他感到酸涩', '第 47 条对比句式的示例'],
  ['与刚才他系鞋带时不同，此刻他感到一阵眩晕', '输出格式里对比句式的示例'],
  ['他感到一阵酸涩，从肱二头肌蔓延开来', '第 48 条解剖术语的示例'],
  ['他感到疲惫，更别提还要走路了', '第 9 条"更别提"的示例'],
  ['他感到一阵酸涩。于是他攥紧了拳头。于是他深吸了一口气。', '第 11 条"于是"的示例'],
  ['他低沉而富有磁性的声音发出银铃般清脆的笑声', '第 58 条"两种互斥声音特质"的示例整句'],
  ['那阵风仿佛在诉说着什么', '第 28 条"仿佛在诉说着什么"的示例'],
  ['那扇门仿佛在诉说着什么', '第 28 条的示例'],
  ['是试探，而非询问。是陈述，而非请求。', '第 28 条判断句式的示例'],
  ['糖吃完了。糖的故事也就到此为止。', '第 40 条结尾模板池的示例（规则明令禁止照抄）'],
  ['宇宙的秩序有时候就是被一颗糖维持的。', '第 40 条结尾模板池的示例（禁止照抄）'],
  ['一颗糖，一条走廊，一个沉默的人。足够了。', '第 40 条结尾模板池的示例（禁止照抄）'],
  ['天花板还是白的。它什么都没有说。', '第 40 条结尾模板池的示例（禁止照抄）'],
  ['他还活着。那就够了。', '第 40 条结尾模板池的示例（禁止照抄）'],
  ['她还在。这就够了。', '第 40 条结尾模板池的示例（禁止照抄）'],
  ['就这样。', '第 40 条结尾模板池的示例（禁止照抄）'],
  ['然后就没有然后了。', '第 40 条结尾模板池的示例（禁止照抄）'],
  ['事情就是这样', '第 40 条结尾模板池的示例（禁止照抄）'],
  ['一切就是这样开始的', '第 40 条结尾模板池的示例（禁止照抄）'],
  ['这就是当时发生的事', '第 40 条结尾模板池的示例（禁止照抄）'],
  ['一丝空气', '固定量词"一丝"的示例搭配'],
  ['一缕时间', '固定量词"一缕"的示例搭配'],
  ['一抹门框', '固定量词"一抹"的示例搭配'],
  ['一股念头', '固定量词"一股"的示例搭配'],
  ['他克制住翻涌的情绪', '"克制"的示例句'],
  ['他的防线被击垮了', '"防线/击垮"的示例句'],
  ['极其普通', '程度副词"极其"的示例搭配'],
  ['极其普通的心跳', '程度副词"极其"的示例搭配'],
  ['极为正常', '程度副词"极为"的示例搭配'],
  ['极为正常的手指', '程度副词"极为"的示例搭配'],
  ['极度平整', '程度副词"极度"的示例搭配'],
  ['极度平整的桌面', '程度副词"极度"的示例搭配'],
  ['俗语', '第 74 条在描述手法，不是短语'],
  ['关键词', '第 10 条"词汇锁定"的术语'],
  ['排比三连', '第 12 条的术语'],
  ['深意', '第 40 条在描述结尾风格'],
  ['结束了', '第 40 条结尾模板的示例（禁止照抄）'],
  ['这样就好', '第 40 条结尾模板的示例（禁止照抄）'],
  ['那就够了', '第 40 条结尾模板的示例（禁止照抄）'],
  ['这就够了', '第 40 条结尾模板的示例（禁止照抄）'],
  ['僵', '单字，会误伤"僵硬/僵住"等大量正常用词'],
  ['僵硬', '已由"他整个人僵在原地/手指僵硬地停在空中"覆盖'],
  ['冷', '单字，会误伤"冰冷/冷淡/冷白"等大量正常用词'],
  ['的', '单字虚词，无法作为独立高亮项'],
  ['性', '单字后缀，无法作为独立高亮项'],
  ['说', '单字，是世界书要求"禁用并替换"的词，不是要标注的词'],
]);

/** 判定为"示例句"而非"应补条目"的长度上限。 */
const SHORT_ITEM_MAX = 16;
/** 参与"包含关系"判定的最短已收录短语，太短会误伤。 */
const MIN_CONTAINED = 3;

function loadWorldbook() {
  for (const p of WORLDBOOK_CANDIDATES) {
    if (fs.existsSync(p)) return { path: p, data: JSON.parse(fs.readFileSync(p, 'utf8')) };
  }
  return null;
}

function extractPhrases(content) {
  const out = [];
  const re = /\u201c([^\u201c\u201d]+)\u201d/g;
  let m;
  while ((m = re.exec(content)) !== null) out.push(m[1].trim());
  return out;
}

function main() {
  const reportOnly = process.argv.includes('--report');
  const wb = loadWorldbook();
  if (!wb) {
    console.log('跳过覆盖率审计：未找到原始世界书 JSON。');
    console.log('可用环境变量 BAGUWEN_WORLDBOOK 指定路径。');
    process.exit(0);
  }

  const literals = new Set();
  for (const id of Object.keys(LITERALS)) for (const w of LITERALS[id]) literals.add(w);
  const literalsByLength = [...literals].sort((a, b) => b.length - a.length);

  const regexes = [...PATTERNS, ...PUNCT_PATTERNS].map((p) => {
    try {
      return new RegExp(p.re.source);
    } catch {
      return null;
    }
  }).filter(Boolean);

  /** 精确命中字面量或句式 */
  const exactCovered = (phrase) => {
    if (literals.has(phrase)) return true;
    return regexes.some((re) => re.test(phrase));
  };

  /** 被某条更长的已收录短语包含 */
  const containsCovered = (phrase) =>
    literalsByLength.some(
      (lit) => lit.length >= MIN_CONTAINED && lit.length < phrase.length && phrase.includes(lit)
    );

  const entries = wb.data.entries || {};
  const gaps = new Map(); // 疑似遗漏
  const examples = new Map(); // 示例句/元描述
  let totalChecked = 0;

  for (const key of Object.keys(entries).sort((a, b) => Number(a) - Number(b))) {
    const e = entries[key];
    const phrases = [...new Set(extractPhrases(e.content || ''))];
    for (const p of phrases) {
      if (!p) continue;
      totalChecked++;
      if (exactCovered(p)) continue;
      if (SKIP.has(p)) continue;
      if (META_PATTERNS.some((re) => re.test(p))) continue;
      if (containsCovered(p)) continue;
      if (p.length > SHORT_ITEM_MAX) continue;
      gaps.set(p, e.uid);
    }
  }

  console.log('词表覆盖率审计（对照原始世界书）');
  console.log('─'.repeat(60));
  console.log(`世界书: ${wb.path}`);
  console.log(`检查短语 ${totalChecked} 条（含各版本重复）`);
  console.log(`人工确认跳过的示例/元描述: ${SKIP.size} 条（见 SKIP 清单及理由）`);
  console.log('─'.repeat(60));

  if (gaps.size === 0) {
    console.log('✓ 未发现遗漏：短条目全部已收录');
  } else {
    console.log(`✗ 疑似遗漏 ${gaps.size} 条短条目：`);
    for (const [p, uid] of [...gaps.entries()].sort()) {
      console.log(`    [uid ${uid}] ${p}`);
    }
  }
  console.log('─'.repeat(60));

  if (gaps.size > 0 && !reportOnly) {
    console.log('这些是"短、无句末标点、且不被任何已收录短语包含"的条目，');
    console.log('通常就是词表漏收。补齐后本测试才会通过。');
    process.exit(1);
  }
  process.exit(0);
}

main();
