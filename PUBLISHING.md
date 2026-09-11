# 发布指南

本文件给出把 `八股词表高亮` 发布到 **GitHub** 和 **VS Code 扩展市场** 的完整步骤。

我在你的机器上做不了的只有两件事：**GitHub 推送**和**市场发布**——它们都需要你本人的账号凭据。下面每条命令都可以直接复制执行。

仓库里已经准备好的东西：

- `.gitignore`（排除 `node_modules/` 与 `*.vsix`）
- `LICENSE`（MIT，**版权人需替换**）
- `.github/workflows/publish.yml`（打 `v*` 标签自动发布到市场）
- `package.json` 里的 `repository` / `bugs` / `homepage`（已指向 GitHub 仓库）

---

## 〇、发布前必须替换的四处占位

| 位置 | 现在 | 改成 |
|---|---|---|
| `package.json` → `publisher` | `local` | 你在市场注册的 publisher ID |
| `package.json` → `repository.url` | `nodelusionnolife` | 已完成 |
| `package.json` → `bugs.url` | 同上 | 已完成 |
| `package.json` → `homepage` | 同上 | 已完成 |
| `LICENSE` 第 3 行 | `<请替换为你的名字或 ID>` | 你的名字或 ID |

⚠️ **`publisher` 一改，扩展 ID 就变了**（从 `local.baguwen-highlighter` 变成 `<你的ID>.baguwen-highlighter`）。你本机现在装的是旧 ID 那份，改完后建议先卸载再装：

```bash
code --uninstall-extension local.baguwen-highlighter
```

---

## 一、传到 GitHub

### 1. 建仓库

浏览器打开 https://github.com/new ，仓库名填 `baguwen-highlighter`，**不要**勾选 "Add a README / .gitignore / license"（本地已有）。建完拿到地址：

```
https://github.com/你的用户名/baguwen-highlighter.git
```

### 2. 本地初始化并推送

**仓库已经初始化好了**（`git init -b main` + 首次提交都已完成，工作区干净）。你只需要配身份、加远程地址、推送：

```bash
cd "C:/Users/G/.zcode/workspace/default/vscode-baguwen-highlighter"

# 1) 配上你自己的 git 身份（这台机器上还没配过）
git config --global user.name  "你的名字"
git config --global user.email "你的邮箱"

# 2) 把首次提交的作者改成你（我用的是占位身份 noreply@localhost）
git commit --amend --reset-author --no-edit

# 3) 加远程地址并推送
git remote add origin https://github.com/你的用户名/baguwen-highlighter.git
git push -u origin main
```

⚠️ **第 2 步别跳过**。我用 `baguwen-highlighter <noreply@localhost>` 这个占位身份做的首次提交，因为这台机器上没有你的 git 身份、我也不该替你编一个。在你自己的名字下改掉再推，公开历史里就不会留下占位作者。已经推上去了也没关系，`git commit --amend --reset-author` 之后 `git push --force-with-lease` 即可。

首次 `push` 会要求登录。推荐用 **GitHub CLI** 或 **Personal Access Token**，别用账号密码（已不支持）：

```bash
# 方式 A：装 gh 后登录（最省事，且能顺带建仓库）
winget install GitHub.cli
gh auth login          # 选 HTTPS → 浏览器登录
gh repo create baguwen-highlighter --public --source=. --push

# 方式 B：用 PAT
# 到 https://github.com/settings/tokens 建一个带 repo 权限的 token，然后
git remote set-url origin https://<你的用户名>:<PAT>@github.com/<你的用户名>/baguwen-highlighter.git
git push -u origin main
```

---

## 二、发布到 VS Code 扩展市场

### 1. 注册 publisher（一次性）

1. 用微软账号登录 https://marketplace.visualstudio.com/manage
2. 点 **Create publisher**，填一个 ID（例如 `yourname`），记下来
3. 把这个 ID 写进 `package.json` 的 `publisher` 字段

### 2. 建 Personal Access Token（PAT）

