import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {spawn} from 'node:child_process';import http from 'node:http';
import {desktopTask} from '../cli/desktop-task.mjs';import {connectDesktopAdapter} from '../cli/control/adapter.mjs';import {runSemanticTask,validateProposal} from '../cli/control/semantic.mjs';import {Client} from '../cli/core.mjs';import {naturalRequest} from '../cli/natural.mjs';
const p=(action='act')=>({action,operation:action==='act'?'set_value':'none',elementId:'draft',value:action==='act'?'Hello fixture':'',expectedElementId:'draft',expectedProperty:'value',expectedValue:'Hello fixture',reason:'Set the requested local draft and verify its value'});
test('HTTP model -> desktop task -> subprocess semantic app -> reviewed recovery -> verified outcome',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'tim-semantic-')),file=path.join(root,'fixture.mjs');
 await fs.writeFile(file,[
 "import readline from 'node:readline';let value='',attempt=0;readline.createInterface({input:process.stdin}).on('line',line=>{const {id,method,params}=JSON.parse(line);let result=true;",
 "if(method==='capabilities')result={semanticVersion:1,foregroundInput:true,emergencyStop:true,manualInputInterruption:true};",
 "if(method==='observeSemantic')result={targetPid:params.targetPid,targetWindow:'fixture-window',permissions:true,elements:[{id:'draft',role:'textbox',name:'Fixture draft',value,enabled:true,risk:'local-edit',actions:['set_value']},{id:'secret',role:'textbox',name:'Password',value:'DO_NOT_TRANSMIT',enabled:true,risk:'credentials',sensitive:true,actions:[]}]};",
 "if(method==='actSemantic'){if(params.targetWindow!=='fixture-window')throw Error('bad binding');attempt++;if(attempt>1)value=params.value;result={ok:attempt>1,recoverable:true};}",
 "console.log(JSON.stringify({id,result}));});"].join('\n'));
 let calls=0,stream,state={models:[{id:'fixture',kind:'chat',available:true}],loadedModelId:'fixture',sessions:[],jobs:[]};const prompts=[];
 const server=http.createServer(async(req,res)=>{if(req.url==='/api/events'){stream=res;res.writeHead(200,{'content-type':'text/event-stream'});res.write('data: '+JSON.stringify(state)+'\n\n');return;}let raw='';for await(const c of req)raw+=c;const body=JSON.parse(raw||'{}');res.setHeader('content-type','application/json');
 if(req.url==='/api/state'){res.end(JSON.stringify(state));return;}if(req.url==='/api/sessions'){const session={id:'s'+calls,messages:[]};state.sessions.push(session);res.end(JSON.stringify(session));return;}
 if(req.url==='/api/jobs'){assert.equal(body.intentKind,'desktop');prompts.push(body.prompt);calls++;const job={id:'j'+calls,sessionId:body.sessionId,status:'completed'};state.jobs.push(job);state.sessions.find(s=>s.id===body.sessionId).messages.push({jobId:job.id,content:JSON.stringify(p(calls<3?'act':'complete'))});res.end(JSON.stringify(job));return;}res.end('{}');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const client=new Client('http://127.0.0.1:'+server.address().port,{provider:'local',modelId:'fixture'}),reviews=[];
 try{
 const result=await desktopTask({task:'Put Hello fixture in the draft','target-pid':42,adapter:process.execPath,'data-dir':root},{client,review:async r=>{reviews.push(r);return r.token;},connect:exe=>connectDesktopAdapter(exe,{spawnAdapter:()=>spawn(process.execPath,[file],{stdio:['pipe','pipe','pipe'],windowsHide:true})})});
 assert.equal(result.status,'verified');assert.equal(result.history[0].status,'verification-failed');assert.equal(result.history[1].status,'verified');assert.equal(calls,3);assert.deepEqual(reviews.map(r=>r.kind),['task','step','step','outcome']);assert.ok(prompts.every(x=>!x.includes('DO_NOT_TRANSMIT')));assert.match(prompts[1],/verification-failed/);
 }finally{client.close();stream?.end();server.closeAllConnections();await new Promise(r=>server.close(r));await fs.rm(root,{recursive:true,force:true});}
});
const fixture=()=>({capabilities:{semanticVersion:1,foregroundInput:true,emergencyStop:true,manualInputInterruption:true},observeSemantic:async pid=>({targetPid:pid,targetWindow:'w',permissions:true,elements:[{id:'draft',name:'Draft',role:'textbox',value:'',enabled:true,risk:'local-edit',actions:['set_value']}]}),actSemantic:async()=>({ok:true}),releaseAll:async()=>{},onInterrupt(){}});
test('semantic safety denies before observations, blocks sensitive/invalid actions and cancels stalled review',async()=>{
 let observed=0,a=fixture();a.observeSemantic=async()=>{observed++;throw Error('must not observe');};
 await assert.rejects(runSemanticTask({task:'test',targetPid:1,adapter:a,plan:async()=>p(),review:async()=>''}),/declined/);assert.equal(observed,0);
 a=fixture();const original=a.observeSemantic;a.observeSemantic=async pid=>{const obs=await original(pid);obs.elements[0].risk='external';return obs;};
 await assert.rejects(runSemanticTask({task:'test',targetPid:1,adapter:a,plan:async()=>p(),review:async r=>r.token}),/sensitive/);
 assert.throws(()=>validateProposal({...p(),shell:'bad'}),/Invalid/);
 await assert.rejects(runSemanticTask({task:'test',targetPid:1,adapter:fixture(),plan:async()=>p(),review:async()=>new Promise(()=>{}),timeoutMs:15}),/time limit/);
});
test('natural desktop requests reach the dedicated review route',async()=>{
 const intent={action:'desktop',port:null,protocol:'all',question:'',request:'Edit my local draft',reason:'',url:'',destination:''};
 assert.deepEqual(await naturalRequest({},'edit my draft',{intentProvider:async()=>intent}),{route:'desktop',request:'Edit my local draft'});
});
test('cloud accessibility data needs its own exact approval before model transmission',async()=>{
 let planned=0;const reviews=[];
 await assert.rejects(runSemanticTask({task:'test',targetPid:1,adapter:fixture(),provider:'openai',modelId:'mock-only',plan:async()=>{planned++;return p();},review:async r=>{reviews.push(r);return r.kind==='task'?r.token:'';}}),/declined/);
 assert.equal(planned,0);assert.deepEqual(reviews.map(r=>r.kind),['task','cloud-observation']);assert.equal(reviews[0].modelId,'mock-only');
});
