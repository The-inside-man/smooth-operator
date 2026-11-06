import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {modelIntent,proposeToolDraft} from '../cli/planner.mjs';
import {saveDraft,readTool,searchToolbox,toolboxReview,verifyToolRun,recordToolRun,toolboxRoot} from '../cli/toolbox.mjs';
const draft={id:'test-tool',name:'port formatter',description:'format local port numbers',originalRequest:'format port numbers',why:'Reusable local formatting',source:'console.log("fixture")',tags:['port']};
test('explicit toolbox persists drafts, searches before creation, versions without overwrite and revalidates source',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'tim-toolbox-'));
 try{
  const saved=await saveDraft(root,draft);assert.equal(saved.reviewState,'draft');assert.equal((await readTool(root,saved.id)).source,draft.source);
  const recalled=await searchToolbox(root,'format port');assert.equal(recalled[0].id,saved.id);assert.equal(recalled[0].compatible,true);
  const review=await toolboxReview(root,saved.id);await verifyToolRun(review);await recordToolRun(review,{status:'completed',exitCode:0});assert.equal((await readTool(root,saved.id)).reviewState,'reviewed');
  const metadataFile=path.join(root,saved.id,'v1','metadata.json'),originalMetadata=await fs.readFile(metadataFile,'utf8');
  const changedMetadata=JSON.parse(originalMetadata);changedMetadata.permissions='New elevated permission';await fs.writeFile(metadataFile,JSON.stringify(changedMetadata));await assert.rejects(verifyToolRun(review),/permissions/);await fs.writeFile(metadataFile,originalMetadata);
  const newer=await saveDraft(root,{...draft,source:'console.log("second")'});assert.equal(newer.version,2);assert.equal((await readTool(root,saved.id,1)).source,draft.source);assert.equal((await readTool(root,saved.id)).reviewState,'draft');
  await fs.appendFile(path.join(root,saved.id,'v1','source.mjs'),'// changed');await assert.rejects(verifyToolRun(review),/changed/);
  const incompatible=await saveDraft(root,{...draft,id:'needs-deps',dependencies:['external-package']});assert.equal((await readTool(root,incompatible.id)).compatible,false);await assert.rejects(toolboxReview(root,incompatible.id),/cannot run/);
  await assert.rejects(saveDraft(root,{...draft,id:'../escape'}),/Invalid/);await assert.rejects(readTool(root,'../escape'),/Invalid/);
  await fs.writeFile(path.join(root,'test-tool','v2','metadata.json'),'broken');assert.equal((await searchToolbox(root)).find(x=>x.id==='test-tool').status,'corrupt/unreadable');
  await assert.rejects(toolboxRoot(path.join(root,'unavailable-drive')),/ENOENT/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('concurrent toolbox writes serialize by exclusive lock; failed source validation leaves no draft',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'tim-toolbox-'));try{
  const results=await Promise.allSettled([saveDraft(root,draft),saveDraft(root,draft)]);assert.ok(results.some(r=>r.status==='fulfilled'));assert.equal((await readTool(root,draft.id)).intact,true);
  await assert.rejects(saveDraft(root,{...draft,id:'invalid-source',source:'\x1b[31m'}),/bounded/);assert.ok(!(await fs.readdir(root)).includes('invalid-source'));
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('central recall gates generation, missing-tool fallback saves only drafts, concurrent audit loses no outcomes',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'tim-toolbox-gate-'));try{
  await assert.rejects(modelIntent(null,'build','script'),/recall/);
  await saveDraft(root,draft);let calls=0;const provider=async()=>{calls++;return {action:'build',name:'other tool',description:'different purpose',source:'console.log("draft only")',platforms:[process.platform],dependencies:[],tags:[],permissions:'user',networkScope:'none'};};
  assert.equal((await proposeToolDraft({root,request:'port formatter',intentProvider:provider})).kind,'reuse');assert.equal(calls,0);
  const proposal=await proposeToolDraft({root,request:'distinct unrelated request',intentProvider:provider});assert.equal(calls,1);assert.equal(proposal.kind,'draft');assert.equal(proposal.draft.reviewState,'draft');
  const review=await toolboxReview(root,draft.id);await Promise.all(Array.from({length:10},(_,i)=>recordToolRun(review,{status:'completed',exitCode:i})));const history=(await readTool(root,draft.id)).history;assert.equal(history.length,10);assert.equal(new Set(history.map(h=>h.exitCode)).size,10);
  const versions=await Promise.all([saveDraft(root,draft),saveDraft(root,draft)]);assert.deepEqual(versions.map(v=>v.version).sort(),[2,3]);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
