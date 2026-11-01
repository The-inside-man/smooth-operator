import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,randomBytes} from 'node:crypto';
import {startServer} from '../server/index.mjs';
import {PROTOCOL,removeOwn} from './backend-shared.mjs';
const config=JSON.parse(process.env.TIM_BACKEND_CONFIG||'null');delete process.env.TIM_BACKEND_CONFIG;
if(!config?.dataDir||!config.build)throw Error('Managed backend requires startup configuration.');
const {dataDir,libraryRoot,build,gateId}=config,lockPath=path.join(dataDir,'cli.lock'),id=randomUUID(),token=randomBytes(32).toString('hex');
const record={id,pid:process.pid,protocol:PROTOCOL,build,dataDir,libraryRoot:libraryRoot||null,token,startedAt:new Date().toISOString()};
let service,closing=false,timer,lastEmpty=Date.now(),everJoined=false,lockOwned=false;const leases=new Map();let queue=Promise.resolve();
const reply=(res,value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({...value,id,pid:process.pid,protocol:PROTOCOL,build}));};
async function close(){if(closing)return;closing=true;clearInterval(timer);try{await service?.close();}finally{if(lockOwned)await removeOwn(lockPath,id);await removeOwn(path.join(dataDir,'cli-start.lock'),gateId);process.exitCode=0;}}
async function management(req,res,studio){
 if(!req.url.startsWith('/api/cli/'))return false;
 if(closing){reply(res,{error:'Backend is shutting down; retry startup.'},409);return true;}
 let bytes='';for await(const c of req){bytes+=c;if(bytes.length>1024){reply(res,{error:'Lease request too large'},400);return true;}}
 const {lease}=JSON.parse(bytes||'{}');if(req.method!=='POST'||!/^[-a-f0-9]{36}$/.test(lease||'')){reply(res,{error:'Invalid client lease'},400);return true;}
 const action=req.url.slice('/api/cli/'.length);
 if(action==='join'){
  // Reserve before awaiting persistence so last-client cleanup cannot race the join.
  let entry=leases.get(lease);if(!entry){entry={at:Date.now()};leases.set(lease,entry);entry.session=await studio.newSession();}entry.at=Date.now();everJoined=true;reply(res,{session:entry.session,remaining:leases.size});
 }else if(action==='heartbeat'){const entry=leases.get(lease);if(!entry){reply(res,{error:'Client lease expired; restart this CLI.'},410);return true;}entry.at=Date.now();reply(res,{remaining:leases.size});}
 else if(action==='leave'){leases.delete(lease);if(!leases.size)lastEmpty=Date.now();reply(res,{remaining:leases.size});}
 else reply(res,{error:'Unknown lease operation'},404);
 return true;
}
try{
 const lock=await fs.open(lockPath,'wx',0o600);lockOwned=true;await lock.writeFile(JSON.stringify(record));await lock.close();
 service=await startServer({port:0,dataDir,libraryRoot,telemetry:false,autoSetup:false,authToken:token,management:(req,res,studio)=>{const next=queue.then(()=>management(req,res,studio));queue=next.catch(()=>{});return next;}});
 record.url=service.url;const temp=lockPath+'.'+id;await fs.writeFile(temp,JSON.stringify(record),{mode:0o600,flag:'wx'});await fs.rename(temp,lockPath);
 await removeOwn(path.join(dataDir,'cli-start.lock'),gateId);
 timer=setInterval(()=>{const now=Date.now();for(const [lease,entry] of leases)if(now-entry.at>45000)leases.delete(lease);if(leases.size)lastEmpty=now;else if(now-lastEmpty>(everJoined?1000:30000))void close().catch(()=>{process.exitCode=1;});},500);
 process.on('SIGTERM',()=>void close());process.on('SIGINT',()=>void close());if(process.connected)process.send({ready:true});
}catch(error){await close();if(process.connected)process.send({error:error.message});process.exitCode=1;}
