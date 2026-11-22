/* seal-code.js — 印章防伪编码：结构、生成、校验
 *
 * 公章下弧那串数字不是随便编的，它是公安备案系统的发号记录：
 *
 *   13 位 = 行政区划(6) + 印章类别(1) + 发号流水(5) + 校验位(1)
 *   14 位 = 行政区划(6) + 印章类别(1) + 发号流水(6) + 校验位(1)
 *
 * 区划：GB/T 2260 六位码，和统一社会信用代码第 3-8 位同源 —— 这两处能互相对上。
 * 类别：见 TYPES，1 是单位公章，财务 2、合同 3、发票 4、法人名章 5……
 * 流水：发号系统的自增序号，只有发号库里有。任何公开信息都推不出来，
 *       所以这里用确定性哈希生成"结构合规"的占位值 —— 看着像，但不是备案号。
 * 校验：各省实现不统一（加权模11 / 加权模10 / ISO 7064 都见过），
 *       PROFILES 里放三种候选，默认 w1mod11。真实编码的校验位算不对很正常，
 *       所以 validate 只顺带看一眼，不拿它否定手填的编码。
 *
 * 这一层只保证"结构合法"，不保证"号码存在"。正式对外用备案编码。
 */
(function (global) {
  'use strict';

  var TYPES = {
    0: '未标注（部分系统保留）',
    1: '单位公章',
    2: '财务专用章',
    3: '合同专用章',
    4: '发票专用章',
    5: '法定代表人名章',
    6: '报关专用章',
    7: '业务专用章',
    8: '其他专用章'
  };

  /* 页面上的模板 → 类别码。两行专用章不刻编码，给 null。 */
  var TEMPLATE_TYPE = {
    standard: 1,
    contract: 3,
    finance: 2,
    invoice: 4,
    twoline: null
  };

  /* 校验位算法。digit(body) 返回 0-9 的一位数。 */
  var PROFILES = {
    w1mod11: {
      label: '加权模11（权 1..n）',
      digit: function (body) {
        var s = 0;
        for (var i = 0; i < body.length; i += 1) s += Number(body[i]) * (i + 1);
        var c = (11 - (s % 11)) % 11;
        return c === 10 ? 0 : c;
      }
    },
    w2mod10: {
      label: '加权模10（权 2..10 循环）',
      digit: function (body) {
        var s = 0;
        for (var i = 0; i < body.length; i += 1) s += Number(body[i]) * (2 + (i % 9));
        return (10 - (s % 10)) % 10;
      }
    },
    iso7064: {
      label: 'ISO 7064 MOD 11,10',
      digit: function (body) {
        var p = 10;
        for (var i = 0; i < body.length; i += 1) {
          var s = (p + Number(body[i])) % 10;
          if (s === 0) s = 10;
          p = (2 * s) % 11;
        }
        return (11 - p) % 10;
      }
    }
  };

  var DEFAULT_PROFILE = 'w1mod11';

  /* FNV-1a：确定性哈希，同一个种子永远给同一个流水，避免边打字边换号 */
  function hash(seed) {
    var h = 0x811c9dc5;
    for (var i = 0; i < seed.length; i += 1) {
      h ^= seed.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h >>> 0;
  }

  function serialFrom(seed, n) {
    var out = '';
    var h = hash(seed || 'seal');
    while (out.length < n) {
      h = (h * 1664525 + 1013904223) >>> 0;
      out += String(h % 10);
    }
    // 全 0 的流水不像发过号，换成 1 打头
    if (/^0+$/.test(out)) out = '1' + out.slice(1);
    return out;
  }

  var regionSet = null;
  function regionKnown(code6) {
    if (!code6 || code6.length !== 6) return false;
    if (regionSet === null) {
      var rows = (global.SEAL_DIVISIONS && global.SEAL_DIVISIONS.length) ? global.SEAL_DIVISIONS : null;
      if (!rows) return false; // 表还没加载，先不下结论
      regionSet = Object.create(null);
      for (var i = 0; i < rows.length; i += 1) {
        if (rows[i] && rows[i][1]) regionSet[String(rows[i][1])] = true;
      }
    }
    return regionSet[code6] === true;
  }

  /**
   * 拼一个结构合规的占位编码。
   * @param {object} o {region:6位, type:1-8, len:13|14, seed, salt, profile}
   * @returns {{code:string, parts:object, profile:string}} 区划不合法时 code 为空
   */
  function generate(o) {
    o = o || {};
    var region = String(o.region || '').replace(/\D/g, '').slice(0, 6);
    if (region.length !== 6) throw new Error('行政区划要 6 位');
    var type = Number(o.type);
    if (!TYPES[type]) type = 1;
    var len = Number(o.len) === 14 ? 14 : 13;
    var profile = PROFILES[o.profile] ? o.profile : DEFAULT_PROFILE;
    var serialLen = len - 6 - 1 - 1;

    var serial = serialFrom(
      [o.seed || '', region, type, o.salt || ''].join('|'),
      serialLen
    );
    var body = region + type + serial;
    var code = body + String(PROFILES[profile].digit(body));

    return {
      code: code,
      profile: profile,
      parts: {
        region: region,
        type: type,
        typeName: TYPES[type],
        serial: serial,
        check: code.slice(-1)
      }
    };
  }

  /** 拆结构。不看校验位对不对，只拆位。 */
  function parse(code) {
    var d = String(code || '').replace(/\D/g, '');
    if (d.length !== 13 && d.length !== 14) {
      return { ok: false, reason: '编码只能 13 或 14 位，当前 ' + d.length + ' 位' };
    }
    return {
      ok: true,
      code: d,
      len: d.length,
      region: d.slice(0, 6),
      type: Number(d[6]),
      typeName: TYPES[Number(d[6])] || '类别码未定义',
      serial: d.slice(7, -1),
      check: d.slice(-1)
    };
  }

  /**
   * 结构体检。regionOk 只在区划表已加载时才下结论。
   * 手填的真实编码大概率过不了 checkOk —— 各省算法不同，这一项不要拿来否定编码。
   */
  function validate(code, opts) {
    opts = opts || {};
    var p = parse(code);
    if (!p.ok) return { ok: false, reason: p.reason, lenOk: false, regionOk: false, typeOk: false, checkOk: false };
    var regionOk = regionKnown(p.region);
    var typeOk = !!TYPES[p.type];
    var profile = PROFILES[opts.profile] ? opts.profile : DEFAULT_PROFILE;
    var body = p.code.slice(0, -1);
    var checkOk = String(PROFILES[profile].digit(body)) === p.check;
    var reasons = [];
    if (!TYPES[p.type]) reasons.push('第 7 位类别码不在 1-8 之内');
    if (regionOk === false && global.SEAL_DIVISIONS) reasons.push('前 6 位不在现行区划表里（也可能是撤销的旧码）');
    return {
      ok: reasons.length === 0,
      reason: reasons.join('；'),
      lenOk: true,
      regionOk: regionOk,
      typeOk: typeOk,
      checkOk: checkOk,
      profile: profile,
      parts: p
    };
  }

  /** 一句话说明编码结构，给界面用。 */
  function describe(code) {
    var p = parse(code);
    if (!p.ok) return p.reason;
    return [
      '区划 ' + p.region,
      '类别 ' + p.type + '（' + p.typeName + '）',
      '流水 ' + p.serial,
      '校验 ' + p.check
    ].join(' · ');
  }

  function templateType(profile) {
    var t = TEMPLATE_TYPE[profile];
    return typeof t === 'number' ? t : 1;
  }

  global.SealCode = {
    TYPES: TYPES,
    TEMPLATE_TYPE: TEMPLATE_TYPE,
    PROFILES: PROFILES,
    DEFAULT_PROFILE: DEFAULT_PROFILE,
    generate: generate,
    parse: parse,
    validate: validate,
    describe: describe,
    templateType: templateType,
    regionKnown: regionKnown
  };
})(typeof window !== 'undefined' ? window : globalThis);