# 开发文档

面向后续开发与维护。玩法数值见 [`DESIGN.md`](DESIGN.md)，测试见 [`TESTING.md`](TESTING.md)。

---

## 1. 技术栈与约束

| 项 | 选择 | 原因 |
|---|---|---|
| 渲染 | **three.js r160**，本地 `vendor/three.min.js`（UMD 版） | 用户要求"单个 HTML + 本地 three.js 文件"，走 UMD 全局 `THREE` 以避免打包器与 ES Module 的路径问题 |
| 语言 | 原生 ES5/ES2017 JavaScript，无 TypeScript、无打包器 | 双击 `file://` 即可运行是硬需求，构建产物会破坏这一点 |
| 模块方式 | 每个文件一个 IIFE，挂到 `window.*` 全局命名空间 | 无 `import`，因此不受 `file://` 的模块 CORS 限制 |
| 中文字体 | 系统字体栈（`Songti SC` / `SimSun` / `Noto Serif CJK SC`） | 不引入外部字体文件，保持离线可用 |
| 存档 | `localStorage` + `Blob` 下载 `.sgsav.json` | 满足"可保存到文件下载" |

**不要引入的东西**：任何需要 `fetch()` 跨目录加载的 ES Module、任何需要构建步骤的语法（JSX/TS）、任何 CDN 依赖。

---

## 2. 目录结构

```
sanguo-warchess/
├── index.html               132 行   入口：DOM 骨架 + 按顺序引入所有脚本
├── README.md                         面向玩家的说明
├── docs/                             本目录
├── css/style.css            199 行   全部样式（绢本设色主题）
├── vendor/three.min.js               three.js r160
├── js/
│   ├── ══ 数据层（可重新生成） ══
│   ├── mapdata.js           2.4 MB   【烘焙产物】地形高程/战场切片/晕渲贴图，base64 内嵌
│   ├── data_sites.js        111 行   89 座城池关隘（真实经纬度 + 剧本归属说明）
│   ├── data_factions.js      82 行   21 个势力定义 + 189 年剧本 + 可玩势力列表
│   ├── data_generals.js     150 KB   【生成】205 名名册武将 + 130 名在野池
│   ├── data_portraits.js     24 KB   【生成】838 名武将 → 头像文件名映射
│   ├── ══ 逻辑层 ══
│   ├── core.js              646 行   游戏状态、内政/军事/后勤、外交、回合流程、AI
│   ├── slice.js              52 行   战场高程切片解码（启动时同步就绪）
│   ├── battle.js            535 行   战棋规则：兵种/地形/战法/伤害计算/战斗 AI
│   ├── save.js               98 行   存档序列化与文件导入导出
│   ├── ══ 表现层 ══
│   ├── portrait.js          647 行   程序化头像生成（真实头像缺失时的兜底）
│   ├── portraits.js         103 行   头像加载、异体字归一、回退调度
│   ├── map3d.js             690 行   战略地图 3D：地形网格、城池、道路、边界、相机
│   ├── battle3d.js          578 行   战场 3D：地形切片、部队牌、特效
│   └── main.js             1107 行   主控制器：游戏流程、界面、战斗衔接
├── assets/portraits/        46 MB    1052 张头像（1050 张 240×240）
├── _test/                            开发期自动化测试页
└── _source/                 37 KB    构建脚本（bake / roster / manifest / shp / fetch-tiles）

# 仓库外的离线素材（同级目录，不进 git）
../sanguo-warchess-build/
├── ne/                      2.1 MB   Natural Earth 原始数据 + 三国志11 原始 JSON
├── dem_cache/               7.3 MB   99 张 z6 DEM 瓦片缓存
└── *.zip                    10.6 MB  Natural Earth 四个 shapefile 包
```

**脚本加载顺序在 `index.html` 里是有依赖的**，不要随意调整：

```
three.min.js → mapdata.js → data_*.js → portrait.js → portraits.js
→ core.js → slice.js → battle.js → save.js → map3d.js → battle3d.js → main.js
```

`core.js` 必须在 `slice.js`/`battle.js` 之前（后者引用 `GameCore`），`main.js` 必须最后（它在 `window.load` 时装配一切）。

---

## 3. 世界坐标系（关键约定）

