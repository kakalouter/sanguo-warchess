# 测试文档

记录本项目的自动化测试设施、实测过程与发现的缺陷。这些测试是开发期实际使用过的，不是事后补写。

---

## 1. 为什么需要这套测试

这个项目有两个特点让"改完直接看"变得很不可靠：

1. **大量数据是烘焙/生成的**，改一处常量会牵动几千个数值。例如改了高程压缩指数，地图颜色、3D 高度、战场地形分型会同时变化。
2. **主要表现是 WebGL 画面**，纯逻辑单测（Node 里跑）覆盖不到渲染管线。而渲染 bug 往往表现为"画面全黑"或"地形全是尖刺"，只能看才知道。

所以最终采用的是**在真实浏览器里驱动真实 `index.html`** 的端到端测试。

---

## 2. 测试设施（`_test/`）

| 文件 | 作用 |
|---|---|
| **`run.mjs`** | **一键回归运行器**。语法预检 → 起服务 → 找浏览器 → 逐页跑 → 汇总 → 退出码。见 §2.1 |
| `ui.html` | **最重要**。用 iframe 加载真实 `index.html`，走完 开局 → 内政 → 5 个弹窗 → 结束回合(含AI) → 出兵 → 进入战斗 → 结算 → 存档 全流程，并对 canvas 截图做像素统计 |
| `diag2.html` | 纯逻辑 + 引擎：数据完整性、邻接连通性、战场生成、**6 兵种 × 38 战法全推演**、25 场战斗节奏统计、存档往返一致性、两个渲染器的像素校验 |
| `geo.html` | 地形几何自检：顶点范围/NaN/相邻跳变、高程采样对照真实海拔、相机穿模、取景构图、贴图 vs 纯色 A/B 对照、多视角截图 |
| `bt.html` | 战场渲染专项（rAF、帧数、三角形计数、逐帧像素采样、场景构成、特效） |
| `filetest.html` / `filediag.html` | `file://` 场景排查（结论见 §5） |
| `_out/` | 运行产物（结果文本、截图、Chrome 日志），已 gitignore |

### 2.1 运行方式（推荐：一条命令）

```bash
node _test/run.mjs              # 全部 4 页，约 3 分钟
node _test/run.mjs diag         # 只跑指定页（diag / ui / geo / bt）
node _test/run.mjs --list       # 列出所有测试页
```

`_test/run.mjs` 会自己完成：语法预检 → 起 HTTP 服务 → 找浏览器 → 逐页跑 → 收集结果与截图 → 汇总 → 给出退出码。
**不需要手工起服务、不需要装依赖、不需要拼命令行参数。**

它会先做**语法预检**：用 `vm.Script` 把每个页面的内联脚本块与引用的 js 过一遍。
这一步是必要的——测试页的内联脚本一旦有语法错误（最常见是**同名变量声明两次**），
整段 IIFE 根本不会执行，页面既不报错也不回传，只能干等到超时。预检 1 秒内就能指出问题。

结果与截图落在 `_test/_out/`：
- `result_<页名>.txt` —— 该页的完整文本输出
- `shot_NN_<时间戳>.png` —— 各页保存的 canvas 截图（**必须人工过目**）
- `chrome_<页名>.log` —— Chrome 的 stderr，排查启动失败用

### 2.2 运行方式（手工，仅当需要单独调试某页时）

需要手工起 HTTP 服务的话（**注意路径必须 resolve 成绝对路径，见 §2.3 的坑**）：

