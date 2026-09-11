# 八股词表高亮 · VS Code 扩展

自动高亮文本里的**八股（AI 味）标记**：结构句式与关联词、陈词滥调固定句、替换池短语、情绪词、比喻与动物塑、人体词、环境模板、伪精确数字等。词表来自 SillyTavern 八股世界书 `b8939d30c90ee79e.json` 的四个版本（第 4 版为启用版）。

此项目的代码部分完全由deepseekv4.1flash完成，人工只负责了思路、开发方向、提供词表以及审查验收。不能完全保证可用性，如果出现bug或有希望添加的词表，请随意提...

**默认走 VS Code 原生高亮**：由 TextMate 注入语法产出 token，扩展不需要在运行时扫描，**装好、启用、打开文件就生效**。

## 两种引擎

| | 原生（默认） | 装饰器 |
|---|---|---|
| 原理 | TextMate 注入语法 + `tokenColorCustomizations` | 扩展运行时扫描 + 装饰器 API |
| 生效方式 | 启用扩展即生效，零运行时开销 | 需要扩展激活并扫描 |
| 上色 | token 颜色，跟主题走（用主题的字体样式） | 波浪下划线 + 背景色，颜色由扩展指定 |
| 逐类别开关 | ✗（语法是静态的） | ✓ |
| 忽略词 / 自定义颜色 | ✗ | ✓ |
| 适用文件 | markdown / html / json / yaml / xml | 任意语言 |

用 `baguwen.engine` 切换：`native`（默认）/ `decoration` / `both`。改完要重新加载窗口。

## 安装

不需要编译，扩展本体零依赖。

### 装进本机 VS Code（推荐）

`code` 命令行在 `E:\Microsoft VS Code\bin\code`：

```bash
npx @vscode/vsce package
code --install-extension baguwen-highlighter-1.2.0.vsix
```

装完重启 VS Code，打开任意 markdown 文件即可看到高亮——**不需要按 F5**。

### 开发调试（F5）

用 VS Code 打开本文件夹，按 `F5` 会弹出扩展开发宿主窗口，自动打开 `sample/八股样例.md`。`launch.json` 里已经禁用了 Augment，避免它的初始化报错刷屏。

## 效果

打开 `sample/八股样例.md`（或 `sample/八股样例.txt`），八股标记会按类别显示成不同颜色，关联词（如"不是……而是……"）整段变色并带下划线。两个样例内容相当，分别验证 markdown 与纯文本两条路径。

想看成色清单，按 `Ctrl+Shift+P` 运行 **八股高亮: 输出当前文件命中报告**，输出面板会列出分类统计和每处命中的行号。

## 高亮类别

| 类别 | scope / id | 默认 | 内容举例 |
|---|---|---|---|
| 结构句式·关联词 | `baguwen.pattern` | 开 | 不是…而是…、与其说…不如说…、介于…和…之间 |
| 陈词滥调名场面 | `baguwen.cliche` | 开 | 骨节分明的手指、嘴角勾起一抹若有若无的弧度、眼神暗了暗 |
| 替换池固定短语 | `baguwen.phrase` | 开 | 古井无波、纤长的睫毛、喉结上下滚动、心脏漏跳了一拍 |
| 情绪·状态词 | `baguwen.emotion` | 开 | 战栗、瑟缩、疯癫、虚无、湮灭、氤氲 |
| 比喻锚点·动物塑 | `baguwen.metaphor` | 开 | 像石子投湖、如手术刀般精准、像受惊的猫 |
| 人体·解剖词 | `baguwen.anatomy` | 开 | 头颅、躯体、脊背、颧骨、肱二头肌 |
| 环境模板句 | `baguwen.env` | 开 | 光线斜切进来、阴影浓稠如墨、空气里浮着 |
| 对话·说字替换 | `baguwen.dialogue` | 开 | 他开口、从喉咙里碾出来、语气平平、尾音上扬 |
| 狩猎·宗教·史诗·命运 | `baguwen.myth` | 开 | 猎人猎物、献祭、宛若神明、命运的齿轮开始转动 |
| 伪精确数字 | `baguwen.number` | 开 | 十五度、1.5秒、瞳孔放大两毫米、心跳每分钟九十下 |
| 高频虚词·程度·模糊词 | `baguwen.function` | 开 | 极其、一丝、某种、仿佛、现在、确实、结构、状态 |
| 符号增殖 | `baguwen.punct` | 开 | ………、！！！、？？？、,,,、—— |