项目里有**三套坐标**，改地图相关代码前必须搞清楚。

### 3.1 经纬度（lon / lat）
唯一的地面真值。`data_sites.js` 里每座城、`mapdata.js` 的边界都用它。
范围：**经度 73.125°E ~ 135.000°E，纬度 16.636°N ~ 55.777°N**。

这个范围不是随便定的：它**严格对齐 z6 墨卡托瓦片的边界**（瓦片 `45..55 / 20..28`，共 99 张）。这样 DEM 像素与网格像素可以整数对齐，无需重采样。

### 3.2 网格坐标（c / r）
DEM 与网格的像素索引，**r=0 在北**（行随纬度减小而增大）。

```js
// 经纬度 → DEM 像素（mapdata.js 烘焙时用的映射）
col = (lon - lonMin) / (lonMax - lonMin) * DEM_W      // DEM_W = 2816
row = (latMax - lat) / (latMax - latMin) * DEM_H      // DEM_H = 2304
```

三套分辨率并存（都在 `mapdata.js` 头部声明）：

| 用途 | 常量 | 尺寸 | 每格实际距离 |
|---|---|---|---|
| 战略地形网格 | `gridW × gridH` | 560 × 400 | 约 5.6 km |
| 战场高程切片 | `batW × batH` | 1024 × 832 | 约 3.1 km |
| 地图贴图 | `texW × texH` | 1120 × 800 | 约 2.8 km |
| （源 DEM，不内嵌） | `DEM_W × DEM_H` | 2816 × 2304 | 约 1.1 km |

### 3.3 世界单位（x / y / z）
three.js 场景坐标。**1 世界单位 = 1 经度**（等比，不做墨卡托投影拉伸，否则中国会被拉长）。

```js
// map3d.js
const DEG2W  = 1.0;
const HSCALE = 0.0036;   // 压缩后的"米" → 世界单位
const EXAG   = 1.0;      // 视觉夸张已在烘焙阶段完成
worldX(lon) = (lon - (lonMin + lonMax) / 2) * DEG2W
worldZ(lat) = -(lat - (latMin + latMax) / 2) * DEG2W   // 注意负号：北为 -Z
height      = 解码高程(米) * HSCALE
```

地图世界尺寸约 **62 × 39**，最高点（珠峰）约 **19** 世界单位高。

### 3.4 高程的编码：非线性压缩
这是本项目一个容易踩坑的设计点。

**问题**：青藏高原平均 4500 m、珠峰 8849 m，而东部平原 0~200 m。若按真实比例线性映射到世界坐标，高原会变成一堵墙，把整个东部低地压成一条线；若为了容纳高原而整体缩小，平原就完全没有起伏了。

**方案**：烘焙时对高程做幂函数压缩并存成 8 位灰度，游戏内再解码：

```js
// _source/bake.js（烘焙侧）
const H_MAX = 8850, HP = 0.78;
h2b = h => round(255 * (max(0,h) / H_MAX) ** HP)      // 米 → 字节
// 游戏侧解码（map3d.js / slice.js）
height = H_MAX * (byte / 255) ** (1 / HP)             // 字节 → "压缩后的米"
```

效果：0 m → 0，500 m → 400，3600 m（拉萨）→ 约 1800，8849 m → 5566。低地细节几乎无损，高原被压到不再喧宾夺主。

**地图配色的海拔分段也用同一个压缩值**（`vAlt()`），保证**地图颜色与立体高度完全一致**——这是原参考项目 alt-color-stop 配色能直接套用的前提。改配色时要注意：`hypso()` 的入参是压缩后的海拔，不是真实米数。

---

## 4. 地形烘焙管线

脚本：`_source/bake.js`（357 行，自包含，依赖 `_source/shp.js`）。
运行：`node _source/bake.js`，输出 `js/mapdata.js`。

### 4.1 流程

