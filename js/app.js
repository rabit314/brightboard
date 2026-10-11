'use strict';
/* ================================================================
   BRIGHTBOARD — SMART WHITEBOARD & NOTEBOOK ENGINE
   Version: 1.4.0
   ================================================================ */

/* ================================================================
   1. CONSTANTS & TINY HELPERS
   ================================================================ */
const APP_VERSION = '1.4.0';
const PAPER = '#FCFAF3';
const ACCENT = '#E4572E';
const STICKY_INK = '#4A423A';
const MARKERS = ['#23282F', '#D93A3A', '#E8722A', '#C99700', '#2F9E44',
                 '#0C8599', '#1F6FEB', '#7048E8', '#D6336C'];
const NOTES = ['#FFE9A8', '#FFD2A8', '#C4E8CE', '#C4DDF0', '#E4CDF2'];
const HIST_MAX = 30;
const TH_W = 144, TH_H = 81;
const SAVE_KEY = 'brightboard.board.v1';
const RECOVERY_KEY = 'brightboard.recovery.v1';

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const uid = () => Math.random().toString(36).slice(2, 10);
const cloneObj = o => { const n = JSON.parse(JSON.stringify(o)); n.id = uid(); return n; };
const getTimestamp = () => {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
};

const X_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const PLUS_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';

/* ================================================================
   2. APP STATE
   ================================================================ */
const state = {
  tool: 'pen',
  color: MARKERS[0],
  custom: null,          // last custom colour picked
  size: 4,
  opacity: 1,
  fontSize: 28,
  noteColor: NOTES[0],
  fill: false,           // light tint fill for rect / ellipse
  pageIndex: 0,
  selectedIds: new Set(),// multi-selection support
};

const IMG = new Map();   // imgId -> { el, src, w, h }
let boardGeneration = 0; // ignore asynchronous imports from a replaced notebook
const pages = [];
const deletedPagesHistory = []; // stack of { page, index } for Ctrl+Z restoration
const page = () => pages[state.pageIndex] || pages[0];

function newPage(bg) {
  return {
    id: uid(),
    objects: [],
    bg: bg || 'grid',
    view: { zoom: 1, panX: 0, panY: 0 },
    undo: [],
    redo: [],
    thumbCanvas: null,
    thumbDirty: true
  };
}
pages.push(newPage());

let action = null;       // current pointer gesture
let editing = null;      // { obj, kind:'text'|'sticky', isNew, original }
let laserPts = [];       // laser trail in SCREEN coordinates
let needsRender = true;
let spaceHeld = false;
let modalOpen = false;
let clipObjects = null;  // clipboard objects array for multi-copy/paste
let clipImages = [];     // self-contained assets for internal clipboard fallback
let lastPtr = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
const activePtrs = new Map();   // pointerId -> {x,y}  (for pinch gestures)
let lastTapTime = 0;     // for mobile double-tap detection
let lastTapPoint = null;

const getObject = id => page().objects.find(o => o.id === id);
const getSelectedObjects = () => page().objects.filter(o => state.selectedIds.has(o.id));
const removeObject = id => {
  const p = page().objects;
  const i = p.findIndex(o => o.id === id);
  if (i >= 0) p.splice(i, 1);
};

const CURSORS = {
  select: 'default',
  pen: 'none',
  highlighter: 'none',
  bucket: 'crosshair',
  eraser: 'none',
  line: 'crosshair',
  rect: 'crosshair',
  ellipse: 'crosshair',
  arrow: 'crosshair',
  text: 'text',
  sticky: 'crosshair',
  laser: 'none',
  hand: 'grab'
};

const ROTATE_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 28 28'%3E%3Cg fill='none' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M14 4 A10 10 0 0 1 24 14' stroke='%23ffffff' stroke-width='4'/%3E%3Cpolyline points='20 4 24 4 24 8' stroke='%23ffffff' stroke-width='4'/%3E%3Cpath d='M14 24 A10 10 0 0 1 4 14' stroke='%23ffffff' stroke-width='4'/%3E%3Cpolyline points='8 24 4 24 4 20' stroke='%23ffffff' stroke-width='4'/%3E%3Cpath d='M14 4 A10 10 0 0 1 24 14' stroke='%2318181b' stroke-width='2'/%3E%3Cpolyline points='20 4 24 4 24 8' stroke='%2318181b' stroke-width='2'/%3E%3Cpath d='M14 24 A10 10 0 0 1 4 14' stroke='%2318181b' stroke-width='2'/%3E%3Cpolyline points='8 24 4 24 4 20' stroke='%2318181b' stroke-width='2'/%3E%3C/g%3E%3C/svg%3E") 14 14, crosshair`;

const TOOLKEYS = {
  v: 'select',
  p: 'pen',
  h: 'highlighter',
  e: 'eraser',
  b: 'bucket',
  l: 'line',
  r: 'rect',
  o: 'ellipse',
  a: 'arrow',
  t: 'text',
  n: 'sticky',
  k: 'laser'
};

/* ================================================================
   3. CANVAS SETUP, VIEW (ZOOM & PAN)
   ================================================================ */
const canvas = $('board');
const ctx = canvas.getContext('2d');
let VW = 0, VH = 0, dpr = 1;

function resizeCanvas() {
  VW = window.innerWidth;
  VH = window.innerHeight;
  dpr = window.devicePixelRatio || 1;
  canvas.width  = Math.round(VW * dpr);
  canvas.height = Math.round(VH * dpr);
  canvas.style.width = VW + 'px';
  canvas.style.height = VH + 'px';
  needsRender = true;
}
window.addEventListener('resize', resizeCanvas);

const worldFromClient = (cx, cy) => {
  const v = page().view;
  return { x: clamp((cx - v.panX) / v.zoom, -1e9, 1e9), y: clamp((cy - v.panY) / v.zoom, -1e9, 1e9) };
};

function constrainView(v) {
  v.panX = clamp(v.panX, -1e9, 1e9);
  v.panY = clamp(v.panY, -1e9, 1e9);
}

function setZoom(z, cx = VW / 2, cy = VH / 2) {
  const v = page().view;
  const wx = (cx - v.panX) / v.zoom, wy = (cy - v.panY) / v.zoom;
  v.zoom = clamp(z, 0.2, 5);
  v.panX = cx - wx * v.zoom;
  v.panY = cy - wy * v.zoom;
  constrainView(v);
  updateZoomLabel();
  needsRender = true;
}
const zoomBy = (f, cx, cy) => setZoom(page().view.zoom * f, cx, cy);

function updateZoomLabel() {
  $('zoomLabel').textContent = Math.round(page().view.zoom * 100) + '%';
}

function fitView() {
  const b = contentBounds(page().objects);
  if (!b) { setZoom(1); return; }
  const v = page().view;
  v.zoom = clamp(Math.min((VW - 100) / Math.max(b.w, 1), (VH - 190) / Math.max(b.h, 1)), 0.2, 2);
  v.panX = (VW - b.w * v.zoom) / 2 - b.x * v.zoom;
  v.panY = (VH - b.h * v.zoom) / 2 - b.y * v.zoom;
  constrainView(v);
  updateZoomLabel();
  needsRender = true;
}

/* ================================================================
   4. RENDERING ENGINE
   ================================================================ */
