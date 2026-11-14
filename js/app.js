/* ============================================================
   TrendScope — application wiring
   Map, variable picker, single/compare modes, verdict panel,
   and the "where is it changing?" regional grid scan.
   ============================================================ */

(() => {
  'use strict';

  /* ---------- state ---------- */
  const state = {
    mode: 'single',            // 'single' | 'compare'
    variable: 'T2M',
    activeSlot: 0,             // which location the next map click sets
    locations: [null, null],   // {lat, lon, label?}
    results: [null, null],     // {series, trend}
    markers: [null, null],
    gridLayer: null,
    gridAbort: null,
    fetchAbort: null
  };

  const SLOT_COLORS = ['var(--series-1)', 'var(--series-2)'];
  const SLOT_VARS = ['--series-1', '--series-2'];

  /* ---------- preset comparison stories ---------- */
  const PRESETS = [
    {
      title: 'Arctic amplification',
      desc: 'The Arctic is warming far faster than the mid-latitudes. Same planet, same variable, very different trends.',
      variable: 'T2M',
      a: { lat: 78.22, lon: 15.63, label: 'Svalbard, Arctic' },
      b: { lat: 33.75, lon: -84.39, label: 'Atlanta, USA' }
    },
    {
      title: 'Wetter here, drier there',
      desc: 'A warming atmosphere moves water around: some regions dry out while others get wetter.',
      variable: 'PRECTOTCORR',
      a: { lat: 37.98, lon: 23.73, label: 'Athens, Greece' },
      b: { lat: 13.51, lon: 2.11, label: 'Niamey, Niger' }
    },
    {
      title: 'Dimming vs. brightening',
      desc: 'Aerosol pollution can dim sunlight at the surface; clean-air policies can brighten it. Solar trends diverge by region.',
      variable: 'ALLSKY_SFC_SW_DWN',
      a: { lat: 28.61, lon: 77.21, label: 'Delhi, India' },
      b: { lat: 52.52, lon: 13.40, label: 'Berlin, Germany' }
    },
    {
      title: 'Drying soils of the Southwest',
      desc: 'Root-zone soil moisture — the water plants actually use — tells the megadrought story.',
      variable: 'GWETROOT',
      a: { lat: 34.05, lon: -111.09, label: 'Central Arizona, USA' },
      b: { lat: 40.42, lon: -82.91, label: 'Ohio, USA' }
    }
  ];

  /* ---------- dom ---------- */
  const $ = sel => document.querySelector(sel);
  const resultsEl = $('#results');
  const statusEl = $('#status');

  /* ---------- map ---------- */
  const map = L.map('map', { worldCopyJump: true, minZoom: 2 }).setView([25, 10], 2);

  const blueMarble = L.tileLayer(
    'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg',
    { attribution: 'Imagery: NASA GIBS / Blue Marble', maxNativeZoom: 8, maxZoom: 10 }
  );
  const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors', maxZoom: 12
  });
  const labels = L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png',
    { attribution: '&copy; CARTO', maxZoom: 12, pane: 'shadowPane' }
  );
  blueMarble.addTo(map);
  labels.addTo(map);
  L.control.layers(
    { 'NASA Blue Marble': blueMarble, 'OpenStreetMap': osm },
    { 'Place labels': labels },
    { position: 'bottomright' }
  ).addTo(map);

  map.on('click', e => {
    const lat = +e.latlng.lat.toFixed(3);
    let lon = e.latlng.lng;
    while (lon > 180) lon -= 360;
    while (lon < -180) lon += 360;
    lon = +lon.toFixed(3);
    setLocation(state.activeSlot, { lat, lon });
    if (state.mode === 'compare') {
      // alternate slots so two clicks set A then B
      state.activeSlot = state.activeSlot === 0 ? 1 : 0;
      updateSlotChips();
    }
    runAnalysis();
  });

  function fmtCoord(lat, lon) {
    return `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E' : 'W'}`;
  }

  function locationLabel(loc) {
    return loc.label ? `${loc.label} (${fmtCoord(loc.lat, loc.lon)})` : fmtCoord(loc.lat, loc.lon);
  }

  function setLocation(slot, loc) {
    state.locations[slot] = loc;
    state.results[slot] = null;
    if (state.markers[slot]) map.removeLayer(state.markers[slot]);
    const letter = state.mode === 'compare' ? (slot === 0 ? 'A' : 'B') : '●';
    const icon = L.divIcon({
      className: '',
      html: `<div class="loc-marker loc-marker-${slot}">${letter}</div>`,
      iconSize: [28, 28], iconAnchor: [14, 14]
    });
    state.markers[slot] = L.marker([loc.lat, loc.lon], { icon }).addTo(map);
  }

  function clearSlot(slot) {
    state.locations[slot] = null;
    state.results[slot] = null;
    if (state.markers[slot]) { map.removeLayer(state.markers[slot]); state.markers[slot] = null; }
  }

  /* ---------- UI: variable picker ---------- */
  const varSelect = $('#var-select');
  (function buildVarPicker() {
    const groups = {};
    for (const v of PowerAPI.VARIABLES) {
      (groups[v.group] = groups[v.group] || []).push(v);
    }
    for (const [group, vars] of Object.entries(groups)) {
      const og = document.createElement('optgroup');
      og.label = group;
      for (const v of vars) {
        const opt = document.createElement('option');
        opt.value = v.id;
        opt.textContent = `${v.name} (${v.units})`;
        og.appendChild(opt);
      }
      varSelect.appendChild(og);
    }
    varSelect.value = state.variable;
  })();

  varSelect.addEventListener('change', () => {
    state.variable = varSelect.value;
    const v = PowerAPI.getVariable(state.variable);
    $('#var-blurb').textContent = v.blurb;
    clearGrid();
    runAnalysis();
  });
  $('#var-blurb').textContent = PowerAPI.getVariable(state.variable).blurb;

  /* ---------- UI: mode toggle & slot chips ---------- */
  const modeBtns = document.querySelectorAll('[data-mode]');
  modeBtns.forEach(btn => btn.addEventListener('click', () => {
    const mode = btn.dataset.mode;
    if (mode === state.mode) return;
    state.mode = mode;
    modeBtns.forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    $('#slot-chips').style.display = mode === 'compare' ? 'flex' : 'none';
    if (mode === 'single') {
      clearSlot(1);
      state.activeSlot = 0;
    } else if (state.locations[0]) {
      // re-render marker A with its letter
      setLocation(0, state.locations[0]);
      state.activeSlot = state.locations[1] ? 0 : 1;
    }
    updateSlotChips();
    runAnalysis();
  }));

  const slotChips = document.querySelectorAll('[data-slot]');
  slotChips.forEach(chip => chip.addEventListener('click', () => {
    state.activeSlot = +chip.dataset.slot;
    updateSlotChips();
  }));

  function updateSlotChips() {
    slotChips.forEach(chip => {
      const slot = +chip.dataset.slot;
      chip.classList.toggle('active', slot === state.activeSlot);
      const loc = state.locations[slot];
      chip.querySelector('.chip-loc').textContent = loc ? fmtCoord(loc.lat, loc.lon) : 'click map…';
    });
  }

  /* ---------- UI: presets ---------- */
  const presetsEl = $('#presets');
  PRESETS.forEach(p => {
    const btn = document.createElement('button');
    btn.className = 'preset-btn';
    btn.innerHTML = `<strong>${p.title}</strong><span>${p.desc}</span>`;
    btn.addEventListener('click', () => loadPreset(p));
    presetsEl.appendChild(btn);
  });

  function loadPreset(p) {
    state.mode = 'compare';
    modeBtns.forEach(b => b.classList.toggle('active', b.dataset.mode === 'compare'));
    $('#slot-chips').style.display = 'flex';
    state.variable = p.variable;
    varSelect.value = p.variable;
    $('#var-blurb').textContent = PowerAPI.getVariable(p.variable).blurb;
    clearGrid();
    setLocation(0, p.a);
    setLocation(1, p.b);
    state.activeSlot = 0;
    updateSlotChips();
    const bounds = L.latLngBounds([[p.a.lat, p.a.lon], [p.b.lat, p.b.lon]]).pad(0.3);
    map.fitBounds(bounds, { maxZoom: 4 });
    runAnalysis();
  }

  /* ---------- analysis ---------- */
  async function runAnalysis() {
    if (state.fetchAbort) state.fetchAbort.abort();
    const slots = state.mode === 'compare' ? [0, 1] : [0];
    const active = slots.filter(s => state.locations[s]);
    if (active.length === 0) {
      resultsEl.innerHTML = `<div class="placeholder">
        <p><strong>Click anywhere on the map</strong> to pull four decades of NASA data for that spot — or load one of the comparison stories on the left.</p>
      </div>`;
      return;
    }
    const ctrl = new AbortController();
    state.fetchAbort = ctrl;
    const v = PowerAPI.getVariable(state.variable);
    setStatus(`Fetching ${v.name} from NASA POWER…`, 'busy');
    resultsEl.innerHTML = `<div class="placeholder"><div class="spinner"></div><p>Contacting NASA POWER for ${active.length === 2 ? 'two locations' : locationLabel(state.locations[active[0]])}…</p></div>`;

    try {
      await Promise.all(active.map(async slot => {
        const loc = state.locations[slot];
        const series = await PowerAPI.fetchSeries(state.variable, loc.lat, loc.lon, { signal: ctrl.signal });
        const trend = TrendStats.analyze(series.years, series.values);
        state.results[slot] = { series, trend };
      }));
      if (ctrl.signal.aborted) return;
      renderResults(active);
      setStatus('', 'idle');
    } catch (err) {
      if (err.name === 'AbortError') return;
      setStatus('', 'idle');
      resultsEl.innerHTML = `<div class="placeholder error"><p><strong>Could not fetch data.</strong> ${escapeHtml(err.message)}</p><p class="hint">Points over open ocean work for most variables; soil moisture needs land. Try another spot or variable.</p></div>`;
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ---------- rendering ---------- */
  function directionWord(trend, varId) {
    if (!trend.significant) return 'No significant trend';
    const up = trend.direction === 'up';
    if (varId.startsWith('T2M') || varId === 'TS') return up ? 'Warming' : 'Cooling';
    if (varId === 'PRECTOTCORR') return up ? 'Getting wetter' : 'Getting drier';
    if (varId === 'GWETROOT') return up ? 'Soils getting wetter' : 'Soils drying out';
    if (varId === 'ALLSKY_SFC_SW_DWN') return up ? 'Brightening' : 'Dimming';
    return up ? 'Increasing' : 'Decreasing';
  }

  function pFmt(p) {
    if (p < 0.0001) return 'p &lt; 0.0001';
    return 'p = ' + p.toPrecision(2);
  }

  function verdictCard(slot, letter) {
    const { series, trend } = state.results[slot];
    const v = PowerAPI.getVariable(state.variable);
    const loc = state.locations[slot];
    const dir = directionWord(trend, state.variable);
    const dirClass = !trend.significant ? 'dir-none' : (trend.direction === 'up' ? 'dir-up' : 'dir-down');
    const arrow = !trend.significant ? '→' : (trend.direction === 'up' ? '↗' : '↘');
    const sign = trend.slopePerDecade >= 0 ? '+' : '−';
    const absSlope = Math.abs(trend.slopePerDecade);
    const absTotal = Math.abs(trend.totalChange);
    const d = v.decimals;

    const sigBadge = trend.significant
      ? `<span class="sig-badge sig-yes" title="Mann–Kendall test">✓ Statistically significant (${pFmt(trend.mk.p)}, below α = 0.05)</span>`
      : `<span class="sig-badge sig-no" title="Mann–Kendall test">○ Not statistically significant (${pFmt(trend.mk.p)}, above α = 0.05)</span>`;

    return `
      <article class="verdict-card">
        <header>
          ${letter ? `<span class="slot-dot slot-dot-${slot}">${letter}</span>` : ''}
          <div>
            <h3>${escapeHtml(locationLabel(loc))}</h3>
            <p class="card-sub">${escapeHtml(series.longname)} · ${series.years[0]}–${series.years[series.years.length - 1]} · ${trend.n} yearly values</p>
          </div>
        </header>
        <div class="verdict-line ${dirClass}">
          <span class="verdict-arrow">${arrow}</span>
          <span class="verdict-word">${dir}</span>
        </div>
        <div class="chart-wrap" id="chart-${slot}"></div>
        <dl class="stats-grid">
          <div><dt>Sen's slope (rate)</dt><dd>${sign}${TrendChart.fmt(absSlope, d)} ${series.units}/decade</dd></div>
          <div><dt>Change over ${trend.span} yrs</dt><dd>${sign}${TrendChart.fmt(absTotal, d)} ${series.units}${isFinite(trend.pctChange) ? ` (${sign}${TrendChart.fmt(Math.abs(trend.pctChange), 1)}%)` : ''}</dd></div>
          <div><dt>Mann–Kendall</dt><dd>Z = ${TrendChart.fmt(trend.mk.Z, 2)}, ${pFmt(trend.mk.p)}</dd></div>
          <div><dt>Linear regression</dt><dd>slope ${trend.ols.slope >= 0 ? '+' : '−'}${TrendChart.fmt(Math.abs(trend.ols.slope * 10), d)}/decade, ${pFmt(trend.ols.p)}, r² = ${TrendChart.fmt(trend.ols.r2, 2)}</dd></div>
        </dl>
        <div class="sig-row">${sigBadge}</div>
      </article>`;
  }

  function renderResults(slots) {
    const letters = state.mode === 'compare' ? ['A', 'B'] : [null, null];
    let html = slots.map(s => verdictCard(s, letters[s])).join('');

    if (slots.length === 2) {
      html += compareSummary();
    }
    html += `<div class="scan-cta">
      <button id="grid-btn" class="btn-secondary">🗺 Scan the surrounding region — <em>where</em> is it changing?</button>
      <span id="grid-status"></span>
    </div>`;
    resultsEl.innerHTML = html;

    // charts (shared y-domain when comparing)
    let yDomain = null;
    if (slots.length === 2) {
      const all = slots.flatMap(s => state.results[s].series.values);
      yDomain = [Math.min(...all), Math.max(...all)];
    }
    const v = PowerAPI.getVariable(state.variable);
    for (const s of slots) {
      const { series, trend } = state.results[s];
      TrendChart.render(document.getElementById('chart-' + s), {
        years: series.years, values: series.values, trend,
        units: series.units, decimals: v.decimals,
        seriesVar: SLOT_VARS[s], yDomain
      });
    }
    document.getElementById('grid-btn').addEventListener('click', runGridScan);
  }

  function compareSummary() {
    const [ra, rb] = [state.results[0], state.results[1]];
    if (!ra || !rb) return '';
    const a = ra.trend, b = rb.trend;
    const v = PowerAPI.getVariable(state.variable);
    let story;
    if (a.significant && b.significant && Math.sign(a.sen.slope) !== Math.sign(b.sen.slope)) {
      story = `<strong>Opposite significant trends.</strong> The same variable, driven by the same global system, is moving in <em>opposite directions</em> at these two places — exactly the regional divergence this challenge is about.`;
    } else if (a.significant && b.significant) {
      const faster = Math.abs(a.slopePerDecade) >= Math.abs(b.slopePerDecade) ? 'A' : 'B';
      const ratio = Math.abs(a.slopePerDecade) && Math.abs(b.slopePerDecade)
        ? (Math.max(Math.abs(a.slopePerDecade), Math.abs(b.slopePerDecade)) / Math.min(Math.abs(a.slopePerDecade), Math.abs(b.slopePerDecade)))
        : null;
      story = `<strong>Both trends are significant, in the same direction</strong> — but location ${faster} is changing ${ratio && isFinite(ratio) ? TrendChart.fmt(ratio, 1) + '× ' : ''}faster.`;
    } else if (a.significant !== b.significant) {
      const which = a.significant ? 'A' : 'B';
      const other = a.significant ? 'B' : 'A';
      story = `<strong>Significant at ${which}, not at ${other}.</strong> Change can be unambiguous in one region while still indistinguishable from year-to-year noise in another.`;
    } else {
      story = `<strong>No significant trend at either location</strong> for ${escapeHtml(v.name)} — natural variability dominates here. Try temperature, or another region.`;
    }
    return `<div class="compare-summary">${story}</div>`;
  }

  /* ---------- "where is it changing" grid scan ---------- */
  function clearGrid() {
    if (state.gridAbort) { state.gridAbort.abort(); state.gridAbort = null; }
    if (state.gridLayer) { map.removeLayer(state.gridLayer); state.gridLayer = null; }
    const legend = document.getElementById('grid-legend');
    if (legend) legend.remove();
  }

  async function runGridScan() {
    const loc = state.locations[0] || state.locations[1];
    if (!loc) return;
    clearGrid();
    const btn = document.getElementById('grid-btn');
    const gs = document.getElementById('grid-status');
    btn.disabled = true;
    const ctrl = new AbortController();
    state.gridAbort = ctrl;
    const v = PowerAPI.getVariable(state.variable);
    gs.textContent = 'Scanning 25 grid points…';

    try {
      const cells = await PowerAPI.fetchGrid(state.variable, loc.lat, loc.lon, {
        gridSize: 5, stepDeg: 2, concurrency: 4, signal: ctrl.signal,
        onProgress: (done, total) => { gs.textContent = `Scanning… ${done}/${total}`; }
      });
      if (ctrl.signal.aborted) return;
      const ok = cells.filter(c => c.ok && c.trend);
      if (!ok.length) { gs.textContent = 'No grid data available here.'; btn.disabled = false; return; }

      const maxAbs = Math.max(...ok.map(c => Math.abs(c.trend.slopePerDecade))) || 1;
      state.gridLayer = L.layerGroup();
      for (const c of ok) {
        const t = c.trend;
        const norm = Math.max(-1, Math.min(1, t.slopePerDecade / maxAbs));
        const color = divergingColor(norm);
        const circle = L.circleMarker([c.lat, c.lon], {
          radius: 9,
          color: color,
          weight: t.significant ? 2 : 1.5,
          dashArray: t.significant ? null : '3 3',
          fillColor: color,
          fillOpacity: t.significant ? 0.85 : 0.15
        });
        circle.bindTooltip(
          `${fmtCoord(c.lat, c.lon)}<br>` +
          `${t.sen.slope >= 0 ? '+' : '−'}${TrendChart.fmt(Math.abs(t.slopePerDecade), v.decimals)} ${v.units}/decade<br>` +
          `${t.significant ? 'significant' : 'not significant'} (p = ${t.mk.p.toPrecision(2)})`,
          { className: 'grid-tip' }
        );
        state.gridLayer.addLayer(circle);
      }
      state.gridLayer.addTo(map);
      addGridLegend(v, maxAbs);
      gs.textContent = `Done — ${ok.length} points. Filled = significant trend, hollow = not.`;
    } catch (err) {
      if (err.name !== 'AbortError') gs.textContent = 'Scan failed: ' + err.message;
    }
    btn.disabled = false;
  }

  // diverging blue (−1) → neutral → red (+1), from the reference palette
  function divergingColor(t) {
    const lerp = (a, b, u) => Math.round(a + (b - a) * u);
    const hex = (r, g, b) => `#${[r, g, b].map(x => x.toString(16).padStart(2, '0')).join('')}`;
    const blue = [42, 120, 214], gray = [160, 158, 150], red = [227, 73, 72];
    if (t < 0) { const u = -t; return hex(lerp(gray[0], blue[0], u), lerp(gray[1], blue[1], u), lerp(gray[2], blue[2], u)); }
    const u = t; return hex(lerp(gray[0], red[0], u), lerp(gray[1], red[1], u), lerp(gray[2], red[2], u));
  }

  function addGridLegend(v, maxAbs) {
    const div = document.createElement('div');
    div.id = 'grid-legend';
    div.className = 'grid-legend';
    div.innerHTML = `
      <strong>${escapeHtml(v.name)} trend</strong>
      <div class="legend-ramp"></div>
      <div class="legend-ends"><span>−${TrendChart.fmt(maxAbs, v.decimals)}</span><span>0</span><span>+${TrendChart.fmt(maxAbs, v.decimals)}</span></div>
      <span class="legend-note">${escapeHtml(v.units)}/decade · filled = significant (p &lt; 0.05)</span>`;
    document.getElementById('map').appendChild(div);
  }

  /* ---------- status ---------- */
  function setStatus(msg, kind) {
    statusEl.textContent = msg;
    statusEl.className = 'status ' + (kind || '');
  }

  /* ---------- theme toggle ---------- */
  const themeBtn = $('#theme-toggle');
  function applyTheme(t) {
    document.documentElement.dataset.theme = t;
    themeBtn.textContent = t === 'dark' ? '☀' : '☾';
    try { localStorage.setItem('trendscope-theme', t); } catch (_) {}
  }
  themeBtn.addEventListener('click', () => {
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  });
  (function initTheme() {
    let saved = null;
    try { saved = localStorage.getItem('trendscope-theme'); } catch (_) {}
    applyTheme(saved || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  })();

  updateSlotChips();
  runAnalysis();
})();
