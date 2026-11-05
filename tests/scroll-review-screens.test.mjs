import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {PassThrough,Writable} from 'node:stream';
import {setTimeout as delay} from 'node:timers/promises';
import {render} from 'ink';
import {ToolScreen} from '../cli/tool-screen.mjs';
import {DesktopScreen} from '../cli/desktop-screen.mjs';
import {ToolRunner,makeReview} from '../cli/tool-runner.mjs';
import {clean} from '../cli/core.mjs';
import {pageSize} from '../cli/scroll.mjs';

const size={w:100,h:24},height=size.h-9;
const rows=(first,last)=>Array.from({length:last-first+1},(_,offset)=>'FIXTURE_ROW_'+String(first+offset).padStart(3,'0'));
const review=()=>makeReview({id:'scroll-fixture',name:'SCROLL FIXTURE',status:'installed',executable:process.execPath,risk:rows(1,80).join('\n')},['fixture-only']);

async function mount(Component,props){
 const stdin=new PassThrough();stdin.isTTY=true;stdin.ref=()=>stdin;stdin.unref=()=>stdin;stdin.setRawMode=()=>stdin;
 let output='',back=0,quit=0;
 const stdout=new Writable({write(chunk,_encoding,done){output+=chunk;done();}});stdout.isTTY=true;stdout.columns=size.w;stdout.rows=size.h;
 const ui=render(React.createElement(Component,{size,...props,onBack:()=>{back++;},onQuit:()=>{quit++;}}),{stdin,stdout,stderr:stdout,exitOnCtrlC:false,patchConsole:false});
 const exited=ui.waitUntilExit();await delay(80);
 const frame=()=>{const value=clean(output),marker=Component===ToolScreen?'TIM / TOOLS':'TIM / DESKTOP REVIEW';return value.slice(Math.max(0,value.lastIndexOf(marker)));};
 return {get frame(){return frame();},get back(){return back;},get quit(){return quit;},async key(value){stdin.write(value);await delay(65);return frame();},async settle(){await delay(80);return frame();},async close(){ui.unmount();await exited;ui.cleanup();stdin.destroy();stdout.destroy();}};
}
const range=frame=>{
 const match=frame.match(/(?:lines |Review )(\d+)-(\d+)\/(\d+)/);
 assert.ok(match,'No visible scroll range in frame:\n'+frame);
 return {start:Number(match[1]),end:Number(match[2]),total:Number(match[3])};
};
const valid=view=>{assert.ok(view.start>=1);assert.ok(view.end>=view.start);assert.ok(view.end<=view.total);};

test('tool review pages with Mac keys and aliases, clamps bounds, and launches only with Ctrl+S',async t=>{
 const launched=[];t.mock.method(ToolRunner.prototype,'run',async function(value){launched.push(value);this.update({status:'completed',review:value,output:'FIXTURE_APPROVED',exitCode:0});return this.state;});
 const screen=await mount(ToolScreen,{initialTools:[],initialReview:review()});
 try{
  const top=range(screen.frame);assert.equal(top.start,1);assert.match(screen.frame,/Ctrl\+P\/N page/);assert.match(screen.frame,/Ctrl\+L bottom/);
  assert.equal(range(await screen.key('\x1b[<65;10;8M')).start,4,'wheel down scrolls three review lines');
  assert.equal(range(await screen.key('\x1b[<64;10;8M')).start,1,'wheel up returns toward the start');assert.equal(launched.length,0);
  assert.equal(range(await screen.key('\x1b[<65;10;8M'.repeat(3))).start,10,'coalesced wheel ticks each advance three lines');
  assert.equal(range(await screen.key('\x1b[<64;10;8M'.repeat(3))).start,1);
  const next=range(await screen.key('\x0e'));assert.equal(next.start,top.start+pageSize(height));
  assert.equal(range(await screen.key('\x10')).start,1);
  assert.equal(range(await screen.key('\x1b[6~')).start,next.start,'Page Down remains an alias');
  assert.equal(range(await screen.key('\x1b[1;3A')).start,1,'Option/Alt Up pages toward the start');
  assert.equal(range(await screen.key('\x1b[1;3B')).start,next.start,'Option/Alt Down pages forward');
  const bottom=range(await screen.key('\x0c'));assert.equal(bottom.end,bottom.total);
  const clamped=range(await screen.key('\x0e'));assert.deepEqual(clamped,bottom);valid(clamped);
  assert.equal(launched.length,0,'scrolling must not approve or run a command');
  assert.match(screen.frame,/Ctrl\+S = run this exact command once/);
  await screen.key('\x13');assert.equal(launched.length,1);assert.deepEqual(launched[0].args,['fixture-only']);
  assert.match(screen.frame,/FIXTURE_APPROVED/);
 }finally{await screen.close();}
});

