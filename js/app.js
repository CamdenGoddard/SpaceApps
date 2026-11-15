/* ============================================================
   TrendScope: application wiring
   Map, variable picker, single/compare modes, verdict panel,
   and the "where is it changing?" regional grid scan.
   ============================================================ */

(() => {
  'use strict';

  /* ---------- state ---------- */
  const state = {
    historyYear: null,
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
      desc: 'Root-zone soil moisture, the water plants actually use, tells the megadrought story.',
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
  // Raster sources keep the existing public, keyless NASA imagery.
  const mapMessage = $('#map-message');
  const reportMapError = message => {
    mapMessage.textContent = message;
    mapMessage.hidden = false;
  };
  const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const overviewZoom = () => {
    const { width, height } = $('#globe').getBoundingClientRect();
    return Math.min(1.65, Math.log2(Math.max(240, Math.min(width-40, height-90)) * 0.85 * Math.PI / 512));
  };
  const renderRatio = Math.min(window.devicePixelRatio || 1, 2);
  const nativeTileSize = 256 / renderRatio;
  const imageryZoomLimit = 7 - Math.log2(renderRatio);
  const labelKinds = ['continent', 'country', 'city'];
  const labelOpacity = {
    continent: ['interpolate', ['linear'], ['zoom'], 0, 1, 1.8, 1, 2.4, 0],
    country: ['interpolate', ['linear'], ['zoom'], 2.4, 0, 3, 1, 4.4, 1, 5, 0],
    city: ['interpolate', ['linear'], ['zoom'], 5, 0, 5.6, 1, 8, 1]
  };
  // A small, local source keeps the overview independent of vector tile detail.
  const continents = [
    ['North America', -105, 43], ['South America', -60, -18],
    ['Europe', 18, 52], ['Africa', 20, 4], ['Asia', 90, 43],
    ['Oceania', 135, -24], ['Antarctica', 0, -78]
  ];
  const seriesCache = new Map();
  let earthView = null;
  let map = null;
  try {
    map = new maplibregl.Map({
      container: 'globe', center: [((Solar.position().lon + 235) % 360 + 360) % 360 - 180, 20], zoom: overviewZoom(), minZoom: overviewZoom(), maxZoom: imageryZoomLimit,
      maxPitch: 0, renderWorldCopies: false, fadeDuration: 250,
      pixelRatio: renderRatio,
      canvasContextAttributes: {antialias:true,powerPreference:'high-performance'},
      maxTileCacheSize:96,
      dragPan: { linearity: 0.25, deceleration: 2200, maxSpeed: 1000 },
      dragRotate: false, touchPitch: false,
      attributionControl: true,
      style: {
        version: 8, projection: { type: 'vertical-perspective' }, transition: { duration: 300, delay: 0 },
        glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
        sky: {
          'sky-color': '#02060d', 'horizon-color': '#99c9e2',
          'fog-color': '#07101d', 'sky-horizon-blend': 0.5,
          'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 0.8, 5, 0.8, 7, 0]
        },
        sources: {
          continents: { type: 'geojson', data: { type: 'FeatureCollection', features: continents.map(([name, lon, lat]) => ({
            type: 'Feature', properties: { name }, geometry: { type: 'Point', coordinates: [lon, lat] }
          })) } },
          places: {
            type: 'vector', url: 'https://tiles.openfreemap.org/planet',
            attribution: '<a href="https://openfreemap.org/">OpenFreeMap</a> © <a href="https://openmaptiles.org/">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          },
          nasa: { type: 'raster', tileSize: nativeTileSize, maxzoom: 8,
            tiles: ['https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg'],
            attribution: 'Imagery: NASA GIBS / Blue Marble' },
          osm: { type: 'raster', tileSize: 256, maxzoom: 19,
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>' }
        },
        layers: [
          { id: 'nasa', type: 'raster', source: 'nasa', paint: {
            'raster-resampling':'linear', 'raster-fade-duration': 250
          } },
          { id: 'osm', type: 'raster', source: 'osm', layout: { visibility: 'none' } },
          // Only three GPU-rendered symbol layers; zoom opacity is evaluated
          // by MapLibre, without rebuilding labels on every zoom frame.
          ...labelKinds.map(kind => ({
            id: `${kind}-labels`, type: 'symbol',
            source: kind === 'continent' ? 'continents' : 'places',
            ...(kind === 'continent' ? {} : { 'source-layer': 'place' }),
            minzoom: kind === 'city' ? 5 : kind === 'country' ? 2.4 : 0, maxzoom: kind === 'continent' ? 2.4 : kind === 'country' ? 5 : 9,
            ...(kind === 'continent' ? {} : { filter: ['==', ['get', 'class'], kind] }),
            layout: {
              'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name:latin'], ['get', 'name']],
              'text-font': [kind === 'city' ? 'Noto Sans Regular' : 'Noto Sans Bold'],
              'text-size': ['interpolate', ['linear'], ['zoom'], 0, kind === 'continent' ? 14 : 11, 5, kind === 'continent' ? 20 : 15, 8, 17],
              'text-transform': kind === 'continent' ? 'uppercase' : 'none',
              'text-letter-spacing': kind === 'continent' ? 0.16 : 0.02,
              'text-max-width': 8, 'text-padding': kind === 'continent' ? 16 : 8,
              'text-allow-overlap': false, 'text-ignore-placement': false,
              'symbol-sort-key': ['coalesce', ['get', 'rank'], 99]
            },
            paint: { 'text-color': kind === 'continent' ? '#dbe7ed' : '#f4f7fa',
              'text-halo-color': '#0b1724', 'text-halo-width': 1.5, 'text-halo-blur': 0.5,
              'text-opacity': labelOpacity[kind] }
          }))
        ]
      }
    });
    map.on('load', () => { earthView = EarthView.mount(map, info => {
      document.getElementById('earth-status').textContent = `${info.live?'LIVE UTC':'HISTORICAL LIGHTING'} · ${info.time.toISOString().replace('T',' ').slice(0,19)} · ${info.night}`;
      $('#earth-status').title=$('#earth-status').textContent;
    });
      Dashboard.mount({map,earthView,selectLocation,selectedLocation:state.locations[0],onHistoryYear:year=>{state.historyYear=year;clearGrid();runAnalysis();}});
    });
    map.scrollZoom.setWheelZoomRate(1 / 600);
    map.scrollZoom.setZoomRate(1 / 150);
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right');
    // Keep names on the near hemisphere, including while dragging. The
    // generous horizon margin allows collision fades to finish before a
    // label crosses the limb. Throttle tile filter updates to 8 Hz.
    let lastLabelUpdate = -Infinity;
    let lastLabelCenter = null;
    function updateLabelHemisphere(force = false) {
      if (!map.getLayer('continent-labels') || (!force && performance.now() - lastLabelUpdate < 125)) return;
      lastLabelUpdate = performance.now();
      const center = map.getCenter();
      if (lastLabelCenter && Math.abs(center.lat - lastLabelCenter.lat) < 2 &&
          Math.abs(((center.lng - lastLabelCenter.lng + 540) % 360) - 180) < 2) return;
      lastLabelCenter = center;
      const front = ['<', ['distance', { type: 'Point', coordinates: [center.lng, center.lat] }], 8000000];
      for (const kind of labelKinds) {
        map.setFilter(`${kind}-labels`, kind === 'continent' ? front : ['all', ['==', ['get', 'class'], kind], front]);
      }
    }
    map.on('load', () => updateLabelHemisphere(true));
    map.on('move', () => updateLabelHemisphere());
    map.on('moveend', () => updateLabelHemisphere(true));
    map.on('error', e => { if(e.error?.name==='AbortError' || String(e.error?.message).includes('AbortError'))return; console.warn('Map resource:', e.error?.message || e.message); reportMapError('Some map imagery could not load. Try Street map or enter coordinates below.'); });
    map.on('click', e => {
      // Off-globe unprojection snaps to the horizon. Reject those clicks
      // using the public projection API rather than private transforms.
      const projected = map.project(e.lngLat);
      if (Math.hypot(projected.x - e.point.x, projected.y - e.point.y) > 2) return;
      selectLocation(e.lngLat.lat, e.lngLat.lng);
    });
    // Layout can change when results render or the viewport narrows.
    new ResizeObserver(() => {
      const wasOverview = Math.abs(map.getZoom() - map.getMinZoom()) < 0.05;
      map.resize();
      map.setMinZoom(overviewZoom());
      if (wasOverview) map.setZoom(overviewZoom());
    }).observe($('#globe'));
  } catch (err) {
    map = null;
    $('#map-hint').classList.add('hidden');
    $('#globe-home').disabled = true;
    $('#basemap').disabled = true;
    document.querySelectorAll('[data-earth-mode], #search-form button, #location-search, #history-year, #live-earth').forEach(el=>el.disabled=true);
    $('#search-results').textContent='Globe tools unavailable. Coordinate climate analysis still works.';
    reportMapError('The globe could not start. It requires MapLibre and WebGL. You can still analyze coordinates below.');
  }
  $('#globe-home').addEventListener('click', () => map?.flyTo({ center: [((Solar.position().lon + 235) % 360 + 360) % 360 - 180, 20], zoom: overviewZoom(), bearing: 0, pitch: 0, duration: reducedMotion() ? 0 : 1400 }));
  $('#basemap').addEventListener('change', e => {
    if (!map?.isStyleLoaded()) return;
    for (const id of ['nasa', 'osm']) map.setLayoutProperty(id, 'visibility', id === e.target.value ? 'visible' : 'none');
    for (const id of labelKinds.map(kind => `${kind}-labels`)) {
      map.setLayoutProperty(id, 'visibility', e.target.value === 'nasa' ? 'visible' : 'none');
    }
    mapMessage.hidden = true;
  });
  $('#coordinate-form').addEventListener('submit', e => {
    e.preventDefault();
    const lat = Number($('#latitude').value), lon = Number($('#longitude').value);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return;
    selectLocation(lat, lon);
    map?.flyTo({ center: [lon, lat], zoom: 3, duration: reducedMotion() ? 0 : 1200 });
  });
  function selectLocation(latitude, longitude, label) {
    const lat = +latitude.toFixed(3);
    const lon = +(((longitude + 180) % 360 + 360) % 360 - 180).toFixed(3);
    $('#latitude').value = lat;
    $('#longitude').value = lon;
    setLocation(state.activeSlot, { lat, lon, ...(label ? {label} : {}) });
    if (state.mode === 'compare') {
      state.activeSlot = state.activeSlot === 0 ? 1 : 0;
    }
    updateSlotChips();
    runAnalysis();
  }

  function fmtCoord(lat, lon) {
    return `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E' : 'W'}`;
  }

  function locationLabel(loc) {
    return loc.label ? `${loc.label} (${fmtCoord(loc.lat, loc.lon)})` : fmtCoord(loc.lat, loc.lon);
  }

  function setLocation(slot, loc) {
    const hint = document.getElementById('map-hint');
    if (hint) hint.classList.add('hidden');
    clearGrid();
    state.locations[slot] = loc;
    document.dispatchEvent(new CustomEvent('trendscope:location',{detail:{slot,loc}}));
    state.results[slot] = null;
    state.markers[slot]?.remove();
    if (map) {
      const element = document.createElement('div');
      element.className = `loc-marker loc-marker-${slot}`;
      element.textContent = state.mode === 'compare' ? (slot === 0 ? 'A' : 'B') : '●';
      element.setAttribute('aria-label', locationLabel(loc));
      state.markers[slot] = new maplibregl.Marker({ element, opacityWhenCovered: 0 })
        .setLngLat([loc.lon, loc.lat]).addTo(map);
    }
  }

  function clearSlot(slot) {
    state.locations[slot] = null;
    state.results[slot] = null;
    state.markers[slot]?.remove();
    state.markers[slot] = null;
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
    $('#var-blurb').textContent = PowerAPI.getVariable(state.variable).blurb;
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
      if (state.locations[0]) setLocation(0, state.locations[0]);
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
    btn.title = p.desc;
    btn.innerHTML = `<strong>${p.title}</strong>`;
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
    const lonB = p.a.lon + ((p.b.lon - p.a.lon + 540) % 360 - 180);
    map?.fitBounds([[Math.min(p.a.lon, lonB), Math.min(p.a.lat, p.b.lat)],
      [Math.max(p.a.lon, lonB), Math.max(p.a.lat, p.b.lat)]],
      { padding: 65, maxZoom: 4, duration: reducedMotion() ? 0 : 1400 });
    runAnalysis();
  }

  /* ---------- analysis ---------- */
  async function runAnalysis() {
    if (state.fetchAbort) state.fetchAbort.abort();
    const slots = state.mode === 'compare' ? [0, 1] : [0];
    const active = slots.filter(s => state.locations[s]);
    if (active.length === 0) {
      resultsEl.innerHTML = `<div class="placeholder">
        <p><strong>Click anywhere on the map</strong>, or try a comparison story.</p>
      </div>`;
      return;
    }
    const ctrl = new AbortController();
    state.fetchAbort = ctrl;
    const v = PowerAPI.getVariable(state.variable);
    setStatus(`Fetching ${v.name}…`, 'busy');
    resultsEl.innerHTML = `<div class="placeholder"><div class="spinner"></div><p>Fetching 40+ years of NASA data…</p></div>`;

    try {
      await Promise.all(active.map(async slot => {
        const loc = state.locations[slot];
        const cacheKey = `${state.variable}:${loc.lat}:${loc.lon}`;
        let full = seriesCache.get(cacheKey);
        if (!full) { full = await PowerAPI.fetchSeries(state.variable, loc.lat, loc.lon, { signal: ctrl.signal }); seriesCache.set(cacheKey,full); }
        if(ctrl.signal.aborted)return;
        const record=PowerAPI.historyRecord(full,state.variable,state.historyYear);
        const {series}=record;
        const trend=record.canAnalyze?TrendStats.analyze(series.years,series.values):null;
        if(ctrl.signal.aborted)return;
        state.results[slot]={series,trend,message:record.message};
      }));
      if (ctrl.signal.aborted) return;
      renderResults(active);
      setStatus('', 'idle');
    } catch (err) {
      if (err.name === 'AbortError') return;
      setStatus('', 'idle');
      resultsEl.innerHTML = `<div class="placeholder error"><p><strong>Could not fetch data.</strong> ${escapeHtml(err.message)}</p><p class="hint">Try another spot or variable. Soil moisture needs land.</p></div>`;
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

  /* Translate a p-value into plain language the card can lead with. */
  function oddsPhrase(p) {
    if (p < 0.0001) return 'under 1 in 10,000';
    if (p < 0.01) {
      const n = Math.round(1 / p);
      const nice = n >= 1000 ? Math.round(n / 100) * 100 : n >= 100 ? Math.round(n / 10) * 10 : n;
      return 'about 1 in ' + nice.toLocaleString('en-US');
    }
    return 'about ' + Math.round(p * 100) + '%';
  }

  function verdictCard(slot, letter) {
    const { series, trend } = state.results[slot];
    const v = PowerAPI.getVariable(state.variable);
    const loc = state.locations[slot];
    if(!trend) {
      const {message}=state.results[slot];
      return `<article class="verdict-card"><header><h3>${escapeHtml(locationLabel(loc))}</h3></header>
        <p class="card-sub">${escapeHtml(series.longname)}</p><p role="status">${escapeHtml(message)}</p>
        ${series.years.length===1?`<p>${series.years[0]}: <strong>${TrendChart.fmt(series.values[0],v.decimals)} ${escapeHtml(series.units)}</strong></p>`:''}
        ${series.years.length?`<div class="chart-wrap" id="chart-${slot}"></div>`:''}</article>`;
    }
    const dir = directionWord(trend, state.variable);
    const dirClass = !trend.significant ? 'dir-none' : (trend.direction === 'up' ? 'dir-up' : 'dir-down');
    const arrow = !trend.significant ? '→' : (trend.direction === 'up' ? '↗' : '↘');
    const sign = trend.slopePerDecade >= 0 ? '+' : '−';
    const absSlope = Math.abs(trend.slopePerDecade);
    const absTotal = Math.abs(trend.totalChange);
    const d = v.decimals;

    const sigLine = trend.significant
      ? `<p class="sig-line sig-yes"><strong>Significant.</strong> Odds this is just noise: ${oddsPhrase(trend.mk.p)}.</p>`
      : `<p class="sig-line sig-no"><strong>Not significant.</strong> Plain noise looks like this ${oddsPhrase(trend.mk.p)} of the time.</p>`;

    return `
      <article class="verdict-card">
        <header>
          ${letter ? `<span class="slot-dot slot-dot-${slot}">${letter}</span>` : ''}
          <div>
            <h3>${escapeHtml(locationLabel(loc))}</h3>
            <p class="card-sub">${escapeHtml(series.longname)}, ${series.years[0]} to ${series.years[series.years.length - 1]}</p>
          </div>
        </header>
        <p class="verdict-dir ${dirClass}">${arrow} ${dir}</p>
        <p class="verdict-hero ${dirClass}">${sign}${TrendChart.fmt(absSlope, d)}<span class="hero-unit">${series.units}/decade</span></p>
        <div class="chart-wrap" id="chart-${slot}"></div>
        <dl class="stats-grid">
          <div><dt>Change over ${trend.span} yrs</dt><dd>${sign}${TrendChart.fmt(absTotal, d)} ${series.units}${!v.intervalScale && isFinite(trend.pctChange) ? ` (${sign}${TrendChart.fmt(Math.abs(trend.pctChange), 1)}%)` : ''}</dd></div>
          <div><dt>Mann-Kendall</dt><dd>Z = ${TrendChart.fmt(trend.mk.Z, 2)}, ${pFmt(trend.mk.p)}</dd></div>
          <div><dt>Linear regression</dt><dd>${trend.ols.slope >= 0 ? '+' : '−'}${TrendChart.fmt(Math.abs(trend.ols.slope * 10), d)}/decade, ${pFmt(trend.ols.p)}, r² = ${TrendChart.fmt(trend.ols.r2, 2)}</dd></div>
        </dl>
        ${state.results[slot].message?`<p role="status">${escapeHtml(state.results[slot].message)}</p>`:''}
        ${sigLine}
      </article>`;
  }

  function renderResults(slots) {
    const letters = state.mode === 'compare' ? ['A', 'B'] : [null, null];
    let html = slots.map(s => verdictCard(s, letters[s])).join('');

    if (slots.length === 2 && slots.every(s=>state.results[s].trend)) {
      html += compareSummary();
    }
    html += `<div class="scan-cta">
      <button id="grid-btn" class="btn-secondary" ${state.historyYear ? 'disabled title="Return to Live Earth for the full-record regional scan"' : ''}>Map trends across this region</button>
      <span id="grid-status"></span>
    </div>`;
    resultsEl.innerHTML = html;

    // charts (shared y-domain when comparing)
    let yDomain = null;
    if (slots.length === 2) {
      const all = slots.flatMap(s => state.results[s].series.values);
      if(all.length)yDomain = [Math.min(...all), Math.max(...all)];
    }
    const v = PowerAPI.getVariable(state.variable);
    for (const s of slots) {
      const { series, trend } = state.results[s];
      if(!series.years.length)continue;
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
      story = `<strong>Opposite significant trends.</strong> The same variable, driven by the same global system, is moving in <em>opposite directions</em> at these two places. This is exactly the regional divergence this challenge is about.`;
    } else if (a.significant && b.significant) {
      const faster = Math.abs(a.slopePerDecade) >= Math.abs(b.slopePerDecade) ? 'A' : 'B';
      const ratio = Math.abs(a.slopePerDecade) && Math.abs(b.slopePerDecade)
        ? (Math.max(Math.abs(a.slopePerDecade), Math.abs(b.slopePerDecade)) / Math.min(Math.abs(a.slopePerDecade), Math.abs(b.slopePerDecade)))
        : null;
      story = `<strong>Both trends are significant, in the same direction</strong>, but location ${faster} is changing ${ratio && isFinite(ratio) ? TrendChart.fmt(ratio, 1) + '× ' : ''}faster.`;
    } else if (a.significant !== b.significant) {
      const which = a.significant ? 'A' : 'B';
      const other = a.significant ? 'B' : 'A';
      story = `<strong>Significant at ${which}, not at ${other}.</strong> Change can be unambiguous in one region while still indistinguishable from year-to-year noise in another.`;
    } else {
      story = `<strong>No significant trend at either location</strong> for ${escapeHtml(v.name)}. Natural variability dominates here. Try temperature, or another region.`;
    }
    return `<div class="compare-summary">${story}</div>`;
  }

  /* ---------- "where is it changing" grid scan ---------- */
  function clearGrid() {
    if (state.gridAbort) { state.gridAbort.abort(); state.gridAbort = null; }
    if (map?.getLayer('regional-trends')) map.removeLayer('regional-trends');
    if (map?.getSource('regional-trends')) map.removeSource('regional-trends');
    state.gridLayer?.remove();
    state.gridLayer = null;
    const legend = document.getElementById('grid-legend');
    if (legend) legend.remove();
  }

  async function runGridScan() {
    const loc = state.locations[0] || state.locations[1];
    if (!loc) return;
    if (!map?.isStyleLoaded()) { reportMapError('Wait for the globe to load before scanning a region.'); return; }
    clearGrid();
    const btn = document.getElementById('grid-btn');
    const gs = document.getElementById('grid-status');
    btn.disabled = true;
    const ctrl = new AbortController();
    state.gridAbort = ctrl;
    const v = PowerAPI.getVariable(state.variable);
    gs.textContent = 'Scanning 25 grid points…';
    map.flyTo({ center: [loc.lon, loc.lat], zoom: 5, duration: reducedMotion() ? 0 : 1200 });

    try {
      const cells = await PowerAPI.fetchGrid(state.variable, loc.lat, loc.lon, {
        gridSize: 5, stepDeg: 2, concurrency: 4, signal: ctrl.signal,
        onProgress: (done, total) => { gs.textContent = `Scanning… ${done}/${total}`; }
      });
      if (ctrl.signal.aborted) return;
      const ok = cells.filter(c => c.ok && c.trend);
      if (!ok.length) { gs.textContent = 'No grid data available here.'; btn.disabled = false; return; }

      const maxAbs = Math.max(...ok.map(c => Math.abs(c.trend.slopePerDecade))) || 1;
      const features = ok.map(c => {
        const t = c.trend;
        return { type: 'Feature', geometry: { type: 'Point', coordinates: [c.lon, c.lat] },
          properties: { color: divergingColor(Math.max(-1, Math.min(1, t.slopePerDecade / maxAbs))),
            significant: t.significant,
            description: `${fmtCoord(c.lat, c.lon)} · ${t.slopePerDecade >= 0 ? '+' : '−'}${TrendChart.fmt(Math.abs(t.slopePerDecade), v.decimals)} ${v.units}/decade · ${t.significant ? 'significant' : 'not significant'} (p = ${t.mk.p.toPrecision(2)})` }
        };
      });
      map.addSource('regional-trends', { type: 'geojson', data: { type: 'FeatureCollection', features } });
      map.addLayer({ id: 'regional-trends', type: 'circle', source: 'regional-trends', paint: {
        'circle-radius': 9, 'circle-color': ['get', 'color'],
        'circle-opacity': ['case', ['get', 'significant'], 0.85, 0.15],
        'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 2
      } });
      addGridLegend(v, maxAbs);
      gs.textContent = `${ok.length} points mapped. Filled = significant.`;
    } catch (err) {
      if (err.name !== 'AbortError') gs.textContent = 'Scan failed: ' + err.message;
    }
    btn.disabled = false;
  }

  if (map) {
    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false });
    map.on('mousemove', 'regional-trends', e => {
      const feature = e.features?.[0];
      if (!feature) return;
      popup.setLngLat(e.lngLat).setText(feature.properties.description).addTo(map);
      state.gridLayer = popup;
    });
    map.on('mouseleave', 'regional-trends', () => popup.remove());
  }

  // diverging blue (−1) → neutral → red (+1), from the reference palette
  function divergingColor(t) {
    const lerp = (a, b, u) => Math.round(a + (b - a) * u);
    const hex = (r, g, b) => `#${[r, g, b].map(x => x.toString(16).padStart(2, '0')).join('')}`;
    const blue = [91, 155, 232], gray = [86, 96, 118], red = [230, 103, 103];
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
      <span class="legend-note">${escapeHtml(v.units)}/decade, filled = significant (p &lt; 0.05)</span>`;
    document.getElementById('map').appendChild(div);
  }

  /* ---------- status ---------- */
  function setStatus(msg, kind) {
    statusEl.textContent = msg;
    statusEl.className = 'status ' + (kind || '');
  }

  $('#history-year').min=Math.min(...PowerAPI.VARIABLES.map(v=>v.startYear));
  $('#history-year').max=PowerAPI.END_YEAR;
  $('#history-year').value=PowerAPI.END_YEAR;
  $('#year-value').textContent=PowerAPI.END_YEAR;
  updateSlotChips();
  runAnalysis();
})();
