import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {localSetupStatus,startLocalSetup} from '../cli/local-setup.mjs';

const initial=()=>({config:{mainAgentModelId:''},models:[],engines:{},downloads:[],runtimeSetup:{status:'idle'},orchestrator:{status:'not-installed'},dataDir:'/fixture/tim-data',catalog:[{id:'qwen3-0.6b',name:'Qwen3 0.6B',kind:'chat',downloadBytes:396705472,defaultOrchestrator:true}]});
const ready=()=>({...initial(),config:{mainAgentModelId:'catalog:qwen3-0.6b'},models:[{id:'catalog:qwen3-0.6b',catalogId:'qwen3-0.6b',name:'Qwen3 0.6B',kind:'chat',available:true}],engines:{chat:{available:true}},runtimeSetup:{status:'ready'},orchestrator:{status:'running',loaded:true,modelId:'catalog:qwen3-0.6b'}});
function fixture(states,{before=initial(),setupError}={}){
 const calls=[];let started=false,index=0;
 return {calls,controller:new AbortController(),async request(route,body){
  calls.push({route,body});
  if(route==='rescan')return {ok:true};
  if(route==='setup'){if(setupError)throw new Error(setupError);started=true;return {ok:true};}
  if(route==='state')return structuredClone(started?states[Math.min(index++,states.length-1)]:before);
  throw new Error('Unexpected route: '+route);
 }};
}

test('local setup describes runtime download, verified installation, model progress, loading, and ready independently',()=>{
 assert.equal(localSetupStatus(initial()).phase,'waiting');
 assert.equal(localSetupStatus({...initial(),runtimeSetup:{status:'downloading',progress:32}}).phase,'downloading-engine');
 assert.equal(localSetupStatus({...initial(),runtimeSetup:{status:'downloading',progress:100,phase:'Installing verified engine'}}).phase,'installing-engine');
 const downloading=localSetupStatus({...initial(),downloads:[{catalogId:'qwen3-0.6b',status:'downloading',downloadedBytes:50,totalBytes:200}]});
 assert.equal(downloading.phase,'downloading-model');assert.equal(downloading.progress,25);
 assert.equal(localSetupStatus({...initial(),downloads:[{catalogId:'qwen3-0.6b',status:'verifying'}]}).phase,'verifying-model');
 assert.equal(localSetupStatus({...ready(),orchestrator:{status:'loading',modelId:'catalog:qwen3-0.6b',loaded:false}}).phase,'loading');
 assert.equal(localSetupStatus(ready()).ready,true);
 assert.equal(localSetupStatus({...ready(),orchestrator:{status:'running',modelId:'different-model',loaded:true}}).ready,false);
 assert.equal(localSetupStatus({...ready(),models:[{...ready().models[0],available:false}]}).ready,false);
});

test('starter setup explicitly starts once and reports engine, model, and loading progress until ready',async()=>{
 const states=[{...initial(),runtimeSetup:{status:'downloading',progress:20}},{...initial(),runtimeSetup:{status:'ready'},downloads:[{catalogId:'qwen3-0.6b',status:'downloading',downloadedBytes:100,totalBytes:200}]},{...ready(),orchestrator:{status:'loading',loaded:false}},ready()];
 const client=fixture(states),phases=[];
 const result=await startLocalSetup(client,{pollMs:1,onState:(_snapshot,status)=>phases.push(status.phase)});
 assert.equal(result.config.mainAgentModelId,'catalog:qwen3-0.6b');
 assert.deepEqual(client.calls.slice(0,4),[{route:'state',body:undefined},{route:'rescan',body:{}},{route:'state',body:undefined},{route:'setup',body:{}}]);
 assert.equal(client.calls.filter(call=>call.route==='setup').length,1);
 assert.deepEqual(phases,['waiting','downloading-engine','downloading-model','loading','ready']);
});

test('an existing ready model is reused without requesting a download or changing settings',async()=>{
 const client=fixture([],{before:ready()});
 assert.deepEqual(await startLocalSetup(client),ready());
 assert.deepEqual(client.calls.map(call=>call.route),['state','rescan','state']);
});