```bash
# 1) 起服务（项目根目录执行）
node -e "
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=path.resolve('.'),OUT=path.resolve('../_diag_result.json');
const MIME={'.html':'text/html;charset=utf-8','.js':'application/javascript;charset=utf-8','.css':'text/css;charset=utf-8','.jpg':'image/jpeg','.png':'image/png'};
http.createServer((q,s)=>{
  if(q.method==='POST'&&q.url==='/result'){let b='';q.on('data',d=>b+=d);q.on('end',()=>{fs.writeFileSync(OUT,b);s.writeHead(200,{'Access-Control-Allow-Origin':'*'});s.end('ok')});return}
  if(q.method==='POST'&&q.url==='/shot'){let b='';q.on('data',d=>b+=d);q.on('end',()=>{const m=/^data:image\/(\w+);base64,(.*)$/s.exec(b);
    if(m)fs.writeFileSync('D:/test/_shot_'+Date.now()+'.'+m[1],Buffer.from(m[2],'base64'));s.writeHead(200,{'Access-Control-Allow-Origin':'*'});s.end('ok')});return}
  let p=decodeURIComponent(q.url.split('?')[0]); if(p==='/')p='/index.html';
  const f=path.resolve(ROOT,'.'+p);
  if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){s.writeHead(404);s.end('404');return}
  s.writeHead(200,{'Content-Type':MIME[path.extname(f).toLowerCase()]||'application/octet-stream'});
  fs.createReadStream(f).pipe(s);
}).listen(18742,'127.0.0.1',()=>console.log('http://127.0.0.1:18742/'));
"

# 2) 用 headless Chrome 打开测试页
#    注意 --dump-dom 会挂住不退出，用 --screenshot + 后台进程 + 超时更稳
chrome --headless=new --no-sandbox --disable-gpu --enable-unsafe-swiftshader \
  --user-data-dir=/tmp/cp --window-size=1600,1000 \
  http://127.0.0.1:18742/_test/ui.html

# 3) 结果由页面 POST 回 /result，服务写入 _diag_result.json
```

### 2.3 测试设施的四个必备设计

**① 看门狗（watchdog）**：主脚本可能因语法错误完全不执行（此时 `window.onerror` 都收不到），也可能中途卡死。所以每个页面顶部都注册：

```js
setTimeout(() => window.__postPartial('看门狗 80s 超时'),  80000);
setTimeout(() => window.__postPartial('看门狗 170s 超时'), 170000);
window.addEventListener('error', e => window.__postPartial('window.onerror: ' + e.message));
```

配合一个不断累积的 `window.__PARTIAL` 数组（`say()` 每写一行就 push），**任何情况下都能拿到已经跑过的部分结果**。

> 这不是过度设计。开发中至少三次撞上"整页静默无输出"，靠看门狗直接定位到
> `Identifier 'rounds' has already been declared`、`'rafCount' has already been declared` 这类语法错误——
> 否则会误判成"卡在渲染"。

**② 像素校验**：不看截图就无法发现"画布全黑"，所以每个渲染测试都做：

```js
function canvasStats(cv, w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d').drawImage(cv, 0, 0, w, h);
  const d = c.getContext('2d').getImageData(0, 0, w, h).data;
  let nonBlack = 0, sum = 0; const colors = new Set();
  for (let i = 0; i < d.length; i += 4) {
    const v = d[i] + d[i+1] + d[i+2]; sum += v;
    if (v > 30) nonBlack++;
    colors.add((d[i]>>4)+','+(d[i+1]>>4)+','+(d[i+2]>>4));
  }
  return { ratio: nonBlack/(w*h), bright: sum/(w*h*3), colors: colors.size, url: c.toDataURL() };
}
```

**三个判据**：非黑比例 > 50% 说明画了东西；色彩簇 > 20 说明不是纯色（真的渲染了地形/模型）；再加上人工看截图确认观感。

**③ 结果服务器要把路径规范成绝对路径**：`path.resolve(ROOT, '.' + urlPath)`。
早期版本用 `path.join(ROOT, urlPath)`，Windows 上 `path.join` 产出反斜杠而 `ROOT` 是正斜杠，
`startsWith(ROOT)` 恒为 false，**所有请求都 404**，症状是测试页一片空白。

**④ 测试页必须自己下结论**：`geo.html` 与 `bt.html` 早期只 `say()` 打印原始数据、不做断言，
于是运行器只能报"通过 0 项"——看起来正常，实则什么都没检查。
现在这四页都有统一的 `✔ / ✘ / !` 标记断言，运行器据此统计与判定退出码。

---

## 3. 测试环境的一个硬约束

**这台机器上 PowerShell 的 TLS 不可用**：`Invoke-WebRequest` 与 `curl.exe` 走代理时都在 schannel 层失败

