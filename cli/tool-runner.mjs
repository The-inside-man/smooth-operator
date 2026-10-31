import {TimingHistory,TimedRun,timingKey} from '../server/timing.mjs';
const toolTimings=new TimingHistory(); // Session-only history: no tool paths/arguments persisted.
import fs from 'node:fs/promises';
import path from 'node:path';
import {constants} from 'node:fs';
import {spawn} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {StringDecoder} from 'node:string_decoder';
import {clean} from './core.mjs';

export async function readRegistry() {
 return JSON.parse(await fs.readFile(new URL('./tools.json',import.meta.url),'utf8'));
}

// Discovery never executes a candidate, loads a model, or installs anything.
export async function discoverTools(registry,{platform=process.platform,env=process.env}={}) {
 const paths=String(env.PATH||env.Path||'').split(platform==='win32'?';':':').filter(p=>p&&path.isAbsolute(p));
 return Promise.all(registry.map(async tool=>{
  if(!tool.platforms.includes(platform))return {...tool,status:'platform unavailable',executable:null};
  if(tool.interactive)return {...tool,status:'interactive unsupported',executable:null};
  if(!/^[a-zA-Z0-9_-]+$/.test(tool.command))return {...tool,status:'invalid registry command',executable:null};
  const names=platform==='win32'?[tool.command+'.exe',tool.command+'.com']:[tool.command];
  for(const folder of paths)for(const name of names){
   const executable=path.join(folder,name);
   try{if(!(await fs.stat(executable)).isFile())continue;await fs.access(executable,platform==='win32'?constants.F_OK:constants.X_OK);return {...tool,status:'installed',executable};}catch{}
  }
  if(platform==='win32')for(const folder of paths){
   for(const extension of ['.cmd','.ps1','.bat'])try{
    if(!(await fs.stat(path.join(folder,tool.command+extension))).isFile())continue;
    if(tool.command==='npm'){
     const script=path.join(folder,'node_modules','npm','bin','npm-cli.js');
     if((await fs.stat(script)).isFile())return {...tool,status:'installed',executable:process.execPath,prefixArgs:[script]};
    }
    return {...tool,status:'installed / script shim unsupported',executable:null};
   }catch{}
  }
  return {...tool,status:'not installed',executable:null};
 }));
}

// Quotes group arguments; no expansion, command substitution, pipes or redirects.
// Backslashes are literal except immediately before a matching quote inside quotes.
export function parseArguments(source) {
 if(source.length>8192)throw new Error('Arguments are limited to 8192 characters.');
 const args=[];let token='',quote=null,started=false;
 for(let i=0;i<source.length;i++){
  const c=source[i];if(c==='\0')throw new Error('NUL is not allowed in arguments.');
  if(quote){if(c===quote)quote=null;else if(c==='\\'&&source[i+1]===quote){token+=quote;i++;}else token+=c;started=true;}
  else if(c==='"'||c==="'"){quote=c;started=true;}
  else if(/\s/.test(c)){if(started){args.push(token);token='';started=false;}}
  else{token+=c;started=true;}
 }
 if(quote)throw new Error('Close the quoted argument before reviewing.');
 if(started)args.push(token);if(args.length>128)throw new Error('At most 128 arguments are supported.');return args;
}

export function makeReview(tool,args,{cwd=process.cwd(),timeoutMs=60000}={}) {
 if(tool.status!=='installed'||!tool.executable||tool.interactive)throw new Error('Select an installed, noninteractive tool.');
 if(!Array.isArray(args)||args.some(a=>typeof a!=='string'||a.includes('\0'))||args.length>128||args.join('').length>8192)throw new Error('Invalid argument list.');
 if(!path.isAbsolute(tool.executable)||!path.isAbsolute(cwd))throw new Error('Executable and working directory must be absolute.');
 if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>300000)throw new Error('Timeout must be between 1 and 300000 ms.');
 return Object.freeze({id:tool.id,name:tool.name,executable:tool.executable,args:Object.freeze([...args]),cwd,timeoutMs,network:!!tool.network,activeScan:!!tool.activeScan,privileged:!!tool.privileged,risk:tool.risk||'Review arguments and targets before launching.'});
}

