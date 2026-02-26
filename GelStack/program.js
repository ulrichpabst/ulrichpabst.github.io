const $ = (s) => document.querySelector(s);

const elDrop = $("#dropzone");
const elCanvas = $("#canvas");
const ctx = elCanvas.getContext("2d", { alpha: true });

const elLayers = $("#layers");
const elLayerCount = $("#layerCount");

const elPick = $("#btnPick");
const elPicker = $("#filePicker");

const elFit = $("#btnFit");
const elClear = $("#btnClear");
const elExport = $("#btnExport");
const elExportName = $("#exportName");

const elBgBlack = $("#bgBlack");
const elBgTransparent = $("#bgTransparent");
const elBgColor = $("#bgColor");
const elBgColorRow = $("#bgColorRow");
const elBgColorPick = $("#bgColorPick");
const elBgColorHex = $("#bgColorHex");

const state = {
  layers: [],
  activeId: null,

  worldW: 1200,
  worldH: 900,

  view: { panX: 0, panY: 0, zoom: 1 },

  pointer: {
    down: false,
    mode: "none",
    startX: 0, startY: 0,
    startPanX: 0, startPanY: 0,
    startLayer: null,
    startAngle: 0,
    startScale: 1,
  },

  dirty: false,
  listDrag: { draggingId: null },

  background: {
    mode: "black",
    color: "#000000"
  }
};

function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }
function gainFromEV(ev){ return Math.pow(2, ev); }

