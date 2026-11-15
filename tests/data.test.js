// Run with JavaScriptCore from the project root. No network is used.
class URLSearchParams { constructor(obj){this.obj=obj;} set(k,v){this.obj[k]=v;} toString(){return Object.entries(this.obj).map(([k,v])=>k+'='+encodeURIComponent(v)).join('&');} }
const AbortSignal={timeout:()=>({}),any:()=>({})};
let requests=0,fail=false;
async function fetch(){requests++;return {ok:!fail,status:fail?503:200,json:async()=>({latitude:1,longitude:2,current:{time:'2026-01-01T00:00',temperature_2m:0,relative_humidity_2m:null},current_units:{temperature_2m:'°C'}})};}
load('js/environment-data.js');load('js/environment-layers.js');load('js/dashboard.js');
function assert(ok,msg){if(!ok)throw Error(msg);print('PASS '+msg);}
(async()=>{
  const first=await EnvironmentData.point(1,2),second=await EnvironmentData.point(1,2);
  assert(requests===1&&first===second,'point cache avoids duplicate API calls');
  assert(EnvironmentData.finite(first.current.temperature_2m),'zero is a valid measurement');
  assert(!EnvironmentData.finite(first.current.relative_humidity_2m),'null is unavailable, not zero');
  assert(first.time==='2026-01-01T00:00Z','valid time retained in UTC');
  fail=true;let failed=false;try{await EnvironmentData.point(3,4);}catch(e){failed=e.message.includes('503');}
  assert(failed,'provider HTTP failure is surfaced');
  failed=false;try{await EnvironmentData.grid();}catch(e){failed=e.message.includes('unavailable');}
  assert(failed,'total grid failure is unavailable, without synthetic samples');
  const m=EnvironmentLayers.modes.temperature;
  assert(EnvironmentLayers.color(-40,m)==='#5c9fff'&&EnvironmentLayers.color(40,m)==='#f26d66','temperature scale endpoints');
  assert(Dashboard.weatherName(95)==='Thunderstorm'&&Dashboard.weatherName(null)==='Unavailable','WMO codes and missing conditions');
})().catch(e=>{print('FAIL '+e.message);quit(1);});
