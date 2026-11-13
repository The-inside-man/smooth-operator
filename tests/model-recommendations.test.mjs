import test from 'node:test';
import assert from 'node:assert/strict';
import {getModelChoices,getModelRecommendations} from '../cli/model-recommendations.mjs';
import {catalogModels} from '../server/catalog.mjs';

const GiB=2**30;
const chatCount=catalogModels.filter(entry=>entry.kind==='chat').length;
const machine=(budget=24,total=32)=>({catalog:catalogModels,memory:{totalBytes:total*GiB,availableBytes:(budget+Math.max(1,total*.1))*GiB,reserveBytes:Math.max(1,total*.1)*GiB,modelBudgetBytes:budget*GiB,status:'ok',availableSource:'os',stale:false},hardware:{cpuName:'Fixture CPU',logicalCores:8,platform:'darwin',arch:'arm64'}});

test('every supported chat model stays visible in catalog order with memory and installation details',()=>{
 const snapshot={...machine(),models:[{id:'installed-four',catalogId:'qwen3-4b',available:false,issue:'Chat engine missing'}]};
 const result=getModelRecommendations(snapshot),chats=catalogModels.filter(entry=>entry.kind==='chat');
 assert.deepEqual(result.options.map(option=>option.id),chats.map(entry=>entry.id));
 assert.ok(result.options.every(option=>option.estimatedMemoryBytes===Math.round(option.memoryGB*GiB)));
 const installed=result.options.find(option=>option.id==='qwen3-4b');
 assert.equal(installed.installed,true);assert.equal(installed.available,false);assert.equal(installed.modelId,'installed-four');assert.equal(installed.issue,'Chat engine missing');
 assert.deepEqual(result.hardware,snapshot.hardware);
});

test('a capable machine receives three distinct memory tiers rather than only tiny models',()=>{
 for(const snapshot of [machine(24,32),machine(100,128)]){
  const result=getModelRecommendations(snapshot);
  assert.equal(result.suggestedIds.length,3);
  const suggestions=result.options.filter(option=>option.suggested);
  assert.equal(new Set(suggestions.map(option=>option.estimatedMemoryBytes)).size,3);
  assert.deepEqual(new Set(suggestions.map(option=>option.suggestionKind)),new Set(['balanced','capable','efficient']));
  assert.ok(suggestions.some(option=>option.memoryGB>=8),'larger suitable models should be suggested');
  assert.ok(suggestions.every(option=>option.memoryGB>=3),'large machines should not get only sub-billion defaults');
  assert.ok(suggestions.every(option=>option.estimatedMemoryBytes<=result.memory.comfortableBudgetBytes));
  assert.ok(suggestions.every(option=>option.reason.length>20));
  assert.equal(result.recommendations[0].kind,'balanced');
 }
});

test('low-memory machines receive only comfortable suggestions while oversized choices remain selectable',()=>{
 const result=getModelRecommendations(machine(4,8));
 assert.ok(result.suggestedIds.length>=2);
 assert.ok(result.options.filter(option=>option.suggested).every(option=>option.estimatedMemoryBytes<=3.2*GiB));
 const large=result.options.find(option=>option.id==='qwen3-14b');
 assert.equal(large.fit,'too-large');assert.equal(large.suggested,false);
 assert.equal(result.options.find(option=>option.id==='qwen2.5-3b').fit,'tight');
 assert.equal(result.options.length,chatCount,'memory fit warns without hiding supported models');
});

test('unknown or stale memory produces no automatic suggestions',()=>{
 for(const memory of [{},{totalBytes:32*GiB},{modelBudgetBytes:12*GiB},{...machine().memory,stale:true},{...machine().memory,status:'stale'}]){
  const result=getModelRecommendations({catalog:catalogModels,memory});
  assert.equal(result.suggestedIds.length,0);
  assert.equal(result.memory.reliable,false);assert.match(result.memory.notice,/unavailable|stale/);
  assert.equal(result.options.length,chatCount);
 }
});

test('fallback memory uses a smaller comfortable budget and explains its uncertainty',()=>{
 const normal=getModelRecommendations(machine(24,32));
 for(const marker of [{status:'fallback'},{availableSource:'free-fallback'}]){
  const result=getModelRecommendations({...machine(24,32),memory:{...machine(24,32).memory,...marker}});
  assert.equal(result.memory.reliable,false);assert.equal(result.memory.comfortableBudgetBytes,normal.memory.comfortableBudgetBytes*.5);
  assert.match(result.memory.notice,/conservative fallback/);
  assert.ok(result.options.filter(option=>option.suggested).every(option=>option.estimatedMemoryBytes<=result.memory.comfortableBudgetBytes));
 }
});

