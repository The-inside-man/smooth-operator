import './terminal-env.mjs';
import {terminalAct} from './terminal-act.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {PassThrough,Writable} from 'node:stream';
import {setTimeout as delay} from 'node:timers/promises';
import {spawn,spawnSync} from 'node:child_process';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {render,renderToString} from 'ink';
import {App} from '../cli/app.mjs';
import {clean,demoState} from '../cli/core.mjs';
import {parseArgs} from '../cli/arguments.mjs';
import {parseResponseTokens,parseContextTokens,tokenSettingsFromOptions,tokenCommandPatch} from '../cli/token-settings.mjs';

const initial=()=>({...structuredClone(demoState),config:{mainAgentModelId:'fixture-model',maxTokens:1024,context:4096},models:[{id:'fixture-model',name:'Fixture model',kind:'chat',available:true}],loadedModelId:'fixture-model'});

test('token parsing accepts Auto and the full settings ranges without a context/response cross-limit',()=>{
 assert.equal(parseResponseTokens('auto'),0);assert.equal(parseResponseTokens('AUTO'),0);assert.equal(parseResponseTokens('1'),1);assert.equal(parseResponseTokens('1048576'),1048576);
 assert.equal(parseContextTokens('512'),512);assert.equal(parseContextTokens('1048576'),1048576);
 assert.deepEqual(tokenSettingsFromOptions(parseArgs(['--max-tokens','1048576','--context','512']).options),{maxTokens:1048576,context:512});
 assert.deepEqual(tokenCommandPatch('/tokens',['auto']),{maxTokens:0});assert.equal(tokenCommandPatch('/context',[]),null);
 for(const value of ['0','-1','1.5','1e3','Infinity','1048577','auto extra'])assert.throws(()=>parseResponseTokens(value));
 for(const value of ['511','1.5','1e3','auto','1048577'])assert.throws(()=>parseContextTokens(value));
 assert.throws(()=>tokenCommandPatch('/tokens',['auto','extra']),/Use \/tokens/);
});

async function mount({state=initial(),settingsFailure=false,stateFailure=false,onSettings}={}){
 let current=structuredClone(state),output='',failed=false;const calls=[];
 const stdin=new PassThrough();stdin.isTTY=true;stdin.ref=()=>stdin;stdin.unref=()=>stdin;stdin.setRawMode=()=>stdin;
 const stdout=new Writable({write(chunk,_encoding,done){output+=chunk;done();}});stdout.isTTY=true;stdout.columns=110;stdout.rows=38;
 const client={selection:{provider:'local',modelId:'fixture-model'},controller:new AbortController(),async watch(){return new Promise(()=>{});},async request(route,body){
  calls.push({route,body:structuredClone(body)});
  if(route==='settings'){
   if(settingsFailure&&!failed){failed=true;throw new Error('FIXTURE_SETTINGS_REJECTED');}
   await onSettings?.(body);current.config={...current.config,...body};return structuredClone(current.config);
  }
  if(route==='state'){if(stateFailure)throw new Error('FIXTURE_STATE_REFRESH_FAILED');return structuredClone(current);}
  if(route==='jobs')throw new Error('Settings commands must not start inference');
  throw new Error('Unexpected fixture route: '+route);
 }};
 let ui;await terminalAct(()=>{ui=render(React.createElement(App,{client,initial:current,animation:false,onQuit:()=>{}}),{stdin,stdout,stderr:stdout,exitOnCtrlC:false,patchConsole:false});});
 const exited=ui.waitUntilExit();await delay(75);
 const frame=()=>{const value=clean(output);return value.slice(Math.max(0,value.lastIndexOf('TIM / STUDIO')));};
 const key=async value=>{await terminalAct(()=>stdin.write(value));await delay(65);return frame();};
 return {calls,get state(){return current;},get frame(){return frame();},key,async command(value){await key('\x15');await key(value);return key('\r');},async settle(){await terminalAct(()=>delay(80));return frame();},async close(){try{await terminalAct(()=>ui.unmount());await exited;}finally{ui.cleanup();client.controller.abort();stdin.destroy();stdout.destroy();}}};
}

