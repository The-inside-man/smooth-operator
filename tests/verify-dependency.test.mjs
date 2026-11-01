import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {verifyDetached} from '../cli/verify-dependency.mjs';
test('offline verifier isolates keyring, pins fingerprint, rejects missing/bad/expired verification and changed source',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'tim-signature-test-')),fingerprint='A'.repeat(40),options={file:path.join(dir,'archive'),signature:path.join(dir,'archive.asc'),keyring:path.join(dir,'trusted.gpg'),fingerprint};
 await Promise.all([options.file,options.signature,options.keyring].map(p=>fs.writeFile(p,'fixture')));
 const status='[GNUPG:] VALIDSIG '+fingerprint+' 2026-01-01 1767225600 0 4 0 1 8 00 '+fingerprint;
 let tmp;const run=async(exe,args)=>{assert.match(exe,/gpgv/);assert.equal(args[0],'--homedir');tmp=args[1];assert.notEqual(tmp,dir);assert.ok(args.includes('--'));assert.ok(args.includes('--weak-digest'));return {stdout:status};};
 try{const result=await verifyDetached(options,{run});assert.equal(result.verified,true);assert.equal(result.installed,false);assert.match(result.trust,/NOT independently/);await assert.rejects(fs.access(tmp));
 await assert.rejects(verifyDetached({...options,fingerprint:'B'.repeat(40)},{run}),/fingerprint/);
 await assert.rejects(verifyDetached(options,{run:async()=>{throw Error('missing executable');}}),/unavailable/);
 await assert.rejects(verifyDetached(options,{run:async()=>({stdout:status+'\n[GNUPG:] BADSIG bad'})}),/invalid/);
 await assert.rejects(verifyDetached(options,{run:async()=>({stdout:status.replace('1767225600 0','1767225600 1')})}),/fingerprint/);
 await assert.rejects(verifyDetached(options,{run:async()=>{await fs.writeFile(options.file,'changed');return {stdout:status};}}),/changed/);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
