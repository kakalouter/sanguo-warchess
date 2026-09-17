// ===========================================================================
// 主控制器 —— 游戏流程、界面绑定、战斗衔接
// ===========================================================================
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const GC = () => window.GameCore;
  let S = null;
  let selCity = null, selArmy = null;
  let B = null, bt = null;          // battle render state
  let btSel = null, btMode = null;  // 'move' | 'attack' | null
  let btAuto = false;
  let busy = false;

  // ------------------------------------------------------------- 工具
  function toast(text, kind, ms) {
    const el = document.createElement('div');
    el.className = 'toast ' + (kind || '');
    el.textContent = text;
    $('toastLayer').appendChild(el);
    setTimeout(() => { el.style.transition = 'opacity .4s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 420); }, ms || 2600);
  }
  function fmt(n) { return (n || 0).toLocaleString('zh-CN'); }
  function modal(title, html) {
    $('modalTitle').textContent = title;
    $('modalBody').innerHTML = html;
    $('modal').classList.remove('hidden');
  }
  function closeModal() { $('modal').classList.add('hidden'); }

  async function paintPortrait(canvas, g, size) {
    canvas.width = size; canvas.height = size;
    await window.Portraits.paint(canvas, g, { size, faction: g && g.faction ? window.SANGUO_FACTIONS[g.faction] : null });
  }

  // ------------------------------------------------------------- 顶栏
  function refreshTop() {
    const f = S.factions[S.player];
    const fb = $('factionBadge');
    fb.querySelector('.fb-flag').style.background = f.color;
    fb.querySelector('.fb-flag').style.color = f.color;
    fb.querySelector('.fb-name').textContent = f.name + ' 军';
    $('dateBox').textContent = `${S.year}年 ${S.month}月 · 第${S.turn}回合`;
    const cities = GC().factionCities(S.player);
    $('resGold').textContent = fmt(f.gold);
    $('resFood').textContent = fmt(f.food);
    $('resTroops').textContent = fmt(cities.reduce((s, c) => s + c.troops, 0));
    $('resCities').textContent = cities.length;
    $('resGenerals').textContent = GC().factionGenerals(S.player).filter((g) => g.faction === S.player).length;
  }

  function refreshPowerList() {
    const box = $('powerList');
    const list = Object.values(S.factions).filter((f) => f.id !== 'neutral')
      .map((f) => {
        const cs = GC().factionCities(f.id);
        return { f, cities: cs.length, troops: cs.reduce((s, c) => s + c.troops, 0), gens: GC().factionGenerals(f.id).length };
      })
      .sort((a, b) => (b.cities * 100 + b.troops / 100) - (a.cities * 100 + a.troops / 100));
    box.innerHTML = '';
    for (const it of list) {
      const rel = it.f.id === S.player ? 'me' : (GC().atWar(S.player, it.f.id) ? 'war' : (S.truce[GC().warKey(S.player, it.f.id)] ? 'truce' : 'neutral'));
      const row = document.createElement('div');
      row.className = 'power-row' + (it.f.alive === false || it.cities === 0 ? ' dead' : '') + (it.f.id === S.player ? ' me' : '');
      row.innerHTML = `<span class="pw-flag" style="background:${it.f.color}"></span>
        <span class="pw-name">${it.f.name}</span>
        <span class="pw-stat">${it.cities}城 ${fmt(it.troops)}兵</span>
        <span class="pw-rel rel-${rel}">${rel === 'me' ? '我' : rel === 'war' ? '战' : rel === 'truce' ? '和' : '中'}</span>`;
      row.onclick = () => showPowerInfo(it.f.id);
      box.appendChild(row);
    }
  }

  function showPowerInfo(fid) {
    const f = S.factions[fid];
    const cs = GC().factionCities(fid);
    const gs = GC().factionGenerals(fid).sort((a, b) => (b.lead + b.war + b.intel) - (a.lead + a.war + a.intel));
    const lord = f.lordId ? S.generals[f.lordId] : null;
    let h = `<div class="sect-title">${f.name} 军 · ${f.trait || ''}</div>
      <div class="kv"><span>君主</span><span>${lord ? lord.name : '—'}</span></div>
      <div class="kv"><span>城池</span><span>${cs.length} 座</span></div>
      <div class="kv"><span>总兵力</span><span>${fmt(cs.reduce((s, c) => s + c.troops, 0))}</span></div>
      <div class="kv"><span>金 / 粮</span><span>${fmt(f.gold)} / ${fmt(f.food)}</span></div>
      <div class="kv"><span>战力评估</span><span>${fmt(GC().factionPower(fid))}</span></div>
      <div style="font-size:12px;color:var(--paper-dim);line-height:1.8;margin-top:9px">${f.desc || ''}</div>
      <div class="sect-title">城池 (${cs.length})</div><div style="font-size:12.5px;line-height:2;color:#c0b6a0">${cs.map((c) => `<span style="color:${f.color}">◆</span> ${c.name}`).join('　')}</div>
      <div class="sect-title">武将 (${gs.length})</div><div class="grid-cards" id="pwGens"></div>`;
    modal(f.name + ' 军', h);
    const box = $('pwGens');
    gs.slice(0, 60).forEach((g) => {
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `<div class="card-h"><canvas></canvas><div><div class="card-t">${g.name}</div>
        <div class="card-s">统${g.lead} 武${g.war} 智${g.intel}</div></div></div>`;
      card.onclick = () => showGeneral(g.id);
      box.appendChild(card);
      paintPortrait(card.querySelector('canvas'), g, 44);
    });
    if (gs.length > 60) box.insertAdjacentHTML('afterend', `<div style="font-size:12px;color:var(--paper-dim);margin-top:8px">…… 另有 ${gs.length - 60} 名武将</div>`);
  }

  function showGeneral(gid) {
    const g = S.generals[gid];
    const f = S.factions[g.faction] || { name: '在野', color: '#888' };
    const apt = (k, v) => `<span class="apt-b apt-${v}">${k} ${v}</span>`;
    const sp = window.Battle.generalSpecial(g);
    const grade = (v) => v >= 90 ? 'attr-hi' : v >= 75 ? 'attr-mid' : 'attr-lo';
    const h = `<div class="gen-row">
        <canvas id="gBig"></canvas>
        <div class="gen-info">
          <div class="gen-name">${g.name} <span style="font-size:12px;color:${f.color}">${f.name}</span>${g.isLord ? ' <span class="tag" style="color:var(--gold)">君主</span>' : ''}</div>
          <div class="gen-attrs">
            <div class="attr ${grade(g.lead)}"><b>${g.lead}</b><span>统率</span></div>
            <div class="attr ${grade(g.war)}"><b>${g.war}</b><span>武力</span></div>
            <div class="attr ${grade(g.intel)}"><b>${g.intel}</b><span>智力</span></div>
            <div class="attr ${grade(g.pol)}"><b>${g.pol}</b><span>政治</span></div>
            <div class="attr ${grade(g.charm)}"><b>${g.charm}</b><span>魅力</span></div>
          </div>
          <div class="apt-row">${apt('枪', g.gun)}${apt('戟', g.hal)}${apt('弩', g.xbow)}${apt('骑', g.ride)}${apt('器', g.wep)}${apt('水', g.wat)}</div>
          <div class="up-sp">战法：<b style="color:var(--gold)">${sp.name}</b> — ${sp.desc}（威力 ×${sp.mult.toFixed(2)}${sp.aoe ? '，范围伤害' : ''}${sp.noRetal ? '，不被反击' : ''}）</div>
          <div class="gen-bio" id="gBio" style="margin-top:8px">${(g.bio || '暂无列传。').replace(/演:/g, '<br><b style="color:var(--gold)">演义</b>：').replace(/史:/g, '<br><b style="color:var(--gold)">正史</b>：')}</div>
        </div></div>
      <div style="font-size:12px;color:var(--paper-dim);margin-top:6px">所在：${g.army ? '出征中' : (S.cities[g.city] ? S.cities[g.city].name : '—')}　忠诚：${g.loyalty}</div>`;
    modal('武将', h);
    paintPortrait($('gBig'), g, 92);
  }

  // ------------------------------------------------------------- 城池面板
  function showCity(cid) {
    const c = S.cities[cid];
    if (!c) return;
    selCity = cid; selArmy = null;
    const f = S.factions[c.owner];
    const isMine = c.owner === S.player;
    $('cityName').textContent = c.name;
    $('cityKind').textContent = (GC().CITY_LEVEL[c.kind] || {}).label || '';
    $('cityOwner').innerHTML = `归属：<span style="color:${f.color}">${f.name}</span> · ${c.prov} · ${c.region}${c.desc ? ' · ' + c.desc : ''}`;

    const bar = (cls, label, val, max, txt) => `<div class="stat ${cls}"><span class="stat-l">${label}</span>
      <span class="stat-bar"><i style="width:${Math.min(100, val / max * 100)}%"></i></span>
      <span class="stat-v">${txt != null ? txt : val}</span></div>`;
    $('cityStats').innerHTML =
      bar('s-agri', '农业', c.agri, 1600, c.agri) +
      bar('s-comm', '商业', c.comm, 1600, c.comm) +
      bar('s-tech', '技术', c.tech, 1200, c.tech) +
      bar('s-def', '城防', c.def, 1200, c.def) +
      bar('s-train', '训练', c.train, 100, c.train) +
      bar('s-morale', '民心', c.morale, 100, c.morale) +
      bar('s-sec', '治安', c.security, 100, c.security) +
      bar('s-pop', '人口', c.pop, 90000, fmt(c.pop)) +
      bar('s-troops', '兵力', c.troops, 200000, fmt(c.troops)) +
      bar('s-food', '兵粮', c.food, 200000, fmt(c.food)) +
      `<div class="stat"><span class="stat-l">月收</span><span class="stat-bar"></span><span class="stat-v" style="color:#e8c86a">${fmt(GC().cityIncome(c).gold)} 金</span></div>` +
      `<div class="stat"><span class="stat-l">城防</span><span class="stat-bar"></span><span class="stat-v" style="color:#e08a6a">${c.def} / 战力 ${fmt(GC().cityPower(c))}</span></div>`;

    // 武将
    const gs = GC().generalsIn(cid).sort((a, b) => (b.isLord - a.isLord) || (b.lead + b.war) - (a.lead + a.war));
    const gbox = $('cityGenerals');
    gbox.innerHTML = gs.length ? '' : '<div style="font-size:12px;color:var(--paper-dim)">此城无武将驻守</div>';
    gs.forEach((g) => {
      const chip = document.createElement('div');
      chip.className = 'gen-chip' + (g.isLord ? ' lord' : '') + (g.actedThisTurn && isMine ? ' acted' : '');
      const top = ['gun', 'hal', 'xbow', 'ride', 'wep', 'wat'].map((k) => g[k]).sort().pop();
      chip.innerHTML = `<canvas></canvas><span>${g.name}</span><i class="apt">${top}</i>`;
      chip.onclick = () => showGeneral(g.id);
      gbox.appendChild(chip);
      paintPortrait(chip.querySelector('canvas'), g, 52);
    });

    // 行动
    const ab = $('cityActions');
    ab.innerHTML = '';
    if (isMine) {
      const addBtn = (label, fn, tip, dis) => {
        const b = document.createElement('button');
        b.className = 'btn btn-sm'; b.textContent = label;
        if (dis) b.disabled = true;
        if (tip) b.title = tip;
        b.onclick = fn;
        ab.appendChild(b);
      };
      addBtn('开垦', () => doAction('develop', { kind: 'agri' }), '金 320，政治高者效率更高');
      addBtn('兴商', () => doAction('develop', { kind: 'comm' }), '金 320');
      addBtn('技术', () => doAction('develop', { kind: 'tech' }), '金 420，提升收入与产量');
      addBtn('修城', () => doAction('develop', { kind: 'def' }), '金 260，提升城防');
      addBtn('治安', () => doAction('patrol'), '金 180');
      addBtn('征兵', () => openRecruit(), '按人口上限征兵');
      addBtn('训练', () => doAction('train'), '金 220，提升训练度');
      addBtn('登用', () => openRecruitGeneral(), '说服在野武将');
      addBtn('出兵', () => openFormArmy(), '组建军团出征');
      addBtn('运输', () => openTransport(), '向相邻城池调拨粮草');
      addBtn('任命', () => openTransfer(), '在本势力城池间调动武将');
    } else {
      const b = document.createElement('button');
      b.className = 'btn btn-sm btn-primary';
      b.textContent = GC().atWar(S.player, c.owner) ? '出兵攻打' : '不可攻击（未交战）';
      b.disabled = !GC().atWar(S.player, c.owner);
      b.onclick = () => openFormArmy(cid);
      ab.appendChild(b);
    }
    refreshTop();
    const fit = window.MapView.minDistance ? window.MapView.minDistance() * 1.5 : 34;
    window.MapView.focusOn(c.lon, c.lat, Math.max(fit, 10));
  }

  function curCity() { return selCity ? S.cities[selCity] : null; }

  async function doAction(kind, extra) {
    if (busy) return;
    const c = curCity(); if (!c) return;
    busy = true;
    let r;
    if (kind === 'develop') r = GC().Actions.develop(S.player, c.id, extra.kind);
    else if (kind === 'patrol') r = GC().Actions.patrol(S.player, c.id);
    else if (kind === 'train') r = GC().Actions.train(S.player, c.id);
    else if (kind === 'recruit') r = GC().Actions.recruit(S.player, c.id, extra.amount);
    if (r) toast(r.msg, r.ok ? 'good' : 'warn');
    if (r && r.ok) GC().addLog(`【内政】${r.msg}`);
    busy = false;
    showCity(c.id);
  }

  function openRecruit() {
    const c = curCity();
    const maxByPop = Math.floor(c.pop * GC().CONST.RECRUIT_PER_POP * (0.4 + c.security / 160));
    const room = Math.max(0, Math.min(maxByPop, GC().CONST.MAX_TROOPS - c.troops));
    const h = `<div class="sect-title">${c.name} · 征兵</div>
      <div class="kv"><span>现有人口</span><span>${fmt(c.pop)}</span></div>
      <div class="kv"><span>现有兵力</span><span>${fmt(c.troops)}</span></div>
      <div class="kv"><span>可征上限</span><span>${fmt(room)}</span></div>
      <div class="kv"><span>每千金可征</span><span>约 ${fmt(Math.floor(1000 / 0.11))} 兵</span></div>
      <div class="kv"><span>现有金钱</span><span>${fmt(S.factions[S.player].gold)}（可征约 ${fmt(Math.floor(S.factions[S.player].gold / 0.11))}）</span></div>
      <div class="kv"><span>征兵消耗粮草</span><span>每兵 0.35 粮</span></div>
      <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">
        ${[2000, 5000, 10000, 20000, 50000].filter((n) => n <= room).map((n) => `<button class="btn btn-sm" data-n="${n}">征 ${fmt(n)}（金 ${fmt(Math.round(n * 0.11))}）</button>`).join('')}
        <button class="btn btn-sm btn-primary" data-n="${room}">征满 ${fmt(room)}（金 ${fmt(Math.round(room * 0.11))}）</button>
      </div>
      <div style="margin-top:12px;font-size:12px;color:var(--paper-dim);line-height:1.8">征兵会消耗人口、提高民怨、降低民心。民心低则收入与产量下降。</div>`;
    modal('征兵', h);
    $('modalBody').querySelectorAll('button[data-n]').forEach((b) => {
      b.onclick = () => { closeModal(); doAction('recruit', { amount: Number(b.dataset.n) }); };
    });
  }

  function openRecruitGeneral() {
    const c = curCity();
    const neutrals = GC().generalsIn(c.id).filter((g) => g.faction === 'neutral')
      .sort((a, b) => (b.lead + b.war + b.intel) - (a.lead + a.war + a.intel));
    const myBest = GC().generalsIn(c.id).filter((g) => g.faction === S.player && !g.actedThisTurn)
      .sort((a, b) => b.charm - a.charm)[0];
    if (!neutrals.length) { toast('此城无在野之士', 'warn'); return; }
    const h = `<div class="sect-title">${c.name} · 登用在野</div>
      <div class="kv"><span>说服者</span><span>${myBest ? myBest.name + '（魅力 ' + myBest.charm + '）' : '无可用武将'}</span></div>
      <div class="grid-cards" id="rgList"></div>`;
    modal('登用', h);
    const box = $('rgList');
    neutrals.slice(0, 40).forEach((g) => {
      const ch = myBest ? Math.max(0.05, Math.min(0.9, 0.20 + (myBest.charm - g.charm) / 260 + myBest.intel / 900 + S.factions[S.player].gold / 200000)) : 0;
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `<div class="card-h"><canvas></canvas><div><div class="card-t">${g.name}</div>
        <div class="card-s">统${g.lead} 武${g.war} 智${g.intel}<br>成算 ${(ch * 100).toFixed(0)}% · 需 400 金</div></div></div>`;
      card.onclick = async () => {
        const r = GC().Actions.recruitGeneral(S.player, c.id, g.id);
        toast(r.msg, r.ok && r.success ? 'good' : 'warn');
        GC().addLog(`【登用】${r.msg}`);
        closeModal(); showCity(c.id);
      };
      box.appendChild(card);
      paintPortrait(card.querySelector('canvas'), g, 44);
    });
  }

  function openFormArmy(targetCity) {
    const cityId = selCity;
    const c = S.cities[cityId];
    if (c.owner !== S.player) { toast('只能从自己的城池出兵', 'warn'); return; }
    const gs = GC().generalsIn(cityId).filter((g) => !g.army);
    if (!gs.length) { toast('此城无将可派', 'warn'); return; }
    // 目标：敌城
    const targets = Object.values(S.cities).filter((t) => t.id !== cityId && t.owner !== S.player && GC().atWar(S.player, t.owner));
    const h = `<div class="sect-title">${c.name} · 编成军团</div>
      <div class="kv"><span>城中兵力</span><span>${fmt(c.troops)}</span></div>
      <div class="kv"><span>城中粮草</span><span>${fmt(c.food)}（出征携带 6 倍兵力）</span></div>
      <div class="kv"><span>训练度</span><span>${c.train} / 士气 ${c.morale}</span></div>
      <div class="sect-title">选择武将（最多 3 名，首位为主将）</div>
      <div class="grid-cards" id="faGens"></div>
      <div class="sect-title">兵力</div>
      <div id="faTroopsBar" style="display:flex;gap:7px;flex-wrap:wrap"></div>
      <div class="sect-title">目标</div>
      <div id="faTargets" style="display:flex;gap:7px;flex-wrap:wrap"></div>
      <div style="margin-top:16px;display:flex;gap:9px">
        <button class="btn btn-primary" id="faGo">出征</button>
        <button class="btn" id="faCancel">取消</button>
      </div>`;
    modal('出兵', h);
    const chosen = new Set();
    let troops = Math.max(1000, Math.floor(c.troops * 0.6));
    let target = targetCity && targetCity !== cityId ? targetCity : (targets[0] ? targets[0].id : null);

    const gbox = $('faGens');
    gs.sort((a, b) => (b.lead + b.war + b.intel) - (a.lead + a.war + a.intel)).forEach((g) => {
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `<div class="card-h"><canvas></canvas><div><div class="card-t">${g.name}</div>
        <div class="card-s">统${g.lead} 武${g.war} 智${g.intel}<br>战法 ${window.Battle.generalSpecial(g).name}</div></div></div>`;
      card.onclick = () => {
        if (chosen.has(g.id)) chosen.delete(g.id);
        else { if (chosen.size >= 3) { toast('最多 3 名武将', 'warn'); return; } chosen.add(g.id); }
        card.style.borderColor = chosen.has(g.id) ? 'var(--gold)' : '';
        card.style.background = chosen.has(g.id) ? 'rgba(216,178,92,.13)' : '';
      };
      gbox.appendChild(card);
      paintPortrait(card.querySelector('canvas'), g, 44);
    });
    // 默认选 3 名最强
    gs.slice(0, Math.min(3, gs.length)).forEach((g) => chosen.add(g.id));
    [...gbox.children].forEach((card, i) => { if (chosen.has(gs[i].id)) { card.style.borderColor = 'var(--gold)'; card.style.background = 'rgba(216,178,92,.13)'; } });

    const tbar = $('faTroopsBar');
    const renderTroops = () => {
      tbar.innerHTML = '';
      [0.3, 0.5, 0.7, 0.85, 1.0].forEach((k) => {
        const n = Math.floor(c.troops * k);
        const b = document.createElement('button');
        b.className = 'btn btn-sm' + (troops === n ? ' btn-primary' : '');
        b.textContent = `${fmt(n)}（${(k * 100).toFixed(0)}%）`;
        b.onclick = () => { troops = n; renderTroops(); };
        tbar.appendChild(b);
      });
    };
    renderTroops();

    const tbox = $('faTargets');
    if (!targets.length) tbox.innerHTML = '<span style="font-size:12px;color:var(--paper-dim)">暂无交战中的敌城（需先与他国接壤或宣战）</span>';
    else {
      targets.forEach((t) => {
        const f = S.factions[t.owner];
        const b = document.createElement('button');
        b.className = 'btn btn-sm' + (target === t.id ? ' btn-primary' : '');
        b.innerHTML = `${t.name} <span style="color:${f.color}">${f.name}</span>`;
        b.onclick = () => { target = t.id; [...tbox.children].forEach((x) => x.classList.remove('btn-primary')); b.classList.add('btn-primary'); };
        tbox.appendChild(b);
      });
    }
    $('faCancel').onclick = closeModal;
    $('faGo').onclick = () => {
      if (!chosen.size) { toast('请选择武将', 'warn'); return; }
      const r = GC().formArmy(S.player, cityId, [...chosen], troops, target);
      if (!r.ok) { toast(r.msg, 'warn'); return; }
      GC().addLog(`【出兵】${r.msg}`);
      closeModal();
      if (target) {
        GC().marchArmy(r.army, target);
        toast(`${r.msg}，向 ${S.cities[target].name} 进军`, 'gold');
      } else toast(r.msg, 'gold');
      window.MapView.rebuildArmies();
      showCity(cityId);
      refreshTop();
    };
  }

  function openTransport() {
    const c = curCity();
    const nbs = GC().neighbors(c.id).map((id) => S.cities[id]).filter((t) => t && t.owner === S.player);
    if (!nbs.length) { toast('无相邻的己方城池', 'warn'); return; }
    const h = `<div class="sect-title">${c.name} · 运输粮草</div>
      <div class="kv"><span>本城粮草</span><span>${fmt(c.food)}</span></div>
      <div style="margin-top:12px" id="tpList"></div>`;
    modal('运输', h);
    const box = $('tpList');
    nbs.forEach((t) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:9px;padding:8px 0;border-bottom:1px dashed rgba(216,178,92,.13)';
      row.innerHTML = `<span style="font-family:var(--font);font-size:16px;width:76px">${t.name}</span>
        <span style="font-size:12px;color:var(--paper-dim);flex:1">粮 ${fmt(t.food)} · 兵 ${fmt(t.troops)}</span>`;
      [5000, 10000, 20000].forEach((n) => {
        const b = document.createElement('button');
        b.className = 'btn btn-sm'; b.textContent = '+' + fmt(n);
        b.disabled = c.food < n;
        b.onclick = () => {
          const r = GC().Actions.transport(S.player, c.id, t.id, n);
          toast(r.msg, r.ok ? 'good' : 'warn');
          closeModal(); showCity(c.id);
        };
        row.appendChild(b);
      });
      box.appendChild(row);
    });
  }

  function openTransfer() {
    const c = curCity();
    const gs = GC().generalsIn(c.id).filter((g) => g.faction === S.player && !g.army);
    const mines = GC().factionCities(S.player).filter((t) => t.id !== c.id);
    if (!gs.length) { toast('此城无武将可调', 'warn'); return; }
    if (!mines.length) { toast('没有其他己方城池', 'warn'); return; }
    const h = `<div class="sect-title">${c.name} · 调动武将</div><div id="trList"></div>`;
    modal('调动', h);
    const box = $('trList');
    gs.forEach((g) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:9px;padding:7px 0;border-bottom:1px dashed rgba(216,178,92,.13)';
      row.innerHTML = `<span style="font-family:var(--font);font-size:15px;width:66px">${g.name}</span>
        <span style="font-size:11.5px;color:var(--paper-dim);flex:1">统${g.lead} 武${g.war} 智${g.intel}</span>`;
      mines.forEach((t) => {
        const b = document.createElement('button');
        b.className = 'btn btn-sm'; b.textContent = '→' + t.name;
        b.onclick = () => {
          const r = GC().Actions.transferGeneral(g.id, t.id, S.player);
          toast(r.msg, r.ok ? 'good' : 'warn');
          closeModal(); showCity(c.id);
        };
        row.appendChild(b);
      });
      box.appendChild(row);
    });
  }

  // ------------------------------------------------------------- 回合
  async function endTurn() {
    if (busy) return;
    busy = true;
    const btn = $('btnEndTurn');
    btn.disabled = true; btn.textContent = '结算中…';

    // 1) 行军推进
    const evs = [];
    for (const a of [...S.armies]) {
      const e = GC().stepArmy(a);
      if (e) evs.push(...e);
    }
    // 2) AI 势力行动（逐个显示）
    const ai = Object.values(S.factions).filter((f) => f.alive && f.id !== S.player && f.id !== 'neutral');
    for (const f of ai) {
      const e = GC().aiFaction(f.id);
      if (e && e.length) evs.push(...e.map((x) => ({ ...x, faction: f.name })));
      await new Promise((r) => setTimeout(r, 4));
    }
    // 3) 结算
    const tickEvs = GC().endTurn();
    evs.push(...(tickEvs || []));
    // 4) 日志
    for (const e of evs) {
      if (e.msg) GC().addLog(e.msg, e.type === 'famine' || e.type === 'starve' ? 'warn' : 'info');
    }
    window.MapView.rebuildArmies();
    window.MapView.rebuildCities();
    window.MapView.updateCityOwners();
    window.MapView.rebuildBorders();

    // 5) 大地图上遭遇战判定：玩家的军团与敌军同处一城则开战
    const playerArmy = S.armies.find((a) => a.faction === S.player && a.state === 'sieging');
    if (playerArmy) {
      const target = S.cities[playerArmy.at];
      if (target && target.owner !== S.player) {
        btn.disabled = false; btn.innerHTML = '结束回合 <kbd>空格</kbd>';
        busy = false;
        startBattle(playerArmy, target, 'attacker');
        return;
      }
    }
    // 6) 敌军围城我方
    const enemyArmy = S.armies.find((a) => a.faction !== S.player && a.faction !== 'neutral' && a.state === 'sieging' && S.cities[a.at] && S.cities[a.at].owner === S.player);
    if (enemyArmy) {
      btn.disabled = false; btn.innerHTML = '结束回合 <kbd>空格</kbd>';
      busy = false;
      startBattle(enemyArmy, S.cities[enemyArmy.at], 'defender');
      return;
    }

    btn.disabled = false; btn.innerHTML = '结束回合 <kbd>空格</kbd>';
    busy = false;
    refreshTop(); refreshPowerList();
    if (selCity) showCity(selCity);
    toast(`${S.year}年 ${S.month}月　${evs.filter((e) => e.msg).length} 条军报`, 'gold');
    checkVictory();
  }

  function checkVictory() {
    const mine = GC().factionCities(S.player);
    const alive = Object.values(S.factions).filter((f) => f.id !== 'neutral' && f.id !== S.player && GC().factionCities(f.id).length > 0);
    if (!mine.length) {
      modal('天下已失', `<div style="text-align:center;padding:26px"><h2 style="font-family:var(--font);font-size:34px;color:var(--blood);letter-spacing:.2em">大势已去</h2>
        <p style="margin-top:14px;color:var(--paper-dim)">${S.year}年${S.month}月，${S.factions[S.player].name}军的最后一城陷落。</p></div>`);
      return;
    }
    if (!alive.length) {
      modal('天下一统', `<div style="text-align:center;padding:26px"><h2 style="font-family:var(--font);font-size:38px;color:var(--gold);letter-spacing:.24em">天下一统</h2>
        <p style="margin-top:14px;color:var(--paper-dim);line-height:2">${S.year}年${S.month}月，${S.factions[S.player].name}军平定四海，汉室重归一统。<br>
        共历 ${S.turn} 回合 · 攻取城池 ${S.stats.citiesTaken} 座 · 战胜 ${S.stats.battlesWon} 阵 · 招揽人才 ${S.stats.generalsRecruited} 人</p></div>`);
    }
  }

  // ------------------------------------------------------------- 战斗
  function makeBattleConfig(army, city, role) {
    const BTL = window.Battle;
    const atkFid = role === 'attacker' ? army.faction : city.owner;
    const defFid = role === 'attacker' ? city.owner : army.faction;
    const af = S.factions[atkFid], df = S.factions[defFid];

    const mkUnits = (armyObj) => armyObj.generals.map((gid) => {
      const g = S.generals[gid];
      // 按适性选兵种
      const cands = ['gun', 'hal', 'xbow', 'ride', 'wep'];
      let best = 'gun', bv = -1;
      const order = { S: 4, A: 3, B: 2, C: 1 };
      for (const t of cands) { const v = order[g[t]] || 2; if (v > bv) { bv = v; best = t; } }
      return { general: g, troopType: best, troops: Math.round(armyObj.troops / armyObj.generals.length), train: armyObj.train, morale: armyObj.morale };
    });

    const cfg = {
      city,
      attacker: { faction: atkFid, name: af.name + '军', units: [] },
      defender: { faction: defFid, name: df.name + '军', units: [] },
    };
    if (role === 'attacker') {
      cfg.attacker.units = mkUnits(army);
      cfg.attacker.armyRef = army;
      // 守城：城中武将各带一部分兵
      const dgs = GC().generalsIn(city.id).filter((g) => !g.army && g.faction === defFid);
      const total = city.troops;
      if (dgs.length) {
        const per = Math.round(total / (dgs.length + 1));
        dgs.slice(0, 5).forEach((g) => cfg.defender.units.push({
          general: g, troopType: pickTroopFor(g), troops: per, train: city.train, morale: city.morale,
        }));
      }
      cfg.defender.cityGarrison = { troops: Math.max(800, Math.round(total * (dgs.length ? 1 / (dgs.length + 1) : 1))), train: city.train, morale: city.morale, general: dgs[0] || null, troopType: 'gun' };
      cfg.defender.troopsTotal = total;
    } else {
      cfg.attacker.units = mkUnits(army);
      cfg.attacker.armyRef = army;
      cfg.defender.units = [];
      const dgs = GC().generalsIn(city.id).filter((g) => !g.army && g.faction === defFid);
      const total = city.troops;
      if (dgs.length) {
        const per = Math.round(total / (dgs.length + 1));
        dgs.slice(0, 6).forEach((g) => cfg.defender.units.push({
          general: g, troopType: pickTroopFor(g), troops: per, train: city.train, morale: city.morale,
        }));
      }
      cfg.defender.cityGarrison = { troops: Math.max(800, Math.round(total * (dgs.length ? 1 / (dgs.length + 1) : 1))), train: city.train, morale: city.morale, general: dgs[0] || null, troopType: 'gun' };
      cfg.defender.troopsTotal = total;
    }
    return cfg;
  }
  function pickTroopFor(g) {
    const cands = ['gun', 'hal', 'xbow', 'ride', 'wep'];
    const order = { S: 4, A: 3, B: 2, C: 1 };
    let best = 'gun', bv = -1;
    for (const t of cands) { const v = order[g[t]] || 2; if (v > bv) { bv = v; best = t; } }
    return best;
  }

  async function startBattle(army, city, role) {
    const cfg = makeBattleConfig(army, city, role);
    // 生成战场：从真实高程切片
    const dirs = ['north', 'south', 'east', 'west'];
    const dir = dirs[Math.floor(Math.random() * 4)];
    const field = window.Battle.buildBattlefield(city.lon, city.lat, city.id + S.turn, { dir, sample: 3, road: true });
    if (!window.SANGUO_MAP.sampleBattle) {
      // 由 BattleView 在 load 时注入；此处先用占位避免报错
      window.SANGUO_MAP.sampleBattle = () => 100;
    }
    const battle = window.Battle.createBattle({ field, attacker: cfg.attacker, defender: cfg.defender, city });
    battle._armyRef = army;
    battle._role = role;
    B = battle;

    $('app').classList.add('hidden');
    $('battleUI').classList.remove('hidden');
    $('battleCanvas').classList.remove('hidden');
    // 等一帧确保画布已完成布局（宽高非 0），否则渲染器会以 0×0 初始化
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    if (!bt) {
      await window.BattleView.init($('battleCanvas'));
      window.BattleView.onSelectUnit = onUnitSelect;
      window.BattleView.onOrder = onBattleOrder;
      bt = true;
    }
    window.BattleView.load(B);
    btSel = null; btMode = null; btAuto = false;
    $('battleResult').classList.add('hidden');
    renderBattleHUD();
    renderBattleLog();
    toast(`战于 ${city.name}！天候：${B.weather ? B.weather.name : '晴'}`, 'gold', 3200);

    // 若玩家是守方，先让攻方（AI）行动？三国志11 是攻方先行。
    B.side = 'attacker';
    if (cfg.attacker.faction !== S.player) {
      // AI 攻方先行
      await runAI();
    }
    renderBattleHUD();
  }

  function renderBattleHUD() {
    if (!B) return;
    const atkTroops = B.units.filter((u) => u.side === 'attacker').reduce((s, u) => s + u.troops, 0);
    const defTroops = B.units.filter((u) => u.side === 'defender').reduce((s, u) => s + u.troops, 0);
    const af = S.factions[B.attackerFaction] || { name: '?', color: '#ccc' };
    const df = S.factions[B.defenderFaction] || { name: '?', color: '#ccc' };
    $('btAtkName').innerHTML = `<span style="color:${af.color}">${af.name}军</span>`;
    $('btDefName').innerHTML = `<span style="color:${df.color}">${df.name}军</span>`;
    $('btAtkTroops').textContent = fmt(atkTroops) + ' 兵';
    $('btDefTroops').textContent = fmt(defTroops) + ' 兵';
    $('btTurn').textContent = `第 ${B.turn} 回合`;
    $('btSideNow').textContent = B.side === 'attacker' ? '攻方行动' : '守方行动';
    $('btWeather').textContent = B.weather ? `${B.weather.name} · ${B.weather.desc}` : '';
    const isPlayerSide = (B.side === 'attacker' && B.attackerFaction === S.player) || (B.side === 'defender' && B.defenderFaction === S.player);
    $('btEndSide').disabled = !isPlayerSide || B.over;
    $('btWait').disabled = !btSel || !isPlayerSide;
    $('btDefend').disabled = !btSel || !isPlayerSide;
    $('btSpecial').disabled = !btSel || !isPlayerSide || !btSel.special;
    if (btSel) $('btSpecial').textContent = btSel.special ? `战法·${btSel.special.name}` : '战法';
  }

  function renderBattleLog() {
    const box = $('battleLog');
    box.innerHTML = B.log.slice(-60).map((l) => {
      if (/^──/.test(l.text)) return `<div class="hl-sys">${l.text}</div>`;
      if (l.dead) return `<div class="hl-dead">${l.text}</div>`;
      const cls = l.side === 'attacker' ? 'hl-atk' : l.side === 'defender' ? 'hl-def' : '';
      return `<div class="${cls}">${l.text}</div>`;
    }).join('');
    box.scrollTop = box.scrollHeight;
  }

  function renderUnitPanel(u) {
    const box = $('unitPanel');
    if (!u) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    const T = window.Battle.TROOPS[u.troopType];
    const g = u.general;
    const sp = u.special;
    const terr = window.Battle.TERRAIN[B.field.grid[window.Battle.key(u.x, u.y)]];
    box.innerHTML = `<div class="up-h"><canvas id="upFace"></canvas>
        <div><div class="up-name">${u.name}${u.isCity ? ' <span class="tag">守军</span>' : ''}</div>
        <div class="up-sub">${T.name}　兵力 ${fmt(u.troops)} / ${fmt(u.maxTroops)}</div>
        <div class="up-sub">训练 ${u.train}　士气 ${Math.round(u.morale)}　适性 ×${u.apt.toFixed(2)}</div></div></div>
      <div class="kv"><span>所在地形</span><span>${terr.name}（防御 +${terr.def}）</span></div>
      ${sp ? `<div class="up-sp">战法：<b>${sp.name}</b><br>${sp.desc}（威力 ×${sp.mult.toFixed(2)}）</div>` : ''}`;
    const cv = $('upFace'); cv.width = 58; cv.height = 58;
    if (g) window.Portraits.paint(cv, g, { size: 58, faction: window.SANGUO_FACTIONS[g.faction] });
    else { const ctx = cv.getContext('2d'); ctx.fillStyle = '#3a3128'; ctx.fillRect(0, 0, 58, 58); ctx.fillStyle = '#c8b48a'; ctx.font = '26px serif'; ctx.textAlign = 'center'; ctx.fillText('城', 29, 39); }
  }

  function onUnitSelect(uid) {
    const u = B.units.find((x) => x.id === uid);
    if (!u || u.troops <= 0) return;
    const mySide = (B.side === 'attacker' && B.attackerFaction === S.player) || (B.side === 'defender' && B.defenderFaction === S.player);
    btSel = u;
    window.BattleView.selected = u;
    renderUnitPanel(u);
    renderBattleHUD();
    if (u.side === B.side && mySide && !u.acted) {
      btMode = 'move';
      window.BattleView.markSelected(u);
      const targets = window.Battle.reachable(B, u).cells.filter((c) => window.Battle.attackableFrom(B, u, c.x, c.y).length);
      window.BattleView.highlightTargets(targets);
    } else {
      btMode = null;
      window.BattleView.markSelected(u);
    }
  }

  function onBattleOrder(cell) {
    if (!btSel || B.over) return;
    const mySide = (B.side === 'attacker' && B.attackerFaction === S.player) || (B.side === 'defender' && B.defenderFaction === S.player);
    if (!mySide || btSel.side !== B.side || btSel.acted) {
      // 点空地：显示地形信息
      const t = window.Battle.TERRAIN[B.field.grid[window.Battle.key(cell.x, cell.y)]];
      toast(`${t.name}：移动消耗 ${t.move}，防御加成 ${t.def}`, '', 1600);
      return;
    }
    const reach = window.Battle.reachable(B, btSel);
    const canGo = reach.cells.find((c) => c.x === cell.x && c.y === cell.y);
    const foes = window.Battle.attackableFrom(B, btSel, cell.x, cell.y);
    const enemyAt = B.units.find((u) => u.side !== btSel.side && u.troops > 0 && u.x === cell.x && u.y === cell.y);

    if (enemyAt) {
      // 若已在攻击范围内则直接攻击；否则先移动再攻击
      const range = window.Battle.TROOPS[btSel.troopType].range;
      if (window.Battle.dist(btSel, enemyAt) <= range) {
        doAttack(btSel, enemyAt, false);
      } else if (canGo) {
        btSel.x = cell.x; btSel.y = cell.y;
        window.BattleView.rebuildUnits(false);
        setTimeout(() => { if (!B.over) doAttack(btSel, enemyAt, false); }, 260);
      } else {
        toast('无法到达该位置', 'warn', 1500);
      }
      return;
    }
    if (canGo) {
      btSel.x = cell.x; btSel.y = cell.y;
      window.BattleView.rebuildUnits(false);
      window.BattleView.clearHighlight();
      renderBattleHUD();
      if (reach.cells.filter((c) => window.Battle.attackableFrom(B, btSel, c.x, c.y).length).length) {
        const tg = window.Battle.reachable(B, btSel).cells.filter((c) => window.Battle.attackableFrom(B, btSel, c.x, c.y).length);
        window.BattleView.highlightTargets(tg);
      }
    } else {
      const t = window.Battle.TERRAIN[B.field.grid[window.Battle.key(cell.x, cell.y)]];
      toast(`${t.name}（移动消耗 ${t.move}）— 超出本回合行动范围`, '', 1600);
    }
  }

  async function doAttack(atk, def, useSpecial) {
    if (B.over) return;
    const before = def.troops;
    const opts = { special: useSpecial, useIntel: !!(useSpecial && atk.special && atk.special.intel) };
    window.BattleView.spawnFx(useSpecial && atk.special && atk.special.intel ? 'fire' : 'slash', def.x, def.y);
    if (useSpecial) window.BattleView.spawnFx('impact', atk.x, atk.y);
    const r = window.Battle.applyAttack(B, atk, def, opts);
    window.BattleView.spawnFx(r.hit ? 'impact' : 'banner', def.x, def.y);
    window.Battle.finishUnit(B, atk, true);
    window.BattleView.rebuildUnits(false);
    window.BattleView.clearHighlight();
    window.BattleView.selected = null;
    btSel = null; btMode = null;
    renderUnitPanel(null);
    renderBattleLog();
    renderBattleHUD();
    if (B.over) return finishBattle();
  }

  async function runAI() {
    if (B.over) return;
    // AI 逐单位行动，带小延时让动画可见
    let guard = 0;
    while (!B.over && guard++ < 40) {
      const side = B.side;
      const isPlayerSide = (side === 'attacker' && B.attackerFaction === S.player) || (side === 'defender' && B.defenderFaction === S.player);
      if (isPlayerSide) break;
      const before = B.units.map((u) => ({ id: u.id, t: u.troops }));
      const acts = window.Battle.aiSide(B);
      for (const a of acts) {
        if (a.type === 'attack') {
          const atk = B.units.find((u) => u.id === a.unit);
          const def = B.units.find((u) => u.id === a.target);
          if (def) window.BattleView.spawnFx(a.special && atk.special && atk.special.intel ? 'fire' : 'slash', def.x, def.y);
        }
      }
      window.BattleView.rebuildUnits(false);
      renderBattleLog();
      renderBattleHUD();
      await new Promise((r) => setTimeout(r, 420));
      if (B.over) break;
      // 若 AI 单位已全部行动，切换
      const remain = B.units.filter((u) => u.side === side && u.troops > 0 && !u.acted);
      if (!remain.length) window.Battle.endSide(B);
      else break;
    }
    renderBattleHUD();
    renderBattleLog();
    if (B.over) finishBattle();
  }

  async function nextSide() {
    if (B.over) return;
    window.Battle.endSide(B);
    window.BattleView.clearHighlight();
    btSel = null; btMode = null;
    renderUnitPanel(null);
    renderBattleLog();
    renderBattleHUD();
    const isPlayerSide = (B.side === 'attacker' && B.attackerFaction === S.player) || (B.side === 'defender' && B.defenderFaction === S.player);
    if (!isPlayerSide || btAuto) {
      await runAI();
      if (!B.over) {
        // AI 回合结束后若仍非玩家方，继续
        const stillAI = (B.side === 'attacker' && B.attackerFaction !== S.player) || (B.side === 'defender' && B.defenderFaction !== S.player);
        if (stillAI) await nextSide();
      }
    }
  }

  function finishBattle() {
    const won = B.winner === 'attacker' ? (B.attackerFaction === S.player) : (B.defenderFaction === S.player);
    const attackerWon = B.winner === 'attacker';
    const city = B.city;
    const army = B._armyRef;

    // 战损结算回战略层
    if (army) {
      const mine = B.units.filter((u) => u.side === (B._role === 'attacker' ? 'attacker' : 'defender'));
      const remain = mine.reduce((s, u) => s + u.troops, 0);
      army.troops = Math.max(0, remain);
      const other = B.units.filter((u) => u.side !== (B._role === 'attacker' ? 'attacker' : 'defender'));
      army.morale = Math.round((mine.reduce((s, u) => s + u.morale, 0) / Math.max(1, mine.length)));
    }
    // 城中兵力
    const defUnits = B.units.filter((u) => u.side === 'defender');
    const defRemain = defUnits.reduce((s, u) => s + u.troops, 0);

    let resultText = '';
    if (attackerWon) {
      if (B.attackerFaction === S.player) {
        // 玩家攻取城池
        const oldOwner = city.owner;
        city.owner = S.player;
        city.troops = Math.round(defRemain * 0.25);
        city.food = Math.round(city.food * 0.7);
        city.disorder = Math.min(100, city.disorder + 30);
        city.morale = Math.max(20, city.morale - 25);
        // 守将俘获/逃亡
        const dgs = GC().generalsIn(city.id).filter((g) => g.faction === oldOwner);
        let captured = 0, fled = 0;
        dgs.forEach((g) => {
          if (Math.random() < 0.42 + (g.loyalty < 60 ? 0.2 : 0)) {
            // 俘获 -> 归顺或下野
            const join = Math.random() < 0.35 + (S.factions[S.player].gold / 200000);
            if (join) {
              g.faction = S.player; g.city = city.id; g.loyalty = 55 + Math.random() * 25; captured++;
              S.stats.generalsRecruited++;
            } else {
              const i = city.generals.indexOf(g.id); if (i >= 0) city.generals.splice(i, 1);
              g.faction = 'neutral'; g.city = null; fled++;
            }
          } else fled++;
        });
        S.stats.battlesWon++; S.stats.citiesTaken++;
        GC().addLog(`【捷报】攻取 ${city.name}！俘获/招降 ${captured} 人，走脱 ${fled} 人`);
        resultText = `夺得 ${city.name}　招降 ${captured} 人　走脱 ${fled} 人`;
      } else {
        // AI 攻取玩家城池
        const oldOwner = city.owner;
        city.owner = B.attackerFaction;
        city.troops = Math.round(defRemain * 0.25);
        city.disorder = 55; city.morale = 40;
        const dgs = GC().generalsIn(city.id).filter((g) => g.faction === oldOwner);
        dgs.forEach((g) => {
          if (Math.random() < 0.5) {
            const i = city.generals.indexOf(g.id); if (i >= 0) city.generals.splice(i, 1);
            g.faction = 'neutral'; g.city = null;
          } else { const i = city.generals.indexOf(g.id); if (i >= 0) city.generals.splice(i, 1); g.faction = B.attackerFaction; g.city = city.id; }
        });
        GC().addLog(`【失守】${city.name} 被 ${S.factions[B.attackerFaction].name}军攻取！`, 'warn');
        resultText = `${city.name} 为敌所夺`;
      }
    } else if (B.winner === 'defender') {
      if (B.defenderFaction === S.player) {
        city.troops = defRemain;
        S.stats.battlesWon++;
        GC().addLog(`【守成】${city.name} 击退敌军`);
        resultText = `守住了 ${city.name}`;
      } else {
        city.troops = defRemain;
        GC().addLog(`【败退】${B.attackerFaction === S.player ? '我军' : S.factions[B.attackerFaction].name + '军'} 于 ${city.name} 城下败退`, 'warn');
        resultText = `于 ${city.name} 城下败退`;
      }
    } else resultText = '两败俱伤';

    // 战败方军团溃散
    if (army) {
      const roleSide = B._role === 'attacker' ? 'attacker' : 'defender';
      const myWin = B.winner === roleSide;
      const survivors = B.units.filter((u) => u.side === roleSide && u.troops > 0);
      if (!myWin || army.troops < 400) {
        // 武将撤回最近的己方城池或转为在野
        const homeCities = GC().factionCities(army.faction);
        army.generals.forEach((gid) => {
          const g = S.generals[gid];
          g.army = null;
          if (homeCities.length) {
            const near = homeCities.map((c) => ({ c, d: Math.hypot(c.lon - city.lon, c.lat - city.lat) })).sort((a, b) => a.d - b.d)[0].c;
            g.city = near.id; near.generals.push(gid);
          } else { g.faction = 'neutral'; g.city = null; }
        });
        const i = S.armies.indexOf(army); if (i >= 0) S.armies.splice(i, 1);
      } else {
        // 胜方进城/驻守
        army.state = 'idle'; army.at = city.id; army.path = [];
        const homeFriendly = city.owner === army.faction;
        if (homeFriendly) {
          army.generals.forEach((gid) => {
            const g = S.generals[gid]; g.army = null; g.city = city.id;
            if (!city.generals.includes(gid)) city.generals.push(gid);
          });
          city.troops += army.troops;
          city.food += army.food;
          const i = S.armies.indexOf(army); if (i >= 0) S.armies.splice(i, 1);
        }
      }
    }

    // 显示结算
    $('battleResult').classList.remove('hidden');
    $('battleResult').innerHTML = `<h2>${B.winner === 'attacker' ? '攻方胜' : B.winner === 'defender' ? '守方胜' : '两败俱伤'}</h2>
      <p>${resultText}</p>
      <div class="br-stats">
        <div><b>${(B.turn)}</b><span>回合数</span></div>
        <div><b>${fmt(B.units.filter((u) => u.side === 'attacker').reduce((s, u) => s + u.troops, 0))}</b><span>攻方余兵</span></div>
        <div><b>${fmt(B.units.filter((u) => u.side === 'defender').reduce((s, u) => s + u.troops, 0))}</b><span>守方余兵</span></div>
      </div>
      <button class="btn btn-primary" id="brBack" style="padding:10px 34px;font-size:15px">返回大地图</button>`;
    $('brBack').onclick = backToMap;
  }

  function backToMap() {
    $('battleResult').classList.add('hidden');
    $('battleUI').classList.add('hidden');
    $('battleCanvas').classList.add('hidden');
    $('app').classList.remove('hidden');
    B = null;
    window.MapView.rebuildCities();
    window.MapView.updateCityOwners();
    window.MapView.rebuildArmies();
    window.MapView.rebuildBorders();
    refreshTop(); refreshPowerList();
    if (selCity) showCity(selCity);
    checkVictory();
  }

  // ------------------------------------------------------------- 新游戏
  async function newGame(playerFid) {
    S = GC().newState(playerFid, window.SANGUO_SCENARIO_189);
    GC().S = S;
    GC().buildAdjacency();
    GC().initWars();
    GC().addLog(`【开局】${S.factions[playerFid].name}军起于乱世，${window.SANGUO_SCENARIO_189.name}`);
    await window.MapView.init($('mapCanvas'), {});
    window.MapView.onPick = onMapPick;
    window.MapView.rebuildCities();
    window.MapView.updateCityOwners();
    window.MapView.rebuildRoads();
    window.MapView.rebuildBorders();
    refreshTop(); refreshPowerList();
    $('boot').classList.remove('show');
    $('boot').classList.add('hidden');
    $('app').classList.remove('hidden');
    $('hintBar').textContent = '点击你的城池（金色旗帜）开始内政与出兵　·　点击敌方城池查看情报　·　空格结束回合';
  }

  function loadState(state) {
    S = state;
    GC().S = S;
    GC().buildAdjacency();
    return window.MapView.init($('mapCanvas'), {}).then(() => {
      window.MapView.onPick = onMapPick;
      window.MapView.rebuildCities();
      window.MapView.updateCityOwners();
      window.MapView.rebuildRoads();
      window.MapView.rebuildBorders();
      window.MapView.rebuildArmies();
      refreshTop(); refreshPowerList();
      $('boot').classList.add('hidden'); $('boot').classList.remove('show');
      $('app').classList.remove('hidden');
    });
  }

  function onMapPick(hit) {
    if (hit.type === 'city') showCity(hit.id);
    else if (hit.type === 'army') {
      const a = S.armies.find((x) => x.id === hit.id);
      if (!a) return;
      const names = a.generals.map((g) => S.generals[g].name).join('、');
      toast(`${S.factions[a.faction].name}军 ${names}　兵 ${fmt(a.troops)}　粮 ${fmt(a.food)}　${S.cities[a.at] ? '在 ' + S.cities[a.at].name : ''}`, '', 3000);
      if (a.faction === S.player) {
        selArmy = a.id;
        if (S.cities[a.at]) showCity(a.at);
      }
    } else if (hit.type === 'ground') {
      // 靠近的城池
      let best = null, bd = 1e9;
      for (const c of Object.values(S.cities)) {
        const d = Math.hypot((c.lon - hit.lon) * 0.95, c.lat - hit.lat);
        if (d < bd) { bd = d; best = c; }
      }
      if (best && bd < 1.4) showCity(best.id);
      else $('hintBar').textContent = `${hit.lon.toFixed(2)}°E ${hit.lat.toFixed(2)}°N　海拔 ${Math.round(window.MapView.terrainHeightAt(hit.lon, hit.lat) / (window.MapView.HSCALE * window.MapView.EXAG))} m`;
    }
  }

  // ------------------------------------------------------------- 启动界面
  function showStartScreen() {
    const fdefs = window.SANGUO_FACTIONS;
    const cards = window.SANGUO_PLAYABLE.map((fid) => {
      const f = fdefs[fid];
      const cs = window.SANGUO_SITES.filter((s) => window.SANGUO_SCENARIO_189.owner[s.id] === fid);
      const data = window.SANGUO_ROSTER.factions[fid] || { members: [] };
      const lord = data.lord;
      return `<div class="card" data-fid="${fid}" style="border-color:${f.color}44">
        <div class="card-h" style="align-items:center">
          <span style="width:6px;height:38px;border-radius:2px;background:${f.color};flex-shrink:0;box-shadow:0 0 12px ${f.color}"></span>
          <div style="flex:1">
            <div class="card-t" style="color:${f.color}">${f.name}</div>
            <div class="card-s">${f.trait}　君主 ${lord || '—'}</div>
          </div>
        </div>
        <div class="card-s">城池 ${cs.length} 座：${cs.slice(0, 5).map((s) => s.name).join('、')}${cs.length > 5 ? '…' : ''}</div>
        <div class="card-s">起始武将 ${data.members.length} 名</div>
        <div style="font-size:11px;color:var(--paper-dim);margin-top:6px;line-height:1.65">${f.desc}</div>
      </div>`;
    }).join('');
    $('boot').innerHTML = `
      <div class="boot-box" style="max-width:1020px">
        <div class="boot-seal">漢</div>
        <h1>三國志 · 漢末風雲</h1>
        <p class="boot-sub">189年 · 反董卓聯盟</p>
        <p style="font-size:13px;color:var(--paper-dim);line-height:1.9;margin-top:14px;max-width:760px;margin-left:auto;margin-right:auto">
          ${window.SANGUO_SCENARIO_189.desc}</p>
        <div class="sect-title" style="margin-top:22px">选择你的势力</div>
        <div class="grid-cards" id="startCards" style="max-height:44vh;overflow-y:auto">${cards}</div>
        <div style="margin-top:18px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
          <button class="btn" id="startLoad">读取文件存档</button>
          <button class="btn" id="startLocal">读取浏览器存档</button>
        </div>
        <div class="boot-tip">左键拖动平移 · Shift/中键拖动旋转 · 滚轮缩放 · 点击城池操作 · 空格结束回合</div>
      </div>`;
    $('startCards').querySelectorAll('.card').forEach((c) => {
      c.onclick = () => newGame(c.dataset.fid);
    });
    $('startLoad').onclick = async () => {
      const r = await window.SaveSys.importFile();
      if (!r.ok) { toast(r.msg, 'warn'); return; }
      await loadState(r.state);
      toast('存档已载入', 'good');
    };
    $('startLocal').onclick = async () => {
      const r = window.SaveSys.loadLocal(0);
      if (!r.ok) { toast(r.msg, 'warn'); return; }
      await loadState(r.state);
      toast('自动存档已载入', 'good');
    };
  }

  // ------------------------------------------------------------- 弹窗绑定
  function bindUI() {
    $('modalClose').onclick = closeModal;
    $('modal').onclick = (e) => { if (e.target === $('modal')) closeModal(); };
    $('btnEndTurn').onclick = endTurn;
    $('btnView').onclick = () => { window.MapView.resetView(); toast('视角已复位', '', 1200); };
    $('btnRoster').onclick = showRoster;
    $('btnPowers').onclick = () => showPowerInfo(S.player);
    $('btnLog').onclick = showLog;
    $('btnSave').onclick = showSave;
    $('btnLoad').onclick = showSave;
    $('btnHelp').onclick = showHelp;
    $('btEndSide').onclick = () => { if (B && !B.over) nextSide(); };
    $('btWait').onclick = () => {
      if (!btSel) return;
      window.Battle.finishUnit(B, btSel, true);
      window.BattleView.clearHighlight();
      btSel = null; renderUnitPanel(null); renderBattleHUD();
    };
    $('btDefend').onclick = () => {
      if (!btSel) return;
      btSel.defending = true;
      btSel.morale = Math.min(100, btSel.morale + 6);
      btSel.apt *= 1.0;
      toast(`${btSel.name} 结阵防御，士气 +6`, '', 1500);
      window.Battle.finishUnit(B, btSel, true);
      window.BattleView.clearHighlight();
      btSel = null; renderUnitPanel(null); renderBattleHUD();
    };
    $('btSpecial').onclick = () => {
      if (!btSel || !btSel.special) return;
      const foes = B.units.filter((u) => u.side !== btSel.side && u.troops > 0 && window.Battle.dist(btSel, u) <= window.Battle.TROOPS[btSel.troopType].range);
      if (!foes.length) { toast('范围内无敌军', 'warn', 1500); return; }
      foes.sort((a, b) => a.troops - b.troops);
      doAttack(btSel, foes[0], true);
    };
    $('btAuto').onclick = () => {
      btAuto = !btAuto;
      $('btAuto').classList.toggle('btn-primary', btAuto);
      toast(btAuto ? '自动战斗：开' : '自动战斗：关', '', 1400);
      if (btAuto) nextSide();
    };
    window.__sanguoHotkeys = (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        if (B && !B.over) nextSide();
        else if (S && !busy) endTurn();
      }
      if (e.code === 'Escape') { closeModal(); }
      if (e.code === 'KeyR' && B && B.over) backToMap();
    };
  }

  function showRoster() {
    const gs = GC().factionGenerals(S.player).sort((a, b) => (b.isLord - a.isLord) || (b.lead + b.war + b.intel) - (a.lead + a.war + a.intel));
    const h = `<div class="sect-title">${S.factions[S.player].name}军 · 武将 ${gs.length} 名</div>
      <div class="grid-cards" id="rosterList"></div>`;
    modal('武将名册', h);
    const box = $('rosterList');
    gs.forEach((g) => {
      const card = document.createElement('div');
      card.className = 'card';
      const city = g.army ? '出征' : (S.cities[g.city] ? S.cities[g.city].name : '在野');
      card.innerHTML = `<div class="card-h"><canvas></canvas><div><div class="card-t">${g.name}${g.isLord ? ' <span style="color:var(--gold);font-size:11px">君主</span>' : ''}</div>
        <div class="card-s">统${g.lead} 武${g.war} 智${g.intel}<br>${city}</div></div></div>`;
      card.onclick = () => showGeneral(g.id);
      box.appendChild(card);
      paintPortrait(card.querySelector('canvas'), g, 44);
    });
  }

  function showLog() {
    const h = `<div class="sect-title">军报 · 近 ${Math.min(120, S.log.length)} 条</div>
      <div style="font-size:12.5px;line-height:2;font-family:var(--font)">${S.log.slice(-120).reverse().map((l) => `<div style="border-bottom:1px dashed rgba(216,178,92,.1);padding:3px 0"><span style="color:var(--gold-dim)">${l.t}</span>　${l.text}</div>`).join('')}</div>`;
    modal('战报', h);
  }

  function showSave() {
    const slots = window.SaveSys.listLocal();
    const h = `<div class="sect-title">导出 / 导入存档</div>
      <div class="kv"><span>当前</span><span>${S.year}年${S.month}月 · ${S.factions[S.player].name}军 · ${GC().factionCities(S.player).length}城</span></div>
      <div style="display:flex;gap:9px;margin:14px 0;flex-wrap:wrap">
        <button class="btn btn-primary" id="svDownload">导出为文件（下载）</button>
        <button class="btn" id="svImport">从文件导入</button>
      </div>
      <div class="sect-title">浏览器存档槽</div>
      <div style="display:flex;gap:9px;margin:12px 0;flex-wrap:wrap">
        ${[0, 1, 2, 3].map((i) => `<button class="btn btn-sm" data-slot="${i}">保存到槽 ${i === 0 ? '自动' : i}</button>`).join('')}
      </div>
      <div style="font-size:12.5px;line-height:1.9;color:var(--paper-dim)">
        ${slots.length ? slots.map((s) => `槽 ${s.slot === 0 ? '自动' : s.slot}：${s.meta.year}年${s.meta.month}月 ${s.meta.playerName}军 ${s.meta.cities}城（${new Date(s.savedAt).toLocaleString('zh-CN')}）<button class="btn btn-sm" data-load="${s.slot}" style="margin-left:8px">读取</button>`).join('<br>') : '尚无浏览器存档'}
      </div>`;
    modal('存档', h);
    $('svDownload').onclick = () => { const r = window.SaveSys.download(); toast(r.msg, 'good'); };
    $('svImport').onclick = async () => {
      const r = await window.SaveSys.importFile();
      if (!r.ok) { toast(r.msg, 'warn'); return; }
      closeModal(); await loadState(r.state); toast('存档已载入', 'good');
    };
    $('modalBody').querySelectorAll('button[data-slot]').forEach((b) => {
      b.onclick = () => { const r = window.SaveSys.saveLocal(Number(b.dataset.slot)); toast(r.msg, r.ok ? 'good' : 'warn'); showSave(); };
    });
    $('modalBody').querySelectorAll('button[data-load]').forEach((b) => {
      b.onclick = async () => {
        const r = window.SaveSys.loadLocal(Number(b.dataset.load));
        if (!r.ok) { toast(r.msg, 'warn'); return; }
        closeModal(); await loadState(r.state); toast('存档已载入', 'good');
      };
    });
  }

  function showHelp() {
    modal('操作与玩法', `<div class="help-list">
      <b>大地图操作</b><br>
      左键拖动：平移　<kbd>Shift</kbd>+左键 或 中键拖动：旋转视角　滚轮：缩放　右键：无<br>
      点击城池：打开城池面板（内政/征兵/出兵）　点击部队：查看军团　空格：结束回合<br><br>
      <b>内政（每月每将可行动一次）</b><br>
      开垦提升农业（秋收粮食）· 兴商提升商业（月入金钱）· 技术提升收入与产量 · 修城提升城防<br>
      治安降低民怨 · 征兵消耗人口与金钱 · 训练提升训练度 · 登用招揽在野武将<br><br>
      <b>军事与后勤</b><br>
      出兵需指派武将（最多 3 名），出征携带 6 倍兵力的粮草；行军中每步消耗粮草，<br>
      粮尽则士卒逃散；途经己方城池自动补给。驻守城池每月也消耗粮草，<br>
      粮尽则逃兵、民心下降。运输可向相邻己方城池调拨粮草（损耗 8%）。<br><br>
      <b>战斗（三国志11 风格战棋）</b><br>
      点击己方单位 → 蓝色为可移动范围、红色为可攻击位置 → 点击目标格移动/攻击<br>
      兵种相克：枪克骑、戟克枪、弩克枪、骑克弩　地形提供防御加成（山地 +30、森林 +18、城郭 +45）<br>
      战法：每位武将独有（如吕布「无双」、诸葛亮「八阵图」、周瑜「火烧赤壁」），高武力/高智力决定威力<br>
      士气归零或兵力低于 12% 时部队可能溃散。天候影响命中与火计。<br><br>
      <b>胜负</b><br>
      攻方全歼守军即夺城；守方全歼攻军即守住。消灭所有敌对势力即天下一统。<br><br>
      <b>存档</b><br>
      顶栏「存档」可导出 <code>.sgsav.json</code> 文件下载到本地，也可随时导入；另有 4 个浏览器存档槽。
    </div>`);
  }

  // ------------------------------------------------------------- 启动
  window.addEventListener('load', async () => {
    bindUI();
    // 先解码战场高程切片，保证 buildBattlefield 随时可用
    try {
      const okSlice = await window.Slice.init();
      if (okSlice) window.SANGUO_MAP.sampleBattle = window.Slice.sample;
      const sz = window.Slice.size();
      $('bootStatus').textContent = okSlice ? `地形切片就绪 ${sz.W}×${sz.H}，正在展开舆图……` : '高程解码失败，将使用简化地形';
    } catch (e) { console.warn('Slice init failed', e); }
    showStartScreen();
  });

  window.MainUI = { get S() { return S; }, newGame, loadState, toast };
})();
