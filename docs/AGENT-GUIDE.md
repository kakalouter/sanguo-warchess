# 交接说明（写给下一个 AI agent / 新接手的开发者）

这份文档回答四个问题：**这是什么**、**怎么跑起来**、**怎么验证我的改动**、**绝对不能碰什么**。

先读这份，再读 [`DEVELOPMENT.md`](DEVELOPMENT.md)。数值相关看 [`DESIGN.md`](DESIGN.md)，测试细节看 [`TESTING.md`](TESTING.md)。

---

## 0. 一分钟状态

| 项 | 状态 |
|---|---|
| 可玩性 | ✅ 完整可玩。开局 → 内政 → 出兵 → 战棋战斗 → 夺城 → 统一，全链路打通 |
| 自动化测试 | ✅ `node _test/run.mjs` 一条命令，4 个页面 / 101 项断言 / 全通过 / 约 3 分钟 |
| 已知缺陷 | 无阻断性缺陷。已知限制见 [`OPEN-QUESTIONS.md`](OPEN-QUESTIONS.md) C/D 组 |
| 未完成 | 音效、战斗动画补间、移动端适配、更多剧本。见 `OPEN-QUESTIONS.md` B5/B3 |
| 仓库 | <https://github.com/kakalouter/sanguo-warchess>（分支 `main`） |

**没有构建步骤。** 不要引入 webpack/vite/TypeScript——`file://` 双击即玩是硬需求。

---

## 1. 怎么跑起来

```bash
# 玩：直接双击 index.html，或
python -m http.server 8000   # 然后访问 http://localhost:8000/

# 验证：一条命令跑完全部回归测试
node _test/run.mjs           # 全部
node _test/run.mjs diag      # 只跑某一页（diag / ui / geo / bt）
node _test/run.mjs --list    # 看有哪些页
```

**跑测试前不需要手工启服务器、不需要装依赖。** `run.mjs` 会自己起 HTTP 服务、自己找浏览器、自己收集结果、自己汇总。

唯一依赖：Node 18+ 与本机已装的 Chrome 或 Edge（也认环境变量 `CHROME_PATH`）。

---

## 2. 怎么验证你的改动（最重要的一节）

### 2.1 标准流程

```
改代码 → node _test/run.mjs → 看汇总 → 人工看 _test/_out/shot_*.png → 提交
```

`run.mjs` 会先做**语法预检**（用 `vm.Script` 把每个内联脚本块与引用的 js 过一遍）。
这一步很重要：测试页的内联脚本一旦有语法错误（**最常见的是同名变量声明两次**），
整段 IIFE 根本不会执行，页面既不报错也不回传，只能干等到超时。
预检能在 1 秒内指出问题，别跳过它。

### 2.2 改不同部分该跑什么

| 你改了什么 | 至少跑 | 重点看 |
|---|---|---|
| `battle.js` 战斗/兵种/战法 | `diag` | §9 战斗推演：**无一场超时未决**、平均伤害 8%~32%、6 兵种 × 38 战法全通过 |
| `core.js` 内政/经济/军事/AI | `diag` + `ui` | §6 内政军事、§7 AI 推演、`ui` 的回合推进与资源变化 |
| `map3d.js` 地图渲染 | `geo` + `ui` | §1 几何自检（maxJump < 15、无 NaN）、§2 高程采样、§5 相机不穿模 |
| `battle3d.js` 战场渲染 | `bt` + `ui` | frames/renders 在推进、非黑 > 90%、色彩簇 > 20、三角形 500~50000 |
| `_source/bake.js` 地形烘焙 | 重跑 bake 后跑 `geo` | §1 几何、§2 高程区间、§3 多视角非黑比例 |
| `portraits.js` / `assets/` | `ui` + `diag` | §10 头像：**真实素材加载成功**而不是回退 |
| `index.html` 脚本顺序 | 全部 | 任何一页报"核心对象缺失"就是加载顺序错了 |
| `main.js` 界面 | `ui` | 17 张势力卡、5 个弹窗、战斗进入与返回 |

### 2.3 测试的边界（别过度信任）

- 所有测试跑在 **SwiftShader（CPU 软件渲染）** 下，**帧率数据没有参考价值**。
- 像素统计只能证明"画出了东西"，**证明不了"画得对"**。截图必须人工过目——尤其地形是否可辨、城池是否落地、战斗画面是否看得懂。
- 未覆盖：长局稳定性（只跑到第 3 回合）、真机 GPU 性能、移动端、Firefox/Safari、`file://` 手工四项（见 `TESTING.md` §5.2）。

### 2.4 无法运行测试时的降级方案

如果 Chrome 起不来（沙箱拒绝命名管道会让它 `FATAL` 自终止），你至少能：

