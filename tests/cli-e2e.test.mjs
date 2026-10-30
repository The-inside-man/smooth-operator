import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {demoState} from '../cli/core.mjs';

test('synthetic terminal through HTTP adapter: rejected send, retry, streamed rendering and cancellation',async()=>{
 const state=structuredClone(demoState);state.sessions[0].messages=[];
 let stream,child,output='',errors='',stage=0,posts=0,cancelled=false;
 const calls=[];
 const publish=()=>stream?.write(`data: ${JSON.stringify(state)}\n\n`);
 const server=http.createServer(async(req,res)=>{
  if(req.url==='/api/events'){res.writeHead(200,{'content-type':'text/event-stream'});stream=res;publish();return;}
  if(req.url==='/api/state'){res.setHeader('content-type','application/json');res.end(JSON.stringify(state));return;}
  let raw='';for await(const chunk of req)raw+=chunk;
  const body=JSON.parse(raw||'{}');calls.push({url:req.url,body,header:req.headers['x-tim-request']});res.setHeader('content-type','application/json');
  if(req.url==='/api/jobs'){
   posts++;
   if(posts===1){res.writeHead(400);res.end(JSON.stringify({error:'MOCK_REJECTED_KEEP_DRAFT'}));return;}
   state.jobs=[{id:'test-job',sessionId:'demo',status:'running',phase:'Mock streaming'}];
   state.sessions[0].messages=[{role:'user',content:body.prompt},{role:'assistant',content:'STREAM_ALPHA',status:'running'}];
   res.end(JSON.stringify({id:'test-job',sessionId:'demo'}));publish();return;
  }
  if(req.url==='/api/cancel'){cancelled=true;state.jobs[0].status='cancelled';state.sessions[0].messages[1].status='cancelled';state.sessions[0].messages[1].content='CANCELLED_CONFIRMED';res.end('{"ok":true}');publish();return;}
  res.writeHead(404);res.end('{"error":"unexpected route"}');
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const timeout=setTimeout(()=>child?.kill(),20000);
 try{
  child=spawn(process.execPath,[fileURLToPath(new URL('./tty-fixture.mjs',import.meta.url))],{stdio:['pipe','pipe','pipe'],env:{...process.env,TIM_TEST_URL:`http://127.0.0.1:${server.address().port}`}});
  child.stderr.on('data',chunk=>errors+=chunk);
  child.stdout.on('data',chunk=>{
   output+=chunk;
   if(stage===0&&output.includes('COMMAND')){stage=1;child.stdin.write('hello adapter');}
   else if(stage===1&&output.includes('hello adapter')){stage=2;child.stdin.write('\x13');}
   else if(stage===2&&output.includes('MOCK_REJECTED_KEEP_DRAFT')){stage=3;child.stdin.write('\x13');}
   else if(stage===3&&output.includes('STREAM_ALPHA')){stage=4;state.sessions[0].messages[1].content='STREAM_BETA';publish();}
   else if(stage===4&&output.includes('STREAM_BETA')){stage=5;child.stdin.write('\x1b');}
   else if(stage===5&&output.includes('CANCELLED_CONFIRMED')){stage=6;child.stdin.write('\x11');}
  });
  const code=await new Promise(r=>child.on('close',r));assert.equal(code,0,errors);assert.equal(stage,6,output.slice(-3000));assert.equal(posts,2);assert.ok(cancelled);
  assert.equal(calls[0].body.prompt,'hello adapter');assert.equal(calls[1].body.prompt,'hello adapter');assert.equal(calls[1].body.kind,'agent');assert.equal(calls[2].body.id,'test-job');assert.ok(calls.every(c=>c.header==='1'));assert.ok(output.includes('\x1b[?1049l'));
 }finally{clearTimeout(timeout);child?.kill();stream?.end();server.closeAllConnections();await new Promise(r=>server.close(r));}
});
