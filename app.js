(() => {
  'use strict';

  /* ============================== CONFIG ============================== */

  const STORAGE_KEY = 'fieldPlannerLayouts.v1';
  const SESSION_KEY = 'fieldPlannerSession.v1';

  const FLAG_COLORS = ['#d43b3b', '#e0c23e', '#3f7fd4', '#3fb35c']; // red, yellow, blue, green — the default auto-cycle for every marker type

  const TYPE_DEFS = {
    start:   { label: 'Starting Point', letter: 'S', kind: 'pin' },
    respawn: { label: 'Respawn Point',  letter: 'R', kind: 'pin' },
    mortar:  { label: 'Mortar',         letter: 'M', kind: 'pin' },
    flag:    { label: 'Flag',           kind: 'flag' },
    custom:  { label: 'Custom Marker',  kind: 'pin' },
  };

  const MIN_SCALE = 0.15;
  const MAX_SCALE = 6;

  /* ============================== STATE ============================== */

  const state = {
    area: 'default',           // 'default' | 'extended'
    markers: [],                // {id,type,label,color,letter,kind,x,y} x/y are fractions 0..1
    layoutName: 'Untitled layout',
    selectedId: null,
    scale: 1,
    tx: 0,
    ty: 0,
    naturalW: 0,
    naturalH: 0,
    bbox: { default: null, extended: null }, // {minX,minY,maxX,maxY} in natural px
    tintOn: true,
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

  const editPanel = document.getElementById('editPanel');
  const editName = document.getElementById('editName');
  const editColor = document.getElementById('editColor');
  const editDelete = document.getElementById('editDelete');
  const editClose = document.getElementById('editClose');

  const nameModal = document.getElementById('nameModal');
  const nameModalInput = document.getElementById('nameModalInput');
  const nameModalCancel = document.getElementById('nameModalCancel');
  const nameModalConfirm = document.getElementById('nameModalConfirm');

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

  // Populate static palette icons (preview only — actual color is assigned per the cycle at drop time)
  document.querySelectorAll('.palette-icon').forEach(el => {
    const kind = el.getAttribute('data-icon');
    let svg;
    if (kind === 'flag') svg = flagSVG(FLAG_COLORS[0]);
    else if (kind === 'custom') svg = pinSVG(customColorInput.value, '?');
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
      const sp = worldToScreen(m.x * state.naturalW, m.y * state.naturalH);
      el.style.left = sp.x + 'px';
      el.style.top = sp.y + 'px';
      el.style.width = w + 'px';
      el.style.height = h + 'px';
      el.style.marginLeft = (-w / 2) + 'px';
      el.style.marginTop = (-h * 0.929) + 'px'; // keeps the pin's tip anchored at (sp.x, sp.y)
    }
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

  function renderMarkers() {
    markerLayer.innerHTML = '';
    state.markers.forEach(m => {
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
      markerLayer.appendChild(el);
    });
    updateMarkerPositions();
  }

  function attachMarkerDrag(el, m) {
    let dragging = false;
    let moved = false;
    let startClientX = 0, startClientY = 0;
    let startLeft = 0, startTop = 0;

    el.addEventListener('pointerdown', (e) => {
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
      dragging = false;
      selectMarker(m.id);
      saveSession();
    });
  }

  function clamp01(v) { return Math.max(0, Math.min(1, v)); }

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
    editName.value = m.label;
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
    m.label = editName.value || m.label;
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
    ghost.innerHTML = type === 'flag' ? flagSVG(previewColor) : pinSVG(previewColor, def.letter || '?');
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

  window.addEventListener('resize', () => fitToBBox(state.bbox[state.area]));

  /* ============================== SAVE / LOAD / EXPORT / IMPORT ============================== */

  function readLayouts() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
    catch (e) { return {}; }
  }
  function writeLayouts(obj) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  }

  function currentLayoutObject() {
    return {
      name: state.layoutName,
      area: state.area,
      markers: state.markers.map(({ id, type, kind, color, letter, label, x, y }) => ({ id, type, kind, color, letter, label, x, y })),
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

  btnSave.addEventListener('click', () => {
    state.layoutName = layoutNameInput.value.trim() || 'Untitled layout';
    const layouts = readLayouts();
    layouts[state.layoutName] = currentLayoutObject();
    writeLayouts(layouts);
    saveSession();
    flashButton(btnSave, 'Saved ✓');
  });

  function flashButton(btn, text) {
    const original = btn.textContent;
    btn.textContent = text;
    setTimeout(() => { btn.textContent = original; }, 1200);
  }

  function renderLoadMenu() {
    const layouts = readLayouts();
    const names = Object.keys(layouts);
    loadMenu.innerHTML = '';
    if (names.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'dropdown-empty';
      empty.textContent = 'No saved layouts yet.';
      loadMenu.appendChild(empty);
      return;
    }
    names.forEach(name => {
      const row = document.createElement('div');
      row.className = 'dropdown-item';
      const label = document.createElement('span');
      label.textContent = name;
      label.addEventListener('click', () => {
        applyLayoutObject(layouts[name]);
        loadMenu.classList.add('hidden');
      });
      const del = document.createElement('span');
      del.className = 'del';
      del.textContent = 'Remove';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        const all = readLayouts();
        delete all[name];
        writeLayouts(all);
        renderLoadMenu();
      });
      row.appendChild(label);
      row.appendChild(del);
      loadMenu.appendChild(row);
    });
  }

  btnLoadToggle.addEventListener('click', () => {
    renderLoadMenu();
    const wasHidden = loadMenu.classList.contains('hidden');
    if (wasHidden) {
      const r = btnLoadToggle.getBoundingClientRect();
      loadMenu.style.top = (r.bottom + 6) + 'px';
      loadMenu.style.left = r.left + 'px';
    }
    loadMenu.classList.toggle('hidden');
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.dropdown-wrap')) loadMenu.classList.add('hidden');
  });

  btnNew.addEventListener('click', () => {
    if (state.markers.length && !confirm('Start a new layout? Unsaved changes to the current one will be lost unless already saved.')) return;
    state.layoutName = 'Untitled layout';
    layoutNameInput.value = state.layoutName;
    state.markers = [];
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

    const session = loadSession();
    if (session && session.markers && session.markers.length) {
      applyLayoutObject(session);
    } else {
      setArea('default');
    }

    applyTransform();
  }

  init();
})();
