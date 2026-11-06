import {clean} from './core.mjs';

const GiB=2**30;
const finiteBytes=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
const label=value=>clean(value).replace(/[\r\n\t]/g,' ');
export const memorySize=value=>finiteBytes(value)?(value/GiB).toFixed(1)+' GiB':'unknown';
export const memoryRows=snapshot=>(snapshot.loadedModels||[]).map(row=>({...row}));

export function memoryStatus(snapshot={}, {demo=false}={}){
 const memory=snapshot.memory||{},rows=memoryRows(snapshot);
 const output=[demo?'MEMORY / sample data':'MEMORY / current TIM backend / /unload idle',
  `RAM total ${memorySize(memory.totalBytes??memory.total)} / available ${memorySize(memory.availableBytes??memory.free)}`,
  `Safety buffer ${memorySize(memory.reserveBytes)} / model budget ${memorySize(memory.modelBudgetBytes)}`,
  '/unload idle frees idle non-guide models; /unload N selects a row.'];
 if(memory.stale||memory.status==='stale')output.push('Memory reading is stale; run /memory again to refresh.');
 else if(memory.availableSource==='free-fallback'||memory.status==='fallback')output.push('Available RAM uses a conservative fallback reading.');
 output.push('');
 if(!rows.length)output.push('No TIM model processes are currently loaded.');
 for(const [index,row] of rows.entries()){
  const pin=row.role==='guide'?'protected guide':row.pinned===true?'pinned':row.pinned===false?'temporary':'pin status unknown';
  output.push(`${index+1}. ${label(row.name||row.modelId)} / ${label(row.role||'unknown role')} / PID ${Number.isInteger(row.pid)&&row.pid>0?row.pid:'unknown'} / ${pin}`);
  output.push(finiteBytes(row.rssBytes)?`   RSS measured: ${memorySize(row.rssBytes)}`:
   finiteBytes(row.estimatedBytes)?`   RSS unavailable; estimate ~${memorySize(row.estimatedBytes)} (not current usage)`:'   RSS unavailable; memory estimate unavailable.');
 }
 output.push('','RSS is resident process RAM, not the full unified/GPU memory footprint.',
  'Catalog RAM estimates describe requirements, not current usage.',
  'Unloading keeps model files and selected defaults; a later task can reload them.',
  'The guide stays loaded. Finish or cancel work before unloading.');
 return output.join('\n');
}

export function unloadSelection(args=[],shown=[]){
 if(!args.length||args.length===1&&args[0].toLowerCase()==='idle')return {scope:'idle'};
 if(args.length!==1||!/^\d+$/.test(args[0])||!Number.isSafeInteger(Number(args[0]))||Number(args[0])<1)throw new Error('Use /unload idle or /unload NUMBER from the last /memory list.');
 if(!shown.length)throw new Error('Run /memory first, then use /unload NUMBER from that loaded-process list.');
 const row=shown[Number(args[0])-1];
 if(!row)throw new Error('No loaded-process row numbered '+args[0]+'. Run /memory again.');
 if(row.role==='guide')throw new Error('The guide stays loaded. Use /unload idle to release idle non-guide models.');
 if(!['specialist','pipeline-agent','chat','code'].includes(row.role))throw new Error('This process cannot be unloaded individually. Finish its work and run /memory again.');
 if(typeof row.modelId!=='string'||!row.modelId||!Number.isInteger(row.pid)||row.pid<=0)throw new Error('This row has no verifiable process identity. Run /memory again or use /unload idle.');
 return {scope:'model',row:{...row}};
}
function assertIdle(snapshot={}){
 if(snapshot.loadingModel||snapshot.orchestrator?.status==='loading'||snapshot.localSetup?.status==='installing'||(snapshot.jobs||[]).some(job=>['queued','running'].includes(job.status)))throw new Error('Finish or cancel current work before unloading models.');
}
export async function readMemory(client){
 if(!client?.request)throw new Error('Connect to a TIM backend to inspect its model memory.');
 return client.request('setup/options');
}
export async function unloadMemory(client,{args=[],shown=[],snapshot={}}={}){
 const target=unloadSelection(args,shown);
 assertIdle(snapshot);
 const fresh=await readMemory(client);assertIdle(fresh);
 if(target.scope==='model'){
  const row=target.row;
  if(!memoryRows(fresh).some(current=>current.modelId===row.modelId&&current.pid===row.pid&&current.role===row.role))throw new Error('Loaded processes changed. Run /memory again before choosing a row to unload.');
  await client.request('models/unload',{id:row.modelId});
 }else await client.request('unload',{});
 return {snapshot:await readMemory(client),message:target.scope==='model'?'Unloaded idle non-guide processes for '+label(target.row.name||target.row.modelId)+'.':'Unloaded idle non-guide models.'};
}
