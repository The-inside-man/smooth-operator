import './terminal-env.mjs';
import {terminalAct} from './terminal-act.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {PassThrough,Writable} from 'node:stream';
import {setTimeout as delay} from 'node:timers/promises';
import {render} from 'ink';
import {App} from '../cli/app.mjs';
import {clean} from '../cli/core.mjs';
import {mouseDisable,mouseEnable} from '../cli/mouse.mjs';

const f2='\x1bOQ',csiF2='\x1b[12~';
function initial({running=false}={}){
 const startedAt=Date.now()-10000;
 return {config:{mainAgentModelId:'fixture',context:4096,maxTokens:0},models:[{id:'fixture',name:'Fixture model',kind:'chat',available:true}],engines:{chat:{available:true}},
  sessions:[{id:'current',title:'Current copy fixture',provider:'local',messages:[{role:'user',content:'PREVIOUS_REQUEST'},{role:'assistant',content:'CURRENT_RESPONSE 界\n```python\nprint("current")\n```',status:running?'running':'completed'}]},
   {id:'other',title:'Other copy fixture',provider:'local',messages:[{role:'assistant',content:'OTHER_SESSION_RESPONSE',status:'completed'}]}],
  jobs:running?[{id:'streaming',sessionId:'current',status:'running',phase:'Fixture response streaming',startedAt,lastActivityAt:startedAt}]:[]};
}

async function mount({snapshot=initial(),mouseReporting=true,copyImpl,animation=false}={}){
 let current=structuredClone(snapshot),watchState,watchTransport,quits=0,closed=false;const chunks=[],calls=[],copies=[];
 const stdin=new PassThrough();stdin.isTTY=true;stdin.ref=()=>stdin;stdin.unref=()=>stdin;stdin.setRawMode=()=>stdin;
 const stdout=new Writable({write(chunk,_encoding,done){chunks.push(String(chunk));done();}});stdout.isTTY=true;stdout.columns=110;stdout.rows=38;
 const copyResponse=async(messages,options)=>{copies.push({messages:structuredClone(messages),options:structuredClone(options)});return copyImpl?copyImpl(messages,options):{characters:42,bytes:42,blocks:options.code?1:0};};
 const client={selection:{provider:'local',modelId:'fixture'},controller:new AbortController(),async watch(callback,{onTransport}={}){watchState=callback;watchTransport=onTransport;return new Promise(()=>{});},async request(route,body){
  calls.push({route,body:structuredClone(body)});
  if(route==='state')return structuredClone(current);
  if(route==='jobs')return {id:'unexpected-model-call',sessionId:body.sessionId,status:'completed'};
  throw new Error('Unexpected fixture route: '+route);
 }};
 let ui;await terminalAct(()=>{ui=render(React.createElement(App,{client,initial:structuredClone(current),mouseReporting,copyResponse,animation,onQuit:()=>{quits++;}}),{stdin,stdout,stderr:stdout,patchConsole:false,exitOnCtrlC:false});});
 const exited=ui.waitUntilExit();await delay(70);
 const raw=()=>chunks.join(''),frame=()=>{const value=clean(raw());return value.slice(Math.max(0,value.lastIndexOf('TIM / STUDIO')));};
 const key=async value=>{await terminalAct(()=>stdin.write(value));await delay(60);return frame();};
 return {calls,copies,get raw(){return raw();},get writes(){return chunks.length;},get frame(){return frame();},get composer(){const value=frame();return value.slice(Math.max(0,value.lastIndexOf('COMMAND')));},get quits(){return quits;},key,
  async command(value){await key('\x15');await key(value);return key('\r');},
  async push(snapshot,transport=Date.now()){current=structuredClone(snapshot);await terminalAct(()=>{watchState(structuredClone(current));watchTransport?.(transport);});await delay(60);},
  async wait(ms){await terminalAct(()=>delay(ms));},
  async paste(value){await key('\x1b[200~');await key(value);await key('\x1b[201~');},
  async close(){if(closed)return;closed=true;try{await terminalAct(()=>ui.unmount());await exited;}finally{ui.cleanup();client.controller.abort();stdin.destroy();stdout.destroy();}},
 };
}

