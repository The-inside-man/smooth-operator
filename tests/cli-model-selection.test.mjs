import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {PassThrough,Writable} from 'node:stream';
import {setTimeout as delay} from 'node:timers/promises';
import {render} from 'ink';
import {App} from '../cli/app.mjs';
import {clean,demoState} from '../cli/core.mjs';
import {TerminalBoundary} from '../cli/terminal-boundary.mjs';
import {catalogModels} from '../server/catalog.mjs';

const models=[
 {id:'alpha',name:'Alpha available',kind:'chat',available:true},
 {id:'beta',name:'Beta available',kind:'chat',available:true},
];

async function mount({modelList=models,mainAgentModelId='',initialRequest='',selection={provider:'local'},failFirstSave=false,rescanModels,catalog=[],memory,setupResult}={}) {
 const state=structuredClone({...demoState,models:modelList,config:{mainAgentModelId},catalog,memory}),calls=[],selections=[];
 const stdin=new PassThrough();stdin.isTTY=true;stdin.ref=()=>stdin;stdin.unref=()=>stdin;stdin.setRawMode=()=>stdin;
 let output='',saves=0,quits=0;
 const stdout=new Writable({write(chunk,_encoding,done){output+=chunk;done();}});stdout.isTTY=true;stdout.columns=110;stdout.rows=38;
 const client={selection:{...selection},controller:new AbortController(),
  async watch(){return new Promise(()=>{});},
  async request(route,body){
   calls.push({route,body:structuredClone(body)});
   if(route==='state'||route==='setup/options')return structuredClone(state);
   if(route==='rescan'){
    if(rescanModels)state.models=structuredClone(rescanModels);
    return {ok:true};
   }
   if(route==='settings'){
    saves++;
    if(failFirstSave&&saves===1)throw new Error('FIXTURE_SELECTION_SAVE_FAILED');
    state.config={...state.config,...body};return structuredClone(state.config);
   }
   if(route==='setup'){
    if(!setupResult)throw new Error('Unexpected fixture setup');
    Object.assign(state,structuredClone(setupResult));return {ok:true};
   }
   if(route==='sessions')return structuredClone(state.sessions[0]);
   if(route==='jobs')throw new Error('FIXTURE_JOB_REJECTED');
   throw new Error('Unexpected fixture route: '+route);
  },
 };
 const ui=render(React.createElement(TerminalBoundary,null,React.createElement(App,{client,initial:structuredClone(state),initialRequest,animation:false,onQuit:()=>{quits++;},onSelection:async value=>selections.push({...value})})),{stdin,stdout,stderr:stdout,exitOnCtrlC:false,patchConsole:false});
 const exited=ui.waitUntilExit();
 const wait=async(predicate,label)=>{
  for(let attempt=0;attempt<120;attempt++){if(predicate())return;await delay(25);}
  assert.fail(label+'\n'+clean(output).slice(-5500));
 };
 await wait(()=>output.length>0,'initial render');await delay(80);
 return {calls,selections,state,client,get output(){return clean(output);},get quits(){return quits;},
  async key(value){const offset=output.length;stdin.write(value);await delay(90);return clean(output.slice(offset));},
  wait,
  async close(){ui.unmount();await exited;ui.cleanup();client.controller.abort();stdin.destroy();stdout.destroy();},
 };
}

test('missing local model opens choices; arrows persist agent choice and Enter only returns to composer',async()=>{
 const app=await mount();
 try{
  assert.match(app.output,/TIM \/ MODELS/);assert.match(app.output,/Alpha available/);assert.match(app.output,/Beta available/);
  assert.equal(app.calls.filter(c=>c.route==='jobs').length,0);
  await app.key('\x1b[B');const afterChoice=await app.key('\r');
  assert.deepEqual(app.calls.filter(c=>c.route==='settings').map(c=>c.body),[{mainAgentModelId:'beta'}]);
  assert.match(afterChoice,/COMMAND/);assert.equal(app.calls.filter(c=>c.route==='jobs').length,0,'choosing a model must not send a request');
  await app.key('hello after choosing');await app.key('\r');
  const jobs=app.calls.filter(c=>c.route==='jobs');assert.equal(jobs.length,1);assert.equal(jobs[0].body.prompt,'hello after choosing');assert.equal(jobs[0].body.kind,'agent');
  assert.equal(app.selections.length,0,'agent choice persists through settings rather than the Chat preference');
 }finally{await app.close();}
});

