// Minimal ESRI Shapefile reader (polyline + polygon) -> GeoJSON-ish coordinates, plus DBF attribute reader.
const fs = require('fs');

function readSHP(file) {
  const buf = fs.readFileSync(file);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const shapeType = view.getInt32(32, true);
  const bbox = [view.getFloat64(36, true), view.getFloat64(44, true), view.getFloat64(52, true), view.getFloat64(60, true)];
  const records = [];
  let off = 100;
  while (off + 8 <= buf.length) {
    const lenWords = view.getInt32(off + 4, false);
    const contentStart = off + 8;
    const contentLen = lenWords * 2;
    if (contentLen <= 0 || contentStart + contentLen > buf.length) break;
    const st = view.getInt32(contentStart, true);
    let p = contentStart + 4;
    if (st === 0) { /* null */ }
    else if (st === 1 || st === 11 || st === 21) { // point / pointZ / pointM
      records.push({ type: 'Point', coords: [view.getFloat64(p, true), view.getFloat64(p + 8, true)] });
    } else if (st === 3 || st === 13 || st === 23 || st === 5 || st === 15 || st === 25) {
      const numParts = view.getInt32(p + 32, true);
      const numPoints = view.getInt32(p + 36, true);
      let q = p + 40;
      const parts = [];
      for (let i = 0; i < numParts; i++) { parts.push(view.getInt32(q, true)); q += 4; }
      const pts = [];
      for (let i = 0; i < numPoints; i++) { pts.push([view.getFloat64(q, true), view.getFloat64(q + 8, true)]); q += 16; }
      // Z/M arrays follow; we ignore them
      const rings = [];
      for (let i = 0; i < numParts; i++) {
        const s = parts[i];
        const e = i + 1 < numParts ? parts[i + 1] : numPoints;
        rings.push(pts.slice(s, e));
      }
      records.push({ type: st === 5 || st === 15 || st === 25 ? 'Polygon' : 'LineString', rings, coords: rings.length === 1 ? rings[0] : rings });
    }
    off = contentStart + contentLen;
  }
  return { shapeType, bbox, records };
}

function readDBF(file) {
  if (!fs.existsSync(file)) return { fields: [], rows: [] };
  const buf = fs.readFileSync(file);
  const nRec = buf.readUInt32LE(4);
  const hdrLen = buf.readUInt16LE(8);
  const recLen = buf.readUInt16LE(10);
  const fields = [];
  let p = 32;
  while (p < hdrLen - 1 && buf[p] !== 0x0d) {
    const name = buf.toString('latin1', p, p + 11).replace(/\0.*$/, '').trim();
    const type = String.fromCharCode(buf[p + 11]);
    const len = buf[p + 16];
    const dec = buf[p + 17];
    fields.push({ name, type, len, dec });
    p += 32;
  }
  const rows = [];
  for (let i = 0; i < nRec; i++) {
    const base = hdrLen + i * recLen;
    if (base + recLen > buf.length) break;
    if (buf[base] === 0x2a) { rows.push(null); continue; }
    const row = {};
    let q = base + 1;
    for (const f of fields) {
      const raw = buf.toString('utf8', q, q + f.len).trim();
      row[f.name] = f.type === 'N' ? (raw === '' ? null : Number(raw)) : raw;
      q += f.len;
    }
    rows.push(row);
  }
  return { fields: fields.map((f) => f.name), rows };
}

module.exports = { readSHP, readDBF };