function rr(c, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function paintBoard(c, W, H, view, bg, objects, editingId) {
  c.fillStyle = PAPER;
  c.fillRect(0, 0, W, H);
  const worldRect = [
    -view.panX / view.zoom,
    -view.panY / view.zoom,
    (W - view.panX) / view.zoom,
    (H - view.panY) / view.zoom
  ];
  c.save();
  c.translate(view.panX, view.panY);
  c.scale(view.zoom, view.zoom);
  drawBackgroundPattern(c, view.zoom, bg, worldRect);
  drawObjects(c, objects, editingId);
  c.restore();
}

function drawBackgroundPattern(c, zoom, bg, [wx0, wy0, wx1, wy1]) {
  if (bg === 'blank') return;
  c.save();
  if (bg === 'grid') {
    let s = 40;
    while ((wx1 - wx0 + wy1 - wy0) / s > 2000) s *= 2;
    c.strokeStyle = 'rgba(35,40,47,0.075)';
    c.lineWidth = 1 / zoom;
    c.beginPath();
    for (let x = Math.floor(wx0 / s) * s; x <= wx1; x += s) { c.moveTo(x, wy0); c.lineTo(x, wy1); }
    for (let y = Math.floor(wy0 / s) * s; y <= wy1; y += s) { c.moveTo(wx0, y); c.lineTo(wx1, y); }
    c.stroke();
  } else if (bg === 'dots') {
    let s = 40;
    while ((Math.ceil((wx1 - wx0) / s) + 2) * (Math.ceil((wy1 - wy0) / s) + 2) > 3500) s *= 2;
    const r = 2 / zoom;
    c.fillStyle = 'rgba(35,40,47,0.22)';
    c.beginPath();
    for (let x = Math.floor(wx0 / s) * s; x <= wx1; x += s) {
      for (let y = Math.floor(wy0 / s) * s; y <= wy1; y += s) {
        c.moveTo(x + r, y);
        c.arc(x, y, r, 0, Math.PI * 2);
      }
    }
    c.fill();
  } else if (bg === 'ruled') {
    let s = 52;
    while ((wy1 - wy0) / s > 1000) s *= 2;
    c.strokeStyle = 'rgba(35,40,47,0.10)';
    c.lineWidth = 1 / zoom;
    c.beginPath();
    for (let y = Math.floor(wy0 / s) * s; y <= wy1; y += s) { c.moveTo(wx0, y); c.lineTo(wx1, y); }
    c.stroke();
    c.strokeStyle = 'rgba(214,90,60,0.30)';
    c.lineWidth = 1.5 / zoom;
    c.beginPath();
    c.moveTo(64, wy0);
    c.lineTo(64, wy1);
    c.stroke();
  }
  c.restore();
}

function drawObjects(c, objects, editingId) {
  for (const o of objects) {
    if (editingId && o.id === editingId) {
      if (o.type === 'text') continue;                  // live textarea shows it
      if (o.type === 'sticky') { c.save(); c.globalAlpha *= o.opacity ?? 1; drawSticky(c, o, true); c.restore(); continue; }
    }
    drawObject(c, o);
  }
}

function drawObject(c, o) {
  c.save();
  c.globalAlpha *= o.opacity ?? 1;
  switch (o.type) {
    case 'stroke':  drawStroke(c, o); break;
    case 'line':
    case 'rect':
    case 'ellipse':
    case 'arrow':   drawShape(c, o); break;
    case 'text':    drawTextObj(c, o); break;
    case 'image':   drawImageObj(c, o); break;
    case 'sticky':  drawSticky(c, o, false); break;
  }
  c.restore();
}

const translucentStrokeLayers = new WeakMap();
function drawStroke(c, o) {
  const pts = o.points;
  if (!pts || !pts.length) return;
  // Composite translucent pen segments once so joins do not turn into dark dots.
  if (o.mode !== 'hi' && c.globalAlpha < 1 && c.getTransform) {
    const b = boundsOf(o), transform = c.getTransform();
    const scale = Math.min(Math.hypot(transform.a, transform.b), 2048 / b.w, 2048 / b.h, Math.sqrt(2097152 / (b.w * b.h)));
    const key = JSON.stringify([scale, o.width, o.color, pts]);
    let cached = translucentStrokeLayers.get(o);
    if (!cached || cached.key !== key) {
      const layer = document.createElement('canvas');
      layer.width = Math.max(1, Math.ceil(b.w * scale));
      layer.height = Math.max(1, Math.ceil(b.h * scale));
      const lc = layer.getContext('2d');
      lc.scale(scale, scale); lc.translate(-b.x, -b.y);
      drawStroke(lc, o);
      cached = { key, layer };
      translucentStrokeLayers.set(o, cached);
    }
    c.drawImage(cached.layer, b.x, b.y, cached.layer.width / scale, cached.layer.height / scale);
    return;
  }
  c.lineJoin = 'round';
  c.lineCap = 'round';

  if (o.mode === 'hi') {
    c.save();
    c.globalAlpha *= 0.42;
    c.globalCompositeOperation = 'multiply';
    c.strokeStyle = o.color;
    c.fillStyle = o.color;
    c.lineWidth = o.width;
    if (pts.length < 2) {
      c.beginPath();
      c.arc(pts[0].x, pts[0].y, o.width / 2, 0, Math.PI * 2);
      c.fill();
    } else {
      c.beginPath();
      c.moveTo(pts[0].x, pts[0].y);
      for (const seg of strokeSegments(o)) {
        if (seg.cx === undefined) c.lineTo(seg.x1, seg.y1);
        else c.quadraticCurveTo(seg.cx, seg.cy, seg.x1, seg.y1);
      }
      c.stroke();
    }
    c.restore();
    return;
  }

  c.strokeStyle = o.color;
  c.fillStyle = o.color;
  if (pts.length < 2) {
    c.beginPath();
    c.arc(pts[0].x, pts[0].y, Math.max(0.6, (o.width * pts[0].w) / 2), 0, Math.PI * 2);
    c.fill();
    return;
  }
  for (const seg of strokeSegments(o)) {
    c.lineWidth = seg.width;
    c.beginPath();
    c.moveTo(seg.x0, seg.y0);
    c.quadraticCurveTo(seg.cx, seg.cy, seg.x1, seg.y1);
    c.stroke();
  }
}

function drawShape(c, o) {
  c.save();
  c.strokeStyle = o.color;
  c.lineWidth = Math.max(1, o.width);
  c.lineJoin = 'round';
  c.lineCap = 'round';
  if (o.type === 'line') {
    c.beginPath();
    c.moveTo(o.x0, o.y0);
    c.lineTo(o.x1, o.y1);
    c.stroke();
  } else if (o.type === 'rect') {
    const x = Math.min(o.x0, o.x1), y = Math.min(o.y0, o.y1);
    const w = Math.abs(o.x1 - o.x0), h = Math.abs(o.y1 - o.y0);
    if (o.angle) {
      c.save();
      c.translate(x + w / 2, y + h / 2);
      c.rotate(o.angle);
      if (o.fill) {
        const strokeAlpha = c.globalAlpha;
        c.globalAlpha *= 0.15;
        c.fillStyle = o.color;
        c.fillRect(-w / 2, -h / 2, w, h);
        c.globalAlpha = strokeAlpha;
      }
      c.strokeRect(-w / 2, -h / 2, w, h);
      c.restore();
    } else {
      if (o.fill) {
        const strokeAlpha = c.globalAlpha;
        c.globalAlpha *= 0.15;
        c.fillStyle = o.color;
        c.fillRect(x, y, w, h);
        c.globalAlpha = strokeAlpha;
      }
      c.strokeRect(x, y, w, h);
    }
  } else if (o.type === 'ellipse') {
    const rx = Math.abs(o.x1 - o.x0) / 2, ry = Math.abs(o.y1 - o.y0) / 2;
    if (rx > 0 && ry > 0) {
      c.beginPath();
      c.ellipse((o.x0 + o.x1) / 2, (o.y0 + o.y1) / 2, rx, ry, o.angle || 0, 0, Math.PI * 2);
      if (o.fill) {
        const strokeAlpha = c.globalAlpha;
        c.globalAlpha *= 0.15;
        c.fillStyle = o.color;
        c.fill();
        c.globalAlpha = strokeAlpha;
      }
      c.stroke();
    }
  } else if (o.type === 'arrow') {
    c.beginPath();
    c.moveTo(o.x0, o.y0);
    c.lineTo(o.x1, o.y1);
    c.stroke();
    const head = arrowHead(o);
    c.fillStyle = o.color;
    c.beginPath();
    c.moveTo(head[0].x, head[0].y);
    c.lineTo(head[1].x, head[1].y);
    c.lineTo(head[2].x, head[2].y);
    c.closePath();
    c.fill();
  }
  c.restore();
}

function drawTextObj(c, o) {
  const lines = (o.lines && o.lines.length) ? o.lines : [''];
  const m = textMetrics(o);
  c.save();
  if (o.angle) {
    c.translate(o.x + m.w / 2, o.y + m.h / 2);
    c.rotate(o.angle);
    c.translate(-m.w / 2, -m.h / 2);
  } else {
    c.translate(o.x, o.y);
  }
  c.font = `700 ${o.fontSize}px Nunito, sans-serif`;
  c.fillStyle = o.color;
  c.textBaseline = 'top';
  let y = 0;
  for (const ln of lines) {
    c.fillText(ln, 0, y);
    y += o.fontSize * 1.3;
  }
  c.restore();
}

function drawImageObj(c, o) {
  const rec = IMG.get(o.imgId);
  if (!rec || rec.status === 'error' || (rec.el.tagName !== 'CANVAS' && (!rec.el.complete || rec.el.naturalWidth === 0))) return;
  c.save();
  if (o.angle) {
    c.translate(o.x + o.w / 2, o.y + o.h / 2);
    c.rotate(o.angle);
    c.translate(-o.w / 2, -o.h / 2);
  } else {
    c.translate(o.x, o.y);
  }
  c.shadowColor = 'rgba(60,45,15,.22)';
  c.shadowBlur = 10;
  c.shadowOffsetY = 4;
  c.drawImage(rec.el, 0, 0, o.w, o.h);
  c.restore();
}

function drawSticky(c, o, paperOnly) {
  c.save();
  if (o.angle) {
    c.translate(o.x + o.w / 2, o.y + o.h / 2);
    c.rotate(o.angle);
    c.translate(-o.w / 2, -o.h / 2);
  } else {
    c.translate(o.x, o.y);
  }
  c.save();
  c.shadowColor = 'rgba(90,70,20,.26)';
  c.shadowBlur = 14;
  c.shadowOffsetY = 6;
  c.fillStyle = o.color;
  rr(c, 0, 0, o.w, o.h, 9);
  c.fill();
  c.restore();
  c.save();
  c.beginPath();
  c.moveTo(o.w - 16, o.h);
  c.lineTo(o.w, o.h - 16);
  c.lineTo(o.w, o.h);
  c.closePath();
  c.fillStyle = 'rgba(0,0,0,.08)';
  c.fill();
  c.restore();
  if (!paperOnly) {
    c.save();
    rr(c, 0, 0, o.w, o.h, 9);
    c.clip();
    c.font = `600 ${o.fontSize}px Caveat, cursive`;
    c.fillStyle = STICKY_INK;
    c.textBaseline = 'top';
    let y = 14;
    for (const ln of stickyLines(c, o)) {
      if (y > o.h + o.fontSize) break;
      c.fillText(ln, 14, y);
      y += o.fontSize * 1.12;
    }
    c.restore();
  }
  c.restore();
}

function stickyLines(c, o) {
  const key = o.w + '|' + o.fontSize + '|' + (o.text || '');
  if (o._wrap && o._wrap.key === key) return o._wrap.lines;
  c.font = `600 ${o.fontSize}px Caveat, cursive`;
  const maxW = Math.max(1, o.w - 28), out = [];
  for (const para of (o.text || '').split('\n')) {
    if (para === '') { out.push(''); continue; }
    let cur = '';
    for (const wd of para.split(' ')) {
      if (c.measureText(wd).width > maxW) {
        if (cur) { out.push(cur); cur = ''; }
        const letters = typeof Intl.Segmenter === 'function'
          ? [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(wd)].map(part => part.segment)
          : Array.from(wd);
        for (const letter of letters) {
          if (cur && c.measureText(cur + letter).width > maxW) { out.push(cur); cur = ''; }
          cur += letter;
        }
        continue;
      }
      const t = cur ? cur + ' ' + wd : wd;
      if (c.measureText(t).width <= maxW || !cur) cur = t;
      else { out.push(cur); cur = wd; }
    }
    out.push(cur);
  }
  o._wrap = { key, lines: out };
  return out;
}

function drawLaser(c) {
  const now = performance.now(), LIFE = 750;
  while (laserPts.length && now - laserPts[0].t > LIFE) laserPts.shift();
  if (!laserPts.length) return;
  c.save();
  c.lineCap = 'round';
  for (let i = 1; i < laserPts.length; i++) {
    const a = 1 - (now - laserPts[i].t) / LIFE;
    c.strokeStyle = `rgba(255,45,32,${(0.85 * a).toFixed(3)})`;
    c.lineWidth = 1 + 7 * a;
    c.shadowColor = 'rgba(255,60,40,.9)';
    c.shadowBlur = 4 + 12 * a;
    c.beginPath();
    c.moveTo(laserPts[i - 1].x, laserPts[i - 1].y);
    c.lineTo(laserPts[i].x, laserPts[i].y);
    c.stroke();
  }
  const h = laserPts[laserPts.length - 1];
  const ha = 1 - (now - h.t) / LIFE;
  if (ha > 0) {
    c.shadowBlur = 16;
    c.beginPath();
    c.arc(h.x, h.y, 4 + 2 * ha, 0, Math.PI * 2);
    c.fillStyle = '#FF4530';
    c.fill();
    c.shadowBlur = 0;
    c.beginPath();
    c.arc(h.x, h.y, 2, 0, Math.PI * 2);
    c.fillStyle = '#FFE9E5';
    c.fill();
  }
  c.restore();
}

function rectsIntersect(b1, b2) {
  if (!b1 || !b2) return false;
  return !(b1.x + b1.w < b2.x || b2.x + b2.w < b1.x || b1.y + b1.h < b2.y || b2.y + b2.h < b1.y);
}

let hoveredHandle = null;

function selHandleScreen(b, v) {
  if (!b) return [];
  const P = 7;
  const x = b.x * v.zoom + v.panX - P, y = b.y * v.zoom + v.panY - P;
  const w = b.w * v.zoom + 2 * P, h = b.h * v.zoom + 2 * P;
  return [
    { h: 'nw', sx: x,          sy: y,          bx: b.x,          by: b.y },
    { h: 'ne', sx: x + w,      sy: y,          bx: b.x + b.w,    by: b.y },
    { h: 'se', sx: x + w,      sy: y + h,      bx: b.x + b.w,    by: b.y + b.h },
    { h: 'sw', sx: x,          sy: y + h,      bx: b.x,          by: b.y + b.h },
    { h: 'rot', sx: x + w / 2, sy: y - 26,     bx: b.x + b.w / 2, by: b.y, topX: x + w / 2, topY: y },
  ];
}

function getSelectionHandleAt(clientX, clientY, v) {
  const selected = getSelectedObjects();
  if (!selected.length || state.tool !== 'select' || editing) return null;
  const b = contentBounds(selected);
  if (!b) return null;
  const hs = selHandleScreen(b, v);
  const rotHd = hs.find(h => h.h === 'rot');
  if (rotHd && Math.hypot(clientX - rotHd.sx, clientY - rotHd.sy) <= 12) {
    return { type: 'rotate', handle: 'rot', hd: rotHd, b, selected };
  }
  for (const hd of hs) {
    if (hd.h === 'rot') continue;
    const d = Math.hypot(clientX - hd.sx, clientY - hd.sy);
    if (d <= 10) return { type: 'resize', handle: hd.h, hd, b, selected };
  }
  return null;
}

function drawSelectionOverlay(v) {
  const selected = getSelectedObjects();
  const bar = $('selActions');
  if (!selected.length || state.tool !== 'select' || editing) { bar.style.display = 'none'; return; }
  const b = contentBounds(selected);
  if (!b) { bar.style.display = 'none'; return; }
  const hs = selHandleScreen(b, v);
  if (!hs.length) { bar.style.display = 'none'; return; }
  const { sx: x, sy: y } = hs[0];
  const w = hs[1].sx - x, h = hs[3].sy - y;
  const rotHd = hs.find(h => h.h === 'rot');

  ctx.save();
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 1.5;

  // Dashed selection rectangle
  ctx.setLineDash([6, 4]);
  rr(ctx, x, y, w, h, 7);
  ctx.stroke();
  ctx.setLineDash([]);

  // Stem line connecting bounding box top to rotation blob
  if (rotHd) {
    ctx.beginPath();
    ctx.moveTo(rotHd.topX, rotHd.topY);
    ctx.lineTo(rotHd.sx, rotHd.sy);
    ctx.stroke();
  }

  // Corner resize handles
  for (const hd of hs) {
    if (hd.h === 'rot') continue;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.rect(hd.sx - 5, hd.sy - 5, 10, 10);
    ctx.fill();
    ctx.stroke();
  }

  // Dedicated rotation blob handle
  if (rotHd) {
    const isRotHover = (hoveredHandle && hoveredHandle.handle === 'rot') || (action && action.type === 'rotate');
    const r = isRotHover ? 9 : 7.5;
    ctx.save();
    ctx.beginPath();
    ctx.arc(rotHd.sx, rotHd.sy, r, 0, Math.PI * 2);
    ctx.fillStyle = isRotHover ? '#FFF3EC' : '#FFFFFF';
    ctx.fill();
    ctx.lineWidth = isRotHover ? 2.5 : 2;
    ctx.stroke();

    // Inner pivot dot
    ctx.beginPath();
    ctx.arc(rotHd.sx, rotHd.sy, isRotHover ? 3.5 : 2.5, 0, Math.PI * 2);
    ctx.fillStyle = ACCENT;
    ctx.fill();
    ctx.restore();
  }

  // Active rotation guides & HUD badge
  if (action && action.type === 'rotate') {
    const cx = action.center.x * v.zoom + v.panX;
    const cy = action.center.y * v.zoom + v.panY;

    // Center pivot point
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx.fillStyle = ACCENT;
    ctx.fill();
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1.8;
    ctx.stroke();

    // Connecting dashed ray from center to current pointer
    if (lastPtr) {
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(lastPtr.x, lastPtr.y);
      ctx.strokeStyle = 'rgba(228, 87, 46, 0.7)';
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.setLineDash([]);

      // Floating angle HUD pill badge
      const deg = Math.round(action.deg || 0);
      const sign = deg > 0 ? '+' : '';
      const badgeText = `${sign}${deg}°${action.snappedShift ? ' (15° snap)' : ''}`;
      ctx.font = '700 13px Nunito, sans-serif';
      const tw = ctx.measureText(badgeText).width;
      const bx = clamp(lastPtr.x + 18, 10, VW - tw - 30);
      const by = clamp(lastPtr.y - 14, 28, VH - 20);

      ctx.fillStyle = 'rgba(30, 36, 44, 0.92)';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
      ctx.shadowBlur = 8;
      rr(ctx, bx - 7, by - 16, tw + 14, 24, 6);
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.fillStyle = action.snappedShift ? '#FFD480' : '#FFFFFF';
      ctx.textBaseline = 'middle';
      ctx.fillText(badgeText, bx, by - 4);
    }
    ctx.restore();
  }

  ctx.restore();

  // Smart floating toolbar placement
  bar.style.display = 'flex';
  bar.style.left = clamp(x - 2, 10, VW - 140) + 'px';
  const idealTop = (rotHd ? rotHd.sy : y) - 44;
  if (idealTop >= 64) {
    bar.style.top = clamp(idealTop, 64, VH - 150) + 'px';
  } else {
    bar.style.top = clamp(y + h + 16, 64, VH - 150) + 'px';
  }
}

function render() {
  const p = page(), v = p.view;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  let objs = p.objects;
  if (action) {
    if (action.type === 'draw') objs = objs.concat([action.temp]);
    if (action.type === 'shape') { const t = tempShapeObj(); if (t) objs = objs.concat([t]); }
  }
  paintBoard(ctx, VW, VH, v, p.bg, objs, editing ? editing.obj.id : null);

  // Marquee selection box preview
  if (action && action.type === 'marquee') {
    ctx.save();
    ctx.translate(v.panX, v.panY);
    ctx.scale(v.zoom, v.zoom);
    const mx = Math.min(action.x0, action.x1);
    const my = Math.min(action.y0, action.y1);
    const mw = Math.abs(action.x1 - action.x0);
    const mh = Math.abs(action.y1 - action.y0);
    ctx.fillStyle = 'rgba(228, 87, 46, 0.08)';
    ctx.fillRect(mx, my, mw, mh);
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1 / v.zoom;
    ctx.setLineDash([5 / v.zoom, 4 / v.zoom]);
    ctx.strokeRect(mx, my, mw, mh);
    ctx.restore();
  }

  if (action && action.type === 'sticky' && action.moved) {
    ctx.save();
    ctx.translate(v.panX, v.panY);
    ctx.scale(v.zoom, v.zoom);
    ctx.setLineDash([7, 5]);
    ctx.strokeStyle = 'rgba(35,40,47,.5)';
    ctx.lineWidth = 1.5 / v.zoom;
    rr(ctx, Math.min(action.x0, action.x1), Math.min(action.y0, action.y1),
       Math.abs(action.x1 - action.x0), Math.abs(action.y1 - action.y0), 9);
    ctx.stroke();
    ctx.restore();
  }

  drawLaser(ctx);
  drawSelectionOverlay(v);
  positionEditor();
  if (canvasPointerType) updateCursorOverlays({ clientX: lastPtr.x, clientY: lastPtr.y, pointerType: canvasPointerType });
}

function tick() {
  if (needsRender || laserPts.length || action) {
    render();
    needsRender = false;
  }
  requestAnimationFrame(tick);
}

/* ================================================================
   5. GEOMETRY — bounds, hit-testing, distances
   ================================================================ */
function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const L2 = dx * dx + dy * dy;
  let t = L2 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0;
  t = clamp(t, 0, 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function* strokeSegments(o) {
  const pts = o.points;
  if (!pts || pts.length < 2) return;
  let x0 = pts[0].x, y0 = pts[0].y;
  for (let i = 1; i < pts.length; i++) {
    const last = i === pts.length - 1;
    const x1 = last ? pts[i].x : (pts[i].x + pts[i + 1].x) / 2;
    const y1 = last ? pts[i].y : (pts[i].y + pts[i + 1].y) / 2;
    const seg = { x0, y0, x1, y1, width: o.mode === 'hi' ? o.width : Math.max(0.5, o.width * (pts[i - 1].w + pts[i].w) / 2) };
    if (!(o.mode === 'hi' && last)) { seg.cx = pts[i].x; seg.cy = pts[i].y; }
    yield seg;
    x0 = x1; y0 = y1;
  }
}

function arrowHead(o) {
  const ang = Math.atan2(o.y1 - o.y0, o.x1 - o.x0);
  const len = Math.hypot(o.x1 - o.x0, o.y1 - o.y0);
  const hl = Math.min(len * 0.4, 12 + o.width * 3.5), hw = hl * 0.48;
  const bx = o.x1 - Math.cos(ang) * hl, by = o.y1 - Math.sin(ang) * hl;
  return [
    { x: o.x1, y: o.y1 },
    { x: bx - Math.sin(ang) * hw, y: by + Math.cos(ang) * hw },
    { x: bx + Math.sin(ang) * hw, y: by - Math.cos(ang) * hw }
  ];
}

function quadraticHit(p, seg, radius, depth = 0) {
  const { x0, y0, x1, y1, cx, cy } = seg;
  if (cx === undefined) return distSeg(p.x, p.y, x0, y0, x1, y1) <= radius;
  if (p.x < Math.min(x0, x1, cx) - radius || p.x > Math.max(x0, x1, cx) + radius ||
      p.y < Math.min(y0, y1, cy) - radius || p.y > Math.max(y0, y1, cy) + radius) return false;
  const flatness = distSeg(cx, cy, x0, y0, x1, y1);
  if (flatness <= 0.25 || depth >= 18) return distSeg(p.x, p.y, x0, y0, x1, y1) <= radius + Math.min(flatness, 0.25);
  const ax = (x0 + cx) / 2, ay = (y0 + cy) / 2;
  const bx = (cx + x1) / 2, by = (cy + y1) / 2;
  const mx = (ax + bx) / 2, my = (ay + by) / 2;
  return quadraticHit(p, { x0, y0, cx: ax, cy: ay, x1: mx, y1: my }, radius, depth + 1) ||
    quadraticHit(p, { x0: mx, y0: my, cx: bx, cy: by, x1, y1 }, radius, depth + 1);
}

function triangleHit(p, vertices, tol) {
  const cross = (a, b) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  const signs = vertices.map((a, i) => cross(a, vertices[(i + 1) % 3]));
  const [a, b, c] = vertices;
  const area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  if (Math.abs(area) > 1e-9 && !(signs.some(v => v < 0) && signs.some(v => v > 0))) return true;
  return vertices.some((a, i) => {
    const b = vertices[(i + 1) % 3];
    return distSeg(p.x, p.y, a.x, a.y, b.x, b.y) <= tol;
  });
}

function boundsOf(o) {
  if (!o) return null;
  switch (o.type) {
    case 'stroke': {
      if (!o.points || !o.points.length) return null;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of o.points) {
        x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
        x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
      }
      let maxWidth = o.width;
      if (o.mode !== 'hi') for (const p of o.points) maxWidth = Math.max(maxWidth, o.width * p.w);
      const pad = Math.max(0.6, maxWidth / 2) + 2;
      return { x: x0 - pad, y: y0 - pad, w: Math.max(4, (x1 - x0) + pad * 2), h: Math.max(4, (y1 - y0) + pad * 2) };
    }
    case 'line': case 'arrow': {
      const pad = Math.max(1, o.width) / 2 + 4;
      const vertices = [{ x: o.x0, y: o.y0 }, { x: o.x1, y: o.y1 }];
      if (o.type === 'arrow') vertices.push(...arrowHead(o));
      const x0 = Math.min(...vertices.map(p => p.x)), y0 = Math.min(...vertices.map(p => p.y));
      const x1 = Math.max(...vertices.map(p => p.x)), y1 = Math.max(...vertices.map(p => p.y));
      return { x: x0 - pad, y: y0 - pad, w: Math.max(6, x1 - x0 + pad * 2), h: Math.max(6, y1 - y0 + pad * 2) };
    }
    case 'rect': case 'ellipse': {
      const pad = o.width / 2 + 3;
      const cx = (o.x0 + o.x1) / 2, cy = (o.y0 + o.y1) / 2;
      const w0 = Math.abs(o.x1 - o.x0), h0 = Math.abs(o.y1 - o.y0);
      if (o.angle) {
        const hw = w0 / 2, hh = h0 / 2;
        const cos = Math.abs(Math.cos(o.angle)), sin = Math.abs(Math.sin(o.angle));
        const bbW = (hw * cos + hh * sin) * 2 + pad * 2;
        const bbH = (hw * sin + hh * cos) * 2 + pad * 2;
        return { x: cx - bbW / 2, y: cy - bbH / 2, w: Math.max(6, bbW), h: Math.max(6, bbH) };
      }
      const x = Math.min(o.x0, o.x1) - pad, y = Math.min(o.y0, o.y1) - pad;
      return { x, y, w: Math.max(6, w0 + pad * 2), h: Math.max(6, h0 + pad * 2) };
    }
    case 'text': {
      const m = textMetrics(o);
      if (o.angle) {
        const cx = o.x + m.w / 2, cy = o.y + m.h / 2;
        const hw = m.w / 2, hh = m.h / 2;
        const cos = Math.abs(Math.cos(o.angle)), sin = Math.abs(Math.sin(o.angle));
        const bbW = (hw * cos + hh * sin) * 2;
        const bbH = (hw * sin + hh * cos) * 2;
        return { x: cx - bbW / 2, y: cy - bbH / 2, w: bbW, h: bbH };
      }
      return { x: o.x, y: o.y, w: m.w, h: m.h };
    }
    case 'image': case 'sticky': {
      if (o.angle) {
        const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
        const hw = o.w / 2, hh = o.h / 2;
        const cos = Math.abs(Math.cos(o.angle)), sin = Math.abs(Math.sin(o.angle));
        const bbW = (hw * cos + hh * sin) * 2;
        const bbH = (hw * sin + hh * cos) * 2;
        return { x: cx - bbW / 2, y: cy - bbH / 2, w: Math.max(12, bbW), h: Math.max(12, bbH) };
      }
      return { x: o.x, y: o.y, w: o.w, h: o.h };
    }
  }
  return null;
}

function textMetrics(o) {
  ctx.save();
  ctx.font = `700 ${o.fontSize}px Nunito, sans-serif`;
  const lines = (o.lines && o.lines.length) ? o.lines : [''];
  let w = 0;
  for (const ln of lines) w = Math.max(w, ctx.measureText(ln).width);
  ctx.restore();
  return { w: Math.max(w, o.fontSize * 0.6), h: lines.length * o.fontSize * 1.3 };
}

function contentBounds(objs) {
  let r = null;
  for (const o of objs) {
    const b = boundsOf(o);
    if (!b) continue;
    r = r ? {
      x: Math.min(r.x, b.x),
      y: Math.min(r.y, b.y),
      w: Math.max(r.x + r.w, b.x + b.w) - Math.min(r.x, b.x),
      h: Math.max(r.y + r.h, b.y + b.h) - Math.min(r.y, b.y)
    } : b;
  }
  return r;
}

function objectHit(o, p, tol) {
  const t = tol || 0;
  if (o.type === 'stroke') {
    if (!o.points || !o.points.length) return false;
    if (o.points.length === 1)
      return Math.hypot(p.x - o.points[0].x, p.y - o.points[0].y) <= t + 4 + (o.mode === 'hi' ? o.width / 2 : Math.max(0.6, o.width * o.points[0].w / 2));
    for (const seg of strokeSegments(o)) if (quadraticHit(p, seg, t + seg.width / 2 + 4)) return true;
    return false;
  }
  if (o.type === 'line' || o.type === 'arrow') {
    return distSeg(p.x, p.y, o.x0, o.y0, o.x1, o.y1) <= t + Math.max(1, o.width) / 2 + 5 ||
      (o.type === 'arrow' && triangleHit(p, arrowHead(o), t + 4));
  }

  let tp = p;
  let cx, cy, w, h;
  if (o.x0 !== undefined) {
    cx = (o.x0 + o.x1) / 2;
    cy = (o.y0 + o.y1) / 2;
    w = Math.abs(o.x1 - o.x0);
    h = Math.abs(o.y1 - o.y0);
  } else if (o.type === 'text') {
    const m = textMetrics(o);
    cx = o.x + m.w / 2;
    cy = o.y + m.h / 2;
    w = m.w;
    h = m.h;
  } else {
    cx = o.x + o.w / 2;
    cy = o.y + o.h / 2;
    w = o.w;
    h = o.h;
  }

  if (o.angle) {
    const cos = Math.cos(-o.angle), sin = Math.sin(-o.angle);
    const dx = p.x - cx, dy = p.y - cy;
    tp = {
      x: cx + dx * cos - dy * sin,
      y: cy + dx * sin + dy * cos
    };
  }

  const s = 4 + t + (o.type === 'rect' || o.type === 'ellipse' ? Math.max(1, o.width) / 2 : 0);
  if (o.type === 'ellipse') {
    const rx = w / 2 + s, ry = h / 2 + s;
    if (rx <= 0 || ry <= 0) return false;
    const nx = (tp.x - cx) / rx, ny = (tp.y - cy) / ry;
    return (nx * nx + ny * ny) <= 1;
  }
  return tp.x >= cx - w / 2 - s && tp.x <= cx + w / 2 + s && tp.y >= cy - h / 2 - s && tp.y <= cy + h / 2 + s;
}

function hitTest(p, tol) {
  const objs = page().objects;
  for (let i = objs.length - 1; i >= 0; i--) {
    if (objectHit(objs[i], p, tol)) return objs[i];
  }
  return null;
}

/* ================================================================
   6. POINTER INPUT & TOOLS
   ================================================================ */
canvas.addEventListener('contextmenu', e => e.preventDefault());

function pinchState() {
  const [a, b] = [...activePtrs.values()].filter(p => p.type === 'touch');
  return { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
}

function finishGesture({ cancel = false, preservePointers = false } = {}) {
  const a = action;
  action = null;
  if (!preservePointers) {
    for (const id of activePtrs.keys()) { try { canvas.releasePointerCapture(id); } catch (_) {} }
    activePtrs.clear();
  }
  if (!a) return;
  switch (a.type) {
    case 'draw':
      if (!cancel) { pushUndo(); page().objects.push(a.temp); scheduleThumb(); }
      break;
    case 'shape':
      if (!cancel) commitShape(a);
      break;
    case 'place':
      if (!cancel && !a.moved) createDraftText(a.x, a.y);
      break;
    case 'sticky':
      if (!cancel) createStickyFrom(a);
      break;
    case 'erase':
    case 'move':
    case 'resize':
    case 'rotate':
      if (a.snapped || a.duplicated) scheduleThumb();
      break;
    case 'pan':
    case 'pinch':
      scheduleSave();
      break;
  }
  refreshContextUI();
  canvas.style.cursor = spaceHeld ? 'grab' : (CURSORS[state.tool] || 'default');
  needsRender = true;
}

canvas.addEventListener('pointerdown', e => {
  if (![0, 1, 2].includes(e.button)) return;
  if (action && action.pointerId !== e.pointerId &&
      (e.pointerType !== 'touch' || (action.type !== 'pinch' && action.pointerType !== 'touch'))) return;
  if (activePtrs.size >= 2 && !activePtrs.has(e.pointerId)) return;
  hideHint();
  lastPtr = { x: e.clientX, y: e.clientY };
  activePtrs.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
  try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
  e.preventDefault();

  // Two fingers on touch = pinch zoom + pan
  if ([...activePtrs.values()].filter(p => p.type === 'touch').length === 2) {
    finishGesture({ cancel: true, preservePointers: true });
    commitEditor();
    action = { type: 'pinch', ...pinchState() };
    lastTapTime = 0;
    needsRender = true;
    return;
  }
  if (action) finishGesture({ cancel: true, preservePointers: true });

  // Double tap detection for mobile/touch
  const now = performance.now();
  if (state.tool === 'select' && e.pointerType === 'touch' && lastTapTime > 0 && now - lastTapTime < 300 &&
      lastTapPoint && Math.hypot(e.clientX - lastTapPoint.x, e.clientY - lastTapPoint.y) < 24) {
    const w = worldFromClient(e.clientX, e.clientY);
    const hit = hitTest(w, 4);
    if (hit && (hit.type === 'text' || hit.type === 'sticky')) {
      state.selectedIds = new Set([hit.id]);
      resetNudgeGroup();
      refreshContextUI();
      openEditor(hit, hit.type);
      lastTapTime = 0;
      return;
    }
  }
  if (e.pointerType === 'touch') {
    lastTapTime = now;
    lastTapPoint = { x: e.clientX, y: e.clientY };
  }

  // Right / middle mouse, or holding Space = pan
  if (e.button === 1 || e.button === 2 || spaceHeld) { startPan(e); return; }
  if (e.button !== 0) return;

  if (document.activeElement && document.activeElement !== document.body &&
      document.activeElement !== $('textEditor')) document.activeElement.blur();
  commitEditor();

  const w = worldFromClient(e.clientX, e.clientY);
  const t = state.tool;

  if (t === 'pen' || t === 'highlighter') {
    action = {
      type: 'draw',
      lastT: e.timeStamp,
      temp: {
        id: uid(),
        type: 'stroke',
        mode: t === 'pen' ? 'pen' : 'hi',
        color: state.color,
        opacity: state.opacity,
        width: t === 'pen' ? state.size : Math.max(12, state.size * 3.5),
        points: [{ x: w.x, y: w.y, w: 1 }]
      },
    };
  } else if (t === 'bucket') {
    fillAt(e.clientX, e.clientY);
  } else if (t === 'eraser') {
    action = { type: 'erase', snapped: false, last: w };
    eraseAt(w, action);
  } else if (['line', 'rect', 'ellipse', 'arrow'].includes(t)) {
    action = { type: 'shape', kind: t, x0: w.x, y0: w.y, x1: w.x, y1: w.y };
  } else if (t === 'text') {
    action = { type: 'place', x: w.x, y: w.y, sx: e.clientX, sy: e.clientY, moved: false };
  } else if (t === 'sticky') {
    action = { type: 'sticky', x0: w.x, y0: w.y, x1: w.x, y1: w.y, moved: false };
  } else if (t === 'laser') {
    action = { type: 'laser' };
    laserPts.push({ x: e.clientX, y: e.clientY, t: performance.now() });
  } else if (t === 'select') {
    handleSelectDown(e, w);
  } else if (t === 'hand') {
    startPan(e);
  }
  if (action) {
    action.pointerId = e.pointerId;
    action.pointerType = e.pointerType;
    action.startClientX = e.clientX;
    action.startClientY = e.clientY;
  }
  needsRender = true;
});

canvas.addEventListener('pointermove', e => {
  if (!action || action.pointerId === e.pointerId || (action.type === 'pinch' && activePtrs.has(e.pointerId)))
    lastPtr = { x: e.clientX, y: e.clientY };
  if (activePtrs.has(e.pointerId)) activePtrs.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
  updateCursorOverlays(e);

  if (action && action.type === 'pinch') {
    if (!activePtrs.has(e.pointerId)) return;
    if (activePtrs.size >= 2) {
      const st = pinchState();
      const v = page().view;
      v.panX += st.mx - action.mx;
      v.panY += st.my - action.my;
      if (action.d > 20) setZoom(v.zoom * st.d / action.d, st.mx, st.my);
      constrainView(v);
      action.mx = st.mx;
      action.my = st.my;
      action.d = st.d;
    }
    return;
  }
  if (action && action.pointerId !== e.pointerId) return;
  if (action && e.pointerType === 'touch' && Math.hypot(e.clientX - action.startClientX, e.clientY - action.startClientY) > 12) lastTapTime = 0;

  if (state.tool === 'laser' && action && action.type === 'laser') {
    const lp = laserPts[laserPts.length - 1];
    if (!lp || Math.hypot(e.clientX - lp.x, e.clientY - lp.y) > 1.5)
      laserPts.push({ x: e.clientX, y: e.clientY, t: performance.now() });
  }

  // Hover feedback with the select tool
  if (state.tool === 'select' && !action && !spaceHeld) {
    const handleInfo = getSelectionHandleAt(e.clientX, e.clientY, page().view);
    const prevHandle = hoveredHandle;
    hoveredHandle = handleInfo;
    if (prevHandle?.handle !== handleInfo?.handle || prevHandle?.type !== handleInfo?.type) {
      needsRender = true;
    }

    if (handleInfo) {
      if (handleInfo.type === 'resize') {
        canvas.style.cursor = (handleInfo.handle === 'nw' || handleInfo.handle === 'se') ? 'nwse-resize' : 'nesw-resize';
      } else {
        canvas.style.cursor = ROTATE_CURSOR;
      }
    } else {
      const w0 = worldFromClient(e.clientX, e.clientY);
      canvas.style.cursor = hitTest(w0, 0) ? 'move' : 'default';
    }
  }

  if (!action) return;
  const w = worldFromClient(e.clientX, e.clientY);

  switch (action.type) {
    case 'draw':   addDrawPoint(action, w, e); break;
    case 'erase':  eraseAt(w, action); break;
    case 'shape':  updateShapeDrag(action, w, e); break;
    case 'place':
      if (Math.hypot(e.clientX - action.sx, e.clientY - action.sy) > 6) action.moved = true;
      break;
    case 'sticky':
      action.x1 = w.x; action.y1 = w.y;
      if (Math.hypot(action.x1 - action.x0, action.y1 - action.y0) > 6) action.moved = true;
      needsRender = true;
      break;
    case 'marquee':
      action.x1 = w.x; action.y1 = w.y;
      updateMarqueeSelection(action);
      needsRender = true;
      break;
    case 'pan':
      page().view.panX += e.clientX - action.lx;
      page().view.panY += e.clientY - action.ly;
      constrainView(page().view);
      action.lx = e.clientX; action.ly = e.clientY;
      needsRender = true;
      break;
    case 'move':   doMove(w, action); break;
    case 'resize': doResize(w, action); break;
    case 'rotate': doRotate(w, e, action); break;
  }
});

canvas.addEventListener('pointerup', e => {
  const wasActive = activePtrs.has(e.pointerId);
  activePtrs.delete(e.pointerId);
  try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}

  if (action && action.type === 'pinch') {
    if (wasActive && activePtrs.size < 2) finishGesture({ preservePointers: true });
    return;
  }
  if (!action || action.pointerId !== e.pointerId) return;
  finishGesture({ preservePointers: true });
});

canvas.addEventListener('pointercancel', e => {
  const wasActive = activePtrs.has(e.pointerId);
  activePtrs.delete(e.pointerId);
  try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
  if (action && (action.pointerId === e.pointerId || (action.type === 'pinch' && wasActive)))
    finishGesture({ cancel: true, preservePointers: true });
});

function suspendInteractions() {
  spaceHeld = false;
  lastTapTime = 0;
  finishGesture({ cancel: true });
  canvas.style.cursor = CURSORS[state.tool] || 'default';
  hoveredHandle = null;
  $('eraserRing').style.display = 'none';
  $('laserDot').style.display = 'none';
  $('brushPreview').style.display = 'none';
  canvasPointerType = null;
  saveNow();
}
window.addEventListener('blur', suspendInteractions);

canvas.addEventListener('pointerleave', () => {
  $('eraserRing').style.display = 'none';
  $('laserDot').style.display = 'none';
  $('brushPreview').style.display = 'none';
  canvasPointerType = null;
});
canvas.addEventListener('pointerenter', e => updateCursorOverlays(e));

/* Double click: edit text / sticky, or create text box on empty board */
canvas.addEventListener('dblclick', e => {
  if (state.tool !== 'select') return;
  const w = worldFromClient(e.clientX, e.clientY);
  const hit = hitTest(w, 0);
  if (hit && (hit.type === 'text' || hit.type === 'sticky')) {
    state.selectedIds = new Set([hit.id]);
    resetNudgeGroup();
    refreshContextUI();
    openEditor(hit, hit.type);
  } else if (!hit) {
    createDraftText(w.x, w.y);
  }
});

/* ================================================================
   WHEEL ZOOM & PAN: Normal = Up/Down, Shift = Left/Right, Ctrl = Zoom
   ================================================================ */
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) {
    // Zoom in/out at cursor
    zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX, e.clientY);
  } else if (e.shiftKey) {
    // Shift + wheel = scroll left / right
    const v = page().view;
    const delta = e.deltaY !== 0 ? e.deltaY : e.deltaX;
    v.panX -= delta;
    needsRender = true;
  } else {
    // Normal wheel = scroll up / down (and horizontal if mouse has horiz wheel)
    const v = page().view;
    v.panX -= e.deltaX;
    v.panY -= e.deltaY;
    needsRender = true;
  }
  constrainView(page().view);
  scheduleSave();
}, { passive: false });

