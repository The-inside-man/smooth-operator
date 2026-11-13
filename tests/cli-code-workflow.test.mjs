import './terminal-env.mjs';
import {terminalAct} from './terminal-act.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import React,{useEffect} from 'react';
import {PassThrough,Writable} from 'node:stream';
import {setTimeout as delay} from 'node:timers/promises';
import {render,Text} from 'ink';
import {App} from '../cli/app.mjs';
import {clean} from '../cli/core.mjs';
const answer=(jobId='previous',status='completed')=>({role:'assistant',jobId,status,content:'```python\nprint("A reviewed script")\n```'});
const initial=()=>({config:{mainAgentModelId:'fixture',context:4096,maxTokens:0},models:[{id:'fixture',name:'Fixture',kind:'chat',available:true}],sessions:[{id:'session',provider:'local',title:'Script fixture',messages:[answer()]}],jobs:[],engines:{chat:{available:true}}});
async function mount({snapshot=initial(),completeBeforeAccept=false,transport}={}){
 let state=structuredClone(snapshot),output='',watchState,screen;const calls=[],opened=[];
 const stdin=new PassThrough();stdin.isTTY=true;stdin.ref=()=>stdin;stdin.unref=()=>stdin;stdin.setRawMode=()=>stdin;
 const stdout=new Writable({write(value,_encoding,done){output+=value;done();}});stdout.isTTY=true;stdout.columns=110;stdout.rows=38;
 function ScriptScreen(props){screen=props;useEffect(()=>{opened.push(props.request);},[props.request]);return React.createElement(Text,null,'SCRIPT REVIEW FIXTURE');}
 const completed=(status='completed')=>{state={...state,jobs:[{id:'script-job',sessionId:'session',status,phase:status}],sessions:[{...state.sessions[0],messages:[...state.sessions[0].messages.filter(m=>m.jobId!=='script-job'),answer('script-job',status)]}]};return structuredClone(state);};
 const client={selection:{provider:'local',modelId:'fixture'},transport,controller:new AbortController(),async watch(callback){watchState=callback;return new Promise(()=>{});},async request(route,body){calls.push({route,body:structuredClone(body)});if(route!=='jobs')throw Error('Unexpected fixture request '+route);const job={id:'script-job',sessionId:body.sessionId,status:'queued'};state.jobs=[job];if(completeBeforeAccept)watchState(completed());return job;}};
 let ui;await terminalAct(()=>{ui=render(React.createElement(App,{client,initial:state,animation:false,ScriptScreen,onQuit:()=>{}}),{stdin,stdout,stderr:stdout,exitOnCtrlC:false,patchConsole:false});});const exited=ui.waitUntilExit();await delay(60);
 const key=async value=>{await terminalAct(()=>stdin.write(value));await delay(45);};
 return {calls,opened,get output(){return clean(output);},async command(value){await key('\x15');await key(value);await key('\r');},async complete(status){await terminalAct(()=>watchState(completed(status)));await delay(50);},async back(){await terminalAct(()=>screen.onBack());await delay(45);},async saved(file){await terminalAct(()=>screen.onSaved({file}));},async close(){try{await terminalAct(()=>ui.unmount());await exited;}finally{ui.cleanup();client.controller.abort();stdin.destroy();stdout.destroy();}}};
}
test('save and run commands open a source review with literal user paths/argv and no model calls',async()=>{
 const app=await mount();try{
  await app.command('/save "/tmp/a reviewed script.py" --run');assert.equal(app.opened.length,1);assert.equal(app.opened[0].destination,'/tmp/a reviewed script.py');assert.equal(app.opened[0].runAfter,true);assert.equal(app.opened[0].message.content,answer().content);assert.equal(app.calls.length,0);
  await app.saved('/tmp/a reviewed script.py');await app.back();await app.command('/run');assert.equal(app.opened[1].file,'/tmp/a reviewed script.py');assert.deepEqual(app.opened[1].args,[]);
  await app.back();await app.command('/run /tmp/existing.py "literal arg" ";not-a-shell"');assert.deepEqual(app.opened[2].args,['literal arg',';not-a-shell']);assert.equal(app.calls.length,0);
 }finally{await app.close();}
});
test('unfinished replies cannot be saved and the rejected command stays editable',async()=>{
 const snapshot=initial();snapshot.sessions[0].messages=[answer('partial','failed')];const app=await mount({snapshot});try{await app.command('/save incomplete.py');assert.equal(app.opened.length,0);assert.equal(app.calls.length,0);assert.match(app.output,/Wait for a completed assistant response/);assert.match(app.output,/\/save incomplete.py/);}finally{await app.close();}
});
for(const completeBeforeAccept of [false,true])test(`explicit generation opens exactly one review, completion-before-acceptance=${completeBeforeAccept}`,async()=>{
 const snapshot=initial();snapshot.sessions[0].messages=[];const app=await mount({snapshot,completeBeforeAccept});try{
  await app.command('Create a Python file orbit.py and run it');assert.equal(app.calls.length,1);assert.equal(app.calls[0].body.scriptLanguage,'python');assert.equal(app.calls[0].body.prompt,'Create a Python file orbit.py and run it');
  if(!completeBeforeAccept){assert.equal(app.opened.length,0);await app.complete();}
  assert.equal(app.opened.length,1);assert.equal(app.opened[0].destination,'orbit.py');assert.equal(app.opened[0].runAfter,true);assert.equal(app.opened[0].message.status,'completed');
  await app.back();await app.complete();assert.equal(app.opened.length,1,'snapshot replay cannot reopen or rerun a consumed action');assert.equal(app.calls.length,1);
 }finally{await app.close();}
});
test('failed generated replies and unrequested assistant code do not open a review',async()=>{
 const app=await mount();try{await app.command('Write a Python script and run it');await app.complete('failed');assert.equal(app.opened.length,0);assert.match(app.output,/Nothing was saved or run/);}finally{await app.close();}
 const ordinary=await mount();try{await ordinary.command('Explain Python functions');assert.equal(ordinary.calls[0].body.scriptLanguage,undefined);await ordinary.complete();assert.equal(ordinary.opened.length,0);}finally{await ordinary.close();}
});
test('natural save followups use displayed code and a user path without inference',async()=>{
 const app=await mount();try{await app.command('Save this code as reviewed.py and run it');assert.equal(app.calls.length,0);assert.equal(app.opened.length,1);assert.equal(app.opened[0].destination,'reviewed.py');assert.equal(app.opened[0].runAfter,true);}finally{await app.close();}
});
test('Tor blocks script actions before model requests or review side effects',async()=>{
 const app=await mount({transport:{mode:'tor'}});try{await app.command('Create a Python file test.py and run it');assert.equal(app.calls.length,0);assert.equal(app.opened.length,0);assert.match(app.output,/outside TIM Tor coverage/);}finally{await app.close();}
});
