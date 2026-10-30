import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {makeReview} from './tool-runner.mjs';
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const idPattern=/^[a-z0-9][a-z0-9-]{0,63}$/;
const bounded=(s,max=2000)=>typeof s==='string'&&s.length<=max&&!/[\x00-\x08\x0b-\x1f]/.test(s);
const configFile=()=>path.join(process.env.TIM_DATA_DIR||path.join(os.homedir(),'.tim-studio'),'toolbox.json');
async function acquireLock(file){
 const deadline=Date.now()+2000;
 for(;;){try{return await fs.open(file,'wx');}catch(error){if(error.code!=='EEXIST')throw error;if(Date.now()>=deadline)throw new Error('Toolbox write is busy or a prior writer left a lock; no changes were made.');await new Promise(resolve=>setTimeout(resolve,20));}}
}
async function atomic(file,value){const temp=file+'.'+crypto.randomUUID()+'.tmp';try{await fs.writeFile(temp,JSON.stringify(value,null,2)+'\n',{flag:'wx'});await fs.rename(temp,file);}finally{await fs.unlink(temp).catch(()=>{});}}
export async function toolboxRoot(explicit){
 let root=explicit||process.env.TIM_TOOLBOX;
 if(!root){try{root=JSON.parse(await fs.readFile(configFile(),'utf8')).root;}catch(e){if(e.code!=='ENOENT')throw new Error('Toolbox configuration is unreadable: '+e.message);}}
 if(!root)throw new Error('Choose a toolbox directory first: tim toolbox location "DIRECTORY". Or pass --toolbox DIRECTORY. No location was selected automatically.');
 const resolved=await fs.realpath(path.resolve(root));if(!(await fs.stat(resolved)).isDirectory())throw new Error('Toolbox location is not a directory.');return resolved;
}
export async function selectToolbox(root){
 if(!root||!path.isAbsolute(root))throw new Error('Choose an absolute directory path.');
 // Require the selected directory to exist: absent/removable drives never trigger a fallback.
 root=await toolboxRoot(root);const probe=path.join(root,'.tim-write-'+crypto.randomUUID());await fs.writeFile(probe,'',{flag:'wx'});await fs.unlink(probe);
 await fs.mkdir(path.dirname(configFile()),{recursive:true});await atomic(configFile(),{schema:1,root});return root;
}
function validate(m){
 if(m?.schema!==1||!idPattern.test(m.id)||!Number.isInteger(m.version)||m.version<1||!['draft','reviewed'].includes(m.reviewState)||m.entry!=='source.mjs'||m.runtime!=='node'||!bounded(m.name,100)||!bounded(m.description)||!bounded(m.originalRequest)||!bounded(m.why)||!Array.isArray(m.platforms)||m.platforms.some(p=>!['win32','linux','darwin'].includes(p))||!Array.isArray(m.dependencies)||m.dependencies.some(d=>!bounded(d,100))||!Array.isArray(m.tags)||m.tags.some(t=>!bounded(t,80))||!bounded(m.permissions)||!bounded(m.networkScope)||! /^[a-f0-9]{64}$/.test(m.sourceHash)||!Array.isArray(m.history)||m.history.length>20)throw new Error('Invalid toolbox metadata.');
 return m;
}
async function safe(root,...parts){const target=path.join(root,...parts),real=await fs.realpath(target);if(real!==root&&!real.startsWith(root+path.sep))throw new Error('Toolbox symlink/path escapes its selected root.');return real;}
export async function readTool(root,id,version){
 root=await toolboxRoot(root);if(!idPattern.test(id))throw new Error('Invalid toolbox ID.');
 const directory=await safe(root,id),versions=(await fs.readdir(directory)).filter(n=>/^v[1-9]\d*$/.test(n)).map(n=>Number(n.slice(1))).sort((a,b)=>b-a);
 version=version??versions[0];if(!Number.isInteger(version)||version<1)throw new Error('No valid tool version.');
 const base=await safe(root,id,'v'+version),m=validate(JSON.parse(await fs.readFile(await safe(root,id,'v'+version,'metadata.json'),'utf8')));
 if(m.id!==id||m.version!==version)throw new Error('Tool identity mismatch.');
 const source=await fs.readFile(await safe(root,id,'v'+version,m.entry),'utf8');
 const intact=hash(source)===m.sourceHash;const compatible=m.platforms.includes(process.platform)&&m.dependencies.length===0;
 return {...m,source,base,intact,compatible,status:!intact?'changed source':!compatible?'incompatible or dependencies require review':m.reviewState};
}
export async function searchToolbox(root,query=''){
 root=await toolboxRoot(root);const words=query.toLowerCase().split(/\W+/).filter(w=>w.length>2),results=[];
 for(const id of await fs.readdir(root)){if(!idPattern.test(id))continue;try{const item=await readTool(root,id);const text=[item.name,item.description,...item.tags,item.originalRequest].join(' ').toLowerCase();const score=words.filter(w=>text.includes(w)).length;if(!words.length||score)results.push({...item,score});}catch(error){results.push({id,status:'corrupt/unreadable',error:error.message,score:-1});}}
 return results.sort((a,b)=>b.score-a.score).slice(0,50);
}
export async function saveDraft(root,input){
 root=await toolboxRoot(root);if(!bounded(input.source,100000)||!input.source.trim())throw new Error('Provide bounded JavaScript source without terminal controls.');
 const id=input.id||crypto.randomUUID();if(!idPattern.test(id))throw new Error('Invalid toolbox ID.');
 const lock=path.join(root,'.write-'+id);const handle=await acquireLock(lock);let temp;
 try{
  let version=1;try{version=(await readTool(root,id)).version+1;}catch(e){if(e.code!=='ENOENT')throw e;}
  const dir=path.join(root,id);await fs.mkdir(dir,{recursive:true});await safe(root,id);
  const now=new Date().toISOString();const m=validate({schema:1,id,version,name:input.name,description:input.description,originalRequest:input.originalRequest,why:input.why,tags:input.tags||[],createdAt:now,updatedAt:now,runtime:'node',language:'javascript',platforms:input.platforms||['win32','linux','darwin'],dependencies:input.dependencies||[],entry:'source.mjs',argvSchema:{type:'array',items:'string',maxItems:128},permissions:input.permissions||'User privileges; review source before running.',networkScope:input.networkScope||'Unspecified; review source.',provenance:input.provenance||{type:'imported'},sourceHash:hash(input.source),reviewState:'draft',validation:input.validation||'Not executed or validated.',history:[]});
  temp=path.join(dir,'.draft-'+crypto.randomUUID());await fs.mkdir(temp);await fs.writeFile(path.join(temp,'source.mjs'),input.source);await fs.writeFile(path.join(temp,'metadata.json'),JSON.stringify(m,null,2));await fs.rename(temp,path.join(dir,'v'+version));temp=null;return m;
 }finally{if(temp)await fs.rm(temp,{recursive:true,force:true});await handle.close();await fs.unlink(lock);}
}
const approvalHash=item=>hash(JSON.stringify({sourceHash:item.sourceHash,permissions:item.permissions,networkScope:item.networkScope,platforms:item.platforms,dependencies:item.dependencies,entry:item.entry,runtime:item.runtime,argvSchema:item.argvSchema}));
export async function toolboxReview(root,id,args=[]){
 const item=await readTool(root,id);if(!item.intact||!item.compatible)throw new Error('Tool cannot run: '+item.status);
 return {...makeReview({id:item.id,name:item.name,status:'installed',executable:process.execPath,risk:`Stored ${item.reviewState}, version ${item.version}. Review source first. Permissions: ${item.permissions}. Network: ${item.networkScope}.`,interactive:false},[path.join(item.base,item.entry),...args]),toolbox:{root,id,version:item.version,hash:item.sourceHash,approvalHash:approvalHash(item)}};
}
export async function recordToolRun(review,state){
 const ref=review.toolbox;if(!ref)return;const lock=path.join(await toolboxRoot(ref.root),'.write-'+ref.id);const handle=await acquireLock(lock);try{const item=await readTool(ref.root,ref.id,ref.version);if(item.sourceHash!==ref.hash||!item.intact)throw new Error('Tool source changed; create and review a new version before running.');
 const {source,base,intact,compatible,status,...m}=item;m.reviewState='reviewed';m.updatedAt=new Date().toISOString();m.history=[...m.history,{at:m.updatedAt,status:state.status,exitCode:state.exitCode??null}].slice(-20);await atomic(path.join(base,'metadata.json'),m);
 }finally{await handle.close();await fs.unlink(lock);}
}
export async function verifyToolRun(review){if(!review.toolbox)return;const r=review.toolbox,t=await readTool(r.root,r.id,r.version);if(!t.intact||!t.compatible||t.sourceHash!==r.hash||approvalHash(t)!==r.approvalHash)throw new Error('Toolbox source, permissions or compatibility changed since review; launch refused.');}
