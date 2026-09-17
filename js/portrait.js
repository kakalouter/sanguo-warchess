// ===========================================================================
// 三国武将头像生成器 —— 纯 Canvas 2D 程序化绘制，同一 seed 永远得到同一张脸
// 风格：绢本设色 + 写意工笔。每种武将类型（猛将/谋士/统帅/宗室/君主/
// 异族/女子/老将）有不同的冠帽、甲胄、髯口与眉眼。
// ===========================================================================
(function () {
  'use strict';

  // ---- 确定性随机 ----
  function hashStr(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const SKIN = [
    ['#f0d4b4', '#d9ae86', '#b98a63'],
    ['#e8c8a4', '#cfa276', '#ad7d55'],
    ['#dbb48c', '#c29468', '#9d6f48'],
    ['#e5c9a8', '#c9a179', '#a67c54'],
    ['#d2a87f', '#b78b62', '#8e6543'],
  ];
  const HAIR = ['#1a1512', '#241c17', '#2e231c', '#3a2c22', '#4a3a2c'];
  const HAIR_GREY = ['#8e8a84', '#a8a49c', '#6e6a64'];

  // 按五维属性 + 名字判定人物的视觉类型
  function classify(g) {
    const war = g.war || 0, intel = g.intel || 0, lead = g.lead || 0, pol = g.pol || 0;
    const age = g.age || 35;
    const female = /貂蝉|甄姬|大乔|小乔|孙尚香|黄月英|蔡文姬|祝融|樊夫人|吴国太|卞夫人|甘夫人|糜夫人|邹氏|何太后|董白|曹节|伏寿|唐姬|徐氏|王异|辛宪英|夏侯氏|关银屏|张星彩|马云禄|花鬘|鲍三娘/.test(g.name);
    if (female) return 'female';
    if (age >= 60) return 'elder';
    if (war >= 88 && war >= intel) return 'warrior';
    if (intel >= 88 && intel > war) return 'strategist';
    if (lead >= 88) return 'commander';
    if (pol >= 88) return 'minister';
    if (war >= 76) return 'warrior';
    if (intel >= 76) return 'strategist';
    if (lead >= 76) return 'commander';
    return 'officer';
  }

  const HEADGEAR = {
    warrior: ['helmet', 'headband', 'helmet', 'crownlet'],
    strategist: ['scholar', 'scholar', 'lunjin', 'guan'],
    commander: ['helmet', 'guan', 'crownlet', 'headband'],
    minister: ['jinxian', 'scholar', 'guan', 'lunjin'],
    officer: ['headband', 'guan', 'jinxian', 'scholar'],
    elder: ['lunjin', 'scholar', 'guan', 'jinxian'],
    female: ['female', 'female', 'guan', 'crownlet'],
    lord: ['crownlet', 'guan', 'helmet', 'jinxian'],
  };

  function pick(rng, arr, label) {
    if (label && arr.indexOf(label) >= 0) return label;
    return arr[Math.floor(rng() * arr.length) % arr.length];
  }

  // =========================== 绘制子程序 ===========================

  function drawBackdrop(ctx, S, rng, faction, isLord) {
    const g = ctx.createLinearGradient(0, 0, S, S);
    const hue = (faction && faction.hue) || 30;
    g.addColorStop(0, `hsl(${hue}, 34%, ${isLord ? 42 : 34}%)`);
    g.addColorStop(0.55, `hsl(${hue}, 26%, ${isLord ? 30 : 24}%)`);
    g.addColorStop(1, `hsl(${(hue + 18) % 360}, 22%, 14%)`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);

    // 绢纹
    ctx.save();
    ctx.globalAlpha = 0.07;
    for (let i = 0; i < S; i += 3) {
      ctx.strokeStyle = i % 6 === 0 ? '#fff' : '#000';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i - S * 0.25, S); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(S, i - S * 0.25); ctx.stroke();
    }
    ctx.restore();

    // 背后的圆形云气光环
    const cx = S * 0.5, cy = S * 0.42;
    const rad = S * 0.46;
    const rg = ctx.createRadialGradient(cx, cy, rad * 0.2, cx, cy, rad);
    rg.addColorStop(0, `hsla(${hue}, 60%, ${isLord ? 72 : 62}%, 0.42)`);
    rg.addColorStop(0.7, `hsla(${hue}, 55%, 50%, 0.12)`);
    rg.addColorStop(1, 'hsla(0,0%,0%,0)');
    ctx.fillStyle = rg;
    ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.fill();

    // 边缘暗角
    const vg = ctx.createRadialGradient(cx, cy, S * 0.32, cx, cy, S * 0.78);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, S, S);
  }

  function drawShoulders(ctx, S, rng, faction, type, armor) {
    const baseW = S * 0.92, y = S * 1.02;
    const col = faction ? faction.color : '#5a6b7a';
    const dark = faction ? faction.dark : '#333d47';
    ctx.save();
    // 身躯轮廓
    ctx.beginPath();
    ctx.moveTo(S * 0.5 - baseW * 0.5, y);
    ctx.bezierCurveTo(S * 0.5 - baseW * 0.46, S * 0.70, S * 0.5 - S * 0.17, S * 0.735, S * 0.5, S * 0.735);
    ctx.bezierCurveTo(S * 0.5 + S * 0.17, S * 0.735, S * 0.5 + baseW * 0.46, S * 0.70, S * 0.5 + baseW * 0.5, y);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, S * 0.72, 0, y);
    g.addColorStop(0, col); g.addColorStop(1, dark);
    ctx.fillStyle = g; ctx.fill();

    if (armor) {
      // 鳞甲
      ctx.save(); ctx.clip();
      ctx.strokeStyle = 'rgba(255,225,170,0.30)'; ctx.lineWidth = 1.1;
      for (let r = 0; r < 9; r++) {
        const yy = S * 0.755 + r * S * 0.032;
        for (let c = -7; c <= 7; c++) {
          const xx = S * 0.5 + c * S * 0.038 + (r % 2 ? S * 0.019 : 0);
          ctx.beginPath();
          ctx.arc(xx, yy, S * 0.019, Math.PI * 0.08, Math.PI * 0.92);
          ctx.stroke();
        }
      }
      // 护心镜
      if (rng() > 0.35) {
        const mg = ctx.createRadialGradient(S * 0.5, S * 0.83, 1, S * 0.5, S * 0.83, S * 0.075);
        mg.addColorStop(0, '#f6e3a8'); mg.addColorStop(0.7, '#b8923f'); mg.addColorStop(1, '#6d5320');
        ctx.beginPath(); ctx.arc(S * 0.5, S * 0.83, S * 0.072, 0, Math.PI * 2);
        ctx.fillStyle = mg; ctx.fill();
        ctx.strokeStyle = 'rgba(40,26,8,0.7)'; ctx.lineWidth = 1.6; ctx.stroke();
      }
      // 披膊
      ctx.fillStyle = 'rgba(20,14,8,0.35)';
      ctx.beginPath(); ctx.ellipse(S * 0.20, S * 0.80, S * 0.13, S * 0.075, -0.35, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(S * 0.80, S * 0.80, S * 0.13, S * 0.075, 0.35, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    } else {
      // 交领衣纹
      ctx.save(); ctx.clip();
      ctx.strokeStyle = 'rgba(0,0,0,0.30)'; ctx.lineWidth = S * 0.018;
      ctx.beginPath();
      ctx.moveTo(S * 0.5, S * 0.75); ctx.lineTo(S * 0.36, y); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(S * 0.5, S * 0.75); ctx.lineTo(S * 0.64, y); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,240,210,0.22)'; ctx.lineWidth = S * 0.006;
      ctx.beginPath(); ctx.moveTo(S * 0.5, S * 0.775); ctx.lineTo(S * 0.40, y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(S * 0.5, S * 0.775); ctx.lineTo(S * 0.60, y); ctx.stroke();
      // 领缘
      ctx.strokeStyle = 'rgba(250,240,215,0.55)'; ctx.lineWidth = S * 0.016;
      ctx.beginPath(); ctx.moveTo(S * 0.44, S * 0.755); ctx.lineTo(S * 0.5, S * 0.80); ctx.lineTo(S * 0.56, S * 0.755); ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  function drawNeck(ctx, S, skin) {
    ctx.fillStyle = skin[1];
    ctx.beginPath();
    ctx.moveTo(S * 0.435, S * 0.62); ctx.lineTo(S * 0.565, S * 0.62);
    ctx.lineTo(S * 0.585, S * 0.745); ctx.lineTo(S * 0.415, S * 0.745);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath(); ctx.ellipse(S * 0.5, S * 0.715, S * 0.09, S * 0.028, 0, 0, Math.PI * 2); ctx.fill();
  }

  function facePath(ctx, S, p) {
    const w = S * p.faceW, h = S * p.faceH, cy = S * 0.47;
    ctx.beginPath();
    ctx.moveTo(S * 0.5, cy - h * 0.52);
    ctx.bezierCurveTo(S * 0.5 + w * 0.62, cy - h * 0.50, S * 0.5 + w * 0.56, cy + h * 0.10, S * 0.5 + w * 0.40, cy + h * 0.30);
    ctx.bezierCurveTo(S * 0.5 + w * 0.26, cy + h * 0.50, S * 0.5 + w * 0.12, cy + h * 0.56, S * 0.5, cy + h * 0.56);
    ctx.bezierCurveTo(S * 0.5 - w * 0.12, cy + h * 0.56, S * 0.5 - w * 0.26, cy + h * 0.50, S * 0.5 - w * 0.40, cy + h * 0.30);
    ctx.bezierCurveTo(S * 0.5 - w * 0.56, cy + h * 0.10, S * 0.5 - w * 0.62, cy - h * 0.50, S * 0.5, cy - h * 0.52);
    ctx.closePath();
  }

  function drawEars(ctx, S, skin, p) {
    const cy = S * 0.47;
    const w = S * p.faceW, h = S * p.faceH;
    for (const s of [-1, 1]) {
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(S * 0.5 + s * w * 0.60, cy + h * 0.06, S * 0.030, S * 0.055, s * 0.15, 0, Math.PI * 2);
      ctx.fillStyle = skin[1]; ctx.fill();
      ctx.strokeStyle = skin[2]; ctx.lineWidth = S * 0.006; ctx.stroke();
      ctx.restore();
    }
  }

  function drawFace(ctx, S, rng, skin, p, type, age) {
    const cy = S * 0.47, w = S * p.faceW, h = S * p.faceH;
    ctx.save();
    facePath(ctx, S, p);
    // 肤色渐变
    const g = ctx.createLinearGradient(S * 0.5 - w * 0.6, cy - h * 0.5, S * 0.5 + w * 0.6, cy + h * 0.55);
    g.addColorStop(0, skin[0]);
    g.addColorStop(0.5, skin[1]);
    g.addColorStop(1, skin[2]);
    ctx.fillStyle = g; ctx.fill();
    ctx.clip();

    // 侧影
    const sh = ctx.createLinearGradient(S * 0.5 - w * 0.6, 0, S * 0.5 - w * 0.1, 0);
    sh.addColorStop(0, 'rgba(70,40,20,0.34)'); sh.addColorStop(1, 'rgba(70,40,20,0)');
    ctx.fillStyle = sh; ctx.fillRect(0, 0, S, S);
    // 高光
    const hl = ctx.createRadialGradient(S * 0.5 + w * 0.16, cy - h * 0.20, 2, S * 0.5 + w * 0.16, cy - h * 0.20, S * 0.22);
    hl.addColorStop(0, 'rgba(255,240,220,0.30)'); hl.addColorStop(1, 'rgba(255,240,220,0)');
    ctx.fillStyle = hl; ctx.fillRect(0, 0, S, S);

    // 额头（饱满度）
    ctx.fillStyle = 'rgba(255,245,225,0.14)';
    ctx.beginPath(); ctx.ellipse(S * 0.5, cy - h * 0.34, w * 0.42, h * 0.16, 0, 0, Math.PI * 2); ctx.fill();

    // 眉毛
    const browY = cy - h * 0.11, browW = w * 0.30;
    const thick = 0.014 * (type === 'warrior' ? 1.7 : type === 'female' ? 0.75 : 1) * (1 + (age - 35) * 0.004);
    const tilt = type === 'warrior' ? 0.16 : type === 'female' ? -0.02 : 0.07;
    for (const s of [-1, 1]) {
      ctx.save();
      ctx.translate(S * 0.5 + s * w * 0.235, browY);
      ctx.rotate(s * tilt);
      ctx.beginPath();
      ctx.moveTo(-s * browW * 0.55, S * 0.012);
      ctx.quadraticCurveTo(0, -S * thick * 1.1, s * browW * 0.55, -S * 0.004);
      ctx.quadraticCurveTo(0, S * thick * 0.5, -s * browW * 0.55, S * 0.012);
      ctx.closePath();
      ctx.fillStyle = p.browCol; ctx.fill();
      ctx.restore();
    }

    // 眼睛
    const eyeY = cy + h * 0.02, eyeDX = w * 0.225, eyeW = w * 0.155, eyeH = h * 0.072;
    for (const s of [-1, 1]) {
      const ex = S * 0.5 + s * eyeDX;
      ctx.save();
      // 眼窝阴影
      ctx.fillStyle = 'rgba(60,34,18,0.20)';
      ctx.beginPath(); ctx.ellipse(ex, eyeY - eyeH * 0.30, eyeW * 1.22, eyeH * 1.15, 0, 0, Math.PI * 2); ctx.fill();
      // 眼白
      ctx.beginPath();
      ctx.moveTo(ex - eyeW, eyeY);
      ctx.quadraticCurveTo(ex, eyeY - eyeH * (type === 'warrior' ? 1.15 : 1.0), ex + eyeW, eyeY);
      ctx.quadraticCurveTo(ex, eyeY + eyeH * 0.92, ex - eyeW, eyeY);
      ctx.closePath();
      ctx.fillStyle = '#f6efe2'; ctx.fill();
      // 瞳
      const irisR = eyeW * 0.46;
      const ig = ctx.createRadialGradient(ex, eyeY, 1, ex, eyeY, irisR);
      ig.addColorStop(0, p.eyeLight); ig.addColorStop(0.75, p.eyeCol); ig.addColorStop(1, '#160d06');
      ctx.beginPath(); ctx.arc(ex + s * eyeW * 0.03, eyeY + eyeH * 0.04, irisR, 0, Math.PI * 2);
      ctx.fillStyle = ig; ctx.fill();
      ctx.beginPath(); ctx.arc(ex + s * eyeW * 0.03 - irisR * 0.3, eyeY - irisR * 0.35, irisR * 0.30, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.fill();
      // 上睑线
      ctx.beginPath();
      ctx.moveTo(ex - eyeW * 1.06, eyeY + eyeH * 0.10);
      ctx.quadraticCurveTo(ex, eyeY - eyeH * (type === 'warrior' ? 1.25 : 1.06), ex + eyeW * 1.0, eyeY - eyeH * 0.06);
      ctx.strokeStyle = 'rgba(24,14,8,0.86)';
      ctx.lineWidth = S * (type === 'warrior' ? 0.010 : type === 'female' ? 0.006 : 0.008);
      ctx.lineCap = 'round'; ctx.stroke();
      // 下睑
      ctx.beginPath();
      ctx.moveTo(ex - eyeW * 0.85, eyeY + eyeH * 0.52);
      ctx.quadraticCurveTo(ex, eyeY + eyeH * 0.86, ex + eyeW * 0.82, eyeY + eyeH * 0.42);
      ctx.strokeStyle = 'rgba(40,24,14,0.34)'; ctx.lineWidth = S * 0.005; ctx.stroke();
      // 卧蚕
      if (type !== 'female' && rng() > 0.5) {
        ctx.beginPath();
        ctx.moveTo(ex - eyeW * 0.8, eyeY + eyeH * 1.15);
        ctx.quadraticCurveTo(ex, eyeY + eyeH * 1.75, ex + eyeW * 0.78, eyeY + eyeH * 1.05);
        ctx.strokeStyle = 'rgba(150,100,70,0.30)'; ctx.lineWidth = S * 0.008; ctx.stroke();
      }
      ctx.restore();
    }

    // 鼻
    const noseTop = cy - h * 0.06, noseBot = cy + h * 0.20;
    ctx.beginPath();
    ctx.moveTo(S * 0.5 - w * 0.030, noseTop);
    ctx.quadraticCurveTo(S * 0.5 - w * 0.085, cy + h * 0.09, S * 0.5 - w * 0.075, noseBot);
    ctx.quadraticCurveTo(S * 0.5, noseBot + h * 0.055, S * 0.5 + w * 0.075, noseBot);
    ctx.quadraticCurveTo(S * 0.5 + w * 0.085, cy + h * 0.09, S * 0.5 + w * 0.030, noseTop);
    ctx.strokeStyle = 'rgba(120,74,44,0.42)';
    ctx.lineWidth = S * 0.008; ctx.lineCap = 'round'; ctx.stroke();
    // 鼻梁高光
    ctx.beginPath();
    ctx.moveTo(S * 0.5 - w * 0.018, noseTop + h * 0.02);
    ctx.quadraticCurveTo(S * 0.5 - w * 0.03, cy + h * 0.08, S * 0.5 - w * 0.022, noseBot - h * 0.02);
    ctx.strokeStyle = 'rgba(255,248,235,0.35)'; ctx.lineWidth = S * 0.012; ctx.stroke();
    // 鼻翼
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(S * 0.5 + s * w * 0.072, noseBot - h * 0.005, S * 0.016, S * 0.012, s * 0.3, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(110,64,38,0.24)'; ctx.fill();
    }

    // 嘴（含表情：武力高者嘴角下压，魅力高者上扬）
    const mouthY = cy + h * 0.315, mw = w * 0.165;
    const curve = p.mouthCurve;
    ctx.beginPath();
    ctx.moveTo(S * 0.5 - mw, mouthY);
    ctx.quadraticCurveTo(S * 0.5, mouthY + S * curve, S * 0.5 + mw, mouthY);
    if (type === 'female') {
      ctx.quadraticCurveTo(S * 0.5, mouthY + S * (curve + 0.020), S * 0.5 - mw, mouthY);
      ctx.closePath();
      ctx.fillStyle = '#b24a45'; ctx.fill();
    }
    ctx.beginPath();
    ctx.moveTo(S * 0.5 - mw * 1.06, mouthY);
    ctx.quadraticCurveTo(S * 0.5, mouthY + S * curve, S * 0.5 + mw * 1.06, mouthY);
    ctx.strokeStyle = 'rgba(88,44,32,0.72)';
    ctx.lineWidth = S * 0.0085; ctx.lineCap = 'round'; ctx.stroke();
    // 下唇高光
    ctx.beginPath();
    ctx.ellipse(S * 0.5, mouthY + S * 0.030, mw * 0.66, S * 0.013, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,220,200,0.16)'; ctx.fill();

    // 法令纹 / 皱纹
    const wrinkle = Math.max(0, (age - 32) / 45);
    if (wrinkle > 0.02) {
      ctx.strokeStyle = `rgba(120,74,44,${0.12 + wrinkle * 0.34})`;
      ctx.lineWidth = S * 0.007;
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(S * 0.5 + s * w * 0.135, noseBot - h * 0.02);
        ctx.quadraticCurveTo(S * 0.5 + s * w * 0.245, cy + h * 0.30, S * 0.5 + s * w * 0.235, cy + h * 0.44);
        ctx.stroke();
      }
      // 抬头纹
      if (wrinkle > 0.35) {
        for (let i = 0; i < 2 + Math.round(wrinkle * 2); i++) {
          ctx.beginPath();
          ctx.moveTo(S * 0.5 - w * 0.26, cy - h * 0.36 + i * h * 0.045);
          ctx.quadraticCurveTo(S * 0.5, cy - h * 0.40 + i * h * 0.045, S * 0.5 + w * 0.26, cy - h * 0.36 + i * h * 0.045);
          ctx.strokeStyle = `rgba(120,74,44,${0.10 + wrinkle * 0.16})`;
          ctx.lineWidth = S * 0.006; ctx.stroke();
        }
      }
    }
    // 战疤
    if (type === 'warrior' && rng() > 0.62) {
      const sx = S * 0.5 + (rng() > 0.5 ? 1 : -1) * w * (0.20 + rng() * 0.14);
      ctx.beginPath();
      ctx.moveTo(sx, cy - h * 0.22); ctx.lineTo(sx + S * 0.012, cy + h * 0.16);
      ctx.strokeStyle = 'rgba(150,86,66,0.66)'; ctx.lineWidth = S * 0.010; ctx.stroke();
      ctx.strokeStyle = 'rgba(255,230,215,0.34)'; ctx.lineWidth = S * 0.004;
      ctx.beginPath(); ctx.moveTo(sx + S * 0.006, cy - h * 0.22); ctx.lineTo(sx + S * 0.018, cy + h * 0.16); ctx.stroke();
    }
    ctx.restore();
  }

  function drawHairAndBeard(ctx, S, rng, p, type, hairCol, age) {
    const cy = S * 0.47, w = S * p.faceW, h = S * p.faceH;
    // 鬓发
    ctx.fillStyle = hairCol;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(S * 0.5 + s * w * 0.44, cy - h * 0.42);
      ctx.quadraticCurveTo(S * 0.5 + s * w * 0.66, cy - h * 0.10, S * 0.5 + s * w * 0.52, cy + h * 0.34);
      ctx.quadraticCurveTo(S * 0.5 + s * w * 0.44, cy - h * 0.02, S * 0.5 + s * w * 0.36, cy - h * 0.34);
      ctx.closePath(); ctx.fill();
    }
    // 发际
    ctx.beginPath();
    ctx.moveTo(S * 0.5 - w * 0.50, cy - h * 0.30);
    ctx.quadraticCurveTo(S * 0.5, cy - h * 0.72, S * 0.5 + w * 0.50, cy - h * 0.30);
    ctx.quadraticCurveTo(S * 0.5 + w * 0.30, cy - h * 0.44, S * 0.5, cy - h * 0.42);
    ctx.quadraticCurveTo(S * 0.5 - w * 0.30, cy - h * 0.44, S * 0.5 - w * 0.50, cy - h * 0.30);
    ctx.closePath(); ctx.fillStyle = hairCol; ctx.fill();

    // 髯口
    const beardKind = p.beard;
    if (beardKind !== 'none') {
      const bl = beardKind === 'long' ? 1.0 : beardKind === 'full' ? 0.86 : beardKind === 'goatee' ? 0.5 : 0.34;
      ctx.save();
      ctx.fillStyle = hairCol;
      ctx.globalAlpha = age >= 58 ? 0.94 : 1;
      // 上唇髭
      ctx.beginPath();
      ctx.moveTo(S * 0.5 - w * 0.20, cy + h * 0.255);
      ctx.quadraticCurveTo(S * 0.5 - w * 0.30, cy + h * 0.30, S * 0.5 - w * 0.255, cy + h * 0.40);
      ctx.quadraticCurveTo(S * 0.5 - w * 0.10, cy + h * 0.325, S * 0.5, cy + h * 0.325);
      ctx.quadraticCurveTo(S * 0.5 + w * 0.10, cy + h * 0.325, S * 0.5 + w * 0.255, cy + h * 0.40);
      ctx.quadraticCurveTo(S * 0.5 + w * 0.30, cy + h * 0.30, S * 0.5 + w * 0.20, cy + h * 0.255);
      ctx.quadraticCurveTo(S * 0.5, cy + h * 0.285, S * 0.5 - w * 0.20, cy + h * 0.255);
      ctx.closePath(); ctx.fill();
      // 下巴胡
      if (beardKind === 'long' || beardKind === 'full' || beardKind === 'goatee') {
        const by = cy + h * 0.50, bh = h * 0.40 * bl;
        ctx.beginPath();
        ctx.moveTo(S * 0.5 - w * 0.30, by);
        ctx.quadraticCurveTo(S * 0.5 - w * 0.36 * bl, by + bh * 0.55, S * 0.5 - w * 0.10 * bl, by + bh);
        ctx.quadraticCurveTo(S * 0.5, by + bh * 1.14, S * 0.5 + w * 0.10 * bl, by + bh);
        ctx.quadraticCurveTo(S * 0.5 + w * 0.36 * bl, by + bh * 0.55, S * 0.5 + w * 0.30, by);
        ctx.quadraticCurveTo(S * 0.5, by + h * 0.14, S * 0.5 - w * 0.30, by);
        ctx.closePath(); ctx.fill();
        // 须丝
        ctx.strokeStyle = hairCol; ctx.lineWidth = S * 0.006;
        for (let i = -4; i <= 4; i++) {
          ctx.beginPath();
          ctx.moveTo(S * 0.5 + i * w * 0.055, by + h * 0.03);
          ctx.quadraticCurveTo(S * 0.5 + i * w * 0.075, by + bh * 0.55, S * 0.5 + i * w * 0.055 * bl, by + bh * (0.86 + rng() * 0.12));
          ctx.stroke();
        }
      }
      ctx.restore();
    }
  }

  function drawHeadgear(ctx, S, rng, kind, p, hairCol, faction, isLord) {
    const cy = S * 0.47, w = S * p.faceW, h = S * p.faceH;
    const gold = '#d8b25c', goldDark = '#8f6a24', ink = '#221a14';
    const bandCol = faction ? faction.color : '#4a5a68';
    ctx.save();
    switch (kind) {
      case 'helmet': {
        const hw = w * 0.78, hy = cy - h * 0.40;
        // 盔体
        ctx.beginPath();
        ctx.moveTo(S * 0.5 - hw, hy + h * 0.30);
        ctx.quadraticCurveTo(S * 0.5 - hw * 1.02, hy - h * 0.34, S * 0.5, hy - h * 0.40);
        ctx.quadraticCurveTo(S * 0.5 + hw * 1.02, hy - h * 0.34, S * 0.5 + hw, hy + h * 0.30);
        ctx.quadraticCurveTo(S * 0.5, hy + h * 0.14, S * 0.5 - hw, hy + h * 0.30);
        ctx.closePath();
        const hg = ctx.createLinearGradient(S * 0.5 - hw, hy, S * 0.5 + hw, hy + h * 0.3);
        hg.addColorStop(0, '#6e6a63'); hg.addColorStop(0.35, '#b9b3a6'); hg.addColorStop(0.6, '#8d877c'); hg.addColorStop(1, '#514d47');
        ctx.fillStyle = hg; ctx.fill();
        ctx.strokeStyle = 'rgba(20,16,12,0.7)'; ctx.lineWidth = S * 0.008; ctx.stroke();
        // 盔缘
        ctx.beginPath();
        ctx.moveTo(S * 0.5 - hw * 1.06, hy + h * 0.28);
        ctx.quadraticCurveTo(S * 0.5, hy + h * 0.44, S * 0.5 + hw * 1.06, hy + h * 0.28);
        ctx.lineWidth = S * 0.030; ctx.strokeStyle = goldDark; ctx.stroke();
        ctx.lineWidth = S * 0.016; ctx.strokeStyle = gold; ctx.stroke();
        // 顶珠 / 缨
        ctx.beginPath(); ctx.arc(S * 0.5, hy - h * 0.40, S * 0.034, 0, Math.PI * 2);
        ctx.fillStyle = gold; ctx.fill();
        ctx.strokeStyle = goldDark; ctx.lineWidth = S * 0.006; ctx.stroke();
        // 红缨
        ctx.beginPath();
        ctx.moveTo(S * 0.5, hy - h * 0.42);
        ctx.quadraticCurveTo(S * 0.5 - w * 0.10, hy - h * 0.86, S * 0.5 + w * 0.06, hy - h * 0.98);
        ctx.quadraticCurveTo(S * 0.5 + w * 0.22, hy - h * 0.74, S * 0.5 + w * 0.04, hy - h * 0.42);
        ctx.closePath();
        ctx.fillStyle = isLord ? '#c8342c' : '#a82a24'; ctx.fill();
        // 护额
        ctx.beginPath();
        ctx.moveTo(S * 0.5 - hw * 0.96, hy + h * 0.10);
        ctx.lineTo(S * 0.5 + hw * 0.96, hy + h * 0.10);
        ctx.lineWidth = S * 0.020; ctx.strokeStyle = bandCol; ctx.stroke();
        // 顿项
        for (const s of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(S * 0.5 + s * hw * 0.98, hy + h * 0.24);
          ctx.quadraticCurveTo(S * 0.5 + s * hw * 1.16, cy + h * 0.16, S * 0.5 + s * hw * 0.86, cy + h * 0.52);
          ctx.lineWidth = S * 0.026; ctx.strokeStyle = '#5c5750'; ctx.stroke();
        }
        break;
      }
      case 'guan': {
        // 冠（文官/武将通用小冠）
        const hy = cy - h * 0.52, gw = w * 0.34;
        ctx.beginPath();
        ctx.moveTo(S * 0.5 - gw, hy + h * 0.22);
        ctx.lineTo(S * 0.5 - gw * 0.82, hy - h * 0.14);
        ctx.lineTo(S * 0.5 - gw * 0.30, hy - h * 0.24);
        ctx.lineTo(S * 0.5 + gw * 0.30, hy - h * 0.24);
        ctx.lineTo(S * 0.5 + gw * 0.82, hy - h * 0.14);
        ctx.lineTo(S * 0.5 + gw, hy + h * 0.22);
        ctx.closePath();
        const g2 = ctx.createLinearGradient(0, hy - h * 0.24, 0, hy + h * 0.22);
        g2.addColorStop(0, '#2c2620'); g2.addColorStop(1, '#0f0c0a');
        ctx.fillStyle = g2; ctx.fill();
        ctx.strokeStyle = gold; ctx.lineWidth = S * 0.008; ctx.stroke();
        // 簪
        ctx.beginPath();
        ctx.moveTo(S * 0.5 - gw * 1.3, hy - h * 0.06); ctx.lineTo(S * 0.5 + gw * 1.3, hy - h * 0.02);
        ctx.strokeStyle = gold; ctx.lineWidth = S * 0.011; ctx.stroke();
        break;
      }
      case 'jinxian': {
        // 进贤冠（文臣）
        const hy = cy - h * 0.50, gw = w * 0.36;
        ctx.beginPath();
        ctx.moveTo(S * 0.5 - gw, hy + h * 0.24);
        ctx.lineTo(S * 0.5 - gw * 0.72, hy - h * 0.16);
        ctx.quadraticCurveTo(S * 0.5, hy - h * 0.42, S * 0.5 + gw * 0.72, hy - h * 0.16);
        ctx.lineTo(S * 0.5 + gw, hy + h * 0.24);
        ctx.closePath();
        const g3 = ctx.createLinearGradient(0, hy - h * 0.42, 0, hy + h * 0.24);
        g3.addColorStop(0, '#3a3229'); g3.addColorStop(1, '#15110d');
        ctx.fillStyle = g3; ctx.fill();
        ctx.strokeStyle = 'rgba(200,170,110,0.5)'; ctx.lineWidth = S * 0.006; ctx.stroke();
        // 梁
        ctx.beginPath();
        ctx.moveTo(S * 0.5 - gw * 0.50, hy - h * 0.30);
        ctx.quadraticCurveTo(S * 0.5, hy - h * 0.44, S * 0.5 + gw * 0.50, hy - h * 0.30);
        ctx.strokeStyle = gold; ctx.lineWidth = S * 0.010; ctx.stroke();
        break;
      }
      case 'lunjin': {
        // 纶巾（诸葛巾）
        const hy = cy - h * 0.36;
        ctx.beginPath();
        ctx.moveTo(S * 0.5 - w * 0.62, hy + h * 0.26);
        ctx.quadraticCurveTo(S * 0.5 - w * 0.70, hy - h * 0.30, S * 0.5, hy - h * 0.36);
        ctx.quadraticCurveTo(S * 0.5 + w * 0.70, hy - h * 0.30, S * 0.5 + w * 0.62, hy + h * 0.26);
        ctx.quadraticCurveTo(S * 0.5, hy + h * 0.06, S * 0.5 - w * 0.62, hy + h * 0.26);
        ctx.closePath();
        ctx.fillStyle = '#dcd3bd'; ctx.fill();
        ctx.strokeStyle = 'rgba(60,50,36,0.55)'; ctx.lineWidth = S * 0.007; ctx.stroke();
        // 巾褶
        ctx.strokeStyle = 'rgba(90,76,56,0.34)'; ctx.lineWidth = S * 0.005;
        for (let i = -2; i <= 2; i++) {
          ctx.beginPath();
          ctx.moveTo(S * 0.5 + i * w * 0.20, hy - h * 0.30);
          ctx.quadraticCurveTo(S * 0.5 + i * w * 0.24, hy - h * 0.05, S * 0.5 + i * w * 0.17, hy + h * 0.20);
          ctx.stroke();
        }
        // 垂带
        ctx.beginPath();
        ctx.moveTo(S * 0.5 + w * 0.50, hy + h * 0.14);
        ctx.quadraticCurveTo(S * 0.5 + w * 0.74, hy + h * 0.50, S * 0.5 + w * 0.62, hy + h * 0.86);
        ctx.lineWidth = S * 0.020; ctx.strokeStyle = '#cfc5ad'; ctx.stroke();
        break;
      }
      case 'headband': {
        const hy = cy - h * 0.34;
        ctx.beginPath();
        ctx.moveTo(S * 0.5 - w * 0.62, hy + h * 0.14);
        ctx.quadraticCurveTo(S * 0.5, hy + h * 0.26, S * 0.5 + w * 0.62, hy + h * 0.14);
        ctx.lineWidth = S * 0.038; ctx.strokeStyle = bandCol; ctx.stroke();
        ctx.lineWidth = S * 0.010; ctx.strokeStyle = 'rgba(255,235,190,0.5)'; ctx.stroke();
        // 额带飘尾
        ctx.beginPath();
        ctx.moveTo(S * 0.5 + w * 0.60, hy + h * 0.18);
        ctx.quadraticCurveTo(S * 0.5 + w * 0.96, hy + h * 0.44, S * 0.5 + w * 0.86, hy + h * 0.78);
        ctx.lineWidth = S * 0.016; ctx.strokeStyle = bandCol; ctx.stroke();
        break;
      }
      case 'crownlet': {
        // 王冠 / 平天冠
        const hy = cy - h * 0.56, gw = w * 0.56;
        ctx.beginPath();
        ctx.moveTo(S * 0.5 - gw, hy + h * 0.30);
        ctx.lineTo(S * 0.5 - gw * 0.96, hy - h * 0.06);
        ctx.lineTo(S * 0.5 + gw * 0.96, hy - h * 0.06);
        ctx.lineTo(S * 0.5 + gw, hy + h * 0.30);
        ctx.closePath();
        const g4 = ctx.createLinearGradient(0, hy - h * 0.06, 0, hy + h * 0.30);
        g4.addColorStop(0, '#1a1512'); g4.addColorStop(1, '#0a0806');
        ctx.fillStyle = g4; ctx.fill();
        // 冕板
        ctx.beginPath();
        ctx.ellipse(S * 0.5, hy - h * 0.08, gw * 1.28, h * 0.075, 0, 0, Math.PI * 2);
        ctx.fillStyle = '#12100c'; ctx.fill();
        ctx.strokeStyle = gold; ctx.lineWidth = S * 0.009; ctx.stroke();
        // 旒
        for (let i = -3; i <= 3; i++) {
          const lx = S * 0.5 + i * gw * 0.34;
          ctx.beginPath();
          ctx.moveTo(lx, hy - h * 0.06);
          ctx.lineTo(lx, hy + h * 0.26);
          ctx.strokeStyle = 'rgba(220,190,120,0.72)'; ctx.lineWidth = S * 0.005; ctx.stroke();
          for (let k = 0; k < 4; k++) {
            ctx.beginPath();
            ctx.arc(lx, hy - h * 0.02 + k * h * 0.075, S * 0.011, 0, Math.PI * 2);
            ctx.fillStyle = k % 2 ? '#c2352c' : '#e6d9a8'; ctx.fill();
          }
        }
        // 两侧金饰
        for (const s of [-1, 1]) {
          ctx.beginPath();
          ctx.arc(S * 0.5 + s * gw * 0.86, hy + h * 0.14, S * 0.022, 0, Math.PI * 2);
          ctx.fillStyle = gold; ctx.fill();
        }
        break;
      }
      case 'female': {
        const hy = cy - h * 0.52;
        // 发髻
        ctx.fillStyle = hairCol;
        ctx.beginPath(); ctx.ellipse(S * 0.5, hy + h * 0.12, w * 0.62, h * 0.22, 0, 0, Math.PI * 2); ctx.fill();
        for (const s of [-1, 1]) {
          ctx.beginPath();
          ctx.ellipse(S * 0.5 + s * w * 0.40, hy - h * 0.10, w * 0.22, h * 0.15, s * 0.5, 0, Math.PI * 2);
          ctx.fill();
        }
        // 发饰
        for (const s of [-1, 1]) {
          ctx.beginPath();
          ctx.arc(S * 0.5 + s * w * 0.42, hy - h * 0.08, S * 0.020, 0, Math.PI * 2);
          ctx.fillStyle = '#e8c86a'; ctx.fill();
          ctx.strokeStyle = '#9a7420'; ctx.lineWidth = S * 0.005; ctx.stroke();
        }
        // 步摇
        ctx.beginPath();
        ctx.moveTo(S * 0.5 - w * 0.60, hy + h * 0.10);
        ctx.quadraticCurveTo(S * 0.5 - w * 0.86, hy + h * 0.46, S * 0.5 - w * 0.70, hy + h * 0.76);
        ctx.strokeStyle = '#e8c86a'; ctx.lineWidth = S * 0.007; ctx.stroke();
        break;
      }
    }
    ctx.restore();
  }

  function drawRimLight(ctx, S, rng) {
    const g = ctx.createLinearGradient(0, 0, S, S * 0.8);
    g.addColorStop(0, 'rgba(255,232,190,0.16)');
    g.addColorStop(0.5, 'rgba(255,232,190,0)');
    g.addColorStop(1, 'rgba(120,160,200,0.10)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  }

  // =========================== 主入口 ===========================
  /**
   * 绘制武将头像到 canvas
   * @param {CanvasRenderingContext2D} ctx
   * @param {object} g  武将对象 { name, war, intel, lead, pol, charm, age }
   * @param {object} opt { size, faction:{hue,color,dark}, kind, seed }
   */
  function drawPortrait(ctx, g, opt) {
    opt = opt || {};
    const S = opt.size || 256;
    const name = g.name || '无名';
    const seed = hashStr(name + '|' + (opt.seed || ''));
    const rng = mulberry32(seed);
    const type = opt.kind || classify(g);
    const isLord = !!opt.isLord;
    const faction = opt.faction || { hue: 34, color: '#7a6a52', dark: '#3a3226' };
    const skin = SKIN[Math.floor(rng() * SKIN.length) % SKIN.length];
    const age = g.age || (type === 'elder' ? 66 : 22 + Math.floor(rng() * 30));

    // 发色：老者转白
    let hairCol;
    if (age >= 62) hairCol = HAIR_GREY[Math.floor(rng() * HAIR_GREY.length) % HAIR_GREY.length];
    else if (age >= 52 && rng() > 0.5) hairCol = '#5a5048';
    else hairCol = HAIR[Math.floor(rng() * HAIR.length) % HAIR.length];

    const p = {
      faceW: 0.30 + rng() * 0.055,
      faceH: 0.70 + rng() * 0.075,
      browCol: hairCol,
      eyeCol: ['#3a2416', '#2a1a10', '#4a3020', '#20303a'][Math.floor(rng() * 4) % 4],
      eyeLight: ['#8a6a3a', '#6a4a28', '#9a7a4a'][Math.floor(rng() * 3) % 3],
      mouthCurve: 0,
      beard: 'none',
    };
    // 面型：猛将方阔，谋士清癯
    if (type === 'warrior') { p.faceW += 0.030; p.faceH -= 0.030; }
    if (type === 'strategist') { p.faceW -= 0.026; p.faceH += 0.026; }
    if (type === 'female') { p.faceW -= 0.038; p.faceH -= 0.012; }
    p.mouthCurve = (isLord ? -0.010 : 0) + (type === 'warrior' ? -0.012 : type === 'female' ? 0.012 : 0.002) * (1 + rng() * 0.6);

    // 髯口
    const beardRoll = rng();
    if (type === 'elder') p.beard = beardRoll > 0.25 ? 'long' : 'full';
    else if (type === 'warrior') p.beard = beardRoll > 0.72 ? 'long' : beardRoll > 0.34 ? 'full' : beardRoll > 0.16 ? 'goatee' : 'none';
    else if (type === 'strategist') p.beard = beardRoll > 0.62 ? 'goatee' : beardRoll > 0.42 ? 'full' : 'short';
    else if (type === 'female') p.beard = 'none';
    else p.beard = beardRoll > 0.68 ? 'short' : beardRoll > 0.34 ? 'goatee' : 'none';

    const gear = pick(rng, HEADGEAR[type] || HEADGEAR.officer, opt.headgear);
    const armor = type === 'warrior' || (type === 'commander' && rng() > 0.45) || (type === 'lord' && rng() > 0.55);

    ctx.save();
    ctx.clearRect(0, 0, S, S);
    const k = S / 256;
    ctx.scale(k, k);
    drawBackdrop(ctx, 256, rng, faction, isLord);
    drawShoulders(ctx, 256, rng, faction, type, armor);
    drawNeck(ctx, 256, skin);
    drawEars(ctx, 256, skin, p);
    drawFace(ctx, 256, rng, skin, p, type, age);
    drawHairAndBeard(ctx, 256, rng, p, type, hairCol, age);
    drawHeadgear(ctx, 256, rng, gear, p, hairCol, faction, isLord);
    drawRimLight(ctx, 256, rng);
    ctx.restore();
    return { type, gear, age, armor };
  }

  function drawPortraitToDataURL(g, opt) {
    const S = (opt && opt.size) || 256;
    const c = document.createElement('canvas');
    c.width = S; c.height = S;
    const ctx = c.getContext('2d');
    drawPortrait(ctx, g, opt);
    return c.toDataURL('image/png');
  }

  window.PortraitGen = { drawPortrait, drawPortraitToDataURL, classify, hashStr };
})();