function hexToRgb(hex){
  const h = String(hex || "").trim().replace(/^#/, "");
  if (![3,6].includes(h.length)) return null;
  const full = h.length === 3 ? h.split("").map(c => c + c).join("") : h;
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return null;
  return { r: (n>>16)&255, g: (n>>8)&255, b: n&255 };
}
function normalizeHex(hex){
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const to2 = (x) => x.toString(16).padStart(2,"0");
  return "#" + to2(rgb.r) + to2(rgb.g) + to2(rgb.b);
}

function cssCanvasResize(){
  const r = elCanvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  elCanvas.width = Math.max(1, Math.floor(r.width * dpr));
  elCanvas.height = Math.max(1, Math.floor(r.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function worldToScreen(x,y){
  return { x: state.view.panX + x * state.view.zoom, y: state.view.panY + y * state.view.zoom };
}
function screenToWorld(x,y){
  return { x: (x - state.view.panX) / state.view.zoom, y: (y - state.view.panY) / state.view.zoom };
}

function requestRender(){
  if (state.dirty) return;
  state.dirty = true;
  requestAnimationFrame(() => { state.dirty = false; render(); });
}

function computeWorldSizeFromLayers(){
  if (state.layers.length === 0) return { w: 1200, h: 900 };
  return {
    w: Math.max(...state.layers.map(l => l.w)),
    h: Math.max(...state.layers.map(l => l.h)),
  };
}

function fitView(){
  cssCanvasResize();
  const r = elCanvas.getBoundingClientRect();
  const z = Math.min(r.width / state.worldW, r.height / state.worldH) * 0.95;
  state.view.zoom = z;
  state.view.panX = (r.width - state.worldW * z) / 2;
  state.view.panY = (r.height - state.worldH * z) / 2;
  requestRender();
}

function percentileFromHist(hist, p){
  const total = hist.reduce((a,b)=>a+b, 0);
  if (total === 0) return 0;
  const target = total * p;
  let c = 0;
  for (let i=0;i<256;i++){
    c += hist[i];
    if (c >= target) return i;
  }
  return 255;
}

function imageDataToLumaAndHist(imgData){
  const { data, width, height } = imgData;
  const n = width * height;

  const lum = new Uint8ClampedArray(n);
  const hist = new Uint32Array(256);
  let maxLum = 1;

  for (let i=0;i<n;i++){
    const r = data[i*4+0], g = data[i*4+1], b = data[i*4+2];
    const y = (0.2126*r + 0.7152*g + 0.0722*b) | 0;
    lum[i] = y;
    hist[y] += 1;
    if (y > maxLum) maxLum = y;
  }
  return { lum, maxLum, hist };
}

function computePostExposureBins(layer, ev){
  const bins = new Uint32Array(64);
  const gain = gainFromEV(ev);
  const white = Math.max(1, layer.whiteLum || layer.maxLum || 1);
  const hist = layer.hist;

  let totalNZ = 0;

  for (let i=1;i<256;i++){
    const c = hist[i];
    if (!c) continue;

    const x = clamp((i / white) * gain, 0, 1);
    const b = Math.min(63, Math.floor(x * 63));
    if (b === 0) continue;

    bins[b] += c;
    totalNZ += c;
  }

  bins.__totalNZ = totalNZ;
  return bins;
}

function entropyObjective(bins){
  const total = bins.reduce((a,b)=>a+b, 0);
  if (total === 0) return -1e9;

  let H = 0;
  for (const v of bins){
    if (!v) continue;
    const p = v / total;
    H -= p * Math.log(p);
  }
  const pSat = bins[63] / total;
  return H - 2.2 * pSat;
}

function autoExposureEV(layer){
  const EV_MIN = -8;
  const EV_MAX =  8;
  const STEP  = 0.10;

  let bestEV = layer.ev;
  let bestScore = -1e18;

  for (let ev = EV_MIN; ev <= EV_MAX + 1e-9; ev += STEP){
    const bins = computePostExposureBins(layer, ev);
    const score = entropyObjective(bins);
    if (score > bestScore){
      bestScore = score;
      bestEV = ev;
    }
  }
  const EV2_MIN = bestEV - 0.30;
  const EV2_MAX = bestEV + 0.30;
  const STEP2   = 0.02;

  for (let ev = EV2_MIN; ev <= EV2_MAX + 1e-9; ev += STEP2){
    const bins = computePostExposureBins(layer, ev);
    const score = entropyObjective(bins);
    if (score > bestScore){
      bestScore = score;
      bestEV = ev;
    }
  }

  layer.ev = clamp(bestEV, -10, 10);
}

async function decodeFile(file){
  const name = file.name || "image";
  const lower = name.toLowerCase();
  const isTiff = lower.endsWith(".tif") || lower.endsWith(".tiff") || file.type === "image/tiff";
  const buf = await file.arrayBuffer();

  if (isTiff){
    if (typeof UTIF === "undefined") throw new Error("TIFF support missing (UTIF.js not loaded).");
    const ifds = UTIF.decode(buf);
    UTIF.decodeImages(buf, ifds);
    const first = ifds[0];
    const rgba = UTIF.toRGBA8(first);
    const w = first.width, h = first.height;
    const imgData = new ImageData(new Uint8ClampedArray(rgba.buffer.slice(0)), w, h);
    return { w, h, imgData };
  }

  const blobUrl = URL.createObjectURL(new Blob([buf], { type: file.type || "application/octet-stream" }));
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("Failed to decode image: " + name));
    i.src = blobUrl;
  });
  URL.revokeObjectURL(blobUrl);

  const w = img.naturalWidth, h = img.naturalHeight;
  const tmp = document.createElement("canvas");
  tmp.width = w; tmp.height = h;
  const tctx = tmp.getContext("2d");
  tctx.drawImage(img, 0, 0);
  const imgData = tctx.getImageData(0, 0, w, h);
  return { w, h, imgData };
}

function buildColorizedCanvas(layer){
  const rgb = hexToRgb(layer.color) || { r:255, g:255, b:255 };
  const gain = gainFromEV(layer.ev);
  const white = Math.max(1, layer.whiteLum || layer.maxLum || 1);

  const c = document.createElement("canvas");
  c.width = layer.w; c.height = layer.h;
  const cctx = c.getContext("2d");
  const out = cctx.createImageData(layer.w, layer.h);

  const lum = layer.lum;
  for (let i=0;i<lum.length;i++){
    const t = clamp((lum[i] / white) * gain, 0, 1);
    out.data[i*4+0] = Math.round(rgb.r * t);
    out.data[i*4+1] = Math.round(rgb.g * t);
    out.data[i*4+2] = Math.round(rgb.b * t);
    out.data[i*4+3] = Math.round(255 * t);
  }
  cctx.putImageData(out, 0, 0);
  return c;
}

function ensureCache(layer){
  const key = `${layer.color}|${layer.ev.toFixed(3)}|${layer.whiteLum}`;
  if (layer.cacheKey === key && layer.cache) return;

  layer.cacheKey = key;
  layer.cachePending = true;

  requestAnimationFrame(() => {
    if (!state.layers.find(l => l.id === layer.id)) return;
    layer.cache = buildColorizedCanvas(layer);
    layer.cachePending = false;
    requestRender();
  });
}

function drawMiniHist(canvas, layer){
  const w = canvas.width, h = canvas.height;
  const g = canvas.getContext("2d");
  g.clearRect(0,0,w,h);

  g.fillStyle = "rgba(12,15,20,.03)";
  g.fillRect(0,0,w,h);

  const bins = computePostExposureBins(layer, layer.ev);
  const totalNZ = bins.__totalNZ || 0;

  if (totalNZ < 64){
    g.fillStyle = "rgba(12,15,20,.18)";
    g.fillRect(0, h-2, w, 2);
    return;
  }

  const freqs = new Float32Array(64);
  let maxF = 1e-12;
  for (let i=0;i<64;i++){
    const f = bins[i] / totalNZ;
    freqs[i] = f;
    if (f > maxF) maxF = f;
  }

  const barW = w / 64;
  g.fillStyle = "rgba(12,15,20,.78)";

  for (let i=0;i<64;i++){
    const t = freqs[i] / maxF;
    const bh = Math.max(1, Math.round(t * (h - 4)));
    const x = Math.floor(i * barW);
    const bw = Math.max(1, Math.ceil(barW));
    g.fillRect(x, h - bh, bw, bh);
  }

  g.fillStyle = "rgba(12,15,20,.12)";
  g.fillRect(w - 2, 0, 2, h);
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, (c)=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[c]));
}