test('F2 disables mouse reporting and holds a stable response, draft and clock until Escape resumes',async()=>{
 const snapshot=initial({running:true}),app=await mount({snapshot,animation:true});
 try{
  await app.key('KEEP_DRAFT 界🙂');await app.key(f2);assert.match(app.frame,/SELECT TEXT/);assert.match(app.composer,/KEEP_DRAFT 界🙂/);
  assert.ok(app.raw.includes(mouseDisable));assert.ok(!app.raw.includes(mouseEnable));
  const stable=app.raw,writes=app.writes;
  await app.wait(1200);assert.equal(app.raw,stable,'the activity clock and animation must not repaint selected text');
  const first=structuredClone(snapshot);first.sessions[0].messages[1].content='HELD_FIRST_RESPONSE';await app.push(first,Date.now()-100000);
  const latest=structuredClone(snapshot);latest.sessions[0].messages[1].content='HELD_LATEST_RESPONSE';await app.push(latest,Date.now()-200000);
  assert.equal(app.raw,stable,'backend snapshots and transport timestamps are held without repaint');assert.equal(app.writes,writes);
  await app.key('IGNORED_WHILE_SELECTING');await app.key('\r');await app.key('\x1b[A');await app.key('\x1b[<64;10;8M');
  assert.equal(app.raw,stable);assert.equal(app.calls.length,0);assert.equal(app.copies.length,0);
  await app.key('\x1b');assert.ok(app.raw.includes(mouseEnable));assert.doesNotMatch(app.frame,/SELECT TEXT/);assert.match(app.frame,/HELD_LATEST_RESPONSE/);assert.doesNotMatch(app.frame,/HELD_FIRST_RESPONSE/);
  assert.match(app.composer,/KEEP_DRAFT 界🙂/);assert.doesNotMatch(app.composer,/IGNORED_WHILE_SELECTING/);assert.equal(app.calls.length,0);
 }finally{await app.close();}
});

test('CSI F2 toggles selection back off and no-mouse mode never enables reporting',async()=>{
 const app=await mount({mouseReporting:false});
 try{
  await app.key('NO_MOUSE_DRAFT');await app.key(csiF2);assert.match(app.frame,/SELECT TEXT/);
  await app.key(f2);assert.doesNotMatch(app.frame,/SELECT TEXT/);assert.match(app.composer,/NO_MOUSE_DRAFT/);
  assert.ok(!app.raw.includes(mouseDisable));assert.ok(!app.raw.includes(mouseEnable));assert.equal(app.calls.length,0);
 }finally{await app.close();}
});

test('unmount while selecting restores only mouse modes TIM enabled',async()=>{
 for(const mouseReporting of [true,false]){
  const app=await mount({mouseReporting});await app.key(f2);await app.close();
  assert.equal(app.raw.includes(mouseDisable),mouseReporting);assert.equal(app.raw.includes(mouseEnable),mouseReporting);
  if(mouseReporting)assert.ok(app.raw.indexOf(mouseEnable)>app.raw.indexOf(mouseDisable));
 }
});

test('/select enters the same native selection mode without a clipboard or model request',async()=>{
 const app=await mount();
 try{
  await app.command('/select');assert.match(app.frame,/SELECT TEXT/);assert.ok(app.raw.includes(mouseDisable));assert.equal(app.calls.length,0);assert.equal(app.copies.length,0);
  await app.key('\x1b');assert.doesNotMatch(app.frame,/SELECT TEXT/);assert.ok(app.raw.includes(mouseEnable));
 }finally{await app.close();}
});

test('/copy and /copy code pass only the selected session messages to the injected clipboard helper',async()=>{
 const snapshot=initial(),app=await mount({snapshot});
 try{
  await app.command('/copy');assert.deepEqual(app.copies[0],{messages:snapshot.sessions[0].messages,options:{code:false}});assert.match(app.frame,/Copied the latest response/);
  await app.command('/copy code');assert.deepEqual(app.copies[1],{messages:snapshot.sessions[0].messages,options:{code:true}});assert.match(app.frame,/Copied.*code/);
  await app.command('/session 2');await app.command('/copy');assert.deepEqual(app.copies[2],{messages:snapshot.sessions[1].messages,options:{code:false}});
  assert.equal(app.calls.length,0,'copy commands do not ask a model or call a backend endpoint');
 }finally{await app.close();}
});

