import './terminal-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {PassThrough,Writable} from 'node:stream';
import {setTimeout as delay} from 'node:timers/promises';
import {render,renderToString} from 'ink';
import {LocalSetupScreen} from '../cli/local-setup-screen.mjs';
import {clean} from '../cli/core.mjs';
import {cellWidth} from '../cli/layout.mjs';

const GiB=2**30;
function snapshot({longNames=false}={}){
 const catalog=Array.from({length:18},(_,index)=>({id:`supported-${index+1}`,kind:'chat',name:`Catalog ${index+1}${longNames?' 界🙂e\u0301'.repeat(15):''}`,description:`Description for choice ${index+1}`,downloadBytes:(index+1)*100_000_000,memoryGB:[.8,1.6,3,4.5,7.5,13,19,25,40][index%9]}));
 catalog.push({id:'image-model',name:'Image-only fixture',kind:'image',downloadBytes:100,memoryGB:1});
 return {config:{mainAgentModelId:''},models:[],jobs:[],catalog,downloads:[],engines:{},runtimeSetup:{status:'idle'},orchestrator:{status:'not-installed'},dataDir:'/fixture/tim-data',memory:{totalBytes:24*GiB,availableBytes:18*GiB,reserveBytes:3*GiB,modelBudgetBytes:15*GiB,status:'ok',availableSource:'os'}};
}
function renderFrame(initial,size,props={}){
 return renderToString(React.createElement(LocalSetupScreen,{size,initial,staticPreview:true,...props}),{columns:size.w});
}
function fits(output,size){
 const lines=clean(output).split('\n');
 assert.ok(lines.length<=size.h,`${size.w}x${size.h}: ${lines.length} rows`);
 assert.ok(lines.every(row=>cellWidth(row)<=size.w),`${size.w}x${size.h}: overflowing row`);
 assert.match(clean(output),/TIM \/ LOCAL SETUP/);assert.match(clean(output),/Ctrl\+Q \/ Ctrl\+C quit/);
}

