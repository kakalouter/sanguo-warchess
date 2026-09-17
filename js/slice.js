// ===========================================================================
// 高程切片模块 —— 启动时把内嵌的战场高程 PNG 解码成数组，
// 供 Battle.buildBattlefield 随时采样（不再依赖 BattleView 是否已初始化）
// ===========================================================================
(function () {
  'use strict';
  let grid = null, W = 0, H = 0, ready = false;
  let pending = null;

  function decode(dataURL) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        const d = ctx.getImageData(0, 0, img.width, img.height).data;
        W = img.width; H = img.height;
        grid = new Float32Array(W * H);
        const M = window.SANGUO_MAP;
        for (let i = 0; i < W * H; i++) grid[i] = M.hMax * Math.pow(d[i * 4] / 255, 1 / M.hExp);
        ready = true;
        resolve(true);
      };
      img.onerror = () => { resolve(false); };
      img.src = dataURL;
    });
  }

  function init() {
    if (pending) return pending;
    pending = decode(window.SANGUO_MAP.batPNG);
    return pending;
  }

  // 供 Battle.buildBattlefield 调用（同步）
  function sample(sx, sy) {
    if (!ready) return 0;
    const x = sx < 0 ? 0 : sx >= W ? W - 1 : Math.round(sx);
    const y = sy < 0 ? 0 : sy >= H ? H - 1 : Math.round(sy);
    return grid[y * W + x];
  }

  // 双线性插值版（更平滑）
  function sampleBilinear(fx, fy) {
    if (!ready) return 0;
    const x = Math.max(0, Math.min(W - 1.001, fx));
    const y = Math.max(0, Math.min(H - 1.001, fy));
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const tx = x - x0, ty = y - y0;
    const a = grid[y0 * W + x0], b = grid[y0 * W + x0 + 1];
    const c = grid[(y0 + 1) * W + x0], d = grid[(y0 + 1) * W + x0 + 1];
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  }

  function size() { return { W, H, ready }; }

  window.Slice = { init, sample, sampleBilinear, size, get ready() { return ready; } };
})();
