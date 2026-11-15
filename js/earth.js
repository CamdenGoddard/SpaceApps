/* Native-resolution NASA imagery with per-tile UTC twilight compositing.
   No global city-light atlas and no artificial sharpening/glow. */
const EarthView = (() => {
  const TILE=256, MAX_Z=8, AMBIENT=[3,6,12];
  const url=(layer,matrix,date,z,x,y,ext)=>`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${layer}/default/${date}/${matrix}/${z}/${y}/${x}.${ext}`;
  function mount(map,report) {
    let time=new Date(),live=true,visible=true,revision=0,removed=false;
    let nightState='NASA VIIRS Earth at Night · 2012 · native detail tiles';
    const raw=new Map();let active=0;const waiting=[];
    function announce(){report({time,live,sun:Solar.position(time),night:nightState});}
    // Bound decoded tile memory (~24 MB) and network concurrency. Data tiles
    // survive minute-by-minute sunlight changes and repeated map movements.
    function fetchTile(key) {
      if(raw.has(key)){const p=raw.get(key);raw.delete(key);raw.set(key,p);return p;}
      const promise=(async()=>{
        if(active>=6)await new Promise(resolve=>waiting.push(resolve));active++;
        try{
          const res=await fetch(key,{signal:AbortSignal.timeout(20000)});if(!res.ok)throw Error(`NASA imagery ${res.status}`);
          const bitmap=await createImageBitmap(await res.blob());
          const c=document.createElement('canvas');c.width=c.height=TILE;
          const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(bitmap,0,0);bitmap.close();
          return ctx.getImageData(0,0,TILE,TILE).data;
        }finally{active--;waiting.shift()?.();}
      })();
      raw.set(key,promise);promise.catch(()=>raw.delete(key));
      while(raw.size>96)raw.delete(raw.keys().next().value);
      return promise;
    }
    const tileURL=()=>`earthshade://tiles/{z}/{x}/{y}?v=${revision}&t=${time.getTime()}`;
    maplibregl.addProtocol('earthshade',async({url:request},abort)=>{
      const parsed=new URL(request),[z,x,y]=parsed.pathname.slice(1).split('/').map(Number),n=2**z;
      const date=new Date(Number(parsed.searchParams.get('t'))),sun=Solar.position(date).vector;
      const cosLon=new Float64Array(TILE),sinLon=new Float64Array(TILE),cosLat=new Float64Array(TILE),sinLat=new Float64Array(TILE);
      let maxNight=0;
      for(let k=0;k<TILE;k++){
        const lon=((x+(k+.5)/TILE)/n*2-1)*Math.PI,lat=Math.atan(Math.sinh(Math.PI*(1-2*(y+(k+.5)/TILE)/n)));
        cosLon[k]=Math.cos(lon);sinLon[k]=Math.sin(lon);cosLat[k]=Math.cos(lat);sinLat[k]=Math.sin(lat);
      }
      // Include all tile rows/columns when deciding whether night data is needed.
      for(let j=0;j<TILE;j+=8)for(let i=0;i<TILE;i+=8){const dot=cosLat[j]*(cosLon[i]*sun[0]+sinLon[i]*sun[1])+sinLat[j]*sun[2];maxNight=Math.max(maxNight,.052-dot);}
      let lights=null;
      if(maxNight>0)try{lights=await fetchTile(url('VIIRS_CityLights_2012','GoogleMapsCompatible_Level8','default',z,x,y,'jpeg'));}
      catch(error){nightState='Night imagery unavailable in some tiles · ambient lighting retained';announce();}
      if(abort?.signal.aborted)throw new DOMException('Aborted','AbortError');
      const canvas=document.createElement('canvas');canvas.width=canvas.height=TILE;
      const ctx=canvas.getContext('2d'),image=ctx.createImageData(TILE,TILE),p=image.data;
      for(let j=0;j<TILE;j++){
        if(j%32===0){await new Promise(resolve=>setTimeout(resolve,0));if(abort?.signal.aborted)throw new DOMException('Aborted','AbortError');}
        for(let i=0;i<TILE;i++){
        const k=(j*TILE+i)*4,dot=cosLat[j]*(cosLon[i]*sun[0]+sinLon[i]*sun[1])+sinLat[j]*sun[2];
        const t=Math.max(0,Math.min(1,(.052-dot)/.157)),night=t*t*(3-2*t);
        const dark=night*.86,alpha=dark;
        for(let c=0;c<3;c++){
          const ambient=AMBIENT[c],light=lights?lights[k+c]*.82:0;
          p[k+c]=alpha?dark*(ambient+light*night)/alpha:0;
        }
        p[k+3]=Math.round(alpha*255);
      }
      }
      ctx.putImageData(image,0,0);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw Error('Lighting encoding unavailable');
      return {data:await blob.arrayBuffer()};
    });
    map.addSource('earth-lighting',{type:'raster',tiles:[tileURL()],tileSize:TILE/Math.min(window.devicePixelRatio||1,2),maxzoom:MAX_Z});
    map.addLayer({id:'earth-lighting',type:'raster',source:'earth-lighting',paint:{'raster-fade-duration':250,'raster-resampling':'linear'}},'continent-labels');
    function update(){if(removed)return;revision++;map.getSource('earth-lighting')?.setTiles([tileURL()]);announce();}
    let deferred=false;
    const timer=setInterval(()=>{
      if(!live||document.hidden)return;
      const refresh=()=>{deferred=false;if(!live||removed)return;time=new Date();update();};
      if(map.isMoving()){if(!deferred){deferred=true;map.once('moveend',refresh);}}else refresh();
    },60000);
    const wake=()=>{if(live&&!document.hidden&&!map.isMoving()){time=new Date();update();}};
    document.addEventListener('visibilitychange',wake);
    map.on('remove',()=>{document.removeEventListener('visibilitychange',wake);removed=true;clearInterval(timer);raw.clear();maplibregl.removeProtocol('earthshade');});
    announce();
    return {
      setTime(date){live=false;time=date;update();},setLive(){live=true;time=new Date();update();},
      setVisible(value){visible=value;map.setLayoutProperty('earth-lighting','visibility',visible?'visible':'none');},
      getTime:()=>time
    };
  }
  return {mount};
})();