最后两类命中的是"极其""仿佛""现在"这种高频虚词，在普通中文里密度很高，视觉上比其它类略靠后（冷色 / 亮灰）。它们的词表条目一个不少——**词表里有的词不亮，会被当成扩展没生效**，这是 v1.3.0 修掉的一个坑。

觉得干扰时可以收起来：装饰器模式在设置里取消勾选 `baguwen.categories.function` / `.punct`；原生模式跑 `npm run build:grammar -- --default-only` 重新生成语法后重装。

## 改配色

原生模式下 token 颜色写死在贡献点里，**无法跟着浅色/深色主题自动切换**。默认给的是**高饱和"鲜艳"配色**，在深色主题下最醒目。

| 类别 | scope | 默认颜色 | 色相 |
|---|---|---|---|
| 结构句式·关联词 | `baguwen.pattern` | `#c678dd` **加粗+下划线** | 紫 |
| 陈词滥调名场面 | `baguwen.cliche` | `#ff5555` | 红 |
| 替换池固定短语 | `baguwen.phrase` | `#ffb86c` | 橙 |
| 情绪·状态词 | `baguwen.emotion` | `#8be9fd` | 青 |
| 比喻锚点·动物塑 | `baguwen.metaphor` | `#a3f76a` | 黄绿 |
| 人体·解剖词 | `baguwen.anatomy` | `#50fa7b` | 绿 |
| 环境模板句 | `baguwen.env` | `#4ec9b0` | 青绿 |
| 对话·说字替换 | `baguwen.dialogue` | `#ff8a5c` | 橙红 |
| 狩猎·宗教·史诗·命运 | `baguwen.myth` | `#ff5fa2` | 品红 |
| 伪精确数字 | `baguwen.number` | `#f1fa8c` | 黄 |
| 高频虚词·程度·模糊词 | `baguwen.function` | `#6fb8ff` | 蓝 |
| 符号增殖 | `baguwen.punct` | `#b0b8c4` | 亮灰 |

**一、用命令**（推荐）——`Ctrl+Shift+P` → **八股高亮: 把配色写入用户设置**，三选一：

- **鲜艳（默认）**：高饱和，深色主题下最醒目
- **柔和**：中间调，浅色与深色底都能读，适合觉得鲜艳太吵
- **浅色主题**：压深一档，保证白底上的对比度

它会把规则合并进你 `settings.json` 的 `editor.tokenColorCustomizations`，保留你原有的其它 token 规则。

**二、手改**——直接编辑 `settings.json`：

```jsonc
"editor.tokenColorCustomizations": {
  "textMateRules": [
    { "scope": "baguwen.pattern", "settings": { "foreground": "#c678dd", "fontStyle": "bold underline" } },
    { "scope": "baguwen.cliche",  "settings": { "foreground": "#ff5555" } }
  ]
}
```

想让某类更抢眼，`settings` 里还能加 `"fontStyle": "bold"`，或加 `"background": "#3a2a5a"` 做成荧光笔效果（VS Code 的 token 规则支持 `background`，但整段铺底色会比较吵，慎用）。

## 原生模式支持哪些文件

扩展贡献了**两个**语法文件，内容相同、用途不同：

| 文件 | scopeName | 用途 |
|---|---|---|
| `syntaxes/baguwen.tmLanguage.json` | `source.baguwen` | **注入语法**，通过 `injectTo` 注入到已有语言 |
| `syntaxes/baguwen-plaintext.tmLanguage.json` | `source.baguwen.plaintext` | **纯文本语言的根语法**，供 `.txt` 等使用 |

**注入的目标**（第一个文件）：

- 文档类：markdown（`text.html.markdown`）、html（`text.html.derivative`）、reStructuredText（`source.rst`）、LaTeX（`text.tex.latex`）、handlebars（`text.html.handlebars`）
- 数据/配置类：json、yaml、xml、ini / properties / conf（`source.ini`）、dotenv、makefile
- 其它文本：日志（`text.log`）、diff / patch、git-commit message

**`.txt` 怎么覆盖的**：VS Code 内核注册了 `plaintext` 语言，但内置扩展里**没有任何 plaintext 的语法文件**（查过 `resources/app/extensions`，确认没有）。没有语法可注入，所以换个办法——**直接给 plaintext 语言贡献一个根语法**。它本来就没有语法，我们的规则是纯增量，不覆盖任何东西。这样 `.txt`、以及所有未识别扩展名而回退到 plaintext 的文件，都能原生高亮。

