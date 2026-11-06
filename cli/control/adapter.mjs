import {clean} from '../core.mjs';
import {spawn} from 'node:child_process';
export async function connectDesktopAdapter(executable,{spawnAdapter=spawn}={}){
 const child=spawnAdapter(executable,[],{stdio:['pipe','pipe','pipe'],windowsHide:true});let sequence=0,buffer='',diagnostic='',interrupt,dead=false;const pending=new Map();
 const fail=error=>{dead=true;for(const p of pending.values())p.reject(error);pending.clear();interrupt?.();};
 const rpc=(method,params)=>new Promise((resolve,reject)=>{if(dead)return reject(new Error('Desktop adapter disconnected'));const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error('Desktop adapter timeout; outcome may be uncertain'));},5000);pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});child.stdin.write(JSON.stringify({id,method,params})+'\n');});
 child.stdout.on('data',chunk=>{buffer+=chunk;if(buffer.length>128000){fail(new Error('Desktop protocol exceeded limit'));child.kill();return;}let at;while((at=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,at);buffer=buffer.slice(at+1);try{const e=JSON.parse(line);if(['emergencyStop','manualInput'].includes(e.event))interrupt?.();else if(pending.has(e.id)){const p=pending.get(e.id);pending.delete(e.id);e.error?p.reject(new Error(String(e.error).slice(0,1000))):p.resolve(e.result);}}catch{fail(new Error('Invalid desktop adapter response'));child.kill();}}});
 child.stderr.on('data',chunk=>{diagnostic=clean((diagnostic+String(chunk)).slice(-1500));});child.on('error',fail);child.on('exit',()=>fail(new Error('Desktop adapter disconnected'+(diagnostic?': '+diagnostic:''))));child.stdin.on('error',fail);
 const close=async()=>{if(!dead)await rpc('releaseAll',{}).catch(()=>{});child.kill();};
 try{const capabilities=await rpc('capabilities',{});return {capabilities,onInterrupt:fn=>interrupt=fn,observeSemantic:targetPid=>rpc('observeSemantic',{targetPid}),actSemantic:params=>rpc('actSemantic',params),releaseAll:()=>rpc('releaseAll',{}),close};}catch(error){await close();throw error;}
}
