// ---------------------------------------------------------------------------
// 三国地图烘焙器 —— 最终版 v3
//  DEM: AWS Terrain Tiles (Terrarium) z6, 99 瓦片
//  水系: Natural Earth 10m rivers / lakes / ocean
//  输出: js/mapdata.js  —— 高程网格(网格) + 高精度高程(战斗切片) + 绢本着色晕渲贴图
// ---------------------------------------------------------------------------
const https = require('https');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const { readSHP, readDBF } = require('./shp.js');

const DATA = path.join(__dirname, '..', '..', 'sanguo-warchess-build', 'ne');
const WORK = path.join(__dirname, '..', '..', 'sanguo-warchess-build', 'dem_cache');
const OUTJS = path.join(__dirname, '..', 'js', 'mapdata.js');

// ---- 范围（与瓦片边界严格对齐）----
const TZ = 6, NT = 2 ** TZ;
const x2lon = (x) => (x / NT) * 360 - 180;
const y2lat = (y) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / NT))) * 180) / Math.PI;
const TX0 = 45, TX1 = 55, TY0 = 20, TY1 = 28;
const LON_MIN = x2lon(TX0), LON_MAX = x2lon(TX1 + 1);
const LAT_MAX = y2lat(TY0), LAT_MIN = y2lat(TY1 + 1);
const DEM_W = (TX1 - TX0 + 1) * 256;   // 2816
const DEM_H = (TY1 - TY0 + 1) * 256;   // 2304
const GRID_W = 560, GRID_H = 400;      // 战略网格（约 5.6km/格，兼顾地形平滑与体积）
const BAT_W = 1024, BAT_H = 832;       // 战斗切片高程
const TEX_W = 1120, TEX_H = 800;       // 贴图（缩自 DEM 晕渲）

const H_MAX = 8850;
const HP = 0.78;   // 高程压缩指数：低地保留细节，高山压缩，避免青藏高原吞掉整幅画面
const h2b = (h) => Math.max(0, Math.min(255, Math.round(255 * Math.pow(Math.max(0, h) / H_MAX, HP))));
const b2h = (b) => H_MAX * Math.pow(b / 255, 1 / HP);
// 配色统一用压缩后的"视觉海拔"，使地图颜色与立体高度完全一致
const vAlt = (h) => H_MAX * Math.pow(Math.max(0, h) / H_MAX, HP);

// ---- PNG 编解码 ----
const CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
const crc32 = (b) => { let c = -1; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function chunk(type, data) {
  const l = Buffer.alloc(4); l.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii'); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([l, t, data, c]);
}
function encodePNG(w, h, ch, get) {
  const stride = w * ch, raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) { const o = y * (stride + 1); for (let x = 0; x < w; x++) { const v = get(x, y); for (let c = 0; c < ch; c++) raw[o + 1 + x * ch + c] = v[c] & 255; } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = ch === 3 ? 2 : ch === 4 ? 6 : 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
function decodePNG(buf) {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  let pos = 8, w = 0, h = 0, bd = 0, ct = 0; const idat = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.toString('ascii', pos + 4, pos + 8), d = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); bd = d[8]; ct = d[9]; if (d[12] !== 0) return null; }
    else if (type === 'IDAT') idat.push(d); else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (bd !== 8) return null;
  const ch = ct === 2 ? 3 : ct === 6 ? 4 : ct === 0 ? 1 : 0; if (!ch) return null;
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * ch, out = Buffer.alloc(stride * h);
  let rp = 0;
  for (let y = 0; y < h; y++) {
    const ft = raw[rp++], line = raw.subarray(rp, rp + stride); rp += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride), prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0, b = prev[x], c = x >= ch ? prev[x - ch] : 0;
      let v = line[x];
      if (ft === 1) v += a; else if (ft === 2) v += b; else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[x] = v & 255;
    }
  }
  return { w, h, ch, data: out };
}