/* ---- freehand point capture with speed-based width taper ---- */
function addDrawPoint(a, w, e) {
  const pts = a.temp.points, last = pts[pts.length - 1];
  const d = Math.hypot(w.x - last.x, w.y - last.y);
  if (d < 1.2 / page().view.zoom) return;
  const dt = Math.max(4, e.timeStamp - a.lastT);
  a.lastT = e.timeStamp;
  const speed = d / dt;
  const target = clamp(1.12 - speed * 0.35, 0.35, 1.25);
  const f = clamp(last.w * 0.65 + target * 0.35, 0.3, 1.3);
  pts.push({ x: w.x, y: w.y, w: f });
  needsRender = true;
}

/* ---- shape drag with Shift constraint ---- */
function updateShapeDrag(a, w, e) {
  a.x1 = w.x; a.y1 = w.y;
  if (e.shiftKey) {
    if (a.kind === 'line' || a.kind === 'arrow') {
      const ang = Math.atan2(a.y1 - a.y0, a.x1 - a.x0);
      const len = Math.hypot(a.x1 - a.x0, a.y1 - a.y0);
      const snap = Math.round(ang / (Math.PI / 12)) * (Math.PI / 12);
      a.x1 = a.x0 + Math.cos(snap) * len;
      a.y1 = a.y0 + Math.sin(snap) * len;
    } else {
      const dx = a.x1 - a.x0, dy = a.y1 - a.y0;
      const m = Math.max(Math.abs(dx), Math.abs(dy));
      a.x1 = a.x0 + (dx >= 0 ? 1 : -1) * m;
      a.y1 = a.y0 + (dy >= 0 ? 1 : -1) * m;
    }
  }
  needsRender = true;
}

function tempShapeObj() {
  const a = action;
  if (!a || a.type !== 'shape') return null;
  return {
    id: '__temp',
    type: a.kind,
    x0: a.x0, y0: a.y0, x1: a.x1, y1: a.y1,
    color: state.color,
    opacity: state.opacity,
    width: Math.max(1, state.size),
    fill: state.fill
  };
}

