const starter = Object.freeze({id:'qwen3-0.6b',name:'Qwen3 0.6B',downloadBytes:396705472,memoryGB:1.6});
const finite = value => typeof value==='number'&&Number.isFinite(value);
const percentage = value => finite(value)?Math.max(0,Math.min(100,value)):null;
const failureStates = new Set(['failed','cancelled','paused']);

export function setupBytes(value){
 if(!finite(value)||value<0)return 'size unknown';
 if(value<1_000_000)return `${Math.round(value/1000)} KB`;
 if(value<1_000_000_000)return `${Math.round(value/1_000_000)} MB`;
 return `${(value/1_000_000_000).toFixed(1)} GB`;
}

// A snapshot is sufficient to describe setup; this function never starts work.
export function localSetupStatus(snapshot={}, {catalogId:requestedId,mode='agent'}={}){
 const configuredId=snapshot.config?.mainAgentModelId||'';
 const explicit=requestedId!==undefined,specialist=mode==='chat'||mode==='code';
 const model=(snapshot.models||[]).find(item=>item.kind==='chat'&&(explicit?item.catalogId===requestedId||item.id==='catalog:'+requestedId:item.id===configuredId));
 const entry=(snapshot.catalog||[]).find(item=>item.id===(explicit?requestedId:model?.catalogId))||
  (explicit?{id:requestedId,name:requestedId,kind:'chat'}:(snapshot.catalog||[]).find(item=>item.defaultOrchestrator)||starter);
 const catalogId=explicit?requestedId:model?.catalogId||(!configuredId?entry.id:configuredId.startsWith('catalog:')?configuredId.slice(8):'');
 const download=[...(snapshot.downloads||[])].reverse().find(item=>item.catalogId===catalogId);
 const runtime=snapshot.runtimeSetup||{},guide=snapshot.orchestrator||{};
 const setup=snapshot.localSetup?.catalogId===catalogId&&(snapshot.localSetup.mode||'agent')===mode?snapshot.localSetup:null;
 const runtimeAvailable=Boolean(snapshot.engines?.chat?.available);
 const configuredMissing=Boolean(!specialist&&!explicit&&configuredId&&!model);
 const targetLoaded=Boolean(model&&(snapshot.loadedModelId===model.id||(snapshot.loadedModels||[]).some(loaded=>loaded.modelId===model.id&&['specialist','chat','code'].includes(loaded.role))));
 const base={configuredId,configuredMissing,catalogId,mode,model,entry,download,runtime,setup,targetLoaded,dataDir:snapshot.dataDir||'',runtimeAvailable,ready:false,error:null,progress:null};
 // An explicit attempt preserves the prior default until warm-up succeeds.
 // Its old errors (and a previous failed download) must not abort the retry.
 const error=explicit&&setup?.status==='error'?setup.error||'The selected model could not be set up. Press Enter to retry.':
  explicit&&setup?.status==='installing'?null:
  runtime.status==='error'&&!specialist&&(!explicit||configuredId===model?.id)?runtime.error||'Chat engine setup failed.':
  failureStates.has(download?.status)?download.error||'The model download stopped. Press Enter to retry.':
  !specialist&&(!explicit||configuredId===model?.id)?guide.error||(guide.status==='error'?'The local model could not start. Press Enter to retry.':null):null;
 if(configuredMissing)return {...base,phase:'error',title:'Selected model unavailable',error:'Your selected agent is not installed in this library. Reconnect it with tim --library PATH, or return to Models and select another model. Your saved selection has been kept.'};
 if(error)return {...base,phase:'error',title:'Local setup needs attention',error};
 if(runtime.status==='downloading')return {...base,phase:runtime.phase?'installing-engine':'downloading-engine',title:runtime.phase||'Downloading chat engine',progress:percentage(runtime.progress)};
 if(download&&['queued','downloading','verifying'].includes(download.status))return {...base,phase:download.status==='verifying'?'verifying-model':'downloading-model',title:download.status==='verifying'?'Verifying model files':explicit?'Downloading selected model':'Downloading starter model',progress:finite(download.totalBytes)&&download.totalBytes>0?percentage(download.downloadedBytes/download.totalBytes*100):null};
 if(specialist&&model?.available&&runtimeAvailable&&setup?.status==='ready'&&targetLoaded)return {...base,phase:'ready',title:`Local ${mode==='code'?'Code':'Chat'} model is ready`,ready:true,progress:100};
 if(!specialist&&model?.available&&runtimeAvailable&&(!explicit||configuredId===model.id)&&(!guide.modelId||guide.modelId===configuredId)&&(guide.loaded||['ready','running'].includes(guide.status)))return {...base,phase:'ready',title:'Local chat is ready',ready:true,progress:100};
 if(!specialist&&guide.status==='loading'||explicit&&setup?.status==='installing'&&download?.status==='completed')return {...base,phase:'loading',title:'Loading model into memory'};
 return {...base,phase:'waiting',title:model?'Preparing selected model':'Ready to install local chat'};
}

