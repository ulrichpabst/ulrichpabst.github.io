let lastGamma = 0.0003;
let hoverPpm = null;
const BASELINE_OFFSET = 0.04;

function parseFrequency(text) {
  const m = text.match(/\((\d+(?:\.\d+)?)\s*MHz/i);
  return m ? parseFloat(m[1]) : 400;
}

function parseSolvent(text) {
  const m = text.match(/\(\s*\d+(?:\.\d+)?\s*MHz\s*,\s*([^)]+)\)/i);
  return m ? m[1].trim() : null;
}

function splitEntries(text) {
  let core = text;
  const i = text.indexOf('δ');
  if (i >= 0) core = text.slice(i + 1);
  const rx = /(\d+(?:\.\d+)?(?:\s*[–-]\s*\d+(?:\.\d+)?)?)\s*\(([^)]*)\)/g;
  const out = [];
  let m;
  while ((m = rx.exec(core)) !== null) out.push([m[1], m[2]]);
  return out;
}

function parseShifts(s) {
  s = s.trim().replace(/–/g, '-');
  if (s.indexOf('-') > -1) {
    const parts = s.split('-');
    const A = parseFloat(parts[0]);
    const B = parseFloat(parts[1]);
    return [0.5 * (A + B), Math.abs(A - B) / 2];
  }
  return [parseFloat(s), 0];
}

function pascal(letter) {
  const P = {
    s: [[1], [0]],
    d: [[1, 1], [-0.5, 0.5]],
    t: [[1, 2, 1], [-1, 0, 1]],
    q: [[1, 3, 3, 1], [-1.5, -0.5, 0.5, 1.5]],
    p: [[1, 4, 6, 4, 1], [-2, -1, 0, 1, 2]],
    h: [[1, 5, 10, 10, 5, 1], [-2.5, -1.5, -0.5, 0.5, 1.5, 2.5]],
    m: [[1], [0]]
  };
  return P[letter] || P.s;
}

function lorentz(x, x0, g, a) {
  const d = x - x0;
  return (a * (g / Math.PI)) / (d * d + g * g);
}

function convolve(pattern, letter, Jppm) {
  const base = pascal(letter);
  const coeffs = base[0];
  const relpos = base[1];
  const out = [];
  for (let i = 0; i < pattern.length; i++) {
    const p0 = pattern[i][0];
    const w0 = pattern[i][1];
    for (let j = 0; j < coeffs.length; j++) {
      out.push([p0 + relpos[j] * Jppm, w0 * coeffs[j]]);
    }
  }
  return out;
}

function parseBody(body) {
  let s = body.toLowerCase().trim();
  const isb = s.indexOf('br') > -1;
  s = s.replace(/br/g, '').trim();
  const mh = s.match(/\b((?:\d+(?:\.\d+)?)|\.\d+)\s*h\b/i);
  const nH = mh ? parseFloat(mh[1]) : 1;
  let seq = ['s'];
  const mcombo = s.match(/(?:^|[^a-z])([sdthqp]+)(?=(?:[,\s]|$|j\b|\d+h\b))/);
  if (mcombo) seq = mcombo[1].split('');
  let Js = [];
  const jf = s.match(/j\s*=\s*((?:\d+(?:\.\d+)?\s*,\s*)*\d+(?:\.\d+)?)\s*hz/i);
  if (jf) Js = jf[1].split(',').map(x => parseFloat(x.trim()));
  return { seq, Js, nH, isb };
}

function ensureJs(seq, Js) {
  const list = Js.map(Number);
  if (seq.length === 0) return [];
  if (list.length === 0) return new Array(seq.length).fill(7);
  if (list.length < seq.length) {
    const last = list[list.length - 1];
    while (list.length < seq.length) list.push(last);
  }
  return list.slice(0, seq.length);
}

function parseNMR(text) {
  const MHz = parseFrequency(text);
  const solvent = parseSolvent(text);
  const raw = splitEntries(text);
  const entries = [];
  for (let k = 0; k < raw.length; k++) {
    const shiftField = raw[k][0];
    const body = raw[k][1];
    const ps = parseShifts(shiftField);
    const center = ps[0];
    const halfw = ps[1];
    const pb = parseBody(body);
    entries.push({ center, halfw, seq: pb.seq, Js: pb.Js, nH: pb.nH, isb: pb.isb });
  }
  return { MHz, solvent, entries };
}