test('complete supported chat catalog has size, memory, hardware and distinct suggestion colors',()=>{
 const initial=snapshot();
 const script="import React from 'react';import {renderToString} from 'ink';import {LocalSetupScreen} from './cli/local-setup-screen.mjs';process.stdout.write(renderToString(React.createElement(LocalSetupScreen,{size:{w:160,h:52},initial:JSON.parse(process.argv[1]),staticPreview:true}),{columns:160}));";
 const result=spawnSync(process.execPath,['--input-type=module','-e',script,JSON.stringify(initial)],{cwd:fileURLToPath(new URL('..',import.meta.url)),env:{...process.env,FORCE_COLOR:'3'},encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);const output=result.stdout;
 fits(output,{w:160,h:52});const plain=clean(output);
 assert.match(plain,/18 supported chat models/);assert.doesNotMatch(plain,/Image-only/);
 for(let index=1;index<=18;index++)assert.ok(plain.includes(`Catalog ${index} `),`missing supported choice ${index}`);
 assert.match(plain,/RAM 24\.0 GiB \/ available 18\.0 GiB \/ model budget 15\.0 GiB/);
 assert.match(plain,/100 MB \/ ~0\.8 GiB RAM \/ download/);assert.match(plain,/Suggested:/);
 assert.ok((plain.match(/\[SUGGESTED\]/g)||[]).length>=3,'several suggested choices remain visible');
 assert.ok(output.includes('\x1b[38;2;103;217;239m'),'suggestions use cyan');
 assert.ok(output.includes('\x1b[38;2;197;247;212m'),'ordinary choices use the normal green');
});

test('initial catalog frames fit both viewports with Unicode names, unknown memory and installed repair states',()=>{
 for(const size of [{w:80,h:16},{w:160,h:52}]){
  const installed=snapshot({longNames:true});installed.config.mainAgentModelId='catalog:supported-5';
  installed.models=[{id:'catalog:supported-5',catalogId:'supported-5',kind:'chat',available:false,issue:'Fixture engine is missing'}];
  const repaired=clean(renderFrame(installed,size));fits(repaired,size);
  assert.match(repaired,/needs repair/);assert.match(repaired,/Unavailable: Fixture engine is missing/);assert.match(repaired,/fixture\/tim-data/);
  const unknown={...snapshot(),memory:{status:'unknown'}};const output=clean(renderFrame(unknown,size));fits(output,size);
  assert.match(output,/RAM unknown/);assert.equal((output.match(/\[SUGGESTED\]/g)||[]).length,1,'unknown memory marks no individual model as suggested');
 }
});

test('static preview uses the supplied snapshot and keeps external installed choices alongside the full catalog',()=>{
 const initial=snapshot(),calls=[];initial.config.mainAgentModelId='external-custom';initial.models=[{id:'external-custom',name:'External custom fixture',kind:'chat',available:true}];
 const output=clean(renderFrame(initial,{w:160,h:52},{client:{request:(...args)=>{calls.push(args);}}}));
 assert.equal(calls.length,0);assert.match(output,/18 supported chat models/);assert.match(output,/External custom fixture/);assert.match(output,/no download/);
 for(let index=1;index<=18;index++)assert.ok(output.includes(`Catalog ${index} `));
});

async function mount({initial=snapshot(),readyAfterSetup=true,freshOptions,initialCatalogId='',startInReview=false,mode='agent'}={}){
 let current=structuredClone(initial),output='',back=0,quit=0;const calls=[],completed=[];
 const stdin=new PassThrough();stdin.isTTY=true;stdin.ref=()=>stdin;stdin.unref=()=>stdin;stdin.setRawMode=()=>stdin;
 const stdout=new Writable({write(chunk,_encoding,done){output+=chunk;done();}});stdout.isTTY=true;stdout.columns=80;stdout.rows=16;
 const client={controller:new AbortController(),async request(route,body){
  calls.push({route,body:structuredClone(body)});
  if(route==='setup/options'){if(freshOptions)current=structuredClone(freshOptions);return structuredClone(current);}
  if(route==='state')return structuredClone(current);
  if(route==='rescan')return {ok:true};
  if(route==='setup'){
   if(readyAfterSetup){
    const entry=current.catalog.find(entry=>entry.id===body.catalogId),modelId='catalog:'+entry.id;
    const specialist=body.mode==='chat'||body.mode==='code';
    current={...current,config:specialist?current.config:{mainAgentModelId:modelId},models:[...current.models.filter(model=>model.id!==modelId),{id:modelId,catalogId:entry.id,name:entry.name,kind:'chat',available:true}],engines:{chat:{available:true}},runtimeSetup:{status:'ready'},orchestrator:specialist?current.orchestrator:{status:'running',loaded:true,modelId},localSetup:{catalogId:entry.id,status:'ready',...(specialist?{mode:body.mode}:{})},...(specialist?{loadedModelId:modelId,loadedModels:[{modelId,role:'specialist'}]}:{})};
   }
   return {ok:true};
  }
  throw new Error('Unexpected fixture route '+route);
 }};
 const props={size:{w:80,h:16},client,initial,initialCatalogId,startInReview,mode,onReady:value=>completed.push(value),onBack:()=>{back++;},onQuit:()=>{quit++;}};
 const ui=render(React.createElement(LocalSetupScreen,props),{stdin,stdout,stderr:stdout,exitOnCtrlC:false,patchConsole:false});
 const exited=ui.waitUntilExit();await delay(100);
 return {calls,completed,get output(){return clean(output);},get back(){return back;},get quit(){return quit;},setSnapshot(value){current=structuredClone(value);},
  async key(value){const offset=output.length;stdin.write(value);await delay(100);return clean(output.slice(offset));},
  async update(value){ui.rerender(React.createElement(LocalSetupScreen,{...props,initial:value}));await delay(100);},
  async close(){ui.unmount();await exited;ui.cleanup();stdin.destroy();stdout.destroy();}};
}

test('first Enter reviews any undownloaded choice; confirmation posts that catalog ID and no other model',async()=>{
 const screen=await mount();
 try{
  assert.deepEqual(screen.calls.map(call=>call.route),['setup/options'],'mount only reads fresh supported models and hardware');
  await screen.key('9');const review=await screen.key('\r');
  assert.match(review,/REVIEW \/ Catalog 9/);assert.match(review,/900 MB/);assert.match(review,/Memory warning: estimate exceeds/);
  assert.equal(screen.calls.filter(call=>call.route==='setup').length,0);
  await screen.key('\r');assert.deepEqual(screen.calls.find(call=>call.route==='setup').body,{catalogId:'supported-9',installRuntime:true});
  assert.equal(screen.completed.length,1);assert.equal(screen.completed[0].config.mainAgentModelId,'catalog:supported-9');
 }finally{await screen.close();}
});

test('paging reaches all choices; invalid numbers never open review; refresh preserves selected ID',async()=>{
 const screen=await mount();
 try{
  await screen.key('\x1b[6~');assert.match(screen.output,/Catalog 9/);
  await screen.key('18');assert.match(screen.output,/Catalog 18/);
  await screen.key('9');const invalid=await screen.key('\r');assert.match(invalid,/Choose a valid model number/);
  assert.equal(screen.calls.filter(call=>call.route==='setup').length,0);
  await screen.key('\x7f');assert.match(await screen.key('\r'),/REVIEW \/ Catalog 18/);
  await screen.key('\x1b');const refreshed=snapshot();refreshed.catalog.reverse();refreshed.memory.availableBytes=10*GiB;refreshed.memory.modelBudgetBytes=7*GiB;
  screen.setSnapshot(refreshed);await screen.key('\x12');assert.match(screen.output,/available 10\.0 GiB/);
  assert.match(await screen.key('\r'),/REVIEW \/ Catalog 18/);
  await screen.key('\x1b');await screen.key('\x1b');assert.equal(screen.back,1);
  await screen.key('\x11');assert.equal(screen.quit,1);
 }finally{await screen.close();}
});

test('parent state updates preserve the reviewed target and Escape stops only setup monitoring',async()=>{
 const screen=await mount({readyAfterSetup:false});
 try{
  await screen.key('4');await screen.key('\r');await screen.update({...snapshot(),runtimeSetup:{status:'idle'}});
  await screen.key('\r');assert.equal(screen.calls.find(call=>call.route==='setup').body.catalogId,'supported-4');
  await screen.key('\x1b');assert.equal(screen.back,1);const count=screen.calls.length;
  await delay(600);assert.equal(screen.calls.length,count,'monitoring stops without cancelling the backend download');
  assert.equal(screen.calls.filter(call=>call.route==='cancel').length,0);assert.equal(screen.completed.length,0);
 }finally{await screen.close();}
});

test('a model removed during review cannot silently start a different catalog choice',async()=>{
 const screen=await mount();
 try{
  await screen.key('4');await screen.key('\r');const removed=snapshot();removed.catalog=removed.catalog.filter(entry=>entry.id!=='supported-4');
  screen.setSnapshot(removed);assert.match(await screen.key('\x12'),/Selected model disappeared/);
  await screen.key('\r');assert.equal(screen.calls.filter(call=>call.route==='setup').length,0);
  await screen.key('\x1b');assert.match(await screen.key('\r'),/REVIEW \/ Catalog/);
 }finally{await screen.close();}
});

test('Ctrl+P/N and Option arrows page the setup catalog without starting downloads',async()=>{
 const screen=await mount();
 try{
  await screen.key('1');await screen.key('\x0e');assert.match(await screen.key('\r'),/REVIEW \/ Catalog 6/);
  await screen.key('\x1b');await screen.key('\x10');assert.match(await screen.key('\r'),/REVIEW \/ Catalog 1/);
  await screen.key('\x1b');await screen.key('\x1b[1;3B');assert.match(await screen.key('\r'),/REVIEW \/ Catalog 6/);
  await screen.key('\x1b');await screen.key('\x1b[1;3A');assert.match(await screen.key('\r'),/REVIEW \/ Catalog 1/);
  await screen.key('\x1b');await screen.key('\x0c');assert.match(await screen.key('\r'),/REVIEW \/ Catalog 18/);
  assert.deepEqual(screen.calls.map(call=>call.route),['setup/options'],'scrolling and review never approve setup or request a download');
 }finally{await screen.close();}
});

test('raw SGR wheel browses the setup catalog and cannot confirm a reviewed download',async()=>{
 const screen=await mount();
 try{
  await screen.key('1');await screen.key('\x1b[<65;10;8M'.repeat(3));assert.match(await screen.key('\r'),/REVIEW \/ Catalog 10/);
  assert.deepEqual(screen.calls.map(call=>call.route),['setup/options']);
  await screen.key('\x1b');await screen.key('\x1b[<64;10;8M'.repeat(3));assert.match(await screen.key('\r'),/REVIEW \/ Catalog 1/);
  await screen.key('\x1b');await screen.key('\x1b[<65;10;8M');
  assert.deepEqual(screen.calls.map(call=>call.route),['setup/options']);
  assert.match(await screen.key('\r'),/REVIEW \/ Catalog 4/);
  await screen.key('\x1b[<65;10;8M');await screen.key('\x1b[<64;10;8M');
  assert.deepEqual(screen.calls.map(call=>call.route),['setup/options'],'wheel events during review never approve setup');
  await screen.key('\x1b');await screen.key('\x1b[<64;10;8M');
  assert.match(await screen.key('\r'),/REVIEW \/ Catalog 1/);
  assert.equal(screen.completed.length,0);
 }finally{await screen.close();}
});

test('a direct catalog review shows the exact chosen model and download size in both viewports',()=>{
 for(const size of [{w:80,h:16},{w:160,h:52}]){
  const output=clean(renderFrame(snapshot(),size,{initialCatalogId:'supported-9',startInReview:true}));
  fits(output,size);assert.match(output,/REVIEW \/ Catalog 9/);assert.match(output,/Model download: 900 MB/);
  assert.match(output,/Enter start setup/);assert.match(output,/Esc models/);assert.doesNotMatch(output,/Number \+ Enter review/);
 }
});

test('direct review survives the fresh catalog read and one Enter sets up that exact model',async()=>{
 const fresh=snapshot();fresh.catalog.reverse();
 const target=fresh.catalog.find(entry=>entry.id==='supported-12');target.name='Fresh selected model 12';target.downloadBytes=6_400_000_000;
 const screen=await mount({initialCatalogId:'supported-12',startInReview:true,freshOptions:fresh});
 try{
  assert.deepEqual(screen.calls.map(call=>call.route),['setup/options'],'opening a direct review only refreshes options');
  assert.match(screen.output,/REVIEW \/ Fresh selected model 12/);assert.match(screen.output,/6\.4 GB/);
  assert.equal(screen.calls.filter(call=>call.route==='setup').length,0);
  await screen.key('\r');
  assert.deepEqual(screen.calls.find(call=>call.route==='setup').body,{catalogId:'supported-12',installRuntime:true});
  assert.equal(screen.calls.filter(call=>call.route==='setup').length,1);
  assert.equal(screen.completed[0].config.mainAgentModelId,'catalog:supported-12');
 }finally{await screen.close();}
});

test('a missing direct-review target cannot fall back after refreshing options',async()=>{
 const fresh=snapshot();fresh.catalog=fresh.catalog.filter(entry=>entry.id!=='supported-4');
 const screen=await mount({initialCatalogId:'supported-4',startInReview:true,freshOptions:fresh});
 try{
  assert.match(screen.output,/Selected model disappeared from the catalog/);
  await screen.key('\r');assert.equal(screen.calls.filter(call=>call.route==='setup').length,0);
  assert.equal(screen.calls.filter(call=>call.route==='rescan').length,0);
  assert.equal(screen.completed.length,0);
  const list=await screen.key('\x1b');assert.match(list,/Number \+ Enter review/);assert.equal(screen.back,0);
  await screen.key('\x1b');assert.equal(screen.back,1);
 }finally{await screen.close();}
});

test('direct-review Escape returns to the catalog before invoking the parent back action',async()=>{
 const screen=await mount({initialCatalogId:'supported-7',startInReview:true});
 try{
  assert.match(screen.output,/REVIEW \/ Catalog 7/);
  const list=await screen.key('\x1b');assert.match(list,/Number \+ Enter review/);assert.equal(screen.back,0);
  assert.equal(screen.calls.filter(call=>call.route==='setup').length,0);
  await screen.key('\r');assert.match(screen.output,/REVIEW \/ Catalog 7/);
  await screen.key('\x1b');await screen.key('\x1b');assert.equal(screen.back,1);
 }finally{await screen.close();}
});

test('Chat and Code direct reviews explain and confirm the requested mode without replacing the Agent',async()=>{
 for(const mode of ['chat','code']){
  const initial=snapshot();initial.config.mainAgentModelId='keep-agent';initial.orchestrator={modelId:'keep-agent',status:'running',loaded:true};
  const screen=await mount({initial,mode,initialCatalogId:'supported-4',startInReview:true});
  try{
   assert.match(screen.output,new RegExp('Confirm to switch to '+(mode==='code'?'Code':'Chat')+' mode'));
   assert.doesNotMatch(screen.output,/select this as the main agent/);assert.equal(screen.calls.filter(call=>call.route==='setup').length,0);
   await screen.key('\r');assert.deepEqual(screen.calls.find(call=>call.route==='setup').body,{catalogId:'supported-4',installRuntime:true,mode});
   assert.equal(screen.completed.length,1);assert.equal(screen.completed[0].config.mainAgentModelId,'keep-agent');
   assert.equal(screen.completed[0].loadedModelId,'catalog:supported-4');assert.deepEqual(screen.completed[0].orchestrator,initial.orchestrator);
  }finally{await screen.close();}
 }
});

test('mode-specific review text fits both supported viewports and Agent wording stays unchanged',()=>{
 for(const size of [{w:80,h:16},{w:160,h:52}]){
  for(const mode of ['agent','chat','code']){
   const output=clean(renderFrame(snapshot(),size,{initialCatalogId:'supported-4',startInReview:true,mode}));
   fits(output,size);
   if(mode==='agent')assert.match(output,/select this as the main agent/);
   else assert.match(output,new RegExp('switch to '+(mode==='code'?'Code':'Chat')+' mode'));
  }
 }
});