function addLayer(file, decoded){
  const { w, h, imgData } = decoded;
  const { lum, maxLum, hist } = imageDataToLumaAndHist(imgData);

  const whiteLum = Math.max(1, percentileFromHist(hist, 0.995));

  const id = crypto.randomUUID();
  const layer = {
    id,
    name: file.name || `Layer ${state.layers.length + 1}`,
    visible: true,

    w, h,
    lum, maxLum, hist,
    whiteLum,

    color: "#ffffff",
    ev: 0.0,

    x: state.worldW / 2,
    y: state.worldH / 2,
    scale: 1,
    rot: 0,

    cache: null,
    cacheKey: "",
    cachePending: false,
  };

  state.layers.push(layer);
  state.activeId = id;

  const ws = computeWorldSizeFromLayers();
  state.worldW = ws.w;
  state.worldH = ws.h;

  for (const l of state.layers){
    l.x = state.worldW / 2;
    l.y = state.worldH / 2;
  }

  ensureCache(layer);
  rebuildLayerList();
  fitView();
  requestRender();
}

async function addFiles(fileList){
  for (const file of [...fileList]){
    try{
      const decoded = await decodeFile(file);
      addLayer(file, decoded);
    } catch(e){
      console.error(e);
      alert(`Failed to import "${file.name}":\n${e.message || e}`);
    }
  }
}

function getActiveLayer(){
  return state.layers.find(l => l.id === state.activeId) || null;
}

function setActive(id){
  state.activeId = id;
  for (const el of elLayers.querySelectorAll(".layer")){
    el.classList.toggle("active", el.dataset.id === id);
  }
  requestRender();
}

function rebuildLayerList(){
  elLayers.innerHTML = "";
  elLayerCount.textContent = `${state.layers.length}`;

  const ui = [...state.layers].reverse();

  for (const layer of ui){
    const card = document.createElement("div");
    card.className = "layer" + (layer.id === state.activeId ? " active" : "");
    card.dataset.id = layer.id;

    card.innerHTML = `
      <div class="layerHead">
        <div class="dragHandle" data-act="drag" title="Drag to reorder" aria-label="Drag to reorder">≡</div>
        <div class="layerName" title="${escapeHtml(layer.name)}">${escapeHtml(layer.name)}</div>
        <button class="iconBtn" data-act="vis" title="Toggle visibility">${layer.visible ? "Hide" : "Show"}</button>
        <button class="iconBtn" data-act="del" title="Delete">Delete</button>
      </div>

      <div class="layerBody">
        <div class="row colorRow">
          <input type="color" value="${layer.color}" data-k="colorPick" aria-label="Layer color"/>
          <input type="text" value="${layer.color}" data-k="colorHex" spellcheck="false" aria-label="Layer color hex"/>
        </div>

        <canvas class="hist" width="240" height="30" data-k="hist" aria-label="Histogram"></canvas>

        <div class="exposure">
          <div class="exposureTop">
            <span>Exposure</span>
            <span><b data-k="evLabel">${layer.ev.toFixed(2)} EV</b></span>
          </div>
          <div class="exposureControls">
            <input type="range" min="-10" max="10" step="0.01" value="${layer.ev}" data-k="ev" aria-label="Exposure slider"/>
            <button class="btnMini" data-act="auto" title="Auto exposure">Auto</button>
          </div>
        </div>
      </div>
    `;

    elLayers.appendChild(card);

    const histCanvas = card.querySelector('canvas[data-k="hist"]');
    if (histCanvas) drawMiniHist(histCanvas, layer);
  }
}

