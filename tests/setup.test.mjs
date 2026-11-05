import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Studio } from '../server/studio.mjs';
import { catalogModels, defaultOrchestratorId } from '../server/catalog.mjs';
import { startServer } from '../server/index.mjs';
import { MemoryMonitor } from '../server/memory.mjs';

const guide = () => ({ id: `catalog:${defaultOrchestratorId}`, catalogId: defaultOrchestratorId, name: 'Small guide', kind: 'chat', file: '/models/guide.gguf', available: true, issue: '' });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const GiB = 2 ** 30;

async function waitForStart(started, operation) {
  let timer;
  try {
    await Promise.race([
      started.promise,
      operation.then(() => { throw new Error('The model load finished before the fixture engine started.'); }),
      new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Timed out waiting for the fixture engine to start.')), 2000); })
    ]);
  } finally { clearTimeout(timer); }
}

async function fixture(t, { budgetBytes = 8 * GiB } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tim-setup-'));
  // These engines are fixtures: runner memory pressure must not decide whether
  // their load callbacks run. Real admission behavior is tested explicitly below.
  t.mock.method(os, 'totalmem', () => 16 * GiB);
  const studio = new Studio(dir), installed = [], downloads = [], calls = [];
  const totalBytes = 16 * GiB, reserveBytes = Math.round(totalBytes * .1);
  studio.memoryMonitor = new MemoryMonitor({
    total: () => totalBytes,
    free: () => budgetBytes + reserveBytes,
    host: async () => ({ total: totalBytes, totalBytes, free: budgetBytes + reserveBytes, availableBytes: budgetBytes + reserveBytes, usedBytes: totalBytes - budgetBytes - reserveBytes, reserveBytes, modelBudgetBytes: budgetBytes, availableSource: 'os' }),
    processes: async () => new Map()
  });
  studio.downloads = { async init() {}, async close() {}, snapshot: () => structuredClone(downloads), installedModels: async () => structuredClone(installed) };
  studio.rescan = async () => {}; studio.telemetry = async () => {};
  await studio.init();
  const runtimeDir = path.join(dir, 'runtimes', `${process.platform}-${process.arch}`, 'chat', 'cpu');
  await fs.mkdir(runtimeDir, { recursive: true });
  await fs.writeFile(path.join(runtimeDir, 'llama-server' + (process.platform === 'win32' ? '.exe' : '')), 'fixture');
  studio.orchestrator = {
    modelId: null,
    async load(model, runtime, signal, _update, context, tools) { signal.throwIfAborted(); calls.push({ id: model.id, runtime, context, tools }); this.modelId = model.id; },
    async unload() { calls.push('guide-unloaded'); this.modelId = null; }
  };
  studio.llama = {
    modelId: null,
    async load(model) { calls.push({ specialist: model.id }); this.modelId = model.id; },
    async unload() { calls.push('specialist-unloaded'); this.modelId = null; }
  };
  t.after(async () => { await studio.close(); await fs.rm(dir, { recursive: true, force: true }); });
  return { studio, dir, installed, downloads, calls };
}

test('response settings default to Auto, persist larger budgets, and retain validation and busy guards',async t=>{
 const {studio}=await fixture(t);assert.equal(studio.config.maxTokens,0);
 await studio.updateSettings({maxTokens:32768,context:131072});
 assert.equal((await studio.store.read('settings',{})).maxTokens,32768);assert.equal(studio.config.context,131072);
 // Cloud budgets are independent of the local context. Local engines validate
 // the actual prompt and loaded window when they receive a request.
 await studio.updateSettings({maxTokens:65536,context:4096});assert.equal(studio.config.maxTokens,65536);
 await studio.updateSettings({maxTokens:0});assert.equal((await studio.store.read('settings',{})).maxTokens,0);
 for(const settings of [{maxTokens:-1},{maxTokens:1048577},{maxTokens:1.5},{context:511},{context:1048577}])await assert.rejects(studio.updateSettings(settings),/between/);
 studio.active={job:{id:'fixture'},controller:new AbortController()};
 await assert.rejects(studio.updateSettings({maxTokens:0}),/Finish or cancel/);studio.active=null;
});

