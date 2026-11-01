import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fork} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {alive,readRecord,removeOwn,buildIdentity,validateRecord,control,pause} from './backend-shared.mjs';
export async function ownBackend({dataDir=process.env.TIM_DATA_DIR||path.join(os.homedir(),'.tim-studio'),libraryRoot}={}){
 await fs.mkdir(path.resolve(dataDir),{recursive:true});dataDir=await fs.realpath(path.resolve(dataDir));
 const lockPath=path.join(dataDir,'cli.lock'),gatePath=path.join(dataDir,'cli-start.lock'),build=await buildIdentity(),lease=randomUUID();let started=false;
 const deadline=Date.now()+30000;
 while(Date.now()<deadline){
  let record;
  try{record=await readRecord(lockPath);}catch(e){if(e.code!=='ENOENT'){let gate;try{gate=await readRecord(gatePath);}catch{}if(e instanceof SyntaxError&&gate&&alive(gate.pid)===true){await pause(100);continue;}throw Error('Unreadable/ambiguous TIM lock; preserved: '+e.message);}}
  if(record&&alive(record.pid)!==false){
   if(!record.url){if(record.protocol===1){await pause(100);continue;}throw Error('An older TIM process owns this directory. Close it normally once before using shared startup; its lock was preserved.');}
   validateRecord(record,dataDir,build,libraryRoot);
   let joined;try{joined=await control(record,'join',lease);}catch(e){if(e.status===409||alive(record.pid)===false){await pause(100);continue;}throw Error('Existing TIM backend could not be authenticated/reached; lock preserved: '+e.message);}
   let closed=false;const timer=setInterval(()=>{control(record,'heartbeat',lease).catch(()=>{});},5000);timer.unref();
   return {url:record.url,token:record.token,session:joined.session,dataDir,owned:started,shared:true,pid:record.pid,close:async()=>{
    if(closed)return;closed=true;clearInterval(timer);
    try{const result=await control(record,'leave',lease);if(result.remaining===0){for(let i=0;i<100;i++){try{const current=await readRecord(lockPath);if(current.id!==record.id)break;}catch(e){if(e.code==='ENOENT')break;}await pause(50);}}}catch{/* Crash cleanup is lease-based; never signal a PID from a file. */}
   }};
  }
  let gate;const id=randomUUID();
  try{gate=await fs.open(gatePath,'wx',0o600);await gate.writeFile(JSON.stringify({id,pid:process.pid}));await gate.close();}
  catch(e){await gate?.close().catch(()=>{});if(e.code!=='EEXIST')throw e;await pause(100);continue;}
  try{
   let current;try{current=await readRecord(lockPath);}catch(e){if(e.code!=='ENOENT')throw e;}
   if(current){if(alive(current.pid)!==false)continue;const again=await readRecord(lockPath);if(again.id!==current.id||again.pid!==current.pid||alive(again.pid)!==false)throw Error('Lock ownership changed; recovery refused.');await fs.unlink(lockPath);}
   const child=fork(new URL('./backend-host.mjs',import.meta.url),[],{detached:true,windowsHide:true,stdio:['ignore','ignore','ignore','ipc'],execArgv:[],env:{...process.env,TIM_BACKEND_CONFIG:JSON.stringify({dataDir,libraryRoot:libraryRoot&&path.resolve(libraryRoot),build,gateId:id})}});
   await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{if(child.connected)child.disconnect();child.unref();reject(Error('Backend startup timed out; no process was killed.'));},25000);child.once('error',e=>{clearTimeout(timeout);reject(e);});child.once('exit',code=>{clearTimeout(timeout);reject(Error('Backend startup failed ('+code+').'));});child.once('message',m=>{clearTimeout(timeout);if(child.connected)child.disconnect();child.unref();m.ready?resolve():reject(Error(m.error||'Backend startup failed'));});});started=true;
  }finally{await removeOwn(gatePath,id);}
 }
 throw Error('TIM startup is busy or its startup guard is ambiguous. No lock was removed; inspect cli-start.lock after confirming its owner stopped.');
}
