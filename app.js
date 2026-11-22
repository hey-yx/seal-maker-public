(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const meta = $('meta');

  const PRESETS = {
    contract: { px: 1000, tex: 0, diameter: 42, nameSize: 6.5, arc: 245, color: '#DA251D', jitter: 0, star: false, line1: '合同专用章', line2: '', lineSize: 4.9, edgeAmp: 0.01, nicks: 0, specks: 0 },
    finance: { px: 1000, tex: 0, diameter: 42, nameSize: 6.5, arc: 245, color: '#DA251D', jitter: 0, star: false, line1: '财务专用章', line2: '', lineSize: 4.9, edgeAmp: 0.01, nicks: 0, specks: 0 }
  };

  // 直径 → 国标几何（DB11/T 918-2021 6.2.1）：42mm 边宽 1.2、五角星 14；
  // 40mm 边宽 1.1、五角星 13。名称字高 6.5 和环排角度两种直径共用。
  const GEOMETRY = {
    42: { border: 1.185, starWidth: 14.2 },
    40: { border: 1.1, starWidth: 13 }
  };
  const geomFor = (d) => GEOMETRY[d] || GEOMETRY[42];

  const PRESET_LABELS = {
    contract: '合同专用章',
    finance: '财务专用章'
  };

  const PXMM = 600 / 25.4; // 600 dpi 下每毫米像素；导出尺寸按它算
  // 公开版开放的四种：合同/财务各标准与实盖，单张下载所选。
  const ENABLED_STYLES = [
    { profile: 'contract', fresh: false, template: '合同专用章', look: '标准' },
    { profile: 'contract', fresh: true, template: '合同专用章', look: '实盖扫描' },
    { profile: 'finance', fresh: false, template: '财务专用章', look: '标准' },
    { profile: 'finance', fresh: true, template: '财务专用章', look: '实盖扫描' }
  ];

  const state = {
    seed: 7,
    // 合同/财务专用章带不带星：{} 表示跟随模板默认（官方无星），
    // 勾过之后按模板分别记住，切走再切回还是用户选的那个
    starOverride: {},
  };

  // 一次生成出四种可用样式：缓存每张的 blob 和 object URL，选哪张下载哪张
  let lastSet = null;
  let generating = false;


  const params = new URLSearchParams(location.search);

  // 表单只存当前标签页的 sessionStorage：刷新还在，关掉标签页就清空。
  const FORM_KEY = 'seal-maker-lite:form:v1';
  const LEGACY_FORM_KEY = 'seal-maker-lite:form:v0';
  const CODES_KEY = 'seal-maker-lite:codes';
  // 旧版页面预填过的示例编码。首次加载时识别并丢掉，避免新用户打开就看到旧示例。
  const LEGACY_DEFAULT_CODE = '3708273102877';
  let hintTimer = 0;

  // 编码来源：preset（初始示例，可直接被自动编号替换）、auto（按行政区划拼的占位号）、
  // manual（手填或粘贴的真实编码）、memory（按企业名带出的旧编码）、empty（空）
  let codeSource = 'preset';

  let lastAutoAt = 0;

  function randomDigits(n) {
    const out = [];
    if (window.crypto && window.crypto.getRandomValues) {
      const buf = new Uint8Array(n);
      window.crypto.getRandomValues(buf);
      for (const b of buf) out.push(String(b % 10));
    } else {
      for (let i = 0; i < n; i += 1) out.push(String(Math.floor(Math.random() * 10)));
    }
    return out.join('');
  }

  function codeLocked() {
    return codeSource === 'manual' || codeSource === 'memory';
  }

  function setState(msg) {
    const el = $('codeHint');
    if (!el) return;
    clearTimeout(hintTimer);
    el.textContent = msg;
    el.hidden = !msg;
  }

  function hint(msg) {
    setState(msg);
    hintTimer = setTimeout(() => { $('codeHint').hidden = true; }, 5000);
  }

  // 表单读写：sessionStorage 为主；被浏览器禁用时退回 localStorage，至少别丢。
  function readSession(key) {
    try { return sessionStorage.getItem(key); } catch (e) { return null; }
  }

  function writeSession(key, value) {
    try { sessionStorage.setItem(key, value); return true; } catch (e) { return false; }
  }

  function readFormRaw() {
    const raw = readSession(FORM_KEY);
    if (raw) return raw;
    try { return localStorage.getItem(FORM_KEY); } catch (e) { return null; }
  }

  function writeFormRaw(raw) {
    writeSession(FORM_KEY, raw);
    // 再留一份 localStorage 备份：关掉标签页重新打开时不至于全空；
    // sessionStorage 被禁用时它也是唯一能用的一份
    try {
      localStorage.setItem(FORM_KEY, raw);
      localStorage.removeItem(LEGACY_FORM_KEY);
    } catch (e) { /* 忽略隐私模式报错 */ }
  }

  // 旧版表单只搬一次：写进 sessionStorage 成功后再删，失败就留在原处
  function takeLegacyForm() {
    let raw = null;
    try { raw = localStorage.getItem(LEGACY_FORM_KEY); } catch (e) { return null; }
    if (!raw) return null;
    if (writeSession(FORM_KEY, raw)) {
      try { localStorage.removeItem(LEGACY_FORM_KEY); } catch (e) { /* 忽略 */ }
    }
    return raw;
  }

  function readCodes() {
    try { return JSON.parse(localStorage.getItem(CODES_KEY) || '{}') || {}; }
    catch (e) { return {}; }
  }

  function rememberCode(name, code) {
    if (!name || name.length < 4 || !/(公司|中心|厂|店|工作室|合作社|事务所|研究院)/.test(name)) return;
    if (!/^\d{13,14}$/.test(code)) return;
    try {
      const map = readCodes();
      if (map[name] === code) return;
      map[name] = code;
      localStorage.setItem(CODES_KEY, JSON.stringify(map));
    } catch (e) { /* 忽略隐私模式报错 */ }
  }

  function recallCode(name) {
    return name ? readCodes()[name] || '' : '';
  }

  function setCode(value, source) {
    $('code').value = value;
    if (source) codeSource = source;
    render();
    persist();
  }

  // 输入企业名或经营地址：先看本地记住的编码；没有就按地址里的区县拼一个完整的
  // 占位号（前 6 位行政区划 + 后 7 位随机，14 位编码则后 8 位）。手填的编码永远不覆盖。
  // 地址比企业名更具体：两边都识别到行政区划时，取等级更深的那个（区县 > 地市 > 省）。
  // 每一支都留一句提示：没换号也要说清为什么，不能点完地址什么都不发生。
  function applyNameRegion(opts) {
    if ($('noCode') && $('noCode').checked) return;
    const force = !!(opts && opts.force);
    const fromInput = !!(opts && opts.fromInput);
    const name = $('name').value.trim();
    const address = $('address').value.trim();
    if (!name && !address) return;
    const cur = $('code').value.replace(/\D/g, '');

    const remembered = recallCode(name);
    if (!force && !codeLocked() && remembered && cur !== remembered) {
      setCode(remembered, 'memory');
      hint('已按企业名带出上次填的编码');
      return;
    }

    loadDivisions().then((data) => {
      const fromName = name ? detectDivision(name, data) : null;
      const fromAddr = address ? detectDivision(address, data) : null;
      const useAddr = !!fromAddr && (!fromName || fromAddr.level >= fromName.level);
      const hit = useAddr ? fromAddr : fromName;
      const now = $('code').value.replace(/\D/g, '');
      const src = useAddr ? '经营地址' : '企业名';
      if (!hit) {
        if (divisionRowsMissing) {
          hint('行政区划表没加载出来，编码请按回执手填');
          return;
        }
        if (codeSource === 'auto') setCode('', 'empty');
        if (fromInput || codeSource === 'auto') hint('名称和地址里都没识别到行政区划，编码请按回执手填');
        return;
      }
      const prefix = hit.code.slice(0, 6);
      // 同一地区重复输入名称、或刷新后恢复时，保留已生成的随机号，避免每敲一个字换一次；
      // 初始示例号如果前缀本来就对，也保留（很多人的示例就是自己的真实编码）
      if (!force && now.slice(0, 6) === prefix) {
        // 刚生成完的那一下不要再盖一句“已经对了”，把生成提示留给人看
        if (fromInput && Date.now() - lastAutoAt > 1200 && (codeSource === 'auto' || codeSource === 'preset')) {
          hint(`编码前 6 位已是${hit.name}（${prefix}），不用重拼`);
        }
        return;
      }
      // 手填或按企业名带出的编码不覆盖，但得说清楚怎么换，不能静默；点「换号」时 force 直接过
      if (!force && codeLocked()) {
        // 编码本身不合法时，先把长度问题摆出来；不然“没覆盖”会把真正的原因盖掉
        if (!codeOk($('code').value)) {
          updateCodeState($('code').value, $('preset').value);
          return;
        }
        const why = codeSource === 'memory' ? '按企业名带出的编码' : '手填的编码';
        hint(`${why}没有覆盖；要按${src}里的${hit.name}（${prefix}）重拼请点「随机生成」`);
        return;
      }
      const total = now.length === 14 ? 14 : 13;
      // 结构合规的占位号：区划(6)+类别(1)+流水+校验。
      // 流水由企业名确定性生成，同一个名字每次都是同一号；点「换号」时把时间掺进种子才会变。
      const made = window.SealCode
        ? window.SealCode.generate({
          region: prefix,
          type: window.SealCode.templateType($('preset').value),
          len: total,
          seed: name || address || prefix,
          salt: force ? String(Date.now()) : ''
        })
        : null;
      const next = made ? made.code : prefix + randomDigits(total - 6);
      setCode(next, 'auto');
      lastAutoAt = Date.now();
      // 直辖市在表里是省级，但码就是城市码，提示按地市说
      const lv = hit.level === 1 && /^(北京|上海|天津|重庆)市$/.test(hit.name) ? 2 : hit.level;
      if (lv === 3) {
        hint(`已按${src}里的${hit.name}（${prefix}）拼好 ${total} 位占位号：区划+类别+流水+校验，流水是虚构值`);
      } else if (lv === 2) {
        hint(`已按${src}里的${hit.name}（${prefix}）拼好占位号；备案在区县的话按回执改前 6 位`);
      } else {
        hint(`已按${src}里的${hit.name}（${prefix}）拼好占位号；前 6 位请按回执填到区县`);
      }
    });
  }

  // 行政区划表：data/divisions.js 里的 window.SEAL_DIVISIONS，[名称, 6 位代码, 层级, 上级名称]。
  // 用脚本加载而不是 fetch：双击 index.html 走 file://，fetch 会被浏览器拦掉，
  // 编码就永远拼不出来。
  let divisions = null;
  let divisionRowsMissing = false;

  function loadDivisions() {
    if (!divisions) {
      const rows = Array.isArray(window.SEAL_DIVISIONS) ? window.SEAL_DIVISIONS : [];
      divisionRowsMissing = rows.length === 0;
      divisions = divisionIndex(rows);
    }
    return Promise.resolve(divisions);
  }

  // 公司名通常只写“杭州”“上海”，不带“市/区/县”，所以每个区划同时收全名和别名。
  const AUTO_REGION = {
    '内蒙古自治区': '内蒙古',
    '广西壮族自治区': '广西',
    '西藏自治区': '西藏',
    '宁夏回族自治区': '宁夏',
    '新疆维吾尔自治区': '新疆',
    '香港特别行政区': '香港',
    '澳门特别行政区': '澳门'
  };
  const DIV_SUFFIX = ['特别行政区', '自治区', '自治州', '自治县', '自治旗', '开发区', '新区', '林区', '地区', '矿区', '特区', '省', '市', '盟', '区', '县', '旗', '州'];
  const ETHNIC = ['蒙古', '维吾尔', '哈萨克', '柯尔克孜', '朝鲜', '土家', '布依', '哈尼', '傈僳', '拉祜', '纳西', '景颇', '达斡尔', '仫佬', '仡佬', '锡伯', '阿昌', '普米', '塔吉克', '乌孜别克', '俄罗斯', '鄂温克', '德昂', '保安', '裕固', '塔塔尔', '独龙', '鄂伦春', '赫哲', '门巴', '珞巴', '基诺', '布朗', '撒拉', '毛南', '东乡', '白', '回', '藏', '苗', '彝', '壮', '满', '侗', '瑶', '黎', '佤', '畲', '高山', '水', '土', '羌', '怒', '京', '傣'];
  ETHNIC.sort((a, b) => b.length - a.length);

  function regionAliases(name) {
    const out = new Set([name]);
    if (AUTO_REGION[name]) out.add(AUTO_REGION[name]);
    let base = name;
    for (let i = 0; i < 4; i += 1) {
      const suf = DIV_SUFFIX.find((s) => base.length > s.length + 1 && base.endsWith(s));
      if (!suf) break;
      base = base.slice(0, -suf.length);
      out.add(base);
    }
    // 自治州、自治县的民族名一起去掉：延边朝鲜族自治州 → 延边
    for (let i = 0; i < 12; i += 1) {
      if (base.length > 3 && base.endsWith('族')) {
        base = base.slice(0, -1);
        out.add(base);
        continue;
      }
      const eth = ETHNIC.find((e) => base.length > e.length + 1 && base.endsWith(e));
      if (!eth) break;
      base = base.slice(0, -eth.length);
      out.add(base);
    }
    return [...out].filter((a) => a.length >= 2);
  }

  function divisionIndex(rows) {
    const counts = {};
    const aliasOf = {};
    for (const row of rows) {
      counts[row[0]] = (counts[row[0]] || 0) + 1;
      aliasOf[row[0]] = regionAliases(row[0]);
    }
    const aliases = [];
    for (const row of rows) {
      for (const a of aliasOf[row[0]]) if (a !== row[0]) aliases.push({ a, row });
    }
    aliases.sort((x, y) => y.a.length - x.a.length);
    return { rows, counts, aliasOf, aliases };
  }

  // 先找区划全名（区县优先于地市、省级），没有再按别名匹配
  function detectDivision(text, data) {
    if (!text || !data || !data.rows.length) return null;
    let exact = null;
    for (const row of data.rows) {
      const pos = text.indexOf(row[0]);
      if (pos < 0) continue;
      if (data.counts[row[0]] > 1 && row[3] && !text.includes(row[3])) continue;
      if (!exact || row[2] > exact.level || (row[2] === exact.level && row[0].length > exact.name.length)) {
        exact = { name: row[0], code: row[1], level: row[2], pos, matched: row[0] };
      }
    }
    if (exact) return exact;

    const byName = new Map();
    for (const item of data.aliases) {
      const pos = text.indexOf(item.a);
      if (pos < 0) continue;
      const row = item.row;
      // 上级地名要真的另外出现：乌鲁木齐县的别名就是“乌鲁木齐”，
      // 不能因为它自己的别名等于上级别名，就当成上级也写了
      const parentNames = row[3] ? (data.aliasOf[row[3]] || [row[3]]).filter((x) => x !== item.a) : [];
      const parentSeen = parentNames.some((x) => text.includes(x));
      // 两字的区县名太容易撞上普通词（东方财富、仙桃），要上级地名一起出现才认
      if (row[2] >= 3 && item.a.length < 3 && !parentSeen) continue;
      const cand = { name: row[0], code: row[1], level: row[2], pos, matched: item.a, parentSeen };
      const cur = byName.get(item.a);
      if (!cur) byName.set(item.a, cand);
      else if (cand.parentSeen && !cur.parentSeen) byName.set(item.a, cand);
      else if (cand.parentSeen === cur.parentSeen && cand.level < cur.level) byName.set(item.a, cand);
    }
    if (!byName.size) return null;
    return [...byName.values()]
      .sort((a, b) => (b.level - a.level) || (b.matched.length - a.matched.length) || (a.pos - b.pos))[0];
  }

  // 从整段文本里找 13 或 14 位编码、带公司后缀的名称行和经营地址
  function extractFromText(text) {
    const out = { name: '', code: '', address: '' };
    const m = text.match(/(?:^|[^0-9A-Za-z])(\d{13,14})(?![0-9A-Za-z])/);
    if (m) out.code = m[1];
    const am = text.match(/(?:住所|经营场所|营业场所|注册地址|经营地址|地址)\s*[:：]\s*([^\r\n]{4,80})/);
    if (am) out.address = am[1].replace(/[，,；;\s]+$/, '').trim();
    const lines = text.split(/[\r\n]+/).map((s) => s.trim()).filter(Boolean);
    for (const line of lines) {
      const cleaned = line
        .replace(/^(企业名称|公司名称|名称|单位名称)[:：]\s*/, '')
        .replace(/^(统一社会信用代码|注册号|法定代表人|经营者)[:：].*$/, '')
        .trim();
      if (cleaned.length < 4 || cleaned.length > 40) continue;
      if (!/(公司|中心|厂|店|工作室|合作社|事务所|研究院)/.test(cleaned)) continue;
      if (/^(住所|地址|经营场所|营业场所|注册地址|经营地址)/.test(cleaned)) continue;
      out.name = cleaned;
      break;
    }
    return out;
  }

  function readForm() {
    const profile = PRESETS[$('preset').value] ? $('preset').value : 'contract';
    const p = PRESETS[profile];
    return {
      name: $('name').value.trim(),
      address: $('address').value.trim(),
      line1: $('line1').value.trim(),
      line2: $('line2').value.trim(),
      color: $('color').value || '#DA251D',
      code: $('code').value.replace(/\D/g, '').slice(0, 14),
      noCode: !!($('noCode') && $('noCode').checked),
      fresh: $('look').value === 'fresh',
      diameter: +$('diameter').value === 40 ? 40 : 42,
      nameSize: p.nameSize,
      arc: p.arc,
      star: starForProfile(profile),
      texture: p.tex,
      px: 1000,
      profile,
    };
  }

  // 带不带星：合同/财务可由右上角的勾选框改，其余模板固定按预设
  function starForProfile(profile) {
    const over = state.starOverride[profile];
    if (typeof over === 'boolean') return over;
    return (PRESETS[profile] || PRESETS.contract).star;
  }

  function starToggleAvailable(profile) {
    return profile === 'contract' || profile === 'finance';
  }

  function syncStarToggle() {
    document.querySelectorAll('.star-badge').forEach((el) => {
      const on = starForProfile(el.dataset.starFor) === true;
      el.classList.toggle('is-on', on);
      el.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  // 公开版只有合同/财务，勾选“不刻编码”时可以不填，否则必须 13 或 14 位
  function codeOk(code, noCode) {
    if (noCode) return true;
    return /^\d{13,14}$/.test(code);
  }

  function updateNameState(f, fromFontLoad) {
    const el = $('nameHint');
    if (!el) return;
    const arc = f.noCode ? 255 : (f.arc || 260);
    const m = SealMeta.nameFit({
      name: f.name, nameSize: f.nameSize, arc, border: geomFor(f.diameter).border,
      diameter: f.diameter, noCode: !!f.noCode, line1: f.line1
    });
    if (!m.chars) { el.hidden = true; return; }
    el.hidden = false;
    // 6.5mm 是国标区间的下限，掉到它下面说明名称太长，只能缩字高
    const stdSize = m.size >= 6.49 ? '（标准 6.5～8\u00A0mm）' : '（超长，已压到下限以下）';
    // 名称首末与底部编码的间隔：编码占 232°–307°（75°），剩下两段对称分给左右
    const clearDeg = Math.max(0, (360 - 75 - m.arcDeg) / 2);
    const clearMm = ((clearDeg * Math.PI) / 180 * m.r).toFixed(1);
    const hasCode = !f.noCode && !!f.code;
    const arcTail = hasCode ? `环排 ${m.arcDeg}°，距编码 ${clearMm}\u00A0mm` : `环排 ${m.arcDeg}°`;
    // 字高不动，靠字形宽度（49%～75%）和字距一起铺满弧长
    el.textContent = `${m.chars} 字，字高 ${m.size}\u00A0mm${stdSize}，字形宽度 ${Math.round(m.sx * 100)}%，字距 ${m.gapMm}\u00A0mm，${arcTail}`;
    if (!fromFontLoad && SealMeta.loadFont) {
      SealMeta.loadFont(f.name).then(() => {
        const cur = readForm();
        if (cur.name === f.name) updateNameState(cur, true);
      });
    }
  }

  function updateCodeState(code, profile, noCode) {
    const off = !!noCode;
    const codeInput = $('code');
    if (codeInput) codeInput.disabled = off;
    const regen = $('regenCode');
    if (regen) regen.disabled = off;
    const note = $('codeAutoNote');
    if (off) {
      const gen = $('generate');
      if (gen) gen.disabled = generating;
      if (note) { note.textContent = ''; note.hidden = true; }
      setState('');
      return;
    }
    const ok = codeOk(code, false);
    const gen = $('generate');
    if (gen) gen.disabled = !ok || generating;
    if (note) {
      if (codeSource === 'auto' && code) {
        const serialLen = code.length - 8;
        note.textContent = `占位号：区划(6)+类别(1)+流水(${serialLen})+校验(1)，结构与备案编码一致；流水为虚构值，不是备案编号。正式使用请换成真实编号。`;
        note.hidden = false;
      } else {
        // 手填的编码：只做区划体检，不拿校验位否定它 —— 各省算法不同，算不对很正常
        const hit = code && window.SealCode ? window.SealCode.validate(code) : null;
        if (hit && hit.lenOk && hit.regionOk === false && window.SEAL_DIVISIONS) {
          note.textContent = `前 6 位 ${hit.parts.region} 不在现行区划表里；撤销的旧区划码不影响刻制。`;
          note.hidden = false;
        } else {
          note.textContent = '';
          note.hidden = true;
        }
      }
    }
    if (ok) { setState(''); return; }
    if (!code) { setState(''); return; }
    if (code.length === 6) setState(`已填区号 ${code}，还差类别 1 位 + 流水 5 位 + 校验 1 位`);
    else setState(`编码只能 13 或 14 位，当前 ${code.length} 位`);
  }

  function render() {
    const f = readForm();
    const presetName = PRESET_LABELS[f.profile] || '印章';
    const g = geomFor(f.diameter);
    const outPx = Math.round(f.diameter * PXMM);
    const codeNote = f.noCode
      ? '不刻编码'
      : `编码 1.365 mm${codeSource === 'auto' ? ' · 编码为占位号' : ''}`;
    // 每项单独一个不换行的小块，换行只发生在项与项之间，不会留下悬空的“·”
    const metaItems = [
      presetName,
      f.fresh ? '实盖扫描' : '标准',
      `直径 ${f.diameter} mm`,
      `导出 ${outPx} × ${outPx} px`,
      `外圈 ${g.border} mm`,
      f.star ? `五角星 ${g.starWidth} mm` : '无星',
      codeNote
    ];
    meta.replaceChildren(...metaItems.map((text) => {
      const span = document.createElement('span');
      span.className = 'meta-item';
      span.textContent = text;
      return span;
    }));
    const note = $('sizeNote');
    if (note) note.textContent = `名称字高 6.5\u00A0mm、离内边 0.95\u00A0mm 固定；合同章和财务章中心有章名，名称最多 245°，字距按名称长度在 1.35～2.6\u00A0mm 之间调节。括号按墨宽排版，仍放不下才压窄字形、缩字高。下载的 PNG 是一枚 ${f.diameter}\u00A0mm 章，插进文档按 ${(f.diameter / 10).toFixed(1)}\u00A0cm 放。`;
    updateNameState(f);
    updateCodeState(f.code, f.profile, f.noCode);
    markStale(f);
  }

  // 表单指纹：用于判断四张图是否过期。模板和质感不在里面，切卡不算改参数
  function buildPayload(f) {
    return {
      name: f.name,
      code: f.noCode ? '' : (codeOk(f.code) ? f.code : ''),
      noCode: !!f.noCode,
      color: f.color,
      diameter: f.diameter,
      stars: {
        contract: starForProfile('contract') === true,
        finance: starForProfile('finance') === true
      },
      seed: state.seed
    };
  }

  // 本地渲染参数：模板常量 + 当前表单；预览和下载同一套
  function renderOpts(f) {
    const p = PRESETS[f.profile];
    const o = {
      profile: f.profile,
      name: f.name,
      line1: f.line1,
      line2: f.line2,
      code: f.noCode ? '' : (codeOk(f.code) ? f.code : ''),
      color: f.color,
      jitter: p.jitter,
      diameter: f.diameter,
      border: geomFor(f.diameter).border,
      starWidth: geomFor(f.diameter).starWidth,
      nameSize: f.nameSize,
      arc: f.noCode ? 255 : p.arc,
      texture: p.tex,
      fresh: f.fresh,
      px: 1000,
      star: f.star,
      edgeAmp: p.edgeAmp,
      nicks: p.nicks,
      specks: p.specks,
      seed: state.seed
    };
    if (p.lineSize) o.lineSize = p.lineSize;
    return o;
  }

  function syncChoices() {
    const preset = $('preset').value;
    const look = $('look').value;
    document.querySelectorAll('#comboGallery .opt').forEach((btn) => {
      const enabled = !!PRESETS[btn.dataset.preset];
      const on = enabled && btn.dataset.preset === preset && btn.dataset.look === look;
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.setAttribute('aria-disabled', enabled ? 'false' : 'true');
    });
  }

  // 合同/财务的样张有两版：带星和不带星，切星标时换图。
  // 已经换成真实生成结果的卡不再改回样张。
  function syncStarSamples() {
    document.querySelectorAll('.opt-img[data-sample-profile]').forEach((img) => {
      const opt = img.closest('.opt');
      if (lastSet && opt && lastSet.items[keyOf(opt)]) return;
      const on = starForProfile(img.dataset.sampleProfile) === true;
      const src = on ? img.dataset.srcOn : img.dataset.srcOff;
      if (src && img.getAttribute('src') !== src) img.src = src;
    });
  }

  function currentSig(f) {
    return JSON.stringify(buildPayload(f || readForm()));
  }

  function keyOf(opt) {
    return `${opt.dataset.preset}-${opt.dataset.look}`;
  }

  function currentKey() {
    return `${$('preset').value}-${$('look').value}`;
  }

  function markStale(f) {
    if (!lastSet) return;
    const stale = currentSig(f) !== lastSet.sig;
    $('preview').classList.toggle('is-stale', stale);
    $('previewStale').hidden = !stale;
    $('download').disabled = stale || !lastSet.items[currentKey()];
  }

  function syncFromUrl() {
    const map = { name: 'name', line1: 'line1', line2: 'line2', code: 'code' };
    for (const [k, id] of Object.entries(map)) {
      if (params.has(k)) $(id).value = params.get(k);
    }
    if (params.has('code')) codeSource = 'manual';
    if (params.get('diameter') === '40' || params.get('diameter') === '42') {
      $('diameter').value = params.get('diameter');
    }
    if (params.has('preset') && PRESETS[params.get('preset')]) {
      $('preset').value = params.get('preset');
    }
    if (params.has('noCode') && $('noCode')) {
      $('noCode').checked = params.get('noCode') === '1' || params.get('noCode') === 'true';
    }

  }

  function persist() {
    const f = readForm();
    let prev = null;
    try { prev = JSON.parse(readFormRaw() || 'null'); } catch (e) { prev = null; }
    writeFormRaw(JSON.stringify(Object.assign({}, f, {
      codeSource,
      starOverride: state.starOverride,
    })));
    // 只有编码这一次真的变了才记，避免换企业名时把上一家的编码记到新名字下；
    // 随机占位号不记，否则下次会把随机数当成真实编码带出来
    if (prev && prev.code !== f.code && codeSource !== 'auto') rememberCode(f.name, f.code);
  }

  function restore() {
    try {
      const raw = readFormRaw() || takeLegacyForm();
      if (!raw) return;
      const f = JSON.parse(raw);
      // 旧版预填示例不再回填；清掉这份缓存，让页面从空表单开始
      if (f.code === LEGACY_DEFAULT_CODE) {
        try {
          sessionStorage.removeItem(FORM_KEY);
          localStorage.removeItem(FORM_KEY);
        } catch (e) { /* 忽略隐私模式报错 */ }
        return;
      }
      if (f.profile && PRESETS[f.profile]) $('preset').value = f.profile;
      if (f.name !== undefined) $('name').value = f.name;
      if (f.address !== undefined) $('address').value = f.address;
      if (f.line1 !== undefined) $('line1').value = f.line1;
      if (f.line2 !== undefined) $('line2').value = f.line2;
      if (f.code !== undefined) $('code').value = f.code;
      if ($('noCode')) $('noCode').checked = !!f.noCode;
      if (f.codeSource) codeSource = f.codeSource;
      else if (f.code) codeSource = 'manual';
      if (!f.code) codeSource = 'empty';
      if (f.fresh === true) $('look').value = 'fresh';
      else if (f.fresh === false) $('look').value = 'clean';
      if (f.color && $('color').querySelector(`option[value="${f.color}"]`)) $('color').value = f.color;
      if (f.diameter === 40 || f.diameter === 42) $('diameter').value = String(f.diameter);
      if (f.starOverride && typeof f.starOverride === 'object') {
        state.starOverride = {};
        ['contract', 'finance'].forEach((k) => {
          if (typeof f.starOverride[k] === 'boolean') state.starOverride[k] = f.starOverride[k];
        });
      }
    } catch (e) { /* 忽略损坏的缓存 */ }
  }

  function applyPreset() {
    const profile = PRESETS[$('preset').value] ? $('preset').value : 'contract';
    $('preset').value = profile;
    const p = PRESETS[profile];
    const fresh = $('look').value === 'fresh';
    $('line1').value = p.line1;
    $('line2').value = p.line2 || '';
    $('twoLineWrap').hidden = true;
    // 换模板只换文案，不动编码
    if (!$('code').value.trim()) codeSource = 'empty';
    syncChoices();
    syncStarToggle();
    render();
    persist();
    if (!$('code').value.trim()) applyNameRegion();
  }

  function fileName(f) {
    const label = (PRESET_LABELS[f.profile] || '印章').split(' · ')[0];
    const tag = f.fresh ? '-实盖扫描' : '';
    const ph = f.noCode ? '-无编码' : (codeSource === 'auto' ? '-占位编码' : '');
    return `${label}-${SealMeta.toSlug(f.name)}-${f.diameter}mm${tag}${ph}.png`;
  }

  // 下载左边大图当前显示的那一张
  function downloadLast() {
    const item = lastSet && lastSet.items[currentKey()];
    if (!item) return;
    const a = document.createElement('a');
    a.href = item.url;
    a.download = item.name;
    a.click();
  }

  function cardImg(key) {
    const [preset, look] = key.split('-');
    const opt = document.querySelector(`#comboGallery .opt[data-preset="${preset}"][data-look="${look}"]`);
    return opt ? opt.querySelector('img') : null;
  }

  async function drawPreview(blob) {
    const c = $('preview');
    const g = c.getContext('2d');
    const bmp = await createImageBitmap(blob);
    g.clearRect(0, 0, c.width, c.height);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(bmp, 0, 0, c.width, c.height);
    if (bmp.close) bmp.close();
  }

  function drawSamplePreview(imgEl) {
    if (!imgEl) return;
    const key = currentKey();
    const paint = () => {
      if (lastSet || currentKey() !== key) return;
      const c = $('preview');
      const g = c.getContext('2d');
      g.clearRect(0, 0, c.width, c.height);
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';
      g.drawImage(imgEl, 0, 0, c.width, c.height);
      $('previewEmpty').hidden = true;
    };
    if (imgEl.complete && imgEl.naturalWidth > 0) paint();
    else imgEl.addEventListener('load', paint, { once: true });
  }

  // 把选中那张画到上方大图；生成前显示对应样式的样张，生成后显示真实出图
  function showSelected() {
    const item = lastSet && lastSet.items[currentKey()];
    const sampleTag = $('previewSampleTag');
    if (item) {
      if (sampleTag) sampleTag.hidden = true;
      drawPreview(item.blob);
      $('previewEmpty').hidden = true;
      return;
    }
    if (sampleTag) sampleTag.hidden = false;
    drawSamplePreview(cardImg(currentKey()));
  }

  function clearSet() {
    if (!lastSet) return;
    Object.keys(lastSet.items).forEach((key) => {
      URL.revokeObjectURL(lastSet.items[key].url);
      const img = cardImg(key);
      if (img && img.dataset.staticSrc) img.src = img.dataset.staticSrc;
    });
    lastSet = null;
  }

  // 四张可用样式全部换成这次的结果，点哪张看哪张；禁用的四张保持样张
  async function applySet(items, f) {
    clearSet();
    const map = {};
    for (const item of items) {
      const url = URL.createObjectURL(item.blob);
      const img = cardImg(item.key);
      if (img) {
        if (!img.dataset.staticSrc) img.dataset.staticSrc = img.getAttribute('src');
        img.src = url;
      }
      map[item.key] = { blob: item.blob, url, name: fileName(item.f) };
    }
    lastSet = { items: map, sig: currentSig(f) };
    $('preview').classList.remove('is-stale');
    $('previewStale').hidden = true;
    $('download').disabled = false;
    showSelected();
  }

  async function generate() {
    const requested = $('preset').value;
    if (!PRESETS[requested]) { setState('这个样式在完整版提供'); return; }
    const f = readForm();
    if (!f.name) { setState('先填公司名称'); $('name').focus(); return; }
    if (!codeOk(f.code, f.noCode)) { updateCodeState(f.code, f.profile, f.noCode); return; }
    if (generating) return;
    const btn = $('generate');
    generating = true;
    btn.disabled = true;
    const started = Date.now();
    try {
      if (SealMeta.loadFont) await SealMeta.loadFont(f.name + '合同专用章财务专用章');
      const items = [];
      for (let i = 0; i < ENABLED_STYLES.length; i++) {
        const style = ENABLED_STYLES[i];
        btn.textContent = `生成中 ${i + 1}/${ENABLED_STYLES.length}…`;
        // 先让浏览器画出进度再进同步渲染，否则长任务期间按钮看着没反应
        await new Promise((resolve) => setTimeout(resolve, 30));
        const styleForm = Object.assign({}, f, {
          profile: style.profile,
          fresh: style.fresh,
          star: starForProfile(style.profile),
          nameSize: PRESETS[style.profile].nameSize,
          arc: PRESETS[style.profile].arc,
          texture: PRESETS[style.profile].tex
        });
        const canvas = document.createElement('canvas');
        Seal.render(canvas, renderOpts(styleForm));
        const blob = await Seal.toPngBlob(canvas, f.diameter);
        items.push({ key: `${style.profile}-${style.fresh ? 'fresh' : 'clean'}`, blob, f: styleForm });
      }
      await applySet(items, f);
      hint(`已生成 ${items.length} 种样式，用时 ${((Date.now() - started) / 1000).toFixed(1)} 秒；点小图切换，下载选中那张`);
    } catch (err) {
      setState(err.message || '生成失败，请重试');
    } finally {
      generating = false;
      btn.textContent = '生成印章';
      btn.disabled = !codeOk($('code').value, !!($('noCode') && $('noCode').checked));
    }
  }

  // 输入类控件统一延后重绘：敲字时不要把整张 1000px 章跑一遍
  let inputTimer = 0;
  function scheduleRender(delay) {
    // 先落盘再重绘：敲完立刻刷新也不会丢内容
    persist();
    clearTimeout(inputTimer);
    inputTimer = setTimeout(render, delay == null ? 240 : delay);
  }

  function bind() {
    // 八宫格：一张图同时定模板和质感；生成前是静态样张，生成后四张可用卡全是真实结果
    $('comboGallery').addEventListener('click', (e) => {
      // 小图右上角的星标只管带不带五角星，不切换模板
      const badge = e.target.closest('.star-badge');
      if (badge) {
        const profile = badge.dataset.starFor;
        if (!starToggleAvailable(profile)) return;
        state.starOverride[profile] = !(starForProfile(profile) === true);
        syncStarToggle();
        syncStarSamples();
        render();
        persist();
        showSelected();
        return;
      }
      const btn = e.target.closest('.opt');
      if (!btn || btn.disabled || !PRESETS[btn.dataset.preset]) return;
      const presetChanged = $('preset').value !== btn.dataset.preset;
      const lookChanged = $('look').value !== btn.dataset.look;
      if (!presetChanged && !lookChanged) return;
      $('preset').value = btn.dataset.preset;
      $('look').value = btn.dataset.look;
      if (presetChanged) {
        applyPreset();
      } else {
        syncChoices();
        render();
        persist();
      }
      // 选中样式立即更新上方大图（生成后为真实结果，生成前为样张）
      showSelected();
    });

    ['name', 'line1', 'line2'].forEach((id) => {
      $(id).addEventListener('input', () => scheduleRender(260));
    });

    $('color').addEventListener('change', () => {
      render();
      persist();
    });

    $('diameter').addEventListener('change', () => {
      render();
      persist();
    });

    // 编码只收数字，最长 14 位；手填的编码标成 manual，自动编号不再覆盖它
    $('code').addEventListener('input', () => {
      const clean = $('code').value.replace(/\D/g, '').slice(0, 14);
      if (clean !== $('code').value) $('code').value = clean;
      codeSource = clean ? 'manual' : 'empty';
      updateCodeState(clean, $('preset').value, !!($('noCode') && $('noCode').checked));
      scheduleRender(240);
    });

    if ($('noCode')) {
      $('noCode').addEventListener('change', () => {
        const off = $('noCode').checked;
        render();
        persist();
        if (!off && (codeSource === 'auto' || !$('code').value.trim())) applyNameRegion();
      });
    }

    // 「换号」：按企业名里的行政区划重新拼一个占位号；手填编码要先确认
    $('regenCode').addEventListener('click', () => {
      if (codeLocked() && $('code').value.trim()) {
        if (!window.confirm('编码是手填的，确定要用自动生成的占位号替换吗？')) return;
      }
      applyNameRegion({ force: true });
    });

    // 输入企业名后稍等一下再识别，避免每敲一个字就查一次
    let nameTimer = 0;
    $('name').addEventListener('input', () => {
      clearTimeout(nameTimer);
      nameTimer = setTimeout(() => applyNameRegion({ fromInput: true }), 350);
    });

    // 经营地址同样延迟识别：地址里的区县比企业名更具体。
    // 地址不直接参与画面，但每敲一次都要存下来，刷新不能丢。
    let addrTimer = 0;
    $('address').addEventListener('input', () => {
      persist();
      clearTimeout(addrTimer);
      addrTimer = setTimeout(() => applyNameRegion({ fromInput: true }), 450);
    });

    // 粘贴备案回执、营业执照或企业信息全文：自动拆出企业名、地址和编码
    $('name').addEventListener('paste', (e) => {
      const clip = e.clipboardData || window.clipboardData;
      const text = clip ? clip.getData('text') || '' : '';
      if (text.length < 24) return;
      const got = extractFromText(text);
      if (!got.name && !got.code && !got.address) return;
      e.preventDefault();
      const noCode = !!($('noCode') && $('noCode').checked);
      if (got.name) $('name').value = got.name;
      if (got.address) $('address').value = got.address;
      if (!noCode && got.code) {
        $('code').value = got.code;
        codeSource = 'manual';
      }
      render();
      persist();
      if (got.name && got.code) rememberCode(got.name, got.code);
      if (noCode) {
        hint('已从粘贴内容识别出企业信息（当前已勾选不刻编码）');
      } else if (got.code) {
        hint('已从粘贴内容识别出企业名和编码');
      } else if (codeLocked() && $('code').value.trim()) {
        if (!codeOk($('code').value)) {
          updateCodeState($('code').value, $('preset').value, false);
        } else {
          hint('已识别企业名；编码栏是手填值，没有覆盖，要占位号请点「随机生成」');
        }
      } else {
        hint(got.address ? '已识别企业名和地址，先按地址里的区县拼占位号' : '已识别企业名，没找到 13 或 14 位编码，先按行政区拼占位号');
        applyNameRegion();
      }
    });

    // 同一企业名再次输入时带出上次填的编码；手填值不覆盖
    $('name').addEventListener('blur', () => {
      if (($('noCode') && $('noCode').checked) || codeLocked()) return;
      const n = $('name').value.trim();
      const c = recallCode(n);
      if (!c) return;
      if ($('code').value.replace(/\D/g, '') === c) return;
      setCode(c, 'memory');
      hint('已按企业名带出上次填的编码');
    });

    $('generate').addEventListener('click', generate);
    $('download').addEventListener('click', downloadLast);
  }

  restore();
  syncFromUrl();
  // 公开版没有两行专用章，星下两行始终隐藏
  $('twoLineWrap').hidden = true;
  bind();
  syncChoices();
  syncStarToggle();
  syncStarSamples();
  render();
  showSelected();
  if (SealMeta.loadFont) SealMeta.loadFont('合同专用章财务专用章');
  // 编码为空或还是上次的占位号时，按企业名重算一次；初始示例和手填/记住的编码不动
  if (!($('noCode') && $('noCode').checked) && (codeSource === 'auto' || !$('code').value.trim())) applyNameRegion();
})();
