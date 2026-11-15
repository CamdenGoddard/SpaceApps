// Exercise asynchronous mode ownership, cleanup and provider failure.
let timerID=0;const timers=new Map();
function setTimeout(fn){timers.set(++timerID,fn);return timerID;}function clearTimeout(id){timers.delete(id);}
class DOMException extends Error {constructor(message,name){super(message);this.name=name;}}
class Worker {postMessage(m){if(m.type==='field')Promise.resolve().then(()=>this.onmessage({data:{type:'ready',revision:m.revision}}));}terminate(){}}
const maplibregl={addProtocol(){},removeProtocol(){}};
const WindParticles={create:()=>({stop(){},setField(){},getCount:()=>1200})};
const sample={lat:7.5,lon:7.5,time:'2026-01-01T00:00:00Z',current:{temperature_2m:10,relative_humidity_2m:50,pm2_5:5}};
const grid={samples:[sample],total:288,step:15,retrieved:'test'};
let next=()=>Promise.resolve(grid);
const EnvironmentData={grid:()=>next(),finite:Number.isFinite};
load('js/environment-layers.js');
const handlers=new Map(),paint={},tiles=[];
const map={addSource(){},addLayer(){},setPaintProperty(id,key,value){paint[key]=value;},getSource(){return {setTiles(urls){tiles.push(urls[0]);if(!urls[0].endsWith('v=0'))Promise.resolve().then(()=>handlers.get('sourcedata')?.({sourceId:'environment',isSourceLoaded:true}));}};},on(e,f){handlers.set(e,f);},off(e,f){if(handlers.get(e)===f)handlers.delete(e);},isSourceLoaded(){return true;}};
function assert(ok,msg){if(!ok)throw Error(msg);print('PASS '+msg);}
(async()=>{
 const reports=[],layers=EnvironmentLayers.mount(map,x=>reports.push(x));
 await layers.setMode('humidity');
 assert(reports.at(-1).state==='ready'&&paint['raster-opacity']===.52,'successful new field fades in after source loads');
 next=()=>Promise.reject(Error('provider offline'));await layers.setMode('pollution');
 assert(reports.at(-1).state==='unavailable'&&paint['raster-opacity']===0&&tiles.at(-1).endsWith('v=0'),'provider failure removes old field and reports unavailable');
 let release;next=()=>new Promise(r=>release=r);const stale=layers.setMode('pollution');
 next=()=>Promise.resolve(grid);await layers.setMode('humidity');release(grid);await stale;
 assert(layers.getMode()==='humidity'&&reports.at(-1).name==='humidity'&&reports.at(-1).state==='ready','late pollution response cannot replace active humidity');
 layers.setOpacity(.9,'pollution');assert(paint['raster-opacity']===.52,'stale opacity control cannot alter active mode');
 await layers.setMode('earth');assert(paint['raster-opacity']===0&&tiles.at(-1).endsWith('v=0'),'Earth removes environmental tiles');
 assert(!handlers.has('sourcedata')&&timers.size===0,'source listeners and renderer timers cleaned up');
})().catch(e=>{print('FAIL '+e.message);quit(1);});
