import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {PassThrough,Writable} from 'node:stream';
import {setTimeout as delay} from 'node:timers/promises';
import {render,renderToString} from 'ink';
import {ModelScreen} from '../cli/model-screen.mjs';
import {clean} from '../cli/core.mjs';
import {cellWidth} from '../cli/layout.mjs';

const frame=(size,props={})=>clean(renderToString(React.createElement(ModelScreen,{size,staticPreview:true,...props}),{columns:size.w}));
const assertFits=(output,size)=>{
 const lines=output.split('\n');
 assert.ok(lines.length<=size.h,`${size.w}x${size.h}: ${lines.length} rows`);
 assert.ok(lines.every(line=>cellWidth(line)<=size.w),`${size.w}x${size.h}: overflowing line`);
 assert.match(output,/TIM \/ MODELS/);assert.match(output,/Ctrl\+R refresh/);assert.match(output,/Ctrl\+Q quit/);
 assert.match(output,/S local setup/);assert.match(output,/P cloud help/);
};

test('model list fits minimum and large viewports with long Unicode names and saved drafts',()=>{
 const models=Array.from({length:70},(_,index)=>({id:`chat-${index}`,name:`Model ${index+1} `+'界🙂e\u0301'.repeat(45),kind:'chat',available:index%3!==2,issue:'Engine missing'}));
 for(const size of [{w:80,h:16},{w:160,h:52}]){
  const output=frame(size,{models,draft:'a request\nwith Unicode 界',mode:'code'});
  assertFits(output,size);assert.match(output,/Choose a model for Code mode/);assert.match(output,/70 chat models/);
  assert.match(output,/Your request is saved/);assert.match(output,/needs setup/);assert.match(output,/Ctrl\+P\/N page/);
 }
});

test('empty model screens fit and explain terminal local setup, cloud providers and existing libraries',()=>{
 for(const size of [{w:80,h:16},{w:160,h:52}]){
  const output=frame(size,{models:[{id:'image-only',kind:'image',available:true}],draft:'keep this request'});
  assertFits(output,size);assert.match(output,/No chat models found/);assert.match(output,/tim --library PATH/);
  assert.match(output,/Press S to browse supported local models and set up here/);
  assert.match(output,/Press P for ChatGPT, Grok or Claude connection steps/);
  assert.doesNotMatch(output,/desktop Model Library/);
  assert.match(output,/Ctrl\+R rescans the current library/);assert.doesNotMatch(output,/image-only/);
 }
});

test('unavailable models retain their reason and setup guidance within both viewports',()=>{
 const models=Array.from({length:9},(_,index)=>({id:`missing-${index}`,name:`Unavailable model ${index+1}`,kind:'chat',available:false,issue:'Engine missing: install the matching local runtime.'}));
 for(const size of [{w:80,h:16},{w:160,h:52}]){
  const output=frame(size,{models,draft:'saved',mode:'chat'});
  assertFits(output,size);assert.match(output,/Choose a model for Chat mode/);assert.match(output,/0 available/);
  assert.match(output,/Unavailable: Engine missing/);assert.match(output,/tim --library PATH/);
  assert.match(output,/S: browse local models and setup/);assert.match(output,/P: ChatGPT \/ Grok \/ Claude/);
 }
});

function choicesFixture(){
 const catalog=[
  {id:'installed-entry',kind:'chat',name:'Installed catalog name',memoryGB:1.6,downloadBytes:400_000_000},
  {id:'balanced',kind:'chat',name:'Balanced downloadable',memoryGB:4.5,downloadBytes:2_500_000_000},
  {id:'large',kind:'chat',name:'Larger downloadable',memoryGB:8,downloadBytes:5_000_000_000},
  {id:'light',kind:'chat',name:'Lighter downloadable',memoryGB:2.5,downloadBytes:1_000_000_000},
  {id:'huge',kind:'chat',name:'Huge downloadable',memoryGB:40,downloadBytes:25_000_000_000},
  {id:'image',kind:'image',name:'Image-only fixture',memoryGB:2,downloadBytes:100},
 ];
 const models=[{id:'imported:installed',catalogId:'installed-entry',name:'Current installed fixture',kind:'chat',available:true}];
 return {models,catalog,currentModelId:models[0].id,memory:{totalBytes:32*2**30,availableBytes:24*2**30,modelBudgetBytes:20*2**30,reserveBytes:4*2**30,status:'ok',availableSource:'os'}};
}

