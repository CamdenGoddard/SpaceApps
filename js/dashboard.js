/* Dashboard UI orchestration. Statistical calculations remain in stats.js. */
const Dashboard = (() => {
  const $=s=>document.querySelector(s);
  const fmt=(v,unit='')=>EnvironmentData.finite(v)?`${Number(v.toFixed(1))} ${unit}`:'Unavailable';
  function mount({map,earthView,selectLocation,onHistoryYear,selectedLocation}) {
    let mode='earth',selected=selectedLocation,pointAbort=null,searchAbort=null,history=false,requestVersion=0,timelineTimer=null;
    const layers=EnvironmentLayers.mount(map,renderLayer);
    if($('#clouds-toggle').checked)earthView.setClouds(true);
    function renderLayer(info) {
      const box=$('#layer-legend'); box.replaceChildren();
      const title=document.createElement('strong');title.textContent=info.mode.name;box.append(title);
      const text=document.createElement('p');box.append(text);
      if(info.name==='earth'){text.textContent='UTC solar geometry · NASA historical imagery';return;}
      if(info.state==='loading'){text.textContent='Loading global model samples…';return;}
      if(info.state==='unavailable'){text.textContent='Unavailable · '+info.error;box.dataset.state='unavailable';return;}
      box.dataset.state='ready';
      const ramp=document.createElement('div');ramp.className='environment-ramp';ramp.style.background=`linear-gradient(90deg,${info.mode.colors.join(',')})`;box.append(ramp);
      const ticks=document.createElement('div');ticks.className='legend-ends';ticks.textContent=`${info.name==='temperature'?'≤':''}${info.mode.min} — ${info.mode.max}${info.name==='humidity'?'':'+'} ${info.mode.unit}`;box.append(ticks);
      const source=info.name==='pollution'?'CAMS via Open-Meteo':'Weather models via Open-Meteo';
      text.textContent=`${info.mode.subtitle} · ${info.count}/${info.total} samples${info.missing?` · ${info.missing} unavailable`:''}. ${info.step}° source sampling · bilinear display interpolation. Poles and missing areas unshaded. ${source} · valid ${info.times[0]}${info.times[0]!==info.times[1]?' – '+info.times[1]:''}.`;
      if(info.name==='wind')text.textContent+=` Up to ${info.particles.toLocaleString()} adaptive particles · interpolated u/v vectors · time-scaled snapshot trajectories.`;
      if(info.name==='weather')text.textContent+=` Accumulation interval: ${info.interval} s.`;
      const label=document.createElement('label');label.className='legend-control';label.textContent='Overlay opacity';
      const slider=document.createElement('input');slider.type='range';slider.min=0;slider.max=100;slider.value=info.name==='wind'?34:52;slider.setAttribute('aria-label','Overlay opacity');
      slider.addEventListener('input',()=>map.setPaintProperty('environment','raster-opacity',Number(slider.value)/100));label.append(slider);box.append(label);
    }
    async function setMode(next) {
      mode=next;
      if(history){$('#live-earth').click();}
      document.querySelectorAll('[data-earth-mode]').forEach(b=>{b.classList.toggle('active',b.dataset.earthMode===next);b.setAttribute('aria-pressed',String(b.dataset.earthMode===next));});
      $('#mode-heading').textContent=EnvironmentLayers.modes[next].name;
      earthView.setVisible($('#basemap').value==='nasa');
      const changing=layers.setMode(next);if(selected)loadPoint();await changing;
    }
    document.querySelectorAll('[data-earth-mode]').forEach(b=>b.addEventListener('click',()=>setMode(b.dataset.earthMode)));
    function cell(label,value){const div=document.createElement('div');const dt=document.createElement('dt');dt.textContent=label;const dd=document.createElement('dd');dd.textContent=value;div.append(dt,dd);return div;}
    async function loadPoint() {
      pointAbort?.abort();pointAbort=new AbortController();const token=++requestVersion;
      const box=$('#current-measurements');box.replaceChildren();
      const heading=document.createElement('h2');heading.textContent=selected.label || `${selected.lat.toFixed(2)}°, ${selected.lon.toFixed(2)}°`;box.append(heading);
      const status=document.createElement('p');box.append(status);
      if(history){status.textContent='Historical NASA POWER analysis below. Current model measurements hidden in historical mode.';return;}
      status.textContent='Fetching point model estimate…';
      try{
        const p=await EnvironmentData.point(selected.lat,selected.lon,{air:mode==='pollution',signal:pointAbort.signal});
        if(token!==requestVersion)return;
        const age=Math.abs(Date.now()-Date.parse(p.time));
        status.textContent=`${mode==='pollution'?'CAMS':'Weather model'} via Open-Meteo · valid ${p.time || 'time unavailable'}${age>3*3600000?' · outside current time window':''}`;
        const values=p.current, dl=document.createElement('dl');dl.className='measurement-grid';
        if(mode==='pollution')dl.append(cell('PM2.5',fmt(values.pm2_5,p.units.pm2_5)));
        else {
          for(const [label,key] of [['Temperature','temperature_2m'],['Humidity','relative_humidity_2m'],['Wind · 10 m','wind_speed_10m'],['Wind from','wind_direction_10m'],['Precipitation','precipitation'],['Cloud cover','cloud_cover'],['Solar radiation','shortwave_radiation']])dl.append(cell(label,fmt(values[key],p.units[key])));
          dl.append(cell('Conditions',weatherName(values.weather_code)));
        }
        box.append(dl);const note=document.createElement('p');note.className='source-note';note.textContent=`Model grid ${p.modelLat?.toFixed(2)}°, ${p.modelLon?.toFixed(2)}°. Interval ${p.interval || 'unavailable'} s. Point estimates differ from the coarse global sample grid.`;box.append(note);
      }catch(e){if(e.name!=='AbortError')status.textContent='Point data unavailable · '+e.message;}
    }
    document.addEventListener('trendscope:location',e=>{selected=e.detail.loc;loadPoint();});
    $('.dashboard-nav a[href="#slot-chips"]').addEventListener('click',e=>{e.preventDefault();document.querySelector('[data-mode="compare"]').click();$('#slot-chips').scrollIntoView({block:'nearest',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});});
    $('#basemap').addEventListener('change',()=>earthView.setVisible($('#basemap').value==='nasa'));
    $('#clouds-toggle').addEventListener('change',e=>earthView.setClouds(e.target.checked && !history));
    $('#search-form').addEventListener('submit',async e=>{
      e.preventDefault();const query=$('#location-search').value.trim();if(query.length<2)return;
      searchAbort?.abort();searchAbort=new AbortController();const own=searchAbort;
      const box=$('#search-results');box.replaceChildren();box.textContent='Searching…';
      try{
        const matches=await EnvironmentData.search(query,own.signal);if(own.signal.aborted)return;box.replaceChildren();
        if(!matches.length){box.textContent='No places found. Try another name or enter coordinates.';return;}
        for(const hit of matches){const b=document.createElement('button');b.type='button';b.textContent=hit.label;b.addEventListener('click',()=>{selectLocation(hit.lat,hit.lon,hit.label);map.flyTo({center:[hit.lon,hit.lat],zoom:hit.country?2.6:5.5,duration:matchMedia('(prefers-reduced-motion: reduce)').matches?0:1400});box.replaceChildren();});box.append(b);}
      }catch(error){if(error.name!=='AbortError')box.textContent='Search unavailable · '+error.message;}
    });
    function historyYear(year){
      clearTimeout(timelineTimer);
      history=true;$('#clouds-toggle').disabled=true;mode='earth';layers.setMode('earth');earthView.setVisible($('#basemap').value==='nasa');earthView.setClouds(false);earthView.setTime(new Date(Date.UTC(year,6,1,12)));
      $('#live-earth').setAttribute('aria-pressed','false');$('#timeline-status').textContent=`NASA POWER · annual record through ${year}. Lighting preview: July 1, 12:00 UTC. Clouds hidden.`;
      document.querySelectorAll('[data-earth-mode]').forEach(b=>{b.classList.toggle('active',b.dataset.earthMode==='earth');b.setAttribute('aria-pressed',String(b.dataset.earthMode==='earth'));});
      $('#mode-heading').textContent='Historical Earth';onHistoryYear(year);if(selected)loadPoint();
    }
    $('#history-year').addEventListener('input',e=>{const year=Number(e.target.value);$('#year-value').textContent=year;clearTimeout(timelineTimer);timelineTimer=setTimeout(()=>historyYear(year),180);});
    $('#history-year').addEventListener('change',e=>historyYear(Number(e.target.value)));
    $('#live-earth').addEventListener('click',()=>{
      clearTimeout(timelineTimer);$('#history-year').value=PowerAPI.END_YEAR;$('#year-value').textContent=PowerAPI.END_YEAR;
      history=false;$('#clouds-toggle').disabled=false;earthView.setLive();earthView.setClouds($('#clouds-toggle').checked);$('#live-earth').setAttribute('aria-pressed','true');
      $('#timeline-status').textContent='Current UTC lighting · historical NASA POWER trends';$('#mode-heading').textContent=EnvironmentLayers.modes[mode].name;onHistoryYear(null);if(selected)loadPoint();
    });
    document.querySelectorAll('[data-earth-mode], #search-form button').forEach(b=>b.disabled=false);
    layers.setMode('earth');if(selected)loadPoint();
    return {setMode};
  }
  function weatherName(code) {
    if(!EnvironmentData.finite(code))return 'Unavailable';
    const names={0:'Clear',1:'Mainly clear',2:'Partly cloudy',3:'Overcast',45:'Fog',48:'Rime fog',51:'Light drizzle',53:'Drizzle',55:'Dense drizzle',56:'Freezing drizzle',57:'Dense freezing drizzle',61:'Light rain',63:'Rain',65:'Heavy rain',66:'Freezing rain',67:'Heavy freezing rain',71:'Light snow',73:'Snow',75:'Heavy snow',77:'Snow grains',80:'Light showers',81:'Showers',82:'Heavy showers',85:'Snow showers',86:'Heavy snow showers',95:'Thunderstorm',96:'Thunderstorm with hail',99:'Thunderstorm with heavy hail'};
    return names[code] || `WMO code ${code}`;
  }
  return {mount,weatherName};
})();
