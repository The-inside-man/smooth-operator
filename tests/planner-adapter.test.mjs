import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {Client} from '../cli/core.mjs';
import {modelIntent} from '../cli/planner.mjs';
test('configured-model intent uses chat HTTP/SSE only, validates structured response and cancels own pending job',async()=>{
 let response={action:'read',view:'hex',filter:'tcp.port == 9999',reason:'port filter'},cancelled=false,body;const streams=[];
 const server=http.createServer(async(req,res)=>{
  res.setHeader('content-type','application/json');
  if(req.url==='/api/state'){res.end(JSON.stringify({config:{mainAgentModelId:'fixture'},models:[{id:'fixture',kind:'chat',available:true}]}));return;}
  if(req.url==='/api/events'){res.setHeader('content-type','text/event-stream');streams.push(res);res.write('data: '+JSON.stringify({jobs:[{id:'job',status:response?'completed':'running'}],sessions:[{id:'session',messages:[{jobId:'job',content:JSON.stringify(response)}]}]})+'\n\n');return;}
  let raw='';for await(const c of req)raw+=c;const data=JSON.parse(raw||'{}');
  if(req.url==='/api/sessions')res.end('{"id":"session"}');else if(req.url==='/api/jobs'){body=data;res.end('{"id":"job","sessionId":"session"}');}else if(req.url==='/api/cancel'){cancelled=true;res.end('{}');}else{res.statusCode=404;res.end('{}');}
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));const client=new Client(`http://127.0.0.1:${server.address().port}`);
 try{
  assert.equal((await modelIntent(client,'read','show hex port 9999')).view,'hex');assert.equal(body.kind,'chat');assert.equal(body.modelId,'fixture');assert.deepEqual(body.attachments,[]);
  response={action:'read',view:'hex',filter:'',command:'evil'};await assert.rejects(modelIntent(client,'read','read'),/unsupported/);
  response=null;const abort=new AbortController();const pending=modelIntent(client,'read','read',{signal:abort.signal,onStatus:()=>setTimeout(()=>abort.abort(),20)});await assert.rejects(pending,/cancelled/);await new Promise(r=>setTimeout(r,30));assert.ok(cancelled);
 }finally{client.close();streams.forEach(s=>s.end());server.closeAllConnections();await new Promise(r=>server.close(r));}
});