function commitShape(a) {
  if (Math.hypot(a.x1 - a.x0, a.y1 - a.y0) < 4 / page().view.zoom) return;
  pushUndo();
  page().objects.push({
    id: uid(),
    type: a.kind,
    x0: a.x0, y0: a.y0, x1: a.x1, y1: a.y1,
    color: state.color,
    opacity: state.opacity,
    width: Math.max(1, state.size),
    fill: state.fill
  });
  scheduleThumb();
}

/* ---- object eraser ---- */
// Four-neighbour flood fill of the clicked colour, with a small antialias tolerance.
// A bounded queue and a visited bitmap keep work linear in the sampled area.
function floodRegion(data, width, height, x, y, tolerance = 24) {
  if (width < 1 || height < 1 || width * height > 2097152 || data.length !== width * height * 4) throw new Error('Invalid fill surface');
  x = clamp(Math.floor(x), 0, width - 1); y = clamp(Math.floor(y), 0, height - 1);
  const start = y * width + x, offset = start * 4;
  const target = Array.from(data.slice(offset, offset + 4));
  const mask = new Uint8Array(width * height), seen = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0, tail = 0, count = 0, minX = x, maxX = x, minY = y, maxY = y;
  const enqueue = pixel => { if (!seen[pixel]) { seen[pixel] = 1; queue[tail++] = pixel; } };
  enqueue(start);
  while (head < tail) {
    const pixel = queue[head++], i = pixel * 4;
    if (target.some((value, channel) => Math.abs(data[i + channel] - value) > tolerance)) continue;
    mask[pixel] = 1; count++;
    const px = pixel % width, py = Math.floor(pixel / width);
    minX = Math.min(minX, px); maxX = Math.max(maxX, px);
    minY = Math.min(minY, py); maxY = Math.max(maxY, py);
    if (px > 0) enqueue(pixel - 1);
    if (px + 1 < width) enqueue(pixel + 1);
    if (py > 0) enqueue(pixel - width);
    if (py + 1 < height) enqueue(pixel + width);
  }
  return { mask, count, minX, minY, maxX, maxY, target };
}

function fillAt(clientX, clientY) {
  if (page().objects.some(o => o.type === 'image' && IMG.get(o.imgId)?.status === 'loading')) {
    toast('Wait for images to load before filling'); return;
  }
  try {
    const v = page().view;
    const scale = Math.min(1, 2048 / VW, 2048 / VH, Math.sqrt(2097152 / (VW * VH)));
    const surface = document.createElement('canvas');
    surface.width = Math.max(1, Math.floor(VW * scale));
    surface.height = Math.max(1, Math.floor(VH * scale));
    const c = surface.getContext('2d', { willReadFrequently: true });
    c.scale(scale, scale);
    // Notebook grids are guides, not barriers for the paint bucket.
    paintBoard(c, VW, VH, v, 'blank', page().objects, null);
    const data = c.getImageData(0, 0, surface.width, surface.height);
    const region = floodRegion(data.data, surface.width, surface.height, clientX * scale, clientY * scale);
    let hex = state.color.slice(1);
    if (hex.length <= 4) hex = [...hex].map(ch => ch + ch).join('');
    const rgba = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
    rgba.push(hex.length === 8 ? parseInt(hex.slice(6, 8), 16) : 255);
    if (state.opacity === 1 && region.target.every((value, i) => Math.abs(value - rgba[i]) <= 1)) return;
    const layer = document.createElement('canvas');
    layer.width = region.maxX - region.minX + 1;
    layer.height = region.maxY - region.minY + 1;
    const lc = layer.getContext('2d'), pixels = lc.createImageData(layer.width, layer.height);
    for (let y = 0; y < layer.height; y++) {
      for (let x = 0; x < layer.width; x++) {
        if (!region.mask[(y + region.minY) * surface.width + x + region.minX]) continue;
        pixels.data.set(rgba, (y * layer.width + x) * 4);
      }
    }
    lc.putImageData(pixels, 0, 0);
    const imgId = uid();
    const obj = { id: uid(), type: 'image', imgId, opacity: state.opacity,
      x: (region.minX / scale - v.panX) / v.zoom, y: (region.minY / scale - v.panY) / v.zoom,
      w: layer.width / (scale * v.zoom), h: layer.height / (scale * v.zoom) };
    if (!hasValidGeometry(obj)) { toast('Move closer to the centre of the board to fill'); return; }
    const src = layer.toDataURL('image/png');
    pushUndo();
    IMG.set(imgId, { el: layer, src, w: layer.width, h: layer.height, status: 'ready' });
    page().objects.push(obj);
    state.selectedIds.clear();
    resetNudgeGroup();
    scheduleThumb();
    needsRender = true;
  } catch (_) { toast('Could not fill this area'); }
}

function eraseAt(w, a) {
  const r = Math.max(6, state.size * 2.5);
  const d = Math.hypot(w.x - a.last.x, w.y - a.last.y);
  const steps = Math.max(1, Math.ceil(d / (r * 0.5)));
  let removed = false;
  for (let i = 1; i <= steps; i++) {
    const p = {
      x: a.last.x + (w.x - a.last.x) * i / steps,
      y: a.last.y + (w.y - a.last.y) * i / steps
    };
    const hit = hitTest(p, r);
    if (hit) {
      if (!a.snapped) { pushUndo(); a.snapped = true; }
      removeObject(hit.id);
      if (state.selectedIds.has(hit.id)) state.selectedIds.delete(hit.id);
      removed = true;
    }
  }
  a.last = w;
  if (removed) needsRender = true;
}

function startPan(e) {
  try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
  action = { type: 'pan', pointerId: e.pointerId, pointerType: e.pointerType, lx: e.clientX, ly: e.clientY,
    startClientX: e.clientX, startClientY: e.clientY };
  canvas.style.cursor = 'grabbing';
}

/* ---- custom pointer previews ---- */
let canvasPointerType = null;
function updateCursorOverlays(e) {
  canvasPointerType = e.pointerType || canvasPointerType;
  const ring = $('eraserRing'), dot = $('laserDot');
  const brush = $('brushPreview');
  if (['pen', 'highlighter'].includes(state.tool) && !spaceHeld && canvasPointerType !== 'touch' && action?.type !== 'pan' && action?.type !== 'pinch') {
    const width = state.tool === 'highlighter' ? Math.max(12, state.size * 3.5) : state.size;
    const diameter = Math.max(1, width * page().view.zoom);
    brush.style.display = 'block';
    brush.style.width = brush.style.height = diameter + 'px';
    brush.style.color = state.color;
    brush.style.setProperty('--brush-opacity', state.opacity * (state.tool === 'highlighter' ? 0.42 : 1));
    brush.style.transform = `translate(${e.clientX - diameter / 2}px,${e.clientY - diameter / 2}px)`;
  } else brush.style.display = 'none';
  if (state.tool === 'eraser' && !spaceHeld) {
    const r = Math.max(6, state.size * 2.5) * page().view.zoom;
    ring.style.display = 'block';
    ring.style.width = ring.style.height = (r * 2) + 'px';
    ring.style.transform = `translate(${e.clientX - r}px,${e.clientY - r}px)`;
  } else {
    ring.style.display = 'none';
  }
  if (state.tool === 'laser') {
    dot.style.display = 'block';
    dot.style.transform = `translate(${e.clientX - 5}px,${e.clientY - 5}px)`;
  } else {
    dot.style.display = 'none';
  }
}

/* ================================================================
   7. SELECTION & MULTI-SELECTION (Marquee, Move, Resize, Duplicate)
   ================================================================ */
function syncToolbarToSelected(o) {
  // Selected-object values belong to the controls, not the drawing defaults.
  refreshContextUI();
}

function updateMarqueeSelection(a) {
  const mx = Math.min(a.x0, a.x1);
  const my = Math.min(a.y0, a.y1);
  const mw = Math.abs(a.x1 - a.x0);
  const mh = Math.abs(a.y1 - a.y0);
  const marqueeBox = { x: mx, y: my, w: mw, h: mh };

  const currentSelection = new Set(a.prevSelected);
  for (const o of page().objects) {
    const ob = boundsOf(o);
    if (ob && rectsIntersect(ob, marqueeBox)) {
      currentSelection.add(o.id);
    }
  }
  state.selectedIds = currentSelection;
  resetNudgeGroup();
  refreshContextUI();
}

function handleSelectDown(e, w) {
  resetNudgeGroup();
  const handleInfo = getSelectionHandleAt(e.clientX, e.clientY, page().view);
  if (handleInfo) {
    if (handleInfo.type === 'resize') {
      action = {
        type: 'resize',
        objects: handleInfo.selected,
        handle: handleInfo.handle,
        startW: w,
        startBounds: handleInfo.b,
        sos: handleInfo.selected.map(o => JSON.parse(JSON.stringify(o))),
        snapped: false
      };
      return;
    }
    if (handleInfo.type === 'rotate') {
      const cx = handleInfo.b.x + handleInfo.b.w / 2;
      const cy = handleInfo.b.y + handleInfo.b.h / 2;
      action = {
        type: 'rotate',
        objects: handleInfo.selected,
        center: { x: cx, y: cy },
        startAngle: Math.atan2(w.y - cy, w.x - cx),
        deltaAngle: 0,
        deg: 0,
        snappedShift: false,
        startW: w,
        sos: handleInfo.selected.map(o => JSON.parse(JSON.stringify(o))),
        snapped: false
      };
      return;
    }
  }

  const hit = hitTest(w, 0);
  if (hit) {
    if (e.shiftKey) {
      // Toggle selection with Shift
      if (state.selectedIds.has(hit.id)) state.selectedIds.delete(hit.id);
      else state.selectedIds.add(hit.id);
      syncToolbarToSelected(hit);
    } else if (!state.selectedIds.has(hit.id)) {
      // Single click on unselected item selects only this item
      state.selectedIds = new Set([hit.id]);
      syncToolbarToSelected(hit);
    }

    const currentSelected = getSelectedObjects();
    if (e.altKey) {
      // Alt-drag = quick duplicate all selected
      const offset = constrainTranslation(currentSelected, 16, 16);
      const clones = currentSelected.map(o => {
        const c = cloneObj(o);
        translateObj(c, offset.dx, offset.dy);
        return c;
      });
      pushUndo();
      clones.forEach(c => page().objects.push(c));
      state.selectedIds = new Set(clones.map(c => c.id));
      action = { type: 'move', objects: clones, lastW: w, startW: w, snapped: false, duplicated: true };
    } else {
      action = { type: 'move', objects: currentSelected, lastW: w, startW: w, snapped: false };
    }
  } else {
    // Clicked on empty canvas
    if (!e.shiftKey) {
      state.selectedIds.clear();
    }
    // Start marquee drag
    action = {
      type: 'marquee',
      x0: w.x, y0: w.y,
      x1: w.x, y1: w.y,
      sx: e.clientX, sy: e.clientY,
      prevSelected: new Set(state.selectedIds)
    };
  }
  refreshContextUI();
}

function translateObj(o, dx, dy) {
  if (o.type === 'stroke') { o.points.forEach(p => { p.x += dx; p.y += dy; }); return; }
  if (o.x0 !== undefined) { o.x0 += dx; o.x1 += dx; o.y0 += dy; o.y1 += dy; return; }
  o.x += dx; o.y += dy;
}

function* objectCoordinates(o) {
  if (o.type === 'stroke') { yield* o.points; return; }
  if (o.x0 !== undefined) { yield { x: o.x0, y: o.y0 }; yield { x: o.x1, y: o.y1 }; return; }
  yield { x: o.x, y: o.y };
}

function constrainTranslation(objects, dx, dy) {
  let minX = -Infinity, maxX = Infinity, minY = -Infinity, maxY = Infinity;
  for (const o of objects) for (const p of objectCoordinates(o)) {
    minX = Math.max(minX, -1e9 - p.x); maxX = Math.min(maxX, 1e9 - p.x);
    minY = Math.max(minY, -1e9 - p.y); maxY = Math.min(maxY, 1e9 - p.y);
  }
  return { dx: clamp(dx, minX, maxX), dy: clamp(dy, minY, maxY) };
}

function constrainResizeScale(s, a, ax, ay) {
  let minScale = 0.06, maxScale = 14;
  const limitValue = (value, min, max) => {
    minScale = Math.max(minScale, Math.min(min, value) / value);
    maxScale = Math.min(maxScale, max / value);
  };
  const limitCoordinate = (value, anchor) => {
    const delta = value - anchor;
    if (!delta) return;
    const lo = (-1e9 - anchor) / delta, hi = (1e9 - anchor) / delta;
    minScale = Math.max(minScale, Math.min(lo, hi));
    maxScale = Math.min(maxScale, Math.max(lo, hi));
  };
  for (const o of a.sos) {
    for (const p of objectCoordinates(o)) { limitCoordinate(p.x, ax); limitCoordinate(p.y, ay); }
    if (o.width !== undefined) limitValue(o.width, 0.5, 1e6);
    if (o.fontSize !== undefined) limitValue(o.fontSize, o.type === 'sticky' ? 10 : 8, 10000);
    if (o.w !== undefined) { limitValue(o.w, 12, 1e9); limitValue(o.h, 12, 1e9); }
  }
  if (s > maxScale) return Math.max(minScale, maxScale * (1 - Number.EPSILON * 4));
  return clamp(s, minScale, maxScale);
}

function hasValidGeometry(o) {
  for (const p of objectCoordinates(o)) if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.abs(p.x) > 1e9 || Math.abs(p.y) > 1e9) return false;
  for (const [key, max] of [['width', 1e6], ['fontSize', 10000], ['w', 1e9], ['h', 1e9]])
    if (o[key] !== undefined && (!Number.isFinite(o[key]) || o[key] < 0.01 || o[key] > max)) return false;
  return o.angle === undefined || Number.isFinite(o.angle);
}

function doMove(w, a) {
  if (!a.snapped && Math.hypot(w.x - a.startW.x, w.y - a.startW.y) < 3 / page().view.zoom) return;
  const { dx, dy } = constrainTranslation(a.objects, w.x - a.lastW.x, w.y - a.lastW.y);
  a.lastW = w;
  if (!dx && !dy) return;
  if (!a.snapped) { if (!a.duplicated) pushUndo(); a.snapped = true; }
  for (const o of a.objects) {
    translateObj(o, dx, dy);
  }
  needsRender = true;
}

function doResize(w, a) {
  if (!a.snapped && Math.hypot(w.x - a.startW.x, w.y - a.startW.y) < 4 / page().view.zoom) return;
  const sb = a.startBounds;
  const ax = a.handle.includes('w') ? sb.x + sb.w : sb.x;
  const ay = a.handle.includes('n') ? sb.y + sb.h : sb.y;
  let s = Math.max(
    1 + (a.handle.includes('w') ? a.startW.x - w.x : w.x - a.startW.x) / Math.max(sb.w, 1),
    1 + (a.handle.includes('n') ? a.startW.y - w.y : w.y - a.startW.y) / Math.max(sb.h, 1)
  );
  s = constrainResizeScale(s, a, ax, ay);
  if (!a.snapped && Math.abs(s - 1) < 1e-12) return;
  const resized = a.sos.map(o => ({ ...o }));
  resized.forEach((o, idx) => {
    const so = a.sos[idx];
    if (o.type === 'stroke') {
      o.points = so.points.map(p => ({ x: ax + (p.x - ax) * s, y: ay + (p.y - ay) * s, w: p.w }));
      o.width = so.width * s;
    } else if (o.x0 !== undefined) {
      o.x0 = ax + (so.x0 - ax) * s; o.y0 = ay + (so.y0 - ay) * s;
      o.x1 = ax + (so.x1 - ax) * s; o.y1 = ay + (so.y1 - ay) * s;
      o.width = so.width * s;
    } else if (o.type === 'text') {
      o.fontSize = so.fontSize * s;
      o.x = ax + (so.x - ax) * s; o.y = ay + (so.y - ay) * s;
    } else {
      o.w = so.w * s; o.h = so.h * s;
      if (o.type === 'sticky') o.fontSize = so.fontSize * s;
      o.x = ax + (so.x - ax) * s; o.y = ay + (so.y - ay) * s;
    }
  });
  if (!resized.every(hasValidGeometry)) return;
  if (!a.snapped) { pushUndo(); a.snapped = true; }
  resized.forEach((o, idx) => Object.assign(a.objects[idx], o));
  needsRender = true;
}