test('no-argument commands show current response/context settings and help without API calls',async()=>{
 const app=await mount();
 try{
  await app.command('/tokens');assert.match(app.frame,/Response budget: 1024 tokens/);assert.match(app.frame,/\/tokens auto/);assert.match(app.frame,/provider limits still apply/);
  await app.command('/context');assert.match(app.frame,/Local context: 4096 tokens/);assert.match(app.frame,/512–1048576/);assert.match(app.frame,/Larger contexts need more memory/);
  assert.equal(app.calls.length,0);
 }finally{await app.close();}
});

test('Auto and manual token commands save exact patches, refresh state, and do not infer',async()=>{
 const app=await mount();
 try{
  await app.command('/tokens auto');assert.match(app.frame,/Saved response settings/);assert.match(app.frame,/Response budget: Auto \(model\/context limit\)/);
  assert.deepEqual(app.calls.slice(0,2),[{route:'settings',body:{maxTokens:0}},{route:'state',body:undefined}]);
  await app.command('/context 32768');await app.command('/tokens 16384');
  assert.deepEqual(app.calls.filter(call=>call.route==='settings').map(call=>call.body),[{maxTokens:0},{context:32768},{maxTokens:16384}]);
  assert.equal(app.state.config.context,32768);assert.equal(app.state.config.maxTokens,16384);assert.match(app.frame,/16384 tokens/);
  assert.equal(app.calls.filter(call=>call.route==='jobs').length,0);
 }finally{await app.close();}
});

test('invalid token/context commands retain their text and make no backend calls',async()=>{
 const app=await mount();
 try{
  for(const command of ['/tokens 0','/tokens -1','/tokens 1.5','/tokens 1e3','/tokens 1048577','/tokens auto extra','/context 511','/context 1048577','/context 4096 extra']){
   await app.command(command);assert.ok(app.frame.includes(command),'Rejected command draft must be retained: '+command);assert.match(app.frame,/Use /);
  }
  assert.equal(app.calls.length,0);
 }finally{await app.close();}
});

test('token changes protect work in every session and model/setup loading',async()=>{
 for(const busy of [{jobs:[{id:'other-job',sessionId:'other-session',status:'running'}]},{jobs:[{id:'queued',sessionId:'other-session',status:'queued'}]},{loadingModel:true},{orchestrator:{status:'loading'}},{localSetup:{status:'installing'}}]){
  const app=await mount({state:{...initial(),...busy}});
  try{await app.command('/tokens auto');assert.match(app.frame,/Finish or cancel current work/);assert.match(app.frame,/\/tokens auto/);assert.equal(app.calls.length,0);}
  finally{await app.close();}
 }
});

test('backend settings errors retain the command for explicit retry and refresh errors stay visible',async()=>{
 const app=await mount({settingsFailure:true});
 try{
  await app.command('/tokens auto');assert.match(app.frame,/FIXTURE_SETTINGS_REJECTED/);assert.match(app.frame,/\/tokens auto/);assert.equal(app.calls.length,1);
  await app.key('\r');assert.equal(app.state.config.maxTokens,0);assert.match(app.frame,/Saved response settings/);
  assert.equal(app.calls.filter(call=>call.route==='settings').length,2);
 }finally{await app.close();}
 const failedRefresh=await mount({stateFailure:true});
 try{await failedRefresh.command('/context 8192');assert.match(failedRefresh.frame,/FIXTURE_STATE_REFRESH_FAILED/);assert.match(failedRefresh.frame,/\/context 8192/);}
 finally{await failedRefresh.close();}
});

test('a newly typed draft survives a settings save already in flight',async()=>{
 let finish;const pending=new Promise(resolve=>{finish=resolve;}),app=await mount({onSettings:()=>pending});
 try{
  await app.command('/tokens auto');await app.key('\x15');await app.key('Preserve my next request 界');finish();await app.settle();
  assert.match(app.frame,/Saved response settings/);assert.match(app.frame,/Preserve my next request 界/);assert.equal(app.state.config.maxTokens,0);
  assert.equal(app.calls.filter(call=>call.route==='jobs').length,0);
 }finally{finish();await app.close();}
});