test('tool output keeps the reviewed window anchored as chunks arrive and Ctrl+L follows latest again',async t=>{
 let runner;
 t.mock.method(ToolRunner.prototype,'run',async function(value){runner=this;this.update({status:'running',review:value,output:rows(1,80).join('\n'),exitCode:null});return this.state;});
 const screen=await mount(ToolScreen,{initialTools:[],initialReview:review()});
 try{
  await screen.key('\x13');assert.ok(runner);
  const latest=range(screen.frame);assert.equal(latest.end,latest.total);
  const previous=range(await screen.key('\x10'));assert.equal(previous.start,latest.start-pageSize(height));
  assert.equal(range(await screen.key('\x1b[<64;10;8M')).start,previous.start-3);
  assert.equal(range(await screen.key('\x1b[<65;10;8M')).start,previous.start);
  assert.equal(range(await screen.key('\x1b[<64;10;8M'.repeat(3))).start,previous.start-9);
  assert.equal(range(await screen.key('\x1b[<65;10;8M'.repeat(3))).start,previous.start);
  const firstVisible=screen.frame.match(/FIXTURE_ROW_\d+/)?.[0];assert.ok(firstVisible);
  runner.update({output:rows(1,100).join('\n')});await screen.settle();
  const anchored=range(screen.frame);assert.equal(anchored.start,previous.start);assert.equal(anchored.total,previous.total+20);
  assert.equal(screen.frame.match(/FIXTURE_ROW_\d+/)?.[0],firstVisible,'new output must not push the reader to the bottom');
  const advanced=range(await screen.key('\x0e'));assert.equal(advanced.start,anchored.start+pageSize(height));
  const bottom=range(await screen.key('\x0c'));assert.equal(bottom.end,bottom.total);assert.match(screen.frame,/FIXTURE_ROW_100/);
  runner.update({output:rows(1,110).join('\n')});await screen.settle();
  const following=range(screen.frame);assert.equal(following.end,following.total);assert.equal(following.total,bottom.total+10);assert.match(screen.frame,/FIXTURE_ROW_110/);
  for(let page=0;page<10;page++)await screen.key('\x10');assert.equal(range(screen.frame).start,1);
  assert.equal(range(await screen.key('\x10')).start,1);valid(range(screen.frame));
  assert.equal(range(await screen.key('\x1b[B')).start,2,'plain arrows scroll readonly output one line');
 }finally{await screen.close();}
});

test('tool menu pages selection without changing its filter, and argument paging leaves the draft untouched',async t=>{
 let launches=0;t.mock.method(ToolRunner.prototype,'run',async function(){launches++;return this.state;});
 const tools=Array.from({length:40},(_,index)=>({id:'find-'+index,name:'Find '+String(index+1).padStart(2,'0'),category:'Development',description:'Harmless fixture adapter',status:'installed',executable:process.execPath,defaultArgs:[]}));
 const screen=await mount(ToolScreen,{initialTools:tools});
 try{
  await screen.key('Find');assert.match(screen.frame,/Search: Find /);
  await screen.key('\x1b[<65;10;8M');assert.match(screen.frame,/> Find 04/);assert.match(screen.frame,/Search: Find /);
  await screen.key('\x1b[<64;10;8M');assert.match(screen.frame,/> Find 01/);
  await screen.key('\x1b[<65;10;8M'.repeat(3));assert.match(screen.frame,/> Find 10/);assert.match(screen.frame,/Search: Find /);
  await screen.key('\x1b[<64;10;8M'.repeat(3));assert.match(screen.frame,/> Find 01/);assert.equal(launches,0);
  await screen.key('\x0e');assert.match(screen.frame,new RegExp('> Find '+String(1+pageSize(height-2)).padStart(2,'0')));assert.match(screen.frame,/Search: Find /);
  await screen.key('\x10');assert.match(screen.frame,/> Find 01/);
  await screen.key('\x0c');assert.match(screen.frame,/> Find 40/);await screen.key('\x0e');assert.match(screen.frame,/> Find 40/);
  await screen.key('\r');await screen.key('literal --flag');
  await screen.key('\x1b[<65;10;8M');await screen.key('\x1b[<64;10;8M');
  await screen.key('\x0e');await screen.key('\x10');await screen.key('\x0c');
  assert.match(screen.frame,/literal --flag\|/);assert.doesNotMatch(screen.frame,/literal --flag[pnl]/);
  await screen.key('\r');assert.match(screen.frame,/Arguments \/ targets: \["literal","--flag"\]/);assert.equal(launches,0);
 }finally{await screen.close();}
});

