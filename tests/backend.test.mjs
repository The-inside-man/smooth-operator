import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import http from 'node:http';import {spawn} from 'node:child_process';import {randomUUID} from 'node:crypto';
import {ownBackend} from '../cli/backend.mjs';import {Client} from '../cli/core.mjs';import {alive,buildIdentity,pause} from '../cli/backend-shared.mjs';
async function fixture(){const root=await fs.mkdtemp(path.join(os.tmpdir(),'tim-shared-test-')),dataDir=path.join(root,'data'),libraryRoot=path.join(root,'library');await fs.mkdir(dataDir);await fs.mkdir(path.join(libraryRoot,'Coding-Models'),{recursive:true});await fs.writeFile(path.join(dataDir,'settings.json'),JSON.stringify({backend:'cpu',libraryRoot}));return {root,dataDir,libraryRoot};}
async function gone(pid){for(let i=0;i<150&&alive(pid)!==false;i++)await pause(50);assert.equal(alive(pid),false,'owned fixture process exited');}
test('concurrent CLI clients share one authenticated writer with independent persistent sessions',async()=>{
 const f=await fixture(),clients=[];let later;
 const other=http.createServer((_q,r)=>r.end('unrelated'));await new Promise(r=>other.listen(0,'127.0.0.1',r));
 try{
 clients.push(...await Promise.all(Array.from({length:4},()=>ownBackend(f))));assert.equal(new Set(clients.map(c=>c.pid)).size,1);assert.equal(new Set(clients.map(c=>c.url)).size,1);assert.equal(new Set(clients.map(c=>c.session.id)).size,4);
 assert.equal((await fetch(clients[0].url+'/api/state')).status,401);
 const c=new Client(clients[1].url,undefined,clients[1].token);const state=await c.request('state');assert.equal(state.models.length,0);assert.equal(state.gpu,null);assert.equal(state.jobs.length,0);
 await clients[0].close();await clients[0].close();assert.ok((await c.request('state')).sessions.some(s=>s.id===clients[0].session.id));
 let event;await c.watch(s=>{event=s;c.close();}).catch(()=>{});assert.ok(event.sessions.length>=4,'authenticated streaming works');
 await Promise.all(clients.slice(1).map(c=>c.close()));await gone(clients[0].pid);await assert.rejects(fs.access(path.join(f.dataDir,'cli.lock')));
 later=await ownBackend(f);const next=new Client(later.url,undefined,later.token);assert.ok((await next.request('state')).sessions.some(s=>s.id===clients[0].session.id));next.close();assert.ok(other.listening);
 }finally{await Promise.all(clients.map(c=>c.close()));await later?.close();await new Promise(r=>other.close(r));await fs.rm(f.root,{recursive:true,force:true});}
});
test('proven stopped owner is recovered; active/legacy and PID-reuse ambiguity preserve locks',async()=>{
 const f=await fixture();let backend;const lock=path.join(f.dataDir,'cli.lock');
 const dead=spawn(process.execPath,['-e',''],{windowsHide:true,stdio:'ignore'});await new Promise(r=>dead.once('exit',r));
 try{await fs.writeFile(lock,JSON.stringify({id:randomUUID(),pid:dead.pid}),{mode:0o600});backend=await ownBackend(f);await backend.close();backend=null;
 const legacy=JSON.stringify({pid:process.pid});await fs.writeFile(lock,legacy,{mode:0o600});await assert.rejects(ownBackend(f),/older TIM process/);assert.equal(await fs.readFile(lock,'utf8'),legacy);await fs.unlink(lock);
 const server=http.createServer((_q,r)=>{r.setHeader('content-type','application/json');r.end(JSON.stringify({id:'wrong-process'}));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const reused={id:randomUUID(),pid:process.pid,protocol:1,build:await buildIdentity(),dataDir:await fs.realpath(f.dataDir),libraryRoot:f.libraryRoot,token:'a'.repeat(64),url:'http://127.0.0.1:'+server.address().port};
 try{await fs.writeFile(lock,JSON.stringify(reused),{mode:0o600});await assert.rejects(ownBackend(f),/identity handshake/);assert.equal(JSON.parse(await fs.readFile(lock)).id,reused.id);assert.ok(server.listening);}finally{await new Promise(r=>server.close(r));}
 }finally{await backend?.close();await fs.rm(f.root,{recursive:true,force:true});}
});
test('failed startup removes only owned locks and a crashed helper can be recovered',async()=>{
 const f=await fixture();let backend,next;
 try{await fs.writeFile(path.join(f.dataDir,'settings.json'),'{broken');await assert.rejects(ownBackend(f),/Cannot read|startup failed/);await assert.rejects(fs.access(path.join(f.dataDir,'cli.lock')));await assert.rejects(fs.access(path.join(f.dataDir,'cli-start.lock')));
 await fs.writeFile(path.join(f.dataDir,'settings.json'),JSON.stringify({backend:'cpu',libraryRoot:f.libraryRoot}));backend=await ownBackend(f);process.kill(backend.pid,'SIGKILL');await gone(backend.pid);next=await ownBackend(f);assert.notEqual(next.pid,backend.pid);await backend.close();assert.equal((await fetch(next.url+'/api/state',{headers:{authorization:'Bearer '+next.token}})).status,200);
 }finally{await backend?.close();await next?.close();await fs.rm(f.root,{recursive:true,force:true});}
});

test('incompatible builds and non-loopback endpoints are rejected without modifying discovery',async()=>{
 const f=await fixture(),file=path.join(f.dataDir,'cli.lock');try{
 const base={id:randomUUID(),pid:process.pid,protocol:1,build:await buildIdentity(),dataDir:await fs.realpath(f.dataDir),libraryRoot:f.libraryRoot,token:'b'.repeat(64),url:'http://127.0.0.1:1'};
 for(const change of [{build:'old'},{url:'http://example.com:80'},{libraryRoot:path.join(f.root,'other')}]){const content=JSON.stringify({...base,...change});await fs.writeFile(file,content,{mode:0o600});await assert.rejects(ownBackend(f),/incompatible|endpoint|different model library/);assert.equal(await fs.readFile(file,'utf8'),content);}
 }finally{await fs.rm(f.root,{recursive:true,force:true});}
});
test('a crashed CLI lease expires and its helper exits without signalling another process',async()=>{
 const f=await fixture();let pid,child;
 try{const code="import {ownBackend} from './cli/backend.mjs';const b=await ownBackend(JSON.parse(process.argv[1]));process.send({pid:b.pid,url:b.url});setInterval(()=>{},1000);";
 child=spawn(process.execPath,['--input-type=module','-e',code,JSON.stringify(f)],{cwd:process.cwd(),windowsHide:true,stdio:['ignore','ignore','pipe','ipc']});
 const ready=await new Promise((resolve,reject)=>{child.once('message',resolve);child.once('error',reject);child.once('exit',()=>reject(Error('fixture client exited before ready')));});pid=ready.pid;
 child.kill('SIGKILL');await new Promise(r=>child.once('exit',r));
 for(let i=0;i<110&&alive(pid)!==false;i++)await pause(500);
 assert.equal(alive(pid),false);await assert.rejects(fs.access(path.join(f.dataDir,'cli.lock')));
 }finally{if(child&&child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');if(pid&&alive(pid)===true){process.kill(pid,'SIGTERM');await gone(pid);}await fs.rm(f.root,{recursive:true,force:true});}
});
