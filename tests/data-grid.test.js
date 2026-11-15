// Deterministic bulk API contract tests; no network or synthetic UI data.
class URLSearchParams {constructor(obj){this.obj=obj;}set(k,v){this.obj[k]=v;}toString(){return Object.entries(this.obj).map(([k,v])=>k+'='+encodeURIComponent(v)).join('&');}}
const AbortSignal={timeout:()=>({}),any:()=>({})};
const localStorage={getItem:()=>null,setItem:()=>{}};
let calls=[];
async function fetch(url){
 const q=Object.fromEntries(url.split('?')[1].split('&').map(p=>p.split('=').map(decodeURIComponent)));calls.push(q);
 const lat=q.latitude.split(',').map(Number),lon=q.longitude.split(',').map(Number);
 return {ok:true,json:async()=>lat.map((latitude,i)=>({latitude,longitude:lon[i],hourly_units:{temperature_2m:'°C',relative_humidity_2m:'%'},hourly:{time:[q.start_hour],temperature_2m:[i===0?null:12],relative_humidity_2m:[i===1?120:65]}}))};
}
load('js/environment-data.js');
function assert(ok,msg){if(!ok)throw Error(msg);print('PASS '+msg);}
(async()=>{
 const grid=await EnvironmentData.grid();
 assert(grid.samples.length===288&&calls.length===12,'all bulk request locations retained');
 assert(calls.every(q=>q.hourly&&q.start_hour===grid.validHour&&q.end_hour===grid.validHour&&!q.current),'all batches request one explicit hourly snapshot');
 assert(calls.every(q=>q.cell_selection==='nearest'&&q.temperature_unit==='celsius'),'ocean selection and temperature units explicitly requested');
 assert(grid.samples.every(s=>s.time===EnvironmentData.normalizeTime(grid.validHour)),'grid has one valid UTC time');
 assert(grid.samples.filter(s=>s.current.temperature_2m===null).length===12,'missing values remain unavailable');
 assert(grid.samples.filter(s=>s.current.relative_humidity_2m===null).length===12,'out-of-range humidity masked before interpolation');
 await EnvironmentData.grid();assert(calls.length===12,'shared forecast grid reused across modes');
})().catch(e=>{print('FAIL '+e.message);quit(1);});
