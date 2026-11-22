/* 名称排版与文件名工具：页面提示和服务端渲染共用这一份，避免两套口径。 */
(function (global) {
  'use strict';

  const FONT_SONG = '"Noto Serif SC", "Noto Serif CJK SC", "Songti SC", "STSong", "SimSun", serif';
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
        const adv = m.width || fontPx;
        const inkW = (m.actualBoundingBoxLeft || 0) + (m.actualBoundingBoxRight || 0);
        const inkCx = ((m.actualBoundingBoxRight || 0) - (m.actualBoundingBoxLeft || 0)) / 2;
        const blank = glyphKind(ch) === 'space';
        return {
          ch,
          w: (blank ? 0 : (inkW > 0 ? inkW : adv * 0.9)) / fontPx,
          dx: inkCx / fontPx,
          adv: adv / fontPx,
        };
      });
    } catch (e) {
      out = chars.map((ch) => ({
        ch,
        w: fallbackWidth(ch),
        dx: 0,
        adv: fallbackWidth(ch),
      }));
    }
    metricsCache.set(key, out);
    if (metricsCache.size > 200) metricsCache.clear();
    return out;
  }

  // 括号与内容紧、与外侧松；空格本身没有墨，边界收窄。
  function boundaryWeight(a, b) {
    const ka = glyphKind(a);
    const kb = glyphKind(b);
    if (ka === 'space' || kb === 'space') return 0.25;
    const ba = ka === 'open' || ka === 'close';
    const bb = kb === 'open' || kb === 'close';
    if (!ba && !bb) return 1;
    if ((ka === 'open' && kb !== 'close') || (kb === 'close' && ka !== 'open')) return 0.45;
    return 0.75;
  }

  // 名称排版：算字高、横向比例、字距。render 和 nameFit 共用这一份，口径不会跑偏
  //   括号按墨宽占位，不再占一个整字。普通公章按目标角度铺开：字少时字距最多
  //   0.6 倍字高（约 4mm），长名字距约 0.2 倍字高（约 1.35mm）；带中心章名的
  //   模板角度小一些，字距优先 1.35mm。仍放不下才压窄字形、缩字高。
  function nameLayout(o) {
    const chars = Array.from(o.name || '');
    const n = chars.length;
    const R = (o.diameter || 42) / 2;
    const border = o.border != null ? o.border : 1.185;
    // 环排角度按名称长度算：名称短就占小弧段，名称长才涨到模板上限。
    // 普通公章上限 265°，带中心章名的专用章上限 240°，避免名称压到章名。
    const arcMax = o.arc || 270;
    const outerGap = o.nameOuterGap != null ? Math.max(0, +o.nameOuterGap) : 0.95;
    const outer = R - border - outerGap;
    const target = o.nameSize || 6.5;
    // 字宽按宋体实测：字高 size 对应字号 size/0.88。横向比例用 0.65，
    // 落到墨迹上约为字高的 0.74，看着是竖长瘦体；再宽接近方块，字少时发胖。
    // 锁死横向比例，字不随弧长变宽。
    const charW = (sz) => sz / 0.88;
    const SX_FIX = 0.65;
    // 字距基准 2.6mm；页面/服务端可以按版本传 nameGapPref 覆盖，做版式对比时不用改算法
    const GAP_PREF = o.nameGapPref != null ? Math.max(0, +o.nameGapPref) : 2.6;
    // 名称长时先收字距，再压窄字形，最后才缩字高。
    const GAP_MIN = 0;
    const SX_MIN = 0.49;

    if (o.nameGapMm != null) {
      // 手动模式：字高、字距按用户给的锁死，压窄和缩字高只用来兜底。
      // 弧段角度同样按实际占用算，名称短自然就短。
      const SX_MAX_M = 0.65;
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
    // 无中心章名的普通公章，名称尽量铺到正常环排角度；字少时靠加大字距去够，
    // 但字距有上限（0.6 倍字高），够不到就停在当前角度，不硬拉。
    // 合同/财务/两行章带中心文字，名称角度保持小一些，避免压到中间的章名。
    const hasCenter = !!(o.line1 || o.line2) || (o.arc != null && +o.arc < 260);
    const metrics = glyphMetrics(o.name, o.nameWeight || SEAL_WEIGHT, o.fontFamily || FONT_SONG);
    const units = [];
    for (let i = 0; i < n - 1; i++) units.push(boundaryWeight(chars[i], chars[i + 1]));
    const unitSum = units.reduce((a, b) => a + b, 0) || 1;
    const isPunct = (g) => g.kind !== 'normal' && g.kind !== 'space';
    const emOf = (sz) => sz / 0.88;
    const targetDeg = hasCenter ? null : Math.min(arcMax, 172 + 9 * n);
    const GAP_CAP = 0.60;   // 普通字距上限：0.6 倍字高，约 4mm
    const GAP_FLOOR = 0.20; // 普通字距下限：0.2 倍字高，约 1.35mm
    const GAP_TIGHT = 0.10; // 排不下时字距可收到 0.1 倍字高

    // 给定字号，算一套能放下的排法；返回 null 表示字号太大，压到 49% 仍放不下。
    function fitAt(sz) {
      const em = emOf(sz);
      const glyphs = metrics.map((m) => {
        const kind = glyphKind(m.ch);
        return {
          ch: m.ch,
          w: m.w * em,
          dx: m.dx * em,
          kind,
          sx: kind === 'normal' ? SX_FIX : 1,
        };
      });
      const rr = outer - sz / 2;
      const arcLenMax = rr * (arcMax * Math.PI / 180);
      const inkAt = (scale) => glyphs.reduce((a, g) => a + g.w * (g.kind === 'normal' ? scale : g.sx), 0);
      let ink = inkAt(SX_FIX);

      const gapFloor = sz * GAP_FLOOR;
      const gapCap = sz * GAP_CAP;
      // 括号、空格这类特殊边界的基准宽度固定跟着最小字距走，
      // 名称拉长时多出来的弧长只加在普通字之间，括号不会被拉松。
      const specialUnit = (u) => (u < 0.999 ? u : 0);
      const normalCount = units.reduce((a, u) => a + (u >= 0.999 ? 1 : 0), 0);
      const specialSumAt = (base) => units.reduce((a, u) => a + specialUnit(u) * base, 0);

      let gap;
      let specialBase;
      if (hasCenter) {
        // 带中心章名：按上限角度铺开，字距不超过 2.6mm，短名不硬拉
        gap = Math.max(gapFloor, Math.min(GAP_PREF, (arcLenMax - ink) / unitSum));
        specialBase = gap;
      } else {
        // 普通公章：先按目标角度反算普通字距，短名最多到 0.6 倍字高
        const targetLen = rr * (targetDeg * Math.PI / 180);
        const fixed = specialSumAt(gapFloor);
        gap = normalCount > 0
          ? (targetLen - ink - fixed) / normalCount
          : gapFloor;
        gap = Math.max(gapFloor, Math.min(gapCap, gap));
        specialBase = Math.min(gap, gapFloor);
      }

      let gaps = units.map((u) => (u < 0.999 ? specialUnit(u) * specialBase : gap));
      let total = ink + gaps.reduce((a, b) => a + b, 0);
      if (total > arcLenMax) {
        if (hasCenter) {
          gap = Math.max(sz * GAP_TIGHT, (arcLenMax - ink) / unitSum);
          gaps = units.map((u) => u * gap);
          total = ink + gaps.reduce((a, b) => a + b, 0);
        } else {
          // 先收普通字距，括号间距保持不松
          const specialSum = units.reduce((a, u) => a + specialUnit(u) * specialBase, 0);
          gap = normalCount > 0
            ? Math.max(sz * GAP_TIGHT, (arcLenMax - ink - specialSum) / normalCount)
            : gap;
          specialBase = Math.min(gap, gapFloor);
          gaps = units.map((u) => (u < 0.999 ? specialUnit(u) * specialBase : gap));
          total = ink + gaps.reduce((a, b) => a + b, 0);
        }
      }
      let sx = SX_FIX;
      if (total > arcLenMax) {
        const punctInk = glyphs.reduce((a, g) => a + (isPunct(g) ? g.w * g.sx : 0), 0);
        const normalInk = glyphs.reduce((a, g) => a + (g.kind === 'normal' ? g.w : 0), 0) || 1e-6;
        const gapSum = gaps.reduce((a, b) => a + b, 0);
        const room = arcLenMax - gapSum - punctInk;
        sx = Math.max(SX_MIN, Math.min(SX_FIX, room / normalInk));
        ink = inkAt(sx);
        total = ink + gapSum;
        if (total > arcLenMax) return null;
      }
      return {
        size: sz, sx, gapMm: gap, r: rr,
        glyphs: glyphs.map((g) => ({ ...g, sx: g.kind === 'normal' ? sx : g.sx })),
        gaps,
        textW: ink, arcLen: total, arcDeg: (total / rr) * 180 / Math.PI,
        gapTrimmed: gap < GAP_PREF - 1e-6,
      };
    }

    let fit = fitAt(target);
    let shrunk = false;
    if (!fit) {
      // 字号二分：保留最大的字高，横向比例在 49%～65% 之间尽量舒展
      let lo = 1.5;
      let hi = target;
      for (let k = 0; k < 24; k++) {
        const mid = (lo + hi) / 2;
        if (fitAt(mid)) lo = mid; else hi = mid;
      }
      fit = fitAt(lo) || fitAt(1.5) || fitAt(target);
      shrunk = true;
    }
    if (!fit) {
      // 极端兜底：按最窄字形均分，宁可字距为 0 也不溢出模板
      const em = emOf(target);
      const glyphs = metrics.map((m) => {
        const kind = glyphKind(m.ch);
        return { ch: m.ch, w: m.w * em, dx: m.dx * em, kind, sx: kind === 'normal' ? SX_MIN : 1 };
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
      return document.fonts.load(`${SEAL_WEIGHT} 40px "Noto Serif SC"`, text || '印').then(() => {
        metricsCache.clear();
      }).catch(() => {});
    }
    return Promise.resolve();
  }

  global.SealMeta = { nameLayout, nameFit, glyphMetrics, toSlug, loadFont, FONT_SONG, SEAL_WEIGHT };
})(typeof window !== 'undefined' ? window : globalThis);