function simulateSpectrum(text, ppmMin, ppmMax, points, gammaBase) {
  const parsed = parseNMR(text);
  const MHz = parsed.MHz;
  const entries = parsed.entries;

  const lo = Math.min(ppmMin, ppmMax);
  const hi = Math.max(ppmMin, ppmMax);
  const loPad = lo - 0.5;
  const hiPad = hi + 0.5;

  const axis = new Float64Array(points);
  const y = new Float64Array(points);
  const dx = (hiPad - loPad) / Math.max(1, points - 1);
  for (let i = 0; i < points; i++) axis[i] = loPad + i * dx;

  for (let ei = 0; ei < entries.length; ei++) {
    const e = entries[ei];
    if (!e.seq || e.seq.length === 0) continue;

    const Jsppm = ensureJs(e.seq, e.Js).map(J => J / MHz);
    let pat = [[e.center, 1]];
    for (let j = 0; j < e.seq.length; j++) pat = convolve(pat, e.seq[j], Jsppm[j]);

    let tot = 0;
    for (let j = 0; j < pat.length; j++) tot += pat[j][1];

    let g = gammaBase;
    if (e.halfw > 0) g = Math.max(g, e.halfw);
    if (e.isb) g *= 20;

    for (let j = 0; j < pat.length; j++) {
      const pos = pat[j][0];
      const wt = pat[j][1];
      const area = e.nH * wt / tot;

      const x0 = (pos - loPad) / dx;
      const amp = area * (g / Math.PI);
      const eps = 1e-7;
      const dmax = Math.sqrt(Math.max(0, amp / eps - g * g));
      const span = Math.max(4, Math.ceil(dmax / dx));
      const i0 = Math.max(0, Math.floor(x0 - span));
      const i1 = Math.min(points - 1, Math.ceil(x0 + span));
      for (let i = i0; i <= i1; i++) y[i] += lorentz(axis[i], pos, g, area);
    }
  }

let ymax = 0;
for (let i = 0; i < points; i++) {
  if (y[i] > ymax) ymax = y[i];
}
if (ymax > 0) {
  const inv = 1 / ymax;
  for (let i = 0; i < points; i++) y[i] *= inv;
}
  return { axis, y, entries, solvent: parsed.solvent, MHz, view: [lo, hi] };
}

const FG_RANGES = [
  { name: "aromatic", lo: 6.0, hi: 8.5 },
  { name: "alkene", lo: 4.5, hi: 6.5 },
  { name: "aldehyde", lo: 9.0, hi: 10.5 },
  { name: "carboxylic acid", lo: 10.0, hi: 13.0 },
  { name: "amide", lo: 6.0, hi: 9.0 },
  { name: "O-CHx", lo: 3.2, hi: 4.5 },
  { name: "benzylic/allylic", lo: 2.0, hi: 3.5 },
  { name: "aliphatic", lo: 0.5, hi: 2.5 },
  // add more and refine... same for trace impurities, only placeholders here.!
];

const IMP = {
  "CDCl3": [
    { name: "CHCl3 (residual)", ppm: 7.26, mult: "s" },
    { name: "H2O",               ppm: 1.56, mult: "br s" },
    { name: "Acetone",           ppm: 2.05, mult: "s" },
    { name: "Acetic acid",       ppm: 2.08, mult: "s" },
    { name: "Ethanol CH3",       ppm: 1.18, mult: "t" },
    { name: "Ethanol CH2",       ppm: 3.65, mult: "q" },
    { name: "Ethyl acetate CH3", ppm: 1.26, mult: "t" },
    { name: "Ethyl acetate CH2", ppm: 4.12, mult: "q" },
    { name: "Diethyl ether CH3", ppm: 1.18, mult: "t" },
    { name: "DMF (formyl)",      ppm: 8.02, mult: "s" },
    { name: "Acetonitrile",      ppm: 2.09, mult: "s" },
    { name: "Toluene CH3",       ppm: 2.31, mult: "s" },
    { name: "Benzene",           ppm: 7.36, mult: "s" }
  ],
  "DMSO-d6": [
    { name: "DMSO (residual)", ppm: 2.50, mult: "s" },
    { name: "H2O",             ppm: 3.33, mult: "br s" },
    { name: "Formic acid",     ppm: 8.10, mult: "s" },
    { name: "Acetic acid",     ppm: 2.08, mult: "s" },
    { name: "Methanol",        ppm: 3.16, mult: "s" }
  ],
  "MeOD-d4": [
    { name: "MeOD (residual)", ppm: 3.31, mult: "s" },
    { name: "HDO",             ppm: 4.87, mult: "br s" },
    { name: "Acetone",         ppm: 2.05, mult: "s" }
  ],
  "D2O": [
    { name: "HDO",     ppm: 4.79, mult: "br s" },
    { name: "Acetone", ppm: 2.22, mult: "s" }
  ]
};