test('workspace and help expose response budgets without changing the viewport',async()=>{
 for(const [w,h] of [[80,16],[110,38],[160,52]]){
  const output=clean(renderToString(React.createElement(App,{demo:true,initial:{...initial(),config:{...initial().config,maxTokens:0}},staticPreview:true,dimensions:{w,h},animation:false}),{columns:w}));
  assert.ok(output.split('\n').length<=h);assert.ok(output.split('\n').every(line=>line.length<=w));
  if(w===160){assert.match(output,/response\s+Auto/);assert.match(output,/context\s+4096 tokens/);}
 }
 const app=await mount();
 try{await app.command('/help');assert.match(app.frame,/RESPONSE SETTINGS/);assert.match(app.frame,/\/tokens auto/);}
 finally{await app.close();}
});

test('launch argument validation rejects invalid values without starting a backend',()=>{
 const run=args=>spawnSync(process.execPath,['cli/index.mjs',...args],{encoding:'utf8',timeout:10000,env:{...process.env,TIM_PROVIDER:'local',TIM_MODEL:''}});
 for(const args of [['--max-tokens','0'],['--max-tokens','1e3'],['--context','511'],['--max-tokens']]){
  const result=run(args);assert.equal(result.status,1);assert.match(result.stderr,/response-token|context-token|requires a value/);assert.doesNotMatch(result.stdout,/Connecting/);
 }
 const help=run(['--help']);assert.equal(help.status,0);assert.match(help.stdout,/--max-tokens auto\|NUMBER/);assert.match(help.stdout,/--context NUMBER/);assert.match(help.stdout,/\/tokens auto\|NUMBER/);
});

test('real CLI launch saves response flags together before the terminal UI opens',async()=>{
 let state=initial(),child,output='',errors='',quitSent=false;const calls=[],streams=[];
 const server=http.createServer(async(req,res)=>{
  if(req.url==='/api/events'){streams.push(res);res.writeHead(200,{'content-type':'text/event-stream'});res.write('data: '+JSON.stringify(state)+'\n\n');return;}
  let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw||'{}');calls.push({route:req.url,body});res.setHeader('content-type','application/json');
  if(req.url==='/api/state'){res.end(JSON.stringify(state));return;}
  if(req.url==='/api/settings'){state={...state,config:{...state.config,...body}};res.end(JSON.stringify(state.config));return;}
  if(req.url==='/api/sessions'){res.end(JSON.stringify(state.sessions[0]));return;}
  res.writeHead(404);res.end('{"error":"Unexpected fixture route"}');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let timer;
 try{
  child=spawn(process.execPath,[fileURLToPath(new URL('./tty-fixture.mjs',import.meta.url))],{stdio:['pipe','pipe','pipe'],env:{...process.env,TIM_PROVIDER:'local',TIM_MODEL:'',TIM_TEST_URL:'http://127.0.0.1:'+server.address().port,TIM_TEST_ARGS:JSON.stringify(['--max-tokens','auto','--context','16384','--no-animation','--no-mouse'])}});
  timer=setTimeout(()=>child.kill(),10000);child.stderr.on('data',chunk=>{errors+=chunk;});
  child.stdout.on('data',chunk=>{output+=chunk;if(!quitSent&&output.includes('COMMAND')){quitSent=true;setTimeout(()=>child.stdin.write('\x11'),50);}});
  const code=await new Promise(resolve=>child.on('close',resolve));assert.equal(code,0,errors+'\n'+output.slice(-2000));assert.equal(quitSent,true);
  assert.deepEqual(calls.slice(0,3),[{route:'/api/state',body:{}},{route:'/api/settings',body:{maxTokens:0,context:16384}},{route:'/api/state',body:{}}]);
  assert.equal(calls.filter(call=>call.route==='/api/settings').length,1);assert.equal(calls.filter(call=>call.route==='/api/jobs').length,0);
  assert.equal(state.config.maxTokens,0);assert.equal(state.config.context,16384);assert.match(errors,/RAW:false/);
 }finally{clearTimeout(timer);child?.kill();for(const stream of streams)stream.end();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