function removeLayer(id){
  const i = state.layers.findIndex(l => l.id === id);
  if (i < 0) return;
  state.layers.splice(i, 1);
  if (state.activeId === id) state.activeId = state.layers.at(-1)?.id ?? null;

  const ws = computeWorldSizeFromLayers();
  state.worldW = ws.w;
  state.worldH = ws.h;

  rebuildLayerList();
  fitView();
  requestRender();
}

function moveLayerByIdsTopToBottom(newOrderTopToBottom){
  const map = new Map(state.layers.map(l => [l.id, l]));
  const bottomToTop = [...newOrderTopToBottom].reverse();
  const next = [];
  for (const id of bottomToTop){
    const l = map.get(id);
    if (l) next.push(l);
  }
  state.layers = next;
  rebuildLayerList();
  requestRender();
}

elLayers.addEventListener("pointerdown", (ev) => {
  const card = ev.target.closest(".layer");
  if (!card) return;
  const id = card.dataset.id;

  const act = ev.target?.dataset?.act;
  if (act === "drag"){
    ev.preventDefault();
    ev.stopPropagation();
    state.listDrag.draggingId = id;
    document.body.classList.add("dragging");
    card.setPointerCapture(ev.pointerId);
    card.style.opacity = "0.6";
    return;
  }

  const isControl = ev.target.closest("button, input, select, textarea");
  if (!isControl) setActive(id);
});

elLayers.addEventListener("pointermove", (ev) => {
  const draggingId = state.listDrag.draggingId;
  if (!draggingId) return;

  ev.preventDefault();

  const draggingEl = elLayers.querySelector(`.layer[data-id="${draggingId}"]`);
  if (!draggingEl) return;

  const y = ev.clientY;
  const siblings = [...elLayers.querySelectorAll(".layer")].filter(el => el !== draggingEl);

  let before = null;
  for (const s of siblings){
    const r = s.getBoundingClientRect();
    if (y < r.top + r.height/2){ before = s; break; }
  }
  if (before) elLayers.insertBefore(draggingEl, before);
  else elLayers.appendChild(draggingEl);
});

elLayers.addEventListener("pointerup", (ev) => {
  const draggingId = state.listDrag.draggingId;
  if (!draggingId) return;

  ev.preventDefault();

  const draggingEl = elLayers.querySelector(`.layer[data-id="${draggingId}"]`);
  if (draggingEl) draggingEl.style.opacity = "";

  state.listDrag.draggingId = null;
  document.body.classList.remove("dragging");

  const ids = [...elLayers.querySelectorAll(".layer")].map(el => el.dataset.id);
  moveLayerByIdsTopToBottom(ids);
});

elLayers.addEventListener("click", (ev) => {
  const card = ev.target.closest(".layer");
  if (!card) return;
  const id = card.dataset.id;

  const btn = ev.target.closest("button");
  if (!btn) return;

  const act = btn.dataset.act;
  if (!act) return;

  setActive(id);

  const layer = state.layers.find(l => l.id === id);
  if (!layer) return;

  if (act === "vis"){
    layer.visible = !layer.visible;
    btn.textContent = layer.visible ? "Hide" : "Show";
    requestRender();
  }
  if (act === "del"){
    removeLayer(id);
  }
  if (act === "auto"){
    autoExposureEV(layer);
    ensureCache(layer);

    const slider = card.querySelector('input[data-k="ev"]');
    const label = card.querySelector('[data-k="evLabel"]');
    if (slider) slider.value = layer.ev;
    if (label) label.textContent = `${layer.ev.toFixed(2)} EV`;

    const histCanvas = card.querySelector('canvas[data-k="hist"]');
    if (histCanvas) drawMiniHist(histCanvas, layer);

    requestRender();
  }
});

