import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {Studio} from '../server/studio.mjs';
import {ownBackend} from '../cli/backend.mjs';
test('owned headless backend uses an isolated ephemeral loopback port and releases its data lock',async t=>{
 let autoSetupCalls=0;t.mock.method(Studio.prototype,'startDefaultGuide',async()=>{autoSetupCalls++;});
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'tim-backend-test-')),dataDir=path.join(root,'data'),library=path.join(root,'library');let backend;
 const other=http.createServer((_req,res)=>res.end('other app'));await new Promise(r=>other.listen(0,'127.0.0.1',r));
 try{
  await fs.mkdir(path.join(library,'Coding-Models'),{recursive:true});await fs.mkdir(dataDir);await fs.writeFile(path.join(dataDir,'settings.json'),JSON.stringify({backend:'cpu',libraryRoot:library}));
  backend=await ownBackend({dataDir,libraryRoot:library});assert.ok(backend.url.startsWith('http://127.0.0.1:'));assert.notEqual(Number(new URL(backend.url).port),other.address().port);
  const state=await (await fetch(backend.url+'/api/state')).json();assert.equal(state.models.length,0);assert.equal(state.gpu,null);assert.equal(state.jobs.length,0);
  await assert.rejects(ownBackend({dataDir,libraryRoot:library}),/already locked/);
  const old=backend.url;await backend.close();await backend.close();assert.ok(other.listening);await assert.rejects(fetch(old+'/api/state'));
  backend=await ownBackend({dataDir,libraryRoot:library});await backend.close();await assert.rejects(fs.access(path.join(dataDir,'cli.lock')));assert.equal(autoSetupCalls,0,'CLI must not invoke automatic guide setup or inference');
 }finally{await backend?.close();await new Promise(r=>other.close(r));await fs.rm(root,{recursive:true,force:true});}
});
