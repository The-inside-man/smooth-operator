import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
const execute=promisify(execFile),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
export async function verifyDetached({file,signature,keyring,fingerprint},{run=execute,signal}={}){
 if(!/^[A-Fa-f0-9]{40}$/.test(fingerprint||''))throw new Error('Supply the independently verified full 40-hex signing-key fingerprint.');
 for(const value of [file,signature,keyring])if(typeof value!=='string'||!path.isAbsolute(value))throw new Error('File, detached signature and trusted keyring need absolute paths.');
 const files=await Promise.all([file,signature,keyring].map(async(p,i)=>{const st=await fs.lstat(p);if(!st.isFile()||st.isSymbolicLink()||st.size>(i===0?134217728:4194304))throw new Error('Verification inputs must be bounded regular files, not symlinks.');return fs.readFile(p);}));
 signal?.throwIfAborted();const dir=await fs.mkdtemp(path.join(os.tmpdir(),'tim-signature-'));
 try{
  const paths=['payload','signature.asc','trusted.gpg'].map(n=>path.join(dir,n));await Promise.all(paths.map((p,i)=>fs.writeFile(p,files[i],{flag:'wx',mode:0o600})));
  let result;try{result=await run(process.platform==='win32'?'gpgv.exe':'gpgv',['--homedir',dir,'--status-fd','1','--weak-digest','SHA1','--keyring',paths[2],'--',paths[1],paths[0]],{windowsHide:true,timeout:15000,maxBuffer:262144,encoding:'utf8',signal});}catch{throw new Error('Signature verification failed or gpgv unavailable; no authenticity claim. Install/configure the verifier separately if needed.');}
  const valid=String(result.stdout).split(/\r?\n/).filter(l=>l.startsWith('[GNUPG:] VALIDSIG ')).map(l=>l.split(/\s+/).slice(2));
  if(!valid.some(parts=>[parts[0],parts[9]].map(x=>x?.toUpperCase()).includes(fingerprint.toUpperCase())&&parts.length>=9&&(Number(parts[3])===0||Number(parts[3])>Date.now()/1000)))throw new Error('Signature does not match the exact reviewed fingerprint.');
  if(/\[GNUPG:\] (BADSIG|ERRSIG|REVKEYSIG|EXPKEYSIG|EXPSIG|KEYREVOKED|KEYEXPIRED|SIGEXPIRED)/.test(String(result.stdout)))throw new Error('Expired, revoked or invalid signature; verification refused.');
  if(hash(await fs.readFile(file))!==hash(files[0]))throw new Error('Source file changed during verification.');
  return {verified:true,file,sha256:hash(files[0]),fingerprint:fingerprint.toUpperCase(),trust:'Cryptographic signature checked against your explicit keyring/fingerprint. gpgv trusts this keyring; current key expiry/revocation and vendor ownership are NOT independently checked.',installed:false};
 }finally{await fs.rm(dir,{recursive:true,force:true});}
}
export async function verifyDependencyCommand(args){const options={};for(let i=0;i<args.length;i++){const key={'--file':'file','--signature':'signature','--keyring':'keyring','--fingerprint':'fingerprint'}[args[i]];if(!key||!args[i+1])throw new Error('Use dependencies verify --file FILE --signature ASC --keyring TRUSTED_KEYRING --fingerprint FULL_FINGERPRINT');options[key]=args[++i];}console.log(JSON.stringify(await verifyDetached(options),null,2));}