test('changing only the response budget keeps loaded models available',async t=>{
 const {studio,calls}=await fixture(t);studio.llama.modelId='fixture-loaded';
 await studio.updateSettings({maxTokens:32768});assert.equal(studio.llama.modelId,'fixture-loaded');assert.deepEqual(calls,[]);
 await studio.updateSettings({maxTokens:0});assert.equal(studio.llama.modelId,'fixture-loaded');assert.deepEqual(calls,[]);
 await studio.updateSettings({context:32768});assert.equal(studio.llama.modelId,null);assert.ok(calls.includes('specialist-unloaded'));
});

test('downloaded default becomes the configured guide and catalog distinguishes files from runtime readiness', async t => {
  const { studio, installed, downloads } = await fixture(t);
  assert.equal(studio.guideSnapshot().status, 'not-installed');
  installed.push(guide());
  downloads.push({ id: defaultOrchestratorId, catalogId: defaultOrchestratorId, status: 'completed' });
  await studio.refreshDownloadedModels();
  assert.equal(studio.config.mainAgentModelId, guide().id);
  assert.equal((await studio.store.read('settings', {})).mainAgentModelId, guide().id);
  let state = studio.snapshot();
  assert.equal(state.catalog.find(model => model.id === defaultOrchestratorId).installed, true);
  assert.equal(state.orchestrator.status, 'needs-runtime');
  assert.match(state.models.find(model => model.catalogId === defaultOrchestratorId).issue, /Install a chat engine/);
  assert.ok(state.catalog.every(model => !Object.hasOwn(model, 'files')));
  assert.ok(state.models.every(model => !Object.hasOwn(model, 'file')));
  studio.registry.runtimes.chat = { binary: '/fixture/llama-server', backend: 'metal' };
  await studio.refreshDownloadedModels(); state = studio.snapshot();
  assert.equal(state.orchestrator.status, 'ready'); assert.equal(state.models[0].available, true);
});

test('installing the default guide preserves an existing explicit main model choice', async t => {
  const { studio, installed } = await fixture(t);
  studio.config.mainAgentModelId = 'chosen-main';
  studio.registry = { models: [{ id: 'chosen-main', name: 'Chosen', kind: 'chat', available: true }], runtimes: { chat: { backend: 'cpu' } } };
  installed.push(guide()); await studio.refreshDownloadedModels();
  assert.equal(studio.config.mainAgentModelId, 'chosen-main');
  assert.equal(studio.guideSnapshot().modelId, 'chosen-main');
});

test('explicit engine repair prepares an installed selected model without downloading a replacement', async t => {
  const { studio, calls } = await fixture(t);
  studio.config.mainAgentModelId='selected-local';
  studio.registry={models:[{id:'selected-local',name:'Selected local',kind:'chat',available:false,issue:'Chat engine required'}],runtimes:{}};
  studio.rescan=async()=>{studio.registry.models[0].available=true;studio.registry.models[0].issue='';};
  await studio.setupGuide({installRuntime:true});await studio.setupPromise;
  assert.equal(studio.config.mainAgentModelId,'selected-local');
  assert.equal(studio.orchestrator.modelId,'selected-local');
  assert.equal(studio.guideSnapshot().error,undefined);
  assert.equal(calls.filter(call=>call.id==='selected-local').length,1);
});

test('a successful setup retry clears a previous model-load failure and can run in the background', async t => {
  const { studio, installed } = await fixture(t);
  installed.push(guide());studio.registry.runtimes.chat={backend:'cpu'};await studio.refreshDownloadedModels();
  studio.runtimeSetup={status:'error',error:'Prior load failure'};studio.guideState={status:'error',error:'Prior load failure'};
  const finish=deferred();let started=false;
  studio.orchestrator.load=async model=>{started=true;await finish.promise;studio.orchestrator.modelId=model.id;};
  await studio.setupGuide({background:true});
  try{
    assert.equal(studio.runtimeSetup.status,'ready');
    assert.equal(studio.runtimeSetup.error,undefined);
    assert.ok(studio.setupPromise,'setup route returns while the model loads');
  }finally{finish.resolve();await studio.setupPromise;}
  assert.equal(started,true);assert.equal(studio.guideSnapshot().status,'running');
});

