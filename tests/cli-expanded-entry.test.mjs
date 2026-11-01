import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {Writable,PassThrough} from 'node:stream';
import {controlCommand} from '../cli/control-command.mjs';

test('real CLI routes prerequisite version, disabled control and Tor guards without a backend',()=>{
 const run=args=>spawnSync(process.execPath,['cli/index.mjs',...args],{encoding:'utf8',timeout:10000,env:{...process.env,TIM_PROVIDER:'local',TIM_MODEL:''}});
 let r=run(['dependencies','node','--version','invalid']);assert.equal(r.status,1);assert.match(r.stderr,/explicit supported Node version/);assert.doesNotMatch(r.stdout,/TIM Studio 0.1.0/);
 r=run(['dependencies','list']);assert.equal(r.status,0);assert.match(r.stdout,/Tor client/);
 r=run(['control','--plan','unread.json']);assert.equal(r.status,1);assert.match(r.stderr,/interactive approval/);
 r=run(['voice','--adapter','relative.exe']);assert.equal(r.status,1);assert.match(r.stderr,/absolute executable/);
 r=run(['--route','tor','--provider','openai','--model','dummy','get images']);assert.equal(r.status,1);assert.match(r.stderr,/not tunneled/);
 r=run(['silent']);assert.equal(r.status,0);assert.match(r.stdout,/does not guarantee anonymity/);
 r=run(['check','port','999']);assert.equal(r.status,0);assert.match(r.stdout,/Request retained: check port 999/);
});

test('desktop command executes observed approved steps through a subprocess RPC adapter; decline sends no input',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'tim-control-command-'));
 try{
 const fixture=path.join(root,'adapter.mjs'),audit=path.join(root,'audit.txt'),planFile=path.join(root,'plan.json');
 await fs.writeFile(fixture,[
 "import readline from 'node:readline';import fs from 'node:fs';",
 "readline.createInterface({input:process.stdin}).on('line',line=>{const {id,method,params}=JSON.parse(line);fs.appendFileSync(process.env.TIM_TEST_AUDIT,method+String.fromCharCode(10));let result=true;",
 "if(method==='capabilities')result={foregroundInput:true,emergencyStop:true,manualInputInterruption:true};",
 "if(method==='observe')result={targetPid:params.targetPid,targetWindow:'window-1',permissions:true,title:'Fixture'};",
 "if(method==='act'&&params.targetWindow!=='window-1')throw Error('Missing window binding');",
 "console.log(JSON.stringify({id,result}));});"
 ].join(String.fromCharCode(10)));
 await fs.writeFile(planFile,JSON.stringify({task:'Dummy fixture only',targetPid:42,steps:[{action:'type',text:'safe fixture'}]}));
 for(const decline of [false,true]){
  await fs.writeFile(audit,'');let captured='',token;
  const output=new Writable({write(chunk,_encoding,done){const text=String(chunk);captured+=text;try{const v=JSON.parse(text);if(v.token)token=v.token;}catch{}done();}});
  const run=()=>controlCommand(['--adapter',process.execPath,'--plan',planFile],{input:{isTTY:true},output,spawnAdapter:()=>spawn(process.execPath,[fixture],{stdio:['pipe','pipe','pipe'],windowsHide:true,env:{...process.env,TIM_TEST_AUDIT:audit}}),createTerminal:()=>({question:async prompt=>prompt.includes('token')?token:decline?'no':'yes',close(){}})});
  if(decline)await assert.rejects(run(),/declined/);else await run();
  const calls=await fs.readFile(audit,'utf8');assert.match(calls,/observe/);assert.match(calls,/releaseAll/);
  if(decline)assert.doesNotMatch(calls,/act/);else{assert.match(calls,/act/);assert.match(calls,/verify/);}
 }
 }finally{await fs.rm(root,{recursive:true,force:true});}
});


test('voice CLI lifecycle uses capture readiness, mute and stop without a backend or focus action',async()=>{
 const {voiceCommand}=await import('../cli/voice-command.mjs');
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'tim-voice-command-')),fixture=path.join(root,'capture.mjs'),input=new PassThrough();let child,captured='',started=false,muted=false;
 await fs.writeFile(fixture,"console.log(JSON.stringify({type:'ready'}));setInterval(()=>{},1000);");
 const stdout=new Writable({write(chunk,_enc,done){const text=String(chunk);captured+=text;
 if(text.includes('VOICE starts MUTED')&&!started){started=true;setImmediate(()=>input.write('unmute'+String.fromCharCode(10)));}
 if(text.includes('VOICE / LISTENING')&&!muted){muted=true;setImmediate(()=>input.write('mute'+String.fromCharCode(10)));}
 if(muted&&text.includes('VOICE / MUTED'))setImmediate(()=>input.write('stop'+String.fromCharCode(10)));
 done();}});
 const timer=setTimeout(()=>input.write('stop'+String.fromCharCode(10)),5000);
 try{await voiceCommand(['--adapter',process.execPath,'--data-dir',root],{input,stdout,spawnCapture:()=>child=spawn(process.execPath,[fixture],{stdio:['ignore','pipe','pipe'],windowsHide:true})});
 assert.equal(started,true);assert.equal(muted,true);assert.match(captured,/VOICE \/ LISTENING \/ mic active/);assert.match(captured,/VOICE \/ STOPPED \/ mic inactive/);assert.equal(child.killed,true);
 }finally{clearTimeout(timer);child?.kill();input.destroy();await fs.rm(root,{recursive:true,force:true});}
});
