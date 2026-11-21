/* 公司公章渲染器：42mm 圆章，纯 Canvas，无依赖。 */
(function (global) {
  'use strict';
  if (!global.SealMeta) throw new Error('seal-meta.js must load before seal.js');

  const SIZE = 1000;        // 默认 1000px 见方，42mm 章体约 992px（600dpi）
  const PXMM = 600 / 25.4;  // 600dpi 下的每毫米像素
  const FONT_SONG = '"Songti SC", "STSong", "SimSun", "Noto Serif CJK SC", serif';
  const FONT_NUM = '"Arial", "Helvetica Neue", Helvetica, sans-serif';

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function smoothCircular(values, passes) {
    const n = values.length;
    let out = values.slice();
    for (let p = 0; p < passes; p++) {
      const next = new Array(n);
      for (let i = 0; i < n; i++) {
        next[i] = (out[(i - 1 + n) % n] + out[i] * 2 + out[(i + 1) % n]) / 4;
      }
      out = next;
    }
    return out;
  }

  function edgeNoise(seed) {
    const rnd = mulberry32(seed || 1);
    const raw = Array.from({ length: 360 }, () => rnd());
    return smoothCircular(raw, 3);
  }

  function noiseCanvas(size, seed) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    const rnd = mulberry32(seed || 1);
    const img = ctx.createImageData(size, size);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.round(rnd() * 255);
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  function drawArcText(ctx, text, cx, cy, radius, fontPx, startDeg, spanDeg, weight, fontFamily, inward, maxCellPx, strokePx, jitterSeed, jitterScale, fix) {
    const chars = Array.from(text);
    if (!chars.length) return;
    const rnd = jitterSeed ? mulberry32(jitterSeed) : null;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const dir = spanDeg < 0 ? -1 : 1;
    const absSpan = Math.abs(spanDeg);
    const arcLen = Math.abs(radius * (absSpan * Math.PI) / 180);
    ctx.font = `${weight || 700} ${fontPx}px ${fontFamily || FONT_SONG}`;
    // cells 由 nameLayout 按每个字的墨迹宽度算好：括号只占自己的墨宽，
    // 每个字还可以有独立的横向比例和墨心偏移。没给才退回按字身宽均分。
    let widths, sxs, dxs, gapList, cursor;
    if (fix && fix.cells) {
      widths = fix.cells.map((c) => c.w);
      sxs = fix.cells.map((c) => (c.sx == null ? 1 : c.sx));
      dxs = fix.cells.map((c) => c.dx || 0);
      gapList = fix.gaps || [];
      const total = widths.reduce((a, w, i) => a + w * sxs[i], 0)
        + gapList.reduce((a, b) => a + b, 0);
      cursor = Math.max(0, (arcLen - total) / 2);
    } else {
      let totalRaw = chars.reduce((a, c) => a + (ctx.measureText(c).width || fontPx), 0) || 1;
      // fix 给了横向比例和字距就按它排（排版算法在 nameLayout 里统一算）；没给才自己均分
      const sx = fix && fix.sx != null ? fix.sx : 1;
      let gapPx;
      if (fix && fix.gapPx != null) {
        gapPx = fix.gapPx;
      } else {
        const target = arcLen * 0.97;
        if (totalRaw > target) {
          fontPx *= target / totalRaw;
          ctx.font = `${weight || 700} ${fontPx}px ${fontFamily || FONT_SONG}`;
          totalRaw = chars.reduce((a, c) => a + (ctx.measureText(c).width || fontPx), 0) || 1;
        }
        gapPx = chars.length > 1 ? Math.max(0, (arcLen - totalRaw) / (chars.length - 1)) : 0;
      }
      widths = chars.map((c) => ctx.measureText(c).width || fontPx);
      sxs = chars.map(() => sx);
      dxs = chars.map(() => 0);
      gapList = chars.map(() => gapPx);
      cursor = fix ? Math.max(0, (arcLen - (widths.reduce((a, w, i) => a + w * sxs[i], 0)
        + gapPx * (chars.length - 1))) / 2) : 0;
    }
    for (let i = 0; i < chars.length; i++) {
      const wEff = widths[i] * sxs[i];
      const centerArc = cursor + wEff / 2;
      cursor += wEff + (gapList[i] || 0);
      let aDeg = startDeg + dir * ((centerArc / radius) * 180) / Math.PI;
      let radiusPx = radius;
      if (rnd && jitterScale) {
        aDeg += (rnd() - 0.5) * 0.9 * jitterScale;
        radiusPx += (rnd() - 0.5) * fontPx * 0.05 * jitterScale;
      }
      const a = (aDeg * Math.PI) / 180;
      const x = cx + Math.cos(a) * radiusPx;
      const y = cy - Math.sin(a) * radiusPx;
      const rot = inward ? (270 - aDeg) : (90 - aDeg);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate((rot * Math.PI) / 180);
      if (sxs[i] !== 1) ctx.scale(sxs[i], 1);
      // 墨心对齐字格中心：全角括号在字身框里偏右/偏左，抵掉偏移才不会挤到一侧
      ctx.fillText(chars[i], -dxs[i], 0);
      if (strokePx > 0) {
        ctx.lineWidth = strokePx;
        ctx.lineJoin = 'round';
        ctx.strokeStyle = ctx.fillStyle;   // 描边跟着墨色，别用画布默认黑
        ctx.strokeText(chars[i], -dxs[i], 0);
      }
      ctx.restore();
    }
    ctx.restore();
  }

  function drawStar(ctx, cx, cy, widthMm, scale, seed, jitterScale) {
    const R = (widthMm / 2) / Math.sin((72 * Math.PI) / 180);
    const r = R * 0.381966;
    const rnd = seed ? mulberry32(seed) : null;
    ctx.save();
    ctx.translate(cx, cy);
    if (rnd && jitterScale) ctx.rotate((rnd() - 0.5) * 0.03 * jitterScale);
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (-90 + i * 36) * (Math.PI / 180);
      let rad = i % 2 === 0 ? R : r;
      if (rnd && jitterScale) rad *= 1 + (rnd() - 0.5) * 0.05 * jitterScale;
      const x = Math.cos(a) * rad * scale;
      const y = Math.sin(a) * rad * scale;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function applyTexture(ctx, size, strength, seed) {
    if (strength <= 0) return;
    const low = noiseCanvas(48, seed + 11);
    const mid = noiseCanvas(220, seed + 23);
    const big = noiseCanvas(90, seed + 51);
    const lowCtx = low.getContext('2d');
    const midCtx = mid.getContext('2d');
    const bigCtx = big.getContext('2d');
    const lowData = lowCtx.getImageData(0, 0, low.width, low.height).data;
    const midData = midCtx.getImageData(0, 0, mid.width, mid.height).data;
    const bigData = bigCtx.getImageData(0, 0, big.width, big.height).data;

    // 把低/中频噪声放大到画布尺寸，双线性取样
    function sampleLow(x, y) {
      const fx = (x / size) * (low.width - 1);
      const fy = (y / size) * (low.height - 1);
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const x1 = Math.min(x0 + 1, low.width - 1), y1 = Math.min(y0 + 1, low.height - 1);
      const tx = fx - x0, ty = fy - y0;
      const v00 = lowData[(y0 * low.width + x0) * 4] / 255;
      const v10 = lowData[(y0 * low.width + x1) * 4] / 255;
      const v01 = lowData[(y1 * low.width + x0) * 4] / 255;
      const v11 = lowData[(y1 * low.width + x1) * 4] / 255;
      return (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty;
    }
    function sampleMid(x, y) {
      const fx = (x / size) * (mid.width - 1);
      const fy = (y / size) * (mid.height - 1);
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const x1 = Math.min(x0 + 1, mid.width - 1), y1 = Math.min(y0 + 1, mid.height - 1);
      const tx = fx - x0, ty = fy - y0;
      const v00 = midData[(y0 * mid.width + x0) * 4] / 255;
      const v10 = midData[(y0 * mid.width + x1) * 4] / 255;
      const v01 = midData[(y1 * mid.width + x0) * 4] / 255;
      const v11 = midData[(y1 * mid.width + x1) * 4] / 255;
      return (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty;
    }
    function sampleBig(x, y) {
      const fx = (x / size) * (big.width - 1);
      const fy = (y / size) * (big.height - 1);
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const x1 = Math.min(x0 + 1, big.width - 1), y1 = Math.min(y0 + 1, big.height - 1);
      const tx = fx - x0, ty = fy - y0;
      const v00 = bigData[(y0 * big.width + x0) * 4] / 255;
      const v10 = bigData[(y0 * big.width + x1) * 4] / 255;
      const v01 = bigData[(y1 * big.width + x0) * 4] / 255;
      const v11 = bigData[(y1 * big.width + x1) * 4] / 255;
      return (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty;
    }

    const rnd = mulberry32(seed + 37);
    const img = ctx.getImageData(0, 0, size, size);
    const d = img.data;
    const lowAmt = 0.28 * strength;
    const grainAmt = 0.10 * strength;
    const dryAmt = 0.55 * strength;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        let a = d[i + 3] / 255;
        if (a < 0.004) continue;
        const pressure = 1 - lowAmt + lowAmt * 2 * sampleLow(x, y);
        const grain = 1 - grainAmt + grainAmt * 2 * rnd();
        let next = a * pressure * grain;
        const m = sampleMid(x, y);
        if (m < 0.16 && a < 0.97) {
          const k = 1 - (0.16 - m) / 0.16;
          next *= 1 - dryAmt * k;
        }
        const b = sampleBig(x, y);
        if (b < 0.045 && next > 0.55) next *= 0.55;
        next = Math.max(0, Math.min(1, next));
        d[i + 3] = Math.round(next * 255);
      }
    }
    ctx.putImageData(img, 0, 0);

    // 高强度时把边缘打成硬边，模拟印泥压在纸上的断墨
    if (strength >= 0.6) {
      const hard = ctx.getImageData(0, 0, size, size);
      const hd = hard.data;
      const rnd2 = mulberry32(seed + 91);
      for (let i = 0; i < hd.length; i += 4) {
        const a = hd[i + 3] / 255;
        if (a < 0.02) continue;
        const n = rnd2();
        const v = (a - 0.44 + (n - 0.5) * 0.5) / 0.30;
        const out = Math.max(0, Math.min(1, v));
        hd[i + 3] = Math.round(out * 255);
      }
      ctx.putImageData(hard, 0, 0);
    }

    // 硬边之后再做一次轻微墨洇，避免像纯二值图
    try {
      const tmp = document.createElement('canvas');
      tmp.width = tmp.height = size;
      const tctx = tmp.getContext('2d');
      tctx.filter = 'blur(0.45px)';
      tctx.drawImage(ctx.canvas, 0, 0);
      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(tmp, 0, 0);
    } catch (e) { /* 忽略 */ }
  }


  function makeSampler(c, size) {
    const w = c.width, h = c.height;
    const data = c.getContext('2d').getImageData(0, 0, w, h).data;
    return function (x, y) {
      const fx = Math.min(w - 1.001, Math.max(0, (x / size) * w));
      const fy = Math.min(h - 1.001, Math.max(0, (y / size) * h));
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const x1 = Math.min(x0 + 1, w - 1), y1 = Math.min(y0 + 1, h - 1);
      const tx = fx - x0, ty = fy - y0;
      const v00 = data[(y0 * w + x0) * 4] / 255;
      const v10 = data[(y0 * w + x1) * 4] / 255;
      const v01 = data[(y1 * w + x0) * 4] / 255;
      const v11 = data[(y1 * w + x1) * 4] / 255;
      return (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty;
    };
  }


  function extractSmooth(e0, e1, v) {
    const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  }

  function renderExtract(canvas, o) {
    const N = Math.round(o.px || SIZE);
    const s = N / 1000;
    const srcN = Math.max(320, Math.round(N * 0.9));
    const base = document.createElement('canvas');
    render(base, Object.assign({}, o, {
      px: srcN,
      fresh: false,
      scan: false,
      texture: 0,
      specks: 0,
      nicks: 0,
      edgeAmp: 0.012,
      nameWeight: 400,
      nameStroke: 0.015,
      jitter: 0,
      color: o.color || '#DA251D',
      rotation: (o.tilt !== undefined ? o.tilt : 0),
      codeSoft: 1.15,
      codeStrokeMm: o.codeStrokeMm != null ? o.codeStrokeMm : 0.20,
      codeWeight: o.codeWeight != null ? o.codeWeight : 500,
      codeBurr: o.codeBurr != null ? o.codeBurr : 1.6
    }));

    // 扫描光学：轻微失焦，二值化后留下 1px 级别的台阶
    const bl = document.createElement('canvas');
    bl.width = bl.height = srcN;
    const bctx = bl.getContext('2d');
    try { bctx.filter = 'blur(' + (0.6 * srcN / 1000) + 'px)'; } catch (e) { /* 忽略 */ }
    bctx.drawImage(base, 0, 0);
    bctx.filter = 'none';
    const sd = bctx.getImageData(0, 0, srcN, srcN).data;

    const seed = o.seed || 7;
    const nPressure = makeSampler(noiseCanvas(7, seed + 37), N);
    const nCodeDrop = makeSampler(noiseCanvas(120, seed + 733), N);
    const nFiber = makeSampler(noiseCanvas(96, seed + 23), N);
    const nFine = makeSampler(noiseCanvas(24, seed + 41), N);
    const nBlotch = makeSampler(noiseCanvas(9, seed + 29), N);
    const nRim = makeSampler(noiseCanvas(24, seed + 53), N);
    const nBlotch2 = makeSampler(noiseCanvas(34, seed + 61), N);
    // 边线整段偏淡：用 5 格低频场挑出圆周上的一段，段内压墨，段外不动
    const nRimPatch = makeSampler(noiseCanvas(5, seed + 67), N);
    // 残边分区：真实扫描的残边不是整圈均匀撒，而是几处为主、其余干净
    const nRimZone = makeSampler(noiseCanvas(6, seed + 69), N);
    // 避开编码段（225-315）：那一段的边线要留实，不然数字贴边会显脏
    let rimPatchC = (seed * 37) % 360;
    if (rimPatchC > 205 && rimPatchC < 335) rimPatchC = (rimPatchC + 96) % 360;
    const rimPatchSpan = 62 + (seed % 5) * 11;   // 62-106 度

    const out = document.createElement('canvas');
    out.width = out.height = N;
    const ctx = out.getContext('2d');
    const img = ctx.createImageData(N, N);
    const d = img.data;

    const half = N / 2;
    const mm = (N / 1000) * PXMM;
    const Rmm = o.diameter / 2;
    const codeR0 = Rmm - o.border - 0.6 - o.codeSize - 0.5;
    const codeR1 = Rmm - o.border + 0.2;
    const nameR0 = Rmm - o.border - o.nameSize - 1.4;
    const nameR1 = Rmm - o.border - 0.3;
    const thinCenter = 138 + ((seed * 3) % 8);
    const thinSpan = 36;
    const scale = srcN / N;
    const THR = 0.47;
    // 墨色跟随用户选的标准色，不能再写死纯红
    const hexE = /^#?([0-9a-f]{6})$/i.exec(o.color || '#DA251D');
    const ER = hexE ? parseInt(hexE[1].slice(0, 2), 16) : 218;
    const EG = hexE ? parseInt(hexE[1].slice(2, 4), 16) : 37;
    const EB = hexE ? parseInt(hexE[1].slice(4, 6), 16) : 29;

    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const sx = Math.min(srcN - 1, Math.round(x * scale));
        const sy = Math.min(srcN - 1, Math.round(y * scale));
        const a = sd[(sy * srcN + sx) * 4 + 3] / 255;
        if (a <= 0.004) continue;
        const dx = x - half, dy = y - half;
        const rr = Math.sqrt(dx * dx + dy * dy) / mm;
        const ang = (Math.atan2(-dy, dx) * 180 / Math.PI + 360) % 360;
        const inCode = !!o.code && rr >= codeR0 && rr <= codeR1 && ang > 225 && ang < 315;

        // 轮廓权重：只在半透明过渡带起作用，实心内部不受影响
        const edgeW = 1 - extractSmooth(0.28, 0.88, a);
        let sig = a;
        // 编码逐位墨量：真实盖章 13 位数字不会个个一样实，常见某几位偏淡，
        // 细笔画直接被阈值吃掉断成两截。这是「丢帧」的主要来源。
        if (inCode) {
          const cd = Array.from(o.code).length;
          const stepDeg2 = (2.0 / (Rmm - o.border - 0.6 - o.codeSize / 2)) * (180 / Math.PI);
          const cIdx = Math.round((ang - 270) / stepDeg2 + (cd - 1) / 2);
          if (cIdx >= 0 && cIdx < cd) {
            const r1 = Math.sin((cIdx + 1) * 12.9898 + seed * 78.233) * 43758.5453;
            const fr = r1 - Math.floor(r1);
            sig *= 0.58 + 0.42 * fr;                     // 0.58-1.00，个别位明显偏淡
            // 成块掉墨：真实扫描件把浅墨整块吃掉，边界是硬的，
            // 不是均匀毛边。只吃笔画外缘（edgeW 大的地方），
            // 中间实心不动，否则一咬就把数字咬断。
            const dr = nCodeDrop(x * 1.6, y * 1.6);
            if (dr > 0.82 && edgeW > 0.25) sig *= 0.10;
          }
        }
        {
          const press = nPressure(x, y);
          const fiber = nFiber(x, y);
          const fine = nFine(x, y);
          // 编码数字也要有失墨毛边，否则它比周围干净一档，看着像后期贴上去的。
          // 数字笔画只有 0.3mm 宽，扰动给一半，保字形骨架。
          // 编码是 1.35mm 的小字，纸上本来就糊：边缘扰动给到和名称同档，
          // 再加一道低频「墨没吃透」，让整位数字的发虚程度不一样
          // 编码毛刺：纸上小数字是印泥挤出来的，边比名称糙得多，单独一档
          const k = inCode ? (o.codeBurr || 0.95) : 1;
          sig *= 1 + 0.22 * k * (press - 0.5) * 2 * edgeW;
          sig *= 1 + 0.30 * k * (fiber - 0.5) * 2 * edgeW;
          sig *= 1 + 0.10 * k * (fine - 0.5) * 2 * edgeW;
          if (inCode) sig *= 1 - 0.16 * Math.max(0, nBlotch2(x * 0.9, y * 0.9) - 0.45) / 0.55;
          // 高频细齿：只咬边缘，让数字外轮廓出小豁口，像印泥被纸纤维挂掉
          if (inCode && edgeW > 0.15) {
            const burr = nFine(x * 2.7, y * 2.7) - 0.5;
            sig *= 1 + 0.70 * burr * edgeW;
          }
          sig *= 1 + 0.04 * (press - 0.5) * 2 * (1 - edgeW) * a;
          // 上弧一段：文字边缘额外失墨，外圈不动
          const dAng = Math.abs(((ang - thinCenter + 540) % 360) - 180);
          if (rr >= nameR0 && rr <= nameR1 && dAng < thinSpan / 2) {
            sig *= 1 - 0.30 * edgeW * Math.cos((dAng / (thinSpan / 2)) * Math.PI / 2);
          }
          // 边线一片涂色不均：真实盖章不是整圈等距缺点，而是某一段边线印泥
          // 没吃匀，整片变薄、发虚、局部断开。做法是在这一段里把边线内缘往
          // 外吃（等效变窄），再叠一层低频决定哪里真的断。段的起止用余弦渐变，
          // 不出现刀切一样的边界。
          if (rr >= Rmm - o.border - 0.6 && rr <= Rmm + 0.4) {
            const dRim = Math.abs(((ang - rimPatchC + 540) % 360) - 180);
            if (dRim < rimPatchSpan / 2) {
              const w = 0.5 + 0.5 * Math.cos((dRim / (rimPatchSpan / 2)) * Math.PI);
              const lo = nRimPatch(x * 0.42, y * 0.42);    // 0-1 低频，决定这一段薄厚走向
              const mid = nBlotch2(x * 1.0, y * 1.0);      // 中频：内缘起伏，不要用高频，会变锯齿
              // 内缘整体往外挪，线宽由 1.2mm 一路收到 0.3mm 左右；
              // 内缘按中频起伏，读起来是印泥往内缩、边缘发虚。
              const eff = o.border * Math.max(0.22, 1 - 0.80 * w * (0.30 + 0.80 * lo));
              const inner = Rmm - eff + (mid - 0.5) * w * o.border * 0.55;
              // 软斜坡而不是硬切：让 alpha 在 0.3mm 里线性降到 0，
              // 阈值穿过时边界跟斜坡走，不会出现一刀切的直边
              if (rr < inner + 0.30) {
                const ramp = Math.max(0, Math.min(1, (rr - inner) / 0.30));
                sig *= ramp;
              }
              // 只在最薄的地方真的断开一两处，位置跟着 lo 走，不是均匀撒
              if (lo > 0.84 && mid < 0.30 && w > 0.55) sig = 0;
            }
          }
        }
        const thr = THR;
        // 墨色密度：低频深浅，让红色像印上去的墨，而不是平涂
        let dens = 1;
        {
          const b1 = nBlotch(x * 0.55, y * 0.55);
          const b2 = nBlotch2(x * 1.5, y * 1.5);
          const b3 = nFine(x * 2.7, y * 2.7);
          const k = inCode ? 0.7 : 1;
          dens = 1 - k * (0.10 * Math.max(0, b1 - 0.52) / 0.48
                        + 0.10 * Math.max(0, b2 - 0.52) / 0.48
                        + 0.05 * Math.max(0, b3 - 0.52) / 0.48);
          if (inCode) {
            // 编码数字比名称更容易被印泥吃掉：整位偏淡、个别笔画发虚，
            // 读起来才像扫描件而不是贴上去的字。低频场让它成片变淡，
            // 不是每一位均匀降一档。基础再压 8%，1.35mm 的小字在纸上
            // 本来就没有名称那么实。
            dens *= 0.92;
            dens *= 1 - 0.52 * Math.max(0, b1 - 0.30) / 0.70;
          }
        }
        const i = (y * N + x) * 4;
        const on = sig > thr;
        // 密度只压明度，色相保持（印泥吃墨变浅是往纸色走，不是变黄）。
        // dens 出现 NaN 时 Uint8ClampedArray 会吞成 0，落成纯黑点，先兜住。
        const dd = Number.isFinite(dens) ? Math.max(0, Math.min(1, dens)) : 1;
        d[i] = on ? Math.round(Math.min(255, ER + (255 - ER) * (1 - dd) * 0.55)) : 0;
        d[i + 1] = on ? Math.round(Math.min(255, EG + (255 - EG) * (1 - dd) * 0.75)) : 0;
        d[i + 2] = on ? Math.round(Math.min(255, EB + (255 - EB) * (1 - dd) * 0.75)) : 0;
        d[i + 3] = on ? 255 : 0;
      }
    }

    const bin = new Uint8Array(N * N);
    for (let i = 0, j = 3; i < bin.length; i++, j += 4) bin[i] = d[j] > 127 ? 1 : 0;
    const seen = new Uint8Array(N * N);
    const stack = new Int32Array(N * N);

    // 识别清噪：去掉零星墨点
    const minSpeck = Math.max(3, Math.round(4 * s * s));
    for (let p0 = 0; p0 < bin.length; p0++) {
      if (!bin[p0] || seen[p0]) continue;
      let top = 0;
      stack[top++] = p0;
      seen[p0] = 1;
      const comp = [];
      while (top) {
        const p = stack[--top];
        comp.push(p);
        const x = p % N, y = (p / N) | 0;
        if (x > 0 && bin[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack[top++] = p - 1; }
        if (x < N - 1 && bin[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack[top++] = p + 1; }
        if (y > 0 && bin[p - N] && !seen[p - N]) { seen[p - N] = 1; stack[top++] = p - N; }
        if (y < N - 1 && bin[p + N] && !seen[p + N]) { seen[p + N] = 1; stack[top++] = p + N; }
      }
      if (comp.length < minSpeck) for (let k = 0; k < comp.length; k++) bin[comp[k]] = 0;
    }

    // 识别填孔：补掉针孔，字的封闭内腔（口、0 等）面积大，不受影响
    const bg = new Uint8Array(N * N);
    let head = 0, tail = 0;
    for (let x = 0; x < N; x++) {
      const b = x, t = (N - 1) * N + x;
      if (!bin[b] && !bg[b]) { bg[b] = 1; stack[tail++] = b; }
      if (!bin[t] && !bg[t]) { bg[t] = 1; stack[tail++] = t; }
    }
    for (let y = 0; y < N; y++) {
      const l = y * N, r = y * N + N - 1;
      if (!bin[l] && !bg[l]) { bg[l] = 1; stack[tail++] = l; }
      if (!bin[r] && !bg[r]) { bg[r] = 1; stack[tail++] = r; }
    }
    while (head < tail) {
      const p = stack[head++];
      const x = p % N, y = (p / N) | 0;
      if (x > 0 && !bin[p - 1] && !bg[p - 1]) { bg[p - 1] = 1; stack[tail++] = p - 1; }
      if (x < N - 1 && !bin[p + 1] && !bg[p + 1]) { bg[p + 1] = 1; stack[tail++] = p + 1; }
      if (y > 0 && !bin[p - N] && !bg[p - N]) { bg[p - N] = 1; stack[tail++] = p - N; }
      if (y < N - 1 && !bin[p + N] && !bg[p + N]) { bg[p + N] = 1; stack[tail++] = p + N; }
    }
    const holeSeen = new Uint8Array(N * N);
    const maxHole = Math.max(6, Math.round(16 * s * s));
    for (let p0 = 0; p0 < bin.length; p0++) {
      if (bin[p0] || bg[p0] || holeSeen[p0]) continue;
      let top = 0;
      stack[top++] = p0;
      holeSeen[p0] = 1;
      const comp = [];
      while (top) {
        const p = stack[--top];
        comp.push(p);
        const x = p % N, y = (p / N) | 0;
        if (x > 0 && !bin[p - 1] && !bg[p - 1] && !holeSeen[p - 1]) { holeSeen[p - 1] = 1; stack[top++] = p - 1; }
        if (x < N - 1 && !bin[p + 1] && !bg[p + 1] && !holeSeen[p + 1]) { holeSeen[p + 1] = 1; stack[top++] = p + 1; }
        if (y > 0 && !bin[p - N] && !bg[p - N] && !holeSeen[p - N]) { holeSeen[p - N] = 1; stack[top++] = p - N; }
        if (y < N - 1 && !bin[p + N] && !bg[p + N] && !holeSeen[p + N]) { holeSeen[p + N] = 1; stack[top++] = p + N; }
      }
      if (comp.length <= maxHole) for (let k = 0; k < comp.length; k++) bin[comp[k]] = 1;
    }

    // ── 实盖扫描：压力不均缺墨 ──────────────────────────────────────
    // 手持盖章一侧受力轻，那一侧印泥转移不足；高对比二值化把浅墨整片吃掉。
    // 所以缺口集中在低压侧、从笔画边缘往内缩，不是满章均匀撒孔（那读着像噪点）。
    const voidMask = new Uint8Array(N * N);
    let voidDil = null;
    let voidApplied = 0;
    if (o.voids !== false && o.fresh !== false) {
      const voidK = o.voidStrength === undefined ? 0.78 : +o.voidStrength;
      // 1) 墨内深度：能扛住几次 4 邻域腐蚀（0 = 边缘一圈）
      const dep = new Uint8Array(N * N);
      let cur = new Uint8Array(bin);
      for (let step = 1; step <= 5; step++) {
        const nxt = new Uint8Array(N * N);
        let any = 0;
        for (let y = 1; y < N - 1; y++) {
          const row = y * N;
          for (let x = 1; x < N - 1; x++) {
            const p = row + x;
            if (cur[p] && cur[p - 1] && cur[p + 1] && cur[p - N] && cur[p + N]) { nxt[p] = 1; any++; }
          }
        }
        for (let p = 0; p < nxt.length; p++) if (nxt[p]) dep[p] = step;
        cur = nxt;
        if (!any) break;
      }

      // 2) 压力场：方向梯度 + 两块低频，压得轻的那侧整体偏虚
      const nVoidA = makeSampler(noiseCanvas(48, seed + 71), N);
      const nVoidB = makeSampler(noiseCanvas(18, seed + 73), N);
      const th = -38 * Math.PI / 180;
      const cosT = Math.cos(th), sinT = Math.sin(th);
      const nzGate = (pv) => 0.44 + 0.44 * pv;
      const noiseAt = (sa, sb, x, y) => 0.55 * sa(x, y) + 0.45 * sb(x, y);

      for (let y = 0; y < N; y++) {
        const row = y * N;
        const yy = y - half;
        for (let x = 0; x < N; x++) {
          const p = row + x;
          if (!bin[p]) continue;
          const d0 = dep[p];
          if (d0 > 5) continue;
          const xx = x - half;
          let g = 0.5 + 0.5 * (xx * cosT + yy * sinT) / half;
          if (g < 0) g = 0; else if (g > 1) g = 1;
          let pv = 0.45 * g + 0.33 * nBlotch(x * 0.55, y * 0.55) + 0.22 * nBlotch2(x * 1.5, y * 1.5);
          pv = (pv - 0.5) * 0.9 + 0.5;
          if (pv < 0) pv = 0; else if (pv > 1) pv = 1;
          const allowV = Math.max(0, Math.min(1, (0.58 - pv) / 0.31));
          const lim = 1 + allowV * 3.2 * voidK;
          if (d0 > lim) continue;
          if (nzGate(pv) > noiseAt(nVoidA, nVoidB, x, y)) continue;

          const rr = Math.sqrt(xx * xx + yy * yy) / mm;
          if (rr > 19.3 && d0 > 2) continue;               // 外环最多 2px，保闭合
          if (rr >= codeR0 && rr <= codeR1) {
            const ang2 = (Math.atan2(-yy, xx) * 180 / Math.PI + 360) % 360;
            if (ang2 > 225 && ang2 < 315) {
              // 编码数字也要掉墨，但要保字形：最多吃 2px 深，压力得低。
              // 数字笔画只有约 0.3mm（7px），吃深了就断成两截、认不出来。
              if (d0 > 3) continue;
              if (pv > 0.44) continue;
              if (noiseAt(nVoidA, nVoidB, x, y) < 0.44) continue;
              // 桥点保护：上下都实、左右都空（或反之）的像素是笔画最细处，
              // 吃掉它就把一个数字切成两块，扫描件里极少出现，OCR 也会读错。
              const up = bin[(y - 1) * N + x], dn = bin[(y + 1) * N + x];
              const lf = bin[y * N + x - 1], rt = bin[y * N + x + 1];
              if ((up && dn && !lf && !rt) || (lf && rt && !up && !dn)) continue;
            }
          }
          voidMask[p] = 1;
          voidApplied++;
        }
      }

      // 3) 每个字块最多吃 22%：真实缺墨不会把单字啃没
      const lab = new Int32Array(N * N);
      lab.fill(-1);
      const comps = [];
      for (let p0 = 0; p0 < bin.length; p0++) {
        if (!bin[p0] || lab[p0] >= 0) continue;
        const id = comps.length;
        let top = 0;
        stack[top++] = p0;
        lab[p0] = id;
        const arr = [];
        while (top) {
          const p = stack[--top];
          arr.push(p);
          const x = p % N, y = (p / N) | 0;
          if (x > 0 && bin[p - 1] && lab[p - 1] < 0) { lab[p - 1] = id; stack[top++] = p - 1; }
          if (x < N - 1 && bin[p + 1] && lab[p + 1] < 0) { lab[p + 1] = id; stack[top++] = p + 1; }
          if (y > 0 && bin[p - N] && lab[p - N] < 0) { lab[p - N] = id; stack[top++] = p - N; }
          if (y < N - 1 && bin[p + N] && lab[p + N] < 0) { lab[p + N] = id; stack[top++] = p + N; }
        }
        comps.push(arr);
      }
      const codeComps = [];
      for (let ci = 0; ci < comps.length; ci++) {
        const arr = comps[ci];
        let cnt = 0;
        let inCodeComp = 0;
        for (let k = 0; k < arr.length; k++) {
          if (voidMask[arr[k]]) cnt++;
          const px = arr[k] % N, py = (arr[k] / N) | 0;
          const dx2 = px - half, dy2 = py - half;
          const rr2 = Math.sqrt(dx2 * dx2 + dy2 * dy2) / mm;
          if (rr2 >= codeR0 && rr2 <= codeR1) {
            const a2 = (Math.atan2(-dy2, dx2) * 180 / Math.PI + 360) % 360;
            if (a2 > 225 && a2 < 315) inCodeComp++;
          }
        }
        // 编码数字笔画骨架细，吃太多就认不出：单字上限收到 16%
        const isCodeComp = inCodeComp > arr.length * 0.5;
        if (isCodeComp) codeComps.push(ci);
        const cap = Math.floor(arr.length * (isCodeComp ? 0.16 : 0.18));
        if (cnt <= cap) continue;
        const idx = [];
        for (let k = 0; k < arr.length; k++) if (voidMask[arr[k]]) idx.push(arr[k]);
        idx.sort((a, b) => noiseAt(nVoidA, nVoidB, b % N, (b / N) | 0)
                          - noiseAt(nVoidA, nVoidB, a % N, (a / N) | 0));
        for (let k = cap; k < idx.length; k++) voidMask[idx[k]] = 0;
      }

      // 3b) 编码数字的连通性：允许断成两块（真扫件里的数字常有断笔，
      // 也是「丢帧」感的一部分），但不许碎成渣，也不许只剩一小片。
      if (codeComps.length) {
        const lab2 = new Int32Array(N * N);
        const q = new Int32Array(N * N);
        for (let qi = 0; qi < codeComps.length; qi++) {
          const arr = comps[codeComps[qi]];
          let nVoid = 0;
          for (let k = 0; k < arr.length; k++) if (voidMask[arr[k]]) nVoid++;
          if (!nVoid) continue;
          lab2.fill(-1);
          const sizes = [];
          let head = 0, tail = 0;
          for (let k = 0; k < arr.length; k++) {
            const p0 = arr[k];
            if (voidMask[p0] || lab2[p0] >= 0) continue;
            const id = sizes.length;
            sizes.push(0);
            lab2[p0] = id;
            q[tail++] = p0;
            while (head < tail) {
              const p1 = q[head++];
              sizes[id]++;
              const x1 = p1 % N, y1 = (p1 / N) | 0;
              if (x1 > 0 && bin[p1 - 1] && !voidMask[p1 - 1] && lab2[p1 - 1] < 0) { lab2[p1 - 1] = id; q[tail++] = p1 - 1; }
              if (x1 < N - 1 && bin[p1 + 1] && !voidMask[p1 + 1] && lab2[p1 + 1] < 0) { lab2[p1 + 1] = id; q[tail++] = p1 + 1; }
              if (y1 > 0 && bin[p1 - N] && !voidMask[p1 - N] && lab2[p1 - N] < 0) { lab2[p1 - N] = id; q[tail++] = p1 - N; }
              if (y1 < N - 1 && bin[p1 + N] && !voidMask[p1 + N] && lab2[p1 + N] < 0) { lab2[p1 + N] = id; q[tail++] = p1 + N; }
            }
          }
          const total = sizes.reduce((a, b) => a + b, 0);
          const big = sizes.slice().sort((a, b) => b - a);
          const broken = sizes.length > 2 || (sizes.length === 2 && big[1] < total * 0.18);
          // 字内空洞数不许变：0 和 8 的圈破了就会被读成别的数字。
          // 这是比墨量更硬的判据，掉墨再多也不能把圈吃开。
          let holeChanged = false;
          if (!broken) {
            let x0 = N, y0 = N, x1 = -1, y1 = -1;
            for (let k = 0; k < arr.length; k++) {
              const px = arr[k] % N, py = (arr[k] / N) | 0;
              if (px < x0) x0 = px;
              if (px > x1) x1 = px;
              if (py < y0) y0 = py;
              if (py > y1) y1 = py;
            }
            x0 -= 2; y0 -= 2; x1 += 2; y1 += 2;
            if (x0 < 0) x0 = 0;
            if (y0 < 0) y0 = 0;
            if (x1 > N - 1) x1 = N - 1;
            if (y1 > N - 1) y1 = N - 1;
            const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
            const countHoles = (useVoid) => {
              const g = new Uint8Array((bw + 2) * (bh + 2));
              for (let y = 0; y < bh; y++) {
                for (let x = 0; x < bw; x++) {
                  const sp = (y + y0) * N + (x + x0);
                  const solid = bin[sp] && !(useVoid && voidMask[sp]);
                  g[(y + 1) * (bw + 2) + (x + 1)] = solid ? 1 : 0;
                }
              }
              const vis = new Uint8Array((bw + 2) * (bh + 2));
              const st = [0];
              vis[0] = 1;
              while (st.length) {
                const q2 = st.pop();
                const qy = (q2 / (bw + 2)) | 0, qx = q2 % (bw + 2);
                if (qy > 0 && !g[q2 - (bw + 2)] && !vis[q2 - (bw + 2)]) { vis[q2 - (bw + 2)] = 1; st.push(q2 - (bw + 2)); }
                if (qy < bh + 1 && !g[q2 + (bw + 2)] && !vis[q2 + (bw + 2)]) { vis[q2 + (bw + 2)] = 1; st.push(q2 + (bw + 2)); }
                if (qx > 0 && !g[q2 - 1] && !vis[q2 - 1]) { vis[q2 - 1] = 1; st.push(q2 - 1); }
                if (qx < bw + 1 && !g[q2 + 1] && !vis[q2 + 1]) { vis[q2 + 1] = 1; st.push(q2 + 1); }
              }
              let holes = 0;
              for (let q3 = 0; q3 < g.length; q3++) {
                if (g[q3] || vis[q3]) continue;
                holes++;
                const st2 = [q3];
                vis[q3] = 1;
                while (st2.length) {
                  const q4 = st2.pop();
                  const qy = (q4 / (bw + 2)) | 0, qx = q4 % (bw + 2);
                  if (qy > 0 && !g[q4 - (bw + 2)] && !vis[q4 - (bw + 2)]) { vis[q4 - (bw + 2)] = 1; st2.push(q4 - (bw + 2)); }
                  if (qy < bh + 1 && !g[q4 + (bw + 2)] && !vis[q4 + (bw + 2)]) { vis[q4 + (bw + 2)] = 1; st2.push(q4 + (bw + 2)); }
                  if (qx > 0 && !g[q4 - 1] && !vis[q4 - 1]) { vis[q4 - 1] = 1; st2.push(q4 - 1); }
                  if (qx < bw + 1 && !g[q4 + 1] && !vis[q4 + 1]) { vis[q4 + 1] = 1; st2.push(q4 + 1); }
                }
              }
              return holes;
            };
            holeChanged = countHoles(false) !== countHoles(true);
          }
          if (broken || holeChanged) {
            for (let k = 0; k < arr.length; k++) voidMask[arr[k]] = 0;
          }
        }
      }

      // 4) 膨胀 4px：残边会落进孔里，算残边时要避开这一圈
      const grown = new Uint8Array(N * N);
      for (let y = 0; y < N; y++) {
        const row = y * N;
        for (let x = 0; x < N; x++) {
          if (!voidMask[row + x]) continue;
          for (let dy = -4; dy <= 4; dy++) {
            const ny2 = y + dy;
            if (ny2 < 0 || ny2 >= N) continue;
            for (let dx = -4; dx <= 4; dx++) {
              const nx2 = x + dx;
              if (nx2 < 0 || nx2 >= N) continue;
              grown[ny2 * N + nx2] = 1;
            }
          }
        }
      }
      voidDil = grown;
    }

    for (let i = 0, j = 0; i < bin.length; i++, j += 4) {
      const ink = bin[i] && !voidMask[i];
      d[j + 3] = ink ? 255 : 0;
      if (!ink) { d[j] = 0; d[j + 1] = 0; d[j + 2] = 0; }
      // 补孔那一步只把 bin 置 1，这些像素原本没写过墨色，RGB 还是 0；
      // 直接输出就是笔画里的纯黑点（3、8 的内孔最容易看出来），补上所选墨色
      else if (!d[j] && !d[j + 1] && !d[j + 2]) {
        d[j] = ER; d[j + 1] = EG; d[j + 2] = EB;
      }
    }
    ctx.putImageData(img, 0, 0);

    // 阈值残边：从墨迹边缘向外按距离给 1 到 3px 的断续残边，噪声决定段落有无
    const dist = new Int16Array(N * N);
    dist.fill(-1);
    let dhead = 0, dtail = 0;
    for (let p = 0; p < bin.length; p++) {
      if (bin[p] && !voidMask[p]) { dist[p] = 0; stack[dtail++] = p; }
    }
    while (dhead < dtail) {
      const p = stack[dhead++];
      const dcur = dist[p];
      if (dcur >= 4) continue;
      const x = p % N, y = (p / N) | 0;
      if (x > 0 && dist[p - 1] < 0) { dist[p - 1] = dcur + 1; stack[dtail++] = p - 1; }
      if (x < N - 1 && dist[p + 1] < 0) { dist[p + 1] = dcur + 1; stack[dtail++] = p + 1; }
      if (y > 0 && dist[p - N] < 0) { dist[p - N] = dcur + 1; stack[dtail++] = p - N; }
      if (y < N - 1 && dist[p + N] < 0) { dist[p + N] = dcur + 1; stack[dtail++] = p + N; }
    }
    const maxRimR = 499.0 * (N / 1000);
    const maxRimR2 = maxRimR * maxRimR;
    // 扫描识别残边：只补硬像素（0/255），越远越稀；不要半透明淡红，那会读成发光
    const rimGate = [0, 0.35, 0.62, 0.82, 0.92];
    const rd = ctx.getImageData(0, 0, N, N);
    for (let p = 0; p < dist.length; p++) {
      const dd = dist[p];
      if (dd < 1 || dd > 4) continue;
      const x = p % N, y = (p / N) | 0;
      const rdx = x - (N - 1) / 2, rdy = y - (N - 1) / 2;
      if (rdx * rdx + rdy * rdy > maxRimR2) continue;
      const v = nRim(x, y);
      // 整圈均匀撒残边会读成「规律的缺点」，改成分区：几处较密、其余几乎没有
      const zoneW = nRimZone(x * 0.55, y * 0.55);
      const zoneK = zoneW < 0.42 ? 0 : Math.min(1, (zoneW - 0.42) / 0.34);
      if (zoneK <= 0) continue;
      if (v * zoneK < rimGate[dd] * 0.85) continue;
      if (voidDil && voidDil[p]) continue;      // 孔里不补残边
      const q = p * 4;
      // 残边也是同一块印泥，颜色跟随所选标准色；写死纯红会在图上多出一种红
      rd.data[q] = ER;
      rd.data[q + 1] = EG;
      rd.data[q + 2] = EB;
      rd.data[q + 3] = 255;
    }
    ctx.putImageData(rd, 0, 0);

    // 印泥飞溅小点：真实盖章只偶尔甩出几粒，多数时候一颗都没有。
    // 默认 0-3 颗、直径 0.05-0.09mm 的细点，由 seed 决定有没有，不给固定数量。
    // 必须补在「去零星墨点」之后，否则会被当噪点删掉。
    if (o.scanSpecks !== false) {
      const rndSpk = mulberry32(seed + 137);
      const nSpk = o.scanSpecks == null ? Math.floor(rndSpk() * 4) : +o.scanSpecks;
      const sctx = out.getContext('2d');
      sctx.save();
      sctx.fillStyle = 'rgb(' + ER + ',' + EG + ',' + EB + ')';
      let placed = 0;
      for (let i2 = 0; i2 < nSpk * 14 && placed < nSpk; i2++) {
        const a = rndSpk() * Math.PI * 2;
        const rr = 9.2 + rndSpk() * 10.2;
        // 编码带不撒，保 OCR
        let ad = (a * 180 / Math.PI + 360) % 360;
        if (ad > 222 && ad < 318 && rr > 16.6) continue;
        const cxm = Math.cos(a) * rr, cym = Math.sin(a) * rr;
        const px = Math.round(half + cxm * mm);
        const py = Math.round(half - cym * mm);
        const rad = (0.05 + rndSpk() * 0.04) * mm;   // 0.05-0.09mm
        const ir = Math.max(1, Math.ceil(rad * 1.6));
        if (px - ir < 0 || px + ir >= N || py - ir < 0 || py + ir >= N) continue;
        // 压到笔画上就跳过，只有一粒点不该糊字
        let hit = false;
        for (let yy2 = py - ir; yy2 <= py + ir && !hit; yy2++) {
          for (let xx2 = px - ir; xx2 <= px + ir; xx2++) {
            if (rd.data[(yy2 * N + xx2) * 4 + 3] > 0) { hit = true; break; }
          }
        }
        if (hit) continue;
        // 3-4 个偏心小圆叠一下，别是正圆
        const lobes = 3 + Math.floor(rndSpk() * 2);
        for (let k = 0; k < lobes; k++) {
          const oa = rndSpk() * Math.PI * 2;
          const od = rad * (0.2 + rndSpk() * 0.5);
          sctx.beginPath();
          sctx.arc(px + Math.cos(oa) * od, py + Math.sin(oa) * od,
                  rad * (0.6 + rndSpk() * 0.4), 0, Math.PI * 2);
          sctx.fill();
        }
        placed++;
      }
      sctx.restore();
      o._speckPlaced = placed;
    }

    canvas.width = N;
    canvas.height = N;
    const cctx = canvas.getContext('2d');
    cctx.clearRect(0, 0, N, N);
    cctx.drawImage(out, 0, 0);
    return canvas;
  }

  function renderExtractPaper(canvas, o) {
    const N = Math.round(o.px || SIZE);
    const s = N / 1000;
    const ink = document.createElement('canvas');
    renderExtract(ink, o);

    canvas.width = N;
    canvas.height = N;
    const ctx = canvas.getContext('2d');

    // 扫描纸底：暖白 + 低频不匀 + 横向纤维 + 细颗粒
    const img = ctx.createImageData(N, N);
    const d = img.data;
    const rnd = mulberry32((o.seed || 7) + 201);
    const nWash = makeSampler(noiseCanvas(4, (o.seed || 7) + 205), N);
    const nFiber = makeSampler(noiseCanvas(110, (o.seed || 7) + 207), N);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const i = (y * N + x) * 4;
        const wash = (nWash(x, y) - 0.5) * 8;
        const fiber = (nFiber(x, y) - 0.5) * 5;
        const grain = (rnd() - 0.5) * 8;
        d[i] = 252 + wash + fiber + grain;
        d[i + 1] = 251 + wash + fiber + grain;
        d[i + 2] = 246 + wash + fiber + grain;
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    // 墨洇：一层很淡的红晕，只在纸上预览里出现
    ctx.save();
    ctx.globalAlpha = 0.08;
    try { ctx.filter = 'blur(' + (0.7 * s) + 'px)'; } catch (e) { /* 忽略 */ }
    ctx.drawImage(ink, 0, 0);
    ctx.restore();

    // 正片：让纸纹透进墨里
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = 0.96;
    ctx.drawImage(ink, 0, 0);
    ctx.restore();
    return canvas;
  }

  const { nameLayout, nameFit, toSlug } = global.SealMeta;

  function render(canvas, opts) {
    const o = Object.assign({
      name: '',
      line1: '',
      line2: '',
      code: '',
      diameter: 42,
      border: 1.2,
      nameSize: 6.75,
      nameWeight: 400,
      nameStroke: 0,
      arc: 265,
      starWidth: 14,
      star: true,
      lineSize: 5.8,
      codeSize: 1.35,
      codeWeight: 700,
      codeSoft: 0.6,
      codeStart: 205,
      codeSpan: 45,
      color: '#DA251D',
      rotation: 0,
      texture: 0.3,
      edgeAmp: 0.012,
      nicks: 0,
      specks: 0,
      seed: 7
    }, opts || {});

    if (o.fresh) return renderExtract(canvas, o);
    const N = Math.round(o.px || SIZE);
    const s = (N / 1000) * PXMM;
    const cx = N / 2;
    const cy = N / 2;
    const R = o.diameter / 2;
    canvas.width = N;
    canvas.height = N;
    const outCtx = canvas.getContext('2d');
    outCtx.clearRect(0, 0, N, N);
    const layer = document.createElement('canvas');
    layer.width = N;
    layer.height = N;
    const ctx = layer.getContext('2d');

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((o.rotation * Math.PI) / 180);
    ctx.translate(-cx, -cy);

    const fill = o.color;
    ctx.fillStyle = fill;
    ctx.strokeStyle = fill;

    // 外圈：内外缘各带轻微起伏，线宽随之变化
    const noiseOut = edgeNoise(o.seed + 2);
    const noiseIn = edgeNoise(o.seed + 9);
    const amp = o.edgeAmp;
    const seg = 720;
    const sampleNoise = (arr, i) => {
      const idx = (i / seg) * 360;
      const i0 = Math.floor(idx) % 360;
      const i1 = (i0 + 1) % 360;
      const t = idx - Math.floor(idx);
      return arr[i0] * (1 - t) + arr[i1] * t;
    };
    ctx.beginPath();
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const nv = sampleNoise(noiseOut, i);
      const wob = Math.sin(a * 3 + (o.seed || 1) * 1.7) * amp * 2.2;
      const rr = R + (nv - 0.5) * 2 * amp + wob;
      const x = cx + Math.cos(a) * rr * s;
      const y = cy + Math.sin(a) * rr * s;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    for (let i = seg; i >= 0; i--) {
      const a = (i / seg) * Math.PI * 2;
      const nv = sampleNoise(noiseIn, i);
      const wob = Math.sin(a * 2.3 + (o.seed || 1) * 1.4) * amp * 1.6;
      const rr = R - o.border + (nv - 0.5) * 2 * amp + wob;
      const x = cx + Math.cos(a) * rr * s;
      const y = cy + Math.sin(a) * rr * s;
      ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();

    // 边圈随机小缺口：真实章不会是一整圈完美实线
    const rndNick = mulberry32(o.seed + 61);
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    const nickCount = o.nicks || 0;
    for (let i = 0; i < nickCount; i++) {
      const a = rndNick() * Math.PI * 2;
      const w = (0.2 + rndNick() * 0.35) * (Math.PI / 180);
      ctx.beginPath();
      ctx.arc(cx, cy, (R - o.border / 2) * s, a - w / 2, a + w / 2);
      ctx.lineWidth = o.border * 1.4 * s;
      ctx.lineCap = 'butt';
      ctx.stroke();
    }
    ctx.restore();

    // 上弧公司名：逐字量墨宽，括号只占自己的墨宽；普通公章按目标角度铺开，
    // 字少时字距最多 0.6 倍字高，长名收到约 0.2 倍字高；带中心章名的角度小一些。
    // 仍放不下才压窄字形（下限 49%）、缩字号。
    const chars = Array.from(o.name || '');
    // 弧长以 nameLayout 算出来的为准（它按编码带留白推），不要用 o.arc 原值，
    // 否则算的时候是 256°、画的时候还是 250°，首末字与编码的空隙就对不齐
    let arcDeg = o.arc || 250;
    let nameR = R - o.border - 0.9 - o.nameSize / 2;
    let usedNameSize = o.nameSize;
    if (chars.length) {
      const lay = nameLayout(Object.assign({}, o, { fontFamily: FONT_SONG }));
      usedNameSize = lay.size;
      nameR = lay.r;
      arcDeg = lay.arcDeg;
      const namePx = (lay.size / 0.88) * s;
      if (lay.glyphs) {
        drawArcText(ctx, o.name, cx, cy, nameR * s, namePx,
          90 + arcDeg / 2, -arcDeg, o.nameWeight || 400, FONT_SONG, false, 0, (o.nameStroke || 0) * s, o.seed + 5, o.jitter || 0,
          {
            cells: lay.glyphs.map((g) => ({ w: g.w * s, dx: g.dx * s, sx: g.sx })),
            gaps: lay.gaps.map((g) => g * s),
          });
      } else {
        const gapPx = lay.gapMm * s;
        drawArcText(ctx, o.name, cx, cy, nameR * s, namePx,
          90 + arcDeg / 2, -arcDeg, o.nameWeight || 400, FONT_SONG, false, 0, (o.nameStroke || 0) * s, o.seed + 5, o.jitter || 0,
          { sx: lay.sx, gapPx });
      }
    }

    // 五角星
    if (o.star !== false) drawStar(ctx, cx, cy - 0.5 * s, o.starWidth, s, o.seed + 3, o.jitter || 0);

    // 公开版只画一行章名：合同专用章 / 财务专用章。两行布局在公开核心中不实现。
    // 带星和不带星用同一个 10.3，切星标时章名不往上跳
    const lineY = o.lineY1 || 10.3;
    if (o.line1) {
      const lineSize = Math.min(o.lineSize, usedNameSize * 1.05);
      const linePx = (lineSize / 0.88) * s;
      ctx.save();
      ctx.font = `${o.lineWeight || 700} ${linePx}px ${FONT_SONG}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const maxW = 22 * s;
      const w = ctx.measureText(o.line1).width;
      const k = w > maxW ? maxW / w : 1;
      ctx.translate(cx, cy + lineY * s);
      ctx.scale(k, 1);
      ctx.fillText(o.line1, 0, 0);
      ctx.lineWidth = 0.03 * s;
      ctx.lineJoin = 'round';
      ctx.strokeText(o.line1, 0, 0);
      ctx.restore();
    }

    // 编码：章面正下方沿弧排列，Arial，字高 1.5mm、字距 2mm、距内边 0.6mm
    if (o.code) {
      const digits = Array.from(o.code).slice(0, 16).join('');
      const codePx = (o.codeSize / 0.72) * s;
      const codeR = R - o.border - 0.6 - o.codeSize / 2;
      const stepDeg = (2.0 / codeR) * (180 / Math.PI);
      const span = stepDeg * Math.max(digits.length - 1, 0);
      // codeCenter 270 = 正下方；180 = 左侧竖排（照实物章：编码在左边）
      const codeCenter = o.codeCenter === undefined ? 270 : o.codeCenter;
      const startDeg = codeCenter - span / 2;
      // 编码单独画一层，轻微模糊后叠上去，模拟印泥压出来的软边
      const soft = document.createElement('canvas');
      soft.width = N;
      soft.height = N;
      const sctx = soft.getContext('2d');
      sctx.fillStyle = fill;
      sctx.font = `${o.codeWeight} ${codePx}px ${FONT_NUM}`;
      sctx.textAlign = 'center';
      sctx.textBaseline = 'middle';
      // 纸质模式下印泥会把细笔画撑粗一点：给数字加一圈同色描边，
      // 只加粗笔画、不改字高字宽（Arial 最重就是 700，900 无效，实测一样）
      if (o.codeStrokeMm > 0) {
        sctx.strokeStyle = fill;
        sctx.lineWidth = o.codeStrokeMm * s;
        sctx.lineJoin = 'round';
      }
      for (let i = 0; i < digits.length; i++) {
        const aDeg = startDeg + i * stepDeg;
        const a = (aDeg * Math.PI) / 180;
        const x = cx + Math.cos(a) * codeR * s;
        const y = cy - Math.sin(a) * codeR * s;
        sctx.save();
        sctx.translate(x, y);
        sctx.rotate(((codeCenter - aDeg) * Math.PI) / 180);
        if (o.codeStrokeMm > 0) sctx.strokeText(digits[i], 0, 0);
        sctx.fillText(digits[i], 0, 0);
        sctx.restore();
      }
      ctx.save();
      const codeBlur = (o.codeSoft === undefined ? 0.6 : o.codeSoft) * (N / 1000);
      if (codeBlur > 0) ctx.filter = `blur(${codeBlur}px)`;
      ctx.globalAlpha = 0.93;
      ctx.drawImage(soft, 0, 0);
      ctx.restore();
    }

    // 零星墨点：边圈外侧和内侧各撒几粒
    const rndSpeck = mulberry32(o.seed + 87);
    ctx.save();
    for (let i = 0; i < (o.specks || 0); i++) {
      const a = rndSpeck() * Math.PI * 2;
      const outside = rndSpeck() < 0.7;
      const rr = outside ? (20.9 + rndSpeck() * 0.6) : (18.9 + rndSpeck() * 0.7);
      const rad = (0.06 + rndSpeck() * 0.16) * s;
      ctx.globalAlpha = 0.25 + rndSpeck() * 0.5;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * rr * s, cy + Math.sin(a) * rr * s, rad, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    ctx.restore();

    applyTexture(ctx, N, o.texture, o.seed);
    // 印迹版：先铺一层轻微模糊的墨晕，再叠清晰主体，模拟纸张吸墨的毛边
    if ((o.texture || 0) > 0) {
      const blurPx = 0.9 * (N / 1000);
      outCtx.save();
      outCtx.filter = 'blur(' + blurPx + 'px)';
      outCtx.globalAlpha = 0.55;
      outCtx.drawImage(layer, 0, 0);
      outCtx.restore();
      outCtx.save();
      outCtx.globalAlpha = 0.92;
      outCtx.drawImage(layer, 0, 0);
      outCtx.restore();
    } else {
      outCtx.drawImage(layer, 0, 0);
    }
    return canvas;
  }

  function renderPaper(canvas, opts) {
    const o = Object.assign({ px: SIZE, seed: 7 }, opts || {});
    if (o.fresh) return renderExtractPaper(canvas, o);
    const N = Math.round(o.px || SIZE);
    const sealCanvas = document.createElement('canvas');
    render(sealCanvas, o);

    // 墨量不均：按低频噪声压 alpha，让纸色从墨里透出来
    const sealCtx = sealCanvas.getContext('2d');
    const snData = noiseCanvas(64, (o.seed || 7) + 301).getContext('2d')
      .getImageData(0, 0, 64, 64).data;
    const sd = sealCtx.getImageData(0, 0, N, N);
    for (let y = 0; y < N; y++) {
      const ny = Math.min(63, Math.floor((y / N) * 64));
      for (let x = 0; x < N; x++) {
        const i = (y * N + x) * 4;
        if (sd.data[i + 3] === 0) continue;
        const nx = Math.min(63, Math.floor((x / N) * 64));
        const nv = snData[(ny * 64 + nx) * 4] / 255;
        sd.data[i + 3] = Math.round(sd.data[i + 3] * (0.78 + 0.22 * nv));
      }
    }
    sealCtx.putImageData(sd, 0, 0);

    canvas.width = N;
    canvas.height = N;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fbfaf4';
    ctx.fillRect(0, 0, N, N);

    // 纸纹：细颗粒
    const img = ctx.getImageData(0, 0, N, N);
    const d = img.data;
    const rnd = mulberry32((o.seed || 7) + 201);
    for (let i = 0; i < d.length; i += 4) {
      const n = (rnd() - 0.5) * 11;
      d[i] = Math.max(0, Math.min(255, d[i] + n));
      d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
      d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
    }
    ctx.putImageData(img, 0, 0);

    // 墨洇：一层模糊的红晕
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.filter = 'blur(1px)';
    ctx.drawImage(sealCanvas, 0, 0);
    ctx.restore();

    // 正片：正片叠底，让纸纹透进墨里
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = 0.92;
    ctx.drawImage(sealCanvas, 0, 0);
    ctx.restore();
    return canvas;
  }

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes, start, len) {
    let c = 0xffffffff;
    for (let i = start; i < start + len; i++) {
      c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  // 给 PNG 写入 pHYs 块，让 WPS/Word 按 600dpi 识别物理尺寸
  function withDpi(blob, dpi, cb) {
    blob.arrayBuffer().then((buf) => {
      const src = new Uint8Array(buf);
      const insertAt = 8 + 4 + 4 + 13 + 4;
      const ppu = Math.round(dpi / 0.0254);
      const chunk = new Uint8Array(21);
      const dv = new DataView(chunk.buffer);
      dv.setUint32(0, 9);
      chunk.set([0x70, 0x48, 0x59, 0x73], 4);
      dv.setUint32(8, ppu);
      dv.setUint32(12, ppu);
      chunk[16] = 1;
      dv.setUint32(17, crc32(chunk, 4, 13));
      const out = new Uint8Array(src.length + chunk.length);
      out.set(src.subarray(0, insertAt), 0);
      out.set(chunk, insertAt);
      out.set(src.subarray(insertAt), insertAt + chunk.length);
      cb(new Blob([out], { type: 'image/png' }));
    });
  }

  // 导出用的 PNG：按章体外径（diameterMm）居中裁成正方形，画布那圈透明留白去掉，
  // DPI 固定 600（1mm = 23.622px），所以 42mm 章导出 992px、40mm 章 945px，
  // 插进文档量出来就是实物直径。download 和「下载全部」共用这一份，口径不会跑偏。
  // 纸上质感整幅都是纸，不裁。
  function toPngBlob(canvas, diameterMm, white) {
    const diaMm = diameterMm || 42;
    const mmScale = PXMM * (canvas.width / 1000);
    const dia = Math.round(diaMm * mmScale);
    let src = canvas;
    if (dia > 0 && dia <= canvas.width - 2) {
      const x0 = Math.round((canvas.width - dia) / 2);
      const y0 = Math.round((canvas.height - dia) / 2);
      src = document.createElement('canvas');
      src.width = src.height = dia;
      src.getContext('2d').drawImage(canvas, x0, y0, dia, dia, 0, 0, dia, dia);
    }
    let out = src;
    if (white) {
      out = document.createElement('canvas');
      out.width = src.width;
      out.height = src.height;
      const c = out.getContext('2d');
      c.fillStyle = '#ffffff';
      c.fillRect(0, 0, out.width, out.height);
      c.drawImage(src, 0, 0);
    }
    return new Promise((resolve) => {
      out.toBlob((blob) => withDpi(blob, 600, resolve), 'image/png');
    });
  }

  function download(canvas, filename, white, diameterMm) {
    toPngBlob(canvas, diameterMm, white).then((withMeta) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(withMeta);
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
  }

  // 公开版只暴露合同专用章和财务专用章；布局参数在入口处锁定，调用方改不了。
  const rawRender = render;
  const LITE = {
    contract: { line1: '合同专用章', arc: 240, nameSize: 6.75, lineSize: 5.3 },
    finance: { line1: '财务专用章', arc: 240, nameSize: 6.75, lineSize: 5.3 }
  };

  function renderLite(canvas, opts) {
    const profile = opts && opts.profile;
    const preset = LITE[profile];
    if (!preset) throw new Error('public build only supports contract and finance');
    const diameter = opts.diameter === 40 ? 40 : 42;
    const border = diameter === 40 ? 1.1 : 1.2;
    const starWidth = diameter === 40 ? 13 : 14;
    return rawRender(canvas, Object.assign({}, opts, {
      profile,
      line1: preset.line1,
      line2: '',
      arc: preset.arc,
      nameSize: preset.nameSize,
      lineSize: preset.lineSize,
      diameter,
      border,
      starWidth,
      jitter: 0,
      texture: 0,
      edgeAmp: 0.01,
      nicks: 0,
      specks: 0
    }));
  }

  global.Seal = { render: renderLite, toPngBlob, toSlug, nameFit, SIZE, PXMM };
})(window);