test('catalog setup downloads and loads the exact larger selection before saving it as the main model', async t => {
  const {studio,installed,downloads,calls}=await fixture(t),requested=[];
  installed.push(guide());studio.registry.runtimes.chat={backend:'cpu'};await studio.refreshDownloadedModels();
  const previousId=studio.config.mainAgentModelId,target=catalogModels.find(model=>model.id==='qwen3-4b');
  studio.downloads.start=async id=>{
    requested.push(id);assert.equal(studio.config.mainAgentModelId,previousId,'download must preserve the previous choice');
    installed.push({id:'catalog:'+id,catalogId:id,name:target.name,kind:'chat',available:true,file:'/fixture/model.gguf'});
    downloads.push({catalogId:id,status:'completed'});
  };
  studio.orchestrator.load=async function(model){
    assert.equal(studio.config.mainAgentModelId,previousId,'model must start before the saved choice changes');
    calls.push({id:model.id});this.modelId=model.id;
  };
  await studio.setupGuide({catalogId:target.id});await studio.setupPromise;
  assert.deepEqual(requested,[target.id]);assert.equal(studio.orchestrator.modelId,'catalog:'+target.id);
  assert.equal(studio.config.mainAgentModelId,'catalog:'+target.id);
  assert.equal((await studio.store.read('settings',{})).mainAgentModelId,'catalog:'+target.id);
  assert.deepEqual(studio.localSetup,{catalogId:target.id,status:'ready',explicit:true});
});

test('failed catalog download or model load keeps the previous saved selection without a starter fallback', async t => {
  for(const stage of ['download','load']){
    const {studio,installed,downloads}=await fixture(t),requested=[];
    installed.push(guide());studio.registry.runtimes.chat={backend:'cpu'};await studio.refreshDownloadedModels();
    const previousId=studio.config.mainAgentModelId;
    studio.downloads.start=async id=>{
      requested.push(id);if(stage==='download')throw new Error('Fixture download failure');
      installed.push({id:'catalog:'+id,catalogId:id,name:'Selected 4B',kind:'chat',available:true,file:'/fixture/model.gguf'});
      downloads.push({catalogId:id,status:'completed'});
    };
    if(stage==='load')studio.orchestrator.load=async()=>{throw new Error('Fixture load failure');};
    await studio.setupGuide({catalogId:'qwen3-4b'});await studio.setupPromise;
    assert.deepEqual(requested,['qwen3-4b']);assert.equal(studio.config.mainAgentModelId,previousId);
    assert.equal((await studio.store.read('settings',{})).mainAgentModelId,previousId);
    assert.equal(studio.localSetup.catalogId,'qwen3-4b');assert.equal(studio.localSetup.status,'error');
    assert.match(studio.localSetup.error,/Fixture .* failure/);
  }
});

test('downloaded Chat and Code selections load the chosen model without replacing the saved Agent', async t => {
  for(const mode of ['chat','code']){
    const {studio,installed,downloads}=await fixture(t),requested=[];
    installed.push(guide());studio.registry.runtimes.chat={backend:'cpu'};await studio.refreshDownloadedModels();
    const previousId=studio.config.mainAgentModelId;studio.orchestrator.modelId=previousId;
    studio.downloads.start=async id=>{
      requested.push(id);installed.push({id:'catalog:'+id,catalogId:id,name:'Chosen 4B',kind:'chat',available:true,file:'/fixture/model.gguf'});
      downloads.push({catalogId:id,status:'completed'});
    };
    await studio.setupGuide({catalogId:'qwen3-4b',mode});await studio.setupPromise;
    assert.deepEqual(requested,['qwen3-4b']);assert.equal(studio.config.mainAgentModelId,previousId);
    assert.equal((await studio.store.read('settings',{})).mainAgentModelId,previousId);
    assert.equal(studio.orchestrator.modelId,previousId);assert.equal(studio.llama.modelId,'catalog:qwen3-4b');
    assert.deepEqual(studio.localSetup,{catalogId:'qwen3-4b',mode,status:'ready',explicit:true});
  }
});

