/* 最小 ZIP 打包：STORE（不压缩）模式，PNG 本身已经压过，再压一遍没收益。
   文件名按 UTF-8 写，并同时置通用位 11 和 0x7075 Unicode Path 扩展字段：
   Finder / WPS / 7-Zip / Python 认标志位，macOS 自带命令行 unzip 只认扩展字段，
   两边都写才都不会把中文名弄乱码。 */
(function (global) {
  'use strict';

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
      c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  function dosDateTime(d) {
    const time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((Math.floor(d.getSeconds() / 2)) & 31);
    const date = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
    return { time, date };
  }

  // files: [{ name: '中文.png', bytes: Uint8Array }]
  function build(files) {
    const enc = new TextEncoder();
    const stamp = dosDateTime(new Date());
    const parts = [];
    const central = [];
    let offset = 0;

    for (const f of files) {
      const name = enc.encode(f.name);
      const data = f.bytes instanceof Uint8Array ? f.bytes : new Uint8Array(f.bytes);
      const crc = crc32(data);

      // 0x7075：Unicode Path 扩展字段，内容和 name 相同，专供只认这个字段的解压工具
      const extra = new Uint8Array(9 + name.length);
      const xv = new DataView(extra.buffer);
      xv.setUint16(0, 0x7075, true);
      xv.setUint16(2, 5 + name.length, true);
      extra[4] = 1;
      xv.setUint32(5, crc32(name), true);
      extra.set(name, 9);

      const head = new Uint8Array(30 + name.length + extra.length);
      const hv = new DataView(head.buffer);
      hv.setUint32(0, 0x04034b50, true);
      hv.setUint16(4, 20, true);
      hv.setUint16(6, 0x0800, true);
      hv.setUint16(8, 0, true);
      hv.setUint16(10, stamp.time, true);
      hv.setUint16(12, stamp.date, true);
      hv.setUint32(14, crc, true);
      hv.setUint32(18, data.length, true);
      hv.setUint32(22, data.length, true);
      hv.setUint16(26, name.length, true);
      hv.setUint16(28, extra.length, true);
      head.set(name, 30);
      head.set(extra, 30 + name.length);
      parts.push(head, data);

      const cd = new Uint8Array(46 + name.length + extra.length);
      const cv = new DataView(cd.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, stamp.time, true);
      cv.setUint16(14, stamp.date, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, name.length, true);
      cv.setUint16(30, extra.length, true);
      cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true);
      cv.setUint16(36, 0, true);
      cv.setUint32(38, 0, true);
      cv.setUint32(42, offset, true);
      cd.set(name, 46);
      cd.set(extra, 46 + name.length);
      central.push(cd);

      offset += head.length + data.length;
    }

    const cdSize = central.reduce((a, b) => a + b.length, 0);
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, offset, true);
    ev.setUint16(20, 0, true);

    return new Blob(parts.concat(central, [eocd]), { type: 'application/zip' });
  }

  global.SealZip = { build };
})(window);