test('Escape and repeated missing-model submission preserve multiline Unicode draft until a separate send',async()=>{
 const app=await mount();
 try{
  assert.match(await app.key('\x1b'),/COMMAND/);
  await app.key('\x1b[200~');await app.key('Hey 界\nsecond line');await app.key('\x1b[201~');
  assert.match(await app.key('\r'),/TIM \/ MODELS/);assert.equal(app.calls.filter(c=>c.route==='jobs').length,0);
  assert.match(await app.key('\x1b'),/second line/);await app.key('!');
  assert.match(await app.key('\r'),/TIM \/ MODELS/);await app.key('\r');
  assert.equal(app.calls.filter(c=>c.route==='jobs').length,0,'selection leaves the preserved draft for review');
  await app.key('\r');const jobs=app.calls.filter(c=>c.route==='jobs');
  assert.equal(jobs.length,1);assert.equal(jobs[0].body.prompt,'Hey 界\nsecond line!');
 }finally{await app.close();}
});

test('empty and unavailable local model lists give library guidance without consuming drafts or starting jobs',async()=>{
 for(const modelList of [[],[{id:'missing',name:'Missing local weights',kind:'chat',available:false,issue:'Model file is missing'}]]){
  const app=await mount({modelList});
  try{
   assert.match(app.output,/TIM \/ MODELS/);assert.match(app.output,/--library/);
   await app.key('\r');assert.equal(app.calls.length,0,'no selection or inference request is possible');
   await app.key('\x1b');await app.key('retain this request');assert.match(await app.key('\r'),/TIM \/ MODELS/);
   assert.match(await app.key('\x1b'),/retain this request/);assert.equal(app.calls.length,0);
   await app.key('\x11');assert.equal(app.quits,1);
  }finally{await app.close();}
 }
});

test('one-shot natural request waits for a model choice and a separate Enter before planning once',async()=>{
 const request='check port 999',app=await mount({initialRequest:request});
 try{
  assert.match(app.output,/TIM \/ MODELS/);assert.equal(app.calls.length,0,'initial request must not plan before model selection');
  assert.match(await app.key('\r'),/check port 999/);assert.equal(app.calls.filter(c=>c.route==='jobs').length,0);
  await app.key('\r');await app.wait(()=>app.calls.some(c=>c.route==='jobs'),'natural planning request');
  const jobs=app.calls.filter(c=>c.route==='jobs');assert.equal(jobs.length,1);assert.equal(jobs[0].body.intentKind,'general');assert.equal(jobs[0].body.modelId,'alpha');assert.ok(jobs[0].body.prompt.includes(JSON.stringify(request)));
  assert.match(app.output,/FIXTURE_JOB_REJECTED/);
 }finally{await app.close();}
});

test('failed selection remains in the model picker and retries without submitting',async()=>{
 const app=await mount({failFirstSave:true});
 try{
  const failed=await app.key('\r');assert.match(failed,/TIM \/ MODELS/);assert.match(failed,/FIXTURE_SELECTION_SAVE_FAILED/);
  assert.equal(app.calls.filter(c=>c.route==='settings').length,1);assert.equal(app.calls.filter(c=>c.route==='jobs').length,0);
  assert.match(await app.key('\r'),/COMMAND/);assert.equal(app.calls.filter(c=>c.route==='settings').length,2);assert.equal(app.calls.filter(c=>c.route==='jobs').length,0);
 }finally{await app.close();}
});

