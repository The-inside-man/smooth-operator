import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {demoState} from '../cli/core.mjs';
import {catalogModels} from '../server/catalog.mjs';

test('provider guides print from the launcher without keys, model selection or a backend',()=>{
 const env={...process.env,TIM_PROVIDER:'anthropic',TIM_MODEL:''};
 delete env.OPENAI_API_KEY;delete env.XAI_API_KEY;delete env.ANTHROPIC_API_KEY;
 for(const [name,id,key] of [['chatgpt','openai','OPENAI_API_KEY'],['grok','xai','XAI_API_KEY'],['claude','anthropic','ANTHROPIC_API_KEY']]){
  const result=spawnSync(process.execPath,['cli/index.mjs','providers',name,'--shell','zsh'],{encoding:'utf8',timeout:10000,env});
  assert.equal(result.status,0,result.stderr);assert.match(result.stdout,new RegExp(key));
  assert.ok(result.stdout.includes('tim models --provider '+id));
  assert.ok(result.stdout.includes('tim --provider '+id+' --model MODEL_ID'));
  assert.doesNotMatch(result.stderr,/Missing .*API_KEY|Choose --model/);
 }
 const invalid=spawnSync(process.execPath,['cli/index.mjs','providers','unknown'],{encoding:'utf8',timeout:10000,env});
 assert.equal(invalid.status,1);assert.match(invalid.stderr,/Choose openai.*xai.*anthropic/);
});

test('noninteractive setup gives directions without creating data or downloading models',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'tim-unstarted-setup-')),dataDir=path.join(root,'data');
 try{
  const result=spawnSync(process.execPath,['cli/index.mjs','setup','--data-dir',dataDir],{encoding:'utf8',timeout:10000,env:{...process.env,TIM_PROVIDER:'anthropic',TIM_MODEL:''}});
  assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/Open an interactive terminal/);assert.match(result.stdout,/No backend was started/);
  await assert.rejects(fs.access(dataDir),{code:'ENOENT'});
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('real setup command lists local catalog choices even with a cloud preference and never downloads before confirmation',async()=>{
 const state={...structuredClone(demoState),dataDir:'/fixture/setup-data',catalog:catalogModels.filter(entry=>entry.kind==='chat'),memory:{totalBytes:32*2**30,availableBytes:24*2**30,reserveBytes:4*2**30,modelBudgetBytes:20*2**30,sampledAt:Date.now(),stale:false,status:'ok',availableSource:'os'},hardware:{platform:'darwin',arch:'arm64',cpuName:'Fixture CPU',logicalCores:8}};
 const calls=[];let stream,child,output='',errors='',quit=false;
 const server=http.createServer(async(req,res)=>{
  calls.push(req.url);
  if(req.url==='/api/events'){stream=res;res.writeHead(200,{'content-type':'text/event-stream'});res.write('data: '+JSON.stringify(state)+'\n\n');return;}
  res.setHeader('content-type','application/json');
  if(req.url==='/api/state'||req.url==='/api/setup/options'){res.end(JSON.stringify(state));return;}
  if(req.url==='/api/sessions'){res.end(JSON.stringify(state.sessions[0]));return;}
  res.writeHead(400);res.end('{"error":"Unexpected mutation"}');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const timer=setTimeout(()=>child?.kill(),10000);
 try{
  child=spawn(process.execPath,[fileURLToPath(new URL('./tty-fixture.mjs',import.meta.url))],{stdio:['pipe','pipe','pipe'],env:{...process.env,TIM_TEST_ARGS:JSON.stringify(['setup']),TIM_TEST_URL:`http://127.0.0.1:${server.address().port}`,TIM_PROVIDER:'anthropic',TIM_MODEL:'cloud-model'}});
  child.stderr.on('data',chunk=>errors+=chunk);
  child.stdout.on('data',chunk=>{output+=chunk;if(!quit&&output.includes('TIM / LOCAL SETUP')&&output.includes('Qwen3 4B')&&output.includes('Number + Enter review')){quit=true;child.stdin.write('\x11');}});
  const code=await new Promise(resolve=>child.on('close',resolve));
  assert.equal(code,0,errors);assert.equal(quit,true,output);assert.match(output,/Number \+ Enter review/);assert.match(output,/SUGGESTED/);
  assert.ok(calls.includes('/api/setup/options'),'the setup catalog requests a fresh memory snapshot');
  assert.doesNotMatch(output,/Missing .*API_KEY/);assert.ok(!calls.includes('/api/setup'));assert.ok(!calls.includes('/api/jobs'));
  assert.ok(output.includes('\x1b[?1049l'));
 }finally{clearTimeout(timer);child?.kill();stream?.end();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
