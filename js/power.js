/* ============================================================
   TrendScope: NASA POWER API client + variable catalog
   Data: NASA POWER (Prediction Of Worldwide Energy Resources)
   https://power.larc.nasa.gov/ : satellite + model (MERRA-2 /
   CERES / FLASHFlux) derived climate variables, 1981 to present,
   for any point on Earth. Free, no API key, CORS-enabled.
   ============================================================ */

const PowerAPI = (() => {

  const POWER_HOST = 'https://power.larc.nasa.gov';
  /* The POWER API does not send CORS headers, so browsers can't call it
     directly. RELAY is a Cloudflare Worker that forwards GET requests to
     power.larc.nasa.gov unchanged and adds Access-Control-Allow-Origin. */
  const RELAY = 'https://nasa-power-relay.cgoddardoh.workers.dev';
  const COMMUNITY = 'AG';
  const END_YEAR = new Date().getUTCFullYear() - 1; // last complete year

  /* Try the relay first (when configured), then the API directly. A host
     only falls through on a network/CORS failure; any real HTTP response
     is treated as authoritative. */
  async function getResponse(path, signal) {
    const hosts = RELAY ? [RELAY, POWER_HOST] : [POWER_HOST];
    let lastErr;
    for (const host of hosts) {
      try {
        return await fetch(host + path, { signal });
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        lastErr = err;
      }
    }
    throw new Error('Could not reach the NASA POWER API (' + (lastErr?.message || 'network error') + ').');
  }

  /* Variable catalog.
     startYear: solar-radiation variables begin in 1984 (CERES/SRB era);
     meteorology begins 1981 (MERRA-2). */
  const VARIABLES = [
    {
      id: 'T2M', name: 'Air temperature (2 m)', units: '°C', startYear: 1981,
      group: 'Temperature', decimals: 2,
      blurb: 'Average air temperature at 2 meters, the classic climate-change variable.'
    },
    {
      id: 'T2M_MAX', name: 'Max daily temperature', units: '°C', startYear: 1981,
      group: 'Temperature', decimals: 2,
      blurb: 'Annual mean of daily maximum temperature. Tracks heat extremes.'
    },
    {
      id: 'T2M_MIN', name: 'Min daily temperature', units: '°C', startYear: 1981,
      group: 'Temperature', decimals: 2,
      blurb: 'Annual mean of daily minimum temperature. Nights often warm faster than days.'
    },
    {
      id: 'TS', name: 'Earth skin temperature', units: '°C', startYear: 1981,
      group: 'Temperature', decimals: 2,
      blurb: 'Temperature of the land/sea surface itself, as a satellite sees it.'
    },
    {
      id: 'PRECTOTCORR', name: 'Precipitation', units: 'mm/day', startYear: 1981,
      group: 'Water', decimals: 3,
      blurb: 'Bias-corrected total precipitation. The same warming world is getting wetter in some regions and drier in others.'
    },
    {
      id: 'RH2M', name: 'Relative humidity (2 m)', units: '%', startYear: 1981,
      group: 'Water', decimals: 2,
      blurb: 'How close the air is to saturation.'
    },
    {
      id: 'QV2M', name: 'Specific humidity (2 m)', units: 'g/kg', startYear: 1981,
      group: 'Water', decimals: 3,
      blurb: 'Actual water-vapor content of the air. It rises as oceans warm.'
    },
    {
      id: 'GWETROOT', name: 'Root-zone soil wetness', units: '0-1', startYear: 1981,
      group: 'Water', decimals: 3,
      blurb: 'Soil moisture available to plants (0 = bone dry, 1 = saturated). A drought indicator.'
    },
    {
      id: 'ALLSKY_SFC_SW_DWN', name: 'Solar irradiance (all-sky)', units: 'kWh/m²/day', startYear: 1984,
      group: 'Energy', decimals: 3,
      blurb: 'Sunlight reaching the surface. Changes with clouds and aerosol pollution ("global dimming / brightening").'
    },
    {
      id: 'WS10M', name: 'Wind speed (10 m)', units: 'm/s', startYear: 1981,
      group: 'Energy', decimals: 3,
      blurb: 'Near-surface wind. Relevant to wind power and "global terrestrial stilling".'
    },
    {
      id: 'PS', name: 'Surface pressure', units: 'kPa', startYear: 1981,
      group: 'Energy', decimals: 3,
      blurb: 'Atmospheric pressure at the surface. Shifts with circulation changes.'
    }
  ];

  function getVariable(id) {
    return VARIABLES.find(v => v.id === id);
  }

  /* Parse a POWER time-series object into sorted {years, values},
     dropping fill values. Handles both annual ("1995") and monthly
     ("199513" = annual mean, "199501".."199512" = months) keying. */
  function parseSeries(raw, fillValue) {
    const annual = new Map();   // year -> value (direct annual keys or month-13)
    const monthly = new Map();  // year -> [values]

    for (const [key, val] of Object.entries(raw)) {
      if (typeof val !== 'number') continue;
      if (val === fillValue || val <= -900) continue;
      if (/^\d{4}$/.test(key)) {
        annual.set(+key, val);
      } else if (/^\d{6}$/.test(key)) {
        const year = +key.slice(0, 4);
        const month = +key.slice(4, 6);
        if (month === 13) {
          annual.set(year, val);
        } else if (month >= 1 && month <= 12) {
          if (!monthly.has(year)) monthly.set(year, []);
          monthly.get(year).push(val);
        }
      }
    }

    // Fall back to averaging months when no annual key exists
    if (annual.size === 0 && monthly.size > 0) {
      for (const [year, vals] of monthly.entries()) {
        if (vals.length === 12) {
          annual.set(year, vals.reduce((a, b) => a + b, 0) / 12);
        }
      }
    }

    const years = [...annual.keys()].sort((a, b) => a - b);
    return { years, values: years.map(y => annual.get(y)) };
  }

  /**
   * Fetch the annual time series for one variable at one point.
   * Returns { years, values, units, longname, lat, lon }.
   */
  async function fetchSeries(varId, lat, lon, { signal } = {}) {
    const v = getVariable(varId);
    if (!v) throw new Error('Unknown variable: ' + varId);
    const params = new URLSearchParams({
      parameters: varId,
      community: COMMUNITY,
      longitude: lon.toFixed(4),
      latitude: lat.toFixed(4),
      start: String(v.startYear),
      end: String(END_YEAR),
      format: 'JSON'
    });
    /* The monthly endpoint includes annual means keyed as month "13";
       parseSeries extracts them (the annual endpoint was removed from
       the POWER API). */
    const path = `/api/temporal/monthly/point?${params}`;
    const res = await getResponse(path, signal);
    if (!res.ok) {
      let msg = `NASA POWER returned ${res.status}`;
      try {
        const body = await res.json();
        const detail = body?.messages?.join('; ') || body?.message || body?.detail;
        if (detail) msg += `: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`;
      } catch (_) { /* ignore */ }
      throw new Error(msg);
    }
    const data = await res.json();
    const paramObj = data?.properties?.parameter?.[varId];
    if (!paramObj) throw new Error('No data returned for this location/variable.');
    const fill = data?.header?.fill_value ?? -999;
    const { years, values } = parseSeries(paramObj, fill);
    if (years.length < 10) {
      throw new Error('Too few valid data points at this location (' + years.length + ').');
    }
    const meta = data?.parameters?.[varId] || {};
    return {
      years, values,
      units: meta.units || v.units,
      longname: meta.longname || v.name,
      lat, lon
    };
  }

  /**
   * Fetch a grid of trend analyses around a center point. Answers
   * "WHERE is it changing?". gridSize x gridSize points, spaced
   * stepDeg apart. Runs with limited concurrency to be polite to
   * the API. onProgress(done, total) is called as cells finish.
   */
  async function fetchGrid(varId, centerLat, centerLon, {
    gridSize = 5, stepDeg = 2, concurrency = 4, onProgress, signal
  } = {}) {
    const half = Math.floor(gridSize / 2);
    const cells = [];
    for (let i = -half; i <= half; i++) {
      for (let j = -half; j <= half; j++) {
        const lat = Math.max(-89.5, Math.min(89.5, centerLat + i * stepDeg));
        let lon = centerLon + j * stepDeg;
        if (lon > 180) lon -= 360;
        if (lon < -180) lon += 360;
        cells.push({ lat, lon });
      }
    }
    const results = [];
    let done = 0;
    let idx = 0;
    async function worker() {
      while (idx < cells.length) {
        if (signal?.aborted) return;
        const myIdx = idx++;
        const cell = cells[myIdx];
        try {
          const series = await fetchSeries(varId, cell.lat, cell.lon, { signal });
          const trend = TrendStats.analyze(series.years, series.values);
          results.push({ ...cell, series, trend, ok: true });
        } catch (err) {
          if (err.name === 'AbortError') return;
          results.push({ ...cell, ok: false, error: err.message });
        }
        done++;
        if (onProgress) onProgress(done, cells.length);
      }
    }
    await Promise.all(Array.from({ length: concurrency }, worker));
    return results;
  }

  return { VARIABLES, getVariable, fetchSeries, fetchGrid, parseSeries, END_YEAR };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = PowerAPI;