```bash
# 纯逻辑检查（不需要浏览器）
node -e "
const fs=require('fs'),vm=require('vm');
for (const f of fs.readdirSync('js').filter(x=>x.endsWith('.js'))) {
  try { new vm.Script(fs.readFileSync('js/'+f,'utf8')); console.log('OK  '+f); }
  catch(e){ console.log('FAIL '+f+': '+e.message); }
}"
```

再用 `node` 加载 `data_*.js`（它们是 `window.X = {...}` 形式，用一个假的 `window` 即可）做数据层验证。**但这覆盖不到渲染，改渲染代码时务必想办法真跑一次。**

---

## 3. 必须遵守的硬约束（踩过坑，别重犯）

### 3.1 `index.html` 的脚本顺序不能动

```
three.min.js → mapdata.js → data_*.js → portrait.js → portraits.js
→ core.js → slice.js → battle.js → save.js → map3d.js → battle3d.js → main.js
```

`core.js` 必须在 `slice.js`/`battle.js` 之前（后者引用 `GameCore`）；`main.js` 必须最后。
`run.mjs` 的语法预检**不检查执行顺序**，顺序错了只会在浏览器里表现为"某对象 undefined"。

### 3.2 不要删除"看起来多余"的防御性代码

| 位置 | 看着多余的原因 | 实际作用 |
|---|---|---|
| `battle.js` 开头 `M.sampleBattle` 兜底 | 正常流程里 `main.js` 一定会先挂上它 | 但 `buildBattlefield()` 可能在任何初始化之前被调用（诊断脚本、预生成战场），缺了会 **TypeError 崩溃** |
| `map3d.js` `loadHeightGrid` 里的 `try/catch` | data URI 正常不会污染画布 | `file://` 下画布安全策略因浏览器而异，兜底能给出可读错误而不是静默失败 |
| `map3d.js` / `battle3d.js` 的 0 尺寸兜底 | 正常布局下 canvas 一定有尺寸 | **隐藏的 canvas `clientWidth` 为 0**，`setSize(0,0)` 会让渲染器彻底失效 |
| `preserveDrawingBuffer: true` | 游玩时不需要，还费性能 | 关闭它，所有读像素的自动化测试会全黑（WebGL 缓冲合成后被清空） |
| `portraits.js` 的 `SELF` / 路径回退 | 正式入口在根目录，路径本来是对的 | 诊断页在 `/_test/` 下时，相对路径会解析成 `/_test/assets/...` |

### 3.3 不要手改生成的文件

`js/mapdata.js`、`js/data_generals.js`、`js/data_portraits.js` 都是生成的（文件头有注明），
下次生成会被覆盖。要改就改 `_source/` 里的脚本或源数据：

```bash
node _source/bake.js        # 地形
node _source/roster.js      # 武将名册（势力归属在脚本里的 ROSTER 常量）
node _source/manifest.js    # 头像索引
```

### 3.4 坐标系不要想当然

