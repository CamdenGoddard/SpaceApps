/* Bilinear display interpolation of real regular-grid samples.
   Missing corners stay missing. Longitude is periodic; poles are not extrapolated.
   This changes visual smoothness, never the underlying sample resolution. */
const FieldGrid = (() => {
  const finite = x => typeof x === 'number' && Number.isFinite(x);
  const wrap = x => ((x+180)%360+360)%360-180;
  function make(samples, field, vector=false, step=15) {
    const nx=360/step, ny=180/step, west=-180+step/2, south=-90+step/2;
    const a=new Float32Array(nx*ny).fill(NaN), b=vector?new Float32Array(nx*ny).fill(NaN):null;
    for(const s of samples) {
      const ix=Math.round((s.lon-west)/step), iy=Math.round((s.lat-south)/step);
      if(ix<0||ix>=nx||iy<0||iy>=ny)continue;
      if(vector) {
        const speed=s.current.wind_speed_10m, direction=s.current.wind_direction_10m;
        if(!finite(speed)||!finite(direction))continue;
        const angle=direction*Math.PI/180;a[iy*nx+ix]=-speed*Math.sin(angle);b[iy*nx+ix]=-speed*Math.cos(angle);
      } else if(finite(s.current[field])) a[iy*nx+ix]=s.current[field];
    }
    function sample(lat,lon) {
      const gy=(lat-south)/step;if(gy<0||gy>ny-1)return null;
      const gx=((wrap(lon)-west)/step+nx)%nx, x0=Math.floor(gx), y0=Math.min(ny-2,Math.floor(gy));
      const tx=gx-x0,ty=gy-y0;
      const indices=[y0*nx+x0,y0*nx+(x0+1)%nx,(y0+1)*nx+x0,(y0+1)*nx+(x0+1)%nx];
      const weights=[(1-tx)*(1-ty),tx*(1-ty),(1-tx)*ty,tx*ty];
      let v=0,u=0;
      for(let i=0;i<4;i++) {
        if(weights[i]<1e-8)continue;
        if(!finite(a[indices[i]]) || (vector&&!finite(b[indices[i]])))return null;
        v+=weights[i]*a[indices[i]];if(vector)u+=weights[i]*b[indices[i]];
      }
      return vector?{u:v,v:u,speed:Math.hypot(v,u)}:v;
    }
    return {sample,step,nx,ny};
  }
  function advect(lat,lon,u,v,seconds) {
    const nextLat=lat+v*seconds/111320;
    return {lat:nextLat,lon:wrap(lon+u*seconds/(111320*Math.max(.08,Math.cos(lat*Math.PI/180))))};
  }
  return {make,advect,wrap};
})();