test('Chat and Code setup accept their selected model from a real guide-owned process',async()=>{
 for(const mode of ['chat','code']){
  const modelId=ready().models[0].id,catalogId=ready().models[0].catalogId;
  const snapshot={...ready(),localSetup:{catalogId,mode,status:'ready',explicit:true},loadedModels:[{modelId,role:'guide',pid:123}]};
  assert.equal(localSetupStatus(snapshot,{catalogId,mode}).ready,true);
  assert.equal(localSetupStatus({...snapshot,loadedModels:[]},{catalogId,mode}).ready,true,'running guide metadata is a supported fallback');
  for(const orchestrator of [{modelId,status:'ready',loaded:false},{modelId,status:'loading',loaded:false},{modelId,status:'running',loaded:false},{modelId,status:'error',error:'Load failed'},{modelId:'another-model',status:'running',loaded:true}]){
   assert.equal(localSetupStatus({...snapshot,loadedModels:[],orchestrator},{catalogId,mode}).ready,false,'indexed or failed guide metadata must not count as resident');
  }
  const client=fixture([snapshot],{before:ready()});
  const result=await startLocalSetup(client,{catalogId,mode,pollMs:1});
  assert.deepEqual(result,snapshot);assert.deepEqual(client.calls.find(call=>call.route==='setup').body,{catalogId,mode,installRuntime:true});
 }
});

test('configured installed model requests only runtime repair and retains its selection',async()=>{
 const before={...ready(),models:[{...ready().models[0],available:false}],engines:{},runtimeSetup:{status:'idle'},orchestrator:{status:'needs-runtime',error:'Chat engine required'}};
 const client=fixture([ready()],{before});await startLocalSetup(client,{pollMs:1});
 assert.deepEqual(client.calls.find(call=>call.route==='setup').body,{installRuntime:true});
 assert.equal(client.calls.filter(call=>call.route==='settings').length,0);
});

test('missing saved selection is preserved and setup gives a terminal recovery path',async()=>{
 const client=fixture([],{before:{...initial(),config:{mainAgentModelId:'missing-model'}}});
 await assert.rejects(startLocalSetup(client),/tim --library PATH.*select another model.*kept/);
 assert.equal(client.calls.filter(call=>['setup','settings'].includes(call.route)).length,0);
});

test('runtime, model transfer, paused download, and model load failures stop with retryable errors',async()=>{
 const failures=[
  {...initial(),runtimeSetup:{status:'error',error:'Fixture engine checksum failed'}},
  {...initial(),downloads:[{catalogId:'qwen3-0.6b',status:'failed',error:'Fixture model transfer failed'}]},
  {...initial(),downloads:[{catalogId:'qwen3-0.6b',status:'paused'}]},
  {...initial(),orchestrator:{status:'error',error:'Fixture model load failed'}},
 ];
 for(const state of failures){
  const client=fixture([state]);await assert.rejects(startLocalSetup(client,{pollMs:1}),/Fixture|download stopped/);
  assert.equal(client.calls.filter(call=>call.route==='setup').length,1,'failures must not silently retry');
 }
 const client=fixture([],{setupError:'Fixture request rejected'});await assert.rejects(startLocalSetup(client),/Fixture request rejected/);
});

test('previous setup error can be retried explicitly without replaying stale failures',async()=>{
 const client=fixture([ready()],{before:{...initial(),runtimeSetup:{status:'error',error:'Prior failed attempt'}}});
 assert.deepEqual(await startLocalSetup(client,{pollMs:1}),ready());
 assert.equal(client.calls.filter(call=>call.route==='setup').length,1);
});

test('setup waits through indexed ready state and surfaces a later model load failure',async()=>{
 const indexed={...ready(),orchestrator:{status:'ready',loaded:false}},failed={...indexed,orchestrator:{status:'error',error:'Fixture memory admission failed'}};
 const client=fixture([indexed,{...indexed,orchestrator:{status:'loading',loaded:false}},failed]);
 await assert.rejects(startLocalSetup(client,{pollMs:1}),/Fixture memory admission failed/);
 assert.equal(client.calls.filter(call=>call.route==='state').length,5,'all stages must be observed before completing');
});

test('setup refuses queued, running, or loading work before starting a rescan or download',async()=>{
 for(const busy of [{jobs:[{status:'queued'}]},{jobs:[{status:'running'}]},{loadingModel:true}]){
  const client=fixture([],{before:{...initial(),...busy}});
  await assert.rejects(startLocalSetup(client),/Finish or cancel current work/);
  assert.deepEqual(client.calls.map(call=>call.route),['state']);
 }
});

test('abort stops polling promptly without closing the shared client or changing backend state',async()=>{
 const controller=new AbortController(),client=fixture([initial()]);
 await assert.rejects(startLocalSetup(client,{signal:controller.signal,pollMs:1000,onState:(_state,status)=>{if(status.phase==='waiting'&&client.calls.some(call=>call.route==='setup'))controller.abort(new Error('Fixture cancelled'));}}),/Fixture cancelled/);
 const count=client.calls.length;await delay(30);assert.equal(client.calls.length,count);assert.equal(client.controller.signal.aborted,false);
 const stopped=new AbortController();stopped.abort(new Error('Fixture already cancelled'));
 const untouched=fixture([ready()]);await assert.rejects(startLocalSetup(untouched,{signal:stopped.signal}),/already cancelled/);assert.equal(untouched.calls.length,0);
});

