/* 名称排版与文件名工具：页面提示和服务端渲染共用这一份，避免两套口径。 */
(function (global) {
  'use strict';

  // 名称排版：算字高、横向比例、字距。render 和 nameFit 共用这一份，口径不会跑偏
  //   官方样张：字高 5.1mm、不压窄、字距约 1mm（≈0.2 倍字高）
  //   默认字高 6.75mm、离内边 0.9mm，字距先保 2.6mm；名称短时角度按实际占用算。
  //   排不下先横向压窄字形（下限 49%），再收字距（下限 1mm），最后才缩字高。
  function nameLayout(o) {
    const chars = Array.from(o.name || '');
    const n = chars.length;
    const R = (o.diameter || 42) / 2;
    const border = o.border != null ? o.border : 1.2;
    // 环排角度按名称长度算，不再固定 274°/240°：名称短就占小弧段，
    // 名称长才一路涨到模板上限。上限 274° 依据 DB11/T 918—2012 7.2.1
    // （环排角度 250°～270°）与官方样张实测；带中心章名的专用章收到 240°，
    // 否则名称会绕下来压到章名。
    const arcMax = o.arc || 274;
    const outerGap = o.nameOuterGap != null ? Math.max(0, +o.nameOuterGap) : 0.9;
    const outer = R - border - outerGap;
    const target = o.nameSize || 6.75;
    // 字宽按宋体实测：字高 size 对应字号 size/0.88。横向比例用 0.66，
    // 落到墨迹上约为字高的 0.75，看着是竖长瘦体；0.75 时接近方块，字少时发胖。
    // 锁死横向比例，字不随弧长变宽。
    const charW = (sz) => sz / 0.88;
    const SX_FIX = 0.66;
    // 字距默认 2mm；页面/服务端可以按版本传 nameGapPref 覆盖，做版式对比时不用改算法
    const GAP_PREF = o.nameGapPref != null ? Math.max(0, +o.nameGapPref) : 2.6;
    // 字距优先让位给字高：名称长时字距可以一路收到 0，排不下才缩字高。
    const GAP_MIN = 0;
    const SX_MIN = 0.49;

    if (o.nameGapMm != null) {
      // 手动模式：字高、字距按用户给的锁死，压窄和缩字高只用来兜底。
      // 弧段角度同样按实际占用算，名称短自然就短。
      const SX_MAX_M = 0.66;
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

    // 自动模式：字高、字距、字形比例三项锁死。短名称不放大、不摊开，
    // 弧段角度按名称实际占用算；涨到模板上限才依次压窄字形、收字距、缩字高。
    const gaps = Math.max(0, n - 1);
    let size = target;
    let r = outer - size / 2;
    let textUnit = n * charW(size);
    let sx = SX_FIX;
    let gapMm = n > 1 ? GAP_PREF : 0;
    const span = () => ((textUnit * sx + gaps * gapMm) / r) * 180 / Math.PI;
    let deg = span();
    if (deg > arcMax && n > 1) {
      const avail = (arcMax * Math.PI / 180) * r;
      sx = Math.max(SX_MIN, (avail - gaps * gapMm) / textUnit);
      deg = span();
      if (deg > arcMax) {
        gapMm = Math.max(GAP_MIN, (avail - textUnit * sx) / gaps);
        deg = span();
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
    }
    const arcLen = r * (deg * Math.PI / 180);
    return {
      size, sx, gapMm, r, arcLen, textW: textUnit * sx, arcDeg: deg, outerGap,
      manual: false, clamped: false, shrunk: size < target - 1e-6,
      sizeFixed: size >= target - 1e-6,
      sxMin: SX_MIN, sxMax: SX_FIX,
    };
  }

  // 名称实际字高：和 render 共用 nameLayout，报告字高、横向比例、字距

  function nameFit(o) {
    const chars = Array.from(o.name || '');
    if (!chars.length) {
      return { size: o.nameSize || 7.0, sx: 1, gapMm: 0, chars: 0, shrunk: false, arcMm: 0, needMm: 0, arcUsed: o.arc || 260, arcDeg: o.arc || 260 };
    }
    const lay = nameLayout(o);
    const target = o.nameSize || 6.75;
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

  global.SealMeta = { nameLayout, nameFit, toSlug };
})(typeof window !== 'undefined' ? window : globalThis);