需要扩大范围时，改 `scripts/build-grammar.js` 里的 `INJECT_TO` 数组，然后跑 `npm run build:grammar`。

## 配置项

```jsonc
{
  "baguwen.engine": "native",          // native | decoration | both
  "baguwen.enabled": true,              // 装饰器模式总开关
  "baguwen.languages": ["markdown"],    // 装饰器模式限定语言，留空=全部
  "baguwen.style": "both",              // 装饰器样式：underline | background | both
  "baguwen.maxFileSizeKB": 2048,        // 装饰器模式大文件降级阈值
  "baguwen.debounceMs": 200,            // 装饰器模式重扫延迟
  "baguwen.overviewRuler": true,        // 装饰器模式概览标尺
  "baguwen.ignore": ["突然"],           // 装饰器模式忽略词
  "baguwen.colors": { "cliche": "#ff5555" }, // 装饰器模式按类别改色
  "baguwen.categories.pattern": true,   // 装饰器模式逐类别开关
  "baguwen.categories.function": false
}
```

## 命令行工具

不想开 VS Code 也能扫，与扩展共用匹配内核（`src/core.js`）：

```bash
node cli.js <文件路径>            # 分类统计 + 每处命中的行号
node cli.js <文件路径> --all      # 连默认关闭的类别一起统计
node cli.js <文件路径> --json     # 输出 JSON
```

## 自检

```bash
npm install     # 只装测试用的 TextMate 引擎，扩展本身零依赖
npm test
```

六套测试共 **186 项断言**，外加三次清单审计：

| 套件 | 项数 | 覆盖 |
|---|---|---|
| `test/run.js` | 145 | 词表数据完整性、每条字面量能否命中、18 组关联词 + 55 条衍生句式、18 组母题至少两条变体的分态校验、类别归属、去重叠、20 万字性能 |
| `test/extension-smoke.js` | 28 | 打桩 vscode 后真实调用 `activate()`，验证原生/装饰器两条路径的装配 |
| `test/grammar.js` | 45 | **真实 TextMate + Oniguruma 引擎**：加载本机 VS Code 自带的 markdown 语法验证**注入**生效，把纯文本语法当**根语法**直接分词验证 `.txt` 路径，并守住"短词不得截断长句式"的回归 |
| `test/coverage.js` | — | 对照**原始世界书**逐条核对覆盖率：短条目未收录即失败；规则示例/元描述走 92 项显式跳过清单（每项带理由）。就是这个审计把 v1.3.0 那次整组漏收找出来的 |
| `test/user-terms.js` | — | 对照**用户点名词表**（332 条）逐条核对：世界书审计保证原文有的都收了，这里保证用户点名的都在 |
| `test/rule-coverage.js` | — | 对照**世界书规则**（197 条）逐条核对：每条规则是否至少有一个可识别的表面形式；跨句语义类的纯行为规则必须进显式清单并写明理由 |

`test/grammar.js` 会自己找本机 VS Code 的语法文件；找不到或没装依赖时会跳过并说明原因，不会误报失败。可用 `VSCODE_APP_ROOT` 环境变量指定安装位置。

`test/coverage.js` 需要原始世界书 JSON，默认在 `C:\Users\G\Downloads\b8939d30c90ee79e.json` 找；可用 `BAGUWEN_WORLDBOOK` 指定路径，找不到则跳过。

## 实现要点

**为什么用注入语法而不是直接写 TextMate 规则。** 八股高亮要作用于 markdown 这类**已存在**的语言，不能替换对方的语法。`injectTo` 就是把规则塞进目标语法的官方机制。写法照抄 VS Code 自带的 `markdown-math` 扩展：package.json 里声明 `injectTo`，语法文件内**不写** `injectionSelector`——这一点是读 `markdown-math` 的实际文件确认的，不是凭记忆。

**`.txt` 为什么走根语法而不是注入。** 注入的前提是目标语言**已经有语法**。plaintext 没有，所以无从注入。解决办法是给它补一个根语法：`contributes.grammars` 里用 `"language": "plaintext"` 声明，语法文件用独立的 scopeName。这样 `.txt` 由我们的语法直接分词，效果和注入一致。