function multStringFromEntry(e) {
  const s = e.seq.join('');
  return e.isb ? ('br ' + s) : s;
}

function likelyIdentity(ppm, mult, solvent) {
  const tol = 0.03;
  const list = IMP[solvent || ""] || [];

  const normalized = (s) => s.toLowerCase().replace(/\s+/g, '');
  const multN = normalized(mult);

  for (const it of list) {
    const matchMult =
      multN === 'm' ||
      normalized(it.mult) === multN ||
      (multN.startsWith('br') && normalized(it.mult) === multN.slice(2)) ||
      (normalized(it.mult).startsWith('br') && normalized(it.mult).slice(2) === multN);

    if (matchMult && Math.abs(ppm - it.ppm) <= tol) {
      return { label: "Trace: " + it.name, isImp: true };
    }
  }

  for (const r of FG_RANGES) {
    if (ppm >= r.lo && ppm <= r.hi) return { label: r.name, isImp: false };
  }
  return { label: "—", isImp: false };
}

function validateACS(raw) {
  const issues = [];
  if (!/^1\s*H\s*NMR/i.test(raw)) issues.push("Prefix should start with “1H NMR”.");
  if (raw.indexOf('δ') < 0) issues.push("Missing δ symbol before signal list.");
  if (!/\(\s*\d+(?:\.\d+)?\s*MHz\s*,\s*[^)]+\)/i.test(raw)) issues.push("Instrument block should be “(xxx MHz, SOLVENT)”.");
  const core = splitEntries(raw);
  if (core.length === 0) issues.push("No valid signal entries “shift ( ... )”.");
  for (const [shift, body] of core) {
    if (!/^-?\d/.test(shift)) issues.push(`Invalid shift “${shift}”.`);
    if (!/\b\d+\s*H\b/i.test(body)) issues.push(`Integral missing in “(${body})”.`);
    if (/\bj\s*=\s*/i.test(body) && !/Hz/i.test(body)) issues.push(`“Hz” missing after J in “(${body})”.`);
    if (!/([sdthqpm]|br)/i.test(body)) issues.push(`Multiplicity missing in “(${body})”.`);
  }
  return issues;
}

function hsum(entries) {
  let s = 0;
  for (const e of entries) s += e.nH;
  return s;
}

function buildTable(entries, solvent) {
  const tbody = document.getElementById('sig-tbody');
  tbody.innerHTML = "";
  let impCount = 0;
  const impIdx = [];

  entries.forEach((e, idx) => {
    const multi = e.isb ? ("br " + e.seq.join('')) : e.seq.join('');
    const id = likelyIdentity(e.center, multi, solvent);
    const tr = document.createElement('tr');
    if (id.isImp) {
      tr.classList.add('impurity');
      impCount++;
      impIdx.push(idx);
    }
    tr.dataset.idx = idx.toString();

    const mult = e.isb ? ("br " + e.seq.join('')) : e.seq.join('');
    const Js = e.Js.length ? e.Js.map(v => v.toFixed(1)).join(", ") : "—";
    const ident = id.isImp ? `<span class="badge imp">IMP</span> ${id.label}` : id.label;

    tr.innerHTML = `
      <td>${e.center.toFixed(2)}</td>
      <td>${mult}</td>
      <td>${Js}</td>
      <td>${(Math.round(e.nH * 100) / 100).toString()}</td>
      <td>${ident}</td>
    `;
    tr.addEventListener('click', () => selectSignal(idx));
    tbody.appendChild(tr);
  });
  return { impCount, impIdx };
}