test('zero budgets and inconsistent reported memory never recommend a model above available capacity',()=>{
 const zero=getModelRecommendations(machine(0,8));
 assert.equal(zero.memory.modelBudgetBytes,0);assert.equal(zero.suggestedIds.length,0);
 assert.ok(zero.options.every(option=>option.fit==='too-large'));
 const capped=getModelRecommendations({catalog:catalogModels,memory:{totalBytes:16*GiB,availableBytes:5*GiB,reserveBytes:2*GiB,modelBudgetBytes:100*GiB}});
 assert.equal(capped.memory.modelBudgetBytes,3*GiB);
 assert.ok(capped.options.filter(option=>option.suggested).every(option=>option.estimatedMemoryBytes<=2.4*GiB));
});

test('unknown model estimates stay visible and are never suggested or labeled as fitting',()=>{
 const catalog=[{id:'known',kind:'chat',memoryGB:2},{id:'unknown',kind:'chat'},{id:'bad',kind:'chat',memoryGB:NaN},{id:'negative',kind:'chat',memoryGB:-3},{id:'media',kind:'image',memoryGB:1}];
 const result=getModelRecommendations({...machine(),catalog});
 assert.equal(result.options.length,4);
 for(const option of result.options.filter(option=>option.id!=='known')){assert.equal(option.fit,'unknown');assert.equal(option.suggested,false);}
 assert.deepEqual(result.suggestedIds,['known']);assert.equal(result.options[0].suggestionKind,'balanced');
});

test('legacy memory fields are normalized without mutating catalog or snapshot input',()=>{
 const snapshot={catalog:structuredClone(catalogModels),memory:{total:16*GiB,free:12*GiB},platform:'linux',arch:'x64'};
 const before=structuredClone(snapshot);const result=getModelRecommendations(snapshot);
 assert.deepEqual(snapshot,before);
 assert.equal(result.memory.totalBytes,16*GiB);assert.equal(result.memory.availableBytes,12*GiB);
 assert.equal(result.memory.modelBudgetBytes,10.4*GiB);
 assert.equal(result.memory.reliable,false);assert.equal(result.memory.source,'free-fallback');
 assert.equal(result.hardware.platform,'linux');assert.equal(result.hardware.arch,'x64');
 assert.ok(result.suggestedIds.length>=2);
});

test('combined model choices put installed catalog IDs first and include every remaining download',()=>{
 const model={id:'actual-installed-four',catalogId:'qwen3-4b',name:'My installed 4B',kind:'chat',available:true,issue:'',validation:'Ran successfully'};
 const snapshot={...machine(),models:[model]},before=structuredClone(snapshot),result=getModelChoices(snapshot);
 assert.equal(result.choices.length,chatCount);
 const installed=result.choices[0],catalog=result.options.find(entry=>entry.id==='qwen3-4b');
 assert.equal(installed.id,model.id);assert.equal(installed.modelId,model.id);assert.equal(installed.name,model.name);assert.equal(installed.catalogId,'qwen3-4b');
 assert.equal(installed.kind,'chat');assert.equal(installed.installed,true);assert.equal(installed.available,true);assert.equal(installed.validation,'Ran successfully');
 assert.equal(installed.estimatedMemoryBytes,4.5*GiB);assert.equal(installed.downloadBytes,catalog.downloadBytes);assert.equal(installed.fit,catalog.fit);assert.equal(installed.suggested,catalog.suggested);
 assert.deepEqual(result.choices.slice(1).map(choice=>choice.catalogId),catalogModels.filter(entry=>entry.kind==='chat'&&entry.id!=='qwen3-4b').map(entry=>entry.id));
 assert.ok(result.choices.slice(1).every(choice=>choice.id==='catalog:'+choice.catalogId&&!choice.installed&&!choice.available));
 assert.deepEqual(snapshot,before,'choice normalization must not mutate the registry or catalog');
 assert.deepEqual(result.memory,getModelRecommendations(snapshot).memory);
});