```
[1] 下载 99 张 DEM 瓦片 (AWS Terrain Tiles, Terrarium 编码, z6 45..55/20..28)
     └ 带 4 次重试 + 本地缓存 _source/dem_cache/t_X_Y.png
[2] 解码 Terrarium: h = R*256 + G + B/256 - 32768（米）
     └ 拼成 2816×2304 的完整高程场
[3] 海陆判定：DEM 高程 <= 0 即为海（比 Natural Earth 海岸线精细得多）
[4] 栅格化 Natural Earth 10m 水系
     ├ 湖泊（210 个）：按 scalerank 从小到大填多边形
     └ 河流（239 条）：按 scalerank 决定线宽（1.4~7.0 px），
        遇海面自动断段，遇湖面不刻槽
[5] 沿河道下切：河心像素取 3×3 邻域均值 - 18 m，形成真实河谷
[6] 湖面压平、海面压到 -80 m 以内（负值即水下）
[7] 晕渲着色（在 DEM 原生 2816×2304 分辨率上做，再降采样）
     ├ 光源方位角 315°（西北向）、高度角 40°
     ├ 逐像素算 dz/dx, dz/dy → 法线 → 光照明暗
     └ 坡度越陡越暗（slope * 0.15 衰减），强化沟壑感
[8] 降采样到三套目标分辨率 + 3×3 高斯平滑（抑制 DEM 高频锯齿）
[9] 编码 PNG（自写编码器，zlib deflate level 9）→ base64 内嵌
```

### 4.2 为什么自己写 PNG 编解码器
`bake.js` 里的 `encodePNG` / `decodePNG` 是手写的（约 120 行，含 CRC32 与全部 5 种行过滤器的逆运算）。原因：不想引入 `pngjs`/`sharp` 这类依赖，且只需要 8 位灰度/RGB 这一小撮能力。游戏侧不需要解码器——浏览器 `Image` 直接吃 data URI。

### 4.3 输出格式（`window.SANGUO_MAP`）

```js
{
  lonMin, lonMax, latMin, latMax,          // 地理边界
  gridW:560, gridH:400,                    // 战略网格
  batW:1024, batH:832,                     // 战场切片
  texW:1120, texH:800,                     // 贴图
  hMax:8850, hExp:0.78,                    // 解码参数
  gridPNG: "data:image/png;base64,...",    // 110 KB
  batPNG:  "data:image/png;base64,...",    // 376 KB
  texPNG:  "data:image/png;base64,...",    // 1349 KB
}
```

**为什么用 data URI 而不是相对路径的 PNG 文件**：
1. `file://` 下 `<img src="assets/x.png">` 画到 canvas 后 `getImageData()` 有被安全策略拦截的风险，`data:` URI 则规范上永不污染画布；
2. 少 3 个 HTTP 请求、少 3 个可能 404 的文件；
3. 代价是 base64 膨胀 33%，2.4 MB 可接受。

### 4.4 重建与调参

改地图范围/精度时，`bake.js` 头部这几个常量是入口：

```js
const TZ = 6, TX0 = 45, TX1 = 55, TY0 = 20, TY1 = 28;   // 瓦片范围（决定地理边界）
const GRID_W = 560, GRID_H = 400;      // 战略网格
const BAT_W = 1024, BAT_H = 832;       // 战场切片
const TEX_W = 1120, TEX_H = 800;       // 贴图
const HP = 0.78;                       // 高程压缩指数
```

> ⚠️ **改 `GRID_H` 会牵动性能与观感**：`GRID_W × GRID_H` 就是顶点数（560×400 = 224k），乘 2 就是三角形数。超过约 40 万顶点后软件渲染（headless 测试环境）会明显变慢。
>
> ⚠️ **改 `TX0..TY1` 必须同步改 `HP` 之外的东西**：`mapdata.js` 里的 `lonMin/latMin` 等会自动重算，但 `data_sites.js` 里超出新范围的城池会落到地图外（`terrainHeightAt` 会返回 0，城池会贴在海平面上）。

---

## 5. 渲染管线

### 5.1 战略地图（`map3d.js`）

**地形网格**：`PlaneGeometry` 手写版——逐顶点算 `(worldX, height, worldZ)`，`Uint32Array` 索引，`BufferGeometry` + `MeshStandardMaterial({ map: 贴图 })`。**不写顶点色**，因为颜色信息已全部烘进贴图（含晕渲），这样能省掉 224k×3 个浮点。

**城池压平**：建网格时，每个顶点若落在某城池 1.1° 半径内，高度按 `t = 1 - d/1.1` 向该城中心高度插值。**没有这一步，城池会悬在陡坡上方或陷进山里**——因为网格只有 5.6 km 精度，而城池坐标是精确的。

