import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {demoState} from '../cli/core.mjs';

test('synthetic terminal through HTTP adapter: rejected send, retry, streamed rendering and cancellation',async()=>{
 const state=structuredClone(demoState);state.sessions[0].messages=[];state.models=[{id:'fixture-agent',name:'Fixture agent',kind:'chat',available:true}];state.config.mainAgentModelId='fixture-agent';
 let stream,child,output='',errors='',stage=0,posts=0,cancelled=false;
 const calls=[];
 const publish=()=>stream?.write(`data: ${JSON.stringify(state)}\n\n`);
 const server=http.createServer(async(req,res)=>{
  if(req.url==='/api/events'){res.writeHead(200,{'content-type':'text/event-stream'});stream=res;publish();return;}
  if(req.url==='/api/sessions'){res.setHeader('content-type','application/json');res.end(JSON.stringify(state.sessions[0]));return;}
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
  assert.equal(calls[0].body.prompt,'hello adapter');assert.equal(calls[1].body.prompt,'hello adapter');assert.equal(calls[1].body.kind,'chat');assert.equal(calls[2].body.id,'test-job');assert.ok(calls.every(c=>c.header==='1'));assert.ok(output.includes('\x1b[?1049l'));
 }finally{clearTimeout(timeout);child?.kill();stream?.end();server.closeAllConnections();await new Promise(r=>server.close(r));}
});

test('slow startup and real Ink key sequences preserve editing, paste, Enter and resize behavior',async()=>{
 const state=structuredClone(demoState);state.models=[{id:'fixture-agent',name:'Fixture agent',kind:'chat',available:true}];state.config.mainAgentModelId='fixture-agent';let stream,child,output='',received;
 const server=http.createServer(async(req,res)=>{if(req.url==='/api/events'){stream=res;res.writeHead(200,{'content-type':'text/event-stream'});res.write('data: '+JSON.stringify(state)+'\n\n');return;}res.setHeader('content-type','application/json');if(req.url==='/api/sessions'){res.end(JSON.stringify(state.sessions[0]));return;}if(req.url==='/api/state'){await delay(2200);res.end(JSON.stringify(state));return;}let raw='';for await(const c of req)raw+=c;if(req.url==='/api/jobs'){received=JSON.parse(raw);res.end(JSON.stringify({id:'edit-job',sessionId:'demo'}));return;}res.end('{}');});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 // The state fixture deliberately takes longer than the old two-second startup limit.
 let errors='',spawnError,closed=false,exitCode,exitSignal;
 const waitFor=async(predicate,label)=>{
  // Cold imports on shared runners can exceed two seconds. Wait for the actual
  // observable state, fail promptly on child exit, and keep every wait bounded.
  const deadline=Date.now()+15000;
  while(!predicate()){
   if(spawnError||closed||Date.now()>=deadline)assert.fail(label+'\n'+(spawnError?.stack||errors)+'\nexit: '+exitCode+' / '+exitSignal+'\n'+output.slice(-4000));
   await delay(20);
  }
 };
 try{child=spawn(process.execPath,[fileURLToPath(new URL('./tty-fixture.mjs',import.meta.url))],{stdio:['pipe','pipe','pipe','ipc'],env:{...process.env,TIM_TEST_URL:`http://127.0.0.1:${server.address().port}`}});child.stdout.on('data',c=>output+=c);child.stderr.on('data',c=>errors+=c);
 child.on('error',error=>{spawnError=error;});child.on('close',(code,signal)=>{closed=true;exitCode=code;exitSignal=signal;});
 await waitFor(()=>output.includes('COMMAND'),'CLI must render its composer before receiving keys');assert.match(output,/COMMAND/);
 const beforeResize=output.length;child.send({type:'resize-terminal'});
 await waitFor(()=>output.slice(beforeResize).includes('COMMAND'),'CLI must redraw its composer after terminal resize');
 // A busy terminal can coalesce separate physical key writes into one read.
 // Exercise that path deliberately instead of depending on 35 ms scheduling.
 const editOffset=output.length;
 child.stdin.write(['abc','\x7f','\b','界👩‍💻','\x1b[D','\x1b[3~','\x1b[H','Z','\x1b[F','\x1b[200~','\nline\r\nlast','\x1b[201~'].join(''));
 await waitFor(()=>{const frame=output.slice(editOffset);return frame.includes('Za界')&&frame.includes('line')&&frame.includes('last');},'the coalesced keys must render the edited multiline draft');
 assert.equal(received,undefined,'paste must not submit');child.stdin.write('\r');await waitFor(()=>received!==undefined,'Enter must submit the edited request');assert.equal(received?.prompt,'Za界\nline\nlast',errors);child.stdin.write('\x11');await waitFor(()=>closed,'CLI must exit after Ctrl+Q');assert.equal(exitCode,0,errors);assert.match(output,/\x1b\[\?2004l/);assert.doesNotMatch(output.slice(output.lastIndexOf('\x1b[?1049l')),/\x1b\[(?:[0-9]*[JK]|H)/,'renderer cleanup must finish before restoring the original screen');
 }finally{child?.kill();stream?.end();server.closeAllConnections();await new Promise(r=>server.close(r));}
});
