import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
export const PROTOCOL=1;
export const pause=ms=>new Promise(r=>setTimeout(r,ms));
export function alive(pid){if(!Number.isSafeInteger(pid)||pid<1)return null;try{process.kill(pid,0);return true;}catch(e){return e.code==='ESRCH'?false:null;}}
export async function readRecord(file){
 const st=await fs.lstat(file);if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||st.size>8192)throw Error('Untrusted backend discovery file.');
 if(process.platform!=='win32'&&(st.uid!==process.getuid()||(st.mode&0o077)))throw Error('Backend discovery must be private to this user.');
 return JSON.parse(await fs.readFile(file,'utf8'));
}
export async function removeOwn(file,id){try{if((await readRecord(file)).id===id)await fs.unlink(file);}catch(e){if(e.code!=='ENOENT')throw e;}}
export async function buildIdentity(){
 const hash=createHash('sha256');for(const dir of ['../cli/','../server/']){
 const root=new URL(dir,import.meta.url);const names=(await fs.readdir(root,{recursive:true})).filter(n=>n.endsWith('.mjs')).sort();
 for(const name of names){hash.update(dir+name.replaceAll('\\','/'));hash.update((await fs.readFile(new URL(name.replaceAll('\\','/'),root),'utf8')).replaceAll('\r\n','\n'));}
 }return hash.digest('hex');
}
export function validateRecord(r,dataDir,build,libraryRoot){
 if(r.protocol!==PROTOCOL||r.build!==build)throw Error('Existing TIM backend is incompatible with this CLI build. Close its windows before upgrading; its lock was preserved.');
 if(r.dataDir!==dataDir||!Number.isSafeInteger(r.pid)||r.pid<1||!/^[a-f0-9]{64}$/.test(r.token||'')||typeof r.id!=='string')throw Error('Invalid backend identity; lock preserved.');
 if(libraryRoot&&r.libraryRoot!==path.resolve(libraryRoot))throw Error('Existing backend uses a different model library; use a separate --data-dir.');
 if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(r.url||''))throw Error('Invalid backend loopback endpoint; lock preserved.');
}
export async function control(record,action,lease){
 const res=await fetch(record.url+'/api/cli/'+action,{method:'POST',redirect:'error',headers:{authorization:'Bearer '+record.token,'x-tim-request':'1','content-type':'application/json'},body:JSON.stringify({lease}),signal:AbortSignal.timeout(4000)});
 const result=await res.json();if(!res.ok){const error=Error(result.error||'Shared backend rejected request');error.status=res.status;throw error;}
 if(result.id!==record.id||result.pid!==record.pid||result.protocol!==PROTOCOL||result.build!==record.build)throw Error('Backend identity handshake failed; no process was stopped.');return result;
}