test('desktop review pages long content without editing or approving its exact token',async()=>{
 const answers=[],calls=[];
 const runTask=async(options,{review,signal})=>{calls.push(options);answers.push(await review({kind:'fixture-review',details:rows(1,80),token:'EXACT_FIXTURE_TOKEN'},signal));return {status:'fixture-done'};};
 const screen=await mount(DesktopScreen,{request:'Harmless semantic fixture',runTask});
 try{
  await screen.key('/fixture/adapter');await screen.key('\r');await screen.key('42');await screen.key('\r');
  assert.match(screen.frame,/DESKTOP REVIEW \/ REVIEW/);assert.equal(calls.length,1);
  await screen.key('EXACT_FIXTURE_TOKEN');const top=range(screen.frame);
  assert.equal(range(await screen.key('\x1b[<65;10;8M')).start,4);assert.match(screen.frame,/Exact token: EXACT_FIXTURE_TOKEN/);
  assert.equal(range(await screen.key('\x1b[<64;10;8M')).start,1);assert.equal(answers.length,0);
  assert.equal(range(await screen.key('\x1b[<65;10;8M'.repeat(3))).start,10);assert.match(screen.frame,/Exact token: EXACT_FIXTURE_TOKEN/);
  assert.equal(range(await screen.key('\x1b[<64;10;8M'.repeat(3))).start,1);assert.equal(answers.length,0);
  const next=range(await screen.key('\x0e'));assert.equal(next.start,top.start+pageSize(height));
  assert.match(screen.frame,/Exact token: EXACT_FIXTURE_TOKEN/);assert.equal(answers.length,0);
  assert.equal(range(await screen.key('\x10')).start,1);
  assert.equal(range(await screen.key('\x1b[6~')).start,next.start);
  assert.equal(range(await screen.key('\x1b[1;3A')).start,1);
  const bottom=range(await screen.key('\x0c'));assert.equal(bottom.end,bottom.total);assert.match(screen.frame,/EXACT_FIXTURE_TOKEN/);
  assert.deepEqual(range(await screen.key('\x0e')),bottom);valid(range(screen.frame));assert.equal(answers.length,0);
  await screen.key('\r');assert.deepEqual(answers,['EXACT_FIXTURE_TOKEN']);assert.match(screen.frame,/fixture-done/);
  for(let page=0;page<3;page++)await screen.key('\x0e');valid(range(screen.frame));assert.match(screen.frame,/fixture-done/);
  await screen.key('\x1b');assert.equal(screen.quit,1);
 }finally{await screen.close();}
});

test('Escape still declines a pending desktop review after paging without approving it',async()=>{
 let approved=false;
 const runTask=async(_options,{review,signal})=>{await review({kind:'fixture-review',details:rows(1,40)},signal);approved=true;return {status:'unexpected'};};
 const screen=await mount(DesktopScreen,{request:'Harmless cancellation fixture',runTask});
 try{
  await screen.key('/fixture/adapter');await screen.key('\r');await screen.key('42');await screen.key('\r');
  await screen.key('\x0e');await screen.key('\x0c');
  await screen.key('\x1b');assert.equal(approved,false);assert.match(screen.frame,/DESKTOP REVIEW \/ DONE/);assert.equal(screen.quit,0);
  await screen.key('\x1b');assert.equal(screen.quit,1);
 }finally{await screen.close();}
});
