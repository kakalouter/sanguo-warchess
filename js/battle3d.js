// ===========================================================================
// 战场 3D 渲染 —— 真实地形切片、兵种模型、战法特效
// ===========================================================================
(function () {
  'use strict';

  const M = () => window.SANGUO_MAP;
  let renderer, scene, camera, canvas;
  let fieldMesh, unitLayer, fxLayer, overlayLayer;
  let B = null;
  let cam = { theta: 0, phi: 0.95, dist: 46, target: new THREE.Vector3(0, 0, 0) };
  let clock, running = false;
  let hGrid = null, hW = 0, hH = 0;
  let onSelectUnit = null, onOrder = null;
  let selected = null;
  let hlMeshes = [];
  let pickables = [];
  let time = 0;

  // 战场世界尺寸：1 格 = 2 世界单位
  const CELL = 2.0;
  const HSC = 0.0042;

  function cellToWorld(x, y) {
    return { x: (x - (Battle.BW - 1) / 2) * CELL, z: (y - (Battle.BH - 1) / 2) * CELL };
  }

  // ------------------------------------------------------------ 高度图
  function loadBattleHeight() {
    // 优先复用 Slice 模块已解码的高程（启动时已加载）
    if (window.Slice && window.Slice.ready) {
      const sz = window.Slice.size();
      hW = sz.W; hH = sz.H;
      hGrid = true;   // 占位：sampleBattle 会转发给 Slice
      return Promise.resolve();
    }
    if (window.Slice) return window.Slice.init();
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        const d = ctx.getImageData(0, 0, img.width, img.height).data;
        hW = img.width; hH = img.height;
        hGrid = new Float32Array(hW * hH);
        for (let i = 0; i < hW * hH; i++) hGrid[i] = M().hMax * Math.pow(d[i * 4] / 255, 1 / M().hExp);
        resolve();
      };
      img.onerror = () => resolve();
      img.src = M().batPNG;
    });
  }
  function sampleBattle(sx, sy) {
    if (window.Slice && window.Slice.ready) return window.Slice.sample(sx, sy);
    if (!hGrid || hGrid === true) return 0;
    const x = Math.max(0, Math.min(hW - 1, Math.round(sx)));
    const y = Math.max(0, Math.min(hH - 1, Math.round(sy)));
    return hGrid[y * hW + x];
  }
  // 战场局部高程（相对最低点的相对高差，映射到世界单位）
  let localBase = 0, localRange = 200;

  // ------------------------------------------------------------ 地形网格
  function buildField() {
    const f = B.field;
    const W = f.w, H = f.h;
    const verts = new Float32Array(W * H * 3);
    const cols = new Float32Array(W * H * 3);
    // 采样真实高程，得到起伏
    const K = 2;
    const c0 = Math.round((f.center.lon - M().lonMin) / (M().lonMax - M().lonMin) * hW - W * K / 2);
    const r0 = Math.round((M().latMax - f.center.lat) / (M().latMax - M().latMin) * hH - H * K / 2);
    const raw = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let s = 0, n = 0;
      for (let j = 0; j < K; j++) for (let i = 0; i < K; i++) { s += sampleBattle(c0 + x * K + i, r0 + y * K + j); n++; }
      raw.push(s / n);
    }
    const sorted = raw.slice().sort((a, b) => a - b);
    localBase = sorted[Math.floor(sorted.length * 0.05)] || 0;
    localRange = Math.max(60, (sorted[Math.floor(sorted.length * 0.95)] || 100) - localBase);
    const reliefGain = 5.2;   // 相对高差 -> 世界单位

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const t = Battle.TERRAIN[f.grid[Battle.key(x, y)]];
        const p = cellToWorld(x, y);
        let rel = (raw[y * W + x] - localBase) / localRange;
        rel = Math.max(-0.2, Math.min(1.4, rel));
        let h = rel * reliefGain;
        if (t.key === 'water') h = Math.min(h, -0.35);
        if (t.key === 'city') h += 0.9;
        if (t.key === 'road') h += 0.03;
        const i = (y * W + x) * 3;
        verts[i] = p.x; verts[i + 1] = h; verts[i + 2] = p.z;
        let col = t.color;
        // 轻微色相扰动，避免死板
        const nz = Math.sin(x * 1.7 + y * 2.3) * 0.035;
        cols[i] = col[0] + nz; cols[i + 1] = col[1] + nz * 0.8; cols[i + 2] = col[2] + nz * 0.5;
      }
    }
    const idx = [];
    for (let y = 0; y < H - 1; y++) for (let x = 0; x < W - 1; x++) {
      const a = y * W + x, b = a + 1, c = a + W, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0.02 });
    fieldMesh = new THREE.Mesh(g, mat);
    fieldMesh.receiveShadow = true;
    scene.add(fieldMesh);

    // 水面
    const wg = new THREE.PlaneGeometry(W * CELL * 1.4, H * CELL * 1.4);
    const wmat = new THREE.MeshPhysicalMaterial({ color: 0x22556e, transparent: true, opacity: 0.82, roughness: 0.08, metalness: 0.5, side: THREE.DoubleSide });
    const wm = new THREE.Mesh(wg, wmat);
    wm.rotation.x = -Math.PI / 2; wm.position.y = -0.34;
    scene.add(wm);
  }

  function groundY(x, y) {
    if (!fieldMesh) return 0;
    const t = Battle.TERRAIN[B.field.grid[Battle.key(x, y)]];
    const K = 2;
    const c0 = Math.round((B.field.center.lon - M().lonMin) / (M().lonMax - M().lonMin) * hW - B.field.w * K / 2);
    const r0 = Math.round((M().latMax - B.field.center.lat) / (M().latMax - M().latMin) * hH - B.field.h * K / 2);
    if (!hGrid) return t.key === 'city' ? 0.9 : 0;
    let s = 0, n = 0;
    for (let j = 0; j < K; j++) for (let i = 0; i < K; i++) { s += sampleBattle(c0 + x * K + i, r0 + y * K + j); n++; }
    let rel = (s / n - localBase) / localRange;
    rel = Math.max(-0.2, Math.min(1.4, rel));
    let h = rel * 5.2;
    if (t.key === 'water') h = Math.min(h, -0.35);
    if (t.key === 'city') h += 0.9;
    if (t.key === 'road') h += 0.03;
    return h;
  }

  // ------------------------------------------------------------ 部队模型
  function troopIcon(troopType, color) {
    const cv = document.createElement('canvas'); cv.width = 96; cv.height = 96;
    const ctx = cv.getContext('2d');
    const c = '#' + new THREE.Color(color).getHexString();
    ctx.strokeStyle = c; ctx.fillStyle = c; ctx.lineWidth = 7; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const T = Battle.TROOPS[troopType];
    ctx.beginPath();
    if (troopType === 'gun') { // 枪
      ctx.moveTo(20, 80); ctx.lineTo(76, 20);
      ctx.moveTo(62, 16); ctx.lineTo(80, 16); ctx.lineTo(80, 34);
    } else if (troopType === 'hal') { // 戟
      ctx.moveTo(20, 80); ctx.lineTo(76, 20);
      ctx.moveTo(58, 26); ctx.lineTo(78, 34);
      ctx.moveTo(68, 14); ctx.lineTo(84, 22);
    } else if (troopType === 'xbow') { // 弩
      ctx.arc(48, 48, 30, -0.9, 0.9);
      ctx.moveTo(22, 34); ctx.lineTo(22, 62);
      ctx.moveTo(18, 48); ctx.lineTo(84, 48);
    } else if (troopType === 'ride') { // 骑
      ctx.moveTo(24, 78); ctx.quadraticCurveTo(30, 44, 58, 40); ctx.lineTo(76, 30);
      ctx.moveTo(52, 42); ctx.lineTo(46, 66); ctx.lineTo(30, 78);
      ctx.moveTo(58, 40); ctx.lineTo(70, 62); ctx.lineTo(62, 80);
      ctx.moveTo(76, 30); ctx.lineTo(86, 44);
    } else if (troopType === 'wep') { // 冲车
      ctx.rect(22, 44, 52, 30);
      ctx.moveTo(30, 44); ctx.lineTo(30, 30); ctx.lineTo(66, 30); ctx.lineTo(66, 44);
      ctx.moveTo(30, 74); ctx.arc(30, 78, 7, 0, 6.3);
      ctx.moveTo(66, 74); ctx.arc(66, 78, 7, 0, 6.3);
    } else { // 船
      ctx.moveTo(16, 56); ctx.quadraticCurveTo(48, 84, 80, 56);
      ctx.moveTo(30, 56); ctx.lineTo(30, 26); ctx.lineTo(66, 38); ctx.lineTo(30, 46);
    }
    ctx.stroke();
    return cv;
  }

  function makeUnit(unit) {
    const grp = new THREE.Group();
    const fdef = GameCore.S.factions[unit.faction] || { color: '#cccccc' };
    const col = new THREE.Color(unit.side === 'attacker' ? fdef.color : fdef.color);
    const size = 2.0;

    // 底座圆盘（势力色）
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.62, 0.7, 0.16, 20),
      new THREE.MeshStandardMaterial({ color: col, roughness: 0.5, metalness: 0.3, emissive: col, emissiveIntensity: 0.2 })
    );
    base.position.y = 0.08;
    grp.add(base);

    // 兵种图标牌（面向相机）
    const cv = troopIcon(unit.troopType, '#f4ead2');
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const icon = new THREE.Mesh(new THREE.PlaneGeometry(size * 0.62, size * 0.62), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false }));
    icon.position.y = size * 0.72;
    icon.renderOrder = 6;
    icon.name = 'icon';
    grp.add(icon);

    // 武将头像牌
    const portrait = portraitFor(unit);
    const pf = new THREE.Mesh(new THREE.PlaneGeometry(size * 0.94, size * 0.94), new THREE.MeshBasicMaterial({ map: portrait, transparent: true, depthTest: false }));
    pf.position.set(size * 0.72, size * 0.86, 0);
    pf.renderOrder = 7;
    pf.name = 'face';
    grp.add(pf);
    const frame = new THREE.Mesh(new THREE.PlaneGeometry(size * 1.0, size * 1.0), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.9, depthTest: false }));
    frame.position.set(size * 0.72, size * 0.86, -0.01);
    frame.renderOrder = 6.5;
    frame.name = 'frame';
    grp.add(frame);

    // 兵力条
    const barBG = new THREE.Mesh(new THREE.PlaneGeometry(size * 1.5, 0.17), new THREE.MeshBasicMaterial({ color: 0x1a1410, depthTest: false, transparent: true, opacity: 0.85 }));
    barBG.position.set(0, size * 1.72, 0); barBG.renderOrder = 8; grp.add(barBG);
    const bar = new THREE.Mesh(new THREE.PlaneGeometry(size * 1.46, 0.12), new THREE.MeshBasicMaterial({ color: 0x5fd07a, depthTest: false }));
    bar.position.set(0, size * 1.72, 0.01); bar.renderOrder = 9; bar.name = 'hpbar'; grp.add(bar);
    // 士气条
    const mBG = new THREE.Mesh(new THREE.PlaneGeometry(size * 1.5, 0.10), new THREE.MeshBasicMaterial({ color: 0x1a1410, depthTest: false, transparent: true, opacity: 0.8 }));
    mBG.position.set(0, size * 1.56, 0); mBG.renderOrder = 8; grp.add(mBG);
    const mbar = new THREE.Mesh(new THREE.PlaneGeometry(size * 1.46, 0.07), new THREE.MeshBasicMaterial({ color: 0xe0b24a, depthTest: false }));
    mbar.position.set(0, size * 1.56, 0.01); mbar.renderOrder = 9; mbar.name = 'mbar'; grp.add(mbar);

    // 兵种小旗
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.6, 5), new THREE.MeshStandardMaterial({ color: 0x3a3228 }));
    pole.position.set(-size * 0.6, 1.3, 0); grp.add(pole);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.52), new THREE.MeshStandardMaterial({ color: col, side: THREE.DoubleSide, emissive: col, emissiveIntensity: 0.24 }));
    flag.position.set(-size * 0.6 + 0.42, 2.2, 0); flag.name = 'flag'; grp.add(flag);

    grp.userData = { type: 'unit', id: unit.id };
    grp.traverse((o) => { o.userData.pickUnit = unit.id; });
    return grp;
  }

  const portraitCache = new Map();
  function loadImage(src) {
    return new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
  }
  function portraitFor(unit) {
    const g = unit.general;
    const key = g ? g.name : '__none';
    if (portraitCache.has(key)) return portraitCache.get(key);
    const cv = document.createElement('canvas'); cv.width = 128; cv.height = 128;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#2a231a'; ctx.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    portraitCache.set(key, tex);
    if (g && window.Portraits) {
      window.Portraits.get(g.name).then((img) => {
        if (img) {
          const c2 = document.createElement('canvas'); c2.width = 128; c2.height = 128;
          const x2 = c2.getContext('2d');
          const s = Math.min(img.width, img.height);
          x2.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 128, 128);
          tex.image = c2; tex.needsUpdate = true;
        } else if (window.PortraitGen) {
          const c3 = document.createElement('canvas'); c3.width = 128; c3.height = 128;
          const x3 = c3.getContext('2d');
          window.PortraitGen.drawPortrait(x3, { name: g.name, war: g.war, intel: g.intel, lead: g.lead, pol: g.pol, charm: g.charm }, { size: 128, faction: factionHue(unit.faction) });
          tex.image = c3; tex.needsUpdate = true;
        }
      });
    }
    return tex;
  }
  function factionHue(fid) {
    const f = window.SANGUO_FACTIONS[fid];
    return f ? { hue: f.hue, color: f.color, dark: f.dark } : { hue: 34, color: '#7a6a52', dark: '#3a3226' };
  }

  function rebuildUnits(animateNew) {
    if (!unitLayer) { unitLayer = new THREE.Group(); scene.add(unitLayer); }
    const live = new Set(B.units.filter((u) => u.troops > 0).map((u) => u.id));
    for (const ch of [...unitLayer.children]) {
      if (!live.has(ch.userData.id)) {
        // 溃灭动画
        if (ch.userData.dying !== true) {
          ch.userData.dying = true;
          ch.userData.dieT = 0;
        }
      }
    }
    for (const u of B.units) {
      if (u.troops <= 0) continue;
      let grp = unitLayer.children.find((c) => c.userData.id === u.id);
      if (!grp) {
        grp = makeUnit(u);
        const p = cellToWorld(u.x, u.y);
        grp.position.set(p.x, groundY(u.x, u.y), p.z);
        unitLayer.add(grp);
        if (animateNew !== false) { grp.scale.set(0.01, 0.01, 0.01); grp.userData.spawnT = 0; }
      }
      grp.userData.unit = u;
      updateUnitVisual(grp, u);
    }
  }

  function updateUnitVisual(grp, u) {
    const hp = Math.max(0, u.troops / u.maxTroops);
    const bar = grp.getObjectByName('hpbar');
    if (bar) {
      bar.scale.x = Math.max(0.001, hp);
      bar.position.x = -(1 - hp) * 1.5 * 0.5;
      bar.material.color.setHex(hp > 0.6 ? 0x5fd07a : hp > 0.3 ? 0xe0b24a : 0xd0473a);
    }
    const mb = grp.getObjectByName('mbar');
    if (mb) { mb.scale.x = Math.max(0.001, u.morale / 100); mb.position.x = -(1 - u.morale / 100) * 1.5 * 0.5; }
    // 选中高亮
    const isSel = selected && selected.id === u.id;
    const fr = grp.getObjectByName('frame');
    if (fr) fr.material.color.setHex(isSel ? 0xffe08a : (grp.getObjectByName('frame').material.userData.base || 0xffffff));
    if (isSel) fr.material.color.setHex(0xffe08a);
    if (u.acted && !isSel) { /* 行动完的略灰 */ }
  }

  // ------------------------------------------------------------ 高亮
  function clearHighlight() {
    for (const m of hlMeshes) { overlayLayer.remove(m); m.geometry.dispose(); m.material.dispose(); }
    hlMeshes = [];
  }
  function highlightCells(cells, color, opacity) {
    for (const c of cells) {
      const p = cellToWorld(c.x, c.y);
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(CELL * 0.86, CELL * 0.86),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: opacity || 0.34, side: THREE.DoubleSide, depthWrite: false })
      );
      m.rotation.x = -Math.PI / 2;
      m.position.set(p.x, groundY(c.x, c.y) + 0.14, p.z);
      m.renderOrder = 3;
      overlayLayer.add(m);
      hlMeshes.push(m);
    }
  }
  function highlightRange(cells) { highlightCells(cells, 0x64c8ff, 0.30); }
  function highlightTargets(cells) { highlightCells(cells, 0xff6a4a, 0.42); }
  function markSelected(u) {
    clearHighlight();
    if (!u) return;
    const r = Battle.reachable(B, u);
    highlightRange(r.cells);
  }

  // ------------------------------------------------------------ 特效
  function spawnFx(type, x, y, color) {
    const p = cellToWorld(x, y);
    const gy = groundY(x, y);
    if (type === 'slash') {
      for (let i = 0; i < 10; i++) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 2.4), new THREE.MeshBasicMaterial({ color: color || 0xffd27a, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false }));
        m.position.set(p.x + (Math.random() - 0.5) * 1.4, gy + 1.1 + Math.random() * 0.9, p.z + (Math.random() - 0.5) * 1.4);
        m.rotation.z = (Math.random() - 0.5) * 1.6;
        m.rotation.y = Math.random() * Math.PI;
        fxLayer.add(m);
        m.userData.fx = { t: 0, life: 0.42, vy: 0.5 };
      }
    } else if (type === 'fire') {
      for (let i = 0; i < 26; i++) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.22 + Math.random() * 0.3, 6, 5),
          new THREE.MeshBasicMaterial({ color: i % 3 === 0 ? 0xffe08a : 0xff6a20, transparent: true, opacity: 0.92, depthWrite: false }));
        m.position.set(p.x + (Math.random() - 0.5) * 2.6, gy + 0.3 + Math.random() * 1.6, p.z + (Math.random() - 0.5) * 2.6);
        fxLayer.add(m);
        m.userData.fx = { t: 0, life: 0.9 + Math.random() * 0.5, vy: 1.6 + Math.random(), vx: (Math.random() - 0.5) * 1.2, vz: (Math.random() - 0.5) * 1.2 };
      }
    } else if (type === 'impact') {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.5, 24), new THREE.MeshBasicMaterial({ color: 0xfff0c8, transparent: true, opacity: 1, side: THREE.DoubleSide, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(p.x, gy + 0.2, p.z);
      fxLayer.add(ring);
      ring.userData.fx = { t: 0, life: 0.5, grow: 7 };
      for (let i = 0; i < 8; i++) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.16, 5, 4), new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.9, depthWrite: false }));
        m.position.set(p.x, gy + 0.6, p.z);
        fxLayer.add(m);
        m.userData.fx = { t: 0, life: 0.6, vy: 2.6 + Math.random() * 2, vx: (Math.random() - 0.5) * 4.2, vz: (Math.random() - 0.5) * 4.2, grav: -7 };
      }
    } else if (type === 'banner') {
      for (let i = 0; i < 12; i++) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.5), new THREE.MeshBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
        m.position.set(p.x, gy + 1.4, p.z);
        fxLayer.add(m);
        m.userData.fx = { t: 0, life: 1.1, vy: -1.2 + Math.random(), vx: (Math.random() - 0.5) * 2.4, vz: (Math.random() - 0.5) * 2.4, spin: (Math.random() - 0.5) * 6 };
      }
    }
  }
  function updateFx(dt) {
    for (const m of [...fxLayer.children]) {
      const f = m.userData.fx;
      if (!f) continue;
      f.t += dt;
      const k = f.t / f.life;
      if (k >= 1) { fxLayer.remove(m); m.geometry.dispose(); m.material.dispose(); continue; }
      if (f.vx) m.position.x += f.vx * dt;
      if (f.vz) m.position.z += f.vz * dt;
      if (f.vy) {
        m.position.y += f.vy * dt;
        if (f.grav) f.vy += f.grav * dt;
      }
      if (f.grow) m.scale.setScalar(1 + k * f.grow);
      if (f.spin) m.rotation.z += f.spin * dt;
      m.material.opacity = (1 - k) * 0.95;
    }
  }

  // ------------------------------------------------------------ 相机
  function updateCamera(dt) {
    const cp = Math.cos(cam.phi), sp = Math.sin(cam.phi);
    const x = cam.target.x + cam.dist * cp * Math.sin(cam.theta);
    const z = cam.target.z + cam.dist * cp * Math.cos(cam.theta);
    const y = cam.target.y + cam.dist * sp;
    camera.position.lerp(new THREE.Vector3(x, Math.max(4, y), z), Math.min(1, dt * 5));
    camera.lookAt(cam.target);
  }
  function centerOn(x, y, dist) {
    const p = cellToWorld(x, y);
    cam.target.set(p.x, groundY(x, y) * 0.6, p.z);
    if (dist) cam.dist = dist;
  }

  // ------------------------------------------------------------ 输入
  function bindInput() {
    const el = renderer.domElement;
    let dragging = false, moved = false, lx = 0, ly = 0;
    el.addEventListener('pointerdown', (e) => { if (e.button === 0) { dragging = true; moved = false; lx = e.clientX; ly = e.clientY; el.setPointerCapture(e.pointerId); } });
    el.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - lx, dy = e.clientY - ly; lx = e.clientX; ly = e.clientY;
      if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
      if (e.shiftKey || (e.buttons & 4)) { cam.theta -= dx * 0.006; cam.phi = Math.max(0.16, Math.min(1.44, cam.phi - dy * 0.005)); }
      else {
        const k = cam.dist * 0.0018;
        const fwd = new THREE.Vector3(-Math.sin(cam.theta), 0, -Math.cos(cam.theta));
        const right = new THREE.Vector3(fwd.z, 0, -fwd.x);
        cam.target.addScaledVector(right, -dx * k).addScaledVector(fwd, -dy * k);
      }
    });
    el.addEventListener('pointerup', (e) => {
      dragging = false;
      if (!moved && e.button === 0) click(e.clientX, e.clientY);
    });
    el.addEventListener('wheel', (e) => { e.preventDefault(); cam.dist = Math.max(12, Math.min(110, cam.dist * (1 + Math.sign(e.deltaY) * 0.1))); }, { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  const ray = new THREE.Raycaster();
  const ptr = new THREE.Vector2();
  function pickCell(clientX, clientY) {
    const rect = renderer.domElement.getBoundingClientRect();
    ptr.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    ptr.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    ray.setFromCamera(ptr, camera);
    const hits = ray.intersectObject(fieldMesh, false);
    if (!hits.length) return null;
    const p = hits[0].point;
    const gx = Math.round(p.x / CELL + (Battle.BW - 1) / 2);
    const gy = Math.round(p.z / CELL + (Battle.BH - 1) / 2);
    if (gx < 0 || gy < 0 || gx >= Battle.BW || gy >= Battle.BH) return null;
    return { x: gx, y: gy };
  }
  function pickUnit(clientX, clientY) {
    const rect = renderer.domElement.getBoundingClientRect();
    ptr.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    ptr.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    ray.setFromCamera(ptr, camera);
    const hits = ray.intersectObjects(unitLayer ? unitLayer.children : [], true);
    for (const h of hits) {
      let o = h.object;
      while (o && !o.userData.pickUnit) o = o.parent;
      if (o && o.userData.pickUnit) return o.userData.pickUnit;
    }
    return null;
  }
  function click(cx, cy) {
    const uid = pickUnit(cx, cy);
    if (uid) { if (onSelectUnit) onSelectUnit(uid); return; }
    const cell = pickCell(cx, cy);
    if (cell && onOrder) onOrder(cell);
  }

  // ------------------------------------------------------------ 循环
  function animate() {
    if (!running) return;
    requestAnimationFrame(animate);
    const dt = Math.min(0.05, clock.getDelta());
    time += dt;
    if (window.__BT) { window.__BT.frames++; window.__BT.lastDt = dt; }
    updateCamera(dt);
    updateFx(dt);
    // 单位朝向相机 + 出生/溃灭动画
    if (unitLayer) {
      for (const grp of [...unitLayer.children]) {
        const u = grp.userData.unit;
        if (grp.userData.spawnT != null) {
          grp.userData.spawnT += dt;
          const k = Math.min(1, grp.userData.spawnT / 0.35);
          const s = 1 + Math.sin(k * Math.PI) * 0.25;
          grp.scale.setScalar(k * s);
          if (k >= 1) grp.userData.spawnT = null;
        }
        if (grp.userData.dying) {
          grp.userData.dieT += dt;
          const k = 1 - Math.min(1, grp.userData.dieT / 0.55);
          grp.scale.setScalar(Math.max(0.001, k));
          grp.position.y -= dt * 2.2;
          if (k <= 0.001) { unitLayer.remove(grp); continue; }
        }
        // 目标格位置
        if (u) {
          const p = cellToWorld(u.x, u.y);
          const gy = groundY(u.x, u.y);
          grp.position.x += (p.x - grp.position.x) * Math.min(1, dt * 7);
          grp.position.z += (p.z - grp.position.z) * Math.min(1, dt * 7);
          grp.position.y += (gy - grp.position.y) * Math.min(1, dt * 7);
        }
        // 面向相机（billboard 部分）
        for (const nm of ['icon', 'face', 'frame', 'hpbar', 'mbar']) {
          const o = grp.getObjectByName(nm);
          if (o) o.quaternion.copy(camera.quaternion);
        }
        const fl = grp.getObjectByName('flag');
        if (fl) fl.rotation.y = Math.sin(time * 2.4 + grp.position.x) * 0.3;
        if (u) updateUnitVisual(grp, u);
      }
    }
    // 高亮呼吸
    for (const m of hlMeshes) m.material.opacity = 0.24 + Math.sin(time * 3.2) * 0.08;
    renderer.render(scene, camera);
    if (window.__BT) {
      window.__BT.renders++;
      const gl = renderer.getContext();
      if (gl && gl.getError() !== 0 && window.__BT.glErr === 0) window.__BT.glErr = gl.getError();
      window.__BT.info = { calls: renderer.info.render.calls, tris: renderer.info.render.triangles };
    }
  }

  // ------------------------------------------------------------ API
  function doResize() {
    if (!canvas || !renderer || !camera) return;
    const w = canvas.clientWidth || canvas.width, h = canvas.clientHeight || canvas.height;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  async function init(canvasEl) {
    canvas = canvasEl;
    clock = new THREE.Clock();
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    // 若容器尚未布局完成（宽高为 0），先用后备尺寸，避免渲染器尺寸为 0×0
    const cw = canvas.clientWidth || canvas.width || 960;
    const ch = canvas.clientHeight || canvas.height || 600;
    renderer.setSize(cw, ch, false);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.06;

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(48, canvas.clientWidth / canvas.clientHeight, 0.4, 400);
    scene.background = new THREE.Color(0x2b3a4d);
    scene.fog = new THREE.FogExp2(0x3a4a5c, 0.008);

    const sun = new THREE.DirectionalLight(0xffe0b0, 2.5);
    sun.position.set(-30, 42, -22);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const d = 34;
    sun.shadow.camera.left = -d; sun.shadow.camera.right = d;
    sun.shadow.camera.top = d; sun.shadow.camera.bottom = -d;
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 160;
    sun.shadow.bias = -0.0012;
    scene.add(sun);
    scene.add(new THREE.HemisphereLight(0xa8c4e0, 0x50442f, 0.7));
    const fill = new THREE.DirectionalLight(0x88a8d0, 0.5);
    fill.position.set(28, 26, 24);
    scene.add(fill);

    fxLayer = new THREE.Group(); scene.add(fxLayer);
    overlayLayer = new THREE.Group(); scene.add(overlayLayer);

    await loadBattleHeight();
    bindInput();
    doResize();
    running = true;
    animate();
    window.addEventListener('resize', doResize);
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(doResize);
      ro.observe(canvas);
    }
    setTimeout(doResize, 60);
  }

  function load(battle) {
    B = battle;
    if (fieldMesh) { scene.remove(fieldMesh); fieldMesh.geometry.dispose(); fieldMesh.material.dispose(); fieldMesh = null; }
    if (unitLayer) { scene.remove(unitLayer); unitLayer = null; }
    clearHighlight();
    for (const m of [...fxLayer.children]) { fxLayer.remove(m); m.geometry.dispose(); m.material.dispose(); }
    // 把 battle 用的采样函数挂到 MAP 上（buildBattlefield 需要）
    if (!M().sampleBattle) M().sampleBattle = sampleBattle;
    buildField();
    rebuildUnits(false);
    // 视角：从攻方看向守方
    const dir = B.field.zones.attacker.length ? B.field.zones.attacker[0] : { x: 0, y: 0 };
    cam.theta = 0; cam.phi = 0.92; cam.dist = 46;
    centerOn(Battle.BW / 2, Battle.BH / 2, 46);
    return true;
  }

  window.BattleView = {
    init, load, rebuildUnits, updateUnitVisual, markSelected, clearHighlight,
    highlightRange, highlightTargets, spawnFx, centerOn, pickCell,
    get B() { return B; },
    set onSelectUnit(fn) { onSelectUnit = fn; },
    set onOrder(fn) { onOrder = fn; },
    set selected(u) { selected = u; },
    get cam() { return cam; },
  };
})();