**相机**：球坐标（`theta` 方位 / `phi` 俯仰 / `dist` 距离）+ 目标点。两个必须注意的约束：

```js
// 1) 相机不能低于地形，否则会穿进山体内部看到被裁切的面片
const minY = terrainHeightAt(相机所在经纬度) + 1.8;
// 2) 取景距离按视口宽高比 + 俯仰角加权（frameMap / fitDistance）
```

`fitDistance()` 同时算"正对地图"与"俯视地图"两个基准距离，按 `sin(参考俯仰角)` 加权。参考角写死为 0.95 rad 而不是读 `cam.phi`，否则 `frameMap()` 会自我递归、结果不稳定。

**城池模型**：程序化拼装（城墙 Box + 垛口 + 主楼 + 四角攒尖顶 + 旗杆 + 势力色旗帜 + 一级城光环）。按相机距离自适应缩放（`clamp(8.5 / dist, 0.42, 1.25)`），远景收成图标、近景显出细节。

### 5.2 战场（`battle3d.js`）

**地形**：34×24 格，每格从 `batPNG` 取 2×2 采样求高程后映射到 `reliefGain = 5.2` 世界单位；地形**类型**（平原/丘陵/森林/山地/峻岭/水面/浅滩/城郭/道路）由**相对高差**在战场窗口内的分位数决定，不是固定阈值——这样在成都平原和青藏高原上打，战场都能有合理的山丘比例。

**部队表现**：每支部队是一个 `Group`，含势力色底座圆盘 + 兵种图标牌（程序化 Canvas 绘制）+ **武将头像牌**（取自真实素材）+ 兵力条 + 士气条 + 旗帜。头像牌等 billboard 部分每帧 `quaternion.copy(camera.quaternion)` 面向相机。

**特效**：`spawnFx(type, x, y)` 支持 `slash`（斩击竖条）、`fire`（火球上抛）、`impact`（冲击环 + 溅射）、`banner`（旗帜飘落），均为程序化 Mesh + `userData.fx` 生命周期，在 `updateFx()` 里统一推进与回收。

**高亮**：移动范围（蓝）/ 可攻击位置（红）用平铺半透明 `PlaneGeometry` 实现，`groundY()` 保证贴合地形起伏。

### 5.3 性能备忘

- 阴影贴图 2048²，正交相机范围 `d = 70`（战略）/ `34`（战场）——调大会明显掉帧。
- `renderer` 开启了 `preserveDrawingBuffer: true`。**这是为自动化测试截图服务的**，正常游玩并不需要；如果你的显卡吃力，可以在 `map3d.js` / `battle3d.js` 的 `WebGLRenderer` 构造处关掉。
- 两个渲染器是独立 WebGL 上下文（两个 canvas）。战场 canvas 在非战斗时 `hidden`。**注意：隐藏的 canvas `clientWidth` 为 0**，因此 `init` 里做了 0 尺寸兜底，并在 `startBattle` 里等两帧 `requestAnimationFrame` 后再初始化。

---

## 6. 模块 API 速查

### `GameCore`（core.js）
```js
GameCore.S                       // 全局状态（setter 可替换，读档时用）
GameCore.newState(playerFid, scene)   // 建新局，返回 state
GameCore.buildAdjacency()        // 构建城池邻接图（半径 2.5° + kNN 保底）
GameCore.initWars()              // 按邻接初始化交战关系
GameCore.factionCities(fid) / factionGenerals(fid) / generalsIn(cityId)
GameCore.cityIncome(c) / cityHarvest(c) / cityPower(c) / armyPower(a)
GameCore.Actions.*               // develop / patrol / recruit / train /
                                 // transport / transferGeneral / recruitGeneral
GameCore.formArmy(fid, cityId, generalIds, troops, target)
GameCore.marchArmy(army, destCityId) / stepArmy(army)
GameCore.beginTurn() / endTurn() / factionTick(fid) / aiFaction(fid)
GameCore.atWar(a,b) / setWar(a,b,on) / setTruce(a,b,months) / warKey(a,b)
GameCore.findPath(from, to, opts)     // BFS，opts.blocked 可指定禁行集合
GameCore.addLog(text, kind)
```