function abortReason(signal){return signal.reason||new DOMException('Setup monitoring cancelled.','AbortError');}
function checkSignal(signal){if(signal.aborted)throw abortReason(signal);}
function abortable(operation,signal){
 checkSignal(signal);
 return new Promise((resolve,reject)=>{
  const abort=()=>reject(abortReason(signal));signal.addEventListener('abort',abort,{once:true});
  Promise.resolve(operation).then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
 });
}
function pause(milliseconds,signal){
 checkSignal(signal);
 return new Promise((resolve,reject)=>{
  const abort=()=>{clearTimeout(timer);reject(abortReason(signal));};
  const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},milliseconds);
  signal.addEventListener('abort',abort,{once:true});
 });
}

// Uses the authenticated local Client. Cancelling stops monitoring, not a shared
// backend's download, so another screen can reconnect to the same setup safely.
export async function startLocalSetup(client,{catalogId,mode='agent',signal,onState=()=>{},pollMs=500,timeoutMs=30*60*1000}={}){
 if(!client?.request)throw new Error('Connect to the local TIM backend before starting setup.');
 if(!finite(timeoutMs)||timeoutMs<=0)throw new Error('Setup timeout must be positive.');
 if(!['agent','chat','code'].includes(mode))throw new Error('Choose Agent, Chat, or Code mode for local setup.');
 if(catalogId!==undefined&&(typeof catalogId!=='string'||!catalogId))throw new Error('Choose a supported chat model from the local setup catalog.');
 if(mode!=='agent'&&catalogId===undefined)throw new Error('Choose a supported chat model from the local setup catalog.');
 const timeout=new AbortController(),timer=setTimeout(()=>timeout.abort(new Error('Setup is taking longer than 30 minutes. Return to Models and retry to check its progress; any backend download may still be running.')),timeoutMs);
 const combined=AbortSignal.any([timeout.signal,...(signal?[signal]:[]),...(client.controller?.signal?[client.controller.signal]:[])]);
 const request=(route,body)=>{checkSignal(combined);return abortable(client.request(route,body),combined);};
 const report=snapshot=>{const status=localSetupStatus(snapshot,{catalogId,mode});onState(snapshot,status);return status;};
 try{
  const before=await request('state');
  if(before.loadingModel||(before.jobs||[]).some(job=>['queued','running'].includes(job.status)))throw new Error('Finish or cancel current work before starting local setup.');
  if(catalogId!==undefined&&!(before.catalog||[]).some(entry=>entry.id===catalogId&&entry.kind==='chat'))throw new Error('Choose a supported chat model from the local setup catalog.');
  if(catalogId!==undefined&&before.localSetup?.status==='installing'&&(before.localSetup.catalogId!==catalogId||(before.localSetup.mode||'agent')!==mode))throw new Error('Finish the current local model setup before choosing another model.');
  await request('rescan',{});
  let snapshot=await request('state'),status=report(snapshot);
  if(status.configuredMissing)throw new Error(status.error);
  if(status.ready)return snapshot;
  await request('setup',catalogId!==undefined?{catalogId,installRuntime:true,...(mode==='agent'?{}:{mode})}:status.model&&!status.runtimeAvailable?{installRuntime:true}:{});
  while(true){
   snapshot=await request('state');status=report(snapshot);
   if(status.error)throw new Error(status.error);
   // After initiating setup, wait for the actual warm-up. A newly indexed model
   // can briefly appear ready before its memory or engine load is validated.
   if(status.ready&&(mode!=='agent'||snapshot.orchestrator?.loaded||snapshot.orchestrator?.status==='running'))return snapshot;
   await pause(Math.max(1,Math.min(1000,finite(pollMs)?pollMs:500)),combined);
  }
 }finally{clearTimeout(timer);}
}
