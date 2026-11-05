import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {PassThrough,Writable} from 'node:stream';
import {setTimeout as delay} from 'node:timers/promises';
import {render} from 'ink';
import {App} from '../cli/app.mjs';
import {clean} from '../cli/core.mjs';
import {TerminalBoundary} from '../cli/terminal-boundary.mjs';
import {catalogModels} from '../server/catalog.mjs';

const catalog=catalogModels.filter(entry=>entry.kind==='chat'),targetId='qwen3-4b',target=catalog.find(entry=>entry.id===targetId),targetNumber=String(catalog.findIndex(entry=>entry.id===targetId)+1);
const empty=()=>({config:{mainAgentModelId:''},models:[],sessions:[{id:'fixture-session',title:'New session',messages:[]}],jobs:[],engines:{},downloads:[],runtimeSetup:{status:'idle'},orchestrator:{status:'not-installed'},dataDir:'/fixture/tim-data',catalog:structuredClone(catalog),memory:{totalBytes:32*2**30,availableBytes:24*2**30,reserveBytes:4*2**30,modelBudgetBytes:20*2**30,sampledAt:Date.now(),stale:false,status:'ok',availableSource:'os'},hardware:{platform:'darwin',arch:'arm64',cpuName:'Fixture CPU',logicalCores:8}});
const ready=(catalogId=targetId)=>{
 const entry=catalog.find(item=>item.id===catalogId),modelId='catalog:'+catalogId;
 return {...empty(),config:{mainAgentModelId:modelId},models:[{id:modelId,catalogId,name:entry.name,kind:'chat',available:true}],engines:{chat:{available:true}},runtimeSetup:{status:'ready'},orchestrator:{status:'running',loaded:true,modelId},localSetup:{catalogId,status:'ready'}};
};

// Exercises real App routing/input with an in-memory backend. No API key,
// download, model inference or filesystem configuration is used.
async function mount({initialRequest='',startSetup=false,selection={provider:'local'},holdSetup=false,setupError,initialState=empty()}={}){
 let state=structuredClone(initialState),watchState,releaseSetup,output='',quits=0;
 const calls=[],selections=[],stdin=new PassThrough();
 stdin.isTTY=true;stdin.ref=()=>stdin;stdin.unref=()=>stdin;stdin.setRawMode=()=>stdin;
 const stdout=new Writable({write(chunk,_encoding,done){output+=chunk;done();}});
 stdout.isTTY=true;stdout.columns=110;stdout.rows=38;
 const client={selection:{...selection},controller:new AbortController(),
  async watch(callback){
   watchState=callback;client.watchController=new AbortController();
   return new Promise(resolve=>client.watchController.signal.addEventListener('abort',resolve,{once:true}));
  },
  async request(route,body){
   calls.push({route,body:structuredClone(body)});
   if(route==='state'||route==='setup/options')return structuredClone(state);
   if(route==='rescan')return {ok:true};
   if(route==='setup'){
    if(holdSetup)await new Promise(resolve=>{releaseSetup=resolve;});
    if(setupError)throw new Error(setupError);
    return {ok:true};
   }
   if(route==='sessions')return structuredClone(state.sessions[0]);
   if(route==='jobs')throw new Error('FIXTURE_JOB_REJECTED');
   throw new Error('Unexpected fixture route: '+route);
  },
 };
 const ui=render(React.createElement(TerminalBoundary,null,React.createElement(App,{client,initial:structuredClone(state),initialRequest,startSetup,animation:false,onQuit:()=>{quits++;},onSelection:async value=>selections.push(structuredClone(value))})),{stdin,stdout,stderr:stdout,exitOnCtrlC:false,patchConsole:false});
 const exited=ui.waitUntilExit();
 const wait=async(predicate,label)=>{
  for(let attempt=0;attempt<180;attempt++){if(predicate())return;await delay(25);}
  assert.fail(label+'\n'+clean(output).slice(-6000));
 };
 await wait(()=>output.length>0&&typeof watchState==='function','initial App render and event watcher');await delay(80);
 return {calls,selections,client,get output(){return clean(output);},get quits(){return quits;},
  async key(value){const offset=output.length;stdin.write(value);await delay(100);return clean(output.slice(offset));},
  async push(snapshot){state=structuredClone(snapshot);watchState(structuredClone(state));await delay(90);},
  finishSetupRequest(){assert.equal(typeof releaseSetup,'function','setup request must already be pending');releaseSetup();},
  wait,
  async close(){ui.unmount();await exited;ui.cleanup();client.controller.abort();stdin.destroy();stdout.destroy();},
 };
}