**关联词怎么匹配。** 像"不是……而是……"这种中间可变长的成对结构，用正则把 `……` 展开成 `[^。！？\n]{0,n}?`（非贪婪、不跨句）。同一套正则源串同时供 TextMate 语法和装饰器引擎使用，两套引擎语义一致。

**长词优先要排两次。** 有两层顺序问题：

1. 一条 `match` 规则内部的择一分支（`(?:甲|乙|丙)`）按顺序试，所以短语要按长度降序排，否则"骨节分明的手指"会被"骨节"抢先匹配。
2. 更隐蔽的是**规则之间**的顺序。TextMate 在同一个起始位置有多条规则命中时，取"规则数组里靠前的那个"，**不做最长优先**。而 JS 正则（装饰器引擎）的 `exec` 是按位置扫描后再全局去重叠，两者语义不同。曾经因为字面量规则整体排在结构句式之前，短词「也许」抢走了「也许吧。但」的起始位置，导致这条句式在原生模式下永远匹配不上——装饰器模式却正常，属于只在一边复发的 bug。

修法是生成语法时按**最长可能匹配长度降序**排列所有规则。正则的长度用 `estimateMaxLength()` 估算，量词上界按 8 折算：像 `[^。]{0,40}` 这种大跨度通配若按 40 计权，会系统性压过精确字面量（例如把「喉结上下滚动」判给瞳孔指标句式而不是短语类别）。

**为什么不用 `setInjections`。** vscode-textmate 9.x 的 `Registry` 上没有这个方法（实测报 `not a function`），注入要么走宿主语法的 `injections` 字段，要么走 `getInjections` + 语法的 `injectionSelector`。交付走 VS Code 原生的 `injectTo`，测试里用前者做等价注入。

**匹配性能。** 装饰器模式的字面量匹配用 Aho–Corasick 自动机，20 万字约 186 ms（早期用数组 splice 去重叠时是 11.2 秒，改成位图后提升 60 倍）。原生模式的语法匹配由 VS Code 的 TextMate 引擎负责，400 行实测 172 ms。

## 词表来源与二次开发

- 数据集：`src/data/baguwen.js`（`CATEGORIES` / `PALETTES` / `LITERALS` / `PATTERNS` / `PUNCT_PATTERNS`）
- 改词表后**要重新生成语法**：`npm run build:grammar`（只收录默认开启类别），想连 `function` / `punct` 一起收录用 `node scripts/build-grammar.js --all`
- 加词：往对应类别的 `LITERALS` 数组加字符串
- 加句式：往 `PATTERNS` 加 `{ id, name, re }`，用 `P()` 建正则、`GAP(n)` 表示可变长间隔；想换归属类别就加 `categoryId`
- 改完跑 `npm test` 确认没破坏数据约束（短语不得含 `……`、`[`、`（）`，长度不得小于 2）

## 已知限制

- 匹配的是**词面**，不理解语义。"他忽然想起"也会被标出来，属于预期行为。
- 不做词形还原，只做精确字面匹配。
- 原生模式下长句式整段变色，内部短语不再单独上色（TextMate 一个位置只取一条规则；规则已按最长优先排序，所以拿到的是最长的那条）。想看内部细节可临时关掉 `pattern` 类别。
- token 颜色无法按主题自动切换，需要手动选一套配色。
- 环境与各版本差异不做语义判断，同一句里堆得多也不会额外提示。
- **未在真实 VS Code 窗口里做人工视觉验收**：语法注入、根语法分词与 scope 赋值都已用真实 TextMate 引擎验证（`test/grammar.js`），但"颜色在你的主题下好不好看""`.txt` 里实际渲染成什么样"仍需你自己看一眼。
- plaintext 语言原本没有语法，我们是**补上**一个；若你同时装了另一个也给 plaintext 贡献语法的扩展，两者会互相覆盖，只有一个生效。
- 此项目并不能检测出所有的“AI味”和“八股文”，LLM写作的核心问题永远是不懂设计让读者得到反馈的流程和内容不能很好的服务于剧情中心。如果你是利用LLM写作的作者，也没有必要改掉每一处高亮的节点，有相当部分正常使用的词汇也会被标记。

## 感谢名单

感谢 soduiz 提供的八股文世界书作为参考，项目使用了其中的词表并根据其添加了部分LLM可能会直出的八股词汇/句式。
