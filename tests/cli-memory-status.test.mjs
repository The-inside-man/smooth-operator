import './terminal-env.mjs';
import {terminalAct} from './terminal-act.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {PassThrough,Writable} from 'node:stream';
import {setTimeout as delay} from 'node:timers/promises';
import {render} from 'ink';
import {App} from '../cli/app.mjs';
import {clean,demoState} from '../cli/core.mjs';
import {memoryStatus,memoryRows,unloadSelection,readMemory} from '../cli/memory-status.mjs';

const GiB=2**30;
const initial=()=>({...structuredClone(demoState),config:{mainAgentModelId:'guide',maxTokens:0,context:4096},models:[{id:'guide',name:'Guide fixture',kind:'chat',available:true},{id:'coder',name:'Coder fixture',kind:'chat',available:true}],jobs:[],engines:{chat:{available:true}},orchestrator:{modelId:'guide',loaded:true,status:'running'},memory:{totalBytes:16*GiB,availableBytes:4.1*GiB,reserveBytes:1.6*GiB,modelBudgetBytes:2.5*GiB,status:'ok',stale:false,availableSource:'os'},loadedModels:[
 {modelId:'guide',name:'Guide fixture',role:'guide',pid:101,rssBytes:GiB,estimatedBytes:1.6*GiB},
 {modelId:'coder',name:'Coder fixture',role:'specialist',pid:202,pinned:true,rssBytes:2.5*GiB,estimatedBytes:4.5*GiB},
 {modelId:'coder',name:'Pipeline copy',role:'pipeline-agent',pid:303,pinned:false,rssBytes:null,estimatedBytes:4.5*GiB},
]});

test('memory report separates measured resident RAM, catalog estimates and pin status for every process',()=>{
 const state=initial(),report=memoryStatus(state);
 assert.match(report,/RAM total 16\.0 GiB \/ available 4\.1 GiB/);assert.match(report,/Safety buffer 1\.6 GiB \/ model budget 2\.5 GiB/);
 assert.match(report,/1\. Guide fixture \/ guide \/ PID 101 \/ protected guide/);
 assert.match(report,/2\. Coder fixture \/ specialist \/ PID 202 \/ pinned\n   RSS measured: 2\.5 GiB/);
 assert.match(report,/3\. Pipeline copy \/ pipeline-agent \/ PID 303 \/ temporary\n   RSS unavailable; estimate ~4\.5 GiB \(not current usage\)/);
 assert.match(report,/not the full unified\/GPU memory footprint/);assert.match(report,/requirements, not current usage/);
 assert.equal(memoryRows(state).length,3,'two processes for the same model must not be merged');
 assert.match(memoryStatus({...state,loadedModels:[]}),/No TIM model processes are currently loaded/);
 assert.match(memoryStatus({memory:{status:'stale'},loadedModels:[{name:'Unknown\nmodel',role:'specialist'}]}),/Memory reading is stale/);
 assert.doesNotMatch(memoryStatus({loadedModels:[{name:'Injected\ncommand',role:'specialist'}]}),/Injected\ncommand/);
});

test('fresh memory uses a GET-style route without a body and unload row parsing never silently falls back',async()=>{
 const calls=[],client={async request(...args){calls.push(args);return initial();}};
 assert.deepEqual(await readMemory(client),initial());assert.deepEqual(calls,[['setup/options']]);
 assert.deepEqual(unloadSelection([]),{scope:'idle'});assert.deepEqual(unloadSelection(['idle']),{scope:'idle'});
 for(const args of [['0'],['-1'],['1.5'],['2','extra'],['unknown']])assert.throws(()=>unloadSelection(args,initial().loadedModels),/Use \/unload/);
 assert.throws(()=>unloadSelection(['2']),/Run \/memory first/);
 assert.throws(()=>unloadSelection(['1'],initial().loadedModels),/guide stays loaded/);
 assert.throws(()=>unloadSelection(['9'],initial().loadedModels),/No loaded-process row/);
});