function setStats(entries, imp, solvent, MHz) {
  document.getElementById('stat-solv').textContent = solvent || '—';
  document.getElementById('stat-mhz').textContent = isFinite(MHz) ? MHz.toFixed(1) : '—';
  document.getElementById('stat-nuclei').textContent = hsum(entries).toString();
  document.getElementById('stat-signals').textContent = entries.length.toString();
  document.getElementById('stat-imp').textContent = imp.toString();
}

function signalGamma(e, g0) {
  let g = g0;
  if (e.halfw > 0) g = Math.max(g, e.halfw);
  if (e.isb) g *= 20;
  return g;
}

function signalBand(e, MHz, g0) {
  const Jsppm = ensureJs(e.seq, e.Js).map(J => J / MHz);
  let pat = [[e.center, 1]];
  for (let j = 0; j < e.seq.length; j++) pat = convolve(pat, e.seq[j], Jsppm[j]);

  let minP = Infinity;
  let maxP = -Infinity;
  for (const p of pat) {
    if (p[0] < minP) minP = p[0];
    if (p[0] > maxP) maxP = p[0];
  }
  const g = signalGamma(e, g0);
  const pad = Math.max(2.5 * g, 0.01);
  return [minP - pad, maxP + pad];
}

function createPlot(canvas, overlay) {
  const ctx = canvas.getContext('2d');
  const ov  = overlay.getContext('2d');

  let dpr = window.devicePixelRatio || 1;
  let PAD = { L: 20, R: 20, T: 20, B: 44 };

  function pxL(){ return PAD.L * dpr }
function pxR(){ return PAD.R * dpr }
function pxT(){ return PAD.T * dpr }
function pxB(){ return PAD.B * dpr }

  function syncSize(widthCssPx, heightCssPx) {
    dpr = window.devicePixelRatio || 1;
    canvas.width  = Math.round(widthCssPx  * dpr);
    canvas.height = Math.round(heightCssPx * dpr);
    overlay.width  = canvas.width;
    overlay.height = canvas.height;
  }

  const ro = new ResizeObserver(entries => {
    for (const e of entries) {
      const cr = e.contentRect;
      syncSize(cr.width, cr.height);
      draw();
    }
  });
  ro.observe(canvas.parentElement);

  window.addEventListener('resize', () => { draw(); });

  const LINE_W = Math.max(2.5, Math.round(1 * dpr));

  let data = null;
  let xrange = [15, -1];
  let yrange = [0, 1.1];
  let defaultX = [15, -1];

  let drag = null;
  let dragType = null;
  let cross = false;
  let hover = { x: 0, y: 0, has: false };
  let selBand = null;
  let impBands = [];

overlay.addEventListener('mousedown', e => {
  const rect = overlay.getBoundingClientRect();
  const x = (e.clientX - rect.left) * dpr;
  const y = (e.clientY - rect.top) * dpr;

  const baseRaw = canvas.height - pxB();
  const align = (LINE_W % 2) ? 0.5 : 0;
  const baseline = Math.round(baseRaw) + align - 8 * dpr;
  const bandBottom = baseline + 0.40 * (canvas.height - baseline);

  const inAxisBand = (y >= baseline - 12 * dpr && y <= bandBottom);
  drag = { x0: x, y0: y, x1: x, y1: y };
  dragType = (inAxisBand || e.shiftKey || e.button === 1 || e.button === 2) ? 'pan' : 'zoom';
  drawOverlay();
});

overlay.addEventListener('mousemove', e => {
  const rect = overlay.getBoundingClientRect();
  hover = { x: (e.clientX - rect.left) * dpr, y: (e.clientY - rect.top) * dpr, has: true };

  if (!drag) { drawOverlay(); return; }

  if (dragType === 'zoom') {
    drag.x1 = hover.x;
    drag.y1 = hover.y;
  } else {
    const plotW = canvas.width - pxL() - pxR();
    const dxpix = hover.x - drag.x1;
    drag.x1 = hover.x;
    const frac = dxpix / Math.max(1, plotW);
    const span = (xrange[1] - xrange[0]);
    const shift = -frac * span;
    const globalLo = Math.min(defaultX[0], defaultX[1]);
    const globalHi = Math.max(defaultX[0], defaultX[1]);
    let newLo = xrange[0] + shift;
    let newHi = xrange[1] + shift;
    const width = newHi - newLo;
    if (newLo < globalLo) { newLo = globalLo; newHi = globalLo + width; }
    if (newHi > globalHi) { newHi = globalHi; newLo = globalHi - width; }
    xrange = [newLo, newHi];
    draw();
  }
  drawOverlay();
});

window.addEventListener('mouseup', () => {
  if (!drag) return;

  if (dragType === 'zoom') {
    const xA = Math.min(drag.x0, drag.x1);
    const xB = Math.max(drag.x0, drag.x1);

    const plotW = canvas.width - pxL() - pxR();
    const yMin  = pxT();
    const yMax  = Math.round(canvas.height - pxB()) - 8 * dpr;

    if (xB - xA > 10 && drag.y0 >= yMin && drag.y0 <= yMax) {
      const fA = (xA - pxL()) / plotW;
      const fB = (xB - pxL()) / plotW;
      const ppmA = lerp(xrange[0], xrange[1], fA);
      const ppmB = lerp(xrange[0], xrange[1], fB);

      const loGlob = Math.min(xrange[0], xrange[1]);
      const hiGlob = Math.max(xrange[0], xrange[1]);
      const loSel = Math.max(Math.min(ppmA, ppmB), loGlob);
      const hiSel = Math.min(Math.max(ppmA, ppmB), hiGlob);

      if (xrange[0] > xrange[1]) xrange = [hiSel, loSel];
      else                       xrange = [loSel, hiSel];

      draw();
    }
  }
  drag = null;
  dragType = null;
  drawOverlay();
});

overlay.addEventListener('wheel', e => {
  if (!data) return;
  e.preventDefault();

  const plotW = canvas.width - pxL() - pxR();

  if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) {
    const frac = e.deltaX / Math.max(1, plotW);
    const span = (xrange[1] - xrange[0]);
    const shift = frac * span;
    const globalLo = Math.min(defaultX[0], defaultX[1]);
    const globalHi = Math.max(defaultX[0], defaultX[1]);
    let newLo = xrange[0] + shift;
    let newHi = xrange[1] + shift;
    const width = newHi - newLo;
    if (newLo < globalLo) { newLo = globalLo; newHi = globalLo + width; }
    if (newHi > globalHi) { newHi = globalHi; newLo = globalHi - width; }
    xrange = [newLo, newHi];
    draw();
    return;
  }

  const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
  let ymax = yrange[1] * factor;
  if (ymax < 1e-9) ymax = 1e-9;
  if (!isFinite(ymax)) ymax = 1e9;
  yrange = [-BASELINE_OFFSET, ymax];
  draw();
}, { passive: false });