三种坐标并存：**经纬度**（真值）/ **网格像素**（r=0 在北）/ **世界单位**（1 单位 = 1 经度，等比，北为 −Z）。
换算与高程的非线性压缩（`h^0.78`）见 [`DEVELOPMENT.md` §3](DEVELOPMENT.md#3-世界坐标系关键约定)。**改地图前必读。**

### 3.5 地形数据是 `data:` URI，不是文件

`mapdata.js` 把三张 PNG 以 base64 内嵌。这是刻意的：避免 `file://` 下 `getImageData()` 被安全策略拦、少 3 个 HTTP 请求。
代价是 base64 膨胀 33%，2.4 MB 可接受。**不要"优化"成相对路径引用的 png 文件。**

---

## 4. 环境相关的坑（本机特有，换机器可能不复现）

### 4.1 网络：PowerShell 的 TLS 不可用，必须用 Node

```
schannel: AcquireCredentialsHandle failed: SEC_E_NO_CREDENTIALS (0x8009030e)
```

`Invoke-WebRequest` 与 `curl.exe` 都会撞这个。**所有网络抓取用 Node.js**（`https` 模块或 `fetch`），它不走 schannel。
`_source/fetch-tiles.js` 就是这么写的。

### 4.2 GitHub：直连被重置，必须走本地代理

git 直连 `github.com` 报 `Recv failure: Connection was reset`。已在本仓库配置代理（**不是全局配置**）：

```bash
git config http.proxy  http://127.0.0.1:7897
git config https.proxy http://127.0.0.1:7897
git config user.name   kakalouter
git config user.email  kakalouter@gmail.com
```

`127.0.0.1:7897` 是本机代理端口（来自 `HKCU\...\Internet Settings`）。**换机器要改。**
若代理不可用，`git push` 会一直卡在连接上。

### 4.3 沙箱：Chrome 需要放宽权限才能启动

受限沙箱下 Chrome 的 mojo `platform_channel` 打不开命名管道，直接 `FATAL` 自终止：

```
FATAL:mojo\public\cpp\platform_platform_channel.cc:108] Check failed: . : 拒绝访问。(0x5)
```

跑 `run.mjs` 前需要放宽该限制。同理，`run.mjs` 里给子进程传 stderr 用的是**文件描述符而不是管道**——
沙箱禁止匿名管道时，用 `pipe` 会让 Chrome 直接 `EPERM` 起不来。

### 4.4 离线素材在仓库外

`_source/` 的脚本需要 Natural Earth 原始数据与 DEM 瓦片缓存，它们在**同级目录**：

```
D:\test\
├── sanguo-warchess\          ← 仓库（git 根）
└── sanguo-warchess-build\    ← 离线素材 19.8 MB（不进 git）
    ├── ne\                   Natural Earth + 三国志11 原始 JSON
    ├── dem_cache\            99 张 z6 DEM 瓦片
    └── *.zip                 四个 shapefile 包
```

`dem_cache` 可由 `node _source/fetch-tiles.js` 重建（需联网）；Natural Earth 数据需从官网重下。
**`js/mapdata.js` 已提交，所以缺这些不影响游玩，只影响"重新烘焙地形"。**

---

## 5. 改数值的入口速查

| 想调什么 | 改哪里 | 注意 |
|---|---|---|
| 战斗节奏（快/慢） | `battle.js` `calcAttack` 的 `0.24 + Math.random()*0.12` | 改完**必须**跑 `diag` §9，看平均伤害是否仍在 8%~32%、是否无超时未决 |
| 兵种克制强度 | `battle.js` 的 `counter = 1.32 / 0.78` | |
| 地形防御加成 | `battle.js` `TERRAIN` 各条的 `def` | 城郭 45、山地 30、森林 18 |
| 战法威力 | `battle.js` `SPECIALS` 表 | 上限目前是吕布 2.35 |
| 城池邻接密度 | `core.js` `ADJ_RADIUS`（2.5）/ `ADJ_KNN`（3） | 改完看 `diag` §5 的"平均相邻"，目标 6~9 |
| 经济与征兵 | `core.js` `CONST` 与 `cityIncome` / `cityHarvest` / `Actions.recruit` | |
| 在野武将数量 | `_source/roster.js` 的 `REST_SIZE`（130）+ 重跑 | `core.js` 里还有"每城 ≤14"的分派逻辑 |
| 地图范围/精度/配色 | `_source/bake.js` 头部常量 + `HYPSO` 配色表 | 改范围要同步检查 `data_sites.js` 里的城池是否都还在范围内 |
| 地图高度观感 | `_source/bake.js` 的 `HP`（0.78）；`map3d.js` 的 `HSCALE` / `EXAG` | 三者要一起看，见 `DEVELOPMENT.md` §3.4 |
| 默认视角 | `map3d.js` `frameMap()` / `fitDistance()` | 参考俯仰角写死 0.95 rad，别改成读 `cam.phi`（会自我递归） |

**通用原则**：改数值后跑一遍 `run.mjs`，并**人工看截图**。数值 bug 往往不崩不报错，只体现在"打不完"或"画面不对"。

---

## 6. 建议的下一次迭代

按"用户价值 ÷ 成本"排序，前两项是用户明确会感知到的：

1. **战斗过程动画**（`battle3d.js`）：目前 AI 回合是逐个瞬间结算 + 420 ms 间隔，没有移动补间与攻击前摇。"华丽"的主要缺口就在这。做法：把"逻辑立即结算"改成"逻辑结算 + 表现队列"。
2. **AI 主动宣战**：现在交战关系只在开局按邻接初始化，孤立势力永远不会来打你，后期清剿枯燥（见 `OPEN-QUESTIONS.md` D2）。
3. **更多剧本**：`data_factions.js` 的 `SANGUO_SCENARIO_189` 结构可直接复制出 200 官渡、208 赤壁。
4. **计略 / 单挑**：战法系统已具备，加目标选择与状态效果即可。

用户尚未回答的设计选项（青藏高原比重、战斗节奏偏好、后续玩法优先级）都在 [`OPEN-QUESTIONS.md`](OPEN-QUESTIONS.md) B 组，**动这些之前先确认**。

---

## 7. 提交约定

- 用户信息已配好（`kakalouter <kakalouter@gmail.com>`，**仓库级**，不是全局）。
- 提交信息用中文，说明**改了什么 + 为什么**；数值改动请附上改动前后的实测数据（这是本仓库的既有风格，见 `docs/CHANGELOG.md`）。
- `.gitattributes` 已把生成产物标记为 `-diff`、`three.min.js` 标记为 vendored，避免 diff 抖动与语言统计被带偏。**新增生成文件时记得同步。**
- 推送前确认代理配置还在：`git config http.proxy`。若为空，`git push` 会卡住。

```bash
git add -A
git commit -m "说明改了什么以及为什么"
git push
```
