/* Remote data access and caching, independent of MapLibre rendering.
   Open-Meteo free endpoints: non-commercial use, CC BY 4.0 attribution.
   Values are model estimates at valid times, never station observations. */
const EnvironmentData = (() => {
  const fields = 'temperature_2m,relative_humidity_2m,precipitation,cloud_cover,wind_speed_10m,wind_direction_10m,shortwave_radiation,weather_code';
  const cache = new Map();
  const finite = x => typeof x === 'number' && Number.isFinite(x);
  async function json(url, signal) {
    const timeout = AbortSignal.timeout(25000);
    const res = await fetch(url,{signal:signal ? AbortSignal.any([signal,timeout]) : timeout});
    if(!res.ok)throw new Error(`Data service returned ${res.status}`);
    const value=await res.json();if(value.error)throw new Error(value.reason || 'Data unavailable');return value;
  }
  function endpoint(points,air=false) {
    const params = new URLSearchParams({latitude:points.map(p=>p.lat).join(','),longitude:points.map(p=>p.lon).join(','),current:air?'pm2_5':fields,timezone:'GMT'});
    if(!air){params.set('wind_speed_unit','ms');params.set('forecast_days','1');}
    return `https://${air?'air-quality-api':'api'}.open-meteo.com/v1/${air?'air-quality':'forecast'}?${params}`;
  }
  async function request(points, air, signal) {
    const body=await json(endpoint(points,air),signal), rows=Array.isArray(body)?body:[body];
    if(rows.length!==points.length)throw new Error('Incomplete model response');
    return rows.map((r,i)=>({ ...points[i],current:r.current || {},units:r.current_units || {},time:r.current?.time ? r.current.time+'Z' : null,interval:r.current?.interval,modelLat:r.latitude,modelLon:r.longitude }));
  }
  async function point(lat,lon,{air=false,signal}={}) {
    const key=`point:${air}:${lat.toFixed(3)}:${lon.toFixed(3)}`, prior=cache.get(key);
    if(prior && Date.now()-prior.time<900000)return prior.value;
    const value=(await request([{lat,lon}],air,signal))[0];
    cache.set(key,{time:Date.now(),value});return value;
  }
  function grid(air=false) {
    const key='grid:15:'+air, prior=cache.get(key);
    if(prior && Date.now()-prior.time<900000)return prior.value;
    const storageKey='trendscope:global-field:v3:15:'+air;
    try{const saved=JSON.parse(localStorage.getItem(storageKey));if(saved&&Date.now()-saved.saved<1800000&&Array.isArray(saved.data.samples)){return Promise.resolve(saved.data);}}catch(_){}
    const value=(async()=>{
      const points=[];
      for(let lat=-82.5;lat<=82.5;lat+=15)for(let lon=-172.5;lon<=172.5;lon+=15)points.push({lat,lon});
      const batches=[]; for(let i=0;i<points.length;i+=24)batches.push(points.slice(i,i+24));
      const samples=[];let failures=0, cursor=0;
      async function worker(){while(cursor<batches.length){const batch=batches[cursor++];try{samples.push(...await request(batch,air));}catch(e){failures+=batch.length;}}}
      await Promise.all([worker(),worker()]);
      if(!samples.length)throw new Error('Global model data unavailable. Select a location to retry a point request.');
      const data={samples,failures,step:15,total:points.length,retrieved:new Date().toISOString()};
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
  return {point,grid,search,finite};
})();