test('empty-model provider help switches providers and returns to the saved request without model/API calls',async()=>{
 const request='Keep this original request 界',app=await mount({initialRequest:request});
 try{
  assert.match(app.output,/TIM \/ MODELS/);assert.match(app.output,/Your request is saved/);
  const openai=await app.key('P');assert.match(openai,/TIM \/ CLOUD PROVIDERS/);assert.match(openai,/CHATGPT \/ OPENAI SETUP/);
  assert.match(await app.key('\t'),/GROK \/ XAI SETUP/);
  assert.match(await app.key('\t'),/CLAUDE \/ ANTHROPIC SETUP/);
  assert.match(await app.key('\x1b'),/TIM \/ MODELS/);
  const composer=await app.key('\x1b');assert.match(composer,/COMMAND/);assert.ok(composer.includes(request));
  assert.equal(app.calls.length,0);assert.equal(app.selections.length,0);
 }finally{await app.close();}
});

test('S browses catalog choices, Enter opens review and Escape returns without downloads or losing the draft',async()=>{
 const request='Retain my setup request',app=await mount({initialRequest:request});
 try{
  const list=await app.key('S');assert.match(list,/TIM \/ LOCAL SETUP/);assert.match(list,/Number \+ Enter review/);
  assert.match(app.output,/Qwen3 4B/);assert.match(app.output,/SUGGESTED/);assert.ok(app.calls.some(call=>call.route==='setup/options'));
  assert.equal(app.calls.filter(call=>call.body!==undefined).length,0,'reading choices must not mutate the backend');
  await app.key(targetNumber);const review=await app.key('\r');assert.match(review,/REVIEW \/ Qwen3 4B/);
  assert.match(review,/Enter start setup/);assert.equal(app.calls.filter(call=>call.route==='setup').length,0);
  const backToCatalog=await app.key('\x1b');assert.match(backToCatalog,/Number \+ Enter review/);assert.doesNotMatch(backToCatalog,/TIM \/ MODELS/);
  assert.match(await app.key('\x1b'),/TIM \/ MODELS/);
  const composer=await app.key('\x1b');assert.ok(composer.includes(request));assert.equal(app.calls.filter(call=>call.body!==undefined).length,0);
 }finally{await app.close();}
});

