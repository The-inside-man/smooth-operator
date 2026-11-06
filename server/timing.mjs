import {createHash} from 'node:crypto';
const MIN=5,MAX=20,BUCKETS=128,TTL=30*86400000;
const median=a=>a[Math.floor(a.length/2)];
export const timingKey=descriptor=>createHash('sha256').update(JSON.stringify(descriptor)).digest('hex');
// Bounded aggregate timing metadata only: no prompts, output, argv, credentials or job IDs.
export class TimingHistory {
 constructor(data,{wall=Date.now}={}){this.wall=wall;this.buckets=new Map();if(data?.version===1&&Array.isArray(data.buckets))for(const b of data.buckets.slice(-BUCKETS)){if(!/^[a-f0-9]{64}$/.test(b.key)||!Number.isFinite(b.updated)||this.wall()-b.updated>TTL||b.updated>this.wall()+60000||!Array.isArray(b.durations))continue;const durations=b.durations.filter(n=>Number.isFinite(n)&&n>=100&&n<=3600000).slice(-MAX);this.buckets.set(b.key,{updated:b.updated,durations});}}
 clear(){this.buckets.clear();}
 record(key,duration){if(!key||!Number.isFinite(duration)||duration<100||duration>3600000)return;const prior=this.buckets.get(key);const durations=prior&&this.wall()-prior.updated<=TTL?prior.durations:[];this.buckets.delete(key);this.buckets.set(key,{updated:this.wall(),durations:[...durations,duration].slice(-MAX)});while(this.buckets.size>BUCKETS)this.buckets.delete(this.buckets.keys().next().value);}
 estimate(key){const b=this.buckets.get(key);if(!b||this.wall()-b.updated>TTL||b.durations.length<MIN)return null;const sorted=[...b.durations].sort((a,b)=>a-b),center=median(sorted),mad=median(sorted.map(n=>Math.abs(n-center)).sort((a,b)=>a-b));const clean=sorted.filter(n=>Math.abs(n-center)<=Math.max(center*.5,mad*3));if(clean.length<MIN||clean.at(-1)>clean[0]*3)return null;return {basis:'comparable completed runs',samples:clean.length,confidence:clean.length>=12?'moderate':'low',lowMs:Math.floor(clean[0]*.8),highMs:Math.ceil(clean.at(-1)*1.2)};}
 export(){return {version:1,buckets:[...this.buckets].map(([key,value])=>({key,...value}))};}
}
export class TimedRun {
 constructor(history,key,{clock=()=>performance.now(),stallMs=60000}={}){this.history=history;this.key=key;this.clock=clock;this.stallMs=stallMs;this.start=this.last=clock();this.estimate=key?history.estimate(key):null;this.stalled=false;}
 touch(){const now=this.clock();if(now-this.last>=this.stallMs)this.stalled=true;this.last=now;}
 snapshot(){const now=this.clock(),elapsedMs=Math.max(0,now-this.start),lastActivityAgeMs=Math.max(0,now-this.last);if(lastActivityAgeMs>=this.stallMs)this.stalled=true;const eta=!this.stalled&&this.estimate&&elapsedMs<this.estimate.highMs?{...this.estimate,lowMs:Math.max(0,this.estimate.lowMs-elapsedMs),highMs:Math.max(0,this.estimate.highMs-elapsedMs)}:null;return {elapsedMs,lastActivityAgeMs,eta,etaReason:this.stalled?'activity stalled':!this.key?'unbounded or incomparable work':!this.estimate?'collecting comparable timings':!eta?'longer than historical range':null};}
 finish(status){const snapshot=this.snapshot();if(status==='completed'&&!this.stalled)this.history.record(this.key,snapshot.elapsedMs);return {...snapshot,eta:null,etaReason:status};}
}
// Free-form chat/build, listeners and arbitrary media durations lack a reliable comparison scope.
export function modelTimingKey(job,config,warm){if(!['install','listen','read'].includes(job.intentKind))return null;return timingKey({provider:job.provider||'local',model:job.modelId,operation:job.intentKind,inputSize:Math.ceil((job.settings?.prompt?.length||0)/1024),backend:job.provider&&job.provider!=='local'?'cloud':config.backend,context:config.context,maxTokens:config.maxTokens,warm:job.provider&&job.provider!=='local'?null:warm});}