elLayers.addEventListener("input", (ev) => {
  const card = ev.target.closest(".layer");
  if (!card) return;
  const id = card.dataset.id;

  const layer = state.layers.find(l => l.id === id);
  if (!layer) return;

  const k = ev.target?.dataset?.k;
  if (!k) return;

  setActive(id);

  if (k === "colorPick"){
    const hex = normalizeHex(ev.target.value);
    if (!hex) return;
    layer.color = hex;

    const hexBox = card.querySelector('input[data-k="colorHex"]');
    if (hexBox) hexBox.value = hex;

    ensureCache(layer);
    requestRender();
  }

  if (k === "colorHex"){
    const hex = normalizeHex(ev.target.value);
    if (!hex) return;
    layer.color = hex;

    const pick = card.querySelector('input[data-k="colorPick"]');
    if (pick) pick.value = hex;

    ensureCache(layer);
    requestRender();
  }

  if (k === "ev"){
    layer.ev = Number(ev.target.value);

    const label = card.querySelector('[data-k="evLabel"]');
    if (label) label.textContent = `${layer.ev.toFixed(2)} EV`;

    ensureCache(layer);

    const histCanvas = card.querySelector('canvas[data-k="hist"]');
    if (histCanvas) drawMiniHist(histCanvas, layer);

    requestRender();
  }
});

function setBgMode(mode){
  state.background.mode = mode;
  elBgBlack.classList.toggle("isOn", mode === "black");
  elBgTransparent.classList.toggle("isOn", mode === "transparent");
  elBgColor.classList.toggle("isOn", mode === "color");
  elBgColorRow.style.display = (mode === "color") ? "flex" : "none";
  requestRender();
}

elBgBlack.addEventListener("click", () => setBgMode("black"));
elBgTransparent.addEventListener("click", () => setBgMode("transparent"));
elBgColor.addEventListener("click", () => setBgMode("color"));

elBgColorPick.addEventListener("input", () => {
  const hex = normalizeHex(elBgColorPick.value);
  if (!hex) return;
  state.background.color = hex;
  elBgColorHex.value = hex;
  if (state.background.mode !== "color") setBgMode("color");
  requestRender();
});
elBgColorHex.addEventListener("input", () => {
  const hex = normalizeHex(elBgColorHex.value);
  if (!hex) return;
  state.background.color = hex;
  elBgColorPick.value = hex;
  if (state.background.mode !== "color") setBgMode("color");
  requestRender();
});

function layerMatrix(layer){
  const cos = Math.cos(layer.rot), sin = Math.sin(layer.rot);
  return { cx: layer.x, cy: layer.y, s: layer.scale, cos, sin };
}
function pointInLayer(layer, wx, wy){
  const { cx, cy, s, cos, sin } = layerMatrix(layer);
  const dx = wx - cx, dy = wy - cy;
  const lx = ( cos * dx + sin * dy) / s;
  const ly = (-sin * dx + cos * dy) / s;
  return (Math.abs(lx) <= layer.w/2) && (Math.abs(ly) <= layer.h/2);
}
function layerCornersWorld(layer){
  const { cx, cy, s, cos, sin } = layerMatrix(layer);
  const hw = layer.w/2, hh = layer.h/2;
  const local = [{x:-hw,y:-hh},{x:hw,y:-hh},{x:hw,y:hh},{x:-hw,y:hh}];
  return local.map(p => ({
    x: cx + (cos*(p.x*s) - sin*(p.y*s)),
    y: cy + (sin*(p.x*s) + cos*(p.y*s))
  }));
}
function drawHandle(x,y,kind){
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(37,99,255,.90)";
  ctx.fillStyle = "rgba(255,255,255,.92)";
  if (kind === "circle"){
    ctx.beginPath(); ctx.arc(x,y,6,0,Math.PI*2); ctx.fill(); ctx.stroke();
  } else {
    ctx.beginPath(); ctx.rect(x-6,y-6,12,12); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}
function drawSelection(layer){
  const pts = layerCornersWorld(layer).map(p => worldToScreen(p.x,p.y));
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(37,99,255,.90)";
  ctx.setLineDash([4,4]);
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i=1;i<4;i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);
  for (const p of pts) drawHandle(p.x,p.y,"square");

  const mx = (pts[0].x + pts[1].x)/2, my = (pts[0].y + pts[1].y)/2;
  const bx = (pts[2].x + pts[3].x)/2, by = (pts[2].y + pts[3].y)/2;
  const vx = mx - bx, vy = my - by;
  const len = Math.hypot(vx,vy) || 1;
  const rx = mx + (vx/len)*22, ry = my + (vy/len)*22;

  ctx.strokeStyle = "rgba(37,99,255,.50)";
  ctx.beginPath(); ctx.moveTo(mx,my); ctx.lineTo(rx,ry); ctx.stroke();
  drawHandle(rx,ry,"circle");
  ctx.restore();

  layer.__handles = { scale: pts.map(p => ({x:p.x,y:p.y})), rotate: {x:rx,y:ry} };
}
function hitTestHandles(layer, sx, sy){
  if (!layer.__handles) return null;
  const d2 = (ax,ay,bx,by)=> (ax-bx)**2 + (ay-by)**2;
  if (d2(sx,sy,layer.__handles.rotate.x,layer.__handles.rotate.y) <= 9*9) return { type:"rotate" };
  const i = layer.__handles.scale.findIndex(p => d2(sx,sy,p.x,p.y) <= 9*9);
  if (i >= 0) return { type:"scale", corner:i };
  return null;
}
function pickTopLayer(worldPt){
  for (let i=state.layers.length-1;i>=0;i--){
    const l = state.layers[i];
    if (!l.visible) continue;
    if (pointInLayer(l, worldPt.x, worldPt.y)) return l;
  }
  return null;
}
function pointerPos(ev){
  const r = elCanvas.getBoundingClientRect();
  return { x: ev.clientX - r.left, y: ev.clientY - r.top };
}
function angleBetween(a,b){ return Math.atan2(b.y - a.y, b.x - a.x); }

