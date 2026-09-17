// ===========================================================================
// 游戏核心 —— 势力、城池、内政、军事、后勤、回合流程、AI
// ===========================================================================
(function () {
  'use strict';

  const SITES = () => window.SANGUO_SITES;
  const FACTIONS_DEF = () => window.SANGUO_FACTIONS;

  // ---------------------------------------------------------------- 常量
  const CONST = {
    TURN_MONTHS: 1,
    MAX_TROOPS: 200000,          // 单城兵力上限
    MAX_STAT: 1600,              // 单城开发上限
    RECRUIT_PER_POP: 0.055,      // 每万人口可征兵
    FOOD_PER_TROOP: 1,           // 每兵每月口粮(x0.01 折算)
    STARVE_LOSS: 0.10,           // 断粮每回合损兵比例
    BASE_MOVE: 5,                // 部队基础移动点
    SIEGE_TURNS: 1,
    CITY_DEF_BASE: 120,
  };

  const CITY_LEVEL = {
    capital: { baseDef: 220, basePop: 42, baseFood: 26000, slots: 8, label: '都城' },
    city: { baseDef: 160, basePop: 26, baseFood: 16000, slots: 6, label: '郡城' },
    pass: { baseDef: 300, basePop: 7, baseFood: 5000, slots: 3, label: '关隘' },
    port: { baseDef: 170, basePop: 14, baseFood: 9000, slots: 4, label: '水寨' },
  };

  function rnd(n) { return Math.floor(Math.random() * n); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function uid() { return Math.random().toString(36).slice(2, 10); }

  // ---------------------------------------------------------------- 状态
  let S = null;   // game state

  function newState(playerFaction, scenario) {
    const fdefs = FACTIONS_DEF();
    const st = {
      version: 3,
      scenario: scenario.name,
      year: scenario.year,
      month: scenario.month,
      turn: 1,
      player: playerFaction,
      phase: 'player',              // player | ai
      cities: {},
      factions: {},
      generals: {},
      armies: [],
      log: [],
      war: {},                      // "A|B" -> true 交战状态
      truce: {},                    // "A|B" -> 剩余停战月数
      nextArmyId: 1,
      stats: { battlesWon: 0, citiesTaken: 0, generalsRecruited: 0, goldEarned: 0 },
      ui: { selectedCity: null, selectedArmy: null },
    };

    const roster = window.SANGUO_ROSTER;

    // ---- 城池 ----
    for (const site of SITES()) {
      const lv = CITY_LEVEL[site.kind] || CITY_LEVEL.city;
      const cap = lv.basePop * (site.tier === 1 ? 1.35 : site.tier === 2 ? 1.0 : 0.7);
      const owner = scenario.owner[site.id] || 'neutral';
      const agri = Math.round(clamp(280 + (site.tier === 1 ? 420 : site.tier === 2 ? 260 : 120) + rnd(120), 100, 1200));
      const comm = Math.round(clamp(240 + (site.tier === 1 ? 460 : site.tier === 2 ? 280 : 110) + rnd(140), 100, 1200));
      const tech = Math.round(clamp(180 + (site.tier === 1 ? 340 : site.tier === 2 ? 200 : 90) + rnd(110), 60, 1000));
      const def = Math.round(lv.baseDef * (site.tier === 1 ? 1.15 : 1) + rnd(50));
      st.cities[site.id] = {
        id: site.id, name: site.name, kind: site.kind, tier: site.tier,
        lon: site.lon, lat: site.lat, prov: site.prov, region: site.region,
        desc: site.desc, guards: site.guards || [],
        owner,
        agri, comm, tech, def,
        pop: Math.round(cap * 1000 * (0.75 + Math.random() * 0.4)),
        food: Math.round(lv.baseFood * (0.7 + Math.random() * 0.6)),
        gold: Math.round(1200 * (site.tier === 1 ? 2.6 : site.tier === 2 ? 1.5 : 0.7) * (0.7 + Math.random() * 0.6)),
        troops: Math.round((site.kind === 'pass' ? 3000 : site.kind === 'port' ? 5000 : 7000) * (0.7 + Math.random() * 0.8)),
        train: 45 + rnd(25),            // 训练度
        morale: 62 + rnd(18),           // 民心/士气
        security: 55 + rnd(25),         // 治安
        disorder: 0,
        generals: [],                   // 在任武将 id
        maxTroops: CONST.MAX_TROOPS,
        built: {},                      // 已建建筑
      };
    }

    // ---- 势力 ----
    const owners = new Set(Object.values(st.cities).map((c) => c.owner));
    for (const fid of owners) {
      const def = fdefs[fid] || fdefs.neutral;
      st.factions[fid] = {
        id: fid, name: def.name, color: def.color, dark: def.dark, hue: def.hue,
        color2: def.color2, trait: def.trait, lord: def.lord,
        isPlayer: fid === playerFaction,
        alive: true,
        gold: fid === 'neutral' ? 0 : 2200 + rnd(3000),
        food: fid === 'neutral' ? 0 : 18000 + rnd(24000),
        ai: { aggression: 0.35 + Math.random() * 0.4, focus: null, lastTarget: null },
      };
    }

    // ---- 武将 ----
    let gid = 0;
    const mkGeneral = (rec, fid, cityId, isLord) => {
      const g = {
        id: 'g' + (++gid),
        name: rec.n,
        lead: rec.lead, war: rec.war, intel: rec.intel, pol: rec.pol, charm: rec.charm,
        gun: rec.gun, hal: rec.hal, xbow: rec.xbow, ride: rec.ride, wep: rec.wep, wat: rec.wat,
        bio: rec.bio || '',
        faction: fid, city: cityId, army: null,
        isLord: !!isLord,
        age: 22 + rnd(32),
        exp: 0, level: 1,
        wounded: 0,
        loyalty: isLord ? 100 : 72 + rnd(26),
        actedThisTurn: false,
      };
      st.generals[g.id] = g;
      if (cityId && st.cities[cityId]) st.cities[cityId].generals.push(g.id);
      return g;
    };

    // 先在位名册
    for (const [fid, data] of Object.entries(roster.factions)) {
      if (!st.factions[fid]) continue;
      const cities = Object.values(st.cities).filter((c) => c.owner === fid).sort((a, b) => a.tier - b.tier);
      let ci = 0;
      data.members.forEach((rec, idx) => {
        const isLord = data.lord && rec.n === data.lord;
        // 君主驻都城
        const target = isLord ? (cities.find((c) => c.kind === 'capital') || cities[0]) : cities[ci++ % Math.max(1, cities.length)];
        if (!target) return;
        mkGeneral(rec, fid, target.id, isLord);
      });
    }
    // 在野武将被招募到 neutral 城（每城限 14 名，形成"某地有贤才"的地缘理由）
    const neutralCities = Object.values(st.cities).filter((c) => c.owner === 'neutral');
    roster.reserve.forEach((rec, i) => {
      const cityIdx = Math.floor(i / 14);
      const c = neutralCities[cityIdx % Math.max(1, neutralCities.length)];
      if (c) mkGeneral(rec, 'neutral', c.id, false);
    });

    // 势力君主索引
    for (const f of Object.values(st.factions)) {
      const lord = Object.values(st.generals).find((g) => g.faction === f.id && g.isLord);
      f.lordId = lord ? lord.id : null;
      if (!lord && f.id !== 'neutral') {
        // 无君主则提升最强武将
        const cand = Object.values(st.generals).filter((g) => g.faction === f.id).sort((a, b) => (b.lead + b.war) - (a.lead + a.war))[0];
        if (cand) { cand.isLord = true; f.lordId = cand.id; }
      }
    }

    // 剧本加成
    if (scenario.bonus) {
      for (const [fid, b] of Object.entries(scenario.bonus)) {
        if (!st.factions[fid]) continue;
        st.factions[fid].gold = b.gold != null ? b.gold : st.factions[fid].gold;
        st.factions[fid].food = b.food != null ? b.food : st.factions[fid].food;
        if (b.troops) {
          const cities = Object.values(st.cities).filter((c) => c.owner === fid);
          const per = Math.round(b.troops / Math.max(1, cities.length));
          cities.forEach((c) => { c.troops = Math.min(c.maxTroops, c.troops + per); });
        }
      }
    }

    // 兵力/粮草按城分配，避免全国聚集
    for (const f of Object.values(st.factions)) {
      if (f.id === 'neutral') continue;
      const cities = Object.values(st.cities).filter((c) => c.owner === f.id);
      const total = cities.reduce((s, c) => s + c.troops, 0);
      f.troopsTotal = total;
    }

    return st;
  }

  // ---------------------------------------------------------------- 派生值
  function cityOf(id) { return S.cities[id]; }
  function generalsIn(cityId) { return cityOf(cityId).generals.map((id) => S.generals[id]).filter(Boolean); }
  function factionCities(fid) { return Object.values(S.cities).filter((c) => c.owner === fid); }
  function factionGenerals(fid) { return Object.values(S.generals).filter((g) => g.faction === fid); }
  function cityTroops(c) { return c.troops; }

  // 城池收入：商业 -> 金；农业 -> 粮（秋收）
  function cityIncome(c) {
    const sec = 0.55 + (c.security / 100) * 0.55;
    const dis = 1 - Math.min(0.6, c.disorder / 100);
    const gold = Math.round((c.comm * 0.62 + c.pop / 900) * sec * dis * (1 + c.tech / 2200));
    return { gold };
  }
  function cityHarvest(c) {
    const dis = 1 - Math.min(0.6, c.disorder / 100);
    return Math.round((c.agri * 1.35 + c.pop / 160) * dis * (1 + c.tech / 2600));
  }
  // 人口增长
  function cityGrowth(c) {
    const cap = (CITY_LEVEL[c.kind] || CITY_LEVEL.city).basePop * 1000 * (c.tier === 1 ? 1.35 : 1);
    const room = clamp((cap * 1.6 - c.pop) / (cap * 1.6), -0.02, 0.5);
    const dis = 1 - Math.min(0.9, c.disorder / 130);
    const g = Math.round(c.pop * (0.006 + room * 0.020) * dis * (0.6 + c.agri / 1500));
    c.pop = Math.max(1200, Math.min(cap * 1.7, c.pop + g));
    return g;
  }

  // 攻城战力评估（供 AI 与 UI 提示）
  function cityPower(c) {
    const gs = generalsIn(c.id);
    const lead = gs.length ? Math.max(...gs.map((g) => g.lead)) : 40;
    const defFactor = 1 + c.def / 420;
    return Math.round((c.troops * (0.5 + c.train / 150) + c.def * 12 * defFactor) * (0.75 + lead / 200));
  }
  function armyPower(a) {
    let p = 0;
    for (const uid2 of a.generals) {
      const g = S.generals[uid2]; if (!g) continue;
      p += g.lead * 1.4 + g.war * 1.1 + g.intel * 0.5;
    }
    p = p / Math.max(1, a.generals.length) * 0.9 + 60;
    return Math.round(a.troops * (0.5 + a.train / 150) * (p / 150));
  }

  // ---------------------------------------------------------------- 行动
  const Actions = {
    // 内政：开发农业
    develop(fid, cityId, kind) {
      const f = S.factions[fid], c = cityOf(cityId);
      const cost = kind === 'agri' ? 320 : kind === 'comm' ? 320 : kind === 'tech' ? 420 : 260;
      if (f.gold < cost) return { ok: false, msg: '金不足' };
      const best = generalsIn(cityId).filter((g) => !g.actedThisTurn);
      if (!best.length) return { ok: false, msg: '本城武将本月已行动完' };
      let stat, use;
      if (kind === 'agri') { stat = 'pol'; use = best.sort((a, b) => b.pol - a.pol)[0]; }
      else if (kind === 'comm') { stat = 'pol'; use = best.sort((a, b) => b.pol - a.pol)[0]; }
      else if (kind === 'tech') { stat = 'intel'; use = best.sort((a, b) => b.intel - a.intel)[0]; }
      else { stat = 'lead'; use = best.sort((a, b) => b.lead - a.lead)[0]; }
      const gain = Math.round(14 + use[stat] * 0.42 + rnd(18));
      f.gold -= cost;
      use.actedThisTurn = true;
      if (kind === 'agri') c.agri = Math.min(CONST.MAX_STAT, c.agri + gain);
      else if (kind === 'comm') c.comm = Math.min(CONST.MAX_STAT, c.comm + gain);
      else if (kind === 'tech') c.tech = Math.min(1200, c.tech + gain);
      else { c.def = Math.min(1200, c.def + Math.round(gain * 0.7)); c.security = Math.min(100, c.security + 3); }
      return { ok: true, msg: `${use.name} ${kind === 'agri' ? '开垦农田' : kind === 'comm' ? '兴修市集' : kind === 'tech' ? '钻研技术' : '修缮城防'} +${gain}`, general: use.name, gain };
    },
    // 治安
    patrol(fid, cityId) {
      const f = S.factions[fid], c = cityOf(cityId);
      if (f.gold < 180) return { ok: false, msg: '金不足' };
      const gs = generalsIn(cityId).filter((g) => !g.actedThisTurn);
      if (!gs.length) return { ok: false, msg: '无可用武将' };
      const use = gs.sort((a, b) => (b.charm + b.war) - (a.charm + a.war))[0];
      f.gold -= 180; use.actedThisTurn = true;
      const gain = Math.round(6 + use.charm * 0.10 + use.war * 0.04);
      c.security = Math.min(100, c.security + gain);
      c.disorder = Math.max(0, c.disorder - gain * 0.9);
      c.morale = Math.min(100, c.morale + 2);
      return { ok: true, msg: `${use.name} 巡查治安 +${gain}`, general: use.name, gain };
    },
    // 征兵
    recruit(fid, cityId, amount) {
      const f = S.factions[fid], c = cityOf(cityId);
      const maxByPop = Math.floor(c.pop * CONST.RECRUIT_PER_POP * (0.4 + c.security / 160));
      const room = Math.max(0, Math.min(maxByPop, CONST.MAX_TROOPS - c.troops));
      if (room < 100) return { ok: false, msg: '人口不足或已达兵力上限' };
      const n = Math.min(amount || room, room);
      const cost = Math.round(n * 0.11);      // 每兵 0.11 金
      const foodCost = Math.round(n * 0.35);
      if (f.gold < cost) return { ok: false, msg: `需 ${cost} 金` };
      const gs = generalsIn(cityId).filter((g) => !g.actedThisTurn);
      if (!gs.length) return { ok: false, msg: '无可用武将主持征兵' };
      const use = gs.sort((a, b) => b.charm - a.charm)[0];
      f.gold -= cost; f.food = Math.max(0, f.food - foodCost);
      use.actedThisTurn = true;
      const moralePenalty = n / Math.max(1, maxByPop);
      c.troops += n;
      c.pop = Math.max(1000, c.pop - Math.round(n * 1.7));
      c.disorder = clamp(c.disorder + moralePenalty * 12, 0, 100);
      c.morale = clamp(c.morale - moralePenalty * 10, 10, 100);
      return { ok: true, msg: `${use.name} 征募新兵 ${n}（耗金 ${cost}）`, general: use.name, troops: n, cost };
    },
    // 训练
    train(fid, cityId) {
      const f = S.factions[fid], c = cityOf(cityId);
      if (f.gold < 220) return { ok: false, msg: '金不足' };
      const gs = generalsIn(cityId).filter((g) => !g.actedThisTurn);
      if (!gs.length) return { ok: false, msg: '无可用武将' };
      const use = gs.sort((a, b) => b.lead - a.lead)[0];
      f.gold -= 220; use.actedThisTurn = true;
      const gain = Math.round(4 + use.lead * 0.09 + rnd(4));
      c.train = Math.min(100, c.train + gain);
      return { ok: true, msg: `${use.name} 操练士卒 训练+${gain}`, general: use.name, gain };
    },
    // 运输（粮草调拨）
    transport(fid, fromId, toId, amount) {
      const f = S.factions[fid], a = cityOf(fromId), b = cityOf(toId);
      if (a.food < amount) return { ok: false, msg: '粮草不足' };
      if (!areAdjacent(fromId, toId)) return { ok: false, msg: '两城不相邻，无法运输' };
      a.food -= amount;
      b.food += Math.round(amount * 0.92);      // 途中损耗
      return { ok: true, msg: `自 ${a.name} 运粮 ${amount} 至 ${b.name}（损耗 8%）` };
    },
    // 调动武将
    transferGeneral(gid, toCityId, fid) {
      const g = S.generals[gid], to = cityOf(toCityId);
      if (!g || to.owner !== fid) return { ok: false, msg: '无法调动' };
      if (g.army) return { ok: false, msg: '该武将正在出征中' };
      if (g.city && S.cities[g.city]) {
        const arr = S.cities[g.city].generals;
        const i = arr.indexOf(gid); if (i >= 0) arr.splice(i, 1);
      }
      g.city = toCityId; to.generals.push(gid);
      return { ok: true, msg: `${g.name} 调往 ${to.name}` };
    },
    // 登用（招募在野武将）
    recruitGeneral(fid, cityId, targetGid) {
      const f = S.factions[fid], c = cityOf(cityId), t = S.generals[targetGid];
      if (!t || t.faction !== 'neutral') return { ok: false, msg: '此人不在此地' };
      const gs = generalsIn(cityId).filter((g) => !g.actedThisTurn);
      if (!gs.length) return { ok: false, msg: '无可用武将前往说服' };
      if (f.gold < 400) return { ok: false, msg: '需 400 金作聘礼' };
      const use = gs.sort((a, b) => b.charm - a.charm)[0];
      f.gold -= 400; use.actedThisTurn = true;
      const chance = clamp(0.20 + (use.charm - t.charm) / 260 + use.intel / 900 + f.gold / 200000, 0.05, 0.9);
      if (Math.random() < chance) {
        // 从原城移除
        const oc = S.cities[t.city];
        if (oc) { const i = oc.generals.indexOf(t.id); if (i >= 0) oc.generals.splice(i, 1); }
        t.faction = fid; t.city = cityId; c.generals.push(t.id); t.loyalty = 70 + rnd(15);
        S.stats.generalsRecruited++;
        return { ok: true, msg: `${use.name} 说服 ${t.name} 归顺！`, general: t.name, success: true };
      }
      return { ok: true, msg: `${use.name} 登用 ${t.name} 未成（成算 ${(chance * 100).toFixed(0)}%）`, success: false };
    },
  };

  // 城池邻接：关隘连所护城池、距离阈值内互连、kNN 保底连通
  // 半径 2.5°（约 250~280km）时平均相邻 7.5 城、平均 4.5 跳，接近三国志系列的州郡纵深
  const ADJ_RADIUS = 2.5;
  const ADJ_KNN = 3;
  function buildAdjacency() {
    const ids = Object.keys(S.cities);
    const adj = {};
    ids.forEach((i) => (adj[i] = new Set()));
    const dist = (a, b) => Math.hypot((a.lon - b.lon) * 0.95, a.lat - b.lat);
    // 关隘/水寨与所护城池相连
    for (const c of Object.values(S.cities)) {
      for (const g of c.guards || []) if (S.cities[g]) { adj[c.id].add(g); adj[g].add(c.id); }
    }
    // 关隘/水寨再连最近 2 城，避免只靠 guards 而孤立
    for (const s of Object.values(S.cities)) {
      if (s.kind !== 'pass' && s.kind !== 'port') continue;
      Object.values(S.cities).filter((t) => t.id !== s.id)
        .map((t) => ({ t, d: dist(s, t) })).sort((a, b) => a.d - b.d).slice(0, 2)
        .forEach(({ t }) => { adj[s.id].add(t.id); adj[t.id].add(s.id); });
    }
    // 距离阈值内互连
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = S.cities[ids[i]], b = S.cities[ids[j]];
        if (dist(a, b) < ADJ_RADIUS) { adj[a.id].add(b.id); adj[b.id].add(a.id); }
      }
    }
    // kNN 保底：边远城池至少连上最近的几个
    for (const s of Object.values(S.cities)) {
      const k = adj[s.id].size >= 2 ? 0 : ADJ_KNN;
      if (!k) continue;
      Object.values(S.cities).filter((t) => t.id !== s.id)
        .map((t) => ({ t, d: dist(s, t) })).sort((a, b) => a.d - b.d).slice(0, k)
        .forEach(({ t }) => { adj[s.id].add(t.id); adj[t.id].add(s.id); });
    }
    S.adj = {};
    for (const k in adj) S.adj[k] = [...adj[k]];
    return S.adj;
  }
  function areAdjacent(a, b) { return S.adj && S.adj[a] && S.adj[a].includes(b); }
  function neighbors(id) { return (S.adj && S.adj[id]) || []; }

  // 寻路（BFS，返回城池 id 路径）
  function findPath(from, to, opts) {
    opts = opts || {};
    if (from === to) return [from];
    const prev = { [from]: null }, q = [from];
    while (q.length) {
      const cur = q.shift();
      for (const nb of neighbors(cur)) {
        if (nb in prev) continue;
        if (opts.blocked && opts.blocked.has(nb) && nb !== to) continue;
        prev[nb] = cur;
        if (nb === to) {
          const path = []; let x = to;
          while (x) { path.unshift(x); x = prev[x]; }
          return path;
        }
        q.push(nb);
      }
    }
    return null;
  }

  // ---------------------------------------------------------------- 外交
  function warKey(a, b) { return a < b ? a + '|' + b : b + '|' + a; }
  function atWar(a, b) { return a !== b && !!S.war[warKey(a, b)]; }
  function setWar(a, b, on) {
    if (a === b) return;
    const k = warKey(a, b);
    if (on) S.war[k] = true; else { delete S.war[k]; delete S.truce[k]; }
  }
  function setTruce(a, b, months) { const k = warKey(a, b); delete S.war[k]; S.truce[k] = months; }

  // ---------------------------------------------------------------- 出兵
  function formArmy(fid, cityId, generalIds, troops, target) {
    const f = S.factions[fid], c = cityOf(cityId);
    if (c.troops < troops) return { ok: false, msg: '本城兵力不足' };
    const gs = generalIds.map((id) => S.generals[id]).filter(Boolean);
    if (!gs.length) return { ok: false, msg: '需指派武将' };
    if (gs.some((g) => g.army)) return { ok: false, msg: '武将在外' };
    // 粮草：出征携带
    const carry = Math.min(f.food, Math.round(troops * 6));
    f.food -= carry;
    c.troops -= troops;
    const a = {
      id: 'A' + (S.nextArmyId++),
      faction: fid,
      generals: gs.map((g) => g.id),
      troops,
      food: carry,
      train: c.train,
      morale: c.morale,
      from: cityId,
      at: cityId,
      path: [],
      move: CONST.BASE_MOVE,
      moveLeft: CONST.BASE_MOVE,
      target: target || null,
      state: 'idle',           // idle | moving | sieging | battle
      siegeProgress: 0,
    };
    gs.forEach((g) => { g.army = a.id; g.actedThisTurn = true; });
    S.armies.push(a);
    return { ok: true, msg: `${gs.map((g) => g.name).join('、')} 率 ${troops} 兵出征`, army: a };
  }

  // 部队行军一回合
  function marchArmy(a, destCityId) {
    if (!atWar(a.faction, S.cities[destCityId] ? S.cities[destCityId].owner : '')) {
      // 非敌对则视为调动
    }
    const path = findPath(a.at, destCityId);
    if (!path) return { ok: false, msg: '无路可通' };
    a.path = path.slice(1);
    a.target = destCityId;
    a.state = 'moving';
    return { ok: true, msg: '开始行军', path: a.path };
  }

  function stepArmy(a) {
    if (a.state !== 'moving' || !a.path.length) return null;
    let steps = a.moveLeft;
    const events = [];
    while (steps > 0 && a.path.length) {
      const next = a.path[0];
      const nc = S.cities[next];
      // 消耗粮草（每步）
      const cost = Math.round(a.troops * 0.02) + 120;
      a.food -= cost;
      a.moveLeft -= 1; steps -= 1;
      if (a.food <= 0) {
        // 断粮：溃散
        const loss = Math.round(a.troops * 0.28);
        a.troops -= loss;
        a.morale = clamp(a.morale - 25, 0, 100);
        events.push({ type: 'starve', army: a.id, loss, msg: `${armyName(a)} 粮尽，士卒逃散 ${loss}` });
        if (a.troops < 300) {
          events.push({ type: 'destroy', army: a.id, msg: `${armyName(a)} 因粮尽而溃散` });
          disbandArmy(a);
          return events;
        }
        break;
      }
      if (nc.owner === a.faction) {
        // 己方城池：补给
        a.at = next; a.path.shift();
        const resupply = Math.min(nc.food, Math.round(a.troops * 3));
        nc.food -= resupply; a.food += resupply;
        events.push({ type: 'resupply', army: a.id, amount: resupply, msg: `${armyName(a)} 于 ${nc.name} 补给粮草 ${resupply}` });
      } else {
        // 敌城：停下准备攻城/决战
        a.at = next;
        a.state = 'sieging';
        events.push({ type: 'arrive', army: a.id, city: next, msg: `${armyName(a)} 兵临 ${nc.name} 城下` });
        break;
      }
    }
    return events;
  }

  function armyName(a) {
    return a.generals.map((id) => (S.generals[id] ? S.generals[id].name : '?')).join('、');
  }
  function disbandArmy(a) {
    a.generals.forEach((id) => { const g = S.generals[id]; if (g) { g.army = null; g.city = a.at; if (S.cities[a.at]) S.cities[a.at].generals.push(id); } });
    const i = S.armies.indexOf(a); if (i >= 0) S.armies.splice(i, 1);
  }
  function armiesAt(cityId) { return S.armies.filter((a) => a.at === cityId); }

  // ---------------------------------------------------------------- 回合
  function beginTurn() {
    for (const g of Object.values(S.generals)) g.actedThisTurn = false;
    for (const a of S.armies) {
      a.moveLeft = CONST.BASE_MOVE;
      // 部队日常耗粮
      const eat = Math.round(a.troops * 0.012) + 60;
      a.food -= eat;
      if (a.food <= 0) {
        const loss = Math.round(a.troops * CONST.STARVE_LOSS);
        a.troops -= loss;
        a.morale = clamp(a.morale - 12, 0, 100);
        addLog(`${armyName(a)} 断粮，损兵 ${loss}`, 'warn');
      }
    }
  }

  function factionTick(fid) {
    const f = S.factions[fid];
    if (!f || f.id === 'neutral' || !f.alive) return [];
    const ev = [];
    const cities = factionCities(fid);
    if (!cities.length) { f.alive = false; return ev; }

    // 收入
    let gold = 0, harvest = 0;
    for (const c of cities) {
      const inc = cityIncome(c);
      gold += inc.gold;
      c.gold = Math.min(c.gold + inc.gold, 400000);
      cityGrowth(c);
      c.disorder = Math.max(0, c.disorder - 2 + (c.troops > c.pop * 0.35 ? 3 : 0));
      c.morale = clamp(c.morale + (c.disorder < 30 ? 2 : -1), 10, 100);
      if (S.month === 9 || S.month === 3) {
        const hv = cityHarvest(c);
        harvest += hv;
        c.food += hv;
      }
      // 城内耗粮
      const need = Math.round(c.troops * 0.010) + Math.round(c.pop / 900);
      if (c.food < need) {
        c.food = 0;
        const loss = Math.round(c.troops * 0.06);
        c.troops = Math.max(0, c.troops - loss);
        c.morale = clamp(c.morale - 8, 5, 100);
        ev.push({ type: 'famine', city: c.id, msg: `${c.name} 粮尽，逃兵 ${loss}` });
      } else c.food -= need;
    }
    f.gold += gold;
    S.stats.goldEarned = (S.stats.goldEarned || 0) + gold;
    f.lastGold = gold; f.lastHarvest = harvest;
    return ev;
  }

  function endTurn() {
    const ev = [];
    // 所有势力结算
    for (const f of Object.values(S.factions)) {
      if (f.id === 'neutral' || !f.alive) continue;
      ev.push(...factionTick(f.id));
    }
    // 部队行军
    for (const a of [...S.armies]) ev.push(...(stepArmy(a) || []));
    // 时间推进
    S.month += CONST.TURN_MONTHS;
    if (S.month > 12) { S.month = 1; S.year++; }
    S.turn++;
    // 停战倒计时
    for (const k of Object.keys(S.truce)) { S.truce[k]--; if (S.truce[k] <= 0) delete S.truce[k]; }
    return ev;
  }

  function addLog(text, kind) {
    S.log.push({ t: `${S.year}年${S.month}月`, text, kind: kind || 'info', turn: S.turn });
    if (S.log.length > 400) S.log.shift();
  }

  // ---------------------------------------------------------------- AI
  function aiFaction(fid) {
    const f = S.factions[fid];
    if (!f || !f.alive || f.id === 'neutral') return [];
    const ev = [];
    const cities = factionCities(fid).sort((a, b) => b.tier - a.tier || b.pop - a.pop);
    if (!cities.length) { f.alive = false; return ev; }

    // 1) 内政：优先补短板
    for (const c of cities) {
      const gs = () => generalsIn(c.id).filter((g) => !g.actedThisTurn);
      let guard = 0;
      while (gs().length && guard++ < 4) {
        const needRecruit = c.troops < 6000 && c.pop > 9000 && f.gold > 1500;
        const needFood = c.food < c.troops * 0.6;
        if (needRecruit) {
          const r = Actions.recruit(fid, c.id, Math.round(Math.min(c.pop * 0.02, 9000)));
          if (!r.ok) break;
        } else if (needFood && c.agri < 900 && f.gold > 900) {
          const r = Actions.develop(fid, c.id, 'agri'); if (!r.ok) break;
        } else if (c.comm < c.agri - 120 && f.gold > 900) {
          const r = Actions.develop(fid, c.id, 'comm'); if (!r.ok) break;
        } else if (c.agri < c.comm - 120 && f.gold > 900) {
          const r = Actions.develop(fid, c.id, 'agri'); if (!r.ok) break;
        } else if (c.train < 70 && f.gold > 1200) {
          const r = Actions.train(fid, c.id); if (!r.ok) break;
        } else if (c.def < 400 && f.gold > 1400 && c.kind !== 'pass') {
          const r = Actions.develop(fid, c.id, 'def'); if (!r.ok) break;
        } else if (c.disorder > 15 && f.gold > 800) {
          const r = Actions.patrol(fid, c.id); if (!r.ok) break;
        } else break;
      }
      // 登用在野
      if (f.gold > 2500) {
        const neutrals = generalsIn(c.id).filter((g) => g.faction === 'neutral');
        const good = neutrals.sort((a, b) => (b.lead + b.war + b.intel) - (a.lead + a.war + a.intel))[0];
        if (good && (good.lead + good.war + good.intel) > 200) Actions.recruitGeneral(fid, c.id, good.id);
      }
    }

    // 2) 军事：找可攻目标
    const enemies = [...new Set(cities.flatMap((c) => neighbors(c.id)))]
      .filter((nid) => S.cities[nid] && S.cities[nid].owner !== fid && S.cities[nid].owner !== 'neutral' && atWar(fid, S.cities[nid].owner));
    const neutrals = [...new Set(cities.flatMap((c) => neighbors(c.id)))]
      .filter((nid) => S.cities[nid] && S.cities[nid].owner === 'neutral');

    let target = null;
    const pool = enemies.length ? enemies : [];
    if (pool.length) {
      // 选最弱的目标
      target = pool.map((nid) => ({ nid, c: S.cities[nid] }))
        .sort((a, b) => cityPower(a.c) - cityPower(b.c))[0];
      target = target && target.c;
    } else if (neutrals.length && Math.random() < f.ai.aggression * 0.5) {
      target = S.cities[neutrals[0]];
    }

    if (target && f.food > 12000) {
      // 从最近的强城出兵
      const src = cities.map((c) => ({ c, d: Math.hypot(c.lon - target.lon, c.lat - target.lat) }))
        .filter((x) => x.c.troops > 8000)
        .sort((a, b) => a.d - b.d)[0];
      if (src) {
        const avail = generalsIn(src.c.id).filter((g) => !g.army)
          .sort((a, b) => (b.lead + b.war + b.intel) - (a.lead + a.war + a.intel)).slice(0, 3);
        if (avail.length) {
          const send = Math.round(src.c.troops * (0.5 + f.ai.aggression * 0.35));
          const r = formArmy(fid, src.c.id, avail.map((g) => g.id), send, target.id);
          if (r.ok) {
            marchArmy(r.army, target.id);
            ev.push({ type: 'ai_attack', msg: `${f.name}军 ${armyName(r.army)} 自 ${src.c.name} 出阵，兵锋直指 ${target.name}`, army: r.army.id, target: target.id });
          }
        }
      }
    }

    // 3) 运输：把粮草送到前线
    for (const c of cities) {
      if (c.food < c.troops * 0.5) {
        const donor = cities.filter((d) => d.id !== c.id && d.food > 30000 && areAdjacent(d.id, c.id))
          .sort((a, b) => b.food - a.food)[0];
        if (donor) Actions.transport(fid, donor.id, c.id, Math.min(donor.food - 20000, Math.round(c.troops * 1.2)));
      }
    }

    // 4) 外交：弱国求和
    const myPower = factionPower(fid);
    for (const other of Object.values(S.factions)) {
      if (other.id === fid || other.id === 'neutral' || !other.alive) continue;
      if (!atWar(fid, other.id)) continue;
      const op = factionPower(other.id);
      if (myPower < op * 0.45 && Math.random() < 0.25) {
        setTruce(fid, other.id, 6 + rnd(6));
        ev.push({ type: 'diplomacy', msg: `${f.name} 向 ${other.name} 遣使求和` });
      }
    }
    return ev;
  }

  function factionPower(fid) {
    const cs = factionCities(fid);
    return cs.reduce((s, c) => s + c.troops + c.def * 8, 0) + factionGenerals(fid).length * 40;
  }

  // 初始化交战关系：相邻不同势力自动交战
  function initWars() {
    for (const c of Object.values(S.cities)) {
      for (const nid of neighbors(c.id)) {
        const n = S.cities[nid];
        if (!n) continue;
        if (c.owner !== n.owner && c.owner !== 'neutral' && n.owner !== 'neutral') setWar(c.owner, n.owner, true);
      }
    }
  }

  // ---------------------------------------------------------------- 导出
  window.GameCore = {
    CONST, CITY_LEVEL,
    get S() { return S; },
    set S(v) { S = v; },
    newState, buildAdjacency, initWars,
    cityOf, generalsIn, factionCities, factionGenerals, cityIncome, cityHarvest, cityPower, armyPower,
    factionPower, Actions, neighbors, areAdjacent, findPath, atWar, setWar, setTruce, warKey,
    formArmy, marchArmy, stepArmy, disbandArmy, armiesAt, armyName,
    beginTurn, endTurn, factionTick, aiFaction, addLog,
  };
})();