test('configured local model remains usable and /models explicitly opens the chooser',async()=>{
 const app=await mount({mainAgentModelId:'alpha'});
 try{
  assert.doesNotMatch(app.output,/TIM \/ MODELS/);assert.match(app.output,/COMMAND/);
  await app.key('/models');assert.match(await app.key('\r'),/TIM \/ MODELS/);
  await app.key('\x1b[B');await app.key('\r');
  assert.deepEqual(app.calls.filter(c=>c.route==='settings').map(c=>c.body),[{mainAgentModelId:'beta'}]);assert.equal(app.calls.filter(c=>c.route==='jobs').length,0);
 }finally{await app.close();}
});

test('unavailable explicit Chat selection opens choices and persists only the Chat preference',async()=>{
 const app=await mount({selection:{provider:'local',modelId:'no-longer-installed'}});
 try{
  assert.match(app.output,/TIM \/ MODELS/);await app.key('\x1b[B');await app.key('\r');
  assert.deepEqual(app.selections,[{provider:'local',modelId:'beta'}]);assert.equal(app.calls.filter(c=>c.route==='settings').length,0);
  assert.equal(app.calls.filter(c=>c.route==='jobs').length,0);await app.key('chat with the selected model');await app.key('\r');
  const jobs=app.calls.filter(c=>c.route==='jobs');assert.equal(jobs.length,1);assert.equal(jobs[0].body.kind,'chat');assert.equal(jobs[0].body.modelId,'beta');
 }finally{await app.close();}
});

test('invalid typed model number cannot select until arrow navigation resets the choice',async()=>{
 const app=await mount();
 try{
  assert.match(await app.key('999'),/No model numbered 999/);await app.key('\r');
  assert.equal(app.calls.filter(c=>c.route==='settings').length,0);assert.equal(app.calls.filter(c=>c.route==='jobs').length,0);
  await app.key('\x1b[B');assert.match(await app.key('\r'),/COMMAND/);
  assert.deepEqual(app.calls.filter(c=>c.route==='settings').map(c=>c.body),[{mainAgentModelId:'beta'}]);
 }finally{await app.close();}
});

test('refresh keeps the highlighted model identity when discovery changes the model order',async()=>{
 const app=await mount({rescanModels:[models[1],models[0]]});
 try{
  await app.key('\x1b[B');await app.key('\x12');
  assert.equal(app.calls.filter(c=>c.route==='rescan').length,1);assert.equal(app.calls.filter(c=>c.route==='settings').length,0);
  await app.key('\r');
  assert.deepEqual(app.calls.filter(c=>c.route==='settings').map(c=>c.body),[{mainAgentModelId:'beta'}],'a reordered catalog must not select a different model');
  assert.equal(app.calls.filter(c=>c.route==='jobs').length,0);
 }finally{await app.close();}
});

test('explicit cloud selection bypasses local model choices and keeps the requested provider',async()=>{
 const app=await mount({modelList:[],selection:{provider:'openai',modelId:'cloud-fixture'}});
 try{
  assert.doesNotMatch(app.output,/TIM \/ MODELS/);assert.match(app.output,/OPENAI \/ CLOUD/);
  await app.key('hello cloud fixture');await app.key('\r');
  const jobs=app.calls.filter(c=>c.route==='jobs');assert.equal(jobs.length,1);assert.equal(jobs[0].body.provider,'openai');assert.equal(jobs[0].body.modelId,'cloud-fixture');
  assert.equal(app.calls.filter(c=>c.route==='settings').length,0);assert.equal(app.selections.length,0);
 }finally{await app.close();}
});

const fullCatalog=catalogModels.filter(entry=>entry.kind==='chat'),starter=fullCatalog.find(entry=>entry.id==='qwen3-0.6b'),larger=fullCatalog.find(entry=>entry.id==='qwen3-4b');
const freshMemory=()=>({totalBytes:32*2**30,availableBytes:24*2**30,reserveBytes:4*2**30,modelBudgetBytes:20*2**30,sampledAt:Date.now(),stale:false,status:'ok',availableSource:'os'});
const installedStarter=()=>({id:'catalog:'+starter.id,catalogId:starter.id,name:starter.name,kind:'chat',available:true});

