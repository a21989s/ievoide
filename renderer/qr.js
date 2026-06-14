// Minimal QR code generator — byte mode, ECC level M, versions 1-10
// Self-contained, zero dependencies. Exposes window.QRCanvas.draw(text, canvas).
(function () {
  'use strict';

  // ── GF(256) with primitive poly 0x11d ──────────────────────────────────────
  const LOG = new Uint8Array(256);
  const EXP = new Uint8Array(512);
  (function () {
    let x = 1;
    for (let i = 0; i < 255; i++) {
      EXP[i] = EXP[i + 255] = x;
      LOG[x] = i;
      x ^= x << 1 ^ (x & 0x80 ? 0x1d : 0);
    }
  })();
  const gm = (a, b) => (a && b) ? EXP[LOG[a] + LOG[b]] : 0;

  // ── Reed-Solomon ───────────────────────────────────────────────────────────
  function rsGen(n) {
    let g = [1];
    for (let i = 0; i < n; i++) {
      const ng = new Array(g.length + 1).fill(0);
      for (let j = 0; j < g.length; j++) {
        ng[j + 1] ^= g[j];
        ng[j] ^= gm(g[j], EXP[i]);
      }
      g = ng;
    }
    return g; // degree n, g[0]..g[n], leading g[n]=1
  }
  function rsEncode(data, n) {
    const g = rsGen(n);
    const rem = new Array(n).fill(0);
    for (const b of data) {
      const f = b ^ rem.shift(); rem.push(0);
      if (f) for (let j = 0; j < n; j++) rem[j] ^= gm(g[j], f);
    }
    return rem;
  }

  // ── Version/block tables (ECC M only) ─────────────────────────────────────
  // [maxBytes, ecPerBlock, [count1,data1, count2,data2]]
  const VT = [
    null,
    [14, 10, [1, 16]],
    [26, 16, [1, 28]],
    [42, 26, [1, 44]],
    [62, 18, [2, 32]],
    [84, 24, [2, 43]],
    [106, 16, [4, 27]],
    [122, 18, [4, 31]],
    [152, 22, [2, 38, 2, 39]],
    [180, 22, [3, 36, 2, 37]],
    [213, 26, [4, 43, 1, 44]],
  ];

  // Alignment pattern centers per version (v1 has none)
  const AP = [
    [], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
    [6, 22, 38], [6, 24, 42], [6, 28, 46], [6, 32, 50],
  ];

  // ── QR matrix helpers ──────────────────────────────────────────────────────
  function makeMatrix(size) {
    return Array.from({ length: size }, () => new Int8Array(size).fill(-1));
  }
  function set(m, r, c, v) { m[r][c] = v; }
  function reserved(m, r, c) { return m[r][c] !== -1; }

  function addFinder(m, r, c) {
    for (let i = -1; i <= 7; i++)
      for (let j = -1; j <= 7; j++) {
        const v = (i >= 0 && i <= 6 && j >= 0 && j <= 6)
          ? (i === 0 || i === 6 || j === 0 || j === 6 || (i >= 2 && i <= 4 && j >= 2 && j <= 4)) ? 1 : 0
          : 0;
        const row = r + i, col = c + j;
        if (row >= 0 && row < m.length && col >= 0 && col < m.length)
          m[row][col] = v;
      }
  }

  function addAlignment(m, centers) {
    for (let i = 0; i < centers.length; i++)
      for (let j = 0; j < centers.length; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === centers.length - 1) ||
            (i === centers.length - 1 && j === 0)) continue;
        const cr = centers[i], cc = centers[j];
        for (let dr = -2; dr <= 2; dr++)
          for (let dc = -2; dc <= 2; dc++) {
            const v = (dr === -2 || dr === 2 || dc === -2 || dc === 2) ? 1
              : (dr === 0 && dc === 0) ? 1 : 0;
            m[cr + dr][cc + dc] = v;
          }
      }
  }

  function addTiming(m, size) {
    for (let i = 8; i < size - 8; i++) {
      m[6][i] = m[i][6] = (i & 1) ? 0 : 1;
    }
  }

  function reserveFormat(m, size) {
    // Reserve same cells that applyFormat will write, so placeData skips them
    for (let i = 0; i <= 8; i++) { if (m[8][i] === -1) m[8][i] = 0; }
    for (let i = 0; i <= 7; i++) { if (m[i][8] === -1) m[i][8] = 0; }
    for (let i = 0; i <= 7; i++) m[size - 1 - i][8] = 0;
    for (let i = 8; i <= 14; i++) m[8][size - 15 + i] = 0;
    m[size - 8][8] = 1;
  }

  // ── Format string (ECC M = 0b00) ──────────────────────────────────────────
  function formatStr(mask) {
    // 5-bit data: 00 (M) << 3 | mask
    let fmt = mask; // ECC bits 00 already zero
    // BCH error correction (generator x^10+x^8+x^5+x^4+x^2+x+1 = 0x537)
    let val = fmt << 10;
    for (let i = 14; i >= 10; i--) {
      if (val & (1 << i)) val ^= 0x537 << (i - 10);
    }
    fmt = (fmt << 10 | val) ^ 0x5412; // XOR mask 101010000010010
    return fmt;
  }

  function applyFormat(m, size, mask) {
    const fmt = formatStr(mask);
    const bit = (i) => (fmt >> i) & 1;
    // First copy: around top-left finder
    for (let i = 0; i <= 5; i++) m[8][i] = bit(i);
    m[8][7] = bit(6);  // skip col 6 (timing)
    m[8][8] = bit(7);
    m[7][8] = bit(8);
    for (let i = 9; i <= 14; i++) m[14 - i][8] = bit(i); // rows 5..0
    // Second copy: top-right + bottom-left
    for (let i = 0; i <= 7; i++) m[size - 1 - i][8] = bit(i);
    for (let i = 8; i <= 14; i++) m[8][size - 15 + i] = bit(i);
    m[size - 8][8] = 1; // dark module
  }

  // ── Data placement ─────────────────────────────────────────────────────────
  function placeData(m, size, bits) {
    let idx = 0;
    let up = true;
    for (let col = size - 1; col >= 1; col -= 2) {
      if (col === 6) col--; // skip timing column
      for (let row = 0; row < size; row++) {
        const r = up ? size - 1 - row : row;
        for (let dc = 0; dc < 2; dc++) {
          const c = col - dc;
          if (!reserved(m, r, c)) {
            m[r][c] = idx < bits.length ? bits[idx++] : 0;
          }
        }
      }
      up = !up;
    }
  }

  // ── Mask functions ─────────────────────────────────────────────────────────
  const MASKS = [
    (r, c) => (r + c) % 2 === 0,
    (r, _) => r % 2 === 0,
    (_, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => (r * c) % 2 + (r * c) % 3 === 0,
    (r, c) => ((r * c) % 2 + (r * c) % 3) % 2 === 0,
    (r, c) => ((r + c) % 2 + (r * c) % 3) % 2 === 0,
  ];

  function applyMask(m, size, maskFn) {
    const out = m.map(row => Int8Array.from(row));
    for (let r = 0; r < size; r++)
      for (let c = 0; c < size; c++)
        if (m[r][c] !== -1) out[r][c] = m[r][c] ^ (maskFn(r, c) ? 1 : 0);
    return out;
  }

  function penalty(m, size) {
    let p = 0;
    // N1: 5+ consecutive same-color in row/col
    for (let r = 0; r < size; r++) {
      for (let isRow = 0; isRow < 2; isRow++) {
        let run = 1, prev = isRow ? m[r][0] : m[0][r];
        for (let i = 1; i < size; i++) {
          const v = isRow ? m[r][i] : m[i][r];
          if (v === prev) { run++; if (run === 5) p += 3; else if (run > 5) p++; }
          else { run = 1; prev = v; }
        }
      }
    }
    // N2: 2×2 blocks
    for (let r = 0; r < size - 1; r++)
      for (let c = 0; c < size - 1; c++) {
        const v = m[r][c];
        if (v === m[r][c+1] && v === m[r+1][c] && v === m[r+1][c+1]) p += 3;
      }
    // N3: finder-like patterns
    const pat1 = [1,0,1,1,1,0,1,0,0,0,0], pat2 = [0,0,0,0,1,0,1,1,1,0,1];
    for (let r = 0; r < size; r++)
      for (let c = 0; c <= size - 11; c++)
        for (const pat of [pat1, pat2]) {
          if (pat.every((v, i) => m[r][c+i] === v)) p += 40;
          if (pat.every((v, i) => m[c+i][r] === v)) p += 40;
        }
    // N4: dark module proportion
    let dark = 0;
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (m[r][c]) dark++;
    const pct = dark / (size * size) * 100;
    p += Math.abs(Math.floor(pct / 5) * 5 - 50) / 5 * 10 +
         Math.abs(Math.ceil(pct / 5) * 5 - 50) / 5 * 10;
    return p;
  }

  // ── Main encode ────────────────────────────────────────────────────────────
  function encode(text) {
    const bytes = new TextEncoder().encode(text);
    const n = bytes.length;

    // Choose version
    let ver = 1;
    while (ver <= 10 && VT[ver][0] < n) ver++;
    if (ver > 10) throw new Error('Text too long for QR v10-M');

    const [, ecPerBlock, blockDef] = VT[ver];
    const size = ver * 4 + 17;

    // Build data codewords
    const bits = [];
    const push = (v, len) => { for (let i = len - 1; i >= 0; i--) bits.push((v >> i) & 1); };
    push(0b0100, 4);            // byte mode
    push(n, 8);                 // char count (ver 1-9)
    for (const b of bytes) push(b, 8);

    // Terminator + byte-align
    for (let i = 0; i < 4; i++) bits.push(0);
    while (bits.length % 8) bits.push(0);

    // Convert bits → bytes
    const cw = [];
    for (let i = 0; i < bits.length; i += 8) {
      let v = 0;
      for (let j = 0; j < 8; j++) v = v << 1 | (bits[i + j] || 0);
      cw.push(v);
    }
    const pads = [0xec, 0x11];
    let totalData = 0;
    for (let i = 0; i < blockDef.length; i += 2) totalData += blockDef[i] * blockDef[i + 1];
    let padIdx = 0;
    while (cw.length < totalData) cw.push(pads[padIdx++ & 1]);

    // Split into blocks, compute EC
    const dataBlocks = [], ecBlocks = [];
    let pos = 0;
    for (let i = 0; i < blockDef.length; i += 2) {
      for (let k = 0; k < blockDef[i]; k++) {
        const d = cw.slice(pos, pos + blockDef[i + 1]);
        dataBlocks.push(d);
        ecBlocks.push(rsEncode(d, ecPerBlock));
        pos += blockDef[i + 1];
      }
    }

    // Interleave
    const interleaved = [];
    const maxData = Math.max(...dataBlocks.map(b => b.length));
    for (let i = 0; i < maxData; i++)
      for (const b of dataBlocks) if (i < b.length) interleaved.push(b[i]);
    for (let i = 0; i < ecPerBlock; i++)
      for (const b of ecBlocks) interleaved.push(b[i]);

    // Convert to bit array
    const dataBits = [];
    for (const b of interleaved)
      for (let i = 7; i >= 0; i--) dataBits.push((b >> i) & 1);
    // Remainder bits
    const remBits = [0, 0, 7, 7, 7, 7, 7, 0, 0, 0][ver] || 0;
    for (let i = 0; i < remBits; i++) dataBits.push(0);

    // Build matrix
    const base = makeMatrix(size);
    addFinder(base, 0, 0);
    addFinder(base, 0, size - 7);
    addFinder(base, size - 7, 0);
    addAlignment(base, AP[ver]);
    addTiming(base, size);
    reserveFormat(base, size);
    placeData(base, size, dataBits);

    // Pick best mask
    let bestMask = 0, bestScore = Infinity;
    for (let mk = 0; mk < 8; mk++) {
      const candidate = applyMask(base, size, MASKS[mk]);
      applyFormat(candidate, size, mk);
      const s = penalty(candidate, size);
      if (s < bestScore) { bestScore = s; bestMask = mk; }
    }

    const final = applyMask(base, size, MASKS[bestMask]);
    applyFormat(final, size, bestMask);
    return { matrix: final, size };
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  window.QRCanvas = {
    draw(text, canvas, { light = '#ffffff', dark = '#000000', margin = 4 } = {}) {
      // margin=4：QR 规范要求的静默区（quiet zone）至少 4 个模块，少于此扫码器易识别失败。
      const { matrix, size } = encode(text);
      const total = size + margin * 2;
      // 关键：每个模块取「整数个设备像素」绘制，全程用整数设备坐标、且不做 ctx.scale，
      // 杜绝模块边界落在亚像素上被 canvas 抗锯齿渲染成灰边/发虚——这正是 Android 扫码器
      // （比 iOS 苛刻）识别失败、需反复对角度距离的根因。Windows 125%/150% 缩放（dpr=1.25/1.5）
      // 下旧实现 px*dpr 非整数，边缘必然发灰；改为设备像素整数倍后边缘绝对锐利。
      const dpr = window.devicePixelRatio || 1;
      const target = parseInt(canvas.dataset.size || canvas.style.width || '280', 10) || 280;
      const modDev = Math.max(6, Math.round(target * dpr / total)); // 每模块设备像素数（整数）
      const dimDev = modDev * total;                                // 位图边长（设备像素，整数）
      canvas.width = canvas.height = dimDev;
      // CSS 显示尺寸 = 位图设备像素 / dpr，使位图 1:1 映射物理像素，避免浏览器再次缩放发虚。
      canvas.style.width = canvas.style.height = (dimDev / dpr) + 'px';
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = light;
      ctx.fillRect(0, 0, dimDev, dimDev);
      ctx.fillStyle = dark;
      for (let r = 0; r < size; r++)
        for (let c = 0; c < size; c++)
          if (matrix[r][c])
            ctx.fillRect((c + margin) * modDev, (r + margin) * modDev, modDev, modDev);
    }
  };
})();
