import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runHealth, summarizeHealth, reportIncident, healthSummary } from '../lib/interview-health.js';
function storage() {
  const values=new Map();
  return {values,async get(k){return values.get(k)??null;},async set(k,v,opts={}){if(opts.nx && values.has(k))return null;values.set(k,v);return 'OK';},async eval(_script,[key],[owner]){if(values.get(key)===owner)values.delete(key);return 1;}};
}
function fakeDB({fail,corrupt=false,deleteStuck=false}={}) {
  const rows=new Map(),runs=[],calls=[];let failed=false;
  return {rows,runs,calls,async rpc(name){calls.push(name);if(fail==='MAINTENANCE')throw new Error('raw sensitive error');},async call(path,opts={}){
    calls.push({path,method:opts.method});
    if(path==='database_health_runs'){runs.push(opts.body);return [opts.body];}
    const id=/id=eq\.([^&]+)/.exec(path)?.[1];
    if(opts.method==='POST') {rows.set(opts.body.id,opts.body);if(fail==='INSERTION')throw new Error('lost insert response');return [opts.body];}
    if(opts.method==='DELETE'){if(fail==='CLEANUP')throw new Error('delete failed');if(!deleteStuck)rows.delete(id);return [];}
    if(path.endsWith('limit=1')){if(fail==='CONNECTIVITY')throw new Error('db unavailable');return [];}
    if(fail==='READBACK'&&!failed){failed=true;throw new Error('read failed');}
    if(corrupt && path.includes('technical_value'))return [{technical_value:'incorrect'}];
    return rows.has(id)?[rows.get(id)]:[];
  }};
}
test('full probe inserts, reads integrity, deletes and confirms absence; no interview rows',async()=>{
  const db=fakeDB(),redis=storage();const result=await runHealth({db,redis,send:async()=>{}});
  assert.equal(result.status,'ok');assert.equal(result.deletion,true);assert.equal(db.rows.size,0);assert.equal(db.runs.length,1);assert.ok(result.duration_ms>=0);
  assert.equal(db.calls.some(x=>x.path?.includes('interview_requests')),false);assert.equal(redis.values.has('uev:interviews:health:lock'),false);
});
for(const failure of ['CONNECTIVITY','MAINTENANCE','INSERTION','READBACK','CLEANUP'])test(`probe handles ${failure}, sanitizes and cleans after uncertain writes`,async()=>{
  const db=fakeDB({fail:failure}),redis=storage();let alerts=0;
  const result=await runHealth({db,redis,send:async()=>{alerts++;}});
  assert.equal(result.status,'failed');assert.match(result.error_code,/^HEALTH_[A-Z_]+_FAILED$/);assert.equal(JSON.stringify(result).includes('raw sensitive'),false);assert.equal(alerts,1);
  if(failure!=='CLEANUP')assert.equal(db.rows.size,0);
});
test('integrity mismatch fails even if cleanup succeeds',async()=>{const db=fakeDB({corrupt:true});const result=await runHealth({db,redis:storage(),send:async()=>{}});assert.equal(result.status,'failed');assert.equal(result.error_code,'HEALTH_READBACK_FAILED');assert.equal(result.deletion,true);});
test('manual probe is read-only and cannot report full health as operational',async()=>{const db=fakeDB();const result=await runHealth({mode:'connectivity',db,redis:storage(),send:async()=>{}});assert.equal(result.connectivity,true);assert.equal(db.calls.some(c=>c.path==='database_health_checks' && c.method==='POST'),false);assert.equal(summarizeHealth(result).state,'unknown');});
test('distributed lock prevents overlapping probe; same completed daily slot returns cached result',async()=>{
  const redis=storage();await redis.set('uev:interviews:health:lock','other-owner');
  await assert.rejects(runHealth({db:fakeDB(),redis,send:async()=>{}}),e=>e.code==='HEALTH_BUSY');
  redis.values.clear();const db=fakeDB();const result=await runHealth({slot:'test-day',db,redis,send:async()=>{}});const again=await runHealth({slot:'test-day',db,redis,send:async()=>{}});assert.equal(result.id,again.id);assert.equal(db.runs.length,1);
});
test('history failure is logged externally and never marked operational',async()=>{
  const db=fakeDB();const call=db.call;db.call=async(path,opts)=>{if(path==='database_health_runs')throw new Error('offline');return call(path,opts);};
  const redis=storage(),result=await runHealth({db,redis,send:async()=>{}});assert.equal(result.status,'failed');assert.equal(result.error_code,'HEALTH_HISTORY_FAILED');assert.equal((await redis.get('uev:interviews:health:latest')).status,'failed');
});
test('alert suppression and controlled recovery use same incident',async()=>{
  const redis=storage(),mails=[];let now=100000000;const send=async mail=>{mails.push(mail);};
  await reportIncident({status:'failed'},{redis,send,now});await reportIncident({status:'failed'},{redis,send,now:now+60000});assert.equal(mails.length,1);
  await reportIncident({status:'ok'},{redis,send,now:now+120000});await reportIncident({status:'ok'},{redis,send,now:now+180000});assert.equal(mails.length,2);assert.match(mails[1].key,/recovery/);
});
test('freshness, recent failure and stale success are represented correctly',()=>{
  const now=Date.now(),stamp=hours=>new Date(now-hours*3600000).toISOString();
  assert.equal(summarizeHealth({mode:'full',status:'ok',finished_at:stamp(1)},null,now).state,'ok');
  assert.equal(summarizeHealth({mode:'full',status:'failed',finished_at:stamp(1)},stamp(2),now).state,'failed');
  assert.equal(summarizeHealth({mode:'full',status:'ok',finished_at:stamp(31)},null,now).state,'unknown');assert.equal(summarizeHealth(null,null,now).state,'unknown');
});
test('successful connectivity check never masks a failed full probe',async()=>{
  const now=Date.now(),full={mode:'full',status:'failed',finished_at:new Date(now-10000).toISOString()},probe={mode:'connectivity',status:'ok',finished_at:new Date(now).toISOString()};
  const redis=storage();await redis.set('uev:interviews:health:latest',probe);await redis.set('uev:interviews:health:latest-full',full);
  const db={call:async path=>path.includes('status=eq.ok')?[]:path.includes('mode=eq.full')?[full]:[probe]};
  assert.equal((await healthSummary({db,redis})).state,'failed');
});

test('DELETE success response is insufficient when confirmation still finds the record',async()=>{const result=await runHealth({db:fakeDB({deleteStuck:true}),redis:storage(),send:async()=>{}});assert.equal(result.status,'failed');assert.equal(result.deletion,false);assert.equal(result.error_code,'HEALTH_CLEANUP_FAILED');});
