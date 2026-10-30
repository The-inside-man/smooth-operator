import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {startServer} from '../server/index.mjs';

export async function ownBackend({dataDir=process.env.TIM_DATA_DIR||path.join(os.homedir(),'.tim-studio'),libraryRoot}={}) {
 dataDir=path.resolve(dataDir);await fs.mkdir(dataDir,{recursive:true});
 const lockPath=path.join(dataDir,'cli.lock');let lock;
 try{lock=await fs.open(lockPath,'wx');}catch(error){
  if(error.code==='EEXIST')throw new Error(`TIM's data directory is already locked: ${dataDir}. Close its other CLI first, use --url to attach to an existing server, or choose --data-dir. If a prior process crashed, inspect cli.lock and remove it only after that process has stopped.`);
  throw error;
 }
 let service,closed=false;
 const close=async()=>{if(closed)return;closed=true;try{await service?.close();}finally{await lock.close();await fs.unlink(lockPath).catch(()=>{});}};
 try{
  await lock.writeFile(JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}));
  service=await startServer({port:0,dataDir,libraryRoot,telemetry:false,autoSetup:false});
  return {url:service.url,close,dataDir,owned:true};
 }catch(error){await close();throw error;}
}
