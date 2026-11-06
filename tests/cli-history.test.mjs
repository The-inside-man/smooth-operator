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

const up='\x1b[A',down='\x1b[B';
const user=content=>({role:'user',content});
const fixture=(messages=[user('HISTORY_OLDEST 界'),{role:'assistant',content:'ASSISTANT_MUST_NOT_RECALL'},user('HISTORY_LATEST 👩‍💻')])=>({
 config:{mainAgentModelId:'fixture',maxTokens:0,context:4096},models:[{id:'fixture',name:'Fixture model',kind:'chat',available:true},{id:'other-model',name:'Other fixture',kind:'chat',available:true}],
 sessions:[{id:'current',title:'Current fixture',provider:'local',messages}],jobs:[],engines:{chat:{available:true}},
});

async function mount({snapshot=fixture(),selection={provider:'local',modelId:'fixture'},initialRequest='',sendError,jobStatus='completed'}={}){
 let state=structuredClone(snapshot),output='',watchState;const calls=[];
 const stdin=new PassThrough();stdin.isTTY=true;stdin.ref=()=>stdin;stdin.unref=()=>stdin;stdin.setRawMode=()=>stdin;
 const stdout=new Writable({write(chunk,_encoding,done){output+=chunk;done();}});stdout.isTTY=true;stdout.columns=110;stdout.rows=38;
 const client={selection:{...selection},controller:new AbortController(),async watch(callback){watchState=callback;return new Promise(()=>{});},async request(route,body){
  calls.push({route,body:structuredClone(body)});
  if(route==='state'||route==='setup/options')return structuredClone(state);
  if(route==='settings'){state.config={...state.config,...body};return structuredClone(state.config);}
  if(route==='sessions'){const session={id:'new-session',title:'New fixture',messages:[]};state.sessions.unshift(session);return structuredClone(session);}
  if(route==='jobs'){
   if(sendError)throw new Error(sendError);
   const job={id:'job-'+calls.filter(call=>call.route==='jobs').length,sessionId:body.sessionId,status:jobStatus};
   const session=state.sessions.find(session=>session.id===body.sessionId);session.messages.push(user(body.prompt),{role:'assistant',content:'FIXTURE_REPLY',status:'completed'});session.provider=body.provider||'local';
   state.jobs.unshift(job);queueMicrotask(()=>watchState?.(structuredClone(state)));return job;
  }
  throw new Error('Unexpected fixture route: '+route);
 }};
 const props={client,initial:structuredClone(state),initialRequest,animation:false,onQuit:()=>{}};
 let ui;await terminalAct(()=>{ui=render(React.createElement(App,props),{stdin,stdout,stderr:stdout,exitOnCtrlC:false,patchConsole:false});});
 const exited=ui.waitUntilExit();await delay(65);
 const frame=()=>{const value=clean(output);return value.slice(Math.max(0,value.lastIndexOf('TIM / STUDIO')));};
 const composer=()=>{const value=frame();return value.slice(Math.max(0,value.lastIndexOf('COMMAND')));};
 const key=async value=>{await terminalAct(()=>stdin.write(value));await delay(45);return frame();};
 return {calls,client,get frame(){return frame();},get composer(){return composer();},key,
  async replace(value){await key('\x15');await key(value);},async command(value){await key('\x15');await key(value);return key('\r');},
  async paste(value){await key('\x1b[200~');await key(value);await key('\x1b[201~');},
  async changeProvider(value){client.selection={...value};await terminalAct(()=>ui.rerender(React.createElement(App,props)));await delay(45);},
  async close(){try{await terminalAct(()=>ui.unmount());await exited;}finally{ui.cleanup();client.controller.abort();stdin.destroy();stdout.destroy();}}};
}