test('partial failed response text remains available to copy and invalid copy arguments never invoke it',async()=>{
 const snapshot=initial();snapshot.sessions[0].messages[1]={role:'assistant',content:'PARTIAL_RESPONSE_AFTER_ERROR',status:'failed',error:'Fixture cutoff'};
 const app=await mount({snapshot});
 try{
  await app.command('/copy');assert.deepEqual(app.copies[0].messages,snapshot.sessions[0].messages);assert.equal(app.copies[0].options.code,false);
  await app.command('/copy wrong');assert.match(app.frame,/Use \/copy/);assert.match(app.composer,/\/copy wrong/);
  await app.command('/copy code extra');assert.match(app.frame,/Use \/copy/);assert.match(app.composer,/\/copy code extra/);
  assert.equal(app.copies.length,1);assert.equal(app.calls.length,0);
 }finally{await app.close();}
});

test('clipboard errors retain the command for an explicit retry and never use a model fallback',async()=>{
 let attempts=0;const app=await mount({copyImpl:async()=>{if(++attempts===1)throw new Error('FIXTURE_CLIPBOARD_UNAVAILABLE');return {characters:42,blocks:0};}});
 try{
  await app.command('/copy');assert.match(app.frame,/FIXTURE_CLIPBOARD_UNAVAILABLE/);assert.match(app.composer,/\/copy/);assert.equal(app.copies.length,1);
  await app.key('\r');assert.equal(app.copies.length,2);assert.match(app.frame,/Copied the latest response/);assert.equal(app.calls.length,0);
 }finally{await app.close();}
});

test('copying preserves a draft typed during the native helper and F2 waits until that command finishes',async()=>{
 let finish;const pending=new Promise(resolve=>{finish=resolve;}),app=await mount({copyImpl:()=>pending});
 try{
  await app.command('/copy');await app.key(f2);assert.doesNotMatch(app.frame,/SELECT TEXT/);assert.ok(!app.raw.includes(mouseDisable));
  await app.key('\x15');await app.key('NEXT_DRAFT_TYPED_WHILE_COPYING');finish({characters:42,blocks:0});await app.wait(80);
  assert.match(app.composer,/NEXT_DRAFT_TYPED_WHILE_COPYING/);assert.equal(app.copies.length,1);assert.equal(app.calls.length,0);
 }finally{finish({characters:42,blocks:0});await app.close();}
});

test('pasted F2 bytes do not select, and selection preserves the active history entry and scratch draft',async()=>{
 const app=await mount();
 try{
  await app.paste('PASTE_START '+f2+' '+csiF2+' PASTE_END');assert.doesNotMatch(app.frame,/SELECT TEXT/);assert.ok(!app.raw.includes(mouseDisable));assert.match(app.composer,/PASTE_START/);assert.match(app.composer,/PASTE_END/);
  await app.key('\x15');await app.key('HISTORY_SCRATCH');await app.key('\x1b[A');assert.match(app.composer,/PREVIOUS_REQUEST/);
  await app.key(f2);await app.key('\x1b');assert.match(app.composer,/PREVIOUS_REQUEST/);await app.key('\x1b[B');assert.match(app.composer,/HISTORY_SCRATCH/);
  assert.equal(app.calls.length,0);assert.equal(app.copies.length,0);
 }finally{await app.close();}
});

test('a copy submission and F2 in one input chunk cannot enter selection before the command finishes',async()=>{
 let finish;const pending=new Promise(resolve=>{finish=resolve;}),app=await mount({copyImpl:()=>pending});
 try{
  await app.key('/copy');await app.key('\x13'+f2);
  assert.equal(app.copies.length,1);assert.doesNotMatch(app.frame,/SELECT TEXT/);assert.match(app.frame,/Wait for the current command to finish/);assert.ok(!app.raw.includes(mouseDisable));
  finish({characters:42,blocks:0});await app.wait(80);
  assert.match(app.frame,/Copied the latest response/);assert.doesNotMatch(app.frame,/SELECT TEXT/);assert.ok(!app.raw.includes(mouseDisable));assert.equal(app.calls.length,0);
 }finally{finish({characters:42,blocks:0});await app.close();}
});
