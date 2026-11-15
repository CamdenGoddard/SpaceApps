// API fixtures are captured real responses; mocks below exercise failures only.
load('js/power.js');
const fixture=JSON.parse(readFile('tests/fixtures/power-annual-samples.json'));
function assert(ok,message){if(!ok)throw Error(message);print('PASS '+message);}
for(const year of [1981,1984,1989,1990,1994,1995,2000,2025]) {
 const row=fixture.records[year];
 for(const variable of PowerAPI.VARIABLES.filter(v=>v.startYear<=year)) {
  const series=PowerAPI.parseSeries(row.parameters[variable.id],row.fill);
  assert(series.years[0]===year&&Number.isFinite(series.values[0]),`${variable.id} real annual value for ${year}`);
 }
}
load('js/stats.js');
for(const id of ['T2M','RH2M','PRECTOTCORR','ALLSKY_SFC_SW_DWN']) {
  const full=PowerAPI.parseSeries(fixture.annual[id],-999);
  for(const year of [1981,1984,1985,1989,1990,1994,1995,2000,2025]) {
    const record=PowerAPI.historyRecord(full,id,year), start=PowerAPI.getVariable(id).startYear;
    const expected=Math.max(0,year-start+1);
    assert(record.series.years.length===expected&&record.series.years.every(y=>y<=year),`${id} cutoff ${year} uses only returned historical values`);
    const trend=record.canAnalyze?TrendStats.analyze(record.series.years,record.series.values):null;
    assert(expected>=10?trend?.n===expected:trend===null,`${id} cutoff ${year} separates data from trend eligibility`);
  }
}
const raw=fixture.records[1981];
const first=PowerAPI.parseSeries(raw.parameters.T2M,raw.fill);
const one=PowerAPI.historyRecord({...first,units:'°C',longname:'Temperature'},'T2M',1981);
assert(one.series.values[0]===9.02&&!one.canAnalyze&&one.message.includes('Not enough data for trend analysis. At least 10 annual observations required.'),'1981 observation displays while short-record trend is withheld');
const solar=PowerAPI.parseSeries(fixture.records[1984].parameters.ALLSKY_SFC_SW_DWN,-999);
const before=PowerAPI.historyRecord(solar,'ALLSKY_SFC_SW_DWN',1981);
assert(!before.series.years.length&&before.message.includes('starts in 1984'),'solar before coverage displays explicit unavailable message');
const gaps=PowerAPI.historyRecord({years:[1981,1995],values:[9.02,8.64]},'T2M',1990);
assert(gaps.series.years.length===1&&gaps.message.includes('No annual value available for 1990'),'missing selected year never replaced with an earlier observation');
const parsed=PowerAPI.parseSeries({'198113':-999,'199013':null,'199513':NaN,'202513':10.5},-999);
assert(parsed.years.join(',')==='2025','fill, null and nonfinite annual observations removed');
// Deterministic sample-count boundaries, independent of climate values.
const ten={years:Array.from({length:10},(_,i)=>1981+i),values:Array(10).fill(1)};
assert(!PowerAPI.historyRecord(ten,'T2M',1989).canAnalyze&&PowerAPI.historyRecord(ten,'T2M',1990).canAnalyze,'trend policy starts at ten real annual values rather than a fixed year');
class URLSearchParams {constructor(obj){this.obj=obj;}toString(){return Object.entries(this.obj).map(([k,v])=>k+'='+encodeURIComponent(v)).join('&');}}
let requested='';
async function fetch(url){requested=url;return {ok:true,json:async()=>({header:{fill_value:-999},properties:{parameter:{T2M:raw.parameters.T2M}},parameters:raw.units})};}
(async()=>{
 const result=await PowerAPI.fetchSeries('T2M',41.85,-87.65);
 assert(result.years[0]===1981&&requested.includes('/api/temporal/monthly/point?')&&requested.includes('start=1981'),'fetch client accepts a single real observation and uses monthly endpoint from 1981');
})().catch(e=>{print('FAIL '+e.message);quit(1);});
