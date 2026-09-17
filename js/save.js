// ===========================================================================
// 存档系统 —— localStorage 快速存档 + 文件导出/导入（.sgsav）
// ===========================================================================
(function () {
  'use strict';
  const LS_KEY = 'sanguo_save_v3';
  const LS_SLOTS = 'sanguo_slots_v3';
  const FORMAT = 'SANGUO-SAVE';
  const VERSION = 3;

  function serialize() {
    const S = GameCore.S;
    return {
      format: FORMAT, version: VERSION,
      savedAt: new Date().toISOString(),
      meta: {
        scenario: S.scenario, year: S.year, month: S.month, turn: S.turn,
        player: S.player, playerName: (S.factions[S.player] || {}).name || '?',
        cities: Object.values(S.cities).filter((c) => c.owner === S.player).length,
        generals: Object.values(S.generals).filter((g) => g.faction === S.player).length,
      },
      state: S,
    };
  }

  function deserialize(obj) {
    if (!obj || obj.format !== FORMAT) throw new Error('不是有效的存档文件');
    if (obj.version !== VERSION) throw new Error(`存档版本不匹配（文件 v${obj.version}，游戏 v${VERSION}）`);
    return obj.state;
  }

  // ---- localStorage ----
  function saveLocal(slot) {
    try {
      localStorage.setItem(slot === 0 ? LS_KEY : LS_SLOTS + '_' + slot, JSON.stringify(serialize()));
      return { ok: true, msg: '已存入浏览器（槽 ' + (slot === 0 ? '自动' : slot) + '）' };
    } catch (e) {
      return { ok: false, msg: '浏览器存储失败：' + e.message };
    }
  }
  function loadLocal(slot) {
    try {
      const raw = localStorage.getItem(slot === 0 ? LS_KEY : LS_SLOTS + '_' + slot);
      if (!raw) return { ok: false, msg: '该槽位没有存档' };
      return { ok: true, state: deserialize(JSON.parse(raw)) };
    } catch (e) { return { ok: false, msg: '读取失败：' + e.message }; }
  }
  function listLocal() {
    const out = [];
    for (let i = 0; i <= 3; i++) {
      try {
        const raw = localStorage.getItem(i === 0 ? LS_KEY : LS_SLOTS + '_' + i);
        if (raw) {
          const o = JSON.parse(raw);
          out.push({ slot: i, meta: o.meta, savedAt: o.savedAt });
        }
      } catch (e) { /* ignore */ }
    }
    return out;
  }
  function clearLocal() {
    for (let i = 0; i <= 3; i++) localStorage.removeItem(i === 0 ? LS_KEY : LS_SLOTS + '_' + i);
  }

  // ---- 文件 ----
  function download() {
    const data = serialize();
    const json = JSON.stringify(data);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    a.href = url;
    a.download = `三国志_${data.meta.playerName}_${data.meta.year}年${data.meta.month}月_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}.sgsav.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 800);
    return { ok: true, msg: `已导出 ${(json.length / 1024).toFixed(0)} KB 存档文件` };
  }
  function importFile() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,.sgsav,application/json';
      input.onchange = () => {
        const f = input.files && input.files[0];
        if (!f) return resolve({ ok: false, msg: '未选择文件' });
        const fr = new FileReader();
        fr.onload = () => {
          try {
            const obj = JSON.parse(String(fr.result));
            resolve({ ok: true, state: deserialize(obj), meta: obj.meta });
          } catch (e) { resolve({ ok: false, msg: '解析失败：' + e.message }); }
        };
        fr.onerror = () => resolve({ ok: false, msg: '文件读取失败' });
        fr.readAsText(f, 'utf-8');
      };
      input.click();
    });
  }

  window.SaveSys = { serialize, deserialize, saveLocal, loadLocal, listLocal, clearLocal, download, importFile, FORMAT, VERSION };
})();