function doRotate(w, e, a) {
  const cx = a.center.x, cy = a.center.y;
  const currentAngle = Math.atan2(w.y - cy, w.x - cx);
  let dAngle = currentAngle - a.startAngle;

  if (e && e.shiftKey) {
    // Snap to 15 degrees (Math.PI / 12)
    const step = Math.PI / 12;
    dAngle = Math.round(dAngle / step) * step;
  }

  if (!a.snapped && Math.abs(dAngle) < 0.02) return;

  const cos = Math.cos(dAngle), sin = Math.sin(dAngle);
  const rotated = a.sos.map(o => ({ ...o }));
  rotated.forEach((o, idx) => {
    const so = a.sos[idx];
    if (o.type === 'stroke') {
      o.points = so.points.map(p => {
        const dx = p.x - cx, dy = p.y - cy;
        return {
          x: cx + dx * cos - dy * sin,
          y: cy + dx * sin + dy * cos,
          w: p.w
        };
      });
    } else if (o.type === 'line' || o.type === 'arrow') {
      const dx0 = so.x0 - cx, dy0 = so.y0 - cy;
      const dx1 = so.x1 - cx, dy1 = so.y1 - cy;
      o.x0 = cx + dx0 * cos - dy0 * sin;
      o.y0 = cy + dx0 * sin + dy0 * cos;
      o.x1 = cx + dx1 * cos - dy1 * sin;
      o.y1 = cy + dx1 * sin + dy1 * cos;
    } else if (o.type === 'rect' || o.type === 'ellipse') {
      const scx = (so.x0 + so.x1) / 2, scy = (so.y0 + so.y1) / 2;
      const sw = Math.abs(so.x1 - so.x0), sh = Math.abs(so.y1 - so.y0);
      const dx = scx - cx, dy = scy - cy;
      const ncx = cx + dx * cos - dy * sin;
      const ncy = cy + dx * sin + dy * cos;
      o.x0 = ncx - sw / 2;
      o.x1 = ncx + sw / 2;
      o.y0 = ncy - sh / 2;
      o.y1 = ncy + sh / 2;
      o.angle = ((so.angle || 0) + dAngle) % (Math.PI * 2);
    } else if (o.type === 'text') {
      const m = textMetrics(so);
      const scx = so.x + m.w / 2, scy = so.y + m.h / 2;
      const dx = scx - cx, dy = scy - cy;
      const ncx = cx + dx * cos - dy * sin;
      const ncy = cy + dx * sin + dy * cos;
      o.x = ncx - m.w / 2;
      o.y = ncy - m.h / 2;
      o.angle = ((so.angle || 0) + dAngle) % (Math.PI * 2);
    } else { // image, sticky
      const scx = so.x + so.w / 2, scy = so.y + so.h / 2;
      const dx = scx - cx, dy = scy - cy;
      const ncx = cx + dx * cos - dy * sin;
      const ncy = cy + dx * sin + dy * cos;
      o.x = ncx - so.w / 2;
      o.y = ncy - so.h / 2;
      o.angle = ((so.angle || 0) + dAngle) % (Math.PI * 2);
    }
  });
  if (!rotated.every(hasValidGeometry)) return;
  if (!a.snapped) { pushUndo(); a.snapped = true; }
  rotated.forEach((o, idx) => Object.assign(a.objects[idx], o));
  a.snappedShift = !!e?.shiftKey;
  a.deltaAngle = dAngle;
  a.deg = Math.round((dAngle * 180 / Math.PI) % 360);
  needsRender = true;
}

function deleteSelection() {
  finishGesture({ cancel: true });
  if (!state.selectedIds.size) return;
  commitEditor();
  pushUndo();
  for (const id of state.selectedIds) {
    removeObject(id);
  }
  state.selectedIds.clear();
  resetNudgeGroup();
  refreshContextUI();
  scheduleThumb();
  needsRender = true;
}

function duplicateSelection() {
  finishGesture({ cancel: true });
  const selected = getSelectedObjects();
  if (!selected.length) return;
  commitEditor();
  const offset = constrainTranslation(selected, 24, 24);
  const clones = selected.map(o => {
    const c = cloneObj(o);
    translateObj(c, offset.dx, offset.dy);
    return c;
  });
  pushUndo();
  clones.forEach(c => page().objects.push(c));
  state.selectedIds = new Set(clones.map(c => c.id));
  resetNudgeGroup();
  refreshContextUI();
  scheduleThumb();
  needsRender = true;
}

function bringSelToFront() {
  finishGesture({ cancel: true });
  const selected = getSelectedObjects();
  if (!selected.length) return;
  const arr = page().objects;
  pushUndo();
  for (const o of selected) {
    const idx = arr.indexOf(o);
    if (idx >= 0) arr.splice(idx, 1);
    arr.push(o);
  }
  scheduleThumb();
  needsRender = true;
}

function sendSelToBack() {
  finishGesture({ cancel: true });
  const selected = getSelectedObjects();
  if (!selected.length) return;
  const arr = page().objects;
  pushUndo();
  for (let i = selected.length - 1; i >= 0; i--) {
    const o = selected[i];
    const idx = arr.indexOf(o);
    if (idx >= 0) arr.splice(idx, 1);
    arr.unshift(o);
  }
  scheduleThumb();
  needsRender = true;
}

let nudgeGroup = null;
function resetNudgeGroup() {
  nudgeGroup = null;
}

function nudge(dx, dy) {
  const selected = getSelectedObjects();
  if (!selected.length) return;
  ({ dx, dy } = constrainTranslation(selected, dx, dy));
  if (!dx && !dy) return;
  const p = page();
  const now = performance.now();
  const ids = JSON.stringify(selected.map(o => o.id).sort());
  const latestUndo = p.undo[p.undo.length - 1];
  if (!nudgeGroup || nudgeGroup.pageId !== p.id || nudgeGroup.ids !== ids ||
      now - nudgeGroup.time > 700 || nudgeGroup.entry !== latestUndo) {
    pushUndo(p);
  }
  nudgeGroup = { pageId: p.id, ids, time: now, entry: p.undo[p.undo.length - 1] };
  for (const o of selected) {
    translateObj(o, dx, dy);
  }
  scheduleThumb();
  needsRender = true;
}

/* ================================================================
   8. TEXT & STICKY EDITING
   ================================================================ */
function createDraftText(x, y) {
  const o = { id: uid(), type: 'text', x, y, color: state.color, opacity: state.opacity, fontSize: state.fontSize, lines: [''] };
  openEditor(o, 'text', true);
}

function openEditor(o, kind, isNew = false) {
  commitEditor();
  editing = {
    obj: o,
    pageId: page().id,
    kind,
    isNew,
    original: kind === 'text' ? (o.lines || []).join('\n') : (o.text || '')
  };
  const ta = $('textEditor');
  ta.value = isNew && kind === 'text' ? '' : editing.original;
  editing.lastValue = ta.value;
  ta.wrap = kind === 'sticky' ? 'soft' : 'off';
  ta.classList.toggle('sticky-mode', kind === 'sticky');
  if (kind === 'sticky') {
    ta.style.background = 'transparent';
    ta.style.color = STICKY_INK;
  } else {
    ta.style.background = 'transparent';
    ta.style.color = o.color;
  }
  ta.style.display = 'block';
  ta.style.opacity = o.opacity ?? 1;
  positionEditor();
  ta.focus();
  try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch (_) {}
  needsRender = true;
}

function positionEditor() {
  if (!editing) return;
  const { obj, kind } = editing;
  const v = page().view;
  const ta = $('textEditor');
  const fs = obj.fontSize * v.zoom;
  ta.style.fontSize = fs + 'px';
  ta.style.transform = obj.angle ? `rotate(${obj.angle}rad)` : 'none';
  ta.style.transformOrigin = (kind === 'sticky') ? 'center center' : 'top left';
  if (kind === 'sticky') {
    ta.style.left   = (obj.x * v.zoom + v.panX) + 'px';
    ta.style.top    = (obj.y * v.zoom + v.panY) + 'px';
    ta.style.width  = (obj.w * v.zoom) + 'px';
    ta.style.height = (obj.h * v.zoom) + 'px';
    ta.style.padding = (14 * v.zoom) + 'px';
    ta.style.lineHeight = '1.12';
  } else {
    ctx.save();
    ctx.font = `700 ${fs}px Nunito, sans-serif`;
    let mw = 0;
    for (const ln of ta.value.split('\n')) mw = Math.max(mw, ctx.measureText(ln).width);
    ctx.restore();
    ta.style.left = (obj.x * v.zoom + v.panX - 4) + 'px';
    ta.style.top  = (obj.y * v.zoom + v.panY - 2) + 'px';
    ta.style.width  = Math.max(60, mw + 16) + 'px';
    ta.style.height = (ta.value.split('\n').length * fs * 1.3 + 6) + 'px';
    ta.style.padding = '0 4px';
    ta.style.lineHeight = '1.3';
    const m = textMetrics({ ...obj, lines: ta.value.split('\n') });
    ta.style.transformOrigin = `${m.w * v.zoom / 2 + 4}px ${m.h * v.zoom / 2 + 2}px`;
  }
}

function commitEditor() {
  if (!editing) return;
  const { obj, kind, isNew, original, pageId } = editing;
  const target = pages.find(p => p.id === pageId);
  const val = $('textEditor').value;
  editing = null;
  $('textEditor').style.display = 'none';
  $('textEditor').style.transform = 'none';
  if (!target) { needsRender = true; return; }

  if (kind === 'text') {
    if (!val.trim()) {
      if (!isNew) { pushUndo(target); target.objects = target.objects.filter(o => o.id !== obj.id); state.selectedIds.delete(obj.id); }
    } else {
      const lines = val.split('\n');
      if (isNew) { pushUndo(target); obj.lines = lines; target.objects.push(obj); }
      else if (val !== original) { pushUndo(target); obj.lines = lines; }
      if (target === page()) state.selectedIds = new Set([obj.id]);
    }
  } else {
    obj._wrap = null;
    if (val !== original) { pushUndo(target); obj.text = val; }
  }
  target.thumbDirty = true;
  scheduleSave();
  resetNudgeGroup();
  refreshContextUI();
  needsRender = true;
}

function createStickyFrom(a) {
  let x = Math.min(a.x0, a.x1), y = Math.min(a.y0, a.y1);
  let w = Math.abs(a.x1 - a.x0), h = Math.abs(a.y1 - a.y0);
  if (!a.moved) { w = 180; h = 180; x = a.x0 - w / 2; y = a.y0 - h / 2; }
  w = clamp(w, 90, 4000); h = clamp(h, 90, 4000);
  x = clamp(x, -1e9, 1e9); y = clamp(y, -1e9, 1e9);
  const o = {
    id: uid(),
    type: 'sticky',
    x, y, w, h,
    color: state.noteColor,
    opacity: state.opacity,
    fontSize: clamp(Math.round(Math.sqrt(w * h) / 6.5), 16, 40),
    text: ''
  };
  pushUndo();
  page().objects.push(o);
  state.selectedIds = new Set([o.id]);
  resetNudgeGroup();
  refreshContextUI();
  scheduleThumb();
  openEditor(o, 'sticky', true);
}

/* ================================================================
   9. HISTORY (Undo / Redo for objects and deleted pages)
   ================================================================ */
const stripCache = o => { const c = { ...o }; delete c._wrap; return c; };
const snapshot = (p = page()) => JSON.parse(JSON.stringify(p.objects.map(stripCache)));
const deletedPagesRedoHistory = []; // entries match deletedPagesHistory
let historyOrder = 0;
const nextHistoryOrder = () => ++historyOrder;

function retainHistory(stack, entry) {
  stack.push(entry);
  if (stack.length > HIST_MAX) stack.shift();
}

function historySnapshot(p) {
  return { objects: snapshot(p), bg: p.bg, time: nextHistoryOrder() };
}

function resetPageHistory() {
  deletedPagesHistory.length = 0;
  deletedPagesRedoHistory.length = 0;
  pages.forEach(p => { p.undo.length = 0; p.redo.length = 0; });
  historyOrder = 0;
  resetNudgeGroup();
}

function pushUndo(p = page()) {
  resetNudgeGroup();
  retainHistory(p.undo, historySnapshot(p));
  p.redo.length = 0;
  deletedPagesRedoHistory.length = 0;
  updateHistoryUI();
}

function preparePageAction() {
  finishGesture({ cancel: true });
  commitEditor();
  resetNudgeGroup();
}

function applyHistorySnapshot(p, entry) {
  p.objects = Array.isArray(entry) ? entry : entry.objects;
  if (entry.bg) p.bg = entry.bg;
  p.thumbDirty = true;
  state.selectedIds.clear();
  syncBgSeg();
  updateHistoryUI();
  if (typeof refreshContextUI === 'function') refreshContextUI();
  scheduleSave();
  needsRender = true;
}

function undo() {
  preparePageAction();
  const p = page();
  const lastUndo = p.undo.length ? p.undo[p.undo.length - 1] : null;
  const lastDel = deletedPagesHistory.length ? deletedPagesHistory[deletedPagesHistory.length - 1] : null;

  const undoTime = lastUndo ? (lastUndo.time || 0) : -1;
  const delTime = lastDel ? (lastDel.time || 0) : -1;

  // Page deletions and page edits share a monotonic order, including same-tick actions.
  if (lastDel && (delTime >= undoTime || !lastUndo)) {
    const entry = deletedPagesHistory.pop();
    const { page: restoredPage, index } = entry;
    const targetIndex = clamp(index, 0, pages.length);
    pages.splice(targetIndex, 0, restoredPage);
    retainHistory(deletedPagesRedoHistory, { ...entry, index: targetIndex, time: nextHistoryOrder() });
    activatePage(targetIndex);
    toast(`Page ${targetIndex + 1} restored`);
    return;
  }

  if (lastUndo) {
    const entry = p.undo.pop();
    retainHistory(p.redo, historySnapshot(p));
    applyHistorySnapshot(p, entry);
    toast('Undo');
    return;
  }
}

function redo() {
  preparePageAction();
  const p = page();
  const lastRedo = p.redo[p.redo.length - 1];
  const lastDel = deletedPagesRedoHistory[deletedPagesRedoHistory.length - 1];
  if (lastDel && (!lastRedo || lastDel.time > lastRedo.time)) {
    const entry = deletedPagesRedoHistory.pop();
    const index = pages.findIndex(item => item.id === entry.page.id);
    if (index < 0 || pages.length < 2) { updateHistoryUI(); return; }
    const activePageId = p.id === entry.page.id ? entry.activePageId : p.id;
    pages.splice(index, 1);
    retainHistory(deletedPagesHistory, { ...entry, index, time: nextHistoryOrder() });
    const activeIndex = pages.findIndex(item => item.id === activePageId);
    activatePage(activeIndex >= 0 ? activeIndex : Math.min(index, pages.length - 1));
    toast('Page deletion redone — Ctrl+Z to restore');
    return;
  }
  if (!lastRedo) return;
  const entry = p.redo.pop();
  retainHistory(p.undo, historySnapshot(p));
  applyHistorySnapshot(p, entry);
  toast('Redo');
}

function updateHistoryUI() {
  const p = page();
  $('undoBtn').disabled = (!p || !p.undo.length) && !deletedPagesHistory.length;
  $('redoBtn').disabled = (!p || !p.redo.length) && !deletedPagesRedoHistory.length;
}

/* ================================================================
   10. IMAGES & CLIPBOARD
   ================================================================ */
function importImageFile(file, at, targetPageId = page().id, generation = boardGeneration) {
  if (!file || !file.type || !file.type.startsWith('image/')) {
    toast('That file is not an image');
    return;
  }
  const rd = new FileReader();
  rd.onload = () => finalizeImageSrc(rd.result, at, targetPageId, generation);
  rd.onerror = () => toast('Could not read that image');
  rd.readAsDataURL(file);
}

function finalizeImageSrc(src, at, targetPageId = page().id, generation = boardGeneration) {
  const im = new Image();
  im.onload = () => {
    if (generation !== boardGeneration || !pages.some(p => p.id === targetPageId)) {
      toast('Image import canceled because its destination page was removed');
      return;
    }
    let w = im.naturalWidth, h = im.naturalHeight, out = src;
    if (!w || !h) { toast('Could not load that image'); return; }
    const MAXPX = 1600;
    if (Math.max(w, h) > MAXPX) {
      const f = MAXPX / Math.max(w, h);
      const t = document.createElement('canvas');
      t.width = Math.max(1, Math.round(w * f));
      t.height = Math.max(1, Math.round(h * f));
      try {
        const imageContext = t.getContext('2d');
        if (!imageContext) throw new Error('Canvas unavailable');
        imageContext.drawImage(im, 0, 0, t.width, t.height);
        out = t.toDataURL('image/png');
      } catch (_) { toast('Could not process that image'); return; }
      w = t.width;
      h = t.height;
    }
    registerAndPlace(im, out, w, h, at, targetPageId, generation);
  };
  im.onerror = () => toast('Could not load that image');
  im.src = src;
}

function registerAndPlace(el, src, w, h, at, targetPageId = page().id, generation = boardGeneration) {
  const target = pages.find(p => p.id === targetPageId);
  if (!target || generation !== boardGeneration) return;
  if (target === page() && (action || editing)) {
    setTimeout(() => registerAndPlace(el, src, w, h, at, targetPageId, generation), 200);
    return;
  }
  const id = uid();
  IMG.set(id, { el, src, w, h, status: 'ready' });
  const v = target.view;
  const maxW = (VW / v.zoom) * 0.55, maxH = (VH / v.zoom) * 0.55;
  const f = Math.min(maxW / w, maxH / h, 1);
  const dw = Math.max(0.01, w * f), dh = Math.max(0.01, h * f);
  const c = at || { x: (VW / 2 - v.panX) / v.zoom, y: (VH / 2 - v.panY) / v.zoom };
  const o = { id: uid(), type: 'image', imgId: id, x: clamp(c.x - dw / 2, -1e9, 1e9), y: clamp(c.y - dh / 2, -1e9, 1e9), w: dw, h: dh };
  pushUndo(target);
  target.objects.push(o);
  if (target === page()) state.selectedIds = new Set([o.id]);
  refreshContextUI();
  scheduleThumb(target);
  needsRender = true;
  toast('Image added');
}

$('insertImgBtn').onclick = () => { commitEditor(); $('imageInput').click(); };
$('imageInput').addEventListener('change', e => {
  const f = e.target.files[0];
  if (f) importImageFile(f, null);
  e.target.value = '';
});

