'use strict';

/**
 * 纯逻辑单元测试：不启动 VS Code，直接验证词表数据与匹配算法。
 * 运行：node test/run.js
 */

const { CATEGORIES, LITERALS, PATTERNS, PUNCT_PATTERNS } = require('../src/data/baguwen');
const { compile, scanText, CATEGORY_ORDER, NOISY_CATEGORIES } = require('../src/core');

let passed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    passed++;
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// ── 1. 数据完整性 ────────────────────────────────────────────────────────────

const ids = CATEGORIES.map((c) => c.id);
check('类别 id 无重复', new Set(ids).size === ids.length, ids.join(','));

const patternIds = [...PATTERNS, ...PUNCT_PATTERNS].map((p) => p.id);
check('句式 id 无重复', new Set(patternIds).size === patternIds.length,
  patternIds.filter((v, i) => patternIds.indexOf(v) !== i).join(','));

for (const cat of CATEGORIES) {
  const hasLiterals = (LITERALS[cat.id] || []).length > 0;
  const hasPatterns = cat.id === 'pattern' || cat.id === 'punct';
  check(`类别 ${cat.id} 非空`, hasLiterals || hasPatterns);
  check(`类别 ${cat.id} 有颜色`, /^#[0-9a-fA-F]{3,8}$/.test(cat.color), cat.color);
}

// 字面量里不能混入占位符模板，那属于句式
const badLiterals = [];
for (const [id, words] of Object.entries(LITERALS)) {
  for (const w of words) {
    if (/[…\[\]（）]/.test(w)) badLiterals.push(`${id}:${w}`);
    if (w.length < 2) badLiterals.push(`${id}:${w}(过短)`);
  }
}
check('字面量不含占位符/过短项', badLiterals.length === 0, badLiterals.join(', '));

const literalTotal = Object.values(LITERALS).reduce((n, a) => n + a.length, 0);
const literalUnique = new Set(Object.values(LITERALS).flat()).size;

// ── 2. 编译 ─────────────────────────────────────────────────────────────────

const allOn = compile(CATEGORY_ORDER, []);
check('全开时字面量条目数 = 去重后短语数', allOn.literalCount === literalUnique,
  `${allOn.literalCount} vs ${literalUnique}`);
check('全开时句式数量正确',
  allOn.patternCount === PATTERNS.length + PUNCT_PATTERNS.length,
  `${allOn.patternCount} vs ${PATTERNS.length + PUNCT_PATTERNS.length}`);

// 两个引擎现在都默认收录全部类别：词表里有的词却不亮，会被当成扩展没生效
const defaultOn = compile(CATEGORY_ORDER, []);
check('默认开启全部类别（含 function/punct）',
  defaultOn.enabled.length === CATEGORY_ORDER.length,
  defaultOn.enabled.join(','));
check('目录里仍标注了噪音类别', NOISY_CATEGORIES.size === 2, [...NOISY_CATEGORIES].join(','));
check('默认开启时已有一定词量', defaultOn.literalCount > 200, String(defaultOn.literalCount));

const ignored = compile(CATEGORY_ORDER, ['眼神暗了暗']);
check('ignore 生效', ignored.literalCount === literalUnique - 1,
  `${ignored.literalCount} vs ${literalUnique - 1}`);

// ── 3. 每条字面量都能被自动机找到 ────────────────────────────────────────────

const allWords = [];
for (const id of CATEGORY_ORDER) {
  for (const w of LITERALS[id] || []) allWords.push(w);
}
const haystack = allWords.join('。');
const hits = scanText(haystack, allOn);
const hitWords = new Set(hits.map((h) => h.word));

const missed = allWords.filter((w) => !hitWords.has(w));
// 被更长词完全吞掉的短词属于正常去重叠行为
const trulyMissed = missed.filter((w) => !allWords.some((o) => o !== w && o.includes(w)));
check('所有字面量均能命中（允许被更长词吞并）', trulyMissed.length === 0,
  trulyMissed.slice(0, 10).join(', '));

// ── 4. 结构句式 / 关联词 ─────────────────────────────────────────────────────

const structuralCases = [
  ['他看着她，不是怜惜，而是某种近乎于审视的东西。', '不是……而是……'],
  ['与其说是心动，不如说是某种机械的共振。', '与其说……不如说……'],
  ['非但没能挣脱，反而陷得更深。', '非但……反而……'],
  ['不仅仅是疼痛，更是某种说不清的屈辱。', '不仅……更是……'],
  ['并非冷漠，恰恰是某种极度的克制。', '并非……恰恰是……'],
  ['之所以战栗，是因为那道视线。', '之所以……是因为……'],
  ['是试探，而非询问。', '是……而非……'],
  ['越是克制，越是翻涌。', '越是……越是……'],
  ['介于想笑和想哭之间。', '介于……和……之间'],
  ['他伸出的手顿住了，像是在犹豫，又像是在等待。', '像是在……又像是在……'],
  ['由于门没关严的缘故，他感到一阵酸涩。', '由于……的缘故'],
  ['没人知道的是，窗外有一只猫路过。', '全知视角：不知道的是……'],
  ['被一种莫名的情绪所笼罩。', '被……所……'],
  ['一切，都结束了。', '一切，都……'],
  ['也许吧。但他就是没办法放下。', '也许吧。但……'],
  ['他这才发现，原来水也可以这样凉。', '他这才发现，原来……'],
  ['像一把烧红的铁钉，插入他的脊背。', '像一把……插入……'],
  ['身体像一张拉满的弓。', '身体像一张拉满的弓'],
];

for (const [text, label] of structuralCases) {
  const res = scanText(text, allOn);
  const ok = res.some((r) => r.categoryId === 'pattern');
  check(`句式命中：${label}`, ok,
    ok ? '' : `实际命中 ${JSON.stringify(res.map((r) => r.word))}`);
}

// ── 4b. 衍生句式（对照世界书补全的相似套路） ─────────────────────────────────
// 每条用例都刻意避开同义字面量，确保命中的只能是句式本身

const derivedCases = [
  ['如果他不来，我就一直等下去。', 'ruguo-wo-jiu'],
  ['真正的寒意才刚刚开始蔓延。', 'zhenzheng-caikaishi'],
  ['在这潮湿的空气里，他站着。', 'zai-zhe-de-li'],
  ['这种寂静比任何刀锋都让他感到窒息。', 'zhezhong-bi-tadou'],
  ['他的目光在她脸上停留了三秒。', 'muguang-tingliu'],
  ['他的视线落在窗外。', 'muguang-luozai'],
  ['眼中闪过一丝异样。', 'yanzhong-shanguo'],
  ['眼中闪烁着微光。', 'yanzhong-shanshuo'],
  ['那是一双怎样的手啊。', 'nashi-yishuang'],
  ['视若蝼蚁。', 'louyi-bianti'],
  ['心中涌起一股酸涩。', 'xinzhong-yongqi'],
  ['他知道，一切都回不去了。', 'tazhidao'],
  ['一股寒意顺着脊背爬上来。', 'liangyi-bianti'],
  ['指节泛着青白。', 'fa-bai'],
  ['他僵住了。', 'jiang-ying'],
  ['一枚灰尘漂浮在半空中。', 'xuanfu-piaofu'],
  ['喉间溢出一声低笑。', 'houjian-yichu'],
  // 刻意不含'带着/透着'，否则会同时命中 duihua-houzhui 且后者更长
  ['声音很轻，却不容置疑。', 'shengyin-buda'],
  ['声音变得沙哑。', 'shengyin-biande'],
  ['语气没有起伏。', 'yuqi-ping'],
  ['宿命的齿轮缓缓咬合。', 'mingyun-bianti'],
  ['命运的轨迹开始改写。', 'mingyun-dongci'],
  ['时间在这一刻静止了。', 'time-tingzhi2'],
  ['他的手很轻地顿了一下。', 'henqing-yixia'],
  ['指尖轻轻地弯曲了一下。', 'qingqing-yixia'],
  ['他愣了一下。', 'dun-yixia'],
  ['指尖淬着寒意。', 'cui-le-zhe'],
  ['长年握笔的薄茧。', 'changnian-bojian'],
  ['进行了一次凝视。', 'kongzhuan-dongci'],
];

const patternNameById = new Map(
  [...PATTERNS, ...PUNCT_PATTERNS].map((p) => [p.id, p.name])
);

for (const [text, id] of derivedCases) {
  const expectedName = patternNameById.get(id);
  if (!expectedName) {
    check(`衍生句式 id 存在 ${id}`, false, '词表里没有这个 id');
    continue;
  }
  const res = scanText(text, allOn);
  const hit = res.find((r) => r.rule === expectedName);
  check(`衍生句式命中 ${id}：${text}`, Boolean(hit),
    hit ? '' : `实际 ${JSON.stringify(res.map((r) => r.categoryId + ':' + (r.rule || r.word)))}`);
}

// ── 4c. 衍生变体：每个母题至少两条同类 ──────────────────────────────────────
// 世界书每条规则都有固定的生成逻辑（如"猎物描写"分僵住/发抖/认命三态），
// 变体必须在同一母题内换喻体，不能跨态乱凑。

const variantPatternCases = [
  ['与方才不同，他这次没有回头。', 'duibi-guoqu2'],
  ['和他别无二致。', 'duibi-guoqu2'],
  ['一如从前那般。', 'duibi-guoqu2'],
  ['那道冰冷的、坚硬的、不容置喙的、像是从骨头缝里渗出来的目光。', 'san-die-de'],
  ['他是笃定的，稳操胜券的。', 'panduan-shi-de'],
  ['语气里满是疏离。', 'duihua-houzhui2'],
  ['嗓音浸着疲惫。', 'duihua-houzhui2'],
  ['酥麻自尾椎向上升起。', 'congA-yongxiang-B2'],
  ['酥麻沿着脊背游走。', 'congA-yongxiang-B2'],
  ['四周瞬间安静下来。', 'time-tingzhi3'],
  ['安静得能听见自己的心跳。', 'time-tingzhi3'],
  ['无人知晓的是，他已经走了。', 'quanzhi-buzhi2'],
  ['谁也没有注意到，窗外下起了雨。', 'quanzhi-buzhi2'],
  ['在某个看不见的地方，有人也在看着他。', 'quanzhi-jiaoluo2'],
  ['如果从高处望去，这一幕像什么。', 'quanzhi-fukan2'],
  ['命运的织线开始收拢。', 'mingyun-bianti2'],
  ['宿命终于露出真容。', 'mingyun-dongci2'],
  ['像一根针钉进他的胸口。', 'xiang-yi-bing'],
  ['像一张网罩下来。', 'xiang-yi-bing'],
  ['身体像一根绷紧的弦。', 'shenti-xiang2'],
  ['在这个满是谎言的城里。', 'zai-zhe-de-li'],
  ['这种沉默比任何言语更让他窒息。', 'zhezhong-bi-geng'],
  ['他低沉的嗓音里透出银铃般的清脆。', 'shengyin-maodun'],
  ['使得空气多了几分凝重。', 'kongzhuan-dongci2'],
  ['你也是这样想的，对吧？', 'dlg-fanwen2'],
  ['说来也怪，他竟没有回头。', 'duan-shou2'],
];

for (const [text, id] of variantPatternCases) {
  const expectedName = patternNameById.get(id);
  if (!expectedName) {
    check(`衍生变体 id 存在 ${id}`, false, '词表里没有这个 id');
    continue;
  }
  const res = scanText(text, allOn);
  const hit = res.find((r) => r.rule === expectedName);
  check(`衍生变体命中 ${id}：${text}`, Boolean(hit),
    hit ? '' : `实际 ${JSON.stringify(res.map((r) => r.categoryId + ':' + (r.rule || r.word)))}`);
}

// 每组母题至少两条变体词元（按规则的生成逻辑分态校验）
const allLiterals = new Set(allWords);
const variantLiteralGroups = {
  '生理反应·恐惧': ['血液凝固', '心脏像被攥住', '喉咙发不出声音', '瞳孔一瞬间收缩'],
  '生理反应·愤怒': ['后槽牙咬紧', '指关节捏得发白', '指关节捏得咔咔响'],
  '生理反应·欲望': ['尾椎一麻', '后颈泛红', '小腹收紧', '耳根烧起来'],
  '生理反应·悲伤': ['胸口像被掏空', '喉咙堵住', '眼眶发酸', '浑身没了力气'],
  '猎物·僵住': ['脊背瞬间僵直', '呼吸停滞了半拍', '双脚像生了根', '身体像被冻住'],
  '猎物·发抖': ['从脚底一路抖到头顶', '细密的战栗顺着皮肤爬开', '像筛糠一样抖'],
  '猎物·认命': ['像被抽走了所有力气', '整个人软了下去', '像断了线的木偶'],
  '狩猎·观察': ['估量着猎物的弱点', '视线像在切割', '目光像在标记'],
  '狩猎·等待': ['不急于下手', '像在等猎物自己投降', '不慌不忙地收网'],
  '狩猎·收割': ['像猛兽锁定猎物', '终于收网', '缓慢而不容抗拒地'],
  '对话前置·手指': ['指尖在桌面上点了点', '指腹摩挲着杯沿', '手指无意识地蜷了蜷'],
  '对话前置·目光': ['眼皮抬了抬', '视线垂下去', '目光扫过来', '目光落在窗外'],
  '对话前置·气息': ['呼出一口气', '轻轻吐气', '气息沉了沉', '胸口起伏了一下'],
  五感: ['撞进眼底', '扑进鼻腔', '在耳膜上震动', '萦绕在鼻端'],
  动机模板: ['某种更原始的东西在作祟', '本能在叫嚣', '兽性在苏醒'],
  '逢X必Y': ['偏偏在此时', '就在这个节骨眼上', '像是嫌不够似的', '一阵酥麻窜过'],
  复读机: ['更准确地说', '更确切地说', '或者说'],
  时间词缀: ['彼时彼刻', '正当此时', '就在那一瞬', '许多年后', '是夜'],
};

for (const [group, words] of Object.entries(variantLiteralGroups)) {
  const missing = words.filter((w) => !allLiterals.has(w));
  check(`变体词元 ${group} 至少两条`, words.length - missing.length >= 2,
    missing.length ? `缺 ${missing.join('、')}` : '');
}

// ── 5. 具体短语与类别归属 ────────────────────────────────────────────────────

const categoryCases = [
  ['骨节分明的手指在光里拉出一道弧线。', 'cliche'],
  ['嘴角勾起一抹若有若无的弧度。', 'cliche'],
  ['那双眼古井无波，像看待蝼蚁一般。', 'phrase'],
  ['纤长的睫毛颤了颤。', 'phrase'],
  ['他的头颅微微偏了偏。', 'anatomy'],
  ['像石子投湖，涟漪层层扩散。', 'metaphor'],
  ['像受惊的猫，瑟缩在角落。', 'metaphor'],
  ['光线斜切进来。', 'env'],
  ['她开口，声音从喉咙里碾出来。', 'dialogue'],
  ['命运的齿轮开始转动。', 'myth'],
  ['他勒住马，整个人僵了1.5秒。', 'number'],
];

for (const [text, expected] of categoryCases) {
  const res = scanText(text, allOn);
  const ok = res.some((r) => r.categoryId === expected);
  check(`类别归属 ${expected}：${text.slice(0, 12)}…`, ok,
    ok ? '' : `实际 ${JSON.stringify(res.map((r) => r.categoryId + ':' + r.word))}`);
}

// ── 6. 噪音类别默认也命中（用户用这些词测试时不能"看起来像坏了"） ──────────

const fnText = '他极其缓慢地抬起手，仿佛在等某种东西。';
check('function 默认命中（极其/仿佛/某种）',
  scanText(fnText, defaultOn).some((r) => r.categoryId === 'function'),
  JSON.stringify(scanText(fnText, defaultOn).map((r) => r.categoryId + ':' + r.word)));

check('punct 默认命中 ！！！', scanText('不！！！', defaultOn).some((r) => r.categoryId === 'punct'));

// 用户实测过的那 20 个「程度·情态副词」必须全部命中
const userLine = '不容质疑、几不可查、几不可闻、难以察觉、不容抗拒、几乎看不见、微不可察、一顿、确实、注定、必将、现在、接下来、悄然、陡然、骤然、毫无疑问、毋庸置疑、前所未有、显而易见';
const userWords = userLine.split('、');
const userHits = scanText(userLine, defaultOn);
const userMissed = userWords.filter((w) => !userHits.some((h) => h.word === w));
check('「程度·情态副词」20 词全部默认命中', userMissed.length === 0, userMissed.join('、'));

// ── 7. 去重叠：不出现交叠区间 ────────────────────────────────────────────────

const longText = haystack + '\n' +
  '不是怜惜，而是某种近乎于审视的东西。与其说心动，不如说共振。' +
  '光线斜切进来。骨节分明的手指。像石子投湖。';
const overlapped = scanText(longText, allOn);
let hasOverlap = false;
for (let i = 1; i < overlapped.length; i++) {
  if (overlapped[i].start < overlapped[i - 1].end) {
    hasOverlap = true;
    break;
  }
}
check('结果无交叠区间', !hasOverlap);
check('结果按起始位置有序', overlapped.every((m, i) => i === 0 || m.start >= overlapped[i - 1].start));

// ── 8. 性能冒烟测试 ─────────────────────────────────────────────────────────

const big = longText.repeat(400); // 约 20 万字
const t0 = Date.now();
const bigHits = scanText(big, allOn);
const elapsed = Date.now() - t0;
check('20 万字扫描 < 3000ms', elapsed < 3000, `${elapsed}ms`);
check('大文本命中数量合理', bigHits.length > 1000, String(bigHits.length));

// ── 汇总 ────────────────────────────────────────────────────────────────────

console.log('八股高亮扩展 · 逻辑自检');
console.log('─'.repeat(52));
console.log(`类别 ${CATEGORIES.length} 个；字面量 ${literalTotal} 条（去重 ${literalUnique} 条）；句式 ${PATTERNS.length + PUNCT_PATTERNS.length} 条`);
console.log(`默认开启类别：${CATEGORY_ORDER.length} 个（全部）`);
console.log(`20 万字扫描用时：${elapsed}ms，命中 ${bigHits.length} 处`);
console.log('─'.repeat(52));

if (failures.length === 0) {
  console.log(`✓ 全部通过（${passed} 项）`);
  process.exit(0);
} else {
  console.log(`✗ 失败 ${failures.length} 项，通过 ${passed} 项：`);
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
}
