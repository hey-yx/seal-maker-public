(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const meta = $('meta');

  const PRESETS = {
    contract: { px: 1000, tex: 0, diameter: 42, nameSize: 6.75, arc: 240, color: '#DA251D', jitter: 0, star: false, line1: '合同专用章', line2: '', lineSize: 5.3, edgeAmp: 0.01, nicks: 0, specks: 0 },
    finance: { px: 1000, tex: 0, diameter: 42, nameSize: 6.75, arc: 240, color: '#DA251D', jitter: 0, star: false, line1: '财务专用章', line2: '', lineSize: 5.3, edgeAmp: 0.01, nicks: 0, specks: 0 }
  };

  // 直径 → 国标几何（DB11/T 918-2021 6.2.1）：42mm 边宽 1.2、五角星 14；
  // 40mm 边宽 1.1、五角星 13。名称字高 6.75 和环排角度两种直径共用。
  const GEOMETRY = {
    42: { border: 1.2, starWidth: 14 },
    40: { border: 1.1, starWidth: 13 }
  };
  const geomFor = (d) => GEOMETRY[d] || GEOMETRY[42];

  const PRESET_LABELS = {
    contract: '合同专用章',
    finance: '财务专用章'
  };

  const PXMM = 600 / 25.4; // 600 dpi 下每毫米像素；导出尺寸按它算
  const LITE_LIMIT = 10;
  const USED_KEY = 'seal-maker-lite:used';
  // 公开版开放的四种：合同/财务各标准与实盖。ZIP 只打这四张。
  const ENABLED_STYLES = [
    { profile: 'contract', fresh: false, template: '合同专用章', look: '标准' },
    { profile: 'contract', fresh: true, template: '合同专用章', look: '实盖扫描' },
    { profile: 'finance', fresh: false, template: '财务专用章', look: '标准' },
    { profile: 'finance', fresh: true, template: '财务专用章', look: '实盖扫描' }
  ];
  const ZIP_COST = ENABLED_STYLES.length;

  const state = {
    seed: 7,
    // 合同/财务专用章带不带星：{} 表示跟随模板默认（官方无星），
    // 勾过之后按模板分别记住，切走再切回还是用户选的那个
    starOverride: {},
  };

  let lastGenerated = null;
  let generating = false;
  let usedMemory = 0;


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
        hint(`${why}没有覆盖；要按${src}里的${hit.name}（${prefix}）重拼请点「换号」`);
        return;
      }
      const total = now.length === 14 ? 14 : 13;
      const next = prefix + randomDigits(total - 6);
      setCode(next, 'auto');
      lastAutoAt = Date.now();
      // 直辖市在表里是省级，但码就是城市码，提示按地市说
      const lv = hit.level === 1 && /^(北京|上海|天津|重庆)市$/.test(hit.name) ? 2 : hit.level;
      if (lv === 3) {
        hint(`已按${src}里的${hit.name}（${prefix}）拼好 ${total} 位占位号，后 ${total - 6} 位随机`);
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

  // 公开版只有合同/财务，编码必须 13 或 14 位
  function codeOk(code) {
    return /^\d{13,14}$/.test(code);
  }

  function updateNameState(f) {
    const el = $('nameHint');
    if (!el) return;
    const m = SealMeta.nameFit({
      name: f.name, nameSize: f.nameSize, arc: f.arc || 260, border: geomFor(f.diameter).border,
      diameter: f.diameter
    });
    if (!m.chars) { el.hidden = true; return; }
    el.hidden = false;
    // 6.5mm 是国标区间的下限，掉到它下面说明名称太长，只能缩字高
    const stdSize = m.size >= 6.49 ? '（标准 6.5～8\u00A0mm）' : '（超长，已压到下限以下）';
    // 名称首末与底部编码的间隔：编码占 232°–307°（75°），剩下两段对称分给左右
    const clearDeg = Math.max(0, (360 - 75 - m.arcDeg) / 2);
    const clearMm = ((clearDeg * Math.PI) / 180 * m.r).toFixed(1);
    const hasCode = !!f.code;
    const arcTail = hasCode ? `环排 ${m.arcDeg}°，距编码 ${clearMm}\u00A0mm` : `环排 ${m.arcDeg}°`;
    // 字高不动，靠字形宽度（49%～75%）和字距一起铺满弧长
    el.textContent = `${m.chars} 字，字高 ${m.size}\u00A0mm${stdSize}，字形宽度 ${Math.round(m.sx * 100)}%，字距 ${m.gapMm}\u00A0mm，${arcTail}`;
  }

  function readUsed() {
    try {
      const n = parseInt(localStorage.getItem(USED_KEY), 10);
      return Number.isFinite(n) && n > 0 ? n : 0;
    } catch (e) { return usedMemory; }
  }

  function writeUsed(n) {
    usedMemory = n;
    try { localStorage.setItem(USED_KEY, String(n)); } catch (e) { /* 隐私模式：本次会话内计数 */ }
  }

  function usesLeft() {
    return Math.max(0, LITE_LIMIT - readUsed());
  }

  function addUse() {
    writeUsed(Math.min(LITE_LIMIT, readUsed() + 1));
  }

  function updateBilling() {
    const el = $('billing');
    if (!el) return;
    el.textContent = usesLeft() > 0
      ? `公开版免费剩余 ${usesLeft()} 次 · 次数记在本机浏览器`
      : '公开版免费次数已用完，去完整版继续';
    updateZipState();
  }

  // 打包要 4 张，次数不够就禁用；名称和编码也得有效
  function updateZipState() {
    const zip = $('downloadAll');
    if (!zip) return;
    zip.disabled = generating || usesLeft() < ZIP_COST || !$('name').value.trim() || !codeOk($('code').value) || !PRESETS[$('preset').value];
  }

  function updateCodeState(code, profile) {
    const ok = codeOk(code);
    const gen = $('generate');
    if (gen) gen.disabled = !ok || generating || usesLeft() <= 0;
    updateZipState();
    const regen = $('regenCode');
    if (regen) regen.disabled = false;
    const note = $('codeAutoNote');
    if (note) {
      if (codeSource === 'auto' && code) {
        const tail = code.length === 14 ? 8 : 7;
        note.textContent = `占位号：前 6 位按行政区划，后 ${tail} 位随机，不是备案编码。正式使用请换成真实编号。`;
        note.hidden = false;
      } else {
        note.textContent = '';
        note.hidden = true;
      }
    }
    if (ok) { setState(''); return; }
    if (!code) { setState(''); return; }
    if (code.length === 6) setState(`已填区号 ${code}，再补 7 到 8 位顺序号`);
    else setState(`编码只能 13 或 14 位，当前 ${code.length} 位`);
  }

  function render() {
    const f = readForm();
    const presetName = PRESET_LABELS[f.profile] || '印章';
    const g = geomFor(f.diameter);
    const outPx = Math.round(f.diameter * PXMM);
    const codeNote = `编码 1.35 mm${codeSource === 'auto' ? ' · 编码为占位号' : ''}`;
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
    if (note) note.textContent = `名称字高 6.75\u00A0mm、离内边 0.55\u00A0mm 固定，字距在可用弧长里自动排：先保 2\u00A0mm，排不下再压窄字形、收字距、缩字高。下载的 PNG 是一枚 ${f.diameter}\u00A0mm 章，插进文档按 ${(f.diameter / 10).toFixed(1)}\u00A0cm 放。`;
    updateNameState(f);
    updateCodeState(f.code, f.profile);
    updateBilling();
    markStale(f);
  }

  // 表单指纹：用于判断预览是否过期
  function buildPayload(f) {
    return {
      profile: f.profile,
      name: f.name,
      line1: f.line1,
      line2: f.line2,
      code: codeOk(f.code) ? f.code : '',
      color: f.color,
      diameter: f.diameter,
      star: f.star,
      fresh: f.fresh,
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
      code: codeOk(f.code) ? f.code : '',
      color: f.color,
      jitter: p.jitter,
      diameter: f.diameter,
      border: geomFor(f.diameter).border,
      starWidth: geomFor(f.diameter).starWidth,
      nameSize: f.nameSize,
      arc: p.arc,
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

  // 合同/财务的样张有两版：带星和不带星，切星标时换图
  function syncStarSamples() {
    document.querySelectorAll('.opt-img[data-sample-profile]').forEach((img) => {
      const on = starForProfile(img.dataset.sampleProfile) === true;
      const src = on ? img.dataset.srcOn : img.dataset.srcOff;
      if (src && img.getAttribute('src') !== src) img.src = src;
    });
  }

  function currentSig(f) {
    return JSON.stringify(buildPayload(f || readForm()));
  }

  function markStale(f) {
    if (!lastGenerated) return;
    const stale = currentSig(f) !== lastGenerated.sig;
    $('preview').classList.toggle('is-stale', stale);
    $('previewStale').hidden = !stale;
    $('download').disabled = stale;
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
    const ph = codeSource === 'auto' ? '-占位编码' : '';
    return `${label}-${SealMeta.toSlug(f.name)}-${f.diameter}mm${tag}${ph}.png`;
  }

  function downloadLast() {
    if (!lastGenerated || !PRESETS[lastGenerated.profile]) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(lastGenerated.blob);
    a.download = lastGenerated.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  }

  // 公开版打包：只渲染 ENABLED_STYLES 里的四种，禁用的公章/两行章不进来。
  // 每张按当前名称、编码、颜色、直径和星标渲染，包内附配置 JSON。
  async function downloadAll() {
    const requested = $('preset').value;
    if (!PRESETS[requested]) { setState('这个样式在完整版提供'); return; }
    const f = readForm();
    if (!f.name) { setState('先填公司名称'); $('name').focus(); return; }
    if (!codeOk(f.code)) { updateCodeState(f.code, f.profile); return; }
    if (generating) return;
    if (usesLeft() < ZIP_COST) {
      updateBilling();
      hint(`免费次数不够，打包 4 张要 ${ZIP_COST} 次`);
      return;
    }
    const btn = $('downloadAll');
    const one = $('download');
    const gen = $('generate');
    const label = btn.textContent;
    generating = true;
    btn.disabled = true;
    one.disabled = true;
    gen.disabled = true;
    const files = [];
    const sheets = [];
    try {
      for (let i = 0; i < ENABLED_STYLES.length; i++) {
        const style = ENABLED_STYLES[i];
        btn.textContent = `生成中 ${i + 1}/${ENABLED_STYLES.length}…`;
        await new Promise((resolve) => setTimeout(resolve, 0));
        const opts = renderOpts(Object.assign({}, f, {
          profile: style.profile,
          fresh: style.fresh,
          star: starForProfile(style.profile),
          nameSize: PRESETS[style.profile].nameSize,
          arc: PRESETS[style.profile].arc,
          texture: PRESETS[style.profile].tex
        }));
        const canvas = document.createElement('canvas');
        Seal.render(canvas, opts);
        const blob = await Seal.toPngBlob(canvas, f.diameter);
        const name = `${style.template}-${SealMeta.toSlug(f.name)}-${f.diameter}mm-${style.look}.png`;
        files.push({ name, bytes: new Uint8Array(await blob.arrayBuffer()) });
        sheets.push({
          文件: name,
          模板: style.template,
          质感: style.look,
          五角星: opts.star ? '有' : '无'
        });
      }
      const outPx = Math.round(f.diameter * PXMM);
      const config = {
        公司名称: f.name,
        印章编码: f.code,
        直径: `${f.diameter} mm`,
        颜色: f.color,
        导出: `${outPx} × ${outPx} px · 600 dpi`,
        说明: '公开版只包含合同专用章和财务专用章，标准与实盖扫描各一张。',
        生成时间: new Date().toLocaleString('zh-CN', { hour12: false }),
        文件: sheets
      };
      files.push({ name: '配置.json', bytes: new TextEncoder().encode(JSON.stringify(config, null, 2)) });
      const zip = SealZip.build(files);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(zip);
      a.download = `印章-${SealMeta.toSlug(f.name)}-${f.diameter}mm.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 3000);
      writeUsed(Math.min(LITE_LIMIT, readUsed() + ZIP_COST));
      updateBilling();
      hint(`已打包 4 张，扣 ${ZIP_COST} 次，剩余 ${usesLeft()} 次`);
    } catch (err) {
      setState(err.message || '打包失败，请重试');
    } finally {
      generating = false;
      btn.textContent = label;
      one.disabled = !lastGenerated || currentSig(readForm()) !== lastGenerated.sig;
      gen.disabled = !codeOk($('code').value) || usesLeft() <= 0;
      updateZipState();
    }
  }

  async function applyGenerated(blob, f) {
    const c = $('preview');
    const g = c.getContext('2d');
    const bmp = await createImageBitmap(blob);
    g.clearRect(0, 0, c.width, c.height);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(bmp, 0, 0, c.width, c.height);
    if (bmp.close) bmp.close();
    lastGenerated = { blob, name: fileName(f), sig: currentSig(f), profile: f.profile };
    $('previewEmpty').hidden = true;
    $('previewStale').hidden = true;
    c.classList.remove('is-stale');
    $('download').disabled = false;
  }

  async function generate() {
    const requested = $('preset').value;
    if (!PRESETS[requested]) { setState('这个样式在完整版提供'); return; }
    const f = readForm();
    if (!f.name) { setState('先填公司名称'); $('name').focus(); return; }
    if (!codeOk(f.code)) { updateCodeState(f.code, f.profile); return; }
    if (generating) return;
    if (usesLeft() <= 0) { updateBilling(); hint('公开版免费次数已用完，去完整版继续'); return; }
    const btn = $('generate');
    generating = true;
    btn.disabled = true;
    btn.textContent = '生成中…';
    const started = Date.now();
    // 先让浏览器画出「生成中…」再进同步渲染，否则长任务期间按钮看着没反应
    await new Promise((resolve) => setTimeout(resolve, 30));
    try {
      const canvas = document.createElement('canvas');
      Seal.render(canvas, renderOpts(f));
      const blob = await Seal.toPngBlob(canvas, f.diameter);
      await applyGenerated(blob, f);
      addUse();
      updateBilling();
      hint(`已生成，用时 ${((Date.now() - started) / 1000).toFixed(1)} 秒；免费剩余 ${usesLeft()} 次`);
    } catch (err) {
      setState(err.message || '生成失败，请重试');
    } finally {
      generating = false;
      btn.textContent = '生成印章';
      btn.disabled = !codeOk($('code').value) || usesLeft() <= 0;
      updateZipState();
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
    // 八宫格：一张图同时定模板和质感；样张是静态图，选中后点「生成印章」才出图
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
      updateCodeState(clean, $('preset').value);
      scheduleRender(240);
    });

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
      if (got.name) $('name').value = got.name;
      if (got.address) $('address').value = got.address;
      if (got.code) {
        $('code').value = got.code;
        codeSource = 'manual';
      }
      render();
      persist();
      if (got.name && got.code) rememberCode(got.name, got.code);
      if (got.code) {
        hint('已从粘贴内容识别出企业名和编码');
      } else if (codeLocked() && $('code').value.trim()) {
        if (!codeOk($('code').value)) {
          updateCodeState($('code').value, $('preset').value);
        } else {
          hint('已识别企业名；编码栏是手填值，没有覆盖，要占位号请点「换号」');
        }
      } else {
        hint(got.address ? '已识别企业名和地址，先按地址里的区县拼占位号' : '已识别企业名，没找到 13 或 14 位编码，先按行政区拼占位号');
        applyNameRegion();
      }
    });

    // 同一企业名再次输入时带出上次填的编码；手填值不覆盖
    $('name').addEventListener('blur', () => {
      if (codeLocked()) return;
      const n = $('name').value.trim();
      const c = recallCode(n);
      if (!c) return;
      if ($('code').value.replace(/\D/g, '') === c) return;
      setCode(c, 'memory');
      hint('已按企业名带出上次填的编码');
    });

    $('generate').addEventListener('click', generate);
    $('download').addEventListener('click', downloadLast);
    $('downloadAll').addEventListener('click', downloadAll);
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
  // 编码为空或还是上次的占位号时，按企业名重算一次；初始示例和手填/记住的编码不动
  if (codeSource === 'auto' || !$('code').value.trim()) applyNameRegion();
})();
