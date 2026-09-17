// ===========================================================================
// 战略地图 3D 渲染 —— 真实 DEM 地形 + 城池/关隘/部队 + 领地着色
// 坐标：世界单位 = 经纬度（1 单位 ≈ 1 度），等比，不做墨卡托拉伸
// ===========================================================================
(function () {
  'use strict';

  const DEG2W = 1.0;
  // 高度已在高程烘焙时做非线性压缩（hExp=0.78），此处只做线性缩放。
  // 视觉最高点约 20 世界单位（相对 62 单位的地图宽度），既有山势又不吞掉低地。
  const HSCALE = 0.0036;
  const EXAG = 1.0;           // 压缩已在烘焙阶段完成，游戏内不再二次夸张

  let renderer, scene, camera, canvas;
  let terrainMesh, waterMesh, texImage;
  let heightGrid = null, gw = 0, gh = 0;
  let M = null;
  let cityObjects = new Map();
  let armyObjects = new Map();
  let borderLayer, roadLayer;
  let clock;
  let onPick = null;
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  // 地形高度查询（双线性）
  function terrainHeightAt(lon, lat) {
    if (!heightGrid) return 0;
    const fx = ((lon - M.lonMin) / (M.lonMax - M.lonMin)) * (gw - 1);
    const fy = ((M.latMax - lat) / (M.latMax - M.latMin)) * (gh - 1);
    const x0 = Math.max(0, Math.min(gw - 2, Math.floor(fx)));
    const y0 = Math.max(0, Math.min(gh - 2, Math.floor(fy)));
    const tx = Math.max(0, Math.min(1, fx - x0)), ty = Math.max(0, Math.min(1, fy - y0));
    const h00 = heightGrid[y0 * gw + x0], h10 = heightGrid[y0 * gw + x0 + 1];
    const h01 = heightGrid[(y0 + 1) * gw + x0], h11 = heightGrid[(y0 + 1) * gw + x0 + 1];
    const h = (h00 * (1 - tx) + h10 * tx) * (1 - ty) + (h01 * (1 - tx) + h11 * tx) * ty;
    return Math.max(0, h) * HSCALE * EXAG;
  }
  function worldX(lon) { return (lon - (M.lonMin + M.lonMax) / 2) * DEG2W; }
  function worldZ(lat) { return -(lat - (M.latMin + M.latMax) / 2) * DEG2W; }
  function lonLatToWorld(lon, lat) { return { x: worldX(lon), z: worldZ(lat) }; }

  // ------------------------------------------------------------- 贴图解码
  function loadHeightGrid(dataURL) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        try {
          const c = document.createElement('canvas');
          c.width = img.width; c.height = img.height;
          const ctx = c.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(img, 0, 0);
          const d = ctx.getImageData(0, 0, img.width, img.height).data;
          gw = img.width; gh = img.height;
          heightGrid = new Float32Array(gw * gh);
          for (let i = 0; i < gw * gh; i++) heightGrid[i] = M.hMax * Math.pow(d[i * 4] / 255, 1 / M.hExp);
          resolve();
        } catch (e) { reject(new Error('高度图解码失败（可能是浏览器画布安全限制）：' + e.message)); }
      };
      img.onerror = () => reject(new Error('height png load fail'));
      img.src = dataURL;
    });
  }
  function loadTexture(dataURL) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const tex = new THREE.CanvasTexture(img);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.generateMipmaps = true;
        resolve(tex);
      };
      img.onerror = () => reject(new Error('tex png load fail'));
      img.src = dataURL;
    });
  }

  // ------------------------------------------------------------- 地形网格
  function buildTerrain(tex) {
    const W = M.gridW, H = M.gridH;
    const verts = new Float32Array(W * H * 3);
    const uvs = new Float32Array(W * H * 2);
    const idx = new Uint32Array((W - 1) * (H - 1) * 6);
    // 把城池/关隘所在地局部压平，避免城池悬空
    const flats = [];
    if (window.GameCore && GameCore.S) {
      for (const c of Object.values(GameCore.S.cities)) flats.push({ lon: c.lon, lat: c.lat });
    }
    const flatCache = new Map();
    function sampleH(lon, lat) {
      const key = lon.toFixed(2) + ',' + lat.toFixed(2);
      if (flatCache.has(key)) return flatCache.get(key);
      const v = terrainHeightNoFlat(lon, lat);
      flatCache.set(key, v);
      return v;
    }
    function cityInfluence(lon, lat) {
      for (const f of flats) {
        const d = Math.hypot((lon - f.lon) * 0.95, lat - f.lat);
        if (d < 1.1) return { t: 1 - d / 1.1, f };
      }
      return null;
    }

    for (let r = 0; r < H; r++) {
      const lat = M.latMax - (r / (H - 1)) * (M.latMax - M.latMin);
      for (let c = 0; c < W; c++) {
        const lon = M.lonMin + (c / (W - 1)) * (M.lonMax - M.lonMin);
        let h = terrainHeightRaw(c, r);
        const infl = cityInfluence(lon, lat);
        if (infl) {
          const cityH = sampleH(infl.f.lon, infl.f.lat);
          h = h * (1 - infl.t) + cityH * infl.t;
        }
        const i = (r * W + c) * 3;
        verts[i] = worldX(lon); verts[i + 1] = Math.max(0.02, h); verts[i + 2] = worldZ(lat);
        const u = (lon - M.lonMin) / (M.lonMax - M.lonMin);
        const v = (lat - M.latMin) / (M.latMax - M.latMin);
        uvs[(r * W + c) * 2] = u; uvs[(r * W + c) * 2 + 1] = v;
      }
    }
    let k = 0;
    for (let r = 0; r < H - 1; r++) for (let c = 0; c < W - 1; c++) {
      const a = r * W + c, b = a + 1, d = a + W, e = d + 1;
      idx[k++] = a; idx[k++] = d; idx[k++] = b;
      idx[k++] = b; idx[k++] = d; idx[k++] = e;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    // 几何自检：顶点高度范围、异常顶点、NaN
    if (window.__MAPDBG) {
      let mn = 1e9, mx = -1e9, nan = 0, neg = 0;
      const spikes = [];
      for (let i = 0; i < verts.length; i += 3) {
        const y = verts[i + 1];
        if (!isFinite(y)) { nan++; continue; }
        if (y < 0) neg++;
        if (y < mn) mn = y;
        if (y > mx) mx = y;
      }
      // 相邻顶点高度跳变（真正的尖刺来源）
      let maxJump = 0, jumpCount = 0, jx = 0, jy = 0;
      for (let r = 0; r < H; r++) for (let c = 0; c + 1 < W; c++) {
        const a = verts[(r * W + c) * 3 + 1], b = verts[(r * W + c + 1) * 3 + 1];
        const d = Math.abs(a - b);
        if (d > 3) { jumpCount++; if (d > maxJump) { maxJump = d; jx = c; jy = r; } }
      }
      window.__MAPDBG.geom = { verts: verts.length / 3, minY: +mn.toFixed(2), maxY: +mx.toFixed(2), nan, neg, maxJump: +maxJump.toFixed(2), jumpCount, jumpAt: [jx, jy] };
      window.__MAPDBG.heightRange = (() => {
        let a = 1e9, b = -1e9;
        for (let i = 0; i < heightGrid.length; i++) { if (heightGrid[i] < a) a = heightGrid[i]; if (heightGrid[i] > b) b = heightGrid[i]; }
        return [+a.toFixed(0), +b.toFixed(0)];
      })();
      window.__MAPDBG.vertExample = [];
      for (const [c, r] of [[100, 100], [300, 200], [10, 10], [500, 400]]) {
        if (c < W && r < H) window.__MAPDBG.vertExample.push({ c, r, y: +verts[(r * W + c) * 3 + 1].toFixed(2), gh: +heightGrid[r * gw + c].toFixed(0) });
      }
    }
    const mat = new THREE.MeshStandardMaterial({
      map: tex, roughness: 0.94, metalness: 0.02,
      flatShading: false,
    });
    terrainMesh = new THREE.Mesh(g, mat);
    terrainMesh.receiveShadow = true;
    terrainMesh.name = 'terrain';
    scene.add(terrainMesh);
    return terrainMesh;
  }

  function terrainHeightRaw(c, r) {
    const h = heightGrid[r * gw + c] || 0;
    return Math.max(0, h) * HSCALE * EXAG;
  }
  function terrainHeightNoFlat(lon, lat) { return terrainHeightAt(lon, lat); }

  // 海平面（半透明水面）
  function buildSea() {
    const g = new THREE.PlaneGeometry((M.lonMax - M.lonMin) * DEG2W * 1.05, (M.latMax - M.latMin) * DEG2W * 1.05, 1, 1);
    const mat = new THREE.MeshPhysicalMaterial({
      color: 0x1d4f6b, transparent: true, opacity: 0.88,
      roughness: 0.12, metalness: 0.35, transmission: 0.0,
      side: THREE.DoubleSide, depthWrite: false,
    });
    waterMesh = new THREE.Mesh(g, mat);
    waterMesh.rotation.x = -Math.PI / 2;
    waterMesh.position.y = 0.06;
    waterMesh.name = 'sea';
    scene.add(waterMesh);
  }

  // ------------------------------------------------------------- 城池模型
  function makeCityGroup(city, faction) {
    const grp = new THREE.Group();
    const kind = city.kind;
    const scale = city.tier === 1 ? 1.5 : city.tier === 2 ? 1.15 : city.kind === 'pass' ? 0.75 : 0.9;
    const wallCol = kind === 'pass' ? 0x6d6357 : kind === 'port' ? 0x5f6b73 : 0x8a7c68;
    const roofCol = faction ? new THREE.Color(faction.color).getHex() : 0x6a6155;

    // 城墙
    const wallH = (kind === 'capital' ? 1.5 : kind === 'pass' ? 1.9 : 1.05) * scale;
    const wallW = (kind === 'pass' ? 2.4 : 2.1) * scale;
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(wallW, wallH, wallW),
      new THREE.MeshStandardMaterial({ color: wallCol, roughness: 0.92, metalness: 0.03 })
    );
    wall.position.y = wallH / 2;
    wall.castShadow = true; wall.receiveShadow = true;
    grp.add(wall);

    // 城墙垛口（顶部一圈小方块）
    const merlonMat = new THREE.MeshStandardMaterial({ color: 0x7a6f5e, roughness: 0.9 });
    const n = 6;
    for (let i = 0; i < n; i++) {
      for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.22 * scale, 0.26 * scale, 0.22 * scale), merlonMat);
        const t = (i / (n - 1) - 0.5) * wallW * 0.82;
        m.position.set(dx ? dx * wallW / 2 : t, wallH + 0.13 * scale, dz ? dz * wallW / 2 : t);
        grp.add(m);
      }
    }
    // 城内主楼（飞檐）
    const bldH = (kind === 'capital' ? 1.5 : kind === 'pass' ? 0.9 : 1.0) * scale;
    const bld = new THREE.Mesh(
      new THREE.CylinderGeometry(0.34 * scale, 0.5 * scale, bldH, 4),
      new THREE.MeshStandardMaterial({ color: 0xb5a68c, roughness: 0.85 })
    );
    bld.position.y = wallH + bldH / 2;
    bld.rotation.y = Math.PI / 4;
    bld.castShadow = true;
    grp.add(bld);
    // 屋顶
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(0.78 * scale, 0.55 * scale, 4),
      new THREE.MeshStandardMaterial({ color: roofCol, roughness: 0.6, metalness: 0.12 })
    );
    roof.position.y = wallH + bldH + 0.26 * scale;
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    grp.add(roof);
    // 城楼旗杆
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, 1.9 * scale, 6),
      new THREE.MeshStandardMaterial({ color: 0x4a4038, roughness: 0.8 })
    );
    pole.position.y = wallH + bldH + 0.55 * scale + 0.95 * scale;
    grp.add(pole);
    // 旗帜
    if (faction) {
      const flagCol = new THREE.Color(faction.color).getHex();
      const flag = new THREE.Mesh(
        new THREE.PlaneGeometry(0.72 * scale, 0.46 * scale),
        new THREE.MeshStandardMaterial({ color: flagCol, roughness: 0.75, side: THREE.DoubleSide, emissive: flagCol, emissiveIntensity: 0.22 })
      );
      flag.position.set(0.38 * scale, wallH + bldH + 1.35 * scale, 0);
      flag.name = 'flag';
      grp.add(flag);
    }
    // 关隘加个门洞
    if (kind === 'pass') {
      const gate = new THREE.Mesh(
        new THREE.BoxGeometry(0.55 * scale, 0.72 * scale, wallW * 1.04),
        new THREE.MeshStandardMaterial({ color: 0x2b241d, roughness: 1 })
      );
      gate.position.y = 0.36 * scale;
      grp.add(gate);
    }
    // 光晕（可选；重要城池）
    if (city.tier === 1) {
      const halo = new THREE.Mesh(
        new THREE.RingGeometry(1.6 * scale, 2.5 * scale, 32),
        new THREE.MeshBasicMaterial({ color: faction ? new THREE.Color(faction.color).getHex() : 0xffffff, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false })
      );
      halo.rotation.x = -Math.PI / 2;
      halo.position.y = 0.09;
      grp.add(halo);
    }
    return grp;
  }

  function rebuildCities() {
    for (const [, o] of cityObjects) { scene.remove(o.group); disposeGroup(o.group); }
    cityObjects.clear();
    const G = GameCore.S;
    for (const c of Object.values(G.cities)) {
      const f = G.factions[c.owner];
      const grp = makeCityGroup(c, c.owner === 'neutral' ? null : f);
      const p = lonLatToWorld(c.lon, c.lat);
      grp.position.set(p.x, terrainHeightAt(c.lon, c.lat), p.z);
      grp.userData = { type: 'city', id: c.id };
      grp.traverse((o) => { o.userData.pickCity = c.id; });
      scene.add(grp);
      cityObjects.set(c.id, { group: grp, city: c });
    }
  }

  function updateCityOwners() {
    const G = GameCore.S;
    for (const [id, o] of cityObjects) {
      const c = G.cities[id];
      const f = G.factions[c.owner];
      const col = c.owner === 'neutral' ? new THREE.Color(0x8a8272) : new THREE.Color(f.color);
      o.group.traverse((n) => {
        if (n.name === 'flag' && n.material) {
          n.material.color.copy(col);
          n.material.emissive.copy(col);
        }
      });
      // 屋顶也用势力色
      o.group.children.forEach((n, i) => {
        if (n.geometry && n.geometry.type === 'ConeGeometry' && n.material) n.material.color.copy(col).lerp(new THREE.Color(0x6a5a44), 0.55);
      });
    }
  }

  // ------------------------------------------------------------- 道路
  function rebuildRoads() {
    if (roadLayer) { scene.remove(roadLayer); disposeGroup(roadLayer); roadLayer = null; }
    const G = GameCore.S;
    const pts = [];
    const seen = new Set();
    for (const a of Object.values(G.cities)) {
      for (const nid of (G.adj && G.adj[a.id]) || []) {
        const k = a.id < nid ? a.id + '|' + nid : nid + '|' + a.id;
        if (seen.has(k)) continue;
        seen.add(k);
        const b = G.cities[nid];
        if (!b) continue;
        // 沿大圆插值并贴合地形
        const N = 14;
        let prev = null;
        for (let i = 0; i <= N; i++) {
          const t = i / N;
          const lon = a.lon + (b.lon - a.lon) * t;
          const lat = a.lat + (b.lat - a.lat) * t;
          const p = lonLatToWorld(lon, lat);
          const y = terrainHeightAt(lon, lat) + 0.10;
          if (prev) { pts.push(prev.x, prev.y, prev.z, p.x, y, p.z); }
          prev = { x: p.x, y, z: p.z };
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const m = new THREE.LineBasicMaterial({ color: 0xc9a86a, transparent: true, opacity: 0.30 });
    roadLayer = new THREE.LineSegments(g, m);
    roadLayer.name = 'roads';
    scene.add(roadLayer);
  }

  // ------------------------------------------------------------- 领地边界
  function rebuildBorders() {
    if (borderLayer) { scene.remove(borderLayer); disposeGroup(borderLayer); borderLayer = null; }
    const G = GameCore.S;
    const pts = [], cols = [];
    const seen = new Set();
    for (const a of Object.values(G.cities)) {
      for (const nid of (G.adj && G.adj[a.id]) || []) {
        const b = G.cities[nid];
        if (!b) continue;
        if (a.owner === b.owner) continue;
        const k = a.id < nid ? a.id + '|' + nid : nid + '|' + a.id;
        if (seen.has(k)) continue;
        seen.add(k);
        const N = 12;
        let prev = null;
        for (let i = 0; i <= N; i++) {
          const t = i / N;
          const lon = (a.lon + b.lon) / 2 + (a.lon - b.lon) * 0.18 * Math.sin(t * Math.PI) ;
          const lat = a.lat + (b.lat - a.lat) * t;
          const p = lonLatToWorld(lon, lat);
          const y = terrainHeightAt(lon, lat) + 0.22;
          if (prev) {
            const c1 = new THREE.Color(G.factions[a.owner] ? G.factions[a.owner].color : '#888');
            pts.push(prev.x, prev.y, prev.z, p.x, y, p.z);
            cols.push(c1.r, c1.g, c1.b, c1.r, c1.g, c1.b);
          }
          prev = { x: p.x, y, z: p.z };
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    borderLayer = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55 }));
    borderLayer.name = 'borders';
    scene.add(borderLayer);
  }

  // ------------------------------------------------------------- 部队
  function makeArmyMesh(army) {
    const G = GameCore.S;
    const f = G.factions[army.faction];
    const col = new THREE.Color(f ? f.color : '#cccccc');
    const grp = new THREE.Group();
    // 旗帜
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.6, 6), new THREE.MeshStandardMaterial({ color: 0x3a3228 }));
    pole.position.y = 1.3; grp.add(pole);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.66), new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.35, side: THREE.DoubleSide }));
    flag.position.set(0.52, 2.0, 0);
    grp.add(flag);
    // 兵牌
    const cv = document.createElement('canvas'); cv.width = 128; cv.height = 64;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = 'rgba(20,16,12,0.82)'; ctx.fillRect(0, 0, 128, 64);
    ctx.strokeStyle = '#' + col.getHexString(); ctx.lineWidth = 5; ctx.strokeRect(2.5, 2.5, 123, 59);
    ctx.fillStyle = '#f2e6c8'; ctx.font = 'bold 40px "Microsoft YaHei",sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(army.generals.length ? (G.generals[army.generals[0]] || {}).name || '军' : '军', 64, 34);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.75), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false }));
    plate.position.y = 3.0; plate.renderOrder = 10;
    grp.add(plate);
    // 地面光环
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.95, 24), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.12; grp.add(ring);
    grp.userData = { type: 'army', id: army.id };
    grp.traverse((o) => { o.userData.pickArmy = army.id; });
    return grp;
  }

  function rebuildArmies() {
    const G = GameCore.S;
    const live = new Set(G.armies.map((a) => a.id));
    for (const [id, o] of armyObjects) {
      if (!live.has(id)) { scene.remove(o.group); disposeGroup(o.group); armyObjects.delete(id); }
    }
    for (const a of G.armies) {
      if (!armyObjects.has(a.id)) {
        const grp = makeArmyMesh(a);
        scene.add(grp);
        armyObjects.set(a.id, { group: grp, army: a, x: null, z: null });
      }
      const o = armyObjects.get(a.id);
      o.army = a;
      const c = G.cities[a.at];
      if (c) {
        const p = lonLatToWorld(c.lon + 0.55, c.lat - 0.4);
        o.tx = p.x; o.tz = p.z;
        if (o.x == null) { o.x = p.x; o.z = p.z; }
      }
    }
  }

  function disposeGroup(g) {
    g.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); });
        else { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
      }
    });
  }

  // ------------------------------------------------------------- 光照/天空
  function buildEnvironment() {
    // 天空穹顶渐变（高天青蓝、地平线暖赭，衬出绢本地图气质）
    const skyGeo = new THREE.SphereGeometry(400, 40, 24);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: {
        top: { value: new THREE.Color(0x14243d) },
        mid: { value: new THREE.Color(0x54688a) },
        bot: { value: new THREE.Color(0xc9a978) },
      },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `varying vec3 vP; uniform vec3 top; uniform vec3 mid; uniform vec3 bot;
        void main(){ float h = normalize(vP).y;
          vec3 c = h > 0.02
            ? mix(mid, top, smoothstep(0.02, 0.62, h))
            : mix(bot, mid, smoothstep(-0.30, 0.02, h));
          // 地平线附近加一条暖光带
          c += vec3(0.10, 0.07, 0.02) * exp(-abs(h) * 26.0);
          gl_FragColor = vec4(c, 1.0); }`,
    });
    scene.add(new THREE.Mesh(skyGeo, skyMat));

    // 主光（暖色夕阳/朝阳，低角度强化地形起伏）
    const sun = new THREE.DirectionalLight(0xffd9a8, 2.35);
    sun.position.set(-60, 78, -46);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const d = 70;
    sun.shadow.camera.left = -d; sun.shadow.camera.right = d;
    sun.shadow.camera.top = d; sun.shadow.camera.bottom = -d;
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 300;
    sun.shadow.bias = -0.0008;
    scene.add(sun);
    scene.add(sun.target);

    // 补光（冷色天空反射）
    const fill = new THREE.DirectionalLight(0x8fb4d8, 0.55);
    fill.position.set(50, 40, 40);
    scene.add(fill);

    // 半球环境光
    scene.add(new THREE.HemisphereLight(0xbcd0e8, 0x6b5a44, 0.72));

    // 雾（增加纵深与古画氛围）
    scene.fog = new THREE.FogExp2(0x9fa9b4, 0.0034);
  }

  // 让整幅地图恰好落在视野内（按视口宽高比 + 相机俯仰角加权）
  function fitDistance() {
    const w = canvas ? (canvas.clientWidth || canvas.width) : 800;
    const h = canvas ? (canvas.clientHeight || canvas.height) : 600;
    const aspect = w / Math.max(1, h);
    const mapW = (M.lonMax - M.lonMin) * DEG2W * 1.06;
    const mapH = (M.latMax - M.latMin) * DEG2W * 1.06;
    const vFov = (camera ? camera.fov : 46) * Math.PI / 180;
    const tanV = Math.tan(vFov / 2);
    const tanH = tanV * aspect;
    // 正对地图（前后受 mapH 限制）与俯视地图（上下受 mapH 限制）两种基准
    const dFront = Math.max(mapH / 2 / tanV, mapW / 2 / tanH);
    const dTop = Math.max(mapW / 2 / tanV, mapH / 2 / tanH);
    // 相机越俯视越接近 dTop，越平视越接近 dFront（用参考俯仰角，保证 frameMap 结果稳定）
    const k = Math.max(0, Math.min(1, Math.sin(0.95)));
    let d = dTop * k + dFront * (1 - k);
    if (aspect < 1) d *= 1.05;   // 竖屏留一点余地
    return d;
  }
  function minDistance() { return Math.max(4, fitDistance() * 0.07); }
  function maxDistance() { return fitDistance() * 1.6; }
  function mapCenterLon() { return (M.lonMin + M.lonMax) / 2; }
  function mapCenterLat() { return (M.latMin + M.latMax) / 2; }
  /** 把整幅地图收进视野（取景中心 = 地图几何中心，避免偏斜） */
  function frameMap() {
    doResize();
    const a = (canvas.clientWidth || canvas.width) / Math.max(1, canvas.clientHeight || canvas.height);
    cam.phi = a > 1.5 ? 0.86 : a > 1.0 ? 0.95 : 1.08;
    cam.dist = fitDistance();
    cam.targetGoal = null; cam.distGoal = null;
    cam.target.set(worldX(mapCenterLon()), 0, worldZ(mapCenterLat()));
  }

  // ------------------------------------------------------------- 相机控制
  const cam = { target: new THREE.Vector3(0, 0, 0), dist: 62, theta: 0.0, phi: 0.95, targetGoal: null, distGoal: null };
  let dragging = false, dragMoved = false, lastX = 0, lastY = 0;
  let camLockedByUser = false;   // 用户一旦手动操作视角，就不再自动重新取景

  function updateCamera(dt) {
    if (cam.targetGoal) {
      cam.target.lerp(cam.targetGoal, Math.min(1, dt * 6));
      if (cam.target.distanceTo(cam.targetGoal) < 0.05) cam.targetGoal = null;
    }
    if (cam.distGoal != null) {
      cam.dist += (cam.distGoal - cam.dist) * Math.min(1, dt * 6);
      if (Math.abs(cam.dist - cam.distGoal) < 0.1) cam.distGoal = null;
    }
    const cp = Math.cos(cam.phi), sp = Math.sin(cam.phi);
    const x = cam.target.x + cam.dist * cp * Math.sin(cam.theta);
    const z = cam.target.z + cam.dist * cp * Math.cos(cam.theta);
    let y = cam.target.y + cam.dist * sp;
    // 关键：相机绝不能低于该处地形，否则会穿进山体内部（看到被裁切的面片）
    const clon = x / DEG2W + (M.lonMin + M.lonMax) / 2;
    const clat = -z / DEG2W + (M.latMin + M.latMax) / 2;
    const groundY = terrainHeightAt(clon, clat);
    const minY = groundY + 1.8;
    if (y < minY) y = minY;
    // 目标点也不低于地形
    if (cam.target.y < groundY) cam.target.y = groundY;
    camera.position.set(x, y, z);
    camera.lookAt(cam.target);
  }
  function panCamera(dx, dz) {
    // 沿视线水平方向平移
    const fwd = new THREE.Vector3().subVectors(cam.target, camera.position); fwd.y = 0; fwd.normalize();
    const right = new THREE.Vector3(fwd.z, 0, -fwd.x);
    const t = new THREE.Vector3().copy(cam.target).addScaledVector(right, -dx).addScaledVector(fwd, -dz);
    t.x = Math.max(worldX(M.lonMin) - 5, Math.min(worldX(M.lonMax) + 5, t.x));
    t.z = Math.max(worldZ(M.latMax) - 5, Math.min(worldZ(M.latMin) + 5, t.z));
    t.y = 0;
    cam.target.copy(t);
    cam.targetGoal = null;
  }
  function focusOn(lon, lat, dist) {
    const p = lonLatToWorld(lon, lat);
    cam.targetGoal = new THREE.Vector3(p.x, terrainHeightAt(lon, lat) * 0.5, p.z);
    if (dist) cam.distGoal = dist;
    camLockedByUser = true;
  }
  /** 复位视角，重新把整幅地图收进视野 */
  function resetView() { camLockedByUser = false; frameMap(); }

  // ------------------------------------------------------------- 交互
  function bindInput() {
    const el = renderer.domElement;
    el.addEventListener('pointerdown', (e) => {
      if (e.button === 0) { dragging = true; dragMoved = false; lastX = e.clientX; lastY = e.clientY; camLockedByUser = true; el.setPointerCapture(e.pointerId); }
    });
    el.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      if (Math.abs(dx) + Math.abs(dy) > 2) dragMoved = true;
      if (e.buttons & 4 || e.shiftKey) {
        // 中键/Shift：旋转
        cam.theta -= dx * 0.006;
        cam.phi = Math.max(0.12, Math.min(1.45, cam.phi - dy * 0.005));
      } else {
        const k = cam.dist * 0.0016;
        panCamera(dx * k, dy * k);
      }
    });
    el.addEventListener('pointerup', (e) => {
      dragging = false;
      if (!dragMoved && e.button === 0) pick(e.clientX, e.clientY);
    });
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      cam.distGoal = null;
      camLockedByUser = true;
      const lo = minDistance(), hi = maxDistance();
      cam.dist = Math.max(lo, Math.min(hi, cam.dist * (1 + Math.sign(e.deltaY) * 0.11)));
    }, { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => {
      if (!window.__sanguoHotkeys) return;
      window.__sanguoHotkeys(e);
    });
  }

  function pick(clientX, clientY) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    // 先拾取部队，再拾取城池
    const armyGroups = [...armyObjects.values()].map((o) => o.group);
    let hits = raycaster.intersectObjects(armyGroups, true);
    if (hits.length) { const id = hits[0].object.userData.pickArmy; if (id && onPick) return onPick({ type: 'army', id }); }
    const cityGroups = [...cityObjects.values()].map((o) => o.group);
    hits = raycaster.intersectObjects(cityGroups, true);
    if (hits.length) { const id = hits[0].object.userData.pickCity; if (id && onPick) return onPick({ type: 'city', id }); }
    // 地形
    hits = raycaster.intersectObject(terrainMesh, false);
    if (hits.length) {
      const p = hits[0].point;
      const lon = M.lonMin + ((p.x / DEG2W) + (M.lonMin + M.lonMax) / 2 - M.lonMin) / 1 * 0;
      const lonW = (p.x / DEG2W) + (M.lonMin + M.lonMax) / 2;
      const latW = -(p.z / DEG2W) + (M.latMin + M.latMax) / 2;
      if (onPick) onPick({ type: 'ground', lon: lonW, lat: latW });
      return;
    }
    if (onPick) onPick({ type: 'none' });
  }

  // ------------------------------------------------------------- 主循环
  let running = false;
  function animate() {
    if (!running) return;
    requestAnimationFrame(animate);
    const dt = Math.min(0.05, clock.getDelta());
    const t = clock.elapsedTime;
    updateCamera(dt);
    // 城池按相机距离自适应缩放：远景收成图标，近景显出城郭细节
    const cs = Math.max(0.42, Math.min(1.25, 8.5 / Math.max(4, cam.dist)));
    for (const [, o] of cityObjects) {
      const g = o.group;
      g.scale.x += (cs - g.scale.x) * Math.min(1, dt * 3.2);
      g.scale.y = g.scale.x; g.scale.z = g.scale.x;
      const f = g.getObjectByName('flag');
      if (f) f.rotation.y = Math.sin(t * 1.6 + g.position.x) * 0.28;
    }
    // 部队平滑移动
    for (const [, o] of armyObjects) {
      if (o.tx != null && o.x != null) {
        o.x += (o.tx - o.x) * Math.min(1, dt * 3.2);
        o.z += (o.tz - o.z) * Math.min(1, dt * 3.2);
        const lon = o.x / DEG2W + (M.lonMin + M.lonMax) / 2;
        const lat = -o.z / DEG2W + (M.latMin + M.latMax) / 2;
        o.group.position.set(o.x, terrainHeightAt(lon, lat), o.z);
        o.group.children.forEach((ch, i) => { if (ch.geometry && ch.geometry.type === 'PlaneGeometry') ch.rotation.y = Math.sin(t * 2.2 + i) * 0.25; });
      }
    }
    renderer.render(scene, camera);
  }

  // ------------------------------------------------------------- API
  function doResize() {
    if (!canvas || !renderer || !camera) return;
    const w = canvas.clientWidth || canvas.width, h = canvas.clientHeight || canvas.height;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  async function init(canvasEl, opts) {
    canvas = canvasEl;
    M = window.SANGUO_MAP;
    clock = new THREE.Clock();
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    const cw0 = canvas.clientWidth || canvas.width || 960;
    const ch0 = canvas.clientHeight || canvas.height || 600;
    renderer.setSize(cw0, ch0, false);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.02;

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(46, cw0 / Math.max(1, ch0), 0.5, 900);

    buildEnvironment();
    await loadHeightGrid(M.gridPNG);
    const tex = await loadTexture(M.texPNG);
    buildTerrain(tex);
    buildSea();
    rebuildCities();
    rebuildRoads();
    rebuildBorders();
    rebuildArmies();
    frameMap();
    bindInput();
    running = true;
    animate();
    window.addEventListener('resize', doResize);
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(doResize);
      ro.observe(canvas);
    }
    setTimeout(doResize, 60);
    setTimeout(() => { if (!camLockedByUser) frameMap(); }, 130);
    return true;
  }

  window.MapView = {
    init, focusOn, rebuildCities, rebuildArmies, rebuildRoads, rebuildBorders,
    updateCityOwners, terrainHeightAt, lonLatToWorld, worldX, worldZ,
    fitDistance, minDistance, maxDistance, frameMap, resetView,
    get camera() { return camera; }, get scene() { return scene; },
    set onPick(fn) { onPick = fn; },
    get cam() { return cam; },
    DEG2W, HSCALE, EXAG,
  };
})();
