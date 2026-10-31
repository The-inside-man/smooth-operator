import test from 'node:test';
import assert from 'node:assert/strict';
import {TimingHistory,TimedRun,timingKey,modelTimingKey} from '../server/timing.mjs';
import {activity} from '../cli/activity.mjs';
const key=timingKey({provider:'openai',model:'fixture',operation:'read'});
function train(history,key=keyPlaceholder,durations=[10000,11000,9000,10500,10000]){for(const duration of durations)history.record(key,duration);}
const keyPlaceholder=key;
test('cold start, sufficient comparable samples and bounded rolling metadata',()=>{
 const h=new TimingHistory(null,{wall:()=>1000});for(let i=0;i<4;i++)h.record(key,10000);assert.equal(h.estimate(key),null);h.record(key,10000);assert.deepEqual(h.estimate(key),{basis:'comparable completed runs',samples:5,confidence:'low',lowMs:8000,highMs:12000});
 for(let i=0;i<100;i++)h.record(key,10000);assert.equal(h.estimate(key).samples,20);assert.equal(h.estimate(key).confidence,'moderate');const saved=h.export();assert.ok(!JSON.stringify(saved).includes('fixture'));assert.equal(new TimingHistory(saved,{wall:()=>1000}).estimate(key).samples,20);
 for(let i=0;i<150;i++)h.record(timingKey({i}),1000);assert.equal(h.export().buckets.length,128);
});
test('outliers, unstable durations, expiry, malformed history and explicit reset',()=>{
 const h=new TimingHistory(null,{wall:()=>1000});train(h);h.record(key,900000);assert.ok(h.estimate(key).highMs<15000);assert.equal(h.estimate(key).samples,5);
 const unstable=new TimingHistory();train(unstable,key,[1000,2000,10000,20000,30000]);assert.equal(unstable.estimate(key),null);
 assert.equal(new TimingHistory(h.export(),{wall:()=>1000+31*86400000}).estimate(key),null);assert.equal(new TimingHistory({version:1,buckets:[{key:'invalid',durations:['secret'],updated:1}]}).export().buckets.length,0);h.clear();assert.equal(h.estimate(key),null);
});
test('monotonic range declines without negative countdown; overrun is unavailable',()=>{
 let now=0,wall=100000;const h=new TimingHistory(null,{wall:()=>wall});train(h,key,[10000,10000,10000,10000,10000]);const run=new TimedRun(h,key,{clock:()=>now});now=3000;wall=-900000;run.touch();const s=run.snapshot();assert.equal(s.elapsedMs,3000);assert.equal(s.eta.lowMs,5000);assert.equal(s.eta.highMs,9000);
 const job={status:'running',timing:{...s,observedAt:10000}};assert.match(activity(job,12000).eta,/3-7s remaining/);assert.match(activity(job,21000).eta,/unavailable/);now=13000;assert.equal(run.snapshot().eta,null);assert.match(run.snapshot().etaReason,/longer/);
});
test('cancelled, failed and any stalled run never trains the estimator, including resumed output',()=>{
 for(const status of ['cancelled','failed','timed out']){let now=0;const h=new TimingHistory();const r=new TimedRun(h,key,{clock:()=>now});now=10000;r.finish(status);assert.equal(h.export().buckets.length,0);}
 let now=0;const h=new TimingHistory();train(h);const r=new TimedRun(h,key,{clock:()=>now});now=61000;assert.equal(r.snapshot().eta,null);r.touch();now=62000;r.finish('completed');assert.equal(h.estimate(key).samples,5);
 const gap=new TimedRun(h,key,{clock:()=>now});now+=61000;gap.touch();gap.finish('completed');assert.equal(h.estimate(key).samples,5);
});
test('provider/model/operation/input-size/warmness changes isolate history; unbounded work has no estimate',()=>{
 const config={backend:'cpu',context:4096,maxTokens:1024},job={provider:'openai',modelId:'selected',intentKind:'read',settings:{prompt:'not stored'}};
 const a=modelTimingKey(job,config,false);for(const change of [{provider:'xai'},{modelId:'different'},{intentKind:'install'},{settings:{prompt:'x'.repeat(4096)}}])assert.notEqual(modelTimingKey({...job,...change},config,false),a);
 assert.notEqual(modelTimingKey({...job,provider:'local'},config,true),modelTimingKey({...job,provider:'local'},config,false));assert.equal(modelTimingKey({...job,intentKind:undefined},config,false),null);assert.equal(modelTimingKey({...job,intentKind:'build'},config,false),null);
 const h=new TimingHistory();train(h,a);assert.equal(h.estimate(modelTimingKey({...job,provider:'xai'},config,false)),null);const r=new TimedRun(h,null);assert.equal(r.snapshot().eta,null);
});
