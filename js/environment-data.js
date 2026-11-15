/* Remote data access and caching, independent of MapLibre rendering.
   Open-Meteo free endpoints: non-commercial use, CC BY 4.0 attribution.
   Values are model estimates at valid times, never station observations. */
const EnvironmentData = (() => {
  const fields = 'temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,shortwave_radiation';
  const cache = new Map();
  const finite = x => typeof x === 'number' && Number.isFinite(x);
  async function json(url, signal) {
    const timeout = AbortSignal.timeout(25000);
    const res = await fetch(url,{signal:signal ? AbortSignal.any([signal,timeout]) : timeout});
    if(!res.ok)throw new Error(`Data service returned ${res.status}`);
    const value=await res.json();if(value.error)throw new Error(value.reason || 'Data unavailable');return value;
  }
  const expectedUnits={temperature_2m:'°C',relative_humidity_2m:'%',wind_speed_10m:'m/s',wind_direction_10m:'°',shortwave_radiation:'W/m²',pm2_5:'μg/m³'};
  function normalizeTime(value) {
    if(typeof value!=='string')return null;
    const utc=/Z$|[+-]\d\d:\d\d$/.test(value)?value:value+'Z';
    return Number.isFinite(Date.parse(utc))?new Date(utc).toISOString():null;
  }
  function clean(values,units) {
    const result={};
    for(const [field,unit] of Object.entries(expectedUnits)) {
      const v=values[field], actual=units[field]?.replace('µ','μ');
      result[field]=finite(v)&&actual===unit&&
        (field!=='relative_humidity_2m'||(v>=0&&v<=100))&&
        (!['pm2_5','wind_speed_10m','shortwave_radiation'].includes(field)||v>=0)&&
        (field!=='wind_direction_10m'||(v>=0&&v<=360))?v:null;
    }
    return result;
  }
  function endpoint(points,air=false,hour=null) {
    const params = new URLSearchParams({latitude:points.map(p=>p.lat).join(','),longitude:points.map(p=>p.lon).join(','),timezone:'GMT'});
    params.set(hour?'hourly':'current',air?'pm2_5':fields);
    if(hour){params.set('start_hour',hour);params.set('end_hour',hour);}
    if(!air){params.set('wind_speed_unit','ms');params.set('temperature_unit','celsius');params.set('cell_selection','nearest');}
    return `https://${air?'air-quality-api':'api'}.open-meteo.com/v1/${air?'air-quality':'forecast'}?${params}`;
  }
  async function request(points, air, signal, hour=null) {
    const body=await json(endpoint(points,air,hour),signal), rows=Array.isArray(body)?body:[body];
    if(rows.length!==points.length)throw new Error('Incomplete model response');
    return rows.map((r,i)=>{
      const point=points[i];
      // Reject misordered or displaced responses instead of painting another location.
      const lonDistance=Math.abs(((r.longitude-point.lon+540)%360)-180);
      if(!finite(r.latitude)||!finite(r.longitude)||Math.abs(r.latitude-point.lat)>2||lonDistance>2)throw Error('Model response coordinates do not match request');
      const time=normalizeTime(hour?r.hourly?.time?.[0]:r.current?.time);
      if(!time||(hour&&time!==normalizeTime(hour)))throw Error('Model valid time missing or mismatched');
      const units=(hour?r.hourly_units:r.current_units)||{};
      const values=hour?Object.fromEntries(Object.entries(r.hourly||{}).map(([k,v])=>[k,v?.[0]])):r.current||{};
      return {...point,current:clean(values,units),units,time,interval:hour?3600:r.current?.interval,modelLat:r.latitude,modelLon:r.longitude};
    });
  }
  async function point(lat,lon,{air=false,signal}={}) {
    const key=`point:${air}:${lat.toFixed(3)}:${lon.toFixed(3)}`, prior=cache.get(key);
    if(prior && Date.now()-prior.time<900000)return prior.value;
    const value=(await request([{lat,lon}],air,signal))[0];
    cache.set(key,{time:Date.now(),value});return value;
  }
  function grid(air=false) {
    const hour=new Date(Math.floor(Date.now()/3600000)*3600000).toISOString().slice(0,16);
    const key='grid:15:'+air+':'+hour, prior=cache.get(key);
    if(prior && Date.now()-prior.time<900000)return prior.value;
    const storageKey='trendscope:global-field:v4:15:'+air;
    try{const saved=JSON.parse(localStorage.getItem(storageKey));if(saved&&Date.now()-saved.saved<1800000&&saved.data.validHour===hour&&Array.isArray(saved.data.samples)&&saved.data.samples.every(s=>s.time===normalizeTime(hour)&&finite(s.lat)&&finite(s.lon)&&s.current&&s.units)){return Promise.resolve(saved.data);}}catch(_){}
    const value=(async()=>{
      const points=[];
      for(let lat=-82.5;lat<=82.5;lat+=15)for(let lon=-172.5;lon<=172.5;lon+=15)points.push({lat,lon});
      const batches=[]; for(let i=0;i<points.length;i+=24)batches.push(points.slice(i,i+24));
      const samples=[];let failures=0, cursor=0;
      async function worker(){while(cursor<batches.length){const batch=batches[cursor++];try{samples.push(...await request(batch,air,undefined,hour));}catch(e){failures+=batch.length;}}}
      await Promise.all([worker(),worker()]);
      if(!samples.length)throw new Error('Global model data unavailable. Select a location to retry a point request.');
      const data={samples,failures,validHour:hour,step:15,total:points.length,retrieved:new Date().toISOString()};
      try{localStorage.setItem(storageKey,JSON.stringify({saved:Date.now(),data}));}catch(_){}
      return data;
    })();
    cache.set(key,{time:Date.now(),value});value.catch(()=>cache.delete(key));return value;
  }
  let countriesPromise;
  async function search(query,signal) {
    countriesPromise ||= json('data/countries.json');
    const countries=await countriesPromise, q=query.trim().toLowerCase();
    if(cache.has('search:'+q))return cache.get('search:'+q);
    const countryHits=countries.filter(c=>[c.name,...c.aliases].some(n=>n?.toLowerCase()===q || (q.length>=4 && n?.toLowerCase().includes(q)))).map(c=>({...c,label:c.name+' · country',country:true}));
    try {
      const body=await json('https://geocoding-api.open-meteo.com/v1/search?'+new URLSearchParams({name:query,count:'5',language:'en',format:'json'}),signal);
      const matches=[...countryHits,...(body.results||[]).map(c=>({lat:c.latitude,lon:c.longitude,label:[c.name,c.admin1,c.country].filter(Boolean).join(', ')}))].slice(0,6);cache.set('search:'+q,matches);return matches;
    }catch(e){if(e.name==='AbortError')throw e;if(countryHits.length)return countryHits;throw e;}
  }
  return {point,grid,search,finite,normalizeTime,clean};
})();