```
schannel: AcquireCredentialsHandle failed: SEC_E_NO_CREDENTIALS (0x8009030E)
```

原因不是网络不通（代理隧道 `CONNECT` 能建立），而是沙箱不让当前进程访问加密凭证。

**后果**：所有网络抓取（three.js、DEM 瓦片、Natural Earth、头像素材）都必须用 **Node.js** 完成——Node 用自己的 TLS 栈，不走 schannel。项目里 `_source/fetch-tiles.js` 与开发期的所有下载脚本都是这个原因写成 Node 的。

**同理，headless Chrome 在受限沙箱下起不来**：mojo 的 `platform_channel` 需要命名管道，被沙箱拒绝，Chrome 直接 `FATAL` 自终止。跑浏览器测试需要放宽该限制。这也是为什么测试结论都记录在本文档里——换台机器复现时可能遇到同样的坑。

---

## 4. 实测发现并修复的缺陷

按严重程度排列。前三个都是**真实产品缺陷**，不是测试代码问题。

### 4.1 【严重】战场高程采样在特定时序下崩溃

**现象**：`diag2.html` 报
```
TypeError: M.sampleBattle is not a function
    at Object.buildBattlefield (js/battle.js:118)
```

**根因**：`SANGUO_MAP.sampleBattle` 原本只在 `BattleView.init()` 里被赋值。而 `Battle.buildBattlefield()` 可能在此之前被调用（诊断脚本、以及任何在进入战斗前需要预生成战场的路径）。

**修复**：拆出独立的 `js/slice.js`，在 `window.load` 时就把 `batPNG` 解码成 `Float32Array` 并同步暴露 `Slice.sample`；`main.js` 启动时 `await Slice.init()` 后把它挂到 `SANGUO_MAP.sampleBattle`。`battle.js` 里另加一层兜底（未就绪时返回 300 m 平地）避免顺序问题。

**这一条解释了为什么 `battle.js` 开头那段"多余"的兜底必须保留。**

### 4.2 【严重】战斗永远打不完

**现象**：自动化推演 **60 个半回合后 `winner = null`**，日志显示双方每回合各歼敌 90 人，兵力 9000 vs 9000 长期僵持。

**根因**：伤害用的是**比值模型** `dmg = power * M / defPower`。实测 `power ≈ 12147`、`defPower ≈ 29000`，比值仅 0.42，乘上系数后伤害只有约 170，而守方的兵力/士气恢复让双方谁也压不倒谁。

**修复**：改为**战力差模型** `dmg = clamp((power * 修正 - defPower * 0.8) * (0.24+rnd(0.12)), troops*0.02, 守方troops*0.34)`，并对反击单独定标（限制在攻方兵力的 1.2%~16%）。

**标定过程**（三轮实测）：

| 迭代 | 单次攻击伤害 | 平均回合 | 判定 |
|---|---|---|---|
| 初版 | 1~8% | 60+ 未决 | ✗ |
| v1 | 50.4% | 9.6 半回合 | 过快 |
| v2 | 27.6% | 15.3 半回合 | 可用 |
| **v3（当前）** | **29.8%** | **15.9 半回合（约 8 回合）** | ✓ |

**回归测试已固化**：`diag2.html` 会跑 25 场同配置战斗，断言「无一场超过 40 半回合未决」且「平均伤害落在 8%~32%」。改战斗数值后必须重跑。

### 4.3 【严重】相机穿进山体，画面出现"刀山"

**现象**：战略地图截图里出现大量竖直尖刺，近景尤其明显，看起来像地形数据损坏。

**排查过程**（值得记录，因为前两次判断都是错的）：