// ---- 绢本着色（参考项目 alt-color-stop，针对中国地形调整低海拔色阶）----
const HYPSO = [
  [-9000, [11, 36, 54]], [-2000, [18, 58, 80]], [-500, [28, 90, 110]], [-60, [54, 124, 130]],
  [0, [70, 130, 126]],
  [3, [66, 146, 78]], [80, [86, 158, 76]], [250, [122, 172, 80]], [500, [156, 178, 88]],
  [900, [196, 180, 96]], [1500, [210, 178, 104]], [2300, [202, 158, 92]],
  [3200, [166, 126, 76]], [4200, [142, 116, 90]], [5200, [160, 152, 144]],
  [6200, [238, 236, 228]], [8850, [255, 255, 255]],
];
function hypso(h) {
  if (h <= HYPSO[0][0]) return HYPSO[0][1];
  for (let i = 0; i < HYPSO.length - 1; i++) {
    const [h0, c0] = HYPSO[i], [h1, c1] = HYPSO[i + 1];
    if (h >= h0 && h <= h1) { const t = (h - h0) / (h1 - h0); return [c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t]; }
  }
  return [255, 255, 255];
}

function get(url, d = 0) {
  return new Promise((resolve) => {
    if (d > 5) return resolve(null);
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { res.resume(); return resolve(get(new URL(res.headers.location, url).href, d + 1)); }
      if (res.statusCode !== 200) { res.resume(); return resolve(null); }
      const c = []; res.on('data', (x) => c.push(x)); res.on('end', () => resolve(Buffer.concat(c)));
    });
    req.on('error', () => resolve(null));
    req.setTimeout(40000, () => { req.destroy(); resolve(null); });
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function loadDEM() {
  fs.mkdirSync(WORK, { recursive: true });
  const H = new Float32Array(DEM_W * DEM_H);
  const jobs = [];
  for (let x = TX0; x <= TX1; x++) for (let y = TY0; y <= TY1; y++) jobs.push([x, y]);
  let cursor = 0, ok = 0, cached = 0, bad = [];
  async function worker() {
    while (cursor < jobs.length) {
      const [x, y] = jobs[cursor++];
      const f = path.join(WORK, `t_${x}_${y}.png`);
      let buf = null;
      if (fs.existsSync(f)) { buf = fs.readFileSync(f); cached++; }
      else {
        for (let a = 0; a < 4 && !buf; a++) { buf = await get(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${TZ}/${x}/${y}.png`); if (!buf) await sleep(400 * (a + 1)); }
        if (buf) fs.writeFileSync(f, buf);
      }
      if (!buf) { bad.push(`${x}/${y}`); continue; }
      const png = decodePNG(buf); if (!png) { bad.push(`${x}/${y}d`); continue; }
      const px0 = (x - TX0) * 256, py0 = (y - TY0) * 256;
      for (let ty = 0; ty < 256; ty++) for (let tx = 0; tx < 256; tx++) {
        const o = (ty * 256 + tx) * png.ch;
        H[(py0 + ty) * DEM_W + px0 + tx] = png.data[o] * 256 + png.data[o + 1] + png.data[o + 2] / 256 - 32768;
      }
      ok++;
      if ((ok + bad.length) % 25 === 0) console.log(`[dem] ${ok + bad.length}/${jobs.length}`);
    }
  }
  await Promise.all(Array.from({ length: 12 }, worker));
  console.log(`[dem] ok=${ok} (cached ${cached}) bad=${bad.length} ${bad.join(' ')}`);
  return H;
}

// ---- 水系 ----
const lon2col = (lon) => ((lon - LON_MIN) / (LON_MAX - LON_MIN)) * DEM_W;
const lat2row = (lat) => ((LAT_MAX - lat) / (LAT_MAX - LAT_MIN)) * DEM_H;
function inBBox(rings) {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const r of rings) for (const p of r) { if (p[0] < a) a = p[0]; if (p[1] < b) b = p[1]; if (p[0] > c) c = p[0]; if (p[1] > d) d = p[1]; }
  return a < LON_MAX && c > LON_MIN && b < LAT_MAX && d > LAT_MIN;
}
function fillRings(mask, rings, val, W, H) {
  for (const ring of rings) {
    let minR = Infinity, maxR = -Infinity;
    for (const p of ring) { const r = lat2row(p[1]); if (r < minR) minR = r; if (r > maxR) maxR = r; }
    const r0 = Math.max(0, Math.floor(minR)), r1 = Math.min(H - 1, Math.ceil(maxR));
    for (let row = r0; row <= r1; row++) {
      const yc = row + 0.5, xs = [];
      for (let i = 0; i < ring.length - 1; i++) {
        const ra = lat2row(ring[i][1]), rb = lat2row(ring[i + 1][1]);
        if ((ra <= yc && rb > yc) || (rb <= yc && ra > yc)) { const t = (yc - ra) / (rb - ra); xs.push(lon2col(ring[i][0] + t * (ring[i + 1][0] - ring[i][0]))); }
      }
      if (xs.length < 2) continue;
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const s = Math.max(0, Math.round(xs[k])), e = Math.min(W - 1, Math.round(xs[k + 1]));
        for (let x = s; x <= e; x++) mask[row * W + x] = val;
      }
    }
  }
}
function strokePath(mask, pts, hw, val, W, H) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps, cx = x0 + (x1 - x0) * t, cy = y0 + (y1 - y0) * t;
      const ri = Math.ceil(hw), xi = Math.round(cx), yi = Math.round(cy);
      for (let dy = -ri; dy <= ri; dy++) for (let dx = -ri; dx <= ri; dx++) {
        if (dx * dx + dy * dy > hw * hw) continue;
        const px = xi + dx, py = yi + dy;
        if (px < 0 || py < 0 || px >= W || py >= H) continue;
        const idx = py * W + px; if (val > mask[idx]) mask[idx] = val;
      }
    }
  }
}
// 提取线段（兼容 LineString 与 MultiLineString）
function lineRings(rec) {
  return rec.rings && rec.rings.length && Array.isArray(rec.rings[0][0]) ? rec.rings : (rec.rings ? [rec.rings] : []);
}

(async () => {
  const t0 = Date.now();
  console.log(`[bounds] lon ${LON_MIN.toFixed(3)}..${LON_MAX.toFixed(3)} (${(LON_MAX - LON_MIN).toFixed(3)})`);
  console.log(`[bounds] lat ${LAT_MIN.toFixed(3)}..${LAT_MAX.toFixed(3)} (${(LAT_MAX - LAT_MIN).toFixed(3)})`);
  console.log(`[dims] DEM ${DEM_W}x${DEM_H}  grid ${GRID_W}x${GRID_H}  battle ${BAT_W}x${BAT_H}  tex ${TEX_W}x${TEX_H}`);

  const H = await loadDEM();

  // 海: DEM 高程 <=0 即为海（比 NE 海岸线精细）
  const water = new Uint8Array(DEM_W * DEM_H);
  for (let i = 0; i < H.length; i++) if (H[i] <= 0) water[i] = 1;
  console.log('[water] 海(由DEM) =', (water.reduce((s, v) => s + (v === 1 ? 1 : 0), 0) / 1000).toFixed(0) + 'k px');

  const lakeInfo = [];
  try {
    const l = readSHP(path.join(DATA, '_ne_lakes', 'ne_10m_lakes.shp')), db = readDBF(path.join(DATA, '_ne_lakes', 'ne_10m_lakes.dbf'));
    const recs = l.records.map((r, i) => ({ r, a: db.rows[i] || {} })).filter((x) => inBBox(x.r.rings)).sort((a, b) => (a.a.scalerank || 9) - (b.a.scalerank || 9));
    for (const { r, a } of recs) { fillRings(water, r.rings, 2, DEM_W, DEM_H); lakeInfo.push(`${a.name || '?'}${a.scalerank || ''}`); }
    console.log(`[lakes] ${recs.length}`);
    console.log('[lakes]', lakeInfo.slice(0, 30).join(' '));
  } catch (e) { console.log('[lakes] ERR ' + e.message); }

  let nRiver = 0; const riverNames = [];
  try {
    const rv = readSHP(path.join(DATA, '_ne_rivers', 'ne_10m_rivers_lake_centerlines.shp')), db = readDBF(path.join(DATA, '_ne_rivers', 'ne_10m_rivers_lake_centerlines.dbf'));
    const recs = rv.records.map((r, i) => ({ r, a: db.rows[i] || {} })).filter((x) => inBBox(x.r.rings)).sort((a, b) => (a.a.scalerank || 9) - (b.a.scalerank || 9));
    const PAD = 1.15;
    for (const { r, a } of recs) {
      const rank = a.scalerank == null ? 6 : a.scalerank;
      const w = Math.max(1.4, 7.0 - rank * 0.95);
      const hw = (w * PAD) / 2;
      for (const ring of lineRings(r)) {
        const pts = [];
        for (const p of ring) {
          const rr = lat2row(p[1]), cc = lon2col(p[0]);
          if (rr < -20 || rr > DEM_H + 20 || cc < -20 || cc > DEM_W + 20) { pts.push(null); continue; }
          pts.push([cc, rr, rr >= 0 && rr < DEM_H && cc >= 0 && cc < DEM_W && water[Math.round(rr) * DEM_W + Math.round(cc)] === 1]);
        }
        // 按 null / 海 分段
        let seg = [];
        for (const pt of pts) {
          if (pt === null || pt[2]) { if (seg.length > 1) strokePath(water, seg, hw, 3, DEM_W, DEM_H); seg = []; }
          else seg.push([pt[0], pt[1]]);
        }
        if (seg.length > 1) strokePath(water, seg, hw, 3, DEM_W, DEM_H);
      }
      nRiver++;
      if (a.name && !riverNames.includes(a.name)) riverNames.push(a.name);
    }
    console.log(`[rivers] ${nRiver} 条`);
    console.log('[rivers]', riverNames.slice(0, 40).join(' '));
  } catch (e) { console.log('[rivers] ERR ' + e.message); }

  // 河谷下切 + 湖面压平
  const E = Float32Array.from(H);
  for (let r = 1; r < DEM_H - 1; r++) for (let c = 1; c < DEM_W - 1; c++) {
    const i = r * DEM_W + c;
    if (water[i] !== 3) continue;
    let s = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += H[i + dy * DEM_W + dx];
    E[i] = Math.min(E[i], s / 9 - 18);
  }
  for (let i = 0; i < E.length; i++) {
    if (water[i] === 2) E[i] = Math.min(E[i], 2);
    else if (water[i] === 1 && E[i] > 0) E[i] = -Math.min(E[i], 80);
  }

  // ---- 晕渲着色的 DEM（原生分辨率）----
  const SOL_AZ = (315 * Math.PI) / 180, SOL_ALT = (40 * Math.PI) / 180;
  const lx = Math.cos(SOL_ALT) * Math.cos(SOL_AZ), ly = Math.cos(SOL_ALT) * Math.sin(SOL_AZ), lz = Math.sin(SOL_ALT);
  const CELL_M = ((LON_MAX - LON_MIN) / DEM_W) * 111000 * Math.cos((36 * Math.PI) / 180);
  console.log(`[shade] ${CELL_M.toFixed(0)} m/px`);

  const rgb = new Uint8ClampedArray(DEM_W * DEM_H * 3);
  for (let r = 0; r < DEM_H; r++) {
    for (let c = 0; c < DEM_W; c++) {
      const i = r * DEM_W + c, o = i * 3, h = E[i];
      let col;
      if (water[i] === 1) {
        const depth = Math.max(0, -h), t = Math.min(1, depth / 1800);
        col = [Math.round(104 - t * 82), Math.round(158 - t * 116), Math.round(172 - t * 106)];
        const shallow = Math.max(0, 1 - depth / 110);
        col = [col[0] + shallow * 40, col[1] + shallow * 32, col[2] + shallow * 22];
      } else if (water[i] === 3) col = [52, 120, 142];
      else if (water[i] === 2) col = [58, 130, 148];
      else {
        col = hypso(vAlt(h));
        const va = vAlt(h);
        if (va > 4700) { const t = Math.min(1, (va - 4700) / 1400); col = [col[0] + (255 - col[0]) * t, col[1] + (255 - col[1]) * t, col[2] + (255 - col[2]) * t]; }
      }
      const hL = E[i - (c > 0 ? 1 : 0)], hR = E[i + (c < DEM_W - 1 ? 1 : 0)];
      const hU = E[i - (r > 0 ? DEM_W : 0)], hD = E[i + (r < DEM_H - 1 ? DEM_W : 0)];
      const dzdx = (hR - hL) / (2 * CELL_M), dzdy = (hD - hU) / (2 * CELL_M);
      const len = Math.sqrt(dzdx * dzdx + dzdy * dzdy + 1);
      const shade = Math.max(0, (-dzdx / len) * lx + (-dzdy / len) * ly + (1 / len) * lz);
      const slope = Math.min(1, Math.sqrt(dzdx * dzdx + dzdy * dzdy));
      let f = water[i] ? 0.84 + 0.22 * shade : 0.60 + 0.56 * shade;
      f *= 1 - slope * 0.15;
      rgb[o] = col[0] * f; rgb[o + 1] = col[1] * f; rgb[o + 2] = col[2] * f;
    }
  }
  // 贴图降采样
  const sx = DEM_W / TEX_W, sy = DEM_H / TEX_H;
  const texRGB = new Uint8ClampedArray(TEX_W * TEX_H * 3);
  for (let y = 0; y < TEX_H; y++) for (let x = 0; x < TEX_W; x++) {
    let r0 = 0, g0 = 0, b0 = 0, n = 0;
    const y0 = Math.floor(y * sy), y1 = Math.min(DEM_H, Math.ceil((y + 1) * sy));
    const x0 = Math.floor(x * sx), x1 = Math.min(DEM_W, Math.ceil((x + 1) * sx));
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { const o = (yy * DEM_W + xx) * 3; r0 += rgb[o]; g0 += rgb[o + 1]; b0 += rgb[o + 2]; n++; }
    const o2 = (y * TEX_W + x) * 3;
    texRGB[o2] = r0 / n; texRGB[o2 + 1] = g0 / n; texRGB[o2 + 2] = b0 / n;
  }

  // ---- 高程网格（3x3 均值降采样，抑制 DEM 高频锯齿）----
  const gridH = new Float32Array(GRID_W * GRID_H);
  const gw = DEM_W / GRID_W, gh = DEM_H / GRID_H;
  for (let r = 0; r < GRID_H; r++) for (let c = 0; c < GRID_W; c++) {
    let s = 0, n = 0;
    const y0 = Math.floor(r * gh), y1 = Math.min(DEM_H, Math.ceil((r + 1) * gh));
    const x0 = Math.floor(c * gw), x1 = Math.min(DEM_W, Math.ceil((c + 1) * gw));
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { s += E[yy * DEM_W + xx]; n++; }
    gridH[r * GRID_W + c] = s / n;
  }
  // 轻度高斯平滑（3x3 加权），只削尖刺不改大势
  const smooth = new Float32Array(gridH.length);
  const KW = [0.0625, 0.125, 0.0625, 0.125, 0.25, 0.125, 0.0625, 0.125, 0.0625];
  for (let r = 0; r < GRID_H; r++) for (let c = 0; c < GRID_W; c++) {
    let s = 0, w = 0, k = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++, k++) {
      const yy = r + dy, xx = c + dx;
      if (yy < 0 || xx < 0 || yy >= GRID_H || xx >= GRID_W) continue;
      s += gridH[yy * GRID_W + xx] * KW[k]; w += KW[k];
    }
    smooth[r * GRID_W + c] = s / w;
  }
  gridH.set(smooth);
  // ---- 战斗切片高程（2x2 均值）----
  const batH = new Float32Array(BAT_W * BAT_H);
  const bw = DEM_W / BAT_W, bh = DEM_H / BAT_H;
  for (let r = 0; r < BAT_H; r++) for (let c = 0; c < BAT_W; c++) {
    let s = 0, n = 0;
    const y0 = Math.floor(r * bh), y1 = Math.min(DEM_H, Math.ceil((r + 1) * bh));
    const x0 = Math.floor(c * bw), x1 = Math.min(DEM_W, Math.ceil((c + 1) * bw));
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { s += E[yy * DEM_W + xx]; n++; }
    batH[r * BAT_W + c] = s / n;
  }
  // 战斗切片同样做一次轻度平滑，避免战场出现刀削崖
  const batS = new Float32Array(batH.length);
  for (let r = 0; r < BAT_H; r++) for (let c = 0; c < BAT_W; c++) {
    let s = 0, w = 0, k = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++, k++) {
      const yy = r + dy, xx = c + dx;
      if (yy < 0 || xx < 0 || yy >= BAT_H || xx >= BAT_W) continue;
      s += batH[yy * BAT_W + xx] * KW[k]; w += KW[k];
    }
    batS[r * BAT_W + c] = s / w;
  }
  batH.set(batS);

  // ---- 输出 ----
  const pngH = encodePNG(GRID_W, GRID_H, 1, (x, y) => [h2b(gridH[y * GRID_W + x])]);
  const pngB = encodePNG(BAT_W, BAT_H, 1, (x, y) => [h2b(batH[y * BAT_W + x])]);
  const pngT = encodePNG(TEX_W, TEX_H, 3, (x, y) => { const o = (y * TEX_W + x) * 3; return [texRGB[o], texRGB[o + 1], texRGB[o + 2]]; });
  console.log(`[png] grid=${(pngH.length / 1024).toFixed(0)}KB battle=${(pngB.length / 1024).toFixed(0)}KB tex=${(pngT.length / 1024).toFixed(0)}KB`);

  const js = `// 自动生成 —— 真实中国地形：AWS Terrain Tiles (Terrarium DEM, z6 ${TX0}..${TX1}/${TY0}..${TY1})
// 水系：Natural Earth 10m rivers/lakes/ocean + DEM 海陆判定
// 网格 ${GRID_W}x${GRID_H}（战略） / ${BAT_W}x${BAT_H}（战斗切片） / 贴图 ${TEX_W}x${TEX_H}
window.SANGUO_MAP = {
  lonMin:${LON_MIN},lonMax:${LON_MAX},latMin:${LAT_MIN},latMax:${LAT_MAX},
  gridW:${GRID_W},gridH:${GRID_H},batW:${BAT_W},batH:${BAT_H},texW:${TEX_W},texH:${TEX_H},
  hMax:${H_MAX},hExp:${HP},
  gridPNG:"data:image/png;base64,${pngH.toString('base64')}",
  batPNG:"data:image/png;base64,${pngB.toString('base64')}",
  texPNG:"data:image/png;base64,${pngT.toString('base64')}"
};
`;
  fs.writeFileSync(OUTJS, js);
  console.log(`[out] ${(js.length / 1024 / 1024).toFixed(2)} MB -> ${OUTJS}`);

  const probe = (lon, lat, label) => {
    const c = Math.round(lon2col(lon)), r = Math.round(lat2row(lat));
    if (c < 0 || r < 0 || c >= DEM_W || r >= DEM_H) return `${label}=界外`;
    const i = r * DEM_W + c;
    return `${label} ${H[i].toFixed(0)}m/${'海湖河陆'[[1, 2, 3].includes(water[i]) ? water[i] - 1 : 3]}`;
  };
  console.log('[probe]', [probe(86.9, 27.99, '珠峰'), probe(91.1, 29.65, '拉萨'), probe(104.07, 30.66, '成都'),
    probe(121.47, 31.23, '上海'), probe(116.4, 39.9, '北京'), probe(113.26, 23.13, '广州'),
    probe(112.45, 34.62, '洛阳'), probe(108.94, 34.27, '长安'), probe(94.66, 40.14, '敦煌'),
    probe(123.18, 41.27, '襄平'), probe(121.0, 23.5, '台湾'), probe(114.3, 30.6, '武汉'),
    probe(117.2, 31.86, '合肥'), probe(112.13, 32.02, '襄阳'), probe(107.03, 33.07, '汉中')].join(' | '));
  console.log(`[time] ${((Date.now() - t0) / 1000).toFixed(1)}s`);
})();