test('catalog setup modes are validated and the same model cannot switch roles during setup', async t => {
  const {studio,installed,downloads}=await fixture(t),started=deferred(),finish=deferred();
  await assert.rejects(studio.setupGuide({catalogId:'qwen3-4b',mode:'other'}),/supported setup mode/);
  await assert.rejects(studio.setupGuide({mode:'chat'}),/supported setup mode/);
  studio.downloads.start=async id=>{
    started.resolve();await finish.promise;
    installed.push({id:'catalog:'+id,catalogId:id,name:'Chosen 4B',kind:'chat',available:true,file:'/fixture/model.gguf'});downloads.push({catalogId:id,status:'completed'});
  };
  await studio.setupGuide({catalogId:'qwen3-4b',mode:'chat'});await started.promise;
  try{await assert.rejects(studio.setupGuide({catalogId:'qwen3-4b',mode:'agent'}),/current local model setup/);}
  finally{finish.resolve();await studio.setupPromise;}
});

test('a failed explicit starter load does not auto-select its files during rescan', async t => {
  const {studio,installed,downloads}=await fixture(t);
  studio.registry.runtimes.chat={backend:'cpu'};
  studio.downloads.start=async id=>{installed.push(guide());downloads.push({catalogId:id,status:'completed'});};
  studio.orchestrator.load=async()=>{throw new Error('Fixture model load failed');};
  await studio.setupGuide({catalogId:defaultOrchestratorId});await studio.setupPromise;await studio.refreshDownloadedModels();
  assert.equal(studio.config.mainAgentModelId,'');assert.equal((await studio.store.read('settings',{})).mainAgentModelId,undefined);
  assert.equal(studio.localSetup.status,'error');
});

test('catalog setup rejects unsupported entries and concurrent changes before starting another download', async t => {
  const {studio,installed,downloads}=await fixture(t),started=deferred(),finish=deferred(),requested=[];
  for(const catalogId of ['../outside','whisper-tiny','not-a-model',42])await assert.rejects(studio.setupGuide({catalogId}),/supported chat model/);
  studio.downloads.start=async id=>{
    requested.push(id);started.resolve();await finish.promise;
    installed.push({id:'catalog:'+id,catalogId:id,name:'Chosen 4B',kind:'chat',available:true,file:'/fixture/model.gguf'});
    downloads.push({catalogId:id,status:'completed'});
  };
  await studio.setupGuide({catalogId:'qwen3-4b'});await started.promise;
  try{
    await studio.setupGuide({catalogId:'qwen3-4b'});
    await assert.rejects(studio.setupGuide({catalogId:'qwen3-8b'}),/current local model setup/);
    await assert.rejects(studio.updateSettings({mainAgentModelId:''}),/local model setup/);
    await assert.rejects(studio.enqueue({kind:'chat',prompt:'wait'}),/local model setup/);
    await assert.rejects(studio.runPipeline({pipelineId:'not-started'}),/local model setup/);
    await assert.rejects(studio.resumePipeline('not-resumed'),/local model setup/);
    assert.deepEqual(requested,['qwen3-4b']);
  }finally{finish.resolve();await studio.setupPromise;}
});

test('warming the guide uses bounded CPU settings and specialists can load and unload beside it', async t => {
  const { studio, installed, calls } = await fixture(t);
  installed.push(guide()); studio.registry.runtimes.chat = { backend: 'metal' };
  await studio.refreshDownloadedModels(); await studio.warmGuide();
  assert.equal(calls[0].runtime.backend, 'cpu'); assert.ok(calls[0].runtime.threads <= 4);
  assert.equal(calls[0].context, 4096); assert.equal(calls[0].tools, true);
  assert.equal(studio.guideSnapshot().status, 'running');
  studio.registry.models.push({ id: 'coder', kind: 'chat', name: 'Coder', available: true });
  await studio.loadModel('coder');
  assert.equal(studio.snapshot().loadedModelId, 'coder'); assert.equal(studio.orchestrator.modelId, guide().id);
  await studio.unloadModel('coder');
  assert.equal(studio.llama.modelId, null); assert.equal(studio.orchestrator.modelId, guide().id);
  await assert.rejects(studio.unloadModel(guide().id), /guide stays loaded/);
});