test('plain arrows recall only user prompts, clamp at the oldest and restore the newest scratch draft',async()=>{
 const snapshot=fixture([{role:'system',content:'SYSTEM_MUST_NOT_RECALL'},user('HISTORY_OLDEST 界'),{role:'assistant',content:'ASSISTANT_MUST_NOT_RECALL'},user('HISTORY_LATEST 👩‍💻'),{role:'tool',content:'TOOL_MUST_NOT_RECALL'}]);
 const app=await mount({snapshot});
 try{
  await app.key(up);assert.match(app.composer,/HISTORY_LATEST 👩‍💻/);
  await app.key(up);assert.match(app.composer,/HISTORY_OLDEST 界/);
  await app.key(up.repeat(4));assert.match(app.composer,/HISTORY_OLDEST 界/);assert.doesNotMatch(app.composer,/SYSTEM_MUST_NOT_RECALL|ASSISTANT_MUST_NOT_RECALL|TOOL_MUST_NOT_RECALL/);
  await app.key(down);assert.match(app.composer,/HISTORY_LATEST 👩‍💻/);
  await app.key(down.repeat(4));assert.match(app.composer,/Ask TIM to build/);assert.equal(app.calls.length,0,'recall never asks the model or sends a request');
 }finally{await app.close();}
});

test('a recalled Unicode prompt can be edited and executes only after explicit Enter',async()=>{
 const app=await mount();
 try{
  await app.key(up);await app.key(' EDITED 界');assert.match(app.composer,/HISTORY_LATEST 👩‍💻 EDITED 界/);assert.equal(app.calls.length,0);
  await app.key('\r');const sends=app.calls.filter(call=>call.route==='jobs');assert.equal(sends.length,1);assert.equal(sends[0].body.prompt,'HISTORY_LATEST 👩‍💻 EDITED 界');
 }finally{await app.close();}
});

test('past-newest restores an unsent draft and its Unicode cursor position',async()=>{
 const app=await mount();
 try{
  await app.key('DRAFT界🙂tail');await app.key('\x1b[D'.repeat(4));
  await app.key(up);assert.match(app.composer,/HISTORY_LATEST/);await app.key(down);assert.match(app.composer,/DRAFT界🙂tail/);
  await app.key('!');assert.equal(app.calls.length,0);await app.key('\r');
  assert.equal(app.calls.find(call=>call.route==='jobs').body.prompt,'DRAFT界🙂!tail');
 }finally{await app.close();}
});

test('multiline arrows first edit logical rows, then history browsing cycles multiline entries',async()=>{
 const app=await mount({snapshot:fixture([user('PREVIOUS_SINGLE'),user('HISTORY_LINE_ONE\nHISTORY_LINE_TWO')])});
 try{
  await app.paste('top界\nbottom');await app.key(up);assert.match(app.composer,/top界/);assert.match(app.composer,/bottom/);assert.doesNotMatch(app.composer,/HISTORY_LINE/);
  await app.key(up);assert.match(app.composer,/HISTORY_LINE_ONE/);assert.match(app.composer,/HISTORY_LINE_TWO/);
  await app.key(up);assert.match(app.composer,/PREVIOUS_SINGLE/);await app.key(down);assert.match(app.composer,/HISTORY_LINE_TWO/);
  await app.key(down);await app.key('!');assert.equal(app.calls.length,0);await app.key('\r');
  assert.equal(app.calls.find(call=>call.route==='jobs').body.prompt,'top界!\nbottom');
 }finally{await app.close();}
});

test('coalesced arrow bursts keep each history step and return to the original draft',async()=>{
 const app=await mount({snapshot:fixture(Array.from({length:5},(_,index)=>user('HISTORY_'+(index+1))))});
 try{
  await app.key('BURST_SCRATCH');await app.key(up.repeat(3));assert.match(app.composer,/HISTORY_3/);
  await app.key(down.repeat(3));assert.match(app.composer,/BURST_SCRATCH/);
  await app.key(up.repeat(20));assert.match(app.composer,/HISTORY_1/);await app.key(down.repeat(20));assert.match(app.composer,/BURST_SCRATCH/);
  assert.equal(app.calls.length,0);
 }finally{await app.close();}
});