window.addEventListener('keydown', e => {
  if (e.key === 'f' || e.key === 'F') {
    xrange = defaultX.slice();
    draw();
    return;
  }
  if (e.key === 'y' || e.key === 'Y') {
    const y0 = (typeof BASELINE_OFFSET === 'number') ? -BASELINE_OFFSET : 0;
    yrange = [y0, 1.1];
    draw();
    return;
  }
  if (e.key === 'r' || e.key === 'R') {
    const y0 = (typeof BASELINE_OFFSET === 'number') ? -BASELINE_OFFSET : 0;
    xrange = defaultX.slice();
    yrange = [y0, 1.1];
    selBand = null;
    draw();
    if (typeof clearTableSelection === 'function') clearTableSelection();
    return;
  }
  if (e.key === 'c' || e.key === 'C') {
    cross = !cross;
    drawOverlay();
  }
});

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

function xToPix(x) {
  const w = canvas.width;
  const plotW = w - pxL() - pxR();
  const t = (x - xrange[0]) / (xrange[1] - xrange[0]);
  return pxL() + t * plotW;
}

function yToPix(y) {
  const h = canvas.height;
  const baseRaw = h - pxB();
  const align = (LINE_W % 2) ? 0.5 : 0;
  const baseline = Math.round(baseRaw) - 8 * dpr + align;
  const plotTop  = Math.round(pxT()) + align;
  const span = Math.max(1e-12, yrange[1]);
  const t = y / span;
  return baseline - t * (baseline - plotTop);
}

