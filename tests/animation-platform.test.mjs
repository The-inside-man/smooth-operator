import {smallHood,microHood} from '../cli/layout.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import {shimmerFrame,shimmerRuns,startShimmer,SHIMMER_FRAMES,SHIMMER_INTERVAL} from '../cli/animation.mjs';import {hood,compactHood,portraitForLayout} from '../cli/art.mjs';import {layout} from '../cli/layout.mjs';import {silentPlan,rollbackPlan} from '../cli/silent-plan.mjs';
// Exercise the color portrait rather than the test runner's monochrome fallback.
process.env.FORCE_COLOR='3';delete process.env.NO_COLOR;
test('shimmer has invariant cells, face spaces and low-rate deterministic cleaned timer',()=>{
 for(const art of [hood,compactHood,smallHood,microHood])for(let n=0;n<4;n++){
 const frame=shimmerFrame(art,n);assert.equal(frame.length,art.length);assert.deepEqual(frame.split('\n').map(l=>l.length),art.split('\n').map(l=>l.length));
 for(let i=0;i<art.length;i++)if(!['#','='].includes(art[i]))assert.equal(frame[i],art[i]);
 }
 let callback,cleared=false,frames=[];const stop=startShimmer(n=>frames.push(n),{setInterval:(fn,ms)=>{assert.equal(ms,SHIMMER_INTERVAL);callback=fn;return 1;},clearInterval:id=>{assert.equal(id,1);cleared=true;}});
 for(let i=0;i<5;i++)callback();assert.deepEqual(frames,[1,2,3,4,5]);stop();assert.equal(cleared,true);
});
test('all OS Silent Mode plans remain inactive with guarded baseline rollback',()=>{
 for(const platform of ['win32','linux','darwin']){
 const snapshot={version:1,platform,state:{ownedPolicy:'fixture'}},p=silentPlan(platform,{snapshot});
 assert.equal(p.executionSupported,false);assert.equal(p.hostChanged,false);assert.match(p.warning,/does not guarantee anonymity/);
 assert.throws(()=>rollbackPlan(p,'changed'),/Baseline/);assert.deepEqual(rollbackPlan(p,p.baselineFingerprint).restore,snapshot.state);
 assert.equal(silentPlan(platform).baselineFingerprint,null);
 }
});
import {spawnSync} from 'node:child_process';
test('optional native/audio wrappers fail explicitly when interpreter is missing; no host capability is claimed',()=>{
 for(const [script,key] of [['cli/control/native.mjs','TIM_NATIVE_PYTHON'],['cli/voice/portable.mjs','TIM_SPEECH_PYTHON']]){
 const r=spawnSync(process.execPath,[script,'--capabilities'],{encoding:'utf8',timeout:10000,env:{...process.env,[key]:'Z:/TIM-nonexistent-fixture/python'}});
 assert.notEqual(r.status,0);assert.match(r.stdout+r.stderr,/unavailable/i);
 }
});

import React from 'react';import {render} from 'ink';import {PassThrough,Writable} from 'node:stream';import {App} from '../cli/app.mjs';
test('normal mounted TTY welcome emits animated cloth while preserving typed draft',async()=>{
 const stdin=new PassThrough();stdin.isTTY=true;stdin.ref=()=>stdin;stdin.unref=()=>stdin;stdin.setRawMode=()=>stdin;
 let bytes='';const stdout=new Writable({write(c,_e,done){bytes+=c;done();}});stdout.isTTY=true;stdout.columns=160;stdout.rows=52;
 const ui=render(React.createElement(App,{demo:true,onQuit:()=>{}}),{stdin,stdout,stderr:stdout,exitOnCtrlC:false,patchConsole:false});
 try{await new Promise(r=>setTimeout(r,70));stdin.write('draft stays');
  const {clean}=await import('../cli/core.mjs');
  for(let n=1;n<=5;n++){
   await new Promise(r=>setTimeout(r,2100));
   const art=portraitForLayout(layout(stdout.columns,stdout.rows,true,false));
   const changed=shimmerFrame(art,n%4).split('\n').find((line,i)=>line!==art.split('\n')[i])||art.split('\n')[1];
   assert.ok(clean(bytes).includes(changed.trimEnd()),'rendered cycle '+n);assert.match(clean(bytes),n===1?/draft stays/:/draft staXys/);
   if(n===1){stdin.write('\x1b[D\x1b[DX');await new Promise(r=>setTimeout(r,50));}
   stdout.columns=[80,99,140,160,160][n-1];stdout.rows=stdout.columns===160?52:37;stdout.emit('resize');
  }
 }finally{ui.unmount();stdin.end();stdout.end();}
});

test('fabric highlight travels smoothly while preserving every glyph across multiple loops',()=>{
 for(const art of [hood,compactHood,smallHood,microHood]){const original=shimmerRuns(art,-1);let previous=original,changed=false;
 for(let frame=0;frame<SHIMMER_FRAMES*3;frame++){const runs=shimmerRuns(art,frame);assert.equal(runs.map(r=>r.text).join(''),art);changed ||= JSON.stringify(previous)!==JSON.stringify(runs);previous=runs;}
 assert.equal(changed,true);assert.deepEqual(shimmerRuns(art,16),shimmerRuns(art,16+SHIMMER_FRAMES));assert.notDeepEqual(shimmerRuns(art,16),original);
 }
 let callback;const frames=[];startShimmer(n=>frames.push(n),{setInterval:fn=>{callback=fn;return 1;},clearInterval:()=>{}});for(let i=0;i<SHIMMER_FRAMES*3;i++)callback();assert.equal(frames.at(-1),0);
});

test('actual Ink ANSI frames change color only and disabled animation is stable',()=>{
 const code="import React from 'react';import {renderToString} from 'ink';import {App} from './cli/app.mjs';const render=(previewFrame,animation=true)=>renderToString(React.createElement(App,{demo:true,staticPreview:true,dimensions:{w:110,h:50},previewFrame,animation}),{columns:110});console.log(JSON.stringify([render(8),render(20),render(8,false),render(20,false)]));";
 const result=spawnSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8',env:{...process.env,FORCE_COLOR:'3',NO_COLOR:undefined},timeout:15000});assert.equal(result.status,0,result.stderr);
 const frames=JSON.parse(result.stdout);assert.notEqual(frames[0],frames[1]);assert.equal(frames[2],frames[3]);const strip=s=>s.replace(/\x1b\[[0-9;]*m/g,'');assert.equal(strip(frames[0]),strip(frames[1]));
});
