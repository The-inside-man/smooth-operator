import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {ToolRunner,makeReview,parseArguments,discoverTools} from '../cli/tool-runner.mjs';
import {packageManagers,packageReview} from '../cli/package-managers.mjs';
import {validateIntent,parseMetadata,resolveInstall,modelIntent} from '../cli/planner.mjs';
const nodeTool={id:'fixture',name:'fixture',status:'installed',executable:process.execPath};
const waitFor=async(check)=>{for(let i=0;i<100;i++){if(check())return;await new Promise(r=>setTimeout(r,10));}throw new Error('Timed out waiting for fixture');};

test('argument parsing preserves literals, quoted empty values and Windows paths',()=>{
 assert.deepEqual(parseArguments('"two words" "" C:\\work\\test ; $(whoami) | >'),['two words','','C:\\work\\test',';','$(whoami)','|','>']);
 assert.throws(()=>parseArguments('"unfinished'));assert.throws(()=>parseArguments('bad\0arg'));
});
test('discovery reports absent, platform and interactive limitations without executing',async()=>{
 const tools=await discoverTools([{id:'absent',command:'not-present',platforms:[process.platform]},{id:'other',command:'x',platforms:['never']},{id:'interactive',command:'x',platforms:[process.platform],interactive:true}],{env:{PATH:''}});
 assert.deepEqual(tools.map(t=>t.status),['not installed','platform unavailable','interactive unsupported']);
});
test('runner requires fresh confirmation, streams both channels, preserves argv and repeats',async()=>{
 const runner=new ToolRunner(),args=['-e','console.log(JSON.stringify(process.argv.slice(1)));console.error("stderr marker")','a b',';not shell','$(not-shell)'];
 const review=makeReview(nodeTool,args);await assert.rejects(runner.run(review),/confirmation/);assert.equal(runner.state.status,'idle');
 for(let i=0;i<2;i++){const result=await runner.run(review,{confirmed:true});assert.equal(result.status,'completed');assert.match(result.stdout,/a b/);assert.match(result.stdout,/;not shell/);assert.match(result.stderr,/stderr marker/);assert.equal(result.exitCode,0);}
});
test('runner cancellation, failed executable, timeout and bounded output clean up',async()=>{
 const runner=new ToolRunner();const running=runner.run(makeReview(nodeTool,['-e','console.log("ready");setInterval(()=>{},1000)']),{confirmed:true});await waitFor(()=>runner.state.output.includes('ready'));
 await assert.rejects(runner.run(makeReview(nodeTool,['--version']),{confirmed:true}),/already running/);await runner.cancel();assert.equal((await running).status,'cancelled');assert.equal(runner.child,null);
 const failed=await runner.run(makeReview({...nodeTool,executable:path.join(os.tmpdir(),'TIM-missing-executable-abc.exe')},[]),{confirmed:true});assert.equal(failed.status,'failed');assert.ok(failed.error);
 assert.equal((await runner.run(makeReview(nodeTool,['-e','setInterval(()=>{},1000)'],{timeoutMs:40}),{confirmed:true})).status,'timed out');
 const large=await runner.run(makeReview(nodeTool,['-e','process.stdout.write("x".repeat(100000))']),{confirmed:true});assert.ok(large.truncated);assert.ok(large.output.length<=65536);await runner.close();
});
test('package adapters reject flags, paths, sources, unsupported operations and absent managers',()=>{
 for(const manager of packageManagers){const tool={...manager,status:'installed',executable:process.execPath};
  for(const invalid of ['--force','-r','https://host/pkg','../file','one two','pkg;evil','$(evil)'])assert.throws(()=>packageReview(tool,'install',invalid));
  if(manager.operations.install){const review=packageReview(tool,'install','example');assert.ok(review.mutation);assert.ok(!review.args.includes('-y'));assert.ok(!review.args.includes('--yes'));}
 }
 const yarn={...packageManagers.find(m=>m.manager==='yarn'),status:'installed',executable:process.execPath};assert.throws(()=>packageReview(yarn,'install','example'),/unsupported/);
 assert.throws(()=>packageReview({...packageManagers[0],status:'not installed'},'install','example'),/installed/);
});
test('model proposals are data only; malformed, injected and incompatible requests are rejected',async()=>{
 assert.throws(()=>validateIntent({action:'install',package:'safe',manager:'npm',command:'curl x | sh'},'install'),/unsupported fields/);
 assert.throws(()=>validateIntent({action:'install',package:'--unsafe',manager:'npm'},'install'));
 assert.throws(()=>validateIntent({action:'listen',mode:'capture',protocol:'tcp',port:70000,host:'127.0.0.1'},'listen'));
 await assert.rejects(modelIntent(null,'install','a tool'),/No configured model/);
 await assert.rejects(modelIntent({request:async()=>({models:[],config:{}})},'install','a tool'),/No available/);
 const npm={...packageManagers.find(m=>m.manager==='npm'),status:'installed',executable:process.execPath};
 const read=async(_tool,args)=>args[0]==='view'?JSON.stringify({name:'example',version:'1.2.3'}):'https://registry.npmjs.org/';
 const plan=await resolveInstall({request:'example',manager:'npm',tools:[npm],read});assert.ok(plan.args.includes('example@1.2.3'));assert.ok(plan.args.includes('--registry'));assert.equal(plan.metadata.source,'https://registry.npmjs.org/');
 assert.equal((await resolveInstall({request:'a tool',tools:[npm,{...npm,manager:'pip'}],intentProvider:async()=>({action:'install',package:'example',manager:'npm'}),read})).metadata.name,'example');
 await assert.rejects(resolveInstall({request:'example',manager:'npm',tools:[],read}),/absent/);
 assert.throws(()=>parseMetadata('npm','example','{"name":"evil","version":"1.0.0"}','https://registry.npmjs.org/'));
 assert.throws(()=>parseMetadata('npm','example','{"name":"example","version":"1.0.0"}','https://user:secret@host/'));
});
test('install failure is reported without claiming success (local fixture only)',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'tim-manager-test-'));try{
  const script=path.join(directory,'manager.mjs');await fs.writeFile(script,'console.error("fixture install rejected");process.exit(19);');
  const npm={...packageManagers.find(m=>m.manager==='npm'),status:'installed',executable:process.execPath,prefixArgs:[script]};const runner=new ToolRunner();const result=await runner.run(packageReview(npm,'install','example'),{confirmed:true});assert.equal(result.status,'failed');assert.equal(result.exitCode,19);assert.match(result.stderr,/fixture install rejected/);
 }finally{await fs.rm(directory,{recursive:true,force:true});}
});

test('manager choice verifies compatible candidates and asks only for verified ambiguity',async()=>{
 const tools=['apt','brew'].map(id=>({...packageManagers.find(m=>m.manager===id),status:'installed',executable:process.execPath}));
 const intentProvider=async()=>({action:'install',package:'example',manager:'apt'});
 const discover=async()=>[{id:'apt-cache',name:'apt-cache',status:'installed',executable:process.execPath}];
 const read=async(tool,args)=>tool.manager==='brew'?JSON.stringify({formulae:[{name:'example',versions:{stable:'1.2.3'},tap:'homebrew/core'}]}):args[0]==='policy'?'Candidate: 1.2.3':'Package: example\nVersion: 1.2.3';
 await assert.rejects(resolveInstall({request:'example tool',tools,intentProvider,read,discover}),/Multiple verified/);
 const unique=await resolveInstall({request:'example tool',tools,intentProvider,discover,read:async(tool,args)=>{if(tool.manager==='brew')throw new Error('No matching candidate');return read(tool,args);}});assert.equal(unique.metadata.source,'existing configured APT repositories');
 const alternative=await resolveInstall({request:'example tool',tools:[tools[1]],intentProvider,read,discover});assert.equal(alternative.metadata.source,'homebrew/core');
});