async function mount({snapshot=initial(),size={w:110,h:38},onUnload,failUnload=false,failRead=false}={}){
 let current=structuredClone(snapshot),output='',reads=0;const calls=[];
 const stdin=new PassThrough();stdin.isTTY=true;stdin.ref=()=>stdin;stdin.unref=()=>stdin;stdin.setRawMode=()=>stdin;
 const stdout=new Writable({write(chunk,_encoding,done){output+=chunk;done();}});stdout.isTTY=true;stdout.columns=size.w;stdout.rows=size.h;
 const client={selection:{provider:'local',modelId:'guide'},controller:new AbortController(),async watch(){return new Promise(()=>{});},async request(route,body){
  calls.push({route,body:structuredClone(body)});
  if(route==='setup/options'){reads++;if(failRead)throw new Error('FIXTURE_MEMORY_READ_FAILED');return structuredClone(current);}
  if(route==='unload'||route==='models/unload'){
   if(failUnload)throw new Error('FIXTURE_UNLOAD_REJECTED');
   await onUnload?.(route,body);current.loadedModels=current.loadedModels.filter(row=>row.role==='guide'||route==='models/unload'&&row.modelId!==body.id);
   return {ok:true};
  }
  throw new Error('Unexpected fixture route: '+route);
 }};
 let ui;await terminalAct(()=>{ui=render(React.createElement(App,{client,initial:current,animation:false,onQuit:()=>{}}),{stdin,stdout,stderr:stdout,exitOnCtrlC:false,patchConsole:false});});
 const exited=ui.waitUntilExit();await delay(60);
 const frame=()=>{const value=clean(output);return value.slice(Math.max(0,value.lastIndexOf('TIM / STUDIO')));};
 const key=async value=>{await terminalAct(()=>stdin.write(value));await delay(45);return frame();};
 return {calls,get reads(){return reads;},get frame(){return frame();},get state(){return current;},replaceSnapshot(value){current=structuredClone(value);},key,
  async command(value){await key('\x15');await key(value);return key('\r');},async settle(){await terminalAct(()=>delay(60));return frame();},
  async close(){try{await terminalAct(()=>ui.unmount());await exited;}finally{ui.cleanup();client.controller.abort();stdin.destroy();stdout.destroy();}}};
}

test('/memory reads current processes without starting inference or unloading anything',async()=>{
 const app=await mount();
 try{
  assert.equal(app.calls.length,0,'mount does not inspect or stop models automatically');
  await app.command('/memory');assert.deepEqual(app.calls,[{route:'setup/options',body:undefined}]);
  assert.match(app.frame,/MEMORY \/ current TIM backend/);assert.match(app.frame,/model budget 2\.5 GiB/);assert.match(app.frame,/PID 202/);assert.match(app.frame,/RSS measured: 2\.5 GiB/);
 }finally{await app.close();}
});

test('/unload without arguments and /unload idle release only idle non-guide models then refresh',async()=>{
 for(const command of ['/unload','/unload idle']){
  const app=await mount();
  try{
   await app.command(command);assert.deepEqual(app.calls.map(call=>call.route),['setup/options','unload','setup/options']);
   assert.deepEqual(app.calls.find(call=>call.route==='unload').body,{});assert.deepEqual(app.state.loadedModels.map(row=>row.role),['guide']);
   assert.equal(app.state.models.length,2);assert.equal(app.state.config.mainAgentModelId,'guide');assert.match(app.frame,/Unloaded idle non-guide models/);
  }finally{await app.close();}
 }
});

test('numbered unload uses the last memory report identity even if fresh rows reorder',async()=>{
 const app=await mount();
 try{
  await app.command('/memory');const reordered=initial();reordered.loadedModels.reverse();app.replaceSnapshot(reordered);
  await app.command('/unload 2');assert.deepEqual(app.calls.find(call=>call.route==='models/unload').body,{id:'coder'});
  assert.deepEqual(app.state.loadedModels.map(row=>row.role),['guide']);assert.match(app.frame,/Unloaded idle non-guide processes for Coder fixture/);
 }finally{await app.close();}
});

test('numbered unload protects a guide row while allowing its distinct specialist copy',async()=>{
 const state=initial();state.loadedModels[1]={...state.loadedModels[1],modelId:'guide',name:'Guide specialist copy'};
 const app=await mount({snapshot:state});
 try{
  await app.command('/memory');await app.command('/unload 1');assert.match(app.frame,/guide stays loaded/);assert.equal(app.calls.filter(call=>call.route==='models/unload').length,0);
  await app.command('/unload 2');assert.deepEqual(app.calls.find(call=>call.route==='models/unload').body,{id:'guide'});
  assert.ok(app.state.loadedModels.some(row=>row.role==='guide'&&row.pid===101));
 }finally{await app.close();}
});

