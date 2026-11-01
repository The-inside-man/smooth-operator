import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';import {dependencyPlan,downloadDependency} from '../cli/dependencies.mjs';
test('dependency download rejects missing trust data and ambiguous Tor versions before transfer',async()=>{
 let fetched=0;const fetchBytes=async()=>{fetched++;throw Error('unexpected transfer');};
 await assert.rejects(downloadDependency({id:'node',url:'https://nodejs.org/dist/v24.1.0/node-v24.1.0-win-x64.zip'},'C:/fixture',{fetchBytes}),/checksum/);
 await assert.rejects(downloadDependency({id:'tor',url:'https://dist.torproject.org/torbrowser/16.0/tor-expert-bundle-windows-x86_64-16.0.tar.gz'},'C:/fixture',{fetchBytes}),/signature/);
 await assert.rejects(downloadDependency({id:'arbitrary',url:'https://example.com'},'C:/fixture',{fetchBytes}),/Unknown/);assert.equal(fetched,0);
 const html=['16.0','16.1'].flatMap(v=>{const u='https://dist.torproject.org/torbrowser/'+v+'/tor-expert-bundle-windows-x86_64-'+v+'.tar.gz';return ['<a href="'+u+'">bundle</a>','<a href="'+u+'.asc">signature</a>'];}).join('');
 const options={platform:'win32',arch:'x64',fetchBytes:async()=>({bytes:Buffer.from(html)})};assert.equal((await dependencyPlan('tor',options)).manual,true);assert.equal((await dependencyPlan('tor',{...options,version:'16.1'})).version,'16.1');
});
test('Windows bootstrap plan needs neither Node nor network and creates no directory',{skip:process.platform!=='win32'},async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'tim-bootstrap-plan-')),dest=path.join(dir,'runtime with spaces');try{
 const ps=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');const out=execFileSync(ps,['-NoProfile','-File',path.resolve('installers/bootstrap-node.ps1'),'-Version','24.1.0','-Destination',dest,'-Plan'],{encoding:'utf8'});assert.match(out,/https:\/\/nodejs.org/);await assert.rejects(fs.access(dest));
 assert.throws(()=>execFileSync(ps,['-NoProfile','-File',path.resolve('installers/bootstrap-node.ps1'),'-Version','bad;command','-Destination',dest,'-Plan'],{stdio:'pipe'}));
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('Unix bootstrap parses in installed Git Bash; unsupported platform fails before writes',{skip:process.platform!=='win32'},()=>{
 const bash='C:/Program Files/Git/bin/bash.exe';execFileSync(bash,['-n','installers/bootstrap-node.sh'],{stdio:'pipe'});assert.throws(()=>execFileSync(bash,['installers/bootstrap-node.sh','24.1.0','/unused-runtime','--plan'],{stdio:'pipe'}),e=>String(e.stderr).includes('supports macOS and Linux'));
});
