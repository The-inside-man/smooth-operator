import {modelTimingKey} from '../server/timing.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {startServer} from '../server/index.mjs';
import {generateCloud} from '../server/cloud-provider.mjs';
import {Client} from '../cli/core.mjs';
import {activity,selection} from '../cli/activity.mjs';
import {modelIntent} from '../cli/planner.mjs';
import {ToolRunner,makeReview} from '../cli/tool-runner.mjs';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function settled(studio,id){for(let i=0;i<150;i++){const job=studio.jobs.find(j=>j.id===id);if(!['running','queued'].includes(job.status)&&studio.active?.job.id!==id)return job;await wait(10);}throw new Error('fixture did not settle');}
test('clock is independent of backend activity and never fabricates ETA',()=>{
 const job={startedAt:1000,lastActivityAt:2000};const a=activity(job,62000),b=activity(job,63000);assert.equal(a.age,60);assert.ok(a.stale);assert.equal(b.age,61);assert.match(b.text,/ETA unavailable/);assert.match(b.heartbeat,/unconfirmed/);assert.equal(activity({startedAt:1000,finishedAt:3000,lastActivityAt:2000},99999).elapsed,2);
 assert.deepEqual(selection({},{}),{provider:'local',modelId:''});assert.throws(()=>selection({provider:'xai'},{}),/model/);assert.equal(selection({provider:'openai',model:'current-model'},{}).modelId,'current-model');
});
test('queue and planner use both explicit cloud adapters; sessions never export local history; duplicate IDs are idempotent',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'tim-cloud-test-'));let backend;const calls=[];let malicious=false;
 try{
  const library=path.join(root,'library');await fs.mkdir(path.join(library,'Coding-Models'),{recursive:true});backend=await startServer({port:0,dataDir:path.join(root,'data'),libraryRoot:library,autoSetup:false,telemetry:false});const {studio}=backend;
  studio.generateCloud=options=>generateCloud({...options,env:{OPENAI_API_KEY:'dummy',XAI_API_KEY:'dummy'},fetchImpl:async(url,request)=>{const body=JSON.parse(request.body);calls.push({url,body});const intent=body.text?.format.name==='tim_install'?{action:'install',package:'example',manager:'npm',reason:'fixture'}:body.text?.format.name==='tim_listen'?{action:'listen',mode:'bind',protocol:'tcp',port:9999,host:'127.0.0.1',reason:'fixture'}:{action:'read',view:'hex',filter:'',reason:'fixture'};return new Response('data: '+JSON.stringify({type:'response.output_text.delta',delta:JSON.stringify(malicious?{...intent,command:'untrusted arbitrary shell'}:intent)})+'\n\ndata: {"type":"response.completed"}\n\n',{headers:{'content-type':'text/event-stream'}});}});
  for(const provider of ['openai','xai']){
   const client=new Client(backend.url,{provider,modelId:'selected-fixture'});
   for(const kind of ['install','listen','read'])assert.equal((await modelIntent(client,kind,'typed fixture request')).action,kind);
   malicious=true;await assert.rejects(modelIntent(client,'read','typed fixture request'),/unsupported fields/);malicious=false;
   const body={kind:'chat',provider,modelId:'selected-fixture',prompt:'hello',attachments:[],requestId:crypto.randomUUID()};const before=calls.length;const [a,b]=await Promise.all([client.request('jobs',body),client.request('jobs',body)]);assert.equal(a.id,b.id);await settled(studio,a.id);assert.equal(calls.length,before+1);assert.ok(studio.jobs.find(j=>j.id===a.id).lastActivityAt);assert.equal((await client.request('jobs',body)).id,a.id);
   await assert.rejects(client.request('jobs',{...body,prompt:'different'}),/different input|conflict/);
   await assert.rejects(client.request('jobs',{...body,requestId:crypto.randomUUID(),attachments:['secret.txt']}),/cannot include/);
   await assert.rejects(client.request('jobs',{...body,requestId:crypto.randomUUID(),kind:'agent'}),/not supported/);client.close();
  }
  studio.registry.models=[{id:'local-fixture',name:'local fixture',kind:'chat',available:true}];
  const phases=[];studio.loadChat=async(_model,_signal,update)=>{update('Loading local fixture');phases.push(studio.active.job.phase);await wait(5);};
  studio.llama.generate=async(_messages,_config,_signal,token)=>{await wait(5);token('LOCAL_FIXTURE_OUTPUT');phases.push(studio.active.job.phase);};
  const localJob=await studio.enqueue({kind:'chat',modelId:'local-fixture',prompt:'local request'});assert.equal((await settled(studio,localJob.id)).status,'completed');assert.deepEqual(phases,['Loading local fixture','Generating response']);assert.ok(localJob.lastActivityAt);
  const historyKey=modelTimingKey({provider:'openai',modelId:'selected-fixture',intentKind:'read',settings:{prompt:'fixture'}},studio.config,false);for(let i=0;i<5;i++)studio.timings.record(historyKey,10000);
  studio.generateCloud=async({onText})=>{await wait(120);onText('fixture');};
  const estimated=await studio.enqueue({provider:'openai',modelId:'selected-fixture',kind:'chat',intentKind:'read',prompt:'fixture'});
  assert.equal(studio.snapshot().jobs.find(j=>j.id===estimated.id).timing.eta.samples,5);
  await assert.rejects(studio.resetTimings(),/Finish or cancel/);await settled(studio,estimated.id);
  const aggregate=JSON.parse(await fs.readFile(path.join(root,'data','timings.json'),'utf8'));assert.ok(aggregate.buckets.length);assert.ok(!JSON.stringify(aggregate).includes('fixture'));
  await studio.resetTimings();assert.equal(studio.timings.export().buckets.length,0);
  const local=await studio.newSession();local.messages.push({role:'user',content:'private local history'});
  await assert.rejects(studio.enqueue({provider:'openai',modelId:'test',kind:'chat',sessionId:local.id,prompt:'new'}),/boundary/);
  assert.ok(!JSON.stringify(calls).includes('private local history'));assert.ok(calls.every(c=>c.body.input.every(m=>typeof m.content==='string')));
 }finally{await backend?.close();await fs.rm(root,{recursive:true,force:true});}
});
test('backend comments update transport only, stale stream fails, reconnect does not POST',async()=>{
 let posts=0,streams=[];const server=http.createServer((req,res)=>{if(req.method==='POST')posts++;res.writeHead(200,{'content-type':'text/event-stream'});res.write('data: {"jobs":[]}\n\n');streams.push(res);});await new Promise(r=>server.listen(0,'127.0.0.1',r));const client=new Client('http://127.0.0.1:'+server.address().port);let states=0,transport=0;
 try{const pending=client.watch(()=>states++,{idleMs:30,onTransport:()=>transport++});const pulse=setInterval(()=>streams[0]?.write(': heartbeat\n\n'),8);await wait(55);clearInterval(pulse);await assert.rejects(pending,/stale/);assert.equal(states,1);assert.ok(transport>1);
  await assert.rejects(client.watch(()=>states++,{idleMs:20}),/stale/);assert.equal(states,2);assert.equal(posts,0);
 }finally{client.close();streams.forEach(s=>s.end());server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('silent local tool output age advances independently; cancellation and repeat reset timestamps',async()=>{
 const runner=new ToolRunner(),tool={id:'fixture',name:'fixture',status:'installed',executable:process.execPath};try{
  const pending=runner.run(makeReview(tool,['-e','setInterval(()=>{},1000)']),{confirmed:true});const last=runner.state.lastActivityAt;await wait(30);assert.equal(runner.state.lastActivityAt,last);await runner.cancel();assert.equal((await pending).status,'cancelled');const result=await runner.run(makeReview(tool,['-e','console.log("fixture")']),{confirmed:true});assert.equal(result.status,'completed');assert.ok(result.lastActivityAt>=last);assert.ok(result.finishedAt>=result.startedAt);
 }finally{await runner.close();}
});