test('/models mixes the installed current starter with the other fourteen downloadable catalog models',async()=>{
 const app=await mount({modelList:[installedStarter()],mainAgentModelId:'catalog:'+starter.id,selection:{provider:'local',modelId:'catalog:'+starter.id},catalog:fullCatalog,memory:freshMemory()});
 try{
  await app.key('/models');const list=await app.key('\r');
  assert.match(list,/TIM \/ MODELS/);assert.match(list,/15 chat models \/ 1 available \/ 14 downloadable/);
  assert.match(list,/Qwen3 0\.6B.*\[CURRENT\].*installed/);assert.match(list,/Qwen3 4B.*download/);
  assert.match(list,/Qwen2\.5 Coder 7B.*download/);assert.match(list,/SUGGESTED/);
  await app.key('\x12');assert.equal(app.calls.filter(call=>call.route==='rescan').length,1);
  assert.equal(app.calls.filter(call=>call.route==='setup/options').length,1,'refresh samples the catalog and system memory together');
  const selected=await app.key('\r');assert.match(selected,/COMMAND/);assert.doesNotMatch(selected,/TIM \/ LOCAL SETUP/);
  assert.equal(app.calls.filter(call=>call.route==='setup').length,0,'selecting an installed model must not download anything');
  assert.deepEqual(app.selections,[{provider:'local',modelId:'catalog:'+starter.id}]);
 }finally{await app.close();}
});

for(const command of ['model','agent'])test(`/${command} uses the displayed combined numbering even when imported models precede catalog rows`,async()=>{
 const imported={id:'my-imported-model',name:'My imported model',kind:'chat',available:true},starterModel=installedStarter();
 const selectedModel={id:'catalog:'+larger.id,catalogId:larger.id,name:larger.name,kind:'chat',available:true};
 const selectedMode=command==='agent'?'agent':'chat',mainAgentModelId=selectedMode==='agent'?selectedModel.id:starterModel.id;
 const setupResult={models:[imported,starterModel,selectedModel],config:{mainAgentModelId},catalog:fullCatalog,engines:{chat:{available:true}},runtimeSetup:{status:'ready'},orchestrator:{status:'running',loaded:true,modelId:mainAgentModelId},loadedModelId:selectedModel.id,loadedModels:[{modelId:selectedModel.id,role:selectedMode}],localSetup:{catalogId:larger.id,status:'ready',mode:selectedMode}};
 const app=await mount({modelList:[imported,starterModel],mainAgentModelId:starterModel.id,selection:{provider:'local',modelId:starterModel.id},catalog:fullCatalog,memory:freshMemory(),setupResult});
 try{
  await app.key('/models');const list=await app.key('\r');
  assert.match(list,/16 chat models \/ 2 available \/ 14 downloadable/);
  assert.match(list,/1\. My imported model.*installed/);assert.match(list,/4\. Qwen3 4B.*download/);
  await app.key('\x1b');await app.key('/'+command+' 4');const review=await app.key('\r');
  assert.match(review,/REVIEW \/ Qwen3 4B/);assert.match(review,/Enter start setup/);
  assert.equal(app.calls.filter(call=>call.route==='setup').length,0,'slash selection must open review before downloading');
  await app.key('\r');await app.wait(()=>app.selections.length===1,'selected downloadable model ready');
  assert.deepEqual(app.calls.filter(call=>call.route==='setup').map(call=>call.body),[{catalogId:larger.id,installRuntime:true,...(selectedMode==='agent'?{}:{mode:selectedMode})}]);
  assert.equal(app.calls.filter(call=>call.route==='jobs').length,0);assert.equal(app.client.selection.modelId,selectedModel.id);
  assert.equal(app.state.config.mainAgentModelId,mainAgentModelId,'Chat selection must preserve the existing main agent; Agent selection changes it');
  assert.equal(app.calls.filter(call=>call.route==='settings').length,0,'the download route owns mode-aware model selection');
  await app.key('use the explicitly selected catalog model');await app.key('\r');
  const jobs=app.calls.filter(call=>call.route==='jobs');assert.equal(jobs.length,1);assert.equal(jobs[0].body.modelId,selectedModel.id);
  assert.equal(jobs[0].body.kind,selectedMode);
 }finally{await app.close();}
});
