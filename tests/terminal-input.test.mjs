import './terminal-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {PassThrough,Writable} from 'node:stream';
import {setImmediate as turn} from 'node:timers/promises';
import {render,useStdin} from 'ink';
import {terminalAct} from './terminal-act.mjs';
import {useEditorInput} from '../cli/editor-input.mjs';
import {useCommandHistory,historyScope} from '../cli/history.mjs';
import {edit,demoState} from '../cli/core.mjs';
import {App} from '../cli/app.mjs';

async function mount(element){
 const stdin=new PassThrough();stdin.isTTY=true;stdin.ref=stdin.unref=stdin.setRawMode=()=>stdin;
 const stdout=new Writable({write(_chunk,_encoding,done){done();}});stdout.isTTY=true;stdout.columns=110;stdout.rows=38;
 let ui;
 await terminalAct(()=>{ui=render(element,{stdin,stdout,stderr:stdout,patchConsole:false,exitOnCtrlC:false});});
 const exited=ui.waitUntilExit();
 return {
  async write(...chunks){await terminalAct(async()=>{for(const chunk of chunks)stdin.write(chunk);await turn();await turn();});},
  async close(){try{await terminalAct(()=>ui.unmount());await exited;}finally{ui.cleanup();stdin.destroy();stdout.destroy();}},
 };
}

for(const chunks of [['abc\x7f\b'],['abc','\x7f','\b']])test('physical backspaces survive a coalesced Ink read: '+chunks.length+' write(s)',async()=>{
 let getDraft;
 function Editor(){
  const history=useCommandHistory({scope:historyScope('local','test')});getDraft=history.getDraft;
  useEditorInput(history.editDraft);return null;
 }
 const ui=await mount(React.createElement(Editor));
 try{await ui.write(...chunks);assert.deepEqual(getDraft(),{text:'a',cursor:1});}
 finally{await ui.close();}
});

test('backspace splitting preserves Unicode and never turns pasted CR or Ctrl+S into submission',async()=>{
 let draft={text:'',cursor:0},submissions=0;
 function Editor(){useEditorInput((input,key)=>{
  if(key.return||key.ctrl&&input==='s'){submissions++;return;}
  draft=edit(draft,input,key);
 });return null;}
 const ui=await mount(React.createElement(Editor));
 try{
  await ui.write('界👩‍💻\x7fX\b\rnext\x13');
  assert.deepEqual(draft,{text:'界\nnext',cursor:6});assert.equal(submissions,0);
  await ui.write('\r');assert.equal(submissions,1,'a separate Enter still submits');
 }finally{await ui.close();}
});

test('bracketed paste keeps embedded backspaces and submission bytes as sanitized text',async()=>{
 let draft={text:'',cursor:0},submissions=0;const events=[];
 function Editor(){useEditorInput((input,key)=>{
  events.push({input,key});
  if(key.return||key.ctrl&&input==='s'){submissions++;return;}
  draft=edit(draft,input,key);
 });return null;}
 const ui=await mount(React.createElement(Editor));
 try{
  await ui.write('\x1b[200~abc\x7f\b\rline\x13\x1b[201~');
  assert.equal(submissions,0);assert.equal(draft.text,'abc\nline');
  assert.equal(events.length,1);assert.equal(events[0].key.paste,true);
 }finally{await ui.close();}
});

test('a busy-render input callback permits retry after rejection but suppresses in-flight duplicates',async()=>{
 const state=structuredClone(demoState);state.models=[{id:'fixture',kind:'chat',name:'Fixture',available:true}];state.config.mainAgentModelId='fixture';
 const requests=[];let emitter;
 const client={selection:{provider:'local'},controller:new AbortController(),watch:async()=>new Promise(()=>{}),
  request(route,body){assert.equal(route,'jobs');return new Promise((resolve,reject)=>requests.push({body,resolve,reject}));},
 };
 function Harness(){emitter=useStdin().internal_eventEmitter;return React.createElement(App,{initial:state,client,animation:false,onQuit(){}});}
 const ui=await mount(React.createElement(Harness));
 try{
  await ui.write('retry this');await ui.write('\x13');assert.equal(requests.length,1);
  // Keep exactly the listeners installed by the busy render. Replay their
  // delivery before React can replace them, as a rejection-frame retry can do.
  const busyListeners=emitter.listeners('input');
  const deliver=()=>{for(const listener of busyListeners)listener('\x13');};
  await terminalAct(()=>deliver());assert.equal(requests.length,1);
  await terminalAct(async()=>{
   requests[0].reject(new Error('FIXTURE_REJECTED'));
   await Promise.resolve();
   deliver();deliver();
   assert.equal(requests.length,2,'settled submission can retry through the busy render callback');
  });
  assert.equal(requests[1].body.prompt,'retry this');
  assert.equal(requests[1].body.requestId,requests[0].body.requestId,'retry retains idempotency key');
  await terminalAct(async()=>{requests[1].reject(new Error('FIXTURE_FINISHED'));await Promise.resolve();});
 }finally{await ui.close();client.controller.abort();}
});