test('changed process PID, model identity, or role cannot silently unload a replacement',async()=>{
 for(const [field,value] of [['pid',999],['modelId','replacement-model'],['role','pipeline-agent']]){
  const app=await mount();
  try{
   await app.command('/memory');const changed=initial();changed.loadedModels[1][field]=value;app.replaceSnapshot(changed);
   await app.command('/unload 2');assert.match(app.frame,/Loaded processes changed/);assert.match(app.frame,/\/unload 2/);
   assert.equal(app.calls.filter(call=>['unload','models/unload'].includes(call.route)).length,0);
  }finally{await app.close();}
 }
});

test('invalid unload inputs and numbers without a displayed memory list never make API calls',async()=>{
 const app=await mount();
 try{
  for(const command of ['/unload 2','/unload 0','/unload all','/unload 1 extra','/memory extra']){
   await app.command(command);assert.ok(app.frame.includes(command));
  }
  assert.equal(app.calls.length,0);
 }finally{await app.close();}
});

test('unloading protects queued/running work in every session and loading/setup operations',async()=>{
 for(const busy of [{jobs:[{id:'other',sessionId:'elsewhere',status:'running'}]},{jobs:[{id:'queued',sessionId:'elsewhere',status:'queued'}]},{loadingModel:true},{orchestrator:{status:'loading'}},{localSetup:{status:'installing'}}]){
  const app=await mount({snapshot:{...initial(),...busy}});
  try{await app.command('/unload idle');assert.match(app.frame,/Finish or cancel current work/);assert.match(app.frame,/\/unload idle/);assert.equal(app.calls.length,0);}
  finally{await app.close();}
 }
 const app=await mount();
 try{const busy=initial();busy.jobs=[{id:'fresh',sessionId:'elsewhere',status:'running'}];app.replaceSnapshot(busy);await app.command('/unload');assert.match(app.frame,/Finish or cancel current work/);assert.deepEqual(app.calls.map(call=>call.route),['setup/options']);}
 finally{await app.close();}
});

test('backend read and unload errors stay visible and retain the command for explicit retry',async()=>{
 for(const options of [{failRead:true},{failUnload:true}]){
  const app=await mount(options);
  try{await app.command(options.failRead?'/memory':'/unload idle');assert.match(app.frame,/FIXTURE_MEMORY_READ_FAILED|FIXTURE_UNLOAD_REJECTED/);assert.match(app.frame,options.failRead?/\/memory/:/\/unload idle/);assert.equal(app.state.loadedModels.length,3);}
  finally{await app.close();}
 }
});

test('a new user draft survives an unload already in flight',async()=>{
 let finish;const pending=new Promise(resolve=>{finish=resolve;}),app=await mount({onUnload:()=>pending});
 try{
  await app.command('/unload idle');await app.key('\x15');await app.key('Keep my next request 界');finish();await app.settle();
  assert.match(app.frame,/Keep my next request 界/);assert.match(app.frame,/Unloaded idle non-guide models/);assert.equal(app.state.loadedModels.length,1);
 }finally{finish();await app.close();}
});

test('memory status fits the minimum terminal and remains scrollable through all resident rows',async()=>{
 const state=initial();for(let number=4;number<=12;number++)state.loadedModels.push({modelId:'extra-'+number,name:'Extra resident '+number,role:'specialist',pid:500+number,pinned:false,rssBytes:GiB});
 const app=await mount({snapshot:state,size:{w:80,h:16}});
 try{
  await app.command('/memory');assert.ok(app.frame.split('\n').length<=16);assert.ok(app.frame.split('\n').every(line=>line.length<=80));assert.match(app.frame,/\/unload idle/);assert.match(app.frame,/RAM total/);
  let output=app.frame;for(let page=0;page<20;page++)output+=await app.key('\x0e');
  assert.match(output,/Extra resident 12/);assert.match(output,/not the full unified\/GPU memory footprint/);assert.equal(app.calls.length,1,'reading and scrolling never unloads models');
 }finally{await app.close();}
});
