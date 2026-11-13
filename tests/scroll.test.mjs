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
import {scrollAction,scrollWindow,pagePosition,pageSize} from '../cli/scroll.mjs';

test('paging shortcuts leave plain arrows, editing keys and pasted text alone',()=>{
 for(const [input,key,action] of [['p',{ctrl:true},'up'],['n',{ctrl:true},'down'],['l',{ctrl:true},'latest'],['',{meta:true,upArrow:true},'up'],['',{meta:true,downArrow:true},'down'],['',{pageUp:true},'up'],['',{pageDown:true},'down']])assert.equal(scrollAction(input,key),action);
 for(const [input,key] of [['p',{}],['n',{}],['l',{}],['',{upArrow:true}],['',{downArrow:true}],['u',{ctrl:true}],['k',{ctrl:true}],['p',{ctrl:true,paste:true}],['p',{ctrl:true,eventType:'release'}]])assert.equal(scrollAction(input,key),null);
});

test('pages clamp to visible content, retain overlap and anchor review while output grows',()=>{
 assert.equal(pageSize(10),9);assert.equal(pageSize(0),1);
 let position=pagePosition(null,'up',100,10);assert.equal(position,81);
 assert.deepEqual(scrollWindow(120,10,position),{start:81,end:91,maximum:110,total:120,visible:10,following:false});
 for(let i=0;i<30;i++)position=pagePosition(position,'up',120,10);
 assert.equal(position,0);assert.equal(scrollWindow(120,10,position).start,0);
 for(let i=0;i<30;i++)position=pagePosition(position,'down',120,10);
 assert.equal(position,null);assert.equal(scrollWindow(120,10,position).start,110);
 assert.equal(pagePosition(20,'latest',120,10),null);
 assert.deepEqual(scrollWindow(0,0,999),{start:0,end:0,maximum:0,total:0,visible:1,following:false});
});

const content=count=>Array.from({length:count},(_,index)=>'OUTPUT_LINE_'+String(index+1).padStart(3,'0')).join('\n');
async function mount({width=80,count=140,running=true,sendError='FIXTURE_SEND_STOPPED'}={}){
 let snapshot={config:{mainAgentModelId:'fixture'},models:[{id:'fixture',kind:'chat',name:'Fixture',available:true}],sessions:[{id:'session',title:'Long response',messages:[{role:'assistant',content:content(count),status:running?'running':'completed'}]}],jobs:running?[{id:'job',sessionId:'session',status:'running',phase:'Fixture streaming'}]:[],engines:{chat:{available:true}}};
 let output='',watchState;const calls=[];
 const stdin=new PassThrough();stdin.isTTY=true;stdin.ref=()=>stdin;stdin.unref=()=>stdin;stdin.setRawMode=()=>stdin;
 const stdout=new Writable({write(chunk,_encoding,done){output+=chunk;done();}});stdout.isTTY=true;stdout.columns=width;stdout.rows=24;
 const client={selection:{provider:'local',modelId:'fixture'},controller:new AbortController(),
  async watch(callback){watchState=callback;return new Promise(()=>{});},
  async request(route,body){calls.push({route,body});if(route==='jobs')throw new Error(sendError);return structuredClone(snapshot);},
 };
 let ui;await terminalAct(()=>{ui=render(React.createElement(App,{client,initial:structuredClone(snapshot),animation:false,onQuit:()=>{}}),{stdin,stdout,stderr:stdout,exitOnCtrlC:false,patchConsole:false});});
 const exited=ui.waitUntilExit();
 const close=async()=>{try{await terminalAct(()=>ui.unmount());await exited;}finally{ui.cleanup();client.controller.abort();stdin.destroy();stdout.destroy();}};
 try{
  for(let attempt=0;attempt<200&&(!output.includes('COMMAND')||typeof watchState!=='function');attempt++)await delay(25);
  assert.ok(output.includes('COMMAND')&&typeof watchState==='function','initial scroll fixture render and watcher\n'+clean(output).slice(-4000));
 }catch(error){await close();throw error;}
 return {calls,get output(){return clean(output);},
  async key(value){const offset=output.length;await terminalAct(()=>stdin.write(value));await delay(65);return clean(output.slice(offset));},
  async push(count,{running=true}={}){const offset=output.length;snapshot={...snapshot,sessions:[{...snapshot.sessions[0],messages:[{role:'assistant',content:content(count),status:running?'running':'completed'}]}],jobs:running?snapshot.jobs:[]};await terminalAct(()=>watchState(structuredClone(snapshot)));await delay(90);return clean(output.slice(offset));},
  close,
 };
}
const range=frame=>{const match=[...frame.matchAll(/Review lines (\d+)-(\d+) of (\d+)/g)].at(-1);assert.ok(match,frame);return match.slice(1).map(Number);};