/* Drag & drop image files */
['dragenter', 'dragover'].forEach(ev =>
  window.addEventListener(ev, e => { e.preventDefault(); $('dropHint').style.display = 'block'; }));
window.addEventListener('dragleave', e => {
  if (!e.relatedTarget) $('dropHint').style.display = 'none';
});
window.addEventListener('drop', e => {
  e.preventDefault();
  $('dropHint').style.display = 'none';
  const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) importImageFile(f, worldFromClient(e.clientX, e.clientY));
});

/* Universal Copy / Paste Handlers */
window.addEventListener('copy', e => {
  if (editing || (e.target && ['TEXTAREA', 'INPUT'].includes(e.target.tagName)) || e.target?.isContentEditable) return;
  const selected = getSelectedObjects();
  if (selected.length) {
    clipObjects = selected.map(cloneObj);
    const used = new Set(selected.filter(o => o.type === 'image').map(o => o.imgId));
    clipImages = [...IMG].filter(([id]) => used.has(id)).map(([id, rec]) => [id, rec.src]);
    const payload = JSON.stringify({ type: 'brightboard-clip', v: 1, objects: clipObjects.map(stripCache), images: clipImages });
    if (e.clipboardData) {
      e.clipboardData.setData('text/plain', payload);
      e.preventDefault();
    }
    toast(`Copied ${selected.length} object${selected.length > 1 ? 's' : ''}`);
  }
});

function pasteBoardObjects(data) {
  if (!data || data.type !== 'brightboard-clip' || (data.v !== undefined && data.v !== 1) || !Array.isArray(data.objects) || !data.objects.length || data.objects.length > 50000) throw new Error('Invalid clipboard objects');
  const assets = validateImageAssets(data.images || []), ids = new Set();
  data.objects.forEach(o => {
    if (o?.type === 'image' && !assets.has(o.imgId) && IMG.has(o.imgId)) assets.set(o.imgId, IMG.get(o.imgId).src);
  });
  let points = 0;
  const objects = data.objects.map(o => {
    const obj = validateBoardObject(o, assets, ids);
    points += obj.points?.length || 0;
    if (points > 500000) throw new Error('Clipboard has too many points');
    return obj;
  });
  const remapped = new Map();
  objects.filter(o => o.type === 'image').forEach(o => {
    if (!remapped.has(o.imgId)) remapped.set(o.imgId, uid());
  });
  const offset = constrainTranslation(objects, 24, 24);
  const clones = objects.map(o => {
    const c = cloneObj(o);
    if (c.type === 'image') c.imgId = remapped.get(c.imgId);
    translateObj(c, offset.dx, offset.dy);
    return c;
  });
  finishGesture({ cancel: true });
  commitEditor();
  pushUndo();
  remapped.forEach((newId, oldId) => registerImageSource(newId, assets.get(oldId)));
  page().objects.push(...clones);
  state.selectedIds = new Set(clones.map(c => c.id));
  refreshContextUI();
  scheduleThumb();
  needsRender = true;
  toast(`${clones.length} object${clones.length > 1 ? 's' : ''} pasted`);
}

window.addEventListener('paste', e => {
  if (editing || (e.target && ['TEXTAREA', 'INPUT'].includes(e.target.tagName)) || e.target?.isContentEditable) return;
  const items = (e.clipboardData && e.clipboardData.items) || [];
  for (const it of items) {
    if (it.type && it.type.startsWith('image/')) {
      const f = it.getAsFile();
      if (f) {
        e.preventDefault();
        importImageFile(f, null);
        return;
      }
    }
  }

  const rawText = e.clipboardData && e.clipboardData.getData('text');
  if (rawText && rawText.trim()) {
    try {
      const parsed = JSON.parse(rawText);
      if (parsed && parsed.type === 'brightboard-clip') {
        e.preventDefault();
        try { pasteBoardObjects(parsed); }
        catch (err) { toast(`Could not paste objects: ${err.message}`); }
        return;
      }
    } catch (_) {}
  }

  // If internal objects were copied within current session and no external text on clipboard
  if (!rawText && clipObjects && clipObjects.length) {
    e.preventDefault();
    try { pasteBoardObjects({ type: 'brightboard-clip', objects: clipObjects, images: clipImages }); }
    catch (err) { toast(`Could not paste objects: ${err.message}`); }
    return;
  }

  // If external text copied, paste as Text note at center of viewport
  const text = rawText;
  if (text && text.trim()) {
    e.preventDefault();
    if (!isValidTextContent(text)) { toast('Clipboard text is too large'); return; }
    finishGesture({ cancel: true });
    const v = page().view;
    const cx = (VW / 2 - v.panX) / v.zoom;
    const cy = (VH / 2 - v.panY) / v.zoom;
    const lines = text.split('\n');
    const o = {
      id: uid(),
      type: 'text',
      x: clamp(cx - 100, -1e9, 1e9),
      y: clamp(cy - 20, -1e9, 1e9),
      color: state.color,
      fontSize: state.fontSize,
      lines
    };
    pushUndo();
    page().objects.push(o);
    state.selectedIds = new Set([o.id]);
    refreshContextUI();
    scheduleThumb();
    needsRender = true;
    toast('Text pasted');
  }
});

/* ================================================================
   11. PNG EXPORT & JSON BACKUP / RESTORE
   ================================================================ */
function exportPNG() {
  finishGesture({ cancel: true });
  commitEditor();
  const p = page();
  const b = contentBounds(p.objects);
  const pad = 48;
  let W, H, view;
  if (b) {
    const MAXS = 8000, MAXPIXELS = 16000000;
    const needW = b.w + pad * 2, needH = b.h + pad * 2;
    const sc = Math.min(2, MAXS / needW, MAXS / needH, Math.sqrt(MAXPIXELS / (needW * needH)));
    W = Math.max(1, Math.floor(needW * sc));
    H = Math.max(1, Math.floor(needH * sc));
    view = { zoom: sc, panX: (pad - b.x) * sc, panY: (pad - b.y) * sc };
  } else {
    W = 1280;
    H = 800;
    view = { zoom: 1, panX: 0, panY: 0 };
  }
  const fname = `brightboard-p${state.pageIndex + 1}-${getTimestamp()}.png`;
  const deliver = url => {
    const a = document.createElement('a');
    a.href = url;
    a.download = fname;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => { if (url.startsWith('blob:')) URL.revokeObjectURL(url); }, 5000);
    toast('PNG downloaded');
  };
  try {
    if (p.objects.some(o => o.type === 'image' && (!IMG.has(o.imgId) || IMG.get(o.imgId).status === 'error'))) {
      toast('An image could not load — export JSON to keep its source');
      return;
    }
    if (p.objects.some(o => o.type === 'image' && IMG.get(o.imgId)?.status === 'loading')) {
      toast('Wait for images to finish loading before exporting PNG');
      return;
    }
    const oc = document.createElement('canvas');
    oc.width = W;
    oc.height = H;
    const octx = oc.getContext('2d');
    if (!octx) throw new Error('Canvas unavailable');
    paintBoard(octx, W, H, view, p.bg, p.objects, null);
    oc.toBlob(blob => {
      try {
        if (!blob) throw new Error('PNG encoding failed');
        deliver(URL.createObjectURL(blob));
      } catch (_) { toast('Could not export PNG — try a smaller page or export JSON'); }
    }, 'image/png');
  } catch (err) {
    toast('Could not export PNG — try a smaller page or export JSON');
  }
}

function exportJSONBackup() {
  finishGesture({ cancel: true });
  commitEditor();
  const data = serializeBoard();
  data.exportedAt = new Date().toISOString();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `brightboard-backup-${getTimestamp()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  closeDialog('backupModal');
  toast('Notebook JSON exported');
}

function restoreFromJSONFile(file) {
  if (!file) return;
  if (file.size > 64000000) { toast('Backup file is too large'); return; }
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (data && Array.isArray(data.pages) && data.pages.length) {
        restoreBoard(data);
        activatePage(state.pageIndex);
        scheduleSave();
        needsRender = true;
        closeDialog('backupModal');
        toast('Notebook restored from JSON');
      } else {
        toast('Invalid notebook backup file');
      }
    } catch (err) {
      toast(`Could not restore backup: ${err.message}`);
    }
  };
  reader.onerror = () => toast('Could not read backup file');
  reader.readAsText(file);
}

/* ================================================================
   12. PAGES — strip, thumbnails, add / delete / switch
   ================================================================ */
function rebuildStrip() {
  const strip = $('pagestrip');
  const pin = $('pinPages');
  const focused = document.activeElement;
  const preserveFocus = strip.contains(focused);
  const focusedPageId = focused && (focused.dataset.pageId || focused.parentElement?.dataset.pageId);
  const focusDelete = focused && focused.classList.contains('pdel');
  const focusAdd = focused && focused.id === 'addPage';
  const focusPin = focused === pin;
  strip.innerHTML = '';
  strip.appendChild(pin);
  pages.forEach((p, i) => {
    const d = document.createElement('div');
    d.className = 'pthumb' + (i === state.pageIndex ? ' active' : '');
    d.dataset.pageId = p.id;
    d.tabIndex = 0;
    d.setAttribute('role', 'button');
    d.setAttribute('aria-label', `Switch to page ${i + 1}`);
    d.setAttribute('aria-current', i === state.pageIndex ? 'page' : 'false');
    d.title = `Page ${i + 1}`;
    if (!p.thumbCanvas) {
      p.thumbCanvas = document.createElement('canvas');
      p.thumbCanvas.width = TH_W * 2;
      p.thumbCanvas.height = TH_H * 2;
    }
    d.appendChild(p.thumbCanvas);
    const n = document.createElement('span');
    n.className = 'pnum';
    n.textContent = i + 1;
    d.appendChild(n);

    // Always show cross button (even when 1 page is open)
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'pdel';
    del.title = pages.length === 1 ? 'Clear this page' : 'Delete page';
    del.setAttribute('aria-label', pages.length === 1 ? 'Clear page 1' : `Delete page ${i + 1}`);
    del.innerHTML = X_SVG;
    del.onclick = ev => {
      ev.stopPropagation();
      deleteOrClearPage(i);
    };
    del.onkeydown = ev => ev.stopPropagation();
    d.appendChild(del);

    d.onclick = () => switchPage(i);
    d.onkeydown = ev => {
      if (ev.target !== d || (ev.key !== 'Enter' && ev.key !== ' ')) return;
      ev.preventDefault();
      ev.stopPropagation();
      switchPage(i);
    };
    strip.appendChild(d);
  });
  const add = document.createElement('button');
  add.type = 'button';
  add.id = 'addPage';
  add.title = 'Add new page';
  add.setAttribute('aria-label', 'Add new page');
  add.innerHTML = PLUS_SVG;
  add.onclick = addPage;
  strip.appendChild(add);
  if (preserveFocus) {
    const thumb = Array.from(strip.children).find(d => d.dataset.pageId === focusedPageId) || strip.children[state.pageIndex + 1];
    const target = focusPin ? pin : focusAdd ? add : focusDelete && thumb?.dataset.pageId === focusedPageId ? thumb.querySelector('.pdel') : thumb;
    target?.focus();
  }
}

function activatePage(i) {
  if (i < 0 || i >= pages.length) return;
  state.pageIndex = i;
  state.selectedIds.clear();
  resetNudgeGroup();
  syncBgSeg();
  updateZoomLabel();
  updateHistoryUI();
  if (typeof refreshContextUI === 'function') refreshContextUI();
  rebuildStrip();
  scheduleSave();
  needsRender = true;
}

function switchPage(i) {
  if (i === state.pageIndex || i < 0 || i >= pages.length) return;
  preparePageAction();
  activatePage(i);
}

function addPage() {
  preparePageAction();
  deletedPagesRedoHistory.length = 0;
  pages.push(newPage(page().bg));
  activatePage(pages.length - 1);
  toast(`Page ${pages.length} created`);
}

function deleteOrClearPage(i) {
  if (i < 0 || i >= pages.length) return;
  preparePageAction();
  if (pages.length === 1) {
    // Only 1 page open: clear all objects on it immediately without confirmation
    const cur = pages[0];
    if (cur.objects.length > 0) {
      pushUndo();
      cur.objects = [];
      state.selectedIds.clear();
      scheduleThumb();
      needsRender = true;
      toast('Page cleared — Ctrl+Z to undo');
    } else {
      toast('Page is already empty');
    }
    return;
  }
  // Preserve the active page when an earlier, inactive thumbnail is deleted.
  const activePageId = page().id;
  const removed = pages.splice(i, 1)[0];
  deletedPagesRedoHistory.length = 0;
  pages.forEach(p => p.redo.length = 0);
  removed.redo.length = 0;
  retainHistory(deletedPagesHistory, { page: removed, index: i, activePageId, time: nextHistoryOrder() });
  const activeIndex = pages.findIndex(p => p.id === activePageId);
  activatePage(activeIndex >= 0 ? activeIndex : Math.min(i, pages.length - 1));
  toast('Page deleted — Ctrl+Z to restore');
}

function clearCurrentPage() {
  preparePageAction();
  const p = page();
  if (!p.objects.length) { toast('Page is already empty'); return; }
  pushUndo();
  p.objects = [];
  state.selectedIds.clear();
  scheduleThumb();
  needsRender = true;
  toast('Page cleared — Ctrl+Z to undo');
}

function renderThumb(p) {
  if (!p.thumbCanvas) {
    p.thumbCanvas = document.createElement('canvas');
    p.thumbCanvas.width = TH_W * 2;
    p.thumbCanvas.height = TH_H * 2;
  }
  const c = p.thumbCanvas.getContext('2d');
  const b = contentBounds(p.objects);
  let view;
  if (b) {
    const z = clamp(Math.min((TH_W - 14) / Math.max(b.w, 1), (TH_H - 14) / Math.max(b.h, 1)), 0.02, 0.6);
    view = { zoom: z, panX: (TH_W - b.w * z) / 2 - b.x * z, panY: (TH_H - b.h * z) / 2 - b.y * z };
  } else {
    view = { zoom: 0.2, panX: TH_W / 2, panY: TH_H / 2 };
  }
  c.setTransform(2, 0, 0, 2, 0, 0);
  paintBoard(c, TH_W, TH_H, view, p.bg, p.objects, null);
}

function scheduleThumb(target = page()) {
  target.thumbDirty = true;
  scheduleSave();
}

function thumbSweep() {
  for (const p of pages) {
    if (p.thumbDirty) {
      renderThumb(p);
      p.thumbDirty = false;
    }
  }
}

/* ================================================================
   13. AUTOSAVE & STORAGE GARBAGE COLLECTION
   ================================================================ */
let saveTimer = null, saveBroken = false;
let recoveryRaw = null, recoveryProtected = false;

function preserveOriginalSave(raw) {
  recoveryRaw = raw;
  recoveryProtected = false;
  try {
    const previous = localStorage.getItem(RECOVERY_KEY);
    if (!previous || previous === raw) {
      localStorage.setItem(RECOVERY_KEY, raw);
      recoveryProtected = true;
    }
  } catch (_) {}
  updateRecoveryUI();
  setSaveStatus(recoveryProtected ? 'Original saved data retained for recovery' : 'Recovery needed — download original data', !recoveryProtected);
}

function updateRecoveryUI() {
  const button = $('downloadRecoveryBtn');
  if (button) button.hidden = !recoveryRaw;
}

function downloadRecoveryBackup() {
  if (!recoveryRaw) return;
  const url = URL.createObjectURL(new Blob([recoveryRaw], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = `brightboard-recovery-${getTimestamp()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  recoveryProtected = true;
  scheduleSave();
  toast('Original notebook data downloaded for recovery');
}
$('downloadRecoveryBtn').onclick = downloadRecoveryBackup;

function pruneUnusedImages() {
  const usedImgIds = new Set();
  const scan = objects => {
    for (const o of objects || []) {
      if (o.type === 'image' && o.imgId) usedImgIds.add(o.imgId);
    }
  };
  const scanPage = p => {
    scan(p.objects);
    [...p.undo, ...p.redo].forEach(entry => scan(Array.isArray(entry) ? entry : entry.objects));
  };
  pages.forEach(scanPage);
  deletedPagesHistory.forEach(entry => scanPage(entry.page));
  deletedPagesRedoHistory.forEach(entry => scanPage(entry.page));
  scan(clipObjects);
  for (const id of IMG.keys()) {
    if (!usedImgIds.has(id)) IMG.delete(id);
  }
}

function persistedObjects(p) {
  const objects = p.objects.map(stripCache);
  if (!editing || editing.pageId !== p.id) return objects;
  const draft = stripCache(editing.obj), value = $('textEditor').value;
  const index = objects.findIndex(o => o.id === draft.id);
  if (editing.kind === 'text') {
    if (!value.trim()) { if (index >= 0) objects.splice(index, 1); return objects; }
    draft.lines = value.split('\n');
  } else draft.text = value;
  if (index >= 0) objects[index] = draft;
  else objects.push(draft);
  return objects;
}

function serializeBoard() {
  const serializedPages = pages.map(p => ({ id: p.id, bg: p.bg, view: { ...p.view }, objects: persistedObjects(p) }));
  const used = new Set(serializedPages.flatMap(p => p.objects.filter(o => o.type === 'image').map(o => o.imgId)));
  return {
    v: 1,
    appVersion: APP_VERSION,
    pageIndex: state.pageIndex,
    pages: serializedPages,
    images: [...IMG].filter(([id]) => used.has(id)).map(([id, r]) => [id, r.src]),
  };
}

function scheduleSave() {
  clearTimeout(saveTimer);
  if (!saveBroken) setSaveStatus('Saving…');
  saveTimer = setTimeout(saveNow, 800);
}

let saveStatusTimer = null;
function setSaveStatus(message, failed = false) {
  const status = $('saveStatus');
  if (!status) return;
  clearTimeout(saveStatusTimer);
  status.textContent = message;
  status.classList.toggle('error', failed);
  status.classList.add('show');
  // Keep pending saves and failures visible until the next result arrives.
  if (!failed && message !== 'Saving…') {
    saveStatusTimer = setTimeout(() => status.classList.remove('show'), 2400);
  }
}

function saveNow() {
  clearTimeout(saveTimer);
  if (recoveryRaw && !recoveryProtected) {
    setSaveStatus('Recovery needed — download original data', true);
    return false;
  }
  try {
    pruneUnusedImages();
    const data = serializeBoard();
    validateNotebook(data);
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    saveBroken = false;
    setSaveStatus('Saved');
    return true;
  } catch (e) {
    if (!saveBroken) {
      saveBroken = true;
      toast('Could not save — export a JSON backup to protect your work');
    }
    setSaveStatus('Save failed — export a backup', true);
    return false;
  }
}
window.addEventListener('beforeunload', saveNow);
window.addEventListener('pagehide', suspendInteractions);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') suspendInteractions(); });

function restoreBoard(d, { recoverMissingImages = false } = {}) {
  const data = validateNotebook(d, { recoverMissingImages });
  const restoredPages = data.pages.map(pd => {
    const p = newPage(pd.bg || 'grid');
    p.id = pd.id;
    p.objects = pd.objects;
    p.view = pd.view;
    return p;
  });
  finishGesture({ cancel: true });
  editing = null;
  $('textEditor').style.display = 'none';
  resetPageHistory();
  pages.splice(0, pages.length, ...restoredPages);
  state.pageIndex = data.pageIndex;
  state.selectedIds.clear();
  IMG.clear();
  boardGeneration++;
  data.images.forEach(([id, src]) => registerImageSource(id, src));
  refreshContextUI();
  needsRender = true;
  return data.recoveredImages;
}

function registerImageSource(id, src) {
  const el = new Image();
  const rec = { el, src, w: 0, h: 0, status: 'loading' };
  IMG.set(id, rec);
  el.onload = () => {
    if (IMG.get(id) !== rec) return;
    rec.w = el.naturalWidth; rec.h = el.naturalHeight; rec.status = 'ready';
    needsRender = true;
    pages.forEach(p => { p.thumbDirty = true; });
  };
  el.onerror = () => {
    if (IMG.get(id) !== rec) return;
    rec.status = 'error';
    toast('An image could not load; its source is retained in your backup');
    needsRender = true;
  };
  el.src = src;
  return rec;
}

function validateNotebook(data, { recoverMissingImages = false } = {}) {
  if (!data || typeof data !== 'object' || (data.v !== undefined && data.v !== 1)) throw new Error('Unsupported notebook format');
  if (!Array.isArray(data.pages) || !data.pages.length || data.pages.length > 1000) throw new Error('Invalid notebook pages');
  const assets = validateImageAssets(data.images || []), objectIds = new Set(), pageIds = new Set();
  let objectCount = 0, pointCount = 0, recoveredImages = 0;
  const normalized = data.pages.map(pd => {
    if (!pd || typeof pd !== 'object' || !Array.isArray(pd.objects || [])) throw new Error('Invalid page objects');
    const objects = (pd.objects || []).map(o => {
      if (recoverMissingImages && o?.type === 'image' && !assets.has(o.imgId)) {
        const id = validateId(o.imgId);
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="180"><rect width="300" height="180" fill="#FCFAF3"/><rect x="2" y="2" width="296" height="176" fill="none" stroke="#C43C2B" stroke-width="4"/><text x="150" y="85" text-anchor="middle" font-family="sans-serif" font-size="20" fill="#C43C2B">Image source missing</text><text x="150" y="115" text-anchor="middle" font-family="sans-serif" font-size="13" fill="#4A423A">Other notebook contents recovered</text></svg>';
        assets.set(id, 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg));
        recoveredImages++;
      }
      const obj = validateBoardObject(o, assets, objectIds);
      objectCount++;
      pointCount += obj.points?.length || 0;
      if (objectCount > 50000 || pointCount > 500000) throw new Error('Notebook has too many objects or points');
      return obj;
    });
    const bg = pd.bg || 'grid';
    if (!['blank', 'dots', 'grid', 'ruled'].includes(bg)) throw new Error('Invalid page background');
    const view = pd.view || { zoom: 1, panX: 0, panY: 0 };
    const id = pd.id === undefined ? uid() : validateId(pd.id);
    if (pageIds.has(id)) throw new Error('Duplicate page ID');
    pageIds.add(id);
    return { id, bg, objects, view: { zoom: clamp(validNumber(view.zoom ?? 1, 0.001, 100), 0.2, 5), panX: validNumber(view.panX ?? 0), panY: validNumber(view.panY ?? 0) } };
  });
  const pageIndex = data.pageIndex === undefined ? 0 : validNumber(data.pageIndex, 0, 1000000);
  return { pages: normalized, pageIndex: clamp(Math.trunc(pageIndex), 0, normalized.length - 1), images: [...assets], recoveredImages };
}