test('guide loads honor the configured context and a pipeline context override',async t=>{
 const {studio,installed,calls}=await fixture(t);
 installed.push(guide());studio.registry.runtimes.chat={backend:'cpu'};await studio.refreshDownloadedModels();
 studio.config.context=32768;await studio.warmGuide();assert.equal(calls.filter(call=>call.id).at(-1).context,32768);
 await studio.loadOrchestrator(guide(),studio.lifecycle.signal,()=>{},65536);assert.equal(calls.filter(call=>call.id).at(-1).context,65536);
 assert.equal(studio.orchestrator.fixedContext,false);assert.equal(studio.config.context,32768);
});

test('cancelling a request waiting for background guide warmup releases the wait promptly', async t => {
  const { studio, installed } = await fixture(t), started = deferred(), finish = deferred();
  installed.push(guide()); studio.registry.runtimes.chat = { backend: 'cpu' }; await studio.refreshDownloadedModels();
  studio.orchestrator.load = async model => { started.resolve(); await finish.promise; studio.orchestrator.modelId = model.id; };
  const warmup = studio.warmGuide();
  let timer, observed;
  try {
    await waitForStart(started, warmup);
    const controller = new AbortController();
    const waiting = studio.loadOrchestrator(studio.registry.models[0], controller.signal, () => {});
    observed = waiting.then(() => ({ completed: true }), error => ({ error }));
    controller.abort(new Error('Cancelled pending request'));
    const result = await Promise.race([observed, new Promise(resolve => { timer = setTimeout(() => resolve({ timeout: true }), 150); })]);
    assert.equal(result.timeout, undefined, 'A cancelled request must not wait for the separate warmup to complete');
    assert.match(result.error?.message || '', /Cancelled pending request/);
  } finally { clearTimeout(timer); finish.resolve(); await warmup; await observed; }
  assert.equal(studio.orchestrator.modelId, guide().id);
});

test('a guide rejected by memory admission fails the load-start wait instead of hanging the fixture', async t => {
  const { studio, installed } = await fixture(t, { budgetBytes: 0 }), started = deferred();
  installed.push(guide()); studio.registry.runtimes.chat = { backend: 'cpu' }; await studio.refreshDownloadedModels();
  let engineStarted = false;
  studio.orchestrator.load = async () => { engineStarted = true; started.resolve(); };
  const warmup = studio.warmGuide();
  await assert.rejects(waitForStart(started, warmup), /available after the safety buffer/);
  assert.equal(engineStarted, false, 'Admission rejects the request before the fake engine starts.');
  assert.equal(studio.guideLoadPromise, null);
  assert.equal(studio.guideSnapshot().status, 'error');
});

test('download completion refreshes the installed model list without resetting its guide selection', async t => {
  const { studio, installed, downloads } = await fixture(t);
  studio.registry.runtimes.chat = { backend: 'cpu' };
  installed.push(guide()); downloads.push({ id: defaultOrchestratorId, catalogId: defaultOrchestratorId, status: 'completed' });
  studio.downloadChanged(downloads); await studio.modelSync;
  assert.equal(studio.config.mainAgentModelId, guide().id);
  assert.equal(studio.registry.models.filter(model => model.catalogId === defaultOrchestratorId).length, 1);
  studio.downloadChanged(downloads); await studio.modelSync;
  assert.equal(studio.registry.models.filter(model => model.catalogId === defaultOrchestratorId).length, 1);
});

test('memory admission reserves the configured guide rather than the default guide size', async t => {
  const { studio } = await fixture(t);
  const main = { id: 'large-main', catalogId: 'qwen3-14b', name: 'Large main', kind: 'chat', available: true };
  const specialist = { id: 'specialist', catalogId: 'qwen3-8b', name: 'Specialist', kind: 'chat', available: true };
  studio.registry.models = [main, specialist]; studio.config.mainAgentModelId = main.id;
  assert.throws(() => studio.assertModelMemory(specialist), /Choose a smaller model/);
  studio.registry.models.push(guide()); studio.config.mainAgentModelId = guide().id;
  assert.doesNotThrow(() => studio.assertModelMemory(specialist));
});