test('real Control and Option keys review streamed chat without moving the draft or sending requests',async()=>{
 const app=await mount();
 try{
  assert.match(app.output,/OUTPUT_LINE_140/);assert.match(app.output,/Ctrl\+P\/N scroll/);
  await app.key('\x1b[200~');await app.key('Keep my draft\nwith Unicode 界');await app.key('\x1b[201~');
  const older=range(await app.key('\x10'));assert.ok(older[1]<older[2]);
  const grown=await app.push(180),anchored=range(grown);assert.deepEqual(anchored.slice(0,2),older.slice(0,2));assert.ok(anchored[2]>older[2]);
  assert.match(grown,/Keep my draft/);assert.match(grown,/with Unicode 界/);
  const optionUp=range(await app.key('\x1b[1;3A'));assert.ok(optionUp[0]<anchored[0]);
  const optionDown=range(await app.key('\x1b[1;3B'));assert.deepEqual(optionDown.slice(0,2),anchored.slice(0,2));
  assert.deepEqual(range(await app.key('\x1b\x1b[A')).slice(0,2),optionUp.slice(0,2));
  const latest=await app.key('\x0c');assert.match(latest,/OUTPUT_LINE_180/);assert.doesNotMatch(latest,/Review lines/);
  assert.match(await app.push(190),/OUTPUT_LINE_190/);assert.equal(app.calls.length,0,'scrolling must never post a request');
  await app.push(190,{running:false});await app.key('\r');
  assert.equal(app.calls.length,1);assert.equal(app.calls[0].route,'jobs');assert.equal(app.calls[0].body.prompt,'Keep my draft\nwith Unicode 界');
 }finally{await app.close();}
});

test('chat paging cannot overscroll to a blank screen and new shortcuts also open a completed response',async()=>{
 const app=await mount({running:false,width:110});
 try{
  let top=app.output;
  for(let i=0;i<18;i++){const frame=await app.key('\x10');if(frame)top=frame;}
  const start=range(top);assert.equal(start[0],1);assert.match(top,/OUTPUT_LINE_001/);
  assert.match(await app.key('\x1b[5~')||top,/OUTPUT_LINE_001/);
  let latest=top;
  for(let i=0;i<18;i++){const frame=await app.key('\x0e');if(frame)latest=frame;}
  assert.match(latest,/OUTPUT_LINE_140/);assert.doesNotMatch(latest,/Review lines/);assert.equal(app.calls.length,0);
 }finally{await app.close();}
});

test('bracketed paste at 80 columns cannot turn embedded Control keys into paging commands',async()=>{
 const app=await mount();
 try{
  await app.key('\x1b[200~');await app.key('Safe \x10\x0e\x0c text');await app.key('\x1b[201~');
  assert.doesNotMatch(app.output,/Review lines/);assert.match(app.output,/Safe  text/);assert.equal(app.calls.length,0);
  await app.push(140,{running:false});await app.key('\r');assert.equal(app.calls[0].body.prompt,'Safe  text');
 }finally{await app.close();}
});