### `Battle`（battle.js）
```js
Battle.TROOPS / TERRAIN / SPECIALS / APT
Battle.generalSpecial(g)              // 取武将战法（无名武将按属性给通用战法）
Battle.buildBattlefield(lon, lat, seed, {dir, sample, road})
Battle.createBattle({field, attacker, defender, city})
Battle.reachable(B, unit)             // {cells:[{x,y,cost}], mpLimit}
Battle.attackableFrom(B, unit, x, y)  // 该位置可打到的敌军
Battle.calcAttack(B, atk, def, opts) / applyAttack(...)
Battle.endSide(B) / aiSide(B)
Battle.isPassable(field,x,y,unit) / moveCost(...) / dist(a,b) / key(x,y)
```

### `MapView`（map3d.js）
```js
await MapView.init(canvas, opts)
MapView.focusOn(lon, lat, dist)       // 会把 camLockedByUser 置 true
MapView.resetView() / frameMap() / fitDistance() / minDistance() / maxDistance()
MapView.terrainHeightAt(lon, lat)     // 世界单位高度
MapView.lonLatToWorld(lon, lat) / worldX / worldZ
MapView.rebuildCities() / rebuildArmies() / rebuildRoads() / rebuildBorders()
MapView.updateCityOwners()            // 只改旗帜/屋顶颜色，不重建（夺城后调用）
MapView.onPick = ({type,id,lon,lat}) => {}
MapView.cam                           // {theta, phi, dist, target, targetGoal, distGoal}
MapView.DEG2W / HSCALE / EXAG
```

### `BattleView`（battle3d.js）
```js
await BattleView.init(canvas)
BattleView.load(battle)
BattleView.rebuildUnits(animateNew)
BattleView.markSelected(unit) / clearHighlight() / highlightRange(cells) / highlightTargets(cells)
BattleView.spawnFx(type, x, y)
BattleView.centerOn(x, y, dist) / pickCell(clientX, clientY)
BattleView.selected = unit
BattleView.onSelectUnit = id => {} / onOrder = ({x,y}) => {}
```

### `Portraits`（portraits.js）
```js
await Portraits.get(name)                    // HTMLImageElement | null
await Portraits.paint(canvas, general, {size, faction})   // 自动回退程序化
await Portraits.dataURL(general, opts)
Portraits.src(name)                          // 素材绝对 URL（含异体字归一）
```

### `Slice`（slice.js）
```js
await Slice.init()          // 启动时必须 await，之后 sample 同步可用
Slice.sample(px, py)        // 战场切片像素 → 高程（米，已压缩）
Slice.sampleBilinear(fx, fy)
Slice.size() / Slice.ready
```

> `SANGUO_MAP.sampleBattle` 是 `Battle.buildBattlefield` 实际调用的钩子。`Slice.init()` 后由 `main.js` 把它指向 `Slice.sample`；`battle.js` 里还有一层兜底（未就绪时返回 300 m 平地），避免顺序问题导致崩溃。

### `SaveSys`（save.js）
```js
SaveSys.serialize() / deserialize(obj)
SaveSys.saveLocal(slot 0..3) / loadLocal(slot) / listLocal() / clearLocal()
SaveSys.download()                       // 触发浏览器下载 .sgsav.json
await SaveSys.importFile()               // 打开文件选择器
```

---

## 7. 存档格式

```jsonc
{
  "format": "SANGUO-SAVE",
  "version": 3,
  "savedAt": "2026-09-17T...",
  "meta": { "scenario","year","month","turn","player","playerName","cities","generals" },
  "state": {
    "cities":     { "luoyang": { id,name,kind,tier,lon,lat,prov,region,owner,
                                 agri,comm,tech,def,pop,food,gold,troops,
                                 train,morale,security,disorder,generals:[gid...] } },
    "factions":   { "caocao": { id,name,color,dark,hue,color2,trait,lord,lordId,
                                alive,gold,food,ai:{aggression,...} } },
    "generals":   { "g1": { id,name,lead,war,intel,pol,charm,
                            gun,hal,xbow,ride,wep,wat,   // 兵种适性 S/A/B/C
                            bio,faction,city,army,isLord,age,exp,level,loyalty } },
    "armies":     [ { id,faction,generals:[gid],troops,food,train,morale,
                      from,at,path,target,state,siegeProgress } ],
    "adj":        { "luoyang": ["hulao","sishui",...] },   // 邻接图（读档后重建）
    "war":        { "a|b": true },     // 交战关系
    "truce":      { "a|b": 6 },        // 停战剩余月数
    "log":        [ { t:"189年9月", text, kind, turn } ],
    "stats":      { battlesWon, citiesTaken, generalsRecruited, goldEarned }
  }
}
```