test('temporary edits to recalled entries survive browsing and reset when the original draft is restored',async()=>{
 const app=await mount();
 try{
  await app.key('ORIGINAL_SCRATCH');await app.key(up);await app.key(' TEMP_EDIT');await app.key(up);assert.match(app.composer,/HISTORY_OLDEST/);
  await app.key(down);assert.match(app.composer,/HISTORY_LATEST 👩‍💻 TEMP_EDIT/);
  await app.key(down);assert.match(app.composer,/ORIGINAL_SCRATCH/);
  await app.key(up);assert.match(app.composer,/HISTORY_LATEST 👩‍💻/);assert.doesNotMatch(app.composer,/TEMP_EDIT/);assert.equal(app.calls.length,0);
 }finally{await app.close();}
});

test('successful slash commands enter in-memory history while invalid commands stay only in the draft',async()=>{
 const app=await mount({snapshot:fixture([])});
 try{
  await app.command('/mode code');await app.command('/tokens');await app.key(up);assert.match(app.composer,/\/tokens/);await app.key(up);assert.match(app.composer,/\/mode code/);
  await app.key(down.repeat(2));assert.match(app.composer,/Ask TIM to build/);
  await app.command('/mode invalid');assert.match(app.composer,/\/mode invalid/);await app.key(up);assert.match(app.composer,/\/tokens/);assert.doesNotMatch(app.composer,/\/mode invalid/);
  await app.key(down);assert.match(app.composer,/\/mode invalid/);assert.equal(app.calls.length,0,'local slash commands and history do not call a model');
 }finally{await app.close();}
});

test('session navigation and new sessions keep histories scoped to their session',async()=>{
 const snapshot=fixture([user('FIRST_SESSION_ONLY')]);snapshot.sessions.push({id:'second',title:'Second fixture',provider:'local',messages:[user('SECOND_SESSION_ONLY')]});
 const app=await mount({snapshot});
 try{
  await app.command('/session 2');await app.key(up);assert.match(app.composer,/SECOND_SESSION_ONLY/);assert.doesNotMatch(app.composer,/FIRST_SESSION_ONLY|\/session 2/);
  await app.key(down);await app.command('/new');await app.key(up);assert.match(app.composer,/Ask TIM to build/);assert.doesNotMatch(app.composer,/FIRST_SESSION_ONLY|SECOND_SESSION_ONLY|\/new/);
  assert.deepEqual(app.calls.map(call=>call.route),['sessions']);
 }finally{await app.close();}
});

test('a selected session from another provider cannot seed recalled prompts',async()=>{
 for(const [sessionProvider,selection,expected] of [['openai',{provider:'local',modelId:'fixture'},false],['local',{provider:'openai',modelId:'cloud-fixture'},false],['openai',{provider:'openai',modelId:'cloud-fixture'},true]]){
  const snapshot=fixture([user('PROVIDER_SCOPED_PROMPT')]);snapshot.sessions[0].provider=sessionProvider;
  const app=await mount({snapshot,selection});
  try{await app.key(up);if(expected)assert.match(app.composer,/PROVIDER_SCOPED_PROMPT/);else assert.doesNotMatch(app.composer,/PROVIDER_SCOPED_PROMPT/);assert.equal(app.calls.length,0);}
  finally{await app.close();}
 }
});

test('changing provider clears a recalled local prompt and its scratch draft',async()=>{
 const app=await mount();
 try{
  await app.key('LOCAL_SCRATCH_PRIVATE');await app.key(up);assert.match(app.composer,/HISTORY_LATEST/);
  await app.changeProvider({provider:'openai',modelId:'cloud-fixture'});assert.doesNotMatch(app.composer,/HISTORY_LATEST|LOCAL_SCRATCH_PRIVATE/);
  await app.key(up);assert.doesNotMatch(app.composer,/HISTORY_LATEST|LOCAL_SCRATCH_PRIVATE/);assert.equal(app.calls.length,0);
 }finally{await app.close();}
});

test('model-picker arrows do not consume composer history or lose an unsent initial draft',async()=>{
 const app=await mount({selection:{provider:'local',modelId:'not-installed'},initialRequest:'PICKER_DRAFT 界'});
 try{
  assert.match(app.frame,/TIM \/ MODELS/);await app.key(down);await app.key(up);assert.equal(app.calls.length,0);
  await app.key('\x1b');assert.match(app.composer,/PICKER_DRAFT 界/);
  await app.key(up);assert.match(app.composer,/HISTORY_LATEST/);await app.key(down);assert.match(app.composer,/PICKER_DRAFT 界/);
  assert.equal(app.calls.length,0);
 }finally{await app.close();}
});