test('setup survives parent event updates, returns to the preserved draft, and sends only after a separate Enter',async()=>{
 const request='Keep the request through engine and model setup',app=await mount({initialRequest:request,holdSetup:true});
 try{
  await app.key('s');await app.key(targetNumber);const review=await app.key('\r');assert.match(review,/REVIEW \/ Qwen3 4B/);
  assert.equal(app.calls.filter(call=>call.route==='setup').length,0,'first Enter reviews without starting setup');
  await app.key('\r');
  await app.wait(()=>app.calls.some(call=>call.route==='setup'),'explicit setup request');
  assert.deepEqual(app.calls.filter(call=>call.route==='setup').map(call=>call.body),[{catalogId:targetId,installRuntime:true}]);
  await app.push({...empty(),localSetup:{catalogId:targetId,status:'installing'},runtimeSetup:{status:'downloading',progress:25}});
  app.finishSetupRequest();
  await app.wait(()=>app.output.includes('Downloading chat engine'),'engine progress after parent update');
  await app.push({...empty(),localSetup:{catalogId:targetId,status:'installing'},runtimeSetup:{status:'ready'},engines:{chat:{available:true}},downloads:[{catalogId:targetId,status:'downloading',downloadedBytes:100,totalBytes:200}]});
  await app.wait(()=>app.output.includes('50%'),'model transfer progress');
  await app.push({...ready('qwen3-0.6b'),localSetup:{catalogId:targetId,status:'installing'}});await delay(600);
  assert.equal(app.selections.length,0,'a different ready starter must never finish the chosen larger-model setup');
  await app.push({...ready(),localSetup:{catalogId:targetId,status:'installing'},orchestrator:{status:'loading',loaded:false,modelId:'catalog:'+targetId}});
  await app.wait(()=>app.output.includes('Loading model into memory'),'model loading progress');
  await app.push(ready());
  await app.wait(()=>app.selections.length===1&&app.output.includes('Local model ready: '+target.name),'setup completion back in composer');
  assert.deepEqual(app.selections,[{provider:'local',modelId:'catalog:'+targetId}]);
  assert.deepEqual(app.client.selection,{provider:'local',modelId:'catalog:'+targetId});
  assert.equal(app.calls.filter(call=>call.route==='setup').length,1);
  assert.equal(app.calls.filter(call=>call.route==='jobs').length,0,'completing setup must not submit or plan the draft');
  assert.ok(app.output.includes(request));
  await app.key('\r');await app.wait(()=>app.calls.some(call=>call.route==='jobs'),'separate explicit request submission');
  const jobs=app.calls.filter(call=>call.route==='jobs');assert.equal(jobs.length,1);
  assert.equal(jobs[0].body.provider,'local');assert.equal(jobs[0].body.modelId,'catalog:'+targetId);
  assert.ok(jobs[0].body.prompt.includes(JSON.stringify(request)),'the original request reaches the planning job');
  assert.match(app.output,/FIXTURE_JOB_REJECTED/);
 }finally{await app.close();}
});

test('startSetup opens the catalog directly and requires separate model review and setup confirmation',async()=>{
 const request='A request from tim setup',app=await mount({initialRequest:request,startSetup:true});
 try{
  assert.match(app.output,/TIM \/ LOCAL SETUP/);assert.doesNotMatch(app.output,/TIM \/ MODELS/);
  assert.ok(app.calls.some(call=>call.route==='setup/options'));assert.equal(app.calls.filter(call=>call.body!==undefined).length,0);
  await app.push(empty());assert.equal(app.calls.filter(call=>call.body!==undefined).length,0);
  await app.key(targetNumber);assert.match(await app.key('\r'),/REVIEW \/ Qwen3 4B/);
  assert.equal(app.calls.filter(call=>call.route==='setup').length,0);
  await app.key('\r');await app.wait(()=>app.calls.some(call=>call.route==='setup'),'startSetup explicit review confirmation');
  assert.equal(app.calls.filter(call=>call.route==='setup').length,1);assert.equal(app.calls.filter(call=>call.route==='jobs').length,0);
  await app.push(ready());await app.wait(()=>app.selections.length===1,'startSetup completion');
  assert.ok(app.output.includes(request));assert.equal(app.calls.filter(call=>call.route==='jobs').length,0);
 }finally{await app.close();}
});

test('a failed larger-model setup stays selected and never silently starts the compact starter',async()=>{
 const request='Keep my larger model choice',app=await mount({initialRequest:request,setupError:'Fixture larger model download failed'});
 try{
  await app.key('s');await app.key(targetNumber);await app.key('\r');await app.key('\r');
  await app.wait(()=>app.output.includes('Fixture larger model download failed'),'chosen model failure');
  await delay(550);
  assert.deepEqual(app.calls.filter(call=>call.route==='setup').map(call=>call.body),[{catalogId:targetId,installRuntime:true}]);
  assert.equal(app.selections.length,0);assert.equal(app.calls.filter(call=>call.route==='jobs').length,0);
  assert.match(app.output,/REVIEW \/ Qwen3 4B/);assert.match(app.output,/Enter retry/);
  await app.key('\r');await app.wait(()=>app.calls.filter(call=>call.route==='setup').length===2,'explicit retry of chosen larger model');
  assert.deepEqual(app.calls.filter(call=>call.route==='setup').map(call=>call.body),[{catalogId:targetId,installRuntime:true},{catalogId:targetId,installRuntime:true}]);
 }finally{await app.close();}
});

