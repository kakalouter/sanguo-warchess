// ===========================================================================
// 武将头像加载 —— 优先本地真实素材库，缺失时回退到程序化生成
// ===========================================================================
(function () {
  'use strict';
  const cache = new Map();
  const pending = new Map();

  // 以根目录（pathname 以 / 结尾即为目录基准）解析绝对 URL。
  // 这样无论页面在 / 还是 /_test/ 下，都指向同一份 assets/portraits/。
  let BASE = null;
  function baseURL() {
    if (BASE != null) return BASE;
    const idx = window.PORTRAIT_INDEX;
    const rel = (idx && idx.base) || 'assets/portraits/';
    try {
      let dir = location.pathname;
      if (!dir.endsWith('/')) dir = dir.slice(0, dir.lastIndexOf('/') + 1);
      BASE = new URL(rel, location.protocol + '//' + location.host + dir).href;
    } catch (e) {
      BASE = rel;
    }
    return BASE;
  }

  // 异体字 / 繁简归一，提高素材命中率（如 麴义 / 麯义）
  function variants(name) {
    const out = [name];
    const map = { '麴': '麯', '麯': '麴', '魏': '魏', '隽': '雋', '嶲': '巂', '祢': '禰', '荀': '荀' };
    for (let i = 0; i < name.length; i++) {
      const c = name[i];
      if (map[c]) { out.push(name.slice(0, i) + map[c] + name.slice(i + 1)); }
    }
    // 已知别名
    const alias = { '麴义': '麯义', '戏志才': '戏志才', '李傕': '李傕', '郭汜': '郭氾', '朱儁': '朱隽' };
    if (alias[name]) out.push(alias[name]);
    return out;
  }

  function src(name) {
    const idx = window.PORTRAIT_INDEX;
    if (!idx || !idx.chars) return null;
    for (const v of variants(name)) {
      const f = idx.chars[v];
      if (f) return baseURL() + f;
    }
    return null;
  }
  function load(url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }
  /** 返回 Promise<HTMLImageElement|null>；null 表示需回退到程序化头像 */
  function get(name) {
    if (cache.has(name)) return Promise.resolve(cache.get(name));
    if (pending.has(name)) return pending.get(name);
    const url = src(name);
    if (!url) { cache.set(name, null); return Promise.resolve(null); }
    const p = load(url).then((img) => { cache.set(name, img); pending.delete(name); return img; });
    pending.set(name, p);
    return p;
  }

  /**
   * 把武将头像画到某个 canvas 上（自动回退到程序化生成）
   */
  function paint(canvas, general, opt) {
    opt = opt || {};
    const size = opt.size || canvas.width;
    const ctx = canvas.getContext('2d');
    const faction = opt.faction || (window.SANGUO_FACTIONS && general && general.faction ? window.SANGUO_FACTIONS[general.faction] : null);
    const fopt = faction ? { hue: faction.hue, color: faction.color, dark: faction.dark } : null;
    const drawFallback = () => {
      if (window.PortraitGen && general) {
        window.PortraitGen.drawPortrait(ctx, {
          name: general.name, war: general.war, intel: general.intel, lead: general.lead,
          pol: general.pol, charm: general.charm, age: general.age,
        }, { size, faction: fopt, isLord: general.isLord });
      } else {
        ctx.fillStyle = '#2a231a'; ctx.fillRect(0, 0, size, size);
      }
    };
    if (!general) { drawFallback(); return Promise.resolve(false); }
    return get(general.name).then((img) => {
      if (img) {
        ctx.clearRect(0, 0, size, size);
        const s = Math.min(img.width, img.height);
        ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
        return true;
      }
      drawFallback();
      return false;
    });
  }

  /** 生成 dataURL（用于存档缩略图等） */
  function dataURL(general, opt) {
    opt = opt || {};
    const size = opt.size || 200;
    const c = document.createElement('canvas'); c.width = size; c.height = size;
    return paint(c, general, { ...opt, size }).then(() => c.toDataURL('image/jpeg', 0.85));
  }

  function stats() {
    const idx = window.PORTRAIT_INDEX || { chars: {} };
    return { available: Object.keys(idx.chars || {}).length, cached: cache.size };
  }

  window.Portraits = { get, paint, dataURL, src, stats };
})();