const activeRunners=new Set();
export async function closeOwnedTools(){await Promise.all([...activeRunners].map(r=>r.close()));}
export class ToolRunner extends EventEmitter {
 constructor(){super();this.child=null;this.pending=null;this.state={status:'idle',output:'',exitCode:null};}
 update(values){this.state={...this.state,...values,...(this.timed?{timing:this.timed.snapshot()}: {})};this.emit('state',this.state);}
 async run(review,{confirmed=false}={}) {
  if(!confirmed)throw new Error('Explicit launch confirmation is required.');
  if(this.pending)throw new Error('A tool is already running. Cancel it or wait.');
  // Revalidate immutable review parameters at the execution boundary.
  makeReview({id:review.id,name:review.name,status:'installed',executable:review.executable},review.args,review);
  this.timed=new TimedRun(toolTimings,timingKey({provider:'system',model:review.executable,operation:review.operation||review.id,args:review.args,cwd:review.cwd}));
  activeRunners.add(this);
  this.update({status:'running',output:'',stdout:'',stderr:'',exitCode:null,signal:null,error:null,truncated:false,startedAt:Date.now(),finishedAt:null,lastActivityAt:Date.now(),review});
  let cancelled=false,timedOut=false,killTimer,timer,settled=false;
  const promise=new Promise(resolve=>{
   const child=spawn(review.executable,[...review.args],{cwd:review.cwd,shell:false,windowsHide:true,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});this.child=child;
   const finish=(code,signal,error)=>{if(settled)return;settled=true;clearTimeout(timer);clearTimeout(killTimer);this.child=null;this.cancelCurrent=null;
    const timing=this.timed.finish(timedOut?'timed out':cancelled?'cancelled':error||code!==0?'failed':'completed');this.timed=null;
    this.update({timing,status:timedOut?'timed out':cancelled?'cancelled':error?'failed':code===0?'completed':'failed',exitCode:code,signal,error:error?.message||null,lastActivityAt:Date.now(),finishedAt:Date.now()});resolve(this.state);};
   const stop=()=>{
    if(!child.pid||child.exitCode!==null||child.signalCode!==null)return;
    if(process.platform==='win32'){
     // Only the process tree owned by this run. Never name-based termination.
     const taskkill=path.join(process.env.SystemRoot||'C:\\Windows','System32','taskkill.exe');
     const killer=spawn(taskkill,['/PID',String(child.pid),'/T','/F'],{windowsHide:true,shell:false,stdio:'ignore'});
     killer.once('error',()=>child.kill());
    }else{
     try{process.kill(-child.pid,'SIGTERM');}catch{child.kill('SIGTERM');}
     killTimer=setTimeout(()=>{if(child.exitCode===null&&child.signalCode===null){try{process.kill(-child.pid,'SIGKILL');}catch{child.kill('SIGKILL');}}},500);
    }
   };
   this.cancelCurrent=()=>{if(!cancelled){cancelled=true;this.update({status:'cancelling'});stop();}};
   timer=setTimeout(()=>{timedOut=true;this.update({status:'stopping (timeout)'});stop();},review.timeoutMs);
   for(const [stream,label] of [[child.stdout,'stdout'],[child.stderr,'stderr']]){
    const decoder=new StringDecoder('utf8');
    const collect=value=>{if(!value)return;this.timed?.touch();const combined=this.state.output+`[${label}] `+clean(value);this.update({lastActivityAt:Date.now(),output:combined.slice(-65536),[label]:((this.state[label]||'')+clean(value)).slice(-65536),truncated:this.state.truncated||combined.length>65536});};
    stream.on('data',chunk=>collect(decoder.write(chunk)));stream.on('end',()=>collect(decoder.end()));
   }
   child.once('error',error=>finish(null,null,error));child.once('close',(code,signal)=>finish(code,signal));
  });
  this.pending=promise;
  try{return await promise;}finally{this.pending=null;activeRunners.delete(this);}
 }
 cancel(){this.cancelCurrent?.();return this.pending||Promise.resolve(this.state);}
 async close(){await this.cancel();}
}
