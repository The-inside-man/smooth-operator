import {useEffect,useState} from 'react';
const epoch=Date.now(),origin=performance.now();
export const clockNow=()=>epoch+performance.now()-origin;
export const observeJob=job=>({...job,...(job.timing?{timing:{...job.timing,observedAt:clockNow()}}:{}),...(job.phaseTiming?{phaseTiming:{...job.phaseTiming,observedAt:clockNow()}}:{})});
export function useClock(enabled=true){const [now,setNow]=useState(clockNow);useEffect(()=>{if(!enabled)return;const timer=setInterval(()=>setNow(clockNow()),1000);return()=>clearInterval(timer);},[enabled]);return now;}
export function activity(job,now=clockNow()){
 const start=Number(job?.startedAt)||Date.parse(job?.createdAt)||now,end=Number(job?.finishedAt)||now;
 const live=['running','queued','listening','starting'].includes(job?.status),t=job?.timing;
 const since=value=>live&&value?.observedAt?Math.max(0,now-value.observedAt):0;
 const elapsed=Math.max(0,Math.floor(t?(t.elapsedMs+since(t))/1000:(end-start)/1000));
 const last=Number(job?.lastActivityAt),age=t?Math.floor((t.lastActivityAgeMs+since(t))/1000):last?Math.max(0,Math.floor((end-last)/1000)):null;
 const basis=job?.phaseTiming||t,e=basis?.eta,advance=since(basis),stale=age!==null&&age>=60;
 const high=e?Math.max(0,e.highMs-advance):0,low=e?Math.max(0,e.lowMs-advance):0;
 const eta=live&&!stale&&e&&high>0?'ETA ~'+(job?.phaseTiming?'load ':'')+Math.floor(low/1000)+'-'+Math.ceil(high/1000)+'s remaining (historical, '+e.confidence+' confidence, n='+e.samples+')':'ETA unavailable';
 return {elapsed,age,stale,eta,text:'elapsed '+elapsed+'s | activity '+(age===null?'unknown':age+'s ago')+' | '+eta,heartbeat:'UI clock only; worker liveness unconfirmed'};
}
export function selection(options={},env=process.env){const provider=options.provider||env.TIM_PROVIDER||'local',modelId=options.model||env.TIM_MODEL||'';if(!['local','openai','xai'].includes(provider))throw new Error('Provider must be local, openai or xai.');if(provider!=='local'&&!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/.test(modelId))throw new Error('Choose --model ID (or TIM_MODEL) for the selected cloud provider.');return {provider,modelId};}
export const boundary=s=>s?.provider&&s.provider!=='local'?s.provider+'/'+s.modelId+' / sends typed conversation & planning requests to cloud; files and packet bytes stay local':'local / configured model';
