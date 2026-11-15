load('js/field-grid.js');
function assert(x,message){if(!x)throw Error(message);print('PASS '+message);}
const points=[];for(let lat=-82.5;lat<=82.5;lat+=15)for(let lon=-172.5;lon<=172.5;lon+=15)points.push({lat,lon,current:{t:lat,wind_speed_10m:10,wind_direction_10m:270}});
const scalar=FieldGrid.make(points,'t');
assert(Math.abs(scalar.sample(0,0))<1e-5,'bilinear midpoint reproduces a linear field');
assert(scalar.sample(7.5,7.5)===7.5,'exact source sample is retained');
assert(scalar.sample(85,0)===null,'polar coverage is not extrapolated');
assert(Math.abs(scalar.sample(20,179.999)-scalar.sample(20,-180.001))<1e-5,'longitude seam is periodic');
const wind=FieldGrid.make(points,'t',true).sample(0,0);
assert(Math.abs(wind.u-10)<1e-5&&Math.abs(wind.v)<1e-5,'wind-from direction converts to eastward u/v');
const mixed=points.map(p=>({...p,current:{...p.current,wind_direction_10m:p.lon<0?90:270}}));
assert(FieldGrid.make(mixed,'t',true).sample(0,0).speed<1e-5,'opposing vectors cancel rather than interpolate angles');
const broken=points.map(p=>({...p,current:{t:p.lon===7.5&&p.lat===7.5?null:p.current.t}}));
assert(FieldGrid.make(broken,'t').sample(0,0)===null,'missing corners remain unavailable');
const advected=FieldGrid.advect(0,179.9,111320,0,1);
assert(Math.abs(advected.lon+179.1)<1e-6,'particle advection wraps the dateline');
assert(Math.abs(FieldGrid.advect(0,0,0,111320,1).lat-1)<1e-6,'northward advection retains geographic units');