test('abort can interrupt a pending backend request and setup has a finite timeout',async()=>{
 const controller=new AbortController(),client={async request(){return new Promise(()=>{});}};
 const pending=startLocalSetup(client,{signal:controller.signal});controller.abort(new Error('Fixture pending cancelled'));
 await assert.rejects(pending,/Fixture pending cancelled/);
 await assert.rejects(startLocalSetup(fixture([initial()]),{timeoutMs:15,pollMs:1000}),/longer than 30 minutes/);
});

const selectedId='qwen3-4b';
const withCatalog=state=>({...state,catalog:[...state.catalog,{id:selectedId,name:'Qwen3 4B',kind:'chat',downloadBytes:2500000000,memoryGB:4.5},{id:'image-model',name:'Image model',kind:'image'}]});
const selectedReady=()=>({...withCatalog(ready()),config:{mainAgentModelId:'catalog:'+selectedId},models:[...ready().models,{id:'catalog:'+selectedId,catalogId:selectedId,name:'Qwen3 4B',kind:'chat',available:true}],orchestrator:{modelId:'catalog:'+selectedId,status:'running',loaded:true},localSetup:{catalogId:selectedId,status:'ready',explicit:true}});

test('explicit setup downloads the chosen model and never returns the old ready default',async()=>{
 const before=withCatalog(ready()),installing={...before,localSetup:{catalogId:selectedId,status:'installing',explicit:true}};
 const downloading={...installing,downloads:[{catalogId:'qwen3-0.6b',status:'completed'},{catalogId:selectedId,status:'downloading',downloadedBytes:60,totalBytes:100}]};
 const beforeCommit={...selectedReady(),config:before.config,localSetup:installing.localSetup};
 const client=fixture([installing,downloading,beforeCommit,selectedReady()],{before}),reports=[];
 const result=await startLocalSetup(client,{catalogId:selectedId,pollMs:1,onState:(_state,status)=>reports.push(status)});
 assert.equal(result.config.mainAgentModelId,'catalog:'+selectedId);
 assert.deepEqual(client.calls.find(call=>call.route==='setup').body,{catalogId:selectedId,installRuntime:true});
 assert.equal(client.calls.filter(call=>call.route==='setup').length,1);
 assert.equal(reports.filter(status=>status.ready).length,1,'old guide and precommit target must not count as ready');
 assert.ok(reports.every(status=>status.entry.id===selectedId));
 assert.equal(reports.find(status=>status.phase==='downloading-model').progress,60);
 assert.equal(client.calls.filter(call=>call.route==='settings').length,0,'backend commits the choice only after successful setup');
});

test('explicit setup ignores stale old guide and prior transfer errors while the selected attempt installs',async()=>{
 const before={...withCatalog(initial()),config:{mainAgentModelId:'old-missing-model'},orchestrator:{status:'error',error:'Old default is unavailable'}};
 const retrying={...before,localSetup:{catalogId:selectedId,status:'installing',explicit:true},runtimeSetup:{status:'downloading',progress:10},downloads:[{catalogId:selectedId,status:'failed',error:'Previous transfer failed'}]};
 const status=localSetupStatus(retrying,{catalogId:selectedId});
 assert.equal(status.error,null);assert.equal(status.configuredMissing,false);assert.equal(status.phase,'downloading-engine');
 const client=fixture([retrying,selectedReady()],{before});
 assert.deepEqual(await startLocalSetup(client,{catalogId:selectedId,pollMs:1}),selectedReady());
});

test('selected attempt failure is returned even while the old model remains ready',async()=>{
 const before=withCatalog(ready()),failed={...before,localSetup:{catalogId:selectedId,status:'error',explicit:true,error:'Chosen model does not fit current memory'}};
 const client=fixture([failed],{before});
 await assert.rejects(startLocalSetup(client,{catalogId:selectedId,pollMs:1}),/Chosen model does not fit current memory/);
 assert.equal(before.config.mainAgentModelId,'catalog:qwen3-0.6b');
 assert.equal(client.calls.filter(call=>call.route==='setup').length,1,'a model failure cannot select a fallback');
});

test('explicitly selecting the already configured ready model reuses it',async()=>{
 const client=fixture([],{before:selectedReady()});
 assert.deepEqual(await startLocalSetup(client,{catalogId:selectedId}),selectedReady());
 assert.equal(client.calls.filter(call=>call.route==='setup').length,0);
});