test('closing waits for a cancelled manual model load to finish its cleanup', async t => {
  const { studio } = await fixture(t), started = deferred();
  studio.registry = { models: [{ id: 'coder', name: 'Coder', kind: 'chat', available: true }], runtimes: { chat: { backend: 'cpu' } } };
  studio.llama.load = async (_model, _runtime, signal) => {
    started.resolve();
    await new Promise((resolve, reject) => { signal.addEventListener('abort', () => reject(signal.reason), { once: true }); });
  };
  const loading = studio.loadModel('coder');
  const observed = loading.then(() => ({ completed: true }), error => ({ error }));
  await waitForStart(started, loading); await studio.close();
  assert.ok((await observed).error); assert.equal(studio.loadingModel, false); assert.equal(studio.manualLoadPromise, null);
});

test('setup catalog API returns all supported choices with fresh hardware memory and forwards an exact selection', async t => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'tim-setup-options-'));
  t.mock.method(Studio.prototype,'rescan',async function(){});
  const service=await startServer({port:0,dataDir:dir,autoSetup:false,telemetry:false});
  t.after(async()=>{await service.close();await fs.rm(dir,{recursive:true,force:true});});
  const memory={total:32*GiB,totalBytes:32*GiB,availableBytes:20*GiB,reserveBytes:3*GiB,modelBudgetBytes:17*GiB,sampledAt:Date.now(),stale:false,status:'ok',availableSource:'os'};
  let sampled=0,captured;
  t.mock.method(service.studio,'sampleMemory',async()=>{
    sampled++;service.studio.memoryMonitor.snapshot=()=>({memory,loadedModels:[]});
  });
  const response=await fetch(service.url+'/api/setup/options'),snapshot=await response.json();
  assert.equal(response.status,200);assert.equal(sampled,1);assert.deepEqual(snapshot.memory,memory);
  assert.deepEqual(snapshot.catalog.filter(model=>model.kind==='chat').map(model=>model.id),catalogModels.filter(model=>model.kind==='chat').map(model=>model.id));
  assert.ok(snapshot.hardware.logicalCores>0);assert.equal(typeof snapshot.hardware.cpuName,'string');
  assert.ok(snapshot.catalog.every(model=>!Object.hasOwn(model,'files')));assert.deepEqual(snapshot.downloads,[]);
  t.mock.method(service.studio,'setupGuide',async options=>{captured=options;});
  const chosen=await fetch(service.url+'/api/setup',{method:'POST',headers:{'x-tim-request':'1','content-type':'application/json'},body:JSON.stringify({catalogId:'qwen3-4b',installRuntime:true})});
  assert.equal(chosen.status,200);assert.deepEqual(captured,{catalogId:'qwen3-4b',installRuntime:true,background:true});
});

test('model API rejects unknown catalog IDs, uninstalled loads and cross-origin model mutations', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tim-setup-api-'));
  t.mock.method(Studio.prototype, 'rescan', async function () {});
  t.mock.method(Studio.prototype, 'telemetry', async function () {});
  const service = await startServer({ port: 0, dataDir: dir, autoSetup: false });
  t.after(async () => { await service.close(); await fs.rm(dir, { recursive: true, force: true }); });
  const post = (endpoint, payload, extraHeaders = {}) => fetch(service.url + endpoint, {
    method: 'POST', headers: { 'x-tim-request': '1', 'Content-Type': 'application/json', ...extraHeaders }, body: JSON.stringify(payload)
  });
  let response = await post('/api/models/download', { id: '../../outside', url: 'https://unrelated.example/model' });
  assert.equal(response.status, 400); assert.match((await response.json()).error, /Unknown model catalog ID/);
  response = await post('/api/models/load', { id: 'catalog:not-installed' });
  assert.equal(response.status, 400); assert.match((await response.json()).error, /installed chat/);
  response = await post('/api/models/download', { id: defaultOrchestratorId }, { origin: 'https://unrelated.example' });
  assert.equal(response.status, 403); assert.equal(service.studio.downloads.snapshot().length, 0);
  response = await fetch(service.url + '/api/state');
  const state = await response.json();
  assert.equal(state.catalog.length, catalogModels.length); assert.equal(state.orchestrator.status, 'not-installed');
});