test('scroll shortcuts, modified arrows and wheel events leave a history selection and scratch draft intact',async()=>{
 const snapshot=fixture([user('ONE_HISTORY_PROMPT'),{role:'assistant',content:Array.from({length:100},(_,index)=>'OUTPUT_'+index).join('\n')}]);
 const app=await mount({snapshot});
 try{
  await app.key('SCROLL_SCRATCH');await app.key(up);assert.match(app.composer,/ONE_HISTORY_PROMPT/);
  for(const key of ['\x10','\x0e','\x0c','\x1b[1;3A','\x1b[1;3B','\x1b[1;5A','\x1b[1;2A','\x1b[<64;10;8M','\x1b[<65;10;8M']){
   await app.key(key);assert.match(app.composer,/ONE_HISTORY_PROMPT/);
  }
  await app.key(down);assert.match(app.composer,/SCROLL_SCRATCH/);assert.equal(app.calls.length,0);
 }finally{await app.close();}
});

test('pasted arrow and Control bytes remain text input rather than history navigation',async()=>{
 const app=await mount();const pasted='Pasted safe \x1b[A \x1b[B \x10\x0e text';
 try{
  await app.paste(pasted);assert.doesNotMatch(app.composer,/HISTORY_LATEST|HISTORY_OLDEST/);assert.equal(app.calls.length,0);
  await app.key('\r');assert.equal(app.calls.find(call=>call.route==='jobs').body.prompt,clean(pasted).trim());
 }finally{await app.close();}
});

test('a rejected send stays in the scratch draft rather than submitted history',async()=>{
 const app=await mount({snapshot:fixture([user('PREVIOUS_ACCEPTED')]),sendError:'FIXTURE_REJECTED'});
 try{
  await app.key('REJECTED_DRAFT');await app.key('\r');assert.match(app.composer,/REJECTED_DRAFT/);assert.match(app.frame,/FIXTURE_REJECTED/);
  await app.key(up);assert.match(app.composer,/PREVIOUS_ACCEPTED/);assert.doesNotMatch(app.composer,/REJECTED_DRAFT/);
  await app.key(down);assert.match(app.composer,/REJECTED_DRAFT/);assert.equal(app.calls.filter(call=>call.route==='jobs').length,1);
 }finally{await app.close();}
});

test('an accepted prompt remains recallable after inference failure without duplicate streamed history',async()=>{
 const app=await mount({snapshot:fixture([user('PREVIOUS_ACCEPTED')]),jobStatus:'failed'});
 try{
  await app.key('ACCEPTED_THEN_FAILED');await app.key('\r');await app.key(up);assert.match(app.composer,/ACCEPTED_THEN_FAILED/);
  await app.key(up);assert.match(app.composer,/PREVIOUS_ACCEPTED/);assert.doesNotMatch(app.composer,/ACCEPTED_THEN_FAILED/);
  assert.equal(app.calls.filter(call=>call.route==='jobs').length,1);
 }finally{await app.close();}
});

test('Up followed by Enter in one input chunk submits the recalled prompt instead of the scratch draft',async()=>{
 const app=await mount();
 try{
  await app.key('SCRATCH');await app.key(up+'\r');
  const sends=app.calls.filter(call=>call.route==='jobs');assert.equal(sends.length,1);assert.equal(sends[0].body.prompt,'HISTORY_LATEST 👩‍💻');
 }finally{await app.close();}
});

test('recall, printable edit and Enter in one input chunk submit the final edited prompt once',async()=>{
 const app=await mount();
 try{
  await app.key('SCRATCH');await app.key(up+' edit'+'\x1b[C\r');
  const sends=app.calls.filter(call=>call.route==='jobs');assert.equal(sends.length,1);assert.equal(sends[0].body.prompt,'HISTORY_LATEST 👩‍💻 edit');
 }finally{await app.close();}
});
