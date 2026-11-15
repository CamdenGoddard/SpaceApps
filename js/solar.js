/* Approximate geocentric solar coordinates (Meeus/NOAA formulae).
   All inputs are UTC. Good to about 0.1° for dashboard illumination,
   not an ephemeris for navigation or eclipse prediction. */
const Solar = (() => {
  const rad = Math.PI / 180;
  const wrap = x => ((x + 180) % 360 + 360) % 360 - 180;
  function position(date = new Date()) {
    const jd = date.getTime() / 86400000 + 2440587.5;
    const n = jd - 2451545;
    const g = (357.529 + 0.98560028 * n) * rad;
    const lambda = (280.459 + 0.98564736 * n + 1.915 * Math.sin(g) + 0.020 * Math.sin(2*g)) * rad;
    const epsilon = (23.439 - 0.00000036 * n) * rad;
    const ra = Math.atan2(Math.cos(epsilon) * Math.sin(lambda), Math.cos(lambda)) / rad;
    const dec = Math.asin(Math.sin(epsilon) * Math.sin(lambda));
    const gmst = 280.46061837 + 360.98564736629 * n;
    const lon = wrap(ra - gmst);
    return { lat: dec / rad, lon, vector: [Math.cos(dec)*Math.cos(lon*rad), Math.cos(dec)*Math.sin(lon*rad), Math.sin(dec)] };
  }
  function altitude(lat, lon, date) {
    const p = position(date), phi = lat*rad, theta = (lon-p.lon)*rad, dec = p.lat*rad;
    const dot = Math.sin(phi)*Math.sin(dec)+Math.cos(phi)*Math.cos(dec)*Math.cos(theta);
    return Math.asin(Math.max(-1, Math.min(1, dot)))/rad;
  }
  return {position, altitude};
})();