test('an explicit cloud session rejects local /setup and still opens /providers without backend requests',async()=>{
 const app=await mount({selection:{provider:'anthropic',modelId:'fixture-cloud-model'}});
 try{
  assert.doesNotMatch(app.output,/TIM \/ MODELS/);assert.match(app.output,/ANTHROPIC \/ CLOUD/);
  await app.key('/setup');const rejected=await app.key('\r');
  assert.match(rejected,/Run tim setup from your shell/);assert.doesNotMatch(rejected,/TIM \/ LOCAL SETUP/);
  assert.equal(app.calls.length,0);
  await app.key('\x15');await app.key('/providers');
  const guide=await app.key('\r');assert.match(guide,/TIM \/ CLOUD PROVIDERS/);assert.match(guide,/CLAUDE \/ ANTHROPIC SETUP/);
  assert.equal(app.calls.length,0);assert.equal(app.selections.length,0);
 }finally{await app.close();}
});

for(const mode of ['chat','code'])test(`choosing a download in /models preserves ${mode} mode and the saved request through exact-model setup`,async()=>{
 const request=`Keep this ${mode} request through a larger-model download`,initialState=ready('qwen3-0.6b');
 const app=await mount({initialState,selection:{provider:'local',modelId:'not-installed'},initialRequest:mode==='chat'?request:''});
 try{
  if(mode==='code'){
   await app.key('\x1b');await app.key('/mode code');await app.key('\r');
   await app.key(request);assert.match(await app.key('\r'),/TIM \/ MODELS/);
  }
  assert.match(app.output,/15 chat models \/ 1 available \/ 14 downloadable/);assert.match(app.output,/Qwen3 4B.*download/);
  await app.key(targetNumber);const review=await app.key('\r');assert.match(review,/REVIEW \/ Qwen3 4B/);
  assert.match(review,/Enter start setup/);assert.doesNotMatch(review,/Number \+ Enter review/,'download selection opens its review directly');
  assert.equal(app.calls.filter(call=>call.route==='setup').length,0);assert.equal(app.calls.filter(call=>call.route==='jobs').length,0);
  await app.key('\r');await app.wait(()=>app.calls.some(call=>call.route==='setup'),'model picker explicit setup confirmation');
  assert.deepEqual(app.calls.filter(call=>call.route==='setup').map(call=>call.body),[{catalogId:targetId,installRuntime:true,mode}]);
  const completed=ready();completed.models=[...initialState.models,...completed.models];
  completed.config={...initialState.config};completed.orchestrator={...initialState.orchestrator};
  completed.loadedModelId='catalog:'+targetId;completed.loadedModels=[{modelId:'catalog:'+targetId,role:mode}];
  completed.localSetup={catalogId:targetId,status:'ready',mode};await app.push(completed);
  await app.wait(()=>app.selections.length===1&&app.output.includes('Local model ready: '+target.name),'downloadable model ready in composer');
  assert.equal(app.calls.filter(call=>call.route==='jobs').length,0,'setup completion does not send the original draft');
  assert.ok(app.output.includes(request));assert.deepEqual(app.selections,[{provider:'local',modelId:'catalog:'+targetId}]);
  // Ink can write a frame just before committing its replacement input handler.
  await delay(100);
  await app.key('\r');await app.wait(()=>app.calls.some(call=>call.route==='jobs'),'separate Enter sends the saved request');
  const jobs=app.calls.filter(call=>call.route==='jobs');assert.equal(jobs.length,1);assert.equal(jobs[0].body.modelId,'catalog:'+targetId);
  assert.equal(jobs[0].body.kind,mode);assert.ok(jobs[0].body.prompt.includes(mode==='chat'?JSON.stringify(request):request));
 }finally{await app.close();}
});