function tickSpec(min, max, approx = 8) {
  const span = Math.abs(max - min) || 1;
  const raw  = span / approx;
  const pow  = Math.pow(10, Math.floor(Math.log10(raw)));
  const err  = raw / pow;
  const mult = err >= 7 ? 10 : err >= 3 ? 5 : err >= 1.5 ? 2 : 1;
  const step = mult * pow;

  const lo = Math.ceil(Math.min(min, max) / step) * step;
  const hi = Math.floor(Math.max(min, max) / step) * step;

  const major = [];
  for (let v = lo; v <= hi + 1e-12; v += step) major.push(+v.toFixed(12));

  const minorStep = step / 5;
  const minor = [];
  for (let mv = lo - step; mv <= hi + step + 1e-12; mv += step) {
    for (let k = 1; k < 5; k++) minor.push(+((mv + k * minorStep).toFixed(12)));
  }

  const decimals = Math.max(0, Math.ceil(-Math.log10(Math.abs(step))));
  return { major, step, minor, minorStep, decimals };
}

function fmtTick(v, decimals) {
  const n = +v.toFixed(decimals + 2);
  return n.toFixed(decimals);
}

  function drawAxes() {
  const w = canvas.width, h = canvas.height;
  const baseRaw = h - pxB();
  const align = (LINE_W % 2) ? 0.5 : 0;
  const xAxisY = Math.round(baseRaw) + align - 0 * dpr;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = "#000";
  ctx.lineWidth = LINE_W;
  ctx.beginPath();
  ctx.moveTo(Math.round(pxL()) + align, xAxisY);
  ctx.lineTo(Math.round(w - pxR()) + align, xAxisY);
  ctx.stroke();

  const spec = tickSpec(xrange[0], xrange[1], 8);

  ctx.strokeStyle = "#000";
  ctx.lineWidth = 1 * dpr;
  for (const v of spec.minor) {
    const xp = xToPix(v);
    if (xp < pxL() - 1 || xp > w - pxR() + 1) continue;
    ctx.beginPath();
    ctx.moveTo(xp, xAxisY);
    ctx.lineTo(xp, xAxisY + 3 * dpr);
    ctx.stroke();
  }

  ctx.lineWidth = LINE_W;
  ctx.fillStyle = "#000";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.font = `${11 * dpr}px system-ui,Arial`;
  for (const v of spec.major) {
    const xp = xToPix(v);
    if (xp < pxL() - 1 || xp > w - pxR() + 1) continue;
    ctx.beginPath();
    ctx.moveTo(xp, xAxisY);
    ctx.lineTo(xp, xAxisY + 6 * dpr);
    ctx.stroke();
    ctx.fillText(fmtTick(v, spec.decimals), xp, xAxisY + 8 * dpr);
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("Chemical Shift (ppm)", (Math.round(pxL()) + Math.round(w - pxR())) / 2, Math.round(h - 6 * dpr));
}

  
function drawSpectrum() {
  if (!data) return;
  const w = canvas.width, h = canvas.height;
  const baseline = h - pxB() - 8 * dpr;

  const ax = data.axis, yv = data.y, N = ax.length;

  ctx.save();
  ctx.beginPath();
  ctx.rect(pxL(), pxT(), w - pxL() - pxR(), baseline + LINE_W / 2 - pxT());
  ctx.clip();

  ctx.strokeStyle = "#000";
  ctx.lineWidth = LINE_W;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  for (let i = 0; i < N; i++) {
    const xp = xToPix(ax[i]);
    const yp = yToPix(yv[i]);
    if (i === 0) ctx.moveTo(xp, yp); else ctx.lineTo(xp, yp);
  }
  ctx.stroke();
  ctx.restore();
}

function drawBands() {
  ov.save();
  ov.clearRect(0, 0, overlay.width, overlay.height);

  const w = canvas.width, h = canvas.height;
  const baseline = h - pxB() - 8 * dpr;

  ov.beginPath();
  ov.rect(pxL(), pxT(), w - pxL() - pxR(), baseline - pxT());
  ov.clip();

  if (impBands.length) {
    for (const b of impBands) {
      const x1 = xToPix(b[0]);
      const x2 = xToPix(b[1]);
      ov.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--impA').trim() || "rgba(245,158,11,0.12)";
      ov.fillRect(Math.min(x1, x2), pxT(), Math.abs(x2 - x1), baseline - pxT());
      ov.strokeStyle = "#f59e0b";
      ov.lineWidth = 1 * dpr;
      ov.strokeRect(Math.min(x1, x2), pxT(), Math.abs(x2 - x1), baseline - pxT());
    }
  }

  if (selBand) {
    const x1 = xToPix(selBand[0]);
    const x2 = xToPix(selBand[1]);
    ov.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--selA').trim() || "rgba(34,197,94,0.12)";
    ov.fillRect(Math.min(x1, x2), pxT(), Math.abs(x2 - x1), baseline - pxT());
    ov.strokeStyle = "rgba(34,197,94,0.0)";
    ov.lineWidth = 1 * dpr;
    ov.strokeRect(Math.min(x1, x2), pxT(), Math.abs(x2 - x1), baseline - pxT());
  }

  ov.restore();
}

function drawOverlay() {
  drawBands();

  const w = canvas.width, h = canvas.height;
  const baseRaw = h - pxB();
  const align = (LINE_W % 2) ? 0.5 : 0;
  const xAxisY = Math.round(baseRaw) + align - 8 * dpr;
  const baseline = h - pxB() - 8 * dpr;

  if (drag && dragType === 'zoom') {
    const x = Math.min(drag.x0, drag.x1);
    const wRect = Math.abs(drag.x1 - drag.x0);
    ov.save();
    ov.beginPath();
    ov.rect(pxL(), pxT(), w - pxL() - pxR(), baseline - pxT());
    ov.clip();
    ov.fillStyle = "rgba(0,128,255,0.12)";
    ov.fillRect(x, pxT(), wRect, baseline - pxT());
    ov.strokeStyle = "rgba(0,128,255,0.0)";
    ov.lineWidth = 0 * dpr;
    ov.strokeRect(x, pxT(), wRect, baseline - pxT());
    ov.restore();
  }

  const coordEl = document.getElementById('coords');
  if (cross && hover.has) {
    ov.strokeStyle = "rgba(0,0,0,0.25)";
    ov.lineWidth = 1 * dpr;
    ov.beginPath();
    ov.moveTo(hover.x, pxT());
    ov.lineTo(hover.x, overlay.height - pxB());
    ov.stroke();
    ov.beginPath();
    ov.moveTo(pxL(), hover.y);
    ov.lineTo(overlay.width - pxR(), hover.y);
    ov.stroke();

    const t = (hover.x - pxL()) / Math.max(1, (overlay.width - pxL() - pxR()));
    const ppm = lerp(xrange[0], xrange[1], t);
    hoverPpm = ppm;
const baselinePix = overlay.height - pxB() - 8 * dpr;
const hfrac = (baselinePix - hover.y) / Math.max(1, (baselinePix - pxT()));
const iy = Math.min(Math.max(0, hfrac * yrange[1]), yrange[1]);
    coordEl.textContent = `δ ${ppm.toFixed(4)} ppm, I ${iy.toFixed(3)}`;
    coordEl.classList.remove('hidden');
  } else {
    hoverPpm = null;
    coordEl.classList.add('hidden');
  }
}
  

  

function setData(d) {
  data = d;
  defaultX = d.view ? [d.view[1], d.view[0]] : [d.axis[d.axis.length - 1], d.axis[0]];
  xrange = defaultX.slice();
  yrange = [-BASELINE_OFFSET, 1.1];
  draw();
}

  function setHighlight(lo, hi) {
    selBand = [lo, hi];
    drawOverlay();
  }

  function setImpBands(b) {
    impBands = b.slice();
    drawOverlay();
  }

  function clearHighlight() {
    selBand = null;
    drawOverlay();
  }

  function draw() {
    drawAxes();
    drawSpectrum();
    drawOverlay();
  }

  return { setData, draw, setHighlight, clearHighlight, setImpBands, xToPix, yToPix, LINE_W, getXrange: () => xrange, getDefaultX: () => defaultX };
}