function paintBackgroundToCtx(targetCtx, width, height){
  const mode = state.background.mode;
  if (mode === "transparent") return;

  let color = "#000000";
  if (mode === "color") color = state.background.color || "#000000";

  targetCtx.save();
  targetCtx.globalCompositeOperation = "source-over";
  targetCtx.fillStyle = color;
  targetCtx.fillRect(0, 0, width, height);
  targetCtx.restore();
}

function render(){
  const r = elCanvas.getBoundingClientRect();

  paintBackgroundToCtx(ctx, r.width, r.height);

  const p0 = worldToScreen(0,0);
  const p1 = worldToScreen(state.worldW, state.worldH);
  ctx.save();
  ctx.strokeStyle = "rgba(12,15,20,.10)";
  ctx.lineWidth = 1;
  ctx.strokeRect(p0.x, p0.y, p1.x - p0.x, p1.y - p0.y);
  ctx.restore();

  for (const layer of state.layers){
    if (!layer.visible) continue;
    ensureCache(layer);
    if (!layer.cache) continue;

    const s = state.view.zoom;
    const sc = layer.scale * s;
    const c = worldToScreen(layer.x, layer.y);

    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(layer.rot);
    ctx.scale(sc, sc);
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(layer.cache, -layer.w/2, -layer.h/2);
    ctx.restore();
  }

  const a = getActiveLayer();
  if (a && a.visible) drawSelection(a);

  ctx.globalCompositeOperation = "source-over";
}

elCanvas.addEventListener("pointerdown", (ev) => {
  elCanvas.setPointerCapture(ev.pointerId);
  const sp = pointerPos(ev);
  state.pointer.down = true;
  state.pointer.startX = sp.x;
  state.pointer.startY = sp.y;

  if (ev.altKey){
    state.pointer.mode = "pan";
    state.pointer.startPanX = state.view.panX;
    state.pointer.startPanY = state.view.panY;
    return;
  }

  const active = getActiveLayer();
  if (active && active.__handles){
    const h = hitTestHandles(active, sp.x, sp.y);
    if (h?.type === "rotate"){
      state.pointer.mode = "rotate";
      state.pointer.startLayer = { ...active };
      state.pointer.startAngle = angleBetween(worldToScreen(active.x, active.y), sp);
      return;
    }
    if (h?.type === "scale"){
      state.pointer.mode = "scale";
      state.pointer.startLayer = { ...active };
      state.pointer.startScale = active.scale;
      return;
    }
  }

  const worldPt = screenToWorld(sp.x, sp.y);
  const hit = pickTopLayer(worldPt);
  if (hit){
    setActive(hit.id);
    state.pointer.mode = "move";
    state.pointer.startLayer = { ...hit };
  } else {
    state.pointer.mode = "none";
  }
});