test('long single-line notices are wrapped into the review pane and help explains the Mac keys',async()=>{
 const app=await mount({running:false,sendError:'NOTICE_FIRST '+('details '.repeat(250))+' NOTICE_LAST'});
 try{
  await app.key('a fixture request');const failed=await app.key('\r');assert.match(failed,/NOTICE_LAST/);
  const before=app.calls.length;
  const older=range(await app.key('\x10'));assert.ok(older[1]<older[2]);
  assert.match(await app.key('\x0c'),/NOTICE_LAST/);assert.equal(app.calls.length,before);
  await app.key('\x15');await app.key('/help');const help=await app.key('\r');
  assert.match(help,/KEYBOARD \/ use Control on Mac, not Command/);assert.match(help,/Ctrl\+P previous page/);assert.match(help,/Ctrl\+L latest output/);
  assert.equal(app.calls.length,before,'help and scrolling must not submit backend work');
 }finally{await app.close();}
});

test('raw trackpad wheel reports scroll gradually, anchor streaming output and preserve the draft',async()=>{
 const app=await mount();
 try{
  await app.key('Draft kept');
  const first=range(await app.key('\x1b[<64;10;8M'));
  const second=range(await app.key('\x1b[<64;10;8M'));assert.equal(second[0],first[0]-3);
  const grown=range(await app.push(180));assert.deepEqual(grown.slice(0,2),second.slice(0,2));
  const next=range(await app.key('\x1b[<81;10;8M'));assert.equal(next[0],second[0]+3);
  await app.key('\x1b[<0;10;8M\x1b[<0;10;8m\x1b[<66;10;8M\x1b[<64;10;8m');
  await app.key('\x1b[200~');await app.key('\x1b[<64;10;8M');await app.key('\x1b[201~');
  const after=range(await app.push(190));assert.deepEqual(after.slice(0,2),next.slice(0,2));
  assert.equal(app.calls.length,0);await app.key('\x0c');
  assert.match(app.output,/OUTPUT_LINE_190/);
  await app.push(190,{running:false});await app.key('\r');assert.equal(app.calls[0].body.prompt,'Draft kept');
 }finally{await app.close();}
});

test('fragmented, legacy and burst wheel reports never become editor text or commands',async()=>{
 const app=await mount();
 try{
  await app.key('Keep this');const first=range(await app.key('\x1b[<64;10;8M'));
  await app.key('\x1b[<64;');const fragmented=range(await app.key('10;8M'));assert.equal(fragmented[0],first[0]-3);
  await app.key('\x1b[');const shortPrefix=range(await app.key('<64;10;8M'));assert.equal(shortPrefix[0],fragmented[0]-3);
  await app.key('\x1b[M');const legacy=range(await app.key('`!!'));assert.equal(legacy[0],shortPrefix[0]-3);
  const burst=range(await app.key('\x1b[<64;10;8M'.repeat(3)));assert.equal(burst[0],legacy[0]-9);
  let top;for(let i=0;i<18;i++){const frame=await app.key('\x1b[<64;10;8M'.repeat(4));if(frame)top=frame;}
  assert.equal(range(top)[0],1);
  await app.key('\x0c');await app.push(140,{running:false});await app.key('\r');assert.equal(app.calls[0].body.prompt,'Keep this');
 }finally{await app.close();}
});

test('a wheel burst opens a completed reply and keeps every scroll tick',async()=>{
 const app=await mount({running:false,width:110});
 try{
  const first=range(await app.key('\x1b[<64;10;8M'.repeat(2)));
  const visible=first[1]-first[0]+1;
  assert.equal(first[0],first[2]-visible-6+1);
  const next=range(await app.key('\x1b[<64;10;8M'));assert.equal(next[0],first[0]-3);assert.equal(app.calls.length,0);
 }finally{await app.close();}
});
