// ===========================================================================
// 战棋战斗系统 —— 参考三国志11：兵种适性、战法、地形加成、士气/训练、后勤
//   逻辑与渲染分离：Battle 负责状态与规则，BattleView 负责 three.js 表现
// ===========================================================================
(function () {
  'use strict';

  // ------------------------------------------------------------- 兵种
  const TROOPS = {
    gun: { key: 'gun', name: '枪兵', short: '枪', color: '#8fa86a', icon: 'spear', range: 1, move: 4,
      desc: '长枪拒马，克制骑兵。', counter: 'ride', weakTo: 'xbow' },
    hal: { key: 'hal', name: '戟兵', short: '戟', color: '#b08a5a', icon: 'halberd', range: 1, move: 4,
      desc: '长戟破甲，攻守兼备。', counter: 'gun', weakTo: 'ride' },
    xbow: { key: 'xbow', name: '弩兵', short: '弩', color: '#c8b06a', icon: 'bow', range: 3, move: 3,
      desc: '强弩远射，克制枪兵，惧近战。', counter: 'gun', weakTo: 'ride' },
    ride: { key: 'ride', name: '骑兵', short: '骑', color: '#a86a5a', icon: 'horse', range: 1, move: 6,
      desc: '铁骑冲锋，克制弩兵，山森受阻。', counter: 'xbow', weakTo: 'gun' },
    wep: { key: 'wep', name: '兵器', short: '器', color: '#7a8a9a', icon: 'siege', range: 2, move: 3,
      desc: '攻城器械，破城门如摧枯拉朽。', counter: null, weakTo: 'ride' },
    wat: { key: 'wat', name: '水军', short: '水', color: '#5a8aa8', icon: 'ship', range: 2, move: 5,
      desc: '楼船水师，纵横江河。', counter: null, weakTo: null, water: true },
  };

  // 地形
  const TERRAIN = {
    plain: { key: 'plain', name: '平原', move: 1, def: 0, color: [0.46, 0.56, 0.34] },
    hill: { key: 'hill', name: '丘陵', move: 2, def: 12, color: [0.52, 0.52, 0.32] },
    forest: { key: 'forest', name: '森林', move: 2, def: 18, color: [0.24, 0.38, 0.24] },
    mount: { key: 'mount', name: '山地', move: 3, def: 30, color: [0.42, 0.36, 0.28], rideBlock: true },
    peak: { key: 'peak', name: '峻岭', move: 99, def: 0, color: [0.62, 0.60, 0.56], block: true },
    water: { key: 'water', name: '水面', move: 99, def: 0, color: [0.16, 0.36, 0.46], block: true, water: true },
    shallow: { key: 'shallow', name: '浅滩', move: 2, def: -8, color: [0.34, 0.54, 0.56], water: true },
    city: { key: 'city', name: '城郭', move: 1, def: 45, color: [0.52, 0.46, 0.40] },
    road: { key: 'road', name: '道路', move: 1, def: -5, color: [0.56, 0.50, 0.38] },
  };

  // 兵种适性 S/A/B/C -> 系数
  const APT = { S: 1.28, A: 1.12, B: 1.0, C: 0.84 };

  // 特殊战法（按武将名）
  const SPECIALS = {
    '吕布': { name: '无双', mult: 2.35, morale: 22, desc: '天下无双，一击破阵' },
    '关羽': { name: '青龙偃月', mult: 2.15, morale: 16, desc: '刀锋所向，敌军胆寒' },
    '张飞': { name: '长坂怒吼', mult: 1.55, morale: 32, aoe: true, desc: '一声断喝，敌军溃散' },
    '赵云': { name: '七进七出', mult: 1.95, morale: 14, noRetal: true, desc: '单骑突阵，来去自如' },
    '马超': { name: '西凉铁骑', mult: 2.05, morale: 18, desc: '铁骑冲阵，势不可当' },
    '典韦': { name: '古之恶来', mult: 1.95, morale: 16, noRetal: true, desc: '双戟横扫，近身无敌' },
    '许褚': { name: '虎痴冲阵', mult: 1.85, morale: 15, desc: '虎侯裸衣，勇冠三军' },
    '黄忠': { name: '百步穿杨', mult: 2.0, morale: 12, ranged: true, desc: '箭无虚发，先声夺人' },
    '太史慈': { name: '神射', mult: 1.85, morale: 12, ranged: true, desc: '弦不虚发' },
    '甘宁': { name: '锦帆夜袭', mult: 1.9, morale: 20, desc: '百骑劫营' },
    '夏侯惇': { name: '拔矢啖睛', mult: 1.8, morale: 14, desc: '父精母血，不可弃也' },
    '张辽': { name: '逍遥津', mult: 2.0, morale: 24, aoe: true, desc: '八百破十万' },
    '孙策': { name: '小霸王', mult: 1.95, morale: 16, desc: '江东猛虎之子' },
    '周瑜': { name: '火烧赤壁', mult: 1.75, intel: true, aoe: true, morale: 26, desc: '谈笑间，樯橹灰飞烟灭' },
    '诸葛亮': { name: '八阵图', mult: 1.7, intel: true, aoe: true, morale: 24, desc: '功盖三分国，名成八阵图' },
    '司马懿': { name: '鹰视狼顾', mult: 1.7, intel: true, morale: 18, desc: '隐忍待时，一击制胜' },
    '郭嘉': { name: '遗计定辽东', mult: 1.6, intel: true, morale: 20, desc: '鬼才之谋' },
    '贾诩': { name: '毒士之计', mult: 1.6, intel: true, morale: 20, desc: '算无遗策' },
    '庞统': { name: '连环计', mult: 1.65, intel: true, aoe: true, morale: 18, desc: '凤雏之谋' },
    '陆逊': { name: '火烧连营', mult: 1.7, intel: true, aoe: true, morale: 22, desc: '书生拜大将' },
    '姜维': { name: '九伐中原', mult: 1.8, morale: 16, desc: '继丞相之志' },
    '邓艾': { name: '偷渡阴平', mult: 1.8, morale: 20, desc: '行无人之地七百余里' },
    '吕蒙': { name: '白衣渡江', mult: 1.75, morale: 18, desc: '士别三日，刮目相看' },
    '黄盖': { name: '苦肉计', mult: 1.7, morale: 22, desc: '周瑜打黄盖' },
    '魏延': { name: '子午谷奇谋', mult: 1.75, morale: 16, desc: '兵出子午，直取长安' },
    '颜良': { name: '河北名将', mult: 1.8, morale: 12, desc: '河北四庭柱' },
    '文丑': { name: '河北名将', mult: 1.8, morale: 12, desc: '河北四庭柱' },
    '华雄': { name: '西凉悍将', mult: 1.75, morale: 14, desc: '温酒斩华雄之前' },
    '高顺': { name: '陷阵营', mult: 1.85, morale: 14, desc: '陷阵之志，有死无生' },
    '鞠义': { name: '先登死士', mult: 1.8, morale: 14, desc: '界桥破白马' },
    '张郃': { name: '巧变', mult: 1.7, morale: 12, desc: '用兵巧变，无坚不摧' },
    '徐晃': { name: '长驱直入', mult: 1.7, morale: 12, desc: '周亚夫之风' },
    '曹仁': { name: '天人将军', mult: 1.65, morale: 14, def: true, desc: '据守江陵，坚如磐石' },
    '夏侯渊': { name: '虎步关右', mult: 1.75, morale: 12, desc: '三日五百，六日一千' },
    '严颜': { name: '断头将军', mult: 1.7, morale: 16, def: true, desc: '但有断头将军' },
    '张任': { name: '落凤坡', mult: 1.8, morale: 16, ranged: true, desc: '射杀庞统' },
  };

  function generalSpecial(g) {
    if (SPECIALS[g.name]) return SPECIALS[g.name];
    // 无名武将按属性给通用战法
    if (g.war >= 90) return { name: '奋勇突击', mult: 1.6, morale: 12, desc: '勇冠三军' };
    if (g.war >= 82) return { name: '猛攻', mult: 1.45, morale: 10, desc: '奋力冲杀' };
    if (g.intel >= 90) return { name: '火计', mult: 1.5, intel: true, morale: 16, desc: '纵火焚敌' };
    if (g.intel >= 82) return { name: '伏兵', mult: 1.4, intel: true, morale: 12, desc: '设伏击敌' };
    if (g.lead >= 88) return { name: '鹤翼阵', mult: 1.4, morale: 8, def: true, desc: '阵法严整' };
    return { name: '突击', mult: 1.35, morale: 8, desc: '全力突击' };
  }

  const BW = 34, BH = 24;   // 战场格数

  // ------------------------------------------------------------- 工具
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function dist(a, b) { return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)); }
  function key(x, y) { return y * BW + x; }

  // ------------------------------------------------------------- 战场生成
  // 从烘焙的真实高程中切出一块，生成与当地地形相符的战场
  function buildBattlefield(centerLon, centerLat, seed, opts) {
    opts = opts || {};
    const M = window.SANGUO_MAP;
    if (!M.sampleBattle) {
      if (window.Slice && window.Slice.ready) M.sampleBattle = window.Slice.sample;
      else M.sampleBattle = () => 300;   // 兜底：高程未就绪时退化为平地
    }
    const rng = mulberryLocal(seed);
    const cellDegLon = (M.lonMax - M.lonMin) / M.batW;
    const cellDegLat = (M.latMax - M.latMin) / M.batH;
    // 以战场中心取 BW*k x BH*k 的高程窗口（窗口 = 战场格 * 采样倍率）
    const K = opts.sample || 3;
    const srcW = BW * K, srcH = BH * K;
    const c0 = Math.round((centerLon - M.lonMin) / (M.lonMax - M.lonMin) * M.batW - srcW / 2);
    const r0 = Math.round((M.latMax - centerLat) / (M.latMax - M.latMin) * M.batH - srcH / 2);

    const cells = [];
    for (let y = 0; y < BH; y++) {
      for (let x = 0; x < BW; x++) {
        let h = 0, hmin = 1e9, hmax = -1e9, waterN = 0, n = 0;
        for (let j = 0; j < K; j++) for (let i = 0; i < K; i++) {
          const sx = c0 + x * K + i, sy = r0 + y * K + j;
          const hv = M.sampleBattle(sx, sy);
          h += hv; n++;
          if (hv < hmin) hmin = hv;
          if (hv < 3) waterN++;
        }
        h /= n;
        cells.push({ x, y, h, relief: hmax - hmin, water: waterN / n > 0.5 });
      }
    }
    // 相对高差 -> 地形类型
    const hs = cells.filter((c) => !c.water).map((c) => c.h).sort((a, b) => a - b);
    const lo = hs[Math.floor(hs.length * 0.10)] || 0;
    const hi = hs[Math.floor(hs.length * 0.92)] || 100;
    const range = Math.max(40, hi - lo);
    const grid = [];
    for (const c of cells) {
      let t;
      const rel = (c.h - lo) / range;
      if (c.water || c.h < 2) t = 'water';
      else if (rel > 0.86) t = 'peak';
      else if (rel > 0.62) t = 'mount';
      else if (rel > 0.38) t = 'hill';
      else if (rng() < 0.16 && rel < 0.5) t = 'forest';
      else t = 'plain';
      grid.push(t);
    }
    // 确保战场可通行：把孤立的 peak 降级
    for (let y = 0; y < BH; y++) for (let x = 0; x < BW; x++) {
      if (grid[key(x, y)] !== 'peak') continue;
      let open = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= BW || ny >= BH) continue;
        if (grid[key(nx, ny)] !== 'peak' && grid[key(nx, ny)] !== 'water') open++;
      }
      if (open >= 6) grid[key(x, y)] = 'mount';
    }

    // 攻守方起始区：根据进攻方向选一条边
    const dir = opts.dir || 'north';
    const zones = { attacker: [], defender: [], city: [] };
    for (let y = 0; y < BH; y++) for (let x = 0; x < BW; x++) {
      const t = grid[key(x, y)];
      if (t === 'water' || t === 'peak') continue;
      let side;
      if (dir === 'north') side = y < 4 ? 'attacker' : y > BH - 5 ? 'defender' : null;
      else if (dir === 'south') side = y > BH - 5 ? 'attacker' : y < 4 ? 'defender' : null;
      else if (dir === 'west') side = x < 5 ? 'attacker' : x > BW - 6 ? 'defender' : null;
      else side = x > BW - 6 ? 'attacker' : x < 5 ? 'defender' : null;
      if (side) zones[side].push({ x, y });
    }
    // 城郭：守方后方 3x3
    for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) {
      let cx, cy;
      if (dir === 'north') { cx = Math.floor(BW / 2) - 1 + i; cy = BH - 2 - j; }
      else if (dir === 'south') { cx = Math.floor(BW / 2) - 1 + i; cy = 1 + j; }
      else if (dir === 'west') { cx = BW - 2 - j; cy = Math.floor(BH / 2) - 1 + i; }
      else { cx = 1 + j; cy = Math.floor(BH / 2) - 1 + i; }
      if (cx >= 0 && cy >= 0 && cx < BW && cy < BH) {
        grid[key(cx, cy)] = 'city';
        zones.defender.push({ x: cx, y: cy });
      }
    }
    if (opts.road) {
      // 主道：从攻方边到城郭
      for (let y = 0; y < BH; y++) {
        const x = Math.round(BW / 2 + Math.sin(y * 0.3) * 3);
        if (x >= 0 && x < BW && grid[key(x, y)] !== 'city' && grid[key(x, y)] !== 'water') grid[key(x, y)] = 'road';
      }
    }

    return { w: BW, h: BH, grid, zones, center: { lon: centerLon, lat: centerLat },
      info: { lo, hi, range: Math.round(range), terrain: summarize(grid) } };
  }

  function summarize(grid) {
    const c = {};
    for (const t of grid) c[t] = (c[t] || 0) + 1;
    return c;
  }

  function mulberryLocal(a) {
    let s = typeof a === 'string' ? hash(a) : a | 0;
    return function () {
      s |= 0; s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash(s) { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }

  // ------------------------------------------------------------- 战斗状态
  function createBattle(cfg) {
    // cfg: { field, attacker:{faction,generals:[],troops,train,morale,name}, defender:{...}, city }
    const B = {
      field: cfg.field,
      turn: 1,
      side: 'attacker',
      units: [],
      log: [],
      city: cfg.city,
      attackerFaction: cfg.attacker.faction,
      defenderFaction: cfg.defender.faction,
      over: false,
      winner: null,
      weather: pickWeather(cfg.field),
      nextId: 1,
    };
    const place = (side, spec, n) => {
      const zone = cfg.field.zones[side].slice();
      // 优先靠前的格子
      const rng = mulberryLocal(side + n + (cfg.city ? cfg.city.id : ''));
      for (let i = zone.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [zone[i], zone[j]] = [zone[j], zone[i]]; }
      const unit = {
        id: 'U' + (B.nextId++),
        side,
        name: spec.general ? spec.general.name : '无名',
        generalId: spec.general ? spec.general.id : null,
        general: spec.general || null,
        troopType: spec.troopType,
        troops: spec.troops,
        maxTroops: spec.troops,
        train: spec.train, morale: spec.morale,
        x: 0, y: 0,
        moved: false, acted: false,
        movedPoints: 0,
        defending: false,
        isCity: !!spec.isCity,
        special: spec.general ? generalSpecial(spec.general) : null,
        apt: spec.general ? APT[spec.general[spec.troopType === 'hal' ? 'hal' : spec.troopType === 'wep' ? 'wep' : spec.troopType === 'wat' ? 'wat' : spec.troopType]] : 1.0,
        faction: side === 'attacker' ? cfg.attacker.faction : cfg.defender.faction,
      };
      unit.apt = unit.apt || 1.0;
      // 找空位
      let spot = null;
      for (const p of zone) {
        if (!B.units.some((u) => u.x === p.x && u.y === p.y) && isPassable(cfg.field, p.x, p.y, unit)) { spot = p; break; }
      }
      if (!spot) spot = zone[Math.floor(rng() * zone.length)] || { x: 0, y: 0 };
      unit.x = spot.x; unit.y = spot.y;
      B.units.push(unit);
      return unit;
    };

    // 攻方部队
    for (const u of cfg.attacker.units) place('attacker', u);
    // 守方部队
    for (const u of cfg.defender.units) place('defender', u);
    // 守城部队（无将也有一座城池守军）
    if (cfg.defender.cityGarrison) {
      place('defender', {
        general: cfg.defender.cityGarrison.general || null,
        troopType: cfg.defender.cityGarrison.troopType || 'gun',
        troops: cfg.defender.cityGarrison.troops,
        train: cfg.defender.cityGarrison.train,
        morale: cfg.defender.cityGarrison.morale,
        isCity: true,
      });
    }

    B.log.push({ t: 1, text: `⚔ ${cfg.attacker.name} 与 ${cfg.defender.name} 战于 ${cfg.city ? cfg.city.name : '野地'}` });
    if (B.weather) B.log.push({ t: 1, text: `天候：${B.weather.name}（${B.weather.desc}）` });
    return B;
  }

  function pickWeather(field) {
    const r = Math.random();
    const opts = [
      { key: 'clear', name: '晴', desc: '视野良好，无影响', acc: 1, fire: 1.2, move: 1 },
      { key: 'rain', name: '雨', desc: '火计失效，弓弩减弱', acc: 0.82, fire: 0, move: 0.85 },
      { key: 'wind', name: '大风', desc: '火势蔓延，弓弩失准', acc: 0.86, fire: 1.7, move: 1 },
      { key: 'fog', name: '雾', desc: '命中下降，伏击加成', acc: 0.76, fire: 0.9, move: 0.9 },
      { key: 'snow', name: '雪', desc: '行军迟缓', acc: 0.9, fire: 0.6, move: 0.75 },
    ];
    if (r < 0.45) return opts[0];
    if (r < 0.62) return opts[1];
    if (r < 0.75) return opts[2];
    if (r < 0.87) return opts[3];
    return opts[4];
  }

  function isPassable(field, x, y, unit) {
    if (x < 0 || y < 0 || x >= field.w || y >= field.h) return false;
    const t = TERRAIN[field.grid[key(x, y)]];
    if (!t) return false;
    if (t.block) {
      if (t.water && unit && unit.troopType === 'wat') return true;
      return false;
    }
    if (t.water && unit && unit.troopType !== 'wat') return false;
    if (t.rideBlock && unit && unit.troopType === 'ride') return false;
    return true;
  }
  function moveCost(field, x, y, unit) {
    const t = TERRAIN[field.grid[key(x, y)]];
    let c = t.move;
    if (unit.troopType === 'ride' && (t.key === 'forest' || t.key === 'mount')) c += 1;
    if (unit.troopType === 'wep' && t.key !== 'road' && t.key !== 'plain') c += 1;
    return c;
  }

  // 可达范围（Dijkstra，受限移动力）
  function reachable(B, unit) {
    const field = B.field;
    const w = field.w, h = field.h;
    const distMap = new Int32Array(w * h).fill(-1);
    const start = key(unit.x, unit.y);
    distMap[start] = 0;
    const occupied = new Set(B.units.filter((u) => u.id !== unit.id).map((u) => key(u.x, u.y)));
    const q = [[unit.x, unit.y, 0]];
    const out = [];
    const maxMp = Math.floor(unit.troopType === 'ride' ? 6 : unit.troopType === 'xbow' ? 3 : unit.troopType === 'wep' ? 3 : 4) + (unit.troopType === 'wat' && TERRAIN[field.grid[start]] && TERRAIN[field.grid[start]].water ? 1 : 0);
    const mpLimit = Math.round(maxMp * (B.weather ? B.weather.move : 1) * 10) / 10;
    while (q.length) {
      const [x, y, d] = q.shift();
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (!isPassable(field, nx, ny, unit)) continue;
        const nk = key(nx, ny);
        if (occupied.has(nk)) continue;
        const nd = d + moveCost(field, nx, ny, unit);
        if (nd > mpLimit) continue;
        if (distMap[nk] !== -1 && distMap[nk] <= nd) continue;
        distMap[nk] = nd;
        out.push({ x: nx, y: ny, cost: nd });
        q.push([nx, ny, nd]);
      }
      q.sort((a, b) => a[2] - b[2]);
    }
    return { cells: out, mpLimit };
  }

  // 攻击范围
  function attackableFrom(B, unit, x, y) {
    const range = TROOPS[unit.troopType].range;
    return B.units.filter((u) => u.side !== unit.side && u.troops > 0 && dist({ x, y }, u) <= range);
  }

  // ------------------------------------------------------------- 战斗计算
  // 设计目标：一次攻击造成约 8%~20% 兵力损失，一场战斗 4~8 回合结束（三11 的节奏）
  function calcAttack(B, atk, def, opts) {
    opts = opts || {};
    const T = TROOPS[atk.troopType], D = TROOPS[def.troopType];
    const g = atk.general || { war: 60, intel: 60, lead: 60 };
    const gd = def.general || { war: 60, intel: 60, lead: 60 };

    // 攻方战力（兵力 × 训练 × 士气 × 武将 × 兵种适性）
    const warPart = opts.useIntel ? (g.intel * 1.0) : (g.war * 1.05 + g.lead * 0.30);
    const power = atk.troops * (0.62 + atk.train / 165) * (0.55 + atk.morale / 150)
      * (1 + warPart / 105) * atk.apt;

    // 兵种克制
    let counter = 1;
    if (T.counter && T.counter === def.troopType) counter = 1.32;
    if (T.weakTo && T.weakTo === def.troopType) counter = 0.78;

    // 地形：攻方所处地形加成、守方地形减伤
    const at = TERRAIN[B.field.grid[key(atk.x, atk.y)]];
    const dt = TERRAIN[B.field.grid[key(def.x, def.y)]];
    const atkTerr = 1 + at.def / 300;
    const defTerr = 1 - dt.def / 190;

    // 守方战力
    const defPower = def.troops * (0.50 + def.train / 175) * (0.55 + def.morale / 165)
      * (1 + (gd.lead * 0.75 + gd.war * 0.35) / 105) * def.apt;

    // 战法
    let specMult = 1, specName = '';
    if (opts.special && atk.special) {
      specMult = atk.special.mult;
      specName = atk.special.name;
    }
    // 天候
    const weatherAcc = B.weather ? B.weather.acc : 1;
    const weatherFire = B.weather ? B.weather.fire : 1;
    if (opts.special && opts.useIntel) specMult *= weatherFire;

    // 命中
    const acc = clamp(0.66 + (g.war - gd.lead) / 320 + atk.morale / 420, 0.38, 0.96) * weatherAcc;
    const hit = Math.random() < acc;

    // 伤害：战力差模型（保证最低伤害，避免僵持不下）
    const raw = power * specMult * counter * atkTerr * defTerr - defPower * 0.80;
    let dmg = raw * (0.24 + Math.random() * 0.12);
    const floor = atk.troops * 0.020;
    const cap = def.troops * 0.34;
    dmg = Math.round(clamp(dmg, floor, cap));
    if (!hit) dmg = Math.round(dmg * 0.22);

    // 士气打击
    const morBase = opts.special ? (atk.special.morale || 10) : 5 + (atk.troops > def.troops ? 3 : 0);
    let moraleHit = Math.round(morBase * (0.7 + Math.random() * 0.7));
    if (opts.special && opts.useIntel) moraleHit = Math.round(moraleHit * (0.8 + Math.max(0, g.intel - gd.intel) / 170));
    moraleHit = Math.max(1, moraleHit);

    const res = { dmg, hit, counter, specName, moraleHit, atkLoss: 0, log: '' };
    // 反击
    const canRetal = !opts.noRetal && !(atk.special && atk.special.noRetal)
      && D.range >= dist(atk, def) && def.troops > dmg;
    if (canRetal) res.atkLoss = calcRetal(B, def, atk);
    return res;
  }

  function calcRetal(B, def, atk) {
    const g = def.general || { war: 60, lead: 60 };
    const defPower = def.troops * (0.50 + def.train / 175) * (0.5 + def.morale / 180)
      * (1 + (g.war * 0.85 + g.lead * 0.30) / 105) * def.apt;
    const ga = atk.general || { war: 60, lead: 60 };
    const atkDef = atk.troops * (0.62 + atk.train / 165) * (0.55 + atk.morale / 150)
      * (1 + (ga.lead * 0.70 + ga.war * 0.40) / 105) * atk.apt;
    const raw = (defPower * 0.42 - atkDef * 0.34) * (0.75 + Math.random() * 0.4);
    return Math.round(clamp(raw, atk.troops * 0.012, atk.troops * 0.16));
  }

  function applyAttack(B, atk, def, opts) {
    opts = opts || {};
    const r = calcAttack(B, atk, def, opts);
    def.troops = Math.max(0, def.troops - r.dmg);
    def.morale = clamp(def.morale - r.moraleHit, 0, 100);
    if (r.atkLoss) {
      atk.troops = Math.max(0, atk.troops - r.atkLoss);
      atk.morale = clamp(atk.morale - Math.round(r.atkLoss / Math.max(1, atk.troops) * 90), 0, 100);
    }
    // 攻击方小损（接战损耗）
    const engageLoss = Math.round(atk.troops * 0.006 * Math.random());
    atk.troops = Math.max(0, atk.troops - engageLoss);

    const sp = r.specName ? `【${r.specName}】` : '';
    B.log.push({
      t: B.turn,
      text: `${atk.name}${sp} 攻 ${def.name}：${r.hit ? '命中' : '失准'} 歼敌 ${r.dmg}${r.atkLoss ? `，自损 ${r.atkLoss}` : ''}${counterText(r.counter)}`,
      atk: atk.id, def: def.id, dmg: r.dmg, side: atk.side,
    });
    // 溃灭判定
    for (const u of [atk, def]) {
      if (u.troops <= 0) {
        B.log.push({ t: B.turn, text: `☠ ${u.name} 部众覆灭`, side: u.side, dead: true });
      } else if (u.morale <= 0 || u.troops < u.maxTroops * 0.12) {
        if (Math.random() < 0.55) {
          B.log.push({ t: B.turn, text: `🏳 ${u.name} 士气崩溃，退出战场`, side: u.side, dead: true });
          u.troops = 0;
        }
      }
    }
    // AOE 波及
    if (opts.special && atk.special && atk.special.aoe) {
      for (const o of B.units) {
        if (o.side === atk.side || o.troops <= 0 || o.id === def.id) continue;
        if (dist(o, def) <= 1) {
          const splash = Math.round(r.dmg * 0.34);
          o.troops = Math.max(0, o.troops - splash);
          o.morale = clamp(o.morale - 8, 0, 100);
          B.log.push({ t: B.turn, text: `　└ 波及 ${o.name}，歼敌 ${splash}` });
        }
      }
    }
    checkOver(B);
    return r;
  }
  function counterText(c) { return c > 1.1 ? '（克制）' : c < 0.95 ? '（被克）' : ''; }

  function checkOver(B) {
    const aAlive = B.units.filter((u) => u.side === 'attacker' && u.troops > 0).length;
    const dAlive = B.units.filter((u) => u.side === 'defender' && u.troops > 0).length;
    if (aAlive === 0 && dAlive === 0) { B.over = true; B.winner = 'draw'; }
    else if (dAlive === 0) { B.over = true; B.winner = 'attacker'; }
    else if (aAlive === 0) { B.over = true; B.winner = 'defender'; }
    if (B.over) B.log.push({ t: B.turn, text: B.winner === 'attacker' ? '★ 攻方获胜！' : B.winner === 'defender' ? '★ 守方获胜！' : '两败俱伤' });
  }

  // 攻城：攻击城郭单位
  function cityWallBonus(B, unit) {
    const t = TERRAIN[B.field.grid[key(unit.x, unit.y)]];
    return t.key === 'city' ? 1.6 : 1;
  }

  // 结束当前单位行动
  function finishUnit(B, unit, moved) {
    if (moved) unit.moved = true;
    unit.acted = true;
    unit.movedPoints = 0;
  }

  // 结束一方行动 -> 切换
  function endSide(B) {
    if (B.over) return B.side;
    if (B.side === 'attacker') { B.side = 'defender'; }
    else { B.side = 'attacker'; B.turn++; }
    B.units.forEach((u) => { u.moved = false; u.acted = false; u.movedPoints = 0; u.defending = false; });
    // 每回合士气恢复
    for (const u of B.units) if (u.troops > 0) u.morale = clamp(u.morale + 2, 0, 100);
    B.log.push({ t: B.turn, text: `── 第 ${B.turn} 回合 · ${B.side === 'attacker' ? '攻方' : '守方'}行动 ──` });
    return B.side;
  }

  // AI 行动
  function aiSide(B) {
    const side = B.side;
    const mine = B.units.filter((u) => u.side === side && u.troops > 0 && !u.acted);
    const acts = [];
    for (const u of mine) {
      if (B.over) break;
      const foes = B.units.filter((x) => x.side !== side && x.troops > 0);
      if (!foes.length) break;
      // 目标：最弱且最近（考虑克制）
      let best = null, bestScore = -1e9;
      for (const f of foes) {
        const d = dist(u, f);
        const T = TROOPS[u.troopType];
        let score = -d * 12;
        score += (1 - f.troops / Math.max(1, f.maxTroops)) * 60;
        if (T.counter === f.troopType) score += 45;
        if (T.weakTo === f.troopType) score -= 30;
        if (f.isCity) score -= 25;
        const dg = f.general || { war: 60, lead: 60 };
        score -= (dg.war + dg.lead) * 0.22;
        if (score > bestScore) { bestScore = score; best = f; }
      }
      if (!best) break;
      const range = TROOPS[u.troopType].range;
      if (dist(u, best) <= range) {
        // 直接攻击；若战法可用且优势明显则放战法
        const useSpecial = u.special && Math.random() < 0.42 && u.morale > 45;
        acts.push({ type: 'attack', unit: u.id, target: best.id, special: useSpecial, useIntel: !!(u.special && u.special.intel) });
        applyAttack(B, u, best, { special: useSpecial, noRetal: false, useIntel: !!(u.special && u.special.intel) });
        finishUnit(B, u, true);
      } else {
        // 移动到能攻击的位置
        const reach = reachable(B, u);
        let pos = null, posScore = -1e9;
        for (const c of reach.cells) {
          const d = dist(c, best);
          if (d > range) continue;
          const t = TERRAIN[B.field.grid[key(c.x, c.y)]];
          const s = t.def * 1.4 - c.cost * 2 - d * 3;
          if (s > posScore) { posScore = s; pos = c; }
        }
        if (!pos) {
          // 靠近
          const reach2 = reach.cells.slice().sort((a, b) => (dist(a, best) - dist(b, best)) || (a.cost - b.cost));
          pos = reach2[0] || null;
        }
        if (pos) {
          acts.push({ type: 'move', unit: u.id, from: { x: u.x, y: u.y }, to: { x: pos.x, y: pos.y } });
          u.x = pos.x; u.y = pos.y;
          if (dist(u, best) <= range) {
            const useSpecial = u.special && Math.random() < 0.5 && u.morale > 45;
            acts.push({ type: 'attack', unit: u.id, target: best.id, special: useSpecial, useIntel: !!(u.special && u.special.intel) });
            applyAttack(B, u, best, { special: useSpecial, useIntel: !!(u.special && u.special.intel) });
          }
        }
        finishUnit(B, u, true);
      }
    }
    return acts;
  }

  // ------------------------------------------------------------- 导出
  window.Battle = {
    TROOPS, TERRAIN, SPECIALS, APT, BW, BH,
    generalSpecial, buildBattlefield, createBattle, reachable, attackableFrom,
    calcAttack, applyAttack, isPassable, moveCost, dist, key, endSide, aiSide,
    finishUnit, checkOver, clamp,
  };
})();
