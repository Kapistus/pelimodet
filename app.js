(() => {
  'use strict';

  /* ============================== CONFIG ============================== */

  const SESSION_KEY = 'fieldPlannerSession.v1';

  const FLAG_COLORS = ['#d43b3b', '#e0c23e', '#3f7fd4', '#3fb35c']; // red, yellow, blue, green — the default auto-cycle for every marker type

  const TYPE_DEFS = {
    start:   { label: 'Starting Point', letter: 'S', kind: 'pin' },
    respawn: { label: 'Respawn Point',  letter: 'R', kind: 'pin' },
    mortar:  { label: 'Mortar',         letter: 'M', kind: 'pin' },
    flag:    { label: 'Flag',           kind: 'flag' },
    custom:  { label: 'Custom Marker',  kind: 'pin' },
    arrow:   { label: 'Arrow',          kind: 'arrow' },
  };

  // Arrowhead size is fixed relative to the base marker scale — it never stretches with
  // shaft length, only with map zoom (same as every other icon's proportional sizing).
  const ARROW_HEAD_LEN = 16;
  const ARROW_HEAD_WIDTH = 13;
  const ARROW_STROKE = 4;
  const ARROW_DEFAULT_LEN_WORLD = 90; // default shaft length (world px) when first placed

  const MIN_SCALE = 0.15;
  const MAX_SCALE = 6;

  /* ============================== STATE ============================== */

  const state = {
    area: 'default',           // 'default' | 'extended'
    markers: [],                // {id,type,label,color,letter,kind,x,y} x/y are fractions 0..1
    layoutName: 'Untitled layout',
    rules: '',
    selectedId: null,
    scale: 1,
    tx: 0,
    ty: 0,
    naturalW: 0,
    naturalH: 0,
    bbox: { default: null, extended: null }, // {minX,minY,maxX,maxY} in natural px
    tintOn: true,
    isMarshal: false,
  };

  let idCounter = 1;
  const nextId = () => 'm' + (idCounter++);

  /* ============================== DOM REFS ============================== */

  const viewport = document.getElementById('viewport');
  const world = document.getElementById('world');
  const baseMap = document.getElementById('baseMap');
  const maskDefault = document.getElementById('maskDefault');
  const maskExtended = document.getElementById('maskExtended');
  const markerLayer = document.getElementById('markerLayer');

  const areaSelect = document.getElementById('areaSelect');
  const tintToggle = document.getElementById('tintToggle');
  const customColorInput = document.getElementById('customColorInput');

  const layoutNameInput = document.getElementById('layoutNameInput');
  const btnSave = document.getElementById('btnSave');
  const btnNew = document.getElementById('btnNew');
  const btnExport = document.getElementById('btnExport');
  const btnImport = document.getElementById('btnImport');
  const importFile = document.getElementById('importFile');
  const btnLoadToggle = document.getElementById('btnLoadToggle');
  const loadMenu = document.getElementById('loadMenu');

  const zoomFitBtn = document.getElementById('zoomFit');

  const rulesPanel = document.getElementById('rulesPanel');
  const rulesTextarea = document.getElementById('rulesTextarea');
  const btnRulesToggle = document.getElementById('btnRulesToggle');
  const btnRulesClose = document.getElementById('btnRulesClose');

  const editPanel = document.getElementById('editPanel');
  const editName = document.getElementById('editName');
  const editColor = document.getElementById('editColor');
  const editDelete = document.getElementById('editDelete');
  const editClose = document.getElementById('editClose');

  const nameModal = document.getElementById('nameModal');
  const nameModalInput = document.getElementById('nameModalInput');
  const nameModalCancel = document.getElementById('nameModalCancel');
  const nameModalConfirm = document.getElementById('nameModalConfirm');

  const btnMarshalLogin = document.getElementById('btnMarshalLogin');
  const btnMarshalLogout = document.getElementById('btnMarshalLogout');
  const marshalEmail = document.getElementById('marshalEmail');
  const btnPublish = document.getElementById('btnPublish');
  const liveIndicator = document.getElementById('liveIndicator');
  const loginModal = document.getElementById('loginModal');
  const loginEmail = document.getElementById('loginEmail');
  const loginPassword = document.getElementById('loginPassword');
  const loginError = document.getElementById('loginError');
  const loginCancel = document.getElementById('loginCancel');
  const loginSubmit = document.getElementById('loginSubmit');

  /* ============================== ICONS ============================== */

  function pinSVG(color, letter) {
    return `<svg viewBox="0 0 32 42" xmlns="http://www.w3.org/2000/svg">
      <path d="M16 0C7.2 0 0 7.2 0 16c0 11 16 26 16 26s16-15 16-26C32 7.2 24.8 0 16 0z" fill="${color}" stroke="#14170f" stroke-width="1.5"/>
      <circle cx="16" cy="16" r="9.5" fill="rgba(255,255,255,0.92)"/>
      <text x="16" y="20.5" text-anchor="middle" font-family="IBM Plex Sans, sans-serif" font-size="11" font-weight="700" fill="${color}">${letter}</text>
    </svg>`;
  }

  function flagSVG(color) {
    return `<svg viewBox="0 0 32 42" xmlns="http://www.w3.org/2000/svg">
      <line x1="7" y1="40" x2="7" y2="3" stroke="#cfd3c4" stroke-width="3" stroke-linecap="round"/>
      <polygon points="7,4 28,11 7,19" fill="${color}" stroke="#14170f" stroke-width="1.2"/>
    </svg>`;
  }

  function markerSVG(m) {
    return m.kind === 'flag' ? flagSVG(m.color) : pinSVG(m.color, m.letter || '?');
  }

  function arrowPreviewSVG(color) {
    // Simple static preview for the palette icon / drag ghost (not the live editable arrow)
    return `<svg viewBox="0 0 32 42" xmlns="http://www.w3.org/2000/svg">
      <line x1="3" y1="34" x2="22" y2="12" stroke="${color}" stroke-width="4" stroke-linecap="round"/>
      <polygon points="22,3 32,10 17,17" fill="${color}" stroke="#14170f" stroke-width="1"/>
    </svg>`;
  }

  // Populate static palette icons (preview only — actual color is assigned per the cycle at drop time)
  document.querySelectorAll('.palette-icon').forEach(el => {
    const kind = el.getAttribute('data-icon');
    let svg;
    if (kind === 'flag') svg = flagSVG(FLAG_COLORS[0]);
    else if (kind === 'custom') svg = pinSVG(customColorInput.value, '?');
    else if (kind === 'arrow') svg = arrowPreviewSVG(FLAG_COLORS[0]);
    else svg = pinSVG(FLAG_COLORS[0], TYPE_DEFS[kind].letter);
    el.innerHTML = svg;
  });

  customColorInput.addEventListener('input', () => {
    const el = document.querySelector('.palette-icon[data-icon="custom"]');
    if (el) el.innerHTML = pinSVG(customColorInput.value, '?');
  });

  /* ============================== BBOX (zoom-to-fit) ============================== */

  function computeAlphaBBox(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, c.width, c.height).data;
        let minX = c.width, minY = c.height, maxX = 0, maxY = 0, found = false;
        const step = 2; // sample every 2px for speed
        for (let y = 0; y < c.height; y += step) {
          for (let x = 0; x < c.width; x += step) {
            const a = data[(y * c.width + x) * 4 + 3];
            if (a > 10) {
              found = true;
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
          }
        }
        if (!found) { minX = 0; minY = 0; maxX = c.width; maxY = c.height; }
        resolve({ minX, minY, maxX, maxY });
      };
      img.onerror = () => {
        console.error('[FieldPlanner] Could not load mask image at "' + src + '" — check that the file exists at that exact path (case-sensitive) relative to index.html.');
        showLoadWarning(src);
        resolve({ minX: 0, minY: 0, maxX: 100, maxY: 100 });
      };
      img.src = src;
    });
  }

  function showLoadWarning(src) {
    let banner = document.getElementById('loadWarningBanner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'loadWarningBanner';
      banner.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#b5443a;color:#fff;' +
        'font-family:IBM Plex Sans,sans-serif;font-size:13px;padding:10px 16px;z-index:999;text-align:center;';
      document.body.appendChild(banner);
    }
    const line = document.createElement('div');
    line.textContent = 'Could not load "' + src + '" — check the file is at that exact path and filename (case-sensitive) next to index.html.';
    banner.appendChild(line);
  }

  function checkMaskCssLoad(el, src) {
    // Fetch the same URL the CSS mask-image is pointing at; if it 404s, warn,
    // since a failed CSS mask fails silently (the tint just never appears).
    fetch(src, { method: 'HEAD' }).then(res => {
      if (!res.ok) {
        console.error('[FieldPlanner] CSS mask source not found (HTTP ' + res.status + '): ' + src);
        showLoadWarning(src + ' (HTTP ' + res.status + ')');
      }
    }).catch(() => {
      console.error('[FieldPlanner] Could not verify CSS mask source: ' + src);
    });
  }

  /* ============================== TRANSFORM ============================== */

  function applyTransform() {
    world.style.transform = `translate3d(${state.tx}px, ${state.ty}px, 0) scale(${state.scale})`;
    updateMarkerPositions();
  }

  function worldToScreen(wx, wy) {
    return { x: state.tx + wx * state.scale, y: state.ty + wy * state.scale };
  }

  const BASE_MARKER_W = 22;
  const BASE_MARKER_H = 28;

  function updateMarkerPositions() {
    // Markers live in a separate, un-scaled overlay layer (a sibling of #world, not a
    // descendant of it). We compute their screen position AND their size directly here on
    // every pan/zoom, so they scale proportionally with the map (smaller when zoomed out,
    // larger when zoomed in) exactly like an object fixed to the terrain — but because we
    // resize the actual element (a vector SVG + real text), not stretch a bitmap via CSS
    // transform, they stay crisp at any size instead of blurring.
    const w = BASE_MARKER_W * state.scale;
    const h = BASE_MARKER_H * state.scale;
    const els = markerLayer.children;
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      const id = el.dataset.id;
      const m = state.markers.find(x => x.id === id);
      if (!m) continue;
      if (m.kind === 'arrow') {
        updateArrowGeometry(el, m);
      } else if (el.classList.contains('marker')) {
        const sp = worldToScreen(m.x * state.naturalW, m.y * state.naturalH);
        el.style.left = sp.x + 'px';
        el.style.top = sp.y + 'px';
        el.style.width = w + 'px';
        el.style.height = h + 'px';
        el.style.marginLeft = (-w / 2) + 'px';
        el.style.marginTop = (-h * 0.929) + 'px'; // keeps the pin's tip anchored at (sp.x, sp.y)
      }
    }
    updateArrowHandlePositions();
  }

  function screenToWorld(clientX, clientY) {
    const r = viewport.getBoundingClientRect();
    return viewportPxToWorld(clientX - r.left, clientY - r.top);
  }

  function viewportPxToWorld(sx, sy) {
    return {
      x: (sx - state.tx) / state.scale,
      y: (sy - state.ty) / state.scale,
    };
  }

  function fitToBBox(bbox) {
    if (!bbox) return;
    const r = viewport.getBoundingClientRect();
    const bw = Math.max(1, bbox.maxX - bbox.minX);
    const bh = Math.max(1, bbox.maxY - bbox.minY);
    const scale = Math.min(r.width / bw, r.height / bh) * 0.90;
    const cx = (bbox.minX + bbox.maxX) / 2;
    const cy = (bbox.minY + bbox.maxY) / 2;
    state.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
    state.tx = r.width / 2 - cx * state.scale;
    state.ty = r.height / 2 - cy * state.scale;
    applyTransform();
  }

  function zoomBy(factor, centerX, centerY) {
    const r = viewport.getBoundingClientRect();
    const cx = centerX == null ? r.width / 2 : centerX - r.left;
    const cy = centerY == null ? r.height / 2 : centerY - r.top;
    const worldPt = { x: (cx - state.tx) / state.scale, y: (cy - state.ty) / state.scale };
    let newScale = state.scale * factor;
    newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, newScale));
    state.tx = cx - worldPt.x * newScale;
    state.ty = cy - worldPt.y * newScale;
    state.scale = newScale;
    applyTransform();
  }

  /* ============================== AREA SWITCH ============================== */

  function updateTintVisibility() {
    const showDefault = state.tintOn && state.area === 'default';
    const showExtended = state.tintOn && state.area === 'extended';
    maskDefault.classList.toggle('visible', showDefault);
    maskExtended.classList.toggle('visible', showExtended);
  }

  function setArea(area, doFit = true) {
    state.area = area;
    areaSelect.value = area;
    updateTintVisibility();
    if (doFit) {
      const bbox = state.bbox[area];
      if (bbox) fitToBBox(bbox);
    }
  }

  /* ============================== MARKERS ============================== */

  function labelForNewType(type) {
    const def = TYPE_DEFS[type];
    const existing = state.markers.filter(m => m.type === type).length;
    return existing > 0 ? `${def.label} ${existing + 1}` : def.label;
  }

  function colorForNewOfType(type) {
    const existing = state.markers.filter(m => m.type === type).length;
    return FLAG_COLORS[existing % FLAG_COLORS.length];
  }

  function createMarkerData(type, x, y, opts = {}) {
    const def = TYPE_DEFS[type];
    const m = {
      id: nextId(),
      type,
      kind: def.kind,
      x, y,
    };
    if (type === 'custom') {
      m.color = opts.color || '#a855f7';
      m.label = opts.label || 'Marker';
      m.letter = (m.label.trim()[0] || '?').toUpperCase();
    } else {
      m.color = colorForNewOfType(type);
      m.label = labelForNewType(type);
      if (def.kind === 'pin') m.letter = def.letter;
    }
    return m;
  }

  function createArrowData(x1, y1, x2, y2) {
    return {
      id: nextId(),
      type: 'arrow',
      kind: 'arrow',
      color: colorForNewOfType('arrow'),
      label: '',
      x1: clamp01(x1), y1: clamp01(y1),
      x2: clamp01(x2), y2: clamp01(y2),
    };
  }

  function addArrow(x1, y1, x2, y2) {
    const m = createArrowData(x1, y1, x2, y2);
    state.markers.push(m);
    renderMarkers();
    saveSession();
    return m;
  }

  function renderMarkers() {
    markerLayer.innerHTML = '';
    state.markers.forEach(m => {
      const el = m.kind === 'arrow' ? createArrowElement(m) : createPointMarkerElement(m);
      markerLayer.appendChild(el);
    });
    updateMarkerPositions();
    refreshArrowHandles();
  }

  function createPointMarkerElement(m) {
    const el = document.createElement('div');
    el.className = 'marker' + (m.id === state.selectedId ? ' selected' : '');
    const sp = worldToScreen(m.x * state.naturalW, m.y * state.naturalH);
    el.style.left = sp.x + 'px';
    el.style.top = sp.y + 'px';
    el.innerHTML = markerSVG(m);
    el.dataset.id = m.id;

    const labelEl = document.createElement('div');
    labelEl.className = 'marker-label';
    labelEl.textContent = m.label;
    el.appendChild(labelEl);

    attachMarkerDrag(el, m);
    return el;
  }

  function createArrowElement(m) {
    const el = document.createElement('div');
    el.className = 'arrow-el' + (m.id === state.selectedId ? ' selected' : '');
    el.dataset.id = m.id;
    attachArrowBodyDrag(el, m);
    return el;
  }

  function updateArrowGeometry(el, m) {
    const tailSp = worldToScreen(m.x1 * state.naturalW, m.y1 * state.naturalH);
    const tipSp = worldToScreen(m.x2 * state.naturalW, m.y2 * state.naturalH);
    const dx = tipSp.x - tailSp.x, dy = tipSp.y - tailSp.y;
    const len = Math.hypot(dx, dy);
    const ux = len > 0 ? dx / len : 1;
    const uy = len > 0 ? dy / len : 0;

    // The arrowhead's size is fixed relative to map zoom only — never to the shaft's
    // length — so stretching the shaft never distorts or resizes the pointer.
    const headLen = ARROW_HEAD_LEN * state.scale;
    const headW = ARROW_HEAD_WIDTH * state.scale;
    const stroke = Math.max(1.5, ARROW_STROKE * state.scale);
    const pad = headW + stroke + 4;

    const minX = Math.min(tailSp.x, tipSp.x) - pad;
    const minY = Math.min(tailSp.y, tipSp.y) - pad;
    const maxX = Math.max(tailSp.x, tipSp.x) + pad;
    const maxY = Math.max(tailSp.y, tipSp.y) + pad;
    const boxW = Math.max(1, maxX - minX);
    const boxH = Math.max(1, maxY - minY);

    el.style.left = minX + 'px';
    el.style.top = minY + 'px';
    el.style.width = boxW + 'px';
    el.style.height = boxH + 'px';

    const tailLocal = { x: tailSp.x - minX, y: tailSp.y - minY };
    const tipLocal = { x: tipSp.x - minX, y: tipSp.y - minY };
    const shaftEnd = { x: tipLocal.x - ux * headLen * 0.6, y: tipLocal.y - uy * headLen * 0.6 };
    const backCenter = { x: tipLocal.x - ux * headLen, y: tipLocal.y - uy * headLen };
    const perpX = -uy, perpY = ux;
    const baseLeft = { x: backCenter.x + perpX * (headW / 2), y: backCenter.y + perpY * (headW / 2) };
    const baseRight = { x: backCenter.x - perpX * (headW / 2), y: backCenter.y - perpY * (headW / 2) };

    el.innerHTML = `<svg viewBox="0 0 ${boxW} ${boxH}" xmlns="http://www.w3.org/2000/svg">
      <line x1="${tailLocal.x}" y1="${tailLocal.y}" x2="${shaftEnd.x}" y2="${shaftEnd.y}" stroke="${m.color}" stroke-width="${stroke}" stroke-linecap="round"/>
      <polygon points="${tipLocal.x},${tipLocal.y} ${baseLeft.x},${baseLeft.y} ${baseRight.x},${baseRight.y}" fill="${m.color}" stroke="#14170f" stroke-width="1"/>
    </svg>`;

    if (m.label) {
      const midX = (tailLocal.x + tipLocal.x) / 2;
      const midY = (tailLocal.y + tipLocal.y) / 2;
      const labelDiv = document.createElement('div');
      labelDiv.className = 'marker-label';
      labelDiv.style.position = 'absolute';
      labelDiv.style.left = midX + 'px';
      labelDiv.style.top = midY + 'px';
      labelDiv.style.transform = 'translate(-50%, -50%)';
      labelDiv.textContent = m.label;
      el.appendChild(labelDiv);
    }
  }

  function attachMarkerDrag(el, m) {
    let dragging = false;
    let moved = false;
    let startClientX = 0, startClientY = 0;
    let startLeft = 0, startTop = 0;

    el.addEventListener('pointerdown', (e) => {
      if (!state.isMarshal) return;
      e.stopPropagation();
      e.preventDefault();
      dragging = true;
      moved = false;
      startClientX = e.clientX;
      startClientY = e.clientY;
      startLeft = parseFloat(el.style.left) || 0;
      startTop = parseFloat(el.style.top) || 0;
      el.setPointerCapture(e.pointerId);
    });

    el.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dxScreen = e.clientX - startClientX;
      const dyScreen = e.clientY - startClientY;
      if (Math.abs(dxScreen) > 5 || Math.abs(dyScreen) > 5) moved = true;
      if (moved) {
        // Marker position is plain screen pixels, so the cursor delta maps 1:1 — no scale
        // math needed, and it always tracks exactly from wherever it was grabbed.
        const newLeft = startLeft + dxScreen;
        const newTop = startTop + dyScreen;
        el.style.left = newLeft + 'px';
        el.style.top = newTop + 'px';
        const wp = viewportPxToWorld(newLeft, newTop);
        m.x = clamp01(wp.x / state.naturalW);
        m.y = clamp01(wp.y / state.naturalH);
      }
    });

    el.addEventListener('pointerup', (e) => {
      if (!state.isMarshal) return;
      dragging = false;
      selectMarker(m.id);
      saveSession();
    });
  }

  function clamp01(v) { return Math.max(0, Math.min(1, v)); }

  function attachArrowBodyDrag(el, m) {
    let dragging = false;
    let moved = false;
    let startClientX = 0, startClientY = 0;
    let startTailSp, startTipSp;

    el.addEventListener('pointerdown', (e) => {
      if (!state.isMarshal) return;
      e.stopPropagation();
      e.preventDefault();
      dragging = true;
      moved = false;
      startClientX = e.clientX;
      startClientY = e.clientY;
      startTailSp = worldToScreen(m.x1 * state.naturalW, m.y1 * state.naturalH);
      startTipSp = worldToScreen(m.x2 * state.naturalW, m.y2 * state.naturalH);
      el.setPointerCapture(e.pointerId);
    });

    el.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dxScreen = e.clientX - startClientX;
      const dyScreen = e.clientY - startClientY;
      if (Math.abs(dxScreen) > 5 || Math.abs(dyScreen) > 5) moved = true;
      if (moved) {
        const newTail = viewportPxToWorld(startTailSp.x + dxScreen, startTailSp.y + dyScreen);
        const newTip = viewportPxToWorld(startTipSp.x + dxScreen, startTipSp.y + dyScreen);
        m.x1 = clamp01(newTail.x / state.naturalW);
        m.y1 = clamp01(newTail.y / state.naturalH);
        m.x2 = clamp01(newTip.x / state.naturalW);
        m.y2 = clamp01(newTip.y / state.naturalH);
        updateArrowGeometry(el, m);
        updateArrowHandlePositions();
      }
    });

    el.addEventListener('pointerup', () => {
      if (!state.isMarshal) return;
      dragging = false;
      selectMarker(m.id);
      saveSession();
    });
  }

  function attachArrowHandleDrag(handleEl, m, which) {
    let dragging = false;
    let startClientX = 0, startClientY = 0;
    let startSp;

    handleEl.addEventListener('pointerdown', (e) => {
      if (!state.isMarshal) return;
      e.stopPropagation();
      e.preventDefault();
      dragging = true;
      startClientX = e.clientX;
      startClientY = e.clientY;
      startSp = which === 'tail'
        ? worldToScreen(m.x1 * state.naturalW, m.y1 * state.naturalH)
        : worldToScreen(m.x2 * state.naturalW, m.y2 * state.naturalH);
      handleEl.setPointerCapture(e.pointerId);
    });

    handleEl.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dxScreen = e.clientX - startClientX;
      const dyScreen = e.clientY - startClientY;
      const wp = viewportPxToWorld(startSp.x + dxScreen, startSp.y + dyScreen);
      const fx = clamp01(wp.x / state.naturalW);
      const fy = clamp01(wp.y / state.naturalH);
      if (which === 'tail') { m.x1 = fx; m.y1 = fy; } else { m.x2 = fx; m.y2 = fy; }
      const arrowEl = markerLayer.querySelector('.arrow-el[data-id="' + m.id + '"]');
      if (arrowEl) updateArrowGeometry(arrowEl, m);
      updateArrowHandlePositions();
    });

    handleEl.addEventListener('pointerup', () => {
      if (!state.isMarshal) return;
      dragging = false;
      saveSession();
    });
  }

  // The two round drag-handles for the currently selected arrow (tail + tip). Only one
  // arrow's handles exist at a time, recreated whenever selection or the marker list changes.
  let arrowHandles = null; // { tailEl, tipEl, arrowId } | null

  function refreshArrowHandles() {
    arrowHandles = null; // any previous handle DOM was already removed by markerLayer.innerHTML=''
    if (!state.isMarshal) return;
    const m = state.markers.find(x => x.id === state.selectedId);
    if (!m || m.kind !== 'arrow') return;
    const tailEl = document.createElement('div');
    tailEl.className = 'arrow-handle';
    const tipEl = document.createElement('div');
    tipEl.className = 'arrow-handle';
    markerLayer.appendChild(tailEl);
    markerLayer.appendChild(tipEl);
    attachArrowHandleDrag(tailEl, m, 'tail');
    attachArrowHandleDrag(tipEl, m, 'tip');
    arrowHandles = { tailEl, tipEl, arrowId: m.id };
    updateArrowHandlePositions();
  }

  function updateArrowHandlePositions() {
    if (!arrowHandles) return;
    const m = state.markers.find(x => x.id === arrowHandles.arrowId);
    if (!m) return;
    const tailSp = worldToScreen(m.x1 * state.naturalW, m.y1 * state.naturalH);
    const tipSp = worldToScreen(m.x2 * state.naturalW, m.y2 * state.naturalH);
    arrowHandles.tailEl.style.left = tailSp.x + 'px';
    arrowHandles.tailEl.style.top = tailSp.y + 'px';
    arrowHandles.tipEl.style.left = tipSp.x + 'px';
    arrowHandles.tipEl.style.top = tipSp.y + 'px';
  }

  function addMarker(type, x, y, opts) {
    const m = createMarkerData(type, clamp01(x), clamp01(y), opts);
    state.markers.push(m);
    renderMarkers();
    saveSession();
    return m;
  }

  function deleteMarker(id) {
    state.markers = state.markers.filter(m => m.id !== id);
    if (state.selectedId === id) state.selectedId = null;
    renderMarkers();
    hideEditPanel();
    saveSession();
  }

  function selectMarker(id) {
    state.selectedId = id;
    const m = state.markers.find(x => x.id === id);
    if (!m) { hideEditPanel(); return; }
    editName.value = m.label || '';
    editColor.value = m.color;
    editPanel.classList.remove('hidden');
    renderMarkers();
  }

  function hideEditPanel() {
    editPanel.classList.add('hidden');
    state.selectedId = null;
    renderMarkers();
  }

  editName.addEventListener('input', () => {
    const m = state.markers.find(x => x.id === state.selectedId);
    if (!m) return;
    m.label = editName.value;
    if (m.type === 'custom') m.letter = (m.label.trim()[0] || '?').toUpperCase();
    renderMarkers();
    saveSession();
  });

  editColor.addEventListener('input', () => {
    const m = state.markers.find(x => x.id === state.selectedId);
    if (!m) return;
    m.color = editColor.value;
    renderMarkers();
    saveSession();
  });

  editDelete.addEventListener('click', () => {
    if (state.selectedId) deleteMarker(state.selectedId);
  });

  editClose.addEventListener('click', hideEditPanel);

  viewport.addEventListener('pointerdown', (e) => {
    if (e.target === viewport || e.target === world || e.target === baseMap ||
        e.target === maskDefault || e.target === maskExtended || e.target === markerLayer) {
      hideEditPanel();
    }
  });

  /* ============================== PALETTE DRAG-TO-PLACE ============================== */

  let pendingCustomDrop = null; // {x,y} awaiting name modal

  function startPaletteDrag(type, startEvent) {
    startEvent.preventDefault();
    const def = TYPE_DEFS[type];
    const ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    let previewColor = type === 'custom' ? customColorInput.value : colorForNewOfType(type);
    if (type === 'arrow') ghost.innerHTML = arrowPreviewSVG(previewColor);
    else ghost.innerHTML = type === 'flag' ? flagSVG(previewColor) : pinSVG(previewColor, def.letter || '?');
    document.body.appendChild(ghost);

    const move = (e) => {
      ghost.style.left = e.clientX + 'px';
      ghost.style.top = e.clientY + 'px';
    };
    move(startEvent);

    const up = (e) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      ghost.remove();

      const r = viewport.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (!inside) return;

      const wp = screenToWorld(e.clientX, e.clientY);
      const fx = clamp01(wp.x / state.naturalW);
      const fy = clamp01(wp.y / state.naturalH);

      if (type === 'custom') {
        pendingCustomDrop = { x: fx, y: fy, color: customColorInput.value };
        nameModalInput.value = '';
        nameModal.classList.remove('hidden');
        setTimeout(() => nameModalInput.focus(), 50);
      } else if (type === 'arrow') {
        const x2 = clamp01(fx + ARROW_DEFAULT_LEN_WORLD / state.naturalW);
        const newArrow = addArrow(fx, fy, x2, fy);
        selectMarker(newArrow.id);
      } else {
        addMarker(type, fx, fy);
      }
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  document.querySelectorAll('.palette-item').forEach(item => {
    item.addEventListener('pointerdown', (e) => {
      const type = item.getAttribute('data-type');
      startPaletteDrag(type, e);
    });
  });

  nameModalConfirm.addEventListener('click', () => {
    const name = nameModalInput.value.trim() || 'Marker';
    if (pendingCustomDrop) {
      addMarker('custom', pendingCustomDrop.x, pendingCustomDrop.y, { label: name, color: pendingCustomDrop.color });
      pendingCustomDrop = null;
    }
    nameModal.classList.add('hidden');
  });

  nameModalCancel.addEventListener('click', () => {
    pendingCustomDrop = null;
    nameModal.classList.add('hidden');
  });

  nameModalInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') nameModalConfirm.click();
    if (e.key === 'Escape') nameModalCancel.click();
  });

  /* ============================== PAN / ZOOM (viewport) ============================== */

  const activePointers = new Map();
  let panLast = null;
  let pinchStartDist = null;
  let pinchStartScale = null;

  function dist(p1, p2) { return Math.hypot(p1.x - p2.x, p1.y - p2.y); }
  function midpoint(p1, p2) { return { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }; }

  viewport.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.marker') || e.target.closest('.zoom-controls')) return;
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    viewport.setPointerCapture(e.pointerId);
    if (activePointers.size === 1) {
      panLast = { x: e.clientX, y: e.clientY };
    } else if (activePointers.size === 2) {
      const pts = Array.from(activePointers.values());
      pinchStartDist = dist(pts[0], pts[1]);
      pinchStartScale = state.scale;
    }
  });

  viewport.addEventListener('pointermove', (e) => {
    if (!activePointers.has(e.pointerId)) return;
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointers.size === 1 && panLast) {
      const dx = e.clientX - panLast.x;
      const dy = e.clientY - panLast.y;
      state.tx += dx;
      state.ty += dy;
      panLast = { x: e.clientX, y: e.clientY };
      applyTransform();
    } else if (activePointers.size === 2) {
      const pts = Array.from(activePointers.values());
      const d = dist(pts[0], pts[1]);
      const mid = midpoint(pts[0], pts[1]);
      if (pinchStartDist) {
        const factor = d / pinchStartDist;
        const targetScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, pinchStartScale * factor));
        const r = viewport.getBoundingClientRect();
        const cx = mid.x - r.left, cy = mid.y - r.top;
        const worldPt = { x: (cx - state.tx) / state.scale, y: (cy - state.ty) / state.scale };
        state.tx = cx - worldPt.x * targetScale;
        state.ty = cy - worldPt.y * targetScale;
        state.scale = targetScale;
        applyTransform();
      }
    }
  });

  function endPointer(e) {
    activePointers.delete(e.pointerId);
    if (activePointers.size < 2) { pinchStartDist = null; }
    if (activePointers.size === 0) { panLast = null; }
    else if (activePointers.size === 1) {
      const p = Array.from(activePointers.values())[0];
      panLast = { x: p.x, y: p.y };
    }
  }
  viewport.addEventListener('pointerup', endPointer);
  viewport.addEventListener('pointercancel', endPointer);

  viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    zoomBy(factor, e.clientX, e.clientY);
  }, { passive: false });

  zoomFitBtn.addEventListener('click', () => fitToBBox(state.bbox[state.area]));

  areaSelect.addEventListener('change', () => setArea(areaSelect.value));
  tintToggle.addEventListener('change', () => { state.tintOn = tintToggle.checked; updateTintVisibility(); });

  /* ---------- Rules panel ---------- */
  btnRulesToggle.addEventListener('click', () => rulesPanel.classList.toggle('open'));
  btnRulesClose.addEventListener('click', () => rulesPanel.classList.remove('open'));
  rulesTextarea.addEventListener('input', () => {
    state.rules = rulesTextarea.value;
    saveSession();
  });

  window.addEventListener('resize', () => fitToBBox(state.bbox[state.area]));

  /* ============================== SAVE / LOAD / EXPORT / IMPORT ============================== */
  // Save/Load now read and write the shared `shared_layouts` Supabase table, so any
  // logged-in marshal sees and can edit every game mode — no export/import needed to
  // hand a layout to another marshal anymore.

  function currentLayoutObject() {
    return {
      name: state.layoutName,
      area: state.area,
      rules: state.rules,
      markers: state.markers.map(m => ({ ...m })),
    };
  }

  function saveSession() {
    try { sessionStorageSafeSet(currentLayoutObject()); } catch (e) { /* ignore */ }
  }
  function sessionStorageSafeSet(obj) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(obj));
  }
  function loadSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch (e) { return null; }
  }

  function applyLayoutObject(layout) {
    state.layoutName = layout.name || 'Untitled layout';
    layoutNameInput.value = state.layoutName;
    state.rules = layout.rules || '';
    rulesTextarea.value = state.rules;
    state.markers = (layout.markers || []).map(m => ({ ...m }));
    let maxId = 0;
    state.markers.forEach(m => {
      const n = parseInt(String(m.id).replace(/\D/g, ''), 10);
      if (!isNaN(n) && n > maxId) maxId = n;
    });
    idCounter = maxId + 1;
    state.selectedId = null;
    hideEditPanel();
    setArea(layout.area === 'extended' ? 'extended' : 'default');
    renderMarkers();
    saveSession();
  }

  btnSave.addEventListener('click', async () => {
    if (!sb) { alert('Cannot save to the shared library — the login service failed to load. Try reloading the page.'); return; }
    state.layoutName = layoutNameInput.value.trim() || 'Untitled layout';
    btnSave.disabled = true;
    try {
      const { data: userData } = await sb.auth.getUser();
      const uid = userData && userData.user && userData.user.id;
      const { error } = await sb.from('shared_layouts').upsert({
        name: state.layoutName,
        layout: currentLayoutObject(),
        created_by: uid || null,
        updated_by: uid || null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'name' });
      if (error) {
        alert('Could not save: ' + error.message);
      } else {
        saveSession();
        flashButton(btnSave, 'Saved ✓');
      }
    } catch (e) {
      alert('Could not save — check your connection and try again.');
    } finally {
      btnSave.disabled = false;
    }
  });

  function flashButton(btn, text) {
    const original = btn.textContent;
    btn.textContent = text;
    setTimeout(() => { btn.textContent = original; }, 1200);
  }

  async function renderLoadMenu() {
    loadMenu.innerHTML = '<div class="dropdown-empty">Loading…</div>';
    if (!sb) {
      loadMenu.innerHTML = '<div class="dropdown-empty">Unavailable — the login service failed to load.</div>';
      return;
    }
    const { data, error } = await sb
      .from('shared_layouts')
      .select('id, name, updated_at')
      .order('name', { ascending: true });

    if (error) {
      loadMenu.innerHTML = '<div class="dropdown-empty">Could not load the shared library.</div>';
      return;
    }

    loadMenu.innerHTML = '';
    if (!data || data.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'dropdown-empty';
      empty.textContent = 'No shared game modes yet.';
      loadMenu.appendChild(empty);
      return;
    }

    data.forEach(row => {
      const rowEl = document.createElement('div');
      rowEl.className = 'dropdown-item';
      const label = document.createElement('span');
      label.textContent = row.name;
      label.addEventListener('click', async () => {
        loadMenu.classList.add('hidden');
        const { data: full, error: fetchErr } = await sb
          .from('shared_layouts')
          .select('layout')
          .eq('id', row.id)
          .maybeSingle();
        if (fetchErr || !full) {
          alert('Could not load that layout.');
          return;
        }
        applyLayoutObject(full.layout);
      });
      const del = document.createElement('span');
      del.className = 'del';
      del.textContent = 'Remove';
      del.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm('Remove "' + row.name + '" for everyone? This cannot be undone.')) return;
        const { error: delErr } = await sb.from('shared_layouts').delete().eq('id', row.id);
        if (delErr) { alert('Could not remove: ' + delErr.message); return; }
        renderLoadMenu();
      });
      rowEl.appendChild(label);
      rowEl.appendChild(del);
      loadMenu.appendChild(rowEl);
    });
  }

  btnLoadToggle.addEventListener('click', () => {
    const wasHidden = loadMenu.classList.contains('hidden');
    if (wasHidden) {
      const r = btnLoadToggle.getBoundingClientRect();
      loadMenu.style.top = (r.bottom + 6) + 'px';
      loadMenu.style.left = r.left + 'px';
      loadMenu.classList.remove('hidden');
      renderLoadMenu();
    } else {
      loadMenu.classList.add('hidden');
    }
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.dropdown-wrap')) loadMenu.classList.add('hidden');
  });

  btnNew.addEventListener('click', () => {
    if ((state.markers.length || state.rules) && !confirm('Start a new layout? Unsaved changes to the current one will be lost unless already saved.')) return;
    state.layoutName = 'Untitled layout';
    layoutNameInput.value = state.layoutName;
    state.markers = [];
    state.rules = '';
    rulesTextarea.value = '';
    state.selectedId = null;
    hideEditPanel();
    renderMarkers();
    saveSession();
  });

  btnExport.addEventListener('click', () => {
    const layout = currentLayoutObject();
    const blob = new Blob([JSON.stringify(layout, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeName = (layout.name || 'layout').replace(/[^a-z0-9_\-]+/gi, '_');
    a.href = url;
    a.download = `${safeName}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  btnImport.addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', () => {
    const file = importFile.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const layout = JSON.parse(reader.result);
        applyLayoutObject(layout);
      } catch (e) {
        alert('Could not read that file — it does not look like a valid layout export.');
      }
      importFile.value = '';
    };
    reader.readAsText(file);
  });

  /* ============================== SUPABASE (marshal login / live briefing) ============================== */

  const SUPABASE_URL = 'https://kjbzmjombtqciljlewvu.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtqYnptam9tYnRxY2lsamxld3Z1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1Njc0NDMsImV4cCI6MjA5NTE0MzQ0M30.JfvLhxgcZkcPptRjDHgVneGr0PHRWHc76NFTpkp7q78';
  const BRIEFING_ID = 'default';

  // If the Supabase CDN script fails to load (slow/blocked network, ad-blocker, outage),
  // the core map planner must still work fully offline/local — only the marshal-login and
  // live-briefing features become unavailable for that session.
  let sb = null;
  if (window.supabase && typeof window.supabase.createClient === 'function') {
    try {
      sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    } catch (e) {
      console.error('[FieldPlanner] Failed to initialize Supabase client:', e);
    }
  } else {
    console.error('[FieldPlanner] Supabase SDK did not load — marshal login and the live briefing view are unavailable this session. The map planner itself still works normally.');
  }

  function setMarshalMode(isMarshal, email) {
    state.isMarshal = isMarshal;
    document.body.classList.toggle('viewer-mode', !isMarshal);
    rulesTextarea.readOnly = !isMarshal;
    btnMarshalLogin.classList.toggle('hidden', isMarshal);
    btnMarshalLogout.classList.toggle('hidden', !isMarshal);
    marshalEmail.classList.toggle('hidden', !isMarshal);
    marshalEmail.textContent = isMarshal ? (email || '') : '';
    if (isMarshal) {
      state.selectedId = null;
      renderMarkers();
    }
  }

  async function refreshAuthUI() {
    if (!sb) return false;
    try {
      const { data } = await sb.auth.getSession();
      const session = data && data.session;
      setMarshalMode(!!session, session && session.user && session.user.email);
      return !!session;
    } catch (e) {
      console.error('[FieldPlanner] Could not check marshal session:', e);
      return false;
    }
  }

  if (sb) {
    sb.auth.onAuthStateChange((_event, session) => {
      setMarshalMode(!!session, session && session.user && session.user.email);
    });
  } else {
    btnMarshalLogin.disabled = true;
    btnMarshalLogin.title = 'Marshal login is unavailable right now — the login service failed to load.';
  }

  btnMarshalLogin.addEventListener('click', () => {
    if (!sb) {
      alert('Marshal login is unavailable right now (the login service failed to load). Try reloading the page, or check your connection.');
      return;
    }
    loginError.classList.add('hidden');
    loginEmail.value = '';
    loginPassword.value = '';
    loginModal.classList.remove('hidden');
    setTimeout(() => loginEmail.focus(), 50);
  });

  loginCancel.addEventListener('click', () => loginModal.classList.add('hidden'));

  loginSubmit.addEventListener('click', async () => {
    if (!sb) return;
    loginError.classList.add('hidden');
    const email = loginEmail.value.trim();
    const password = loginPassword.value;
    if (!email || !password) return;
    loginSubmit.disabled = true;
    try {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) {
        loginError.textContent = error.message;
        loginError.classList.remove('hidden');
        return;
      }
      loginModal.classList.add('hidden');
    } catch (e) {
      loginError.textContent = 'Could not reach the login service. Check your connection and try again.';
      loginError.classList.remove('hidden');
    } finally {
      loginSubmit.disabled = false;
    }
  });

  loginPassword.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loginSubmit.click();
  });

  btnMarshalLogout.addEventListener('click', () => { if (sb) sb.auth.signOut(); });

  btnPublish.addEventListener('click', async () => {
    if (!sb) { alert('Cannot publish — the login service failed to load. Try reloading the page.'); return; }
    btnPublish.disabled = true;
    const original = btnPublish.textContent;
    try {
      const { data: userData } = await sb.auth.getUser();
      const uid = userData && userData.user && userData.user.id;
      const { error } = await sb.from('field_briefing').upsert({
        id: BRIEFING_ID,
        layout: currentLayoutObject(),
        updated_by: uid || null,
        updated_at: new Date().toISOString(),
      });
      if (error) {
        alert('Could not publish: ' + error.message);
      } else {
        btnPublish.textContent = 'Published ✓';
        setTimeout(() => { btnPublish.textContent = original; }, 1500);
      }
    } catch (e) {
      alert('Could not publish — check your connection and try again.');
    } finally {
      btnPublish.disabled = false;
    }
  });

  async function loadLiveBriefingForViewer() {
    if (!sb) return false;
    try {
      const { data, error } = await sb
        .from('field_briefing')
        .select('layout, updated_at')
        .eq('id', BRIEFING_ID)
        .maybeSingle();
      if (!error && data && data.layout) {
        applyLayoutObject(data.layout);
        liveIndicator.classList.remove('hidden');
        return true;
      }
      return false;
    } catch (e) {
      console.error('[FieldPlanner] Could not load the live briefing:', e);
      return false;
    }
  }

  function subscribeLiveBriefing() {
    if (!sb) return;
    try {
      sb.channel('field_briefing_' + BRIEFING_ID)
        .on('postgres_changes',
          { event: '*', schema: 'public', table: 'field_briefing', filter: 'id=eq.' + BRIEFING_ID },
          (payload) => {
            // Only auto-apply for viewers — a logged-in marshal is working on their own
            // draft and shouldn't have it silently overwritten by someone else's publish.
            if (!state.isMarshal && payload.new && payload.new.layout) {
              applyLayoutObject(payload.new.layout);
              liveIndicator.classList.remove('hidden');
            }
          })
        .subscribe();
    } catch (e) {
      console.error('[FieldPlanner] Could not subscribe to live briefing updates:', e);
    }
  }

  /* ============================== INIT ============================== */

  async function init() {
    // Wait for base image to know natural dimensions
    await new Promise(resolve => {
      if (baseMap.complete && baseMap.naturalWidth) resolve();
      else baseMap.onload = resolve;
    });
    state.naturalW = baseMap.naturalWidth;
    state.naturalH = baseMap.naturalHeight;
    world.style.width = state.naturalW + 'px';
    world.style.height = state.naturalH + 'px';

    const [dBox, eBox] = await Promise.all([
      computeAlphaBBox('assets/default_map.png'),
      computeAlphaBBox('assets/extended_map.png'),
    ]);
    state.bbox.default = dBox;
    state.bbox.extended = eBox;

    // Independently verify the CSS mask-image sources (separate from the JS bbox loader above)
    // resolve, since a wrong path here would hide the tint even if the bbox load succeeded.
    checkMaskCssLoad(maskDefault, 'assets/default_map.png');
    checkMaskCssLoad(maskExtended, 'assets/extended_map.png');

    const isMarshal = await refreshAuthUI();

    if (isMarshal) {
      const session = loadSession();
      if (session && session.markers && session.markers.length) {
        applyLayoutObject(session);
      } else {
        setArea('default');
      }
    } else {
      const gotBriefing = await loadLiveBriefingForViewer();
      if (!gotBriefing) setArea('default');
    }

    applyTransform();
    subscribeLiveBriefing();
  }

  init();
})();