test('combined choices preserve external imports and registry order without inventing a hardware fit',()=>{
 const snapshot={...machine(),models:[
  {id:'external-sized',name:'My custom model',kind:'chat',available:true,size:2*GiB},
  {id:'installed-eight',catalogId:'qwen3-8b',name:'My 8B',kind:'chat',available:false,issue:'Chat engine missing'},
  {id:'external-estimated',name:'Estimated import',kind:'chat',available:true,memoryGB:6},
  {id:'external-unknown',name:'Unmeasured import',kind:'chat',available:false,issue:'Disconnected drive'},
  {id:'speech',name:'Speech model',kind:'transcribe',available:true},
 ]};
 const result=getModelChoices(snapshot);
 assert.equal(result.choices.length,chatCount+3);assert.deepEqual(result.choices.slice(0,4).map(choice=>choice.id),['external-sized','installed-eight','external-estimated','external-unknown']);
 for(const id of ['external-sized','external-estimated','external-unknown']){const choice=result.choices.find(choice=>choice.id===id);assert.equal(choice.installed,true);assert.equal(choice.fit,'unknown');assert.equal(choice.suggested,false);assert.equal(choice.suggestionKind,undefined);}
 assert.equal(result.choices[0].estimatedMemoryBytes,Math.round(2*GiB*1.2+.5*GiB));assert.equal(result.choices[2].estimatedMemoryBytes,6*GiB);assert.equal(result.choices[3].estimatedMemoryBytes,null);
 assert.equal(result.choices[0].available,true);assert.equal(result.choices[1].available,false);assert.equal(result.choices[1].issue,'Chat engine missing');assert.equal(result.choices[3].issue,'Disconnected drive');
 assert.ok(result.choices.every(choice=>choice.kind==='chat'));assert.ok(!result.choices.some(choice=>choice.id==='speech'));
});

test('combined choices merge catalog modelId aliases and retain missing-registry installation status',()=>{
 const snapshot={...machine(),catalog:[
  {id:'first',kind:'chat',name:'Catalog first',memoryGB:2,downloadBytes:100,modelId:'registry-alias'},
  {id:'missing',kind:'chat',name:'Missing catalog file',memoryGB:3,downloadBytes:200,modelId:'missing-file-id',installed:true,available:true,issue:'File missing'},
  {id:'new',kind:'chat',name:'Available download',memoryGB:4,downloadBytes:300},
  {id:'media',kind:'image',name:'Image model',memoryGB:1},
 ],models:[{id:'registry-alias',name:'Actual imported display name',kind:'chat',available:true}]};
 const {choices}=getModelChoices(snapshot);
 assert.equal(choices.length,3);assert.equal(choices[0].catalogId,'first');assert.equal(choices[0].id,'registry-alias');assert.equal(choices[0].name,'Actual imported display name');assert.equal(choices[0].estimatedMemoryBytes,2*GiB);
 assert.equal(choices[1].catalogId,'missing');assert.equal(choices[1].id,'missing-file-id');assert.equal(choices[1].installed,true);assert.equal(choices[1].available,false);assert.equal(choices[1].issue,'File missing');
 assert.equal(choices[2].id,'catalog:new');assert.equal(choices[2].installed,false);assert.equal(choices[2].available,false);
});

test('combined model choices deduplicate catalog and registry identities and exclude non-chat entries',()=>{
 const snapshot={...machine(),models:[
  {id:'first-copy',catalogId:'qwen3-4b',name:'First copy',kind:'chat',available:false,issue:'Needs repair'},
  {id:'second-copy',catalogId:'qwen3-4b',name:'Second copy',kind:'chat',available:true},
  {id:'first-copy',catalogId:'qwen3-8b',name:'Duplicate registry ID',kind:'chat',available:true},
  {id:'external',name:'External first',kind:'chat',available:true},
  {id:'external',name:'External duplicate',kind:'chat',available:true},
  {id:'image',name:'Not chat',kind:'image',available:true},
 ]};
 const result=getModelChoices(snapshot);
 assert.equal(result.choices.length,chatCount+1);assert.deepEqual(result.choices.slice(0,2).map(choice=>choice.name),['First copy','External first']);
 assert.equal(result.choices.filter(choice=>choice.catalogId==='qwen3-4b').length,1);assert.equal(result.choices.filter(choice=>choice.id==='external').length,1);
 assert.equal(result.choices.find(choice=>choice.catalogId==='qwen3-8b').available,false,'a skipped duplicate registry ID cannot create another installed choice');
 assert.equal(new Set(result.choices.map(choice=>choice.id)).size,result.choices.length);
 assert.ok(!result.choices.some(choice=>choice.id==='image'));assert.equal(getModelChoices({models:[{id:'media',kind:'image'}]}).choices.length,0);
});
