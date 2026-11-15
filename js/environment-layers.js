/* Continuous display interpolation of real, resolution-labeled model samples. */
const EnvironmentLayers = (() => {
  const modes = {
    earth:{name:'Earth',subtitle:'UTC sunlight & satellite textures'},
    wind:{name:'Wind',field:'wind_speed_10m',unit:'m/s',min:0,max:25,colors:['#73e6db','#cce0ff','#db94ff'],subtitle:'10 m wind · interpolated particle trajectories'},
    pollution:{name:'Air pollution',field:'pm2_5',unit:'µg/m³',min:0,max:75,colors:['#56d6c5','#f7d65d','#ee667a'],subtitle:'PM2.5 · CAMS model estimate'},
    humidity:{name:'Humidity',field:'relative_humidity_2m',unit:'%',min:0,max:100,colors:['#d5c084','#49c7b3','#5585ed'],subtitle:'2 m relative humidity'},
    solar:{name:'Solar radiation',field:'shortwave_radiation',unit:'W/m²',min:0,max:1000,colors:['#202a5a','#eab961','#fff2aa'],subtitle:'Surface shortwave radiation · interval mean'}
  };
  function color(value,mode){
    const hex=s=>s.match(/\w\w/g).map(n=>parseInt(n,16));
    const u=Math.max(0,Math.min(1,(value-mode.min)/(mode.max-mode.min)))*2, i=Math.min(1,Math.floor(u)), t=u-i;
    const a=hex(mode.colors[i]),b=hex(mode.colors[i+1]);return '#'+a.map((n,j)=>Math.round(n+(b[j]-n)*t).toString(16).padStart(2,'0')).join('');
  }
  function mount(map,report) {
    let current='earth',epoch=0,revision=0,requestID=0,lastInfo=null,cancelLoading=()=>{},rendererError=null;
    const pending=new Map(),ready=new Map(),pngCache=new Map(),renderKeys=new Map();
    const worker=new Worker('js/field-worker.js');
    worker.onmessage=({data:m})=>{
      if(m.type==='ready'){ready.get(m.revision)?.();ready.delete(m.revision);return;}
      const job=pending.get(m.id);if(!job)return;pending.delete(m.id);job.cleanup();
      if(m.error)job.reject(m.error.includes('superseded')?new DOMException('Aborted','AbortError'):Error(m.error));else{pngCache.set(job.cacheKey,m.data.slice(0));while(pngCache.size>96)pngCache.delete(pngCache.keys().next().value);job.resolve({data:m.data});}
    };
    worker.onerror=e=>{
      rendererError=Error(e.message||'Field renderer unavailable');cancelLoading();wind.stop();map.setPaintProperty('environment','raster-opacity',0);
      for(const done of ready.values())done(rendererError);ready.clear();
      for(const job of pending.values()){job.cleanup();job.reject(Error(e.message||'Field renderer unavailable'));}pending.clear();
      if(lastInfo){lastInfo={...lastInfo,state:'unavailable',error:'Environmental renderer unavailable in this browser.'};report(lastInfo);}
    };
    let blank;
    const emptyTile=()=>blank||=(async()=>{const c=document.createElement('canvas');c.width=c.height=256;const blob=await new Promise(r=>c.toBlob(r,'image/png'));return {data:await blob.arrayBuffer()};})();
    maplibregl.addProtocol('envfield',({url},controller)=>{
      const parsed=new URL(url),rev=Number(parsed.searchParams.get('v'));
      if(!rev)return emptyTile();
      if(!renderKeys.has(rev)||controller?.signal.aborted)return Promise.reject(new DOMException('Aborted','AbortError'));
      const [z,x,y]=parsed.pathname.slice(1).split('/').map(Number),id=++requestID;
      const cacheKey=`${renderKeys.get(rev)}:${z}:${x}:${y}`;
      if(pngCache.has(cacheKey)){const data=pngCache.get(cacheKey);pngCache.delete(cacheKey);pngCache.set(cacheKey,data);return Promise.resolve({data:data.slice(0)});}
      return new Promise((resolve,reject)=>{
        const cancel=()=>{pending.delete(id);worker.postMessage({type:'cancel',id});reject(new DOMException('Aborted','AbortError'));};
        controller?.signal.addEventListener('abort',cancel,{once:true});
        pending.set(id,{resolve,reject,cacheKey,cleanup:()=>controller?.signal.removeEventListener('abort',cancel)});
        worker.postMessage({type:'tile',id,revision:rev,z,x,y});
      });
    });
    const tiles=()=>`envfield://tiles/{z}/{x}/{y}?v=${revision}`;
    map.addSource('environment',{type:'raster',tiles:[tiles()],tileSize:256,maxzoom:5});
    map.addLayer({id:'environment',type:'raster',source:'environment',paint:{'raster-opacity':0,'raster-opacity-transition':{duration:350},'raster-fade-duration':0,'raster-resampling':'linear'}},'continent-labels');
    const wind=WindParticles.create();map.addLayer(wind,'continent-labels');
    async function setMode(name) {
      const token=++epoch;cancelLoading();current=name;wind.stop();
      // Drop old tiles immediately; fade only the newly loaded field in.
      map.setPaintProperty('environment','raster-opacity-transition',{duration:0});
      map.setPaintProperty('environment','raster-opacity',0);
      map.getSource('environment').setTiles(['envfield://tiles/{z}/{x}/{y}?v=0']);
      for(const [id,job] of pending){job.cleanup();job.reject(new DOMException('Aborted','AbortError'));worker.postMessage({type:'cancel',id});}pending.clear();
      const m=modes[name];lastInfo={name,mode:m,state:'loading'};
      if(name==='earth'){report({...lastInfo,state:'ready'});return;}
      report({...lastInfo,state:'loading'});
      try{
        if(rendererError)throw rendererError;
        const grid=await EnvironmentData.grid(name==='pollution');if(token!==epoch)return;
        const samples=grid.samples.filter(s=>EnvironmentData.finite(s.current[m.field])&&s.time&&(name!=='wind'||EnvironmentData.finite(s.current.wind_direction_10m)));
        if(!samples.length)throw Error('No valid samples for this mode.');
        const rev=++revision;renderKeys.set(rev,`${name}:${grid.retrieved}`);while(renderKeys.size>12)renderKeys.delete(renderKeys.keys().next().value);
        await new Promise((resolve,reject)=>{
          const timer=setTimeout(()=>{ready.delete(rev);reject(Error('Field renderer timed out'));},12000);
          ready.set(rev,error=>{clearTimeout(timer);error?reject(error):resolve();});
          cancelLoading=()=>{clearTimeout(timer);ready.delete(rev);reject(new DOMException('Aborted','AbortError'));};
          worker.postMessage({type:'field',revision:rev,samples,mode:m,name,step:grid.step||15});
        });
        if(token!==epoch)return;
        map.setPaintProperty('environment','raster-opacity',.001);
        // Warm new tiles nearly transparently, then fade in only after their
        // source reports loaded. This prevents a flash of the previous field.
        await new Promise((resolve,reject)=>{
          let timer;
          const cleanup=()=>{clearTimeout(timer);map.off('sourcedata',loaded);};
          const finish=()=>{cleanup();resolve();};
          const loaded=e=>{if(e.sourceId==='environment'&&e.isSourceLoaded&&map.isSourceLoaded('environment'))finish();};
          cancelLoading=()=>{cleanup();reject(new DOMException('Aborted','AbortError'));};
          map.on('sourcedata',loaded);
          timer=setTimeout(()=>{cleanup();reject(Error('Environmental tiles could not finish loading.'));},20000);
          map.getSource('environment').setTiles([tiles()]);
        });
        if(token!==epoch)return;
        cancelLoading=()=>{};map.setPaintProperty('environment','raster-opacity-transition',{duration:350});
        map.setPaintProperty('environment','raster-opacity',name==='wind'?.34:.52);
        if(name==='wind')wind.setField(FieldGrid.make(samples,m.field,true,grid.step||15));
        const times=samples.map(s=>s.time).sort();
        lastInfo={name,mode:m,state:'ready',count:samples.length,total:grid.total||288,step:grid.step||15,missing:(grid.total||288)-samples.length,times:[times[0],times.at(-1)],interval:samples[0].interval,particles:name==='wind'?wind.getCount():0};
        report(lastInfo);
      }catch(error){if(token===epoch){wind.stop();map.setPaintProperty('environment','raster-opacity',0);map.getSource('environment').setTiles(['envfield://tiles/{z}/{x}/{y}?v=0']);lastInfo={name,mode:m,state:'unavailable',error:error.message};report(lastInfo);}}
    }
    map.on('remove',()=>{epoch++;cancelLoading();wind.stop();worker.terminate();for(const job of pending.values()){job.cleanup();job.reject(new DOMException('Aborted','AbortError'));}pending.clear();pngCache.clear();renderKeys.clear();maplibregl.removeProtocol('envfield');});
    return {setMode,getMode:()=>current,setOpacity(value,name){if(current===name&&lastInfo?.state==='ready')map.setPaintProperty('environment','raster-opacity',Math.max(0,Math.min(1,value)));}};
  }
  return {mount,modes,color};
})();