function validNumber(value, min = -1e9, max = 1e9) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error('Invalid numeric value');
  return value;
}
function isValidTextContent(value, kind = 'text') {
  return typeof value === 'string' && value.length <= 1000000 && (kind !== 'text' || value.split('\n').length <= 10000);
}
function validateId(value) {
  if (typeof value !== 'string' || !/^[\w-]{1,128}$/.test(value)) throw new Error('Invalid object or image ID');
  return value;
}
function validateImageAssets(images) {
  if (!Array.isArray(images) || images.length > 50000) throw new Error('Invalid image assets');
  const assets = new Map(); let total = 0;
  for (const entry of images) {
    if (!Array.isArray(entry) || entry.length !== 2) throw new Error('Invalid image asset');
    const id = validateId(entry[0]), src = entry[1];
    if (assets.has(id) || typeof src !== 'string' || !/^data:image\/[a-z0-9.+-]+(?:;[a-z0-9=.+-]+)*,/i.test(src) || src.length > 16000000) throw new Error('Invalid image source');
    total += src.length;
    if (total > 64000000) throw new Error('Image assets are too large');
    assets.set(id, src);
  }
  return assets;
}
function validateBoardObject(o, assets, ids) {
  if (!o || typeof o !== 'object') throw new Error('Invalid drawing object');
  const id = validateId(o.id);
  if (ids.has(id)) throw new Error('Duplicate object ID');
  ids.add(id);
  const obj = { id, type: o.type };
  if (o.opacity !== undefined) obj.opacity = validNumber(o.opacity, 0.01, 1);
  const number = (key, min, max) => { obj[key] = validNumber(o[key], min, max); };
  if (o.type !== 'image') {
    if (typeof o.color !== 'string' || !/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(o.color)) throw new Error('Invalid object color');
    obj.color = o.color;
  }
  if (o.angle !== undefined) obj.angle = validNumber(o.angle, -1e9, 1e9) % (Math.PI * 2);
  if (o.type === 'stroke') {
    number('width', 0.01, 1e6);
    if (o.mode !== 'pen' && o.mode !== 'hi') throw new Error('Invalid stroke mode');
    obj.mode = o.mode;
    if (!Array.isArray(o.points) || !o.points.length || o.points.length > 100000) throw new Error('Invalid stroke points');
    obj.points = o.points.map(p => {
      if (!p || typeof p !== 'object') throw new Error('Invalid stroke point');
      return { x: validNumber(p.x), y: validNumber(p.y), w: validNumber(p.w ?? 1, 0.01, 10) };
    });
  } else if (['line', 'rect', 'ellipse', 'arrow'].includes(o.type)) {
    ['x0','y0','x1','y1'].forEach(key => number(key)); number('width', 0.01, 1e6);
    if (o.fill !== undefined && typeof o.fill !== 'boolean') throw new Error('Invalid shape fill');
    obj.fill = !!o.fill;
  } else if (['text', 'sticky', 'image'].includes(o.type)) {
    number('x'); number('y');
    if (o.type !== 'text') { number('w', 0.01, 1e9); number('h', 0.01, 1e9); }
    if (o.type === 'image') {
      obj.imgId = validateId(o.imgId);
      if (!assets.has(obj.imgId)) throw new Error('An image source is missing');
    } else {
      number('fontSize', 0.01, 10000);
      if (o.type === 'text') {
        if (!Array.isArray(o.lines) || !o.lines.length || o.lines.some(ln => typeof ln !== 'string' || ln.includes('\n')) || !isValidTextContent(o.lines.join('\n'))) throw new Error('Invalid text');
        obj.lines = [...o.lines];
      } else {
        if (!isValidTextContent(o.text, 'sticky')) throw new Error('Invalid sticky text');
        obj.text = o.text;
      }
    }
  } else throw new Error('Unsupported drawing object');
  return obj;
}

function invalidateWrapCaches() {
  pages.forEach(p => p.objects.forEach(o => { delete o._wrap; }));
}

/* ================================================================
   14. UI WIRING & INTERACTION
   ================================================================ */
const toolSizes = { pen: 4, highlighter: 4, eraser: 4, line: 4, rect: 4, ellipse: 4, arrow: 4 };

function syncToolbarLayout() {
  const bar = $('topbar');
  if (bar.getBoundingClientRect && document.documentElement) {
    document.documentElement.style.setProperty('--toolbar-bottom', (bar.getBoundingClientRect().bottom + 12) + 'px');
  }
}
window.addEventListener('resize', syncToolbarLayout);

function updateSelectedProperty(property, value, predicate = () => true) {
  if (state.tool !== 'select') return;
  const selected = getSelectedObjects().filter(o => predicate(o) && (o[property] !== undefined || property === 'opacity') && (property === 'opacity' ? o.opacity ?? 1 : o[property]) !== value);
  if (!selected.length) return;
  finishGesture({ cancel: true });
  resetNudgeGroup();
  pushUndo();
  selected.forEach(o => { o[property] = value; });
  scheduleThumb();
  refreshContextUI();
}

function chooseColor(col) {
  if (state.tool === 'select') {
    updateSelectedProperty('color', col, o => o.type !== 'sticky');
  } else {
    setColor(col);
  }
}

function buildSwatches() {
  const row = $('swatchRow');
  MARKERS.forEach(col => {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.dataset.col = col;
    b.style.background = col;
    b.title = col;
    b.setAttribute('aria-label', `Ink color ${col}`);
    b.onclick = () => chooseColor(col);
    row.appendChild(b);
  });
}

function setColor(c, updateDefault = true) {
  if (updateDefault) state.color = c;
  document.querySelectorAll('#swatchRow .swatch:not(.custom)')
    .forEach(s => {
      const active = s.dataset.col === c;
      s.classList.toggle('active', active);
      s.setAttribute('aria-pressed', String(active));
    });
  $('customSw').classList.toggle('active', !MARKERS.includes(c));
  $('customColor').value = !MARKERS.includes(c) ? c : (state.custom || c);
  $('customSw').style.setProperty('--cc', !MARKERS.includes(c) ? c : (state.custom || '#FFFFFF'));
}

function buildNotePalette() {
  NOTES.forEach(col => {
    const b = document.createElement('button');
    b.className = 'nswatch';
    b.dataset.col = col;
    b.style.background = col;
    b.title = `Note color ${col}`;
    b.setAttribute('aria-label', b.title);
    b.onclick = () => {
      if (state.tool === 'select') updateSelectedProperty('color', col, o => o.type === 'sticky');
      else setNoteColor(col);
    };
    $('noteRow').appendChild(b);
  });
}

function setNoteColor(col, updateDefault = true) {
  if (updateDefault) state.noteColor = col;
  document.querySelectorAll('.nswatch').forEach(s => {
    const active = s.dataset.col === col;
    s.classList.toggle('active', active);
    s.setAttribute('aria-pressed', String(active));
  });
}

function setTool(t) {
  if (state.tool !== t) {
    finishGesture({ cancel: true });
    commitEditor();
    resetNudgeGroup();
    if (toolSizes[state.tool] !== undefined) toolSizes[state.tool] = state.size;
    state.tool = t;
    if (toolSizes[t] !== undefined) state.size = toolSizes[t];
  }
  document.querySelectorAll('#toolrail .tbtn[data-tool]')
    .forEach(b => {
      const active = b.dataset.tool === t;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', String(active));
    });
  $('eraserRing').style.display = 'none';
  $('laserDot').style.display = 'none';
  $('brushPreview').style.display = 'none';
  refreshContextUI();
}

function refreshContextUI() {
  const t = state.tool;
  const selected = t === 'select' ? getSelectedObjects() : [];
  const shapeish = ['line', 'rect', 'ellipse', 'arrow'].includes(t);
  const inkObject = selected.find(o => o.color !== undefined && o.type !== 'sticky');
  const widthObject = selected.find(o => o.width !== undefined);
  const fontObject = selected.find(o => o.fontSize !== undefined);
  const noteObject = selected.find(o => o.type === 'sticky');
  const fillObject = selected.find(o => o.fill !== undefined);
  const sw = t === 'select' ? !!inkObject : ['pen', 'highlighter', 'text', 'bucket'].includes(t) || shapeish;
  const wr = t === 'select' ? !!widthObject : ['pen', 'highlighter', 'eraser'].includes(t) || shapeish;
  const fr = t === 'select' ? !!fontObject : t === 'text';
  const nr = t === 'select' ? !!noteObject : t === 'sticky';
  const fl = t === 'select' ? !!fillObject : t === 'rect' || t === 'ellipse';
  const op = t === 'select' ? selected.length > 0 : ['pen', 'highlighter', 'text', 'sticky', 'bucket'].includes(t) || shapeish;
  const show = (id, on) => { $(id).style.display = on ? '' : 'none'; };

  setColor(inkObject ? inkObject.color : state.color, false);
  setNoteColor(noteObject ? noteObject.color : state.noteColor, false);
  const size = widthObject ? widthObject.width : state.size;
  $('widthRange').max = selected.length ? Math.max(48, ...selected.map(o => o.width || 0)) : 48;
  $('widthRange').value = size;
  $('widthVal').textContent = Math.round(size * 10) / 10;
  $('fontVal').textContent = fontObject ? fontObject.fontSize : state.fontSize;
  const opacity = selected.length ? selected[0].opacity ?? 1 : state.opacity;
  $('opacityRange').value = Math.round(opacity * 100);
  $('opacityVal').textContent = Math.round(opacity * 100) + '%';
  const fill = fillObject ? !!fillObject.fill : state.fill;
  $('fillBtn').classList.toggle('on', fill);
  $('fillBtn').setAttribute('aria-pressed', String(fill));

  // Contextual width label
  if (t === 'eraser') {
    $('widthLabel').textContent = 'Size';
    $('widthRow').title = 'Eraser size (Scroll mouse wheel to adjust)';
  } else {
    $('widthLabel').textContent = 'Stroke';
    $('widthRow').title = 'Stroke size (Scroll mouse wheel to adjust)';
  }
  $('widthRange').setAttribute('aria-label', t === 'eraser' ? 'Eraser size' : 'Stroke width');

  show('swatchRow', sw);
  show('widthRow', wr);
  show('fontRow', fr);
  show('noteRow', nr);
  show('fillRow', fl);
  show('opacityRow', op);
  show('ctxGroup', sw || wr || fr || nr || fl || op);
  canvas.style.cursor = CURSORS[t] || 'default';
  if (canvasPointerType) updateCursorOverlays({ ...lastPtr, clientX: lastPtr.x, clientY: lastPtr.y, pointerType: canvasPointerType });
  requestAnimationFrame(syncToolbarLayout);
  needsRender = true;
}

function syncBgSeg() {
  const bg = page().bg;
  document.querySelectorAll('#bgSeg button').forEach(b => {
    const active = b.dataset.bg === bg;
    b.classList.toggle('active', active);
    b.setAttribute('aria-pressed', String(active));
  });
}

function setBg(bg) {
  if (page().bg === bg) return;
  finishGesture({ cancel: true });
  resetNudgeGroup();
  pushUndo();
  page().bg = bg;
  syncBgSeg();
  scheduleThumb();
  needsRender = true;
}

/* Modal */
let modalCb = null;
let activeDialog = null;
let dialogReturnFocus = null;
let dialogBackground = [];

function dialogControls(dialog) {
  return [...dialog.querySelectorAll('button:not([disabled]), input:not([type="hidden"]), textarea, [tabindex="0"]')]
    .filter(el => el.getClientRects().length > 0);
}

function openDialog(id) {
  if (activeDialog) closeDialog(activeDialog.id, false);
  dialogReturnFocus = document.activeElement;
  finishGesture({ cancel: true });
  commitEditor();
  const dialog = $(id);
  activeDialog = dialog;
  dialog.classList.add('show');
  dialogBackground = [...document.body.children].filter(el => el !== dialog && !['toast', 'saveStatus'].includes(el.id)).map(el => [el, el.inert]);
  dialogBackground.forEach(([el]) => { el.inert = true; });
  const controls = dialogControls(dialog);
  (controls[0] || dialog).focus();
}

function closeDialog(id, restoreFocus = true) {
  $(id).classList.remove('show');
  if (!activeDialog || activeDialog.id !== id) return;
  dialogBackground.forEach(([el, inert]) => { el.inert = inert; });
  dialogBackground = [];
  activeDialog = null;
  const previous = dialogReturnFocus;
  dialogReturnFocus = null;
  if (restoreFocus && previous && previous.isConnected && previous.getClientRects().length) previous.focus();
}

