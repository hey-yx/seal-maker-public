/* 名称排版与文件名工具：页面提示和服务端渲染共用这一份，避免两套口径。 */
(function (global) {
  'use strict';

  const FONT_SONG = '"FandolSong", "Noto Serif SC", "Songti SC", "STSong", "SimSun", serif';
  const SEAL_WEIGHT = 400;

  // 逐字量墨迹宽度：环排要按字的实际墨宽排，不能把全角括号当成整字。
  // 量一次缓存一次，输入框每次按键、每次生成都复用。
  let measureCanvas = null;
  const metricsCache = new Map();

  function glyphKind(ch) {
    if (/[\s\u3000]/.test(ch)) return 'space';
    if (/[（(【\[]/.test(ch)) return 'open';
    if (/[）)】\]]/.test(ch)) return 'close';
    if (/[·•・]/.test(ch)) return 'dot';
    if (/[—–\-－]/.test(ch)) return 'dash';
    if (/[A-Za-z0-9]/.test(ch)) return 'ascii';
    return 'normal';
  }

  function fallbackWidth(ch) {
    const kind = glyphKind(ch);
    if (kind === 'space') return 0;
    if (kind === 'open' || kind === 'close') return 0.27;
    if (kind === 'dot') return 0.18;
    if (kind === 'dash') return 0.5;
    if (/[\x00-\x7f]/.test(ch)) return 0.6;
    return 0.96;
  }

  // 返回每个字的墨宽和墨心偏移，单位都是字号（fontPx）的倍数。
  // dx 是墨迹中心相对字身框中心的偏移，画的时候要把它抵掉，否则全角括号会偏到一侧。
  function glyphMetrics(text, weight, fontFamily) {
    const chars = Array.from(text || '');
    const key = `${weight || SEAL_WEIGHT}|${fontFamily || FONT_SONG}|${text || ''}`;
    if (metricsCache.has(key)) return metricsCache.get(key);
    let out;
    try {
      if (typeof document === 'undefined') throw new Error('no document');
      if (!measureCanvas) measureCanvas = document.createElement('canvas');
      measureCanvas.width = 8;
      measureCanvas.height = 8;
      const ctx = measureCanvas.getContext('2d');
      const fontPx = 200;
      ctx.font = `${weight || SEAL_WEIGHT} ${fontPx}px ${fontFamily || FONT_SONG}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      out = chars.map((ch) => {
        const m = ctx.measureText(ch);
        const kind = glyphKind(ch);
        const adv = m.width || fontPx;
        const inkW = (m.actualBoundingBoxLeft || 0) + (m.actualBoundingBoxRight || 0);
        const inkCx = ((m.actualBoundingBoxRight || 0) - (m.actualBoundingBoxLeft || 0)) / 2;
        const inkCy = ((m.actualBoundingBoxDescent || 0) - (m.actualBoundingBoxAscent || 0)) / 2;
        const blank = kind === 'space';
        // 汉字按统一字格宽度排布，保持左右几何对称；括号/标点/半角字符按实际墨宽收紧
        const cellW = kind === 'normal' ? adv * 0.94 : (inkW > 0 ? inkW : adv * 0.9);
        const cellDx = kind === 'normal' ? 0 : inkCx;
        return {
          ch,
          w: (blank ? 0 : cellW) / fontPx,
          dx: cellDx / fontPx,
          dy: -inkCy / fontPx,
          adv: adv / fontPx,
        };
      });
    } catch (e) {
      out = chars.map((ch) => ({
        ch,
        w: fallbackWidth(ch),
        dx: 0,
        dy: 0,
        adv: fallbackWidth(ch),
      }));
    }
    metricsCache.set(key, out);
    if (metricsCache.size > 200) metricsCache.clear();
    return out;
  }

  // 括号外侧与常规字同距，内侧略微收紧但保持整体节奏均匀。
  function boundaryWeight(a, b, insideParens) {
    const ka = glyphKind(a);
    const kb = glyphKind(b);
    if (ka === 'space' || kb === 'space') return 0.30;
    const ba = ka === 'open' || ka === 'close';
    const bb = kb === 'open' || kb === 'close';
    if (!ba && !bb) return insideParens ? 0.95 : 1;
    if ((ka === 'open' && kb !== 'close') || (kb === 'close' && ka !== 'open')) return 0.82;
    return 1;
  }

  // 名称排版：算字高、横向比例、字距。render 和 nameFit 共用这一份，口径不会跑偏
  //   传统印章采用瘦长宋体，短名控制最大字距以免散架，长名按字数平滑缩字高而不是死扛 7mm 压扁。
  function nameLayout(o) {
    const chars = Array.from(o.name || '');
    const n = chars.length;
    const R = (o.diameter || 42) / 2;
    const border = o.border != null ? o.border : 1.185;
    const arcMax = o.arc || 270;
    const outerGap = o.nameOuterGap != null ? Math.max(0, +o.nameOuterGap) : (R < 20.5 ? 1.08 : 1.15);
    const outer = R - border - outerGap;
    const target = o.nameSize || 7.35;
    // FandolSong-Bold 实测字高约为 fontPx 的 0.96；横向比例 0.64 贴近 DB4403 官方案例且保留印章瘦长感
    const INK_RATIO = 0.96;
    const charW = (sz) => sz / INK_RATIO;
    const SX_FIX = 0.64;
    const GAP_PREF = o.nameGapPref != null ? Math.max(0, +o.nameGapPref) : 1.9;
    const SX_MIN = 0.18;

    if (o.nameGapMm != null) {
      // 手动模式：字高、字距按用户给的锁死，压窄和缩字高只用来兜底。
      // 弧段角度同样按实际占用算，名称短自然就短。
      const SX_MAX_M = 0.64;
      const SX_MIN_M = 0.32;
      const askedSize = Math.max(1.5, Math.min(12, +o.nameSize || target));
      const askedGap = Math.max(0, +o.nameGapMm);
      const gaps = Math.max(0, n - 1);
      let size = askedSize;
      let gapMm = askedGap;
      let sx = SX_MAX_M;
      let r = outer - size / 2;
      let textUnit = n * charW(size);
      const span = () => ((textUnit * sx + gaps * gapMm) / r) * 180 / Math.PI;
      let deg = span();
      let clamped = false;
      if (deg > arcMax) {
        const avail = (arcMax * Math.PI / 180) * r;
        sx = Math.max(SX_MIN_M, (avail - gaps * gapMm) / textUnit);
        deg = span();
        clamped = true;
        if (deg > arcMax) {
          let lo = 1.5;
          let hi = size;
          for (let k = 0; k < 24; k++) {
            const mid = (lo + hi) / 2;
            const u = n * charW(mid);
            const rr = outer - mid / 2;
            const d = ((u * sx + gaps * gapMm) / rr) * 180 / Math.PI;
            if (d <= arcMax) lo = mid; else hi = mid;
          }
          size = lo;
          r = outer - size / 2;
          textUnit = n * charW(size);
          deg = span();
        }
      }
      const arcLen = r * (deg * Math.PI / 180);
      return {
        size, sx, gapRatio: size > 0 ? gapMm / size : 0, gapMm,
        r, arcLen, textW: textUnit * sx, arcDeg: deg, outerGap,
        manual: true, clamped,
        askedSize, askedGap,
        sizeTrimmed: size < askedSize - 1e-6, gapTrimmed: false,
        shrunk: clamped,
      };
    }

    // 自动模式：先按墨迹排字，括号只占它自己的墨宽。
    const uncoded = o.noCode != null ? !!o.noCode : !o.code;
    const hasCenter = !!(o.line1 || o.line2) || (o.arc != null && +o.arc < 260);
    const metrics = glyphMetrics(o.name, o.nameWeight || SEAL_WEIGHT, o.fontFamily || FONT_SONG);
    const units = [];
    let parenDepth = 0;
    for (let i = 0; i < n - 1; i++) {
      const k = glyphKind(chars[i]);
      if (k === 'open') parenDepth++;
      else if (k === 'close' && parenDepth > 0) parenDepth--;
      const nextK = glyphKind(chars[i + 1]);
      const inside = parenDepth > 0 && k !== 'open' && nextK !== 'close';
      units.push(boundaryWeight(chars[i], chars[i + 1], inside));
    }
    const isPunct = (g) => g.kind === 'dot' || g.kind === 'dash' || g.kind === 'space';
    const emOf = (sz) => sz / INK_RATIO;
    // 优先保持和官方样张一致的固定字高（如 42mm 始终 7.35mm），优先收字距并横向压窄，物理放不下时才缩小字高
    const idealSize = target;
    const targetDeg = hasCenter
      ? Math.min(arcMax, (uncoded ? 148 : 142) + 10.0 * n)
      : (n <= 6
        ? Math.min(arcMax, 88 + 16.0 * n)
        : Math.min(arcMax, (uncoded ? 162 : 154) + 11.7 * n));
    const GAP_CAP = n <= 4
      ? (uncoded ? 0.62 : 0.56)
      : (n <= 8 ? (uncoded ? 0.46 : 0.40) + (9 - n) * 0.04 : (uncoded ? 0.45 : 0.38));
    const GAP_FLOOR = 0.12;
    const GAP_TIGHT = 0.045;

    const sxForKind = (kind, baseSx) => {
      if (kind === 'normal') return baseSx;
      if (kind === 'ascii') return Math.min(0.64, baseSx * 1.10);
      if (kind === 'open' || kind === 'close') return Math.min(0.64, Math.max(0.28, baseSx * 1.05));
      return Math.min(0.64, baseSx * 1.05);
    };

    // 给定字号，算一套能放下的排法；返回 null 表示字号太大，压到 SX_MIN 仍放不下。
    function fitAt(sz) {
      const em = emOf(sz);
      const glyphs = metrics.map((m) => {
        const kind = glyphKind(m.ch);
        return {
          ch: m.ch,
          w: m.w * em,
          dx: m.dx * em,
          dy: (m.dy || 0) * em,
          kind,
          sx: sxForKind(kind, SX_FIX),
        };
      });
      const rr = outer - sz / 2;
      const arcLenMax = rr * (arcMax * Math.PI / 180);
      const inkAt = (baseSx) => glyphs.reduce((a, g) => a + g.w * sxForKind(g.kind, baseSx), 0);
      let ink = inkAt(SX_FIX);

      const gapFloor = sz * GAP_FLOOR;
      const gapCap = sz * GAP_CAP;
      const gapTight = sz * GAP_TIGHT;
      const specialUnit = (u) => (u < 0.999 ? u : 0);
      const normalCount = units.reduce((a, u) => a + (u >= 0.999 ? 1 : 0), 0);
      const unitSum = units.reduce((a, b) => a + b, 0) || 1;
      const specialSumAt = (base) => units.reduce((a, u) => a + specialUnit(u) * base, 0);

      // 按目标角度反算字距：正常与括号边界同步按权重分配，既保持括号内词组凝聚又避免外部字距暴涨
      const targetLen = rr * (targetDeg * Math.PI / 180);
      let gap = Math.max(gapFloor, Math.min(gapCap, (targetLen - ink) / unitSum));
      const minBracketBase = Math.max(gapTight * 1.45, sz * 0.21);
      let specialBase = Math.max(minBracketBase, gap);

      let gaps = units.map((u) => (u < 0.999 ? specialUnit(u) * specialBase : gap));
      let total = ink + gaps.reduce((a, b) => a + b, 0);
      if (total > arcLenMax) {
        const cand = (arcLenMax - ink) / unitSum;
        if (cand >= minBracketBase) {
          gap = Math.max(gapTight, cand);
          specialBase = gap;
        } else {
          const specialSum = specialSumAt(minBracketBase);
          gap = normalCount > 0
            ? Math.max(gapTight, (arcLenMax - ink - specialSum) / normalCount)
            : Math.max(gapTight, cand);
          specialBase = minBracketBase;
        }
        gaps = units.map((u) => (u < 0.999 ? specialUnit(u) * specialBase : gap));
        total = ink + gaps.reduce((a, b) => a + b, 0);
      }
      let sx = SX_FIX;
      if (total > arcLenMax) {
        const punctInk = glyphs.reduce((a, g) => a + (isPunct(g) ? g.w * g.sx : 0), 0);
        const scaleUnitInk = glyphs.reduce((a, g) => {
          if (g.kind === 'normal') return a + g.w;
          if (g.kind === 'ascii') return a + g.w * 1.10;
          if (g.kind === 'open' || g.kind === 'close') return a + g.w * 1.05;
          return a;
        }, 0) || 1e-6;
        const gapSum = gaps.reduce((a, b) => a + b, 0);
        const room = arcLenMax - gapSum - punctInk;
        sx = Math.max(SX_MIN, Math.min(SX_FIX, room / scaleUnitInk));
        ink = inkAt(sx);
        total = ink + gapSum;
        if (total > arcLenMax + 1e-6) return null;
      }
      return {
        size: sz, sx, gapMm: gap, r: rr,
        glyphs: glyphs.map((g) => ({
          ...g,
          sx: sxForKind(g.kind, sx),
        })),
        gaps,
        textW: ink, arcLen: total, arcDeg: (total / rr) * 180 / Math.PI,
        gapTrimmed: gap < GAP_PREF - 1e-6,
      };
    }

    let fit = fitAt(idealSize);
    let shrunk = idealSize < target - 1e-6;
    if (!fit) {
      // 字号二分：保留尽可能舒服的字高与横向比例
      let lo = 1.5;
      let hi = idealSize;
      for (let k = 0; k < 24; k++) {
        const mid = (lo + hi) / 2;
        if (fitAt(mid)) lo = mid; else hi = mid;
      }
      fit = fitAt(lo) || fitAt(1.5) || fitAt(idealSize);
      shrunk = true;
    }
    if (!fit) {
      // 极端兜底：按最窄字形均分，宁可字距为 0 也不溢出模板
      const em = emOf(target);
      const glyphs = metrics.map((m) => {
        const kind = glyphKind(m.ch);
        return { ch: m.ch, w: m.w * em, dx: m.dx * em, dy: (m.dy || 0) * em, kind, sx: sxForKind(kind, SX_MIN) };
      });
      const r = outer - target / 2;
      const ink = glyphs.reduce((a, g) => a + g.w * g.sx, 0);
      fit = {
        size: target, sx: SX_MIN, gapMm: 0, r, glyphs, gaps: units.map(() => 0),
        textW: ink, arcLen: ink, arcDeg: (ink / r) * 180 / Math.PI, gapTrimmed: true,
      };
    }

    return {
      size: fit.size,
      sx: fit.sx,
      gapMm: fit.gapMm,
      r: fit.r,
      arcLen: fit.arcLen,
      textW: fit.textW,
      arcDeg: fit.arcDeg,
      outerGap,
      manual: false,
      clamped: false,
      shrunk,
      sizeFixed: fit.size >= target - 1e-6,
      sxMin: SX_MIN,
      sxMax: SX_FIX,
      glyphs: fit.glyphs,
      gaps: fit.gaps,
      gapTrimmed: fit.gapTrimmed,
    };
  }

  // 名称实际字高：和 render 共用 nameLayout，报告字高、横向比例、字距
  function nameFit(o) {
    const chars = Array.from(o.name || '');
    if (!chars.length) {
      return { size: o.nameSize || 7.0, sx: 1, gapMm: 0, chars: 0, shrunk: false, arcMm: 0, needMm: 0, arcUsed: o.arc || 270, arcDeg: o.arc || 270 };
    }
    const lay = nameLayout(o);
    const target = o.nameSize || 6.5;
    return {
      arcDeg: +lay.arcDeg.toFixed(1),
      r: +lay.r.toFixed(2),
      size: +lay.size.toFixed(2),
      sx: +lay.sx.toFixed(2),
      gapMm: +lay.gapMm.toFixed(2),
      outerGap: +lay.outerGap.toFixed(2),
      manual: !!lay.manual,
      clamped: !!lay.clamped,
      askedSize: lay.askedSize != null ? +lay.askedSize.toFixed(2) : null,
      askedGap: lay.askedGap != null ? +lay.askedGap.toFixed(2) : null,
      sizeTrimmed: !!lay.sizeTrimmed,
      gapTrimmed: !!lay.gapTrimmed,
      needMm: +lay.textW.toFixed(1),
      arcMm: +lay.arcLen.toFixed(1),
      arcUsed: lay.arcDeg,
      shrunk: lay.size < target - 0.005,
      chars: chars.length,
    };
  }

  function toSlug(name) {
    return (name || 'seal').replace(/[\\/:*?"<>|\s]/g, '');
  }

  function loadFont(text) {
    if (typeof document !== 'undefined' && document.fonts && document.fonts.load) {
      return Promise.all([
        document.fonts.load(`${SEAL_WEIGHT} 40px "FandolSong"`, text || '印'),
        document.fonts.load(`600 40px "Noto Serif SC"`, text || '印'),
      ]).then(() => {
        metricsCache.clear();
      }).catch(() => {});
    }
    return Promise.resolve();
  }

  global.SealMeta = { nameLayout, nameFit, glyphMetrics, toSlug, loadFont, FONT_SONG, SEAL_WEIGHT };
})(typeof window !== 'undefined' ? window : globalThis);
