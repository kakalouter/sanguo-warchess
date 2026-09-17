const https = require('https');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const DATA = path.join(__dirname, '..', '..', 'sanguo-warchess-build', 'ne');
const WORK = path.join(__dirname, '..', '..', 'sanguo-warchess-build', 'dem_cache');
fs.mkdirSync(WORK, { recursive: true });

function get(url, d = 0) {
  return new Promise((resolve) => {
    if (d > 5) return resolve(null);
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { res.resume(); return resolve(get(new URL(res.headers.location, url).href, d + 1)); }
      if (res.statusCode !== 200) { res.resume(); return resolve(null); }
      const c = []; res.on('data', (x) => c.push(x));
      res.on('end', () => resolve(Buffer.concat(c)));
    });
    req.on('error', () => resolve(null));
    req.setTimeout(60000, () => { req.destroy(); resolve(null); });
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // ocean shp
  if (!fs.existsSync(path.join(DATA, '_ne_ocean', 'ne_10m_ocean.shp'))) {
    for (let a = 0; a < 8; a++) {
      const buf = await get('https://naturalearth.s3.amazonaws.com/10m_physical/ne_10m_ocean.zip');
      if (buf && buf.length > 5000) {
        fs.writeFileSync(path.join(DATA, 'ocean.zip'), buf);
        const out = path.join(DATA, '_ne_ocean');
        fs.mkdirSync(out, { recursive: true });
        execFileSync('powershell.exe', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${path.join(DATA, 'ocean.zip')}' -DestinationPath '${out}' -Force`], { stdio: 'ignore' });
        console.log('[ocean] ok', fs.readdirSync(out).join(','));
        break;
      }
      console.log('[ocean] attempt', a + 1, 'failed');
      await sleep(1200 * (a + 1));
    }
  } else console.log('[ocean] already present');

  // DEM tiles z6 48..52 / 22..28
  const jobs = [];
  for (let x = 48; x <= 52; x++) for (let y = 22; y <= 28; y++) jobs.push([x, y]);
  let cursor = 0, ok = 0, bad = [], skipped = 0;
  async function worker() {
    while (cursor < jobs.length) {
      const [x, y] = jobs[cursor++];
      const f = path.join(WORK, `t_${x}_${y}.png`);
      if (fs.existsSync(f) && fs.statSync(f).size > 2000) { skipped++; continue; }
      for (let a = 0; a < 4; a++) {
        const buf = await get(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/6/${x}/${y}.png`);
        if (buf && buf.length > 2000) { fs.writeFileSync(f, buf); ok++; break; }
        await sleep(400 * (a + 1));
      }
      if (!fs.existsSync(f)) bad.push(`${x}/${y}`);
    }
  }
  await Promise.all(Array.from({ length: 10 }, worker));
  console.log(`[dem] downloaded=${ok} cached=${skipped} failed=${bad.length} ${bad.join(' ')}`);
  const all = jobs.filter(([x, y]) => fs.existsSync(path.join(WORK, `t_${x}_${y}.png`))).length;
  console.log(`[dem] present ${all}/${jobs.length}`);
})();
