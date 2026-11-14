/* ============================================================
   TrendScope — SVG chart renderer
   Annual time series + Sen's trend line, with crosshair hover
   tooltip. Colors come from CSS custom properties so light and
   dark mode swap in one place.
   ============================================================ */

const TrendChart = (() => {

  const NS = 'http://www.w3.org/2000/svg';

  function el(tag, attrs = {}, parent) {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    if (parent) parent.appendChild(node);
    return node;
  }

  function niceTicks(min, max, count = 5) {
    if (min === max) { min -= 1; max += 1; }
    const span = max - min;
    const step0 = span / count;
    const mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const norm = step0 / mag;
    let step;
    if (norm < 1.5) step = 1;
    else if (norm < 3) step = 2;
    else if (norm < 7) step = 5;
    else step = 10;
    step *= mag;
    const start = Math.ceil(min / step) * step;
    const ticks = [];
    for (let v = start; v <= max + step * 1e-9; v += step) {
      ticks.push(+v.toFixed(10));
    }
    return ticks;
  }

  function fmt(v, decimals = 2) {
    if (!isFinite(v)) return '–';
    const a = Math.abs(v);
    if (a !== 0 && (a < 0.001 || a >= 100000)) return v.toExponential(1);
    return (+v.toFixed(decimals)).toLocaleString('en-US', { maximumFractionDigits: decimals });
  }

  /**
   * render(container, opts)
   * opts: { years, values, trend, units, seriesVar ('--series-1'),
   *         decimals, yDomain (optional shared [min,max]), trendLabel }
   */
  function render(container, opts) {
    const { years, values, trend, units, decimals = 2 } = opts;
    const seriesVar = opts.seriesVar || '--series-1';
    container.innerHTML = '';

    const W = 640, H = 320;
    const M = { top: 18, right: 16, bottom: 34, left: 56 };
    const iw = W - M.left - M.right;
    const ih = H - M.top - M.bottom;

    let yMin = Math.min(...values), yMax = Math.max(...values);
    if (opts.yDomain) { yMin = opts.yDomain[0]; yMax = opts.yDomain[1]; }
    const pad = (yMax - yMin) * 0.08 || 1;
    yMin -= pad; yMax += pad;

    const x0 = years[0], x1 = years[years.length - 1];
    const sx = yr => M.left + ((yr - x0) / (x1 - x0)) * iw;
    const sy = v => M.top + (1 - (v - yMin) / (yMax - yMin)) * ih;

    const svg = el('svg', {
      viewBox: `0 0 ${W} ${H}`,
      class: 'trend-chart',
      role: 'img',
      'aria-label': `Annual time series ${x0}–${x1} with trend line`
    });
    container.appendChild(svg);

    // gridlines + y ticks
    const yTicks = niceTicks(yMin, yMax, 5);
    for (const t of yTicks) {
      const y = sy(t);
      el('line', { x1: M.left, x2: W - M.right, y1: y, y2: y, class: 'grid' }, svg);
      const lbl = el('text', { x: M.left - 8, y: y + 4, class: 'tick', 'text-anchor': 'end' }, svg);
      lbl.textContent = fmt(t, decimals >= 3 ? 2 : decimals);
    }
    // x ticks (decades)
    const xTicks = niceTicks(x0, x1, 6).filter(t => Number.isInteger(t));
    for (const t of xTicks) {
      const x = sx(t);
      const lbl = el('text', { x, y: H - M.bottom + 18, class: 'tick', 'text-anchor': 'middle' }, svg);
      lbl.textContent = t;
    }
    // baseline
    el('line', { x1: M.left, x2: W - M.right, y1: M.top + ih, y2: M.top + ih, class: 'axis-line' }, svg);
    // y-axis units label
    const unitsLbl = el('text', { x: M.left - 8, y: M.top - 6, class: 'tick units-lbl', 'text-anchor': 'end' }, svg);
    unitsLbl.textContent = units;

    // data line
    const path = years.map((yr, i) => `${i ? 'L' : 'M'}${sx(yr).toFixed(1)},${sy(values[i]).toFixed(1)}`).join('');
    el('path', { d: path, fill: 'none', stroke: `var(${seriesVar})`, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);

    // Sen's trend line (dashed), clipped to plot
    if (trend && trend.sen) {
      const { slope, intercept } = trend.sen;
      const yStart = slope * x0 + intercept;
      const yEnd = slope * x1 + intercept;
      el('line', {
        x1: sx(x0), y1: sy(Math.max(yMin, Math.min(yMax, yStart))),
        x2: sx(x1), y2: sy(Math.max(yMin, Math.min(yMax, yEnd))),
        class: 'trend-line',
        stroke: `var(${seriesVar})`,
        'stroke-width': 2,
        'stroke-dasharray': '6 5',
        opacity: 0.75
      }, svg);
      // direct label for the trend line
      const lbl = el('text', {
        x: W - M.right - 4,
        y: Math.max(M.top + 12, Math.min(M.top + ih - 6, sy(yEnd) - 8)),
        class: 'trend-label', 'text-anchor': 'end'
      }, svg);
      lbl.textContent = (opts.trendLabel ||
        `trend ${trend.sen.slope >= 0 ? '+' : ''}${fmt(trend.slopePerDecade, decimals)} ${units}/decade`);
    }

    // markers (small, hover targets are bigger via overlay)
    years.forEach((yr, i) => {
      el('circle', { cx: sx(yr), cy: sy(values[i]), r: 2.5, fill: `var(${seriesVar})`, class: 'pt', 'data-i': i }, svg);
    });

    /* ---- hover layer: crosshair + tooltip ---- */
    const crosshair = el('line', { y1: M.top, y2: M.top + ih, class: 'crosshair', visibility: 'hidden' }, svg);
    const hoverDot = el('circle', { r: 5, fill: `var(${seriesVar})`, stroke: 'var(--surface-1)', 'stroke-width': 2, visibility: 'hidden' }, svg);

    const tip = document.createElement('div');
    tip.className = 'chart-tooltip';
    tip.style.display = 'none';
    container.style.position = 'relative';
    container.appendChild(tip);

    const overlay = el('rect', {
      x: M.left, y: M.top, width: iw, height: ih,
      fill: 'transparent', style: 'cursor: crosshair'
    }, svg);

    function onMove(evt) {
      const rect = svg.getBoundingClientRect();
      const px = (evt.clientX - rect.left) * (W / rect.width);
      const yr = x0 + ((px - M.left) / iw) * (x1 - x0);
      // nearest data year
      let best = 0, bestD = Infinity;
      years.forEach((y, i) => {
        const d = Math.abs(y - yr);
        if (d < bestD) { bestD = d; best = i; }
      });
      const cx = sx(years[best]), cy = sy(values[best]);
      crosshair.setAttribute('x1', cx); crosshair.setAttribute('x2', cx);
      crosshair.setAttribute('visibility', 'visible');
      hoverDot.setAttribute('cx', cx); hoverDot.setAttribute('cy', cy);
      hoverDot.setAttribute('visibility', 'visible');
      tip.style.display = 'block';
      tip.innerHTML = `<span class="tt-year">${years[best]}</span><span class="tt-val">${fmt(values[best], decimals)} ${units}</span>`;
      const contRect = container.getBoundingClientRect();
      const scale = contRect.width / W;
      let left = cx * scale + 12;
      if (left + 130 > contRect.width) left = cx * scale - 140;
      tip.style.left = left + 'px';
      tip.style.top = Math.max(0, cy * scale - 40) + 'px';
    }
    function onLeave() {
      crosshair.setAttribute('visibility', 'hidden');
      hoverDot.setAttribute('visibility', 'hidden');
      tip.style.display = 'none';
    }
    overlay.addEventListener('mousemove', onMove);
    overlay.addEventListener('mouseleave', onLeave);
    overlay.addEventListener('touchmove', e => { if (e.touches[0]) onMove(e.touches[0]); }, { passive: true });
    overlay.addEventListener('touchend', onLeave);

    return svg;
  }

  return { render, fmt, niceTicks };
})();