test('unsupported, non-chat, and malformed selections never start setup',async()=>{
 for(const catalogId of ['missing','image-model','',null,{}]){
  const client=fixture([],{before:withCatalog(initial())});
  await assert.rejects(startLocalSetup(client,{catalogId}),/supported chat model/);
  assert.equal(client.calls.filter(call=>['setup','rescan'].includes(call.route)).length,0);
 }
});

test('another active catalog setup is not silently replaced',async()=>{
 const before={...withCatalog(initial()),localSetup:{catalogId:'qwen3-0.6b',status:'installing',explicit:true}},client=fixture([],{before});
 await assert.rejects(startLocalSetup(client,{catalogId:selectedId}),/Finish the current local model setup/);
 assert.deepEqual(client.calls.map(call=>call.route),['state']);
});

const specialistReady=mode=>({...selectedReady(),config:ready().config,orchestrator:ready().orchestrator,loadedModelId:'catalog:'+selectedId,loadedModels:[{modelId:'catalog:'+selectedId,role:'specialist'}],localSetup:{catalogId:selectedId,mode,status:'ready',explicit:true}});

test('Chat and Code setup load the requested specialist without replacing the Agent',async()=>{
 for(const mode of ['chat','code']){
  const before=withCatalog(ready()),installed={...specialistReady(mode),localSetup:{catalogId:selectedId,mode,status:'installing',explicit:true},loadedModelId:null,loadedModels:[{modelId:before.config.mainAgentModelId,role:'guide'}]};
  const markerBeforeLoad={...installed,localSetup:{...installed.localSetup,status:'ready'}};
  const wrongMode={...specialistReady(mode),localSetup:{catalogId:selectedId,mode:mode==='chat'?'code':'chat',status:'ready'}};
  const client=fixture([installed,markerBeforeLoad,wrongMode,specialistReady(mode)],{before}),reports=[];
  const result=await startLocalSetup(client,{catalogId:selectedId,mode,pollMs:1,onState:(_state,status)=>reports.push(status)});
  assert.deepEqual(client.calls.find(call=>call.route==='setup').body,{catalogId:selectedId,installRuntime:true,mode});
  assert.equal(result.config.mainAgentModelId,before.config.mainAgentModelId);assert.deepEqual(result.orchestrator,before.orchestrator);
  assert.equal(result.loadedModelId,'catalog:'+selectedId);assert.equal(reports.filter(status=>status.ready).length,1);
  assert.equal(client.calls.filter(call=>call.route==='settings').length,0);
 }
});

test('non-Agent readiness accepts the matching loaded specialist and excludes guide-only rows',()=>{
 for(const mode of ['chat','code']){
  const result=specialistReady(mode);
  assert.equal(localSetupStatus(result,{catalogId:selectedId,mode}).ready,true);
  const rowsOnly={...result,loadedModelId:null};
  assert.equal(localSetupStatus(rowsOnly,{catalogId:selectedId,mode}).ready,true);
  assert.equal(localSetupStatus({...rowsOnly,loadedModels:[{modelId:'catalog:'+selectedId,role:'guide'}]},{catalogId:selectedId,mode}).ready,false);
  assert.equal(localSetupStatus({...result,localSetup:{...result.localSetup,mode:'agent'}},{catalogId:selectedId,mode}).ready,false);
  assert.equal(localSetupStatus({...result,models:result.models.filter(model=>model.catalogId!==selectedId)},{catalogId:selectedId,mode}).ready,false);
 }
});

test('matching Chat and Code setup failures surface even when the Agent is running',async()=>{
 for(const mode of ['chat','code']){
  const before=withCatalog(ready()),failed={...before,localSetup:{catalogId:selectedId,mode,status:'error',error:'Fixture specialist loading failed'}};
  const client=fixture([failed],{before});
  await assert.rejects(startLocalSetup(client,{catalogId:selectedId,mode,pollMs:1}),/Fixture specialist loading failed/);
  assert.equal(client.calls.filter(call=>call.route==='setup').length,1);
 }
});

test('setup cannot silently join the same catalog model in another mode',async()=>{
 const before={...withCatalog(initial()),localSetup:{catalogId:selectedId,mode:'chat',status:'installing'}};
 const client=fixture([],{before});
 await assert.rejects(startLocalSetup(client,{catalogId:selectedId,mode:'code'}),/Finish the current local model setup/);
 assert.deepEqual(client.calls.map(call=>call.route),['state']);
});

test('invalid setup modes and non-Agent requests without a catalog choice are rejected before requests',async()=>{
 for(const options of [{mode:'image',catalogId:selectedId},{mode:'chat'},{mode:'code'}]){
  const client=fixture([],{before:withCatalog(initial())});
  await assert.rejects(startLocalSetup(client,options),/Agent, Chat, or Code|supported chat model/);
  assert.equal(client.calls.length,0);
 }
});