1. 打开 https://dev.azure.com → 右上角用户设置 → **Personal access tokens** → New Token
2. **Organization 选 "All accessible organizations"**（选错会导致发布报 401）
3. **Scopes 勾 Custom defined → 展开 Marketplace → 勾 Manage**
4. 建完**立刻复制**，页面关掉就看不到了

### 3. 发布

```bash
cd "C:/Users/G/.zcode/workspace/default/vscode-baguwen-highlighter"

# 先把 publisher 改成你注册的那个 ID，然后：
npx @vscode/vsce publish -p <你的PAT>

# 或者登录一次，后续免输
npx @vscode/vsce login <你的publisherID>
npx @vscode/vsce publish
```

发布成功后地址是：

```
https://marketplace.visualstudio.com/items?itemName=<你的publisherID>.baguwen-highlighter
```

### 4. 版本更新

`vsce publish` 按 `package.json` 的 `version` 走。改版本有三种方式：

```bash
npx @vscode/vsce publish patch   # 1.6.0 → 1.6.1
npx @vscode/vsce publish minor   # 1.6.0 → 1.7.0
npx @vscode/vsce publish major   # 1.6.0 → 2.0.0
```

市场**不允许重复版本号**，每次发布必须递增。

---

## 三、用 GitHub Actions 自动发布（可选）

仓库里已有 `.github/workflows/publish.yml`：推 `v*` 标签时自动跑测试并发布。

启用步骤：

1. 把 PAT 存进仓库 Secret：仓库页 → Settings → Secrets and variables → Actions → New repository secret
   - Name：`VSCE_PAT`
   - Value：上一步的 PAT
2. 打标签推送：

```bash
git tag v1.6.0
git push origin v1.6.0
```

之后 Actions 会自动：校验 `syntaxes/` 与词表数据一致 → 跑测试 → 发布。

> 工作流里的 `git diff --exit-code syntaxes/` 是一道防漂移检查：如果改了 `src/data/baguwen.js` 却忘了跑 `npm run build:grammar`，CI 会直接失败，避免把旧语法发出去。

---

## 四、常见报错对照

| 报错 | 原因 | 处理 |
|---|---|---|
| `ERROR The publisher name is not valid` | `publisher` 还是 `local` 或拼错 | 改成市场注册的 ID |
| `ERROR Access denied (401)` | PAT 的 Organization 没选 "All accessible organizations"，或没勾 Marketplace Manage | 重建 PAT |
| `ERROR Extension already exists` | 这个 ID 已被别人占用 | 换 publisher 或改扩展 `name` |
| `ERROR Missing repository field` | `package.json` 缺 `repository` | 已加，填上真实用户名即可 |
| `ERROR Version already exists` | 重复版本号 | 递增 version |
| 中文 README 在市场显示乱码 | 文件编码不是 UTF-8 | 确认用 UTF-8 保存 |

---

## 五、还没做、但建议做的

- **图标**：加一个 128×128 的 PNG，在 `package.json` 里写 `"icon": "icon.png"`。没有图标在市场列表里会比较素。
- **`.vscodeignore` 复核**：现在已经排除了 `test/`、`node_modules/`、`*.vsix`；`scripts/` 和 `sample/` 是有意保留的（前者可复现构建，后者是演示）。
- **隐私说明**：扩展是全离线的，不联网、不收集数据。若上架，建议在 README 里明确写一句，减少用户顾虑。

---

## 六、我这边已经验证过的部分

- `npx @vscode/vsce package` 能成功打包（1.6.0，约 79 KB，15 个文件）
- 六套测试 186 项断言 + 三次清单审计全绿
- `package.json` 结构合法，`repository` 字段已就位（只差替换用户名）
- 工作流里用到的 `npm ci` / `npm test` / `npm run build:grammar` 都本地验证过可跑

**没验证过的**：真实推送、真实发布、市场页面渲染效果。这些都需要你的账号，我无法代做。