**读档流程**（`main.js` 的 `loadState`）：`GameCore.S = state` → `buildAdjacency()` → `MapView.init()` → 重建全部图层 → 刷新界面。`adj` 虽然存了，但读档时会重算，避免存档里的邻接图与当前代码逻辑不一致。

**加字段的注意事项**：`version` 是硬校验（`deserialize` 里不等就抛错）。若新增了不兼容字段，把 `VERSION` 加 1，旧存档会给出明确的中文提示而不是静默出错。

---

## 8. 本地开发与调试

### 8.1 跑起来
双击 `index.html` 即可。若头像不显示（个别浏览器对 `file://` 本地图片有限制）：

```bash
python -m http.server 8000     # 然后访问 http://localhost:8000/
```

### 8.2 重新生成数据

```bash
# 武将名册（改势力归属/成员后运行）
node _source/roster.js

# 头像索引（素材变动后运行）
node _source/manifest.js

# 地形（改地图范围/精度/配色后运行）
node _source/bake.js
```

> 这三个脚本是从开发期的临时脚本整理进 `_source/` 的。若你发现缺失，`js/data_generals.js`、`js/data_portraits.js` 本身结构简单，也可以手改。

### 8.3 调试开关
代码里保留了几处调试钩子，正常运行为空操作：

```js
window.__MAPDBG = {}   // 在 MapView.init 前设置，会填充几何自检结果（顶点范围/跳变/NaN）
window.__BT = {frames:0, renders:0, glErr:0}   // 在 BattleView.init 前设置，统计帧数/三角数/GL 错误
window.__sanguoHotkeys = fn    // main.js 注册的全局快捷键处理器
```

### 8.4 常见坑（踩过的）

| 现象 | 原因 | 处理 |
|---|---|---|
| 城池悬空 / 陷进山里 | 网格只有 5.6 km 精度，城池坐标是精确经纬度 | `buildTerrain` 里的城池局部压平（1.1° 半径插值） |
| 地图出现刀山一样的尖刺 | 相机低于地形，穿进山体看到了被近裁剪面切开的内部；或高程夸张过度 | 相机 `minY = groundY + 1.8`；高程改非线性压缩 |
| 地图偏在画面一角 | 取景中心用了某个城市而不是地图几何中心 | `frameMap()` 用 `(lonMin+lonMax)/2` |
| 隐藏 canvas 渲染全黑 | `clientWidth` 为 0 时 `setSize(0,0)` | 0 尺寸兜底 + `ResizeObserver` + 显示后等两帧 |
| 截图/读像素全黑 | WebGL 缓冲在合成后已清空 | `preserveDrawingBuffer: true` |
| `Cannot access 'X' before initialization` | `const` 声明的函数在其定义前被调用（TDZ） | 把 `doResize` 这类内部函数提到 `init` 之前 |
| 战斗永远打不完 | 伤害低于守方恢复节奏，双方僵持 | 见 [`DESIGN.md` §5](DESIGN.md#5-战斗数值与公式) |

---

## 9. 代码约定

- **中英混排**：注释、日志、界面文案一律中文；标识符一律英文小驼峰。
- **不改生成文件**：`mapdata.js`、`data_generals.js`、`data_portraits.js` 是生成的，手改会在下次生成时被覆盖。要改就改生成脚本或源数据。
- **IIFE + 显式导出**：每个模块结尾集中挂 `window.Xxx = {...}`，便于一眼看出公开 API。
- **防御性写法保留**：`battle.js` 里 `sampleBattle` 的两层兜底、`map3d.js` 里解码的 `try/catch` 看着多余，但都对应过真实故障，见 [`TESTING.md`](TESTING.md)。删之前请先看那篇。