const plot = document.getElementById('plot');
const overlay = document.getElementById('overlay');
const inset = document.getElementById('inset');
const insetWrap = document.getElementById('inset-wrap');
const insetTitle = document.getElementById('inset-title');

const renderer = createPlot(plot, overlay);

let lastEntries = [];
let lastSim = null;
let currentInset = null;

function analyzeNow() {
  try {
    document.getElementById('error').textContent = "";
    const raw = document.getElementById('report').value.trim();

    const issues = validateACS(raw);
    const issueBox = document.getElementById('issues');
    const list = document.getElementById('issue-list');
    list.innerHTML = "";
    if (issues.length) {
      issueBox.classList.remove('hidden');
      issues.forEach(t => {
        const li = document.createElement('li');
        li.textContent = t;
        list.appendChild(li);
      });
      hideInset();
    } else {
      issueBox.classList.add('hidden');
    }

    const ppmMin = 15;
    const ppmMax = -1;
    const points = 65536;
    lastGamma = 0.001;

    const sim = simulateSpectrum(raw, ppmMin, ppmMax, points, lastGamma);
    renderer.setData(sim);
    renderer.clearHighlight();

    document.getElementById('meta').textContent =
      `MHz ${sim.MHz.toFixed(1)} • solvent ${sim.solvent || '—'} • entries ${sim.entries.length} • points ${points}`;

    const res = buildTable(sim.entries, sim.solvent);
setStats(sim.entries, res.impCount, sim.solvent, sim.MHz);

    lastEntries = sim.entries;
    lastSim = sim;

    const impBands = res.impIdx.map(i => signalBand(lastEntries[i], sim.MHz, lastGamma));
renderer.setImpBands(impBands);
  } catch (e) {
    document.getElementById('error').textContent = `Error: ${e.message}`;
  }
}

