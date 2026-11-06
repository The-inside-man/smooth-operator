import crypto from 'node:crypto';
export const semanticCapabilityError='Semantic desktop control needs a trusted adapter with semanticVersion: 1, foregroundInput, emergencyStop and manualInputInterruption. Use the current UIA/AX/AT-SPI adapter or a trusted app adapter; window metadata alone cannot verify application tasks.';
export function validateProposal(p){
 const keys=['action','operation','elementId','value','expectedElementId','expectedProperty','expectedValue','reason'];
 if(!p||typeof p!=='object'||Object.keys(p).some(k=>!keys.includes(k))||keys.some(k=>!(k in p))||!['act','complete','clarify'].includes(p.action)||!['set_value','invoke','none'].includes(p.operation)||!['value','name','enabled'].includes(p.expectedProperty)||!['elementId','value','expectedElementId','expectedValue','reason'].every(k=>typeof p[k]==='string'&&p[k].length<=2000))throw new Error('Invalid typed desktop proposal; nothing executed.');
 if(p.action==='act'&&p.operation==='none'||p.action!=='act'&&p.operation!=='none')throw new Error('Desktop action/operation mismatch.');
 return structuredClone(p);
}
export function semanticObservation(raw,pid,window){
 if(!raw||raw.targetPid!==pid||typeof raw.targetWindow!=='string'||!raw.targetWindow||window&&raw.targetWindow!==window||raw.permissions!==true||!Array.isArray(raw.elements)||raw.elements.length>200)throw new Error('Semantic target changed, permission missing, or observation invalid.');
 const ids=new Set(),elements=[];
 for(const e of raw.elements){
  if(!e||typeof e.id!=='string'||!/^[A-Za-z0-9_.:-]{1,120}$/.test(e.id)||ids.has(e.id)||typeof e.name!=='string'||e.name.length>500||typeof e.role!=='string'||e.role.length>80||typeof e.enabled!=='boolean'||!Array.isArray(e.actions)||e.actions.some(a=>!['set_value','invoke'].includes(a))||!['local-edit','external','destructive','credentials','security','unclassified'].includes(e.risk))throw new Error('Invalid semantic element metadata.');
  ids.add(e.id);if(e.sensitive===true||e.risk==='credentials')continue;
  if(e.value!==undefined&&(typeof e.value!=='string'||e.value.length>2000))throw new Error('Semantic value too large.');
  elements.push({id:e.id,name:e.name,role:e.role,enabled:e.enabled,value:e.value||'',actions:e.actions,risk:e.risk});
 }
 return {targetPid:pid,targetWindow:raw.targetWindow,permissions:true,elements};
}
const matches=(obs,p)=>{const e=obs.elements.find(e=>e.id===p.expectedElementId);return !!e&&String(e[p.expectedProperty])===p.expectedValue;};
export async function runSemanticTask({task,targetPid,adapter,plan,review,signal,provider='local',modelId='',onStatus=()=>{},maxSteps=8,timeoutMs=120000}){
 if(typeof task!=='string'||!task.trim()||task.length>2000||!Number.isInteger(targetPid)||targetPid<=0)throw new Error('Supply a task and positive target PID.');
 const c=adapter.capabilities;if(c?.semanticVersion!==1||!c.foregroundInput||!c.emergencyStop||!c.manualInputInterruption)throw new Error(semanticCapabilityError);
 const controller=new AbortController(),combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
 const timer=setTimeout(()=>controller.abort(new Error('Desktop task time limit reached')),timeoutMs),history=[];let window;
 adapter.onInterrupt?.(()=>controller.abort(new Error('Desktop stopped by manual input or emergency stop')));
 const check=()=>combined.throwIfAborted();
 // Abort also terminates waits for model/review; a timed-out answer can never authorize an action.
 const bounded=fn=>new Promise((resolve,reject)=>{check();const abort=()=>reject(combined.reason||new Error('Desktop cancelled'));combined.addEventListener('abort',abort,{once:true});Promise.resolve().then(fn).then(resolve,reject).finally(()=>combined.removeEventListener('abort',abort));});
 const approve=async data=>{const token=crypto.randomBytes(12).toString('hex');check();const answer=await bounded(()=>review({...data,token},combined));check();if(answer!==token)throw new Error('Desktop approval declined; nothing further executed.');};
 const observe=async()=>{check();const obs=semanticObservation(await bounded(()=>adapter.observeSemantic(targetPid,combined)),targetPid,window);window||=obs.targetWindow;return obs;};
 try{
  await approve({kind:'task',task,targetPid,provider,modelId:modelId||'configured/loaded model',warning:'FOREGROUND CONTROL. Stop other typing during each approved action. Labels and non-sensitive field values are sent to the selected model. No screenshots. External/destructive/credential/security actions are blocked; unclassified controls need an additional exact review. Approval is bound to this task and PID for at most two minutes.'});
  let observation=await observe();
  for(let i=0;i<Math.min(maxSteps,8);i++){
   onStatus('Observing/planning desktop step '+(i+1)+' / '+provider+'/'+(modelId||'configured model')+' / no input until exact review');
   if(provider!=='local')await approve({kind:'cloud-observation',provider,task,targetPid,observation,warning:'Review this exact accessibility data before sending it to the selected cloud model. Decline if it contains private values. No screenshots are included.'});
   const proposal=validateProposal(await bounded(()=>plan({task,observation,history},combined)));
   if(proposal.action==='clarify')return {status:'clarification',message:proposal.reason,history};
   const target=observation.elements.find(e=>e.id===proposal.elementId);
   if(proposal.action==='act'&&(!target||!target.enabled||!['local-edit','unclassified'].includes(target.risk)||!target.actions.includes(proposal.operation)))throw new Error('Unsupported or sensitive action; separate manual workflow required.');
   if(!observation.elements.some(e=>e.id===proposal.expectedElementId))throw new Error('Verification element is absent.');
   if(proposal.action==='act'&&target.risk==='unclassified')await approve({kind:'unclassified-action',task,targetPid,targetWindow:window,target,proposal,warning:'The adapter cannot classify this control side effects. Inspect the actual app and approve this exact action separately. Payments, messages, deletion, credentials and security changes require a separate manual workflow.'});
   await approve({kind:proposal.action==='complete'?'outcome':'step',task,targetPid,targetWindow:window,proposal,target});
   const current=await observe();
   if(JSON.stringify(current)!==JSON.stringify(observation)){history.push({step:i+1,status:'changed-before-action'});observation=current;continue;}
   if(proposal.action==='complete'){
    if(!matches(current,proposal))throw new Error('Model completion claim does not match observed state.');
    return {status:'verified',message:'User-reviewed semantic outcome matches current adapter state.',history};
   }
   check();onStatus('CONTROL ACTIVE / '+proposal.operation+' / emergency stop available');
   // No retry of act: uncertain transport outcomes are observed/replanned, never blindly replayed.
   let result;
   try{result=await bounded(()=>adapter.actSemantic({targetPid,targetWindow:window,operation:proposal.operation,elementId:proposal.elementId,value:proposal.value},combined));}
   catch(error){check();await adapter.releaseAll();throw new Error('Action outcome uncertain; stopped without automatic retry: '+error.message);}
   check();observation=await observe();
   const verified=matches(observation,proposal);
   history.push({step:i+1,operation:proposal.operation,elementId:proposal.elementId,status:verified?'verified':'verification-failed'});
   if(result?.ok===false&&!result.recoverable)throw new Error('Adapter rejected action; stopped.');
   onStatus(verified?'Step verified against semantic state':'Expected state not reached; re-observing and requesting a fresh reviewed plan');
  }
  return {status:'limit',message:'Step limit reached; no completion claim.',history};
 }finally{clearTimeout(timer);controller.abort();await adapter.releaseAll().catch(()=>{});adapter.onInterrupt?.(null);onStatus('CONTROL STOPPED / input release requested');}
}