function showConfirm(title, msg, okText, cb) {
  $('modalTitle').textContent = title;
  $('modalMsg').textContent = msg;
  $('modalOk').textContent = okText || 'Confirm';
  modalCb = cb;
  modalOpen = true;
  openDialog('modal');
}

function closeModal(ok) {
  closeDialog('modal');
  modalOpen = false;
  const cb = modalCb;
  modalCb = null;
  if (ok && cb) cb();
}

/* Toast */
let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

/* Hint */
function showHint() {
  $('hint').classList.add('show');
  setTimeout(hideHint, 6000);
}
function hideHint() { $('hint').classList.remove('show'); }

/* Help Panel */
function toggleHelp(force) {
  const h = $('helpPanel');
  const on = force !== undefined ? force : !h.classList.contains('show');
  h.classList.toggle('show', on);
  $('helpBtn').setAttribute('aria-expanded', String(on));
}

/* Bind UI Event Handlers */
function bindUI() {
  document.querySelectorAll('button').forEach(b => {
    const label = b.dataset.tip || b.title;
    if (label && !b.getAttribute('aria-label')) b.setAttribute('aria-label', label);
  });
  document.querySelectorAll('button svg').forEach(icon => {
    icon.setAttribute('aria-hidden', 'true');
    icon.setAttribute('focusable', 'false');
  });
  document.querySelectorAll('#toolrail .tbtn[data-tool]')
    .forEach(b => b.onclick = () => setTool(b.dataset.tool));

  $('undoBtn').onclick = () => { commitEditor(); undo(); };
  $('redoBtn').onclick = () => { commitEditor(); redo(); };

  // Clear button clears board immediately without modal popup!
  $('clearBtn').onclick = clearCurrentPage;

  $('customColor').addEventListener('input', e => {
    if (state.tool !== 'select') state.custom = e.target.value;
    chooseColor(e.target.value);
  });

  function updateStrokeSize(val) {
    const min = +$('widthRange').min || 1;
    const max = +$('widthRange').max || 48;
    const clamped = clamp(Math.round(val), min, max);
    if (state.tool === 'select') updateSelectedProperty('width', clamped);
    else {
      state.size = clamped;
      if (toolSizes[state.tool] !== undefined) toolSizes[state.tool] = clamped;
      refreshContextUI();
    }
  }

  $('widthRange').addEventListener('input', e => {
    updateStrokeSize(+e.target.value);
  });
  $('opacityRange').addEventListener('input', e => {
    const opacity = clamp(Number(e.target.value) / 100, 0.01, 1);
    if (state.tool === 'select') updateSelectedProperty('opacity', opacity);
    else { state.opacity = opacity; refreshContextUI(); }
  });

  $('widthRow').addEventListener('wheel', e => {
    e.preventDefault();
    const step = e.shiftKey ? 5 : 1;
    const delta = e.deltaY < 0 ? step : -step;
    updateStrokeSize(+$('widthRange').value + delta);
  }, { passive: false });

  function updateFontSize(val) {
    const selected = state.tool === 'select' ? getSelectedObjects() : [];
    const max = Math.max(96, ...selected.map(o => o.fontSize || 0));
    const clamped = clamp(Math.round(val), 10, max);
    if (state.tool === 'select') updateSelectedProperty('fontSize', clamped);
    else { state.fontSize = clamped; refreshContextUI(); }
  }

  $('fontMinus').onclick = () => updateFontSize(+$('fontVal').textContent - 2);
  $('fontPlus').onclick = () => updateFontSize(+$('fontVal').textContent + 2);

  $('fontRow').addEventListener('wheel', e => {
    e.preventDefault();
    const step = e.shiftKey ? 10 : 2;
    const delta = e.deltaY < 0 ? step : -step;
    updateFontSize(+$('fontVal').textContent + delta);
  }, { passive: false });

  $('fillBtn').onclick = () => {
    const fill = !$('fillBtn').classList.contains('on');
    if (state.tool === 'select') updateSelectedProperty('fill', fill);
    else { state.fill = fill; refreshContextUI(); }
  };

  document.querySelectorAll('#bgSeg button').forEach(b => b.onclick = () => setBg(b.dataset.bg));

  $('zoomIn').onclick   = () => { zoomBy(1.25); scheduleSave(); };
  $('zoomOut').onclick  = () => { zoomBy(0.8);  scheduleSave(); };
  $('zoomLabel').onclick = () => { setZoom(1);  scheduleSave(); };
  $('fitBtn').onclick   = () => { fitView();    scheduleSave(); };

  $('exportBtn').onclick = exportPNG;
  $('helpBtn').onclick = () => toggleHelp();

  // Backup & Restore handlers
  $('backupBtn').onclick = () => openDialog('backupModal');
  $('backupCloseBtn').onclick = () => closeDialog('backupModal');
  $('backupModal').addEventListener('pointerdown', e => {
    if (e.target === $('backupModal')) closeDialog('backupModal');
  });
  $('downloadBackupBtn').onclick = exportJSONBackup;
  $('uploadBackupBtn').onclick = () => $('backupInput').click();
  $('backupInput').addEventListener('change', e => {
    const f = e.target.files && e.target.files[0];
    if (f) restoreFromJSONFile(f);
    e.target.value = '';
  });

  $('selFront').onclick = bringSelToFront;
  $('selBack').onclick = sendSelToBack;
  $('selDup').onclick = duplicateSelection;
  $('selDel').onclick = deleteSelection;

  $('modalOk').onclick = () => closeModal(true);
  $('modalCancel').onclick = () => closeModal(false);
  $('modal').addEventListener('pointerdown', e => { if (e.target === $('modal')) closeModal(false); });

  $('hint').onclick = hideHint;

  document.addEventListener('keydown', e => {
    if (!activeDialog) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (activeDialog.id === 'modal') closeModal(false);
      else closeDialog(activeDialog.id);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      const controls = dialogControls(activeDialog);
      if (!controls.length) { activeDialog.focus(); return; }
      const index = controls.indexOf(document.activeElement);
      const next = index < 0 ? (e.shiftKey ? controls.length - 1 : 0)
        : (index + (e.shiftKey ? -1 : 1) + controls.length) % controls.length;
      controls[next].focus();
    }
  }, true);
  document.addEventListener('focusin', e => {
    if (activeDialog && !activeDialog.contains(e.target)) (dialogControls(activeDialog)[0] || activeDialog).focus();
  });

  // Version badge click
  const vb = $('versionBadge');
  if (vb) {
    vb.onclick = () => {
      toast(`BrightBoard v${APP_VERSION} — Smart Whiteboard & Notebook`);
    };
  }

  document.addEventListener('pointerdown', e => {
    const h = $('helpPanel');
    if (!h.classList.contains('show')) return;
    if (h.contains(e.target) || $('helpBtn').contains(e.target)) return;
    toggleHelp(false);
  });

  /* Text editor lifecycle */
  const ta = $('textEditor');
  ta.addEventListener('blur', () => commitEditor());
  const textLimitMessage = 'Text is too large — maximum 1,000,000 characters and 10,000 text lines';
  ta.addEventListener('paste', e => {
    if (!editing || !e.clipboardData) return;
    const pasted = e.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n');
    const start = ta.selectionStart ?? ta.value.length;
    const end = ta.selectionEnd ?? start;
    const value = ta.value.slice(0, start) + pasted + ta.value.slice(end);
    if (!isValidTextContent(value, editing.kind)) {
      e.preventDefault();
      toast(textLimitMessage);
    }
  });
  ta.addEventListener('input', () => {
    if (!editing) return;
    if (!isValidTextContent(ta.value, editing.kind)) {
      ta.value = editing.lastValue;
      toast(textLimitMessage);
    } else {
      editing.lastValue = ta.value;
      scheduleSave();
    }
    needsRender = true;
  });
  ta.addEventListener('keydown', e => {
    e.stopPropagation();
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      toast(saveNow() ? 'Board saved' : 'Save failed — export a JSON backup');
    }
    if (e.key === 'Escape') { e.preventDefault(); commitEditor(); }
  });
}

/* ================================================================
   15. KEYBOARD SYSTEM
   ================================================================ */
window.addEventListener('keydown', e => {
  const tag = (e.target && e.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;

  if (modalOpen) {
    if (e.key === 'Escape') { e.preventDefault(); closeModal(false); }
    return;
  }
  if ($('backupModal').classList.contains('show')) {
    if (e.key === 'Escape') { e.preventDefault(); closeDialog('backupModal'); }
    return;
  }
  if (e.code === 'Space') {
    if (e.target !== document.body && e.target !== canvas) return;
    e.preventDefault();
    if (!spaceHeld) { spaceHeld = true; canvas.style.cursor = 'grab'; }
    return;
  }
  const mod = e.ctrlKey || e.metaKey;
  if (mod) {
    const k = e.key.toLowerCase();
    if (k === 'z') {
      e.preventDefault();
      commitEditor();
      if (e.shiftKey) redo();
      else undo();
    } else if (k === 'y') {
      e.preventDefault();
      commitEditor();
      redo();
    } else if (k === 'd') {
      e.preventDefault();
      commitEditor();
      if (state.selectedIds.size) duplicateSelection();
    } else if (k === 's') {
      e.preventDefault();
      toast(saveNow() ? 'Board saved' : 'Save failed — export a JSON backup');
    } else if (k === 'c') {
      const selected = getSelectedObjects();
      if (selected.length) {
        clipObjects = selected.map(cloneObj);
      }
    } else if (k === 'a') {
      e.preventDefault();
      // Ctrl+A = Select All objects on this page!
      setTool('select');
      resetNudgeGroup();
      state.selectedIds = new Set(page().objects.map(o => o.id));
      refreshContextUI();
      needsRender = true;
      toast(`Selected all (${page().objects.length} objects)`);
    } else if (k === '+' || k === '=' || k === '-') {
      e.preventDefault();
      zoomBy(k === '-' ? 0.8 : 1.25);
      scheduleSave();
    }
    return;
  }
  if (editing || e.altKey) return;

  if (e.key === 'Shift' && action && action.type === 'rotate') {
    doRotate(lastPtr ? worldFromClient(lastPtr.x, lastPtr.y) : action.startW, e, action);
  }

  const k = e.key.toLowerCase();
  if (TOOLKEYS[k]) {
    e.preventDefault();
    setTool(TOOLKEYS[k]);
    return;
  }

  switch (e.key) {
    case '?':
    case '/':
      e.preventDefault();
      toggleHelp();
      break;
    case "'":
      // Prevent Firefox Quick Find (links only) from opening on canvas
      e.preventDefault();
      break;
    case 'Escape':
      e.preventDefault();
      if ($('helpPanel').classList.contains('show')) toggleHelp(false);
      else { state.selectedIds.clear(); resetNudgeGroup(); refreshContextUI(); needsRender = true; }
      break;
    case 'Delete':
    case 'Backspace':
      if (state.selectedIds.size) {
        e.preventDefault();
        deleteSelection();
      }
      break;
    case '[':
      if (state.selectedIds.size) {
        e.preventDefault();
        sendSelToBack();
      }
      break;
    case ']':
      if (state.selectedIds.size) {
        e.preventDefault();
        bringSelToFront();
      }
      break;
    case 'ArrowUp':
      if (state.selectedIds.size) { e.preventDefault(); nudge(0, -(e.shiftKey ? 12 : 3) / page().view.zoom); }
      break;
    case 'ArrowDown':
      if (state.selectedIds.size) { e.preventDefault(); nudge(0,  (e.shiftKey ? 12 : 3) / page().view.zoom); }
      break;
    case 'ArrowLeft':
      if (state.selectedIds.size) { e.preventDefault(); nudge(-(e.shiftKey ? 12 : 3) / page().view.zoom, 0); }
      break;
    case 'ArrowRight':
      if (state.selectedIds.size) { e.preventDefault(); nudge( (e.shiftKey ? 12 : 3) / page().view.zoom, 0); }
      break;
    default:
      // Prevent Firefox "Search for text when you start typing" from hijacking canvas hotkeys
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
      }
      break;
  }
});

window.addEventListener('keyup', e => {
  if (e.code === 'Space') {
    spaceHeld = false;
    canvas.style.cursor = CURSORS[state.tool] || 'default';
  }
  if (e.key === 'Shift' && action && action.type === 'rotate') {
    doRotate(lastPtr ? worldFromClient(lastPtr.x, lastPtr.y) : action.startW, e, action);
  }
});

/* ================================================================
   16. BOOTSTRAP
   ================================================================ */
function bindPanelAutoHide() {
  const hover = window.matchMedia?.('(hover: hover) and (pointer: fine)');
  if (!hover) return;
  const panels = [$('toolrail'), $('pagestrip')];
  const pins = [$('pinToolbox'), $('pinPages')];
  let preferences = {};
  try { preferences = JSON.parse(localStorage.getItem('brightboard.panels.v1') || '{}') || {}; } catch (_) {}
  const hideTimers = new Map();
  const cancelHide = panel => {
    clearTimeout(hideTimers.get(panel));
    hideTimers.delete(panel);
  };
  const reveal = panel => {
    cancelHide(panel);
    panel.classList.add('is-revealed');
  };
  const hideLater = (panel, delay = 600) => {
    if (panel.classList.contains('is-pinned') || hideTimers.has(panel) || !panel.classList.contains('is-revealed')) return;
    hideTimers.set(panel, setTimeout(() => {
      panel.classList.remove('is-revealed');
      hideTimers.delete(panel);
    }, delay));
  };
  panels.forEach((panel, index) => {
    const pin = pins[index];
    const label = index === 0 ? 'toolbox' : 'pages';
    const updatePin = pinned => {
      panel.classList.toggle('is-pinned', pinned);
      pin.setAttribute('aria-pressed', String(pinned));
      pin.title = pinned ? `Let ${label} hide automatically` : `Keep ${label} visible`;
      pin.setAttribute('aria-label', pin.title);
    };
    updatePin(preferences[panel.id] === true);
    pin.onclick = () => {
      const pinned = !panel.classList.contains('is-pinned');
      updatePin(pinned);
      reveal(panel);
      if (!pinned && hover.matches) hideLater(panel, 1800);
      preferences = Object.fromEntries(panels.map(p => [p.id, p.classList.contains('is-pinned')]));
      try { localStorage.setItem('brightboard.panels.v1', JSON.stringify(preferences)); } catch (_) {}
    };
  });
  const syncMode = () => {
    document.body.classList.toggle('auto-hide-panels', hover.matches);
    panels.forEach(panel => {
      reveal(panel);
      if (hover.matches) hideLater(panel, 1800);
    });
  };
  hover.addEventListener('change', syncMode);
  syncMode();

  document.addEventListener('pointermove', e => {
    // Do not bring controls over a stroke or a pan as it crosses an edge.
    if (!hover.matches || e.pointerType !== 'mouse' || e.buttons || action || activePtrs.size) return;
    panels.forEach((panel, index) => {
      const rect = panel.getBoundingClientRect();
      const atEdge = index === 0
        ? e.clientX <= Math.max(120, Math.min(180, window.innerWidth * 0.085))
        : e.clientY >= window.innerHeight - Math.max(90, Math.min(130, window.innerHeight * 0.1));
      const inPanel = panel.contains(e.target);
      const inApproach = panel.classList.contains('is-revealed') && (index === 0
        ? e.clientX <= rect.right + 12 && e.clientY >= rect.top - 12 && e.clientY <= rect.bottom + 12
        : e.clientX >= rect.left - 12 && e.clientX <= rect.right + 12 && e.clientY >= rect.top - 12);
      if (atEdge || inPanel || inApproach) reveal(panel);
      else hideLater(panel);
    });
  });
  panels.forEach(panel => {
    panel.addEventListener('pointerenter', e => {
      if (hover.matches && e.pointerType === 'mouse' && !e.buttons && !action) reveal(panel);
    });
    panel.addEventListener('pointerleave', () => {
      if (hover.matches) hideLater(panel);
    });
  });
  // Leaving the browser also clears panels whose hover previously kept them open.
  document.addEventListener('pointerout', e => {
    if (hover.matches && !e.relatedTarget) panels.forEach(panel => hideLater(panel));
  });
}

function boot() {
  resizeCanvas();
  buildSwatches();
  buildNotePalette();
  bindUI();

  let restored = false;
  let recovered = false;
  let raw = null;
  try {
    recoveryRaw = localStorage.getItem(RECOVERY_KEY);
    recoveryProtected = !!recoveryRaw;
    updateRecoveryUI();
    raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (d && Array.isArray(d.pages) && d.pages.length) {
        const missing = restoreBoard(d, { recoverMissingImages: true });
        restored = true;
        if (missing) { preserveOriginalSave(raw); recovered = true; }
      } else {
        preserveOriginalSave(raw);
        recovered = true;
      }
    }
  } catch (_) {
    if (raw) { preserveOriginalSave(raw); recovered = true; }
  }

  rebuildStrip();
  syncBgSeg();
  setColor(state.color);
  setNoteColor(state.noteColor);
  setTool(state.tool);
  updateHistoryUI();
  updateZoomLabel();
  bindPanelAutoHide();
  if (!recovered && !recoveryRaw) setSaveStatus('Autosave ready');

  if (recovered) toast('Saved data needs recovery — open Backup to download the original');
  else if (restored) toast('Welcome back — notebook restored');
  else showHint();

  requestAnimationFrame(tick);
  setInterval(thumbSweep, 400);

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      invalidateWrapCaches();
      pages.forEach(p => p.thumbDirty = true);
      requestAnimationFrame(syncToolbarLayout);
      needsRender = true;
    });
  }
}

boot();