test('one installed model is shown with all supported catalog alternatives and a single current badge',()=>{
 const props=choicesFixture();
 for(const size of [{w:80,h:16},{w:160,h:52}]){
  const output=frame(size,{...props,draft:'keep this request'});assertFits(output,size);
  assert.match(output,/5 chat models \/ 1 available \/ 4 downloadable/);
  assert.equal((output.match(/\[CURRENT\]/g)||[]).length,1);assert.match(output,/Current installed/);
  assert.match(output,/Balanced/);assert.match(output,/Larger/);assert.match(output,/Lighter/);assert.match(output,/Huge/);
  assert.match(output,/download \/ 2\.5 GB \/ ~4\.5 GiB RAM/);assert.doesNotMatch(output,/Installed catalog name|Image-only fixture/);
 }
});

test('catalog suggestions use cyan distinctly from installed model green',()=>{
 const script="import React from 'react';import {renderToString} from 'ink';import {ModelScreen} from './cli/model-screen.mjs';process.stdout.write(renderToString(React.createElement(ModelScreen,{...JSON.parse(process.argv[1]),size:{w:160,h:52},staticPreview:true}),{columns:160}));";
 const result=spawnSync(process.execPath,['--input-type=module','-e',script,JSON.stringify(choicesFixture())],{cwd:fileURLToPath(new URL('..',import.meta.url)),env:{...process.env,FORCE_COLOR:'3'},encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);assert.ok(result.stdout.includes('\x1b[38;2;103;217;239m'),'suggestions use cyan');
 assert.ok(result.stdout.includes('\x1b[38;2;142;232;170m'),'current installed model uses green');
 assert.equal((clean(result.stdout).match(/\[SUGGESTED\]/g)||[]).length,3);
});

async function mount(props={}){
 const stdin=new PassThrough();stdin.isTTY=true;stdin.ref=()=>stdin;stdin.unref=()=>stdin;stdin.setRawMode=()=>stdin;
 let output='',back=0,setup=0,providers=0;const selections=[],downloads=[];
 const stdout=new Writable({write(chunk,_encoding,done){output+=chunk;done();}});stdout.isTTY=true;stdout.columns=80;stdout.rows=16;
 const base={size:{w:80,h:16},...choicesFixture(),onSelect:model=>selections.push(model),onDownload:choice=>downloads.push(choice),onBack:()=>{back++;},onSetup:()=>{setup++;},onProviders:()=>{providers++;},...props};
 const ui=render(React.createElement(ModelScreen,base),{stdin,stdout,stderr:stdout,exitOnCtrlC:false,patchConsole:false});const exited=ui.waitUntilExit();await delay(80);
 return {selections,downloads,get output(){return clean(output);},get frame(){const value=clean(output);return value.slice(Math.max(0,value.lastIndexOf('TIM / MODELS')));},get back(){return back;},get setup(){return setup;},get providers(){return providers;},
  async key(value){const offset=output.length;stdin.write(value);await delay(80);return clean(output.slice(offset));},
  async update(value){Object.assign(base,value);ui.rerender(React.createElement(ModelScreen,base));await delay(80);},
  async close(){ui.unmount();await exited;ui.cleanup();stdin.destroy();stdout.destroy();}};
}

test('Enter routes installed models to selection and catalog downloads only to setup review',async()=>{
 const props=choicesFixture(),screen=await mount(props);
 try{
  assert.equal(screen.selections.length,0);assert.equal(screen.downloads.length,0,'mounting never starts setup');
  await screen.key('\r');assert.equal(screen.selections[0],props.models[0],'installed selection receives actual registry model');
  await screen.key('\x1b[B');assert.equal(screen.downloads.length,0,'highlighting a catalog model does not start setup');
  await screen.key('\r');assert.equal(screen.downloads.length,1);assert.equal(screen.downloads[0].id,'catalog:balanced');assert.equal(screen.downloads[0].catalogId,'balanced');
  assert.equal(screen.selections.length,1);
  await screen.key('s');await screen.key('p');await screen.key('\x1b');assert.equal(screen.setup,1);assert.equal(screen.providers,1);assert.equal(screen.back,1);
 }finally{await screen.close();}
});

test('unavailable catalog models open review but unavailable imports show their issue',async()=>{
 const base=choicesFixture();base.models=[{...base.models[0],available:false,issue:'Repair matching runtime'},{id:'missing-import',name:'Unavailable import',kind:'chat',available:false,issue:'Missing imported model file'}];
 const screen=await mount(base);
 try{
  await screen.key('\r');assert.equal(screen.downloads[0].catalogId,'installed-entry');assert.equal(screen.selections.length,0);
  await screen.key('2');await screen.key('\r');assert.match(screen.output,/Unavailable: Missing imported model file/);
  assert.equal(screen.downloads.length,1);assert.equal(screen.selections.length,0);
 }finally{await screen.close();}
});

test('catalog selection survives refresh reorder and invalid numbers cannot trigger setup',async()=>{
 const props=choicesFixture(),screen=await mount(props);
 try{
  await screen.key('4');await screen.update({catalog:[...props.catalog].reverse()});
  await screen.key('\r');assert.equal(screen.downloads[0].catalogId,'light');
  await screen.key('999');await screen.key('\r');assert.match(screen.output,/No model numbered 4999/);assert.equal(screen.downloads.length,1);
  await screen.key('\x1b[A');await screen.key('\r');assert.equal(screen.downloads.length,2);
 }finally{await screen.close();}
});

test('refresh preserves the chosen catalog model when installation gives it a different registry ID',async()=>{
 const props=choicesFixture(),screen=await mount(props);
 try{
  await screen.key('2');const installed={id:'local:balanced-alias',catalogId:'balanced',name:'Installed balanced alias',kind:'chat',available:true};
  await screen.update({models:[...props.models,installed]});await screen.key('\r');
  assert.equal(screen.selections.length,1);assert.equal(screen.selections[0],installed);
  assert.equal(screen.downloads.length,0,'installation must keep the chosen catalog identity rather than fall back to the first installed model');
 }finally{await screen.close();}
});

test('a removed selection requires an explicit new choice before any model can be selected or reviewed',async()=>{
 const props=choicesFixture(),screen=await mount(props);
 try{
  await screen.key('2');await screen.update({catalog:props.catalog.filter(entry=>entry.id!=='balanced')});
  assert.match(screen.output,/Your selected model is no longer available/);await screen.key('\r');
  assert.equal(screen.selections.length,0);assert.equal(screen.downloads.length,0);
  await screen.key('\x1b[B');await screen.key('\r');
  assert.equal(screen.selections.length,1);assert.equal(screen.selections[0],props.models[0]);
 }finally{await screen.close();}
});

test('Mac paging keys move by a visible page and only a separate Enter selects or opens review',async()=>{
 const props=choicesFixture();props.catalog.push(...Array.from({length:20},(_,index)=>({id:`extra-${index+1}`,name:`Extra ${index+1}`,kind:'chat',memoryGB:2,downloadBytes:100_000_000})));
 const screen=await mount(props);
 try{
  await screen.key('\x0e');assert.equal(screen.selections.length,0);assert.equal(screen.downloads.length,0);
  await screen.key('\r');assert.equal(screen.downloads.at(-1).catalogId,'extra-2');
  await screen.key('\x10');await screen.key('\r');assert.equal(screen.selections.at(-1),props.models[0]);
  await screen.key('\x1b[1;3B');await screen.key('\r');assert.equal(screen.downloads.at(-1).catalogId,'extra-2');
  await screen.key('\x1b[1;3A');await screen.key('\r');assert.equal(screen.selections.length,2);assert.equal(screen.selections.at(-1),props.models[0]);
  await screen.key('\x0c');assert.equal(screen.downloads.length,2);await screen.key('\r');assert.equal(screen.downloads.at(-1).catalogId,'extra-20');
 }finally{await screen.close();}
});

test('raw SGR wheel scrolls model highlights without selecting or opening downloads',async()=>{
 const props=choicesFixture();props.catalog.push(...Array.from({length:20},(_,index)=>({id:`wheel-${index+1}`,name:`Wheel ${index+1}`,kind:'chat',memoryGB:2,downloadBytes:100_000_000})));
 const screen=await mount(props);
 try{
  const down=await screen.key('\x1b[<65;10;8M');assert.match(down,/4 selected/);assert.match(down,/Lighter/);
  assert.equal(screen.selections.length,0);assert.equal(screen.downloads.length,0);assert.equal(screen.setup,0);assert.equal(screen.providers,0);
  assert.match(await screen.key('\x1b[<64;10;8M'),/1 selected/);
  await screen.key('\x1b[<64;10;8M');assert.match(screen.frame,/1 selected/,'wheel clamps at the first model');
  await screen.key('\x1b[<65;10;8M'.repeat(3));assert.match(screen.frame,/10 selected/,'coalesced wheel ticks each advance the highlight');
  await screen.key('\x1b[<64;10;8M'.repeat(3));assert.match(screen.frame,/1 selected/);
  assert.equal(screen.downloads.length,0);assert.equal(screen.selections.length,0);
  await screen.key('\x1b[<65;10;8M');await screen.key('\r');assert.equal(screen.downloads[0].catalogId,'light');
  assert.equal(screen.downloads.length,1,'a separate Enter is still needed to open review');assert.equal(screen.selections.length,0);
 }finally{await screen.close();}
});