elCanvas.addEventListener("pointermove", (ev) => {
  if (!state.pointer.down) return;
  const sp = pointerPos(ev);
  const dx = sp.x - state.pointer.startX;
  const dy = sp.y - state.pointer.startY;

  if (state.pointer.mode === "pan"){
    state.view.panX = state.pointer.startPanX + dx;
    state.view.panY = state.pointer.startPanY + dy;
    requestRender();
    return;
  }

  const layer = getActiveLayer();
  if (!layer) return;

  if (state.pointer.mode === "move"){
    layer.x = state.pointer.startLayer.x + dx / state.view.zoom;
    layer.y = state.pointer.startLayer.y + dy / state.view.zoom;
    requestRender();
  }

  if (state.pointer.mode === "scale"){
    const dist = Math.hypot(dx,dy);
    const sign = (dx + dy) >= 0 ? 1 : -1;
    const factor = Math.exp((sign * dist) / 220);
    layer.scale = clamp(state.pointer.startLayer.scale * factor, 0.01, 50);
    requestRender();
  }

  if (state.pointer.mode === "rotate"){
    const centerS = worldToScreen(layer.x, layer.y);
    const a0 = state.pointer.startAngle;
    const a1 = angleBetween(centerS, sp);
    layer.rot = state.pointer.startLayer.rot + (a1 - a0);
    requestRender();
  }
});

elCanvas.addEventListener("pointerup", () => {
  state.pointer.down = false;
  state.pointer.mode = "none";
  state.pointer.startLayer = null;
});

elCanvas.addEventListener("wheel", (ev) => {
  ev.preventDefault();
  const layer = getActiveLayer();
  if (!layer) return;

  const delta = -ev.deltaY;
  if (ev.shiftKey){
    layer.rot += delta * 0.0018;
  } else {
    const factor = Math.exp(delta * 0.0015);
    layer.scale = clamp(layer.scale * factor, 0.01, 50);
  }
  requestRender();
}, { passive:false });

/* drop / pick */
elDrop.addEventListener("dragover", (ev) => { ev.preventDefault(); elDrop.classList.add("dragover"); });
elDrop.addEventListener("dragleave", () => elDrop.classList.remove("dragover"));
elDrop.addEventListener("drop", (ev) => {
  ev.preventDefault();
  elDrop.classList.remove("dragover");
  const files = ev.dataTransfer?.files;
  if (files && files.length) addFiles(files);
});

elPick.addEventListener("click", () => elPicker.click());
elPicker.addEventListener("change", (ev) => {
  const files = ev.target.files;
  if (files && files.length) addFiles(files);
  ev.target.value = "";
});

function renderToOffscreenPNG(){
  const out = document.createElement("canvas");
  out.width = state.worldW;
  out.height = state.worldH;
  const octx = out.getContext("2d", { alpha:true });

  paintBackgroundToCtx(octx, out.width, out.height);

  for (const layer of state.layers){
    if (!layer.visible) continue;
    ensureCache(layer);
    if (!layer.cache) continue;

    octx.save();
    octx.translate(layer.x, layer.y);
    octx.rotate(layer.rot);
    octx.scale(layer.scale, layer.scale);
    octx.globalCompositeOperation = "source-over";
    octx.drawImage(layer.cache, -layer.w/2, -layer.h/2);
    octx.restore();
  }
  octx.globalCompositeOperation = "source-over";
  return out;
}

elExport.addEventListener("click", () => {
  if (state.layers.length === 0){
    alert("No layers to export.");
    return;
  }
  const base = (elExportName.value || "gel_overlay").trim().replace(/[^\w\-]+/g, "_") || "gel_overlay";
  const filename = `${base}.png`;

  const out = renderToOffscreenPNG();
  const url = out.toDataURL("image/png");

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
});

elFit.addEventListener("click", () => fitView());
elClear.addEventListener("click", () => {
  state.layers = [];
  state.activeId = null;
  state.worldW = 1200;
  state.worldH = 900;
  rebuildLayerList();
  fitView();
  requestRender();
});

window.addEventListener("resize", () => { cssCanvasResize(); fitView(); });

(function init(){
  cssCanvasResize();
  rebuildLayerList();
  setBgMode("black");
  fitView();
  requestRender();
})();