document.getElementById('analyze').addEventListener('click', analyzeNow);
window.addEventListener('load', analyzeNow);

function clearTableSelection() {
  const rows = [...document.querySelectorAll('#sig-tbody tr')];
  rows.forEach(r => r.classList.remove('active'));
}

function selectSignal(idx) {
  const rows = [...document.querySelectorAll('#sig-tbody tr')];
  const tr = rows[idx];

  if (tr && tr.classList.contains('active')) {
    tr.classList.remove('active');
    renderer.clearHighlight();
    return;
  }

  rows.forEach(r => r.classList.remove('active'));
  if (tr) tr.classList.add('active');

  const e = lastEntries[idx];
  if (!e || !lastSim) return;

  const band = signalBand(e, lastSim.MHz, lastGamma);
  renderer.setHighlight(band[0], band[1]);
}

function interpY(ppm, axis, y) {
  let lo = 0, hi = axis.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (axis[mid] < ppm) lo = mid; else hi = mid;
  }
  const x0 = axis[lo], x1 = axis[hi];
  const t = (ppm - x0) / (x1 - x0 || 1);
  return y[lo] * (1 - t) + y[hi] * t;
}





function analyzeAndRefresh() {
  analyzeNow();
}

document.getElementById('inset').addEventListener('mousemove', e => {
  if (!currentInset || !lastSim) return;
  if (!renderer) return;

  const rect = inset.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;

  const x = (e.clientX - rect.left) * dpr;
  const padL = 50 * dpr, padR = 12 * dpr;
  const W = inset.width;
  const t = (x - padL) / Math.max(1, (W - padL - padR));
  const ppm = currentInset.lo + t * (currentInset.hi - currentInset.lo);
  hoverPpm = ppm;

  drawInset(currentInset.lo, currentInset.hi, currentInset.entry);
});

function likelyBandsForImpurities(entries, solvent, MHz) {
  const idx = [];
  for (let i = 0; i < entries.length; i++) {
    const mult = entries[i].isb ? ('br ' + entries[i].seq.join('')) : entries[i].seq.join('');
    const id = likelyIdentity(entries[i].center, mult, solvent);
    if (id.isImp) idx.push(i);
  }
  return idx.map(i => signalBand(entries[i], MHz, lastGamma));
}

function analyzeNowAndBands() {
  analyzeNow();
  if (lastSim) {
    const bands = likelyBandsForImpurities(lastSim.entries, lastSim.solvent, lastSim.MHz);
    renderer.setImpBands(bands);
  }
}

const t = document.getElementById('theme-toggle');
t.addEventListener('click', () => {
  const root = document.documentElement;
  const dark = root.getAttribute('data-theme') === 'dark';
  root.setAttribute('data-theme', dark ? 'light' : 'dark');
  t.setAttribute('aria-checked', (!dark).toString());
});

(function () {
  const wrap = document.querySelector('.input-wrap');
  const btn  = document.getElementById('analyze');

  function syncDockPadding(){
    if (!wrap || !btn) return;
    const w = btn.offsetWidth;
    wrap.style.setProperty('--dock-pad-right', w + 'px');
  }

  window.addEventListener('load', syncDockPadding);
  window.addEventListener('resize', syncDockPadding);
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(syncDockPadding);
  }
})();

document.getElementById('analyze').addEventListener('click', analyzeNowAndBands);