1. 先怀疑地形数据损坏 → 写了 `_hcheck.js` 逐像素校验内嵌 PNG：8 位值域 0~201、相邻像素 >1500 m 跳变仅 0.11%、最大跳变位于喜马拉雅（真实地理）→ **数据完全正确**。
2. 再怀疑是贴图问题 → 做了 A/B 对照（`geo.html` 把地形材质换成纯色再截图）→ **纯色下尖刺依旧**，确认是几何问题。
3. 加了几何自检探针（`window.__MAPDBG`）统计顶点高度范围/NaN/相邻跳变 → `minY 0.02 / maxY 46.15 / NaN 0 / 最大跳变 35.7 世界单位` → **几何也完全正常**。
4. 打印相机位置与其地面高度 → `camera y = 41.2`，而该处地形高 `39.8` → **相机几乎贴地**。加上近裁剪面 `0.5`，相机穿进了山体内部，看到的是被裁切开的网格内表面 —— 这才是尖刺的真相。

**修复**（两层）：
- 相机高度下限：`y = max(y, terrainHeightAt(相机经纬度) + 1.8)`；
- 高程非线性压缩 `h^0.78`（见 [`DEVELOPMENT.md` §3.4](DEVELOPMENT.md#34-高程的编码非线性压缩)），把青藏高原从 46 世界单位压到 19，从根本上降低"贴地飞行"的概率。

**顺带修掉的**：地图取景中心原本写死为洛阳，导致画面偏斜；改为地图几何中心 + 按视口宽高比与俯仰角加权的 `fitDistance()`。

### 4.4 【中】城池悬空 / 陷进山里

**根因**：战略网格只有 5.6 km 精度，而城池坐标是精确经纬度。在山区，一个网格单元的**平均**高程可能比城池实际位置高几百米。

**修复**：建地形网格时，落在城池 1.1° 半径内的顶点按 `t = 1 - d/1.1` 向该城中心高度插值压平。

### 4.5 【中】隐藏 canvas 以 0×0 初始化

**现象**：第一次进战斗时战场全黑。

**根因**：`#battleCanvas` 在非战斗时带 `hidden` 类，`clientWidth/clientHeight` 为 0，`renderer.setSize(0, 0)` 之后渲染器就废了。

**修复**：`init` 里做 0 尺寸兜底（用 `canvas.width || 960`）；`startBattle` 在移除 `hidden` 后等两帧 `requestAnimationFrame` 再 `BattleView.init()`；两个渲染器都加 `ResizeObserver`。

### 4.6 【中】`const` 函数在其定义前被调用（TDZ）

**现象**：`ReferenceError: Cannot access 'doResize' before initialization`，且整个 `newGame` 静默失败——界面停在开场页没有任何提示。

**根因**：`init()` 内先调用了 `doResize()`，而 `const doResize = () => {...}` 写在 `init()` 之后。

**修复**：把 `doResize` 提到 `init` 之前定义（`map3d.js` 与 `battle3d.js` 各一处）。

> 这类错误在浏览器里表现为"页面毫无反应"，很容易误判成"卡住了"。这也是看门狗机制的价值所在。

### 4.7 【轻】头像在子目录页面下加载失败

**根因**：`PortraitIndex.base` 是相对路径 `assets/portraits/`，用 `new URL(rel, document.baseURI)` 解析时，`document.baseURI` 可能是页面文件本身（`.../diag2.html`），于是向上退一级变成 `/_test/assets/portraits/`。

**修复**：以 `location.pathname` 的**目录**为基准（若不以 `/` 结尾则截到最后一个 `/`），拼成绝对 URL。这样无论页面在 `/` 还是 `/_test/` 下都指向同一份素材。

### 4.8 【轻】WebGL 截图全黑

**根因**：`preserveDrawingBuffer` 默认 `false`，WebGL 缓冲在合成后被清空，测试代码随后 `drawImage` 读到的是空缓冲。

**修复**：两个渲染器都开启 `preserveDrawingBuffer: true`。**这是为测试服务的**，正常游玩不需要，介意性能可以关掉（见 [`DEVELOPMENT.md` §5.3](DEVELOPMENT.md#53-性能备忘)）。

### 4.9 【轻】地图渲染尖刺（分辨率层面）

在修完 4.3 之后仍有轻微锯齿，来自 DEM 高频细节（网格 5.6 km vs DEM 1.1 km）。做了两项缓解：网格从 512×408 提到 **560×400**，并加 3×3 高斯平滑。效果：相邻顶点最大跳变从 **35.7 → 7.56 世界单位**，跳变点数量从 7199 → 143。

---

## 5. `file://` 场景的测试结论

用户最可能的用法是**双击 `index.html`**，所以专门验证过。结论分两部分：

### 5.1 已确认正常
- 开场界面完整渲染（印章、标题、17 张势力卡片、剧本描述）——直接截图确认过。
- 所有资源都是相对路径的本地文件（`css/`、`vendor/three.min.js`、`js/*.js`、`assets/portraits/*.jpg`），无 CDN 依赖。
- 内嵌地形数据是 `data:` URI。**规范上 `data:` URI 永不污染画布**，所以 `getImageData()` 在 `file://` 下同样可用（HTTP 下已实测通过）。`map3d.js` 的解码处仍有 `try/catch` 兜底，最坏情况会给出明确错误而不是静默失败。

### 5.2 未能自动化验证的部分
`file://` 下 iframe 的源是 `null`，父页面无法读取其 `contentWindow` 的属性，因此基于 iframe 的 `ui.html` 在 `file://` 下会全部报跨域错误。**这是测试手段的限制，不是游戏的问题。**

若要严格验证，请手工双击 `index.html` 确认以下 4 点：
1. 开场 17 张势力卡能正常显示；
2. 点击"曹操"能进入地图；
3. 点开任意城池，武将头像是否显示（若全部显示为程序化头像，说明本地图片被浏览器拦了，改用 HTTP 服务即可）；
4. 点"存档 → 导出为文件"能下载到 `.sgsav.json`。

---

## 6. 回归测试清单

改完代码后建议按此清单过一遍（顺序即为依赖顺序）：

| # | 项目 | 通过标准 |
|---|---|---|
| 1 | `node -e "new (require('vm').Script)(require('fs').readFileSync(F))" ` 全部脚本 | 无 SyntaxError |
| 2 | `index.html` 引用的资源都存在 | 无 MISSING |
| 3 | `diag2.html` §1–3 | 13 个核心对象就绪、城 id 唯一、guards 引用有效 |
| 4 | `diag2.html` §5 | 无孤立城池、全图连通、跨图寻路成功 |
| 5 | `diag2.html` §8 | 战场可通行比例 > 50% |
| 6 | `diag2.html` §9 | 6 兵种 × 38 战法全通过；**无一场战斗超时未决**；平均伤害 8%~32% |
| 7 | `diag2.html` §11–12 | 地图与战场非黑比例 > 90% |
| 8 | `diag2.html` §13 | 存档序列化前后数据完全一致 |
| 9 | `diag2.html` 汇总 | **全程无 JS 错误** |
| 10 | `ui.html` | 全流程走通（开局→内政→弹窗→回合→出兵→战斗→返回），**iframe 内无 JS 错误** |
| 11 | `geo.html` | 几何自检 maxJump < 15、无 NaN、多视角截图构图正常 |
| 12 | 人工 | 看一眼截图：地形是否可辨、城池是否落地、战斗画面是否能看懂 |

---

## 7. 已知未覆盖 / 未验证

诚实列出，避免误以为"测过了就没问题"：

1. **长时间运行的稳定性**：只跑到第 3 回合 AI 推演，没有跑过 100+ 回合的完整统一战争。
2. **真实 GPU 性能**：所有测试都在 SwiftShader（CPU 软件渲染）下跑，帧率数据没有参考价值。224k 顶点 + 2048² 阴影贴图在集显上的实际表现未测。
3. **多分辨率 / 移动端**：只测了 1138×846 与 430×846（竖屏）两种视口。手机浏览器、触屏操作完全未测。
4. **`file://` 手工四项**：见 §5.2，需要人点。
5. **AI 强度体感**：只验证了"AI 会行动、不崩"，没有验证"AI 打起来有没有意思"。
6. **存档跨版本**：只测了同版本往返，没有测旧存档读入新版本（`version` 不等会明确报错，但没实际演练过升级路径）。
7. **浏览器兼容性**：只在 Chrome 上测过。Firefox / Safari 未测（代码里用了 `ResizeObserver`、`WebGL2`、`clamp()` 等较新特性，现代版本应该都支持，但没验证）。
