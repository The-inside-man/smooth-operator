import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {ToolRunner,discoverTools} from '../cli/tool-runner.mjs';
import {extractGeneratedCode,reviewGeneratedSave,saveGeneratedCode,reviewGeneratedRun,reviewGeneratedRunFromSave,verifyGeneratedRun,runGeneratedCode,GENERATED_CODE_MAX_BYTES} from '../cli/generated-code.mjs';

const response=(source='print("HELLO GENERATED 界")\n',language='python')=>({role:'assistant',status:'completed',content:'Generated example:\n```'+language+'\n'+source+'```\n'});
async function temporary(t){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'tim-generated-test-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));return fs.realpath(directory);}
const absent=async file=>assert.rejects(fs.stat(file),{code:'ENOENT'});
const waitFor=async predicate=>{for(let i=0;i<150;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('Fixture did not become ready.');};
async function python(t){
 const [tool]=await discoverTools([{id:'python',name:'Python 3',command:'python3',platforms:[process.platform]}]);
 if(tool.status!=='installed'){t.skip('Python 3 is not installed in this test environment.');return null;}
 return tool;
}

test('extracts complete supported fenced code, preserves Unicode/source bytes and refuses incomplete replies',()=>{
 const source='print("界🙂")\r\n';const code=extractGeneratedCode(response(source,'PyThOn3'));
 assert.equal(code.language,'python');assert.equal(code.source,source);assert.equal(code.bytes,Buffer.byteLength(source));assert.match(code.sourceHash,/^[a-f0-9]{64}$/);
 for(const message of [{...response(),role:'user'},{...response(),status:'running'},{...response(),status:'failed'}])assert.throws(()=>extractGeneratedCode(message),/completed assistant/);
 assert.throws(()=>extractGeneratedCode({...response(),content:'```python\nprint(1)'}),/unfinished/);
 assert.throws(()=>extractGeneratedCode(response('hello\n','text')),/No complete/);
 assert.throws(()=>extractGeneratedCode(response('print("bad\x1b[2J")\n')),/control/);
 assert.throws(()=>extractGeneratedCode(response('print("bad\x9b2J")\n')),/control/);
 assert.throws(()=>extractGeneratedCode(response('print("\ud800")\n')),/UTF-8/);
});

test('multiple runnable blocks require an explicit 1-based choice and source selection stays exact',()=>{
 const message={...response(),content:'```json\n{}\n```\n```python\nprint("first")\n```\n~~~javascript\nconsole.log("second");\n~~~'};
 assert.throws(()=>extractGeneratedCode(message),/2 runnable.*--block/);
 assert.equal(extractGeneratedCode(message,{blockIndex:1}).source,'print("first")\n');
 assert.equal(extractGeneratedCode(message,{blockIndex:2}).source,'console.log("second");\n');
 for(const blockIndex of [0,-1,3,1.5,'2'])assert.throws(()=>extractGeneratedCode(message,{blockIndex}),/block number/);
});

test('save review is read-only; only explicit confirmation exclusively creates the exact reviewed source',async t=>{
 const directory=await temporary(t),file=path.join(directory,'hello.py'),message=response();
 const review=await reviewGeneratedSave(message,'hello.py',{cwd:directory});
 assert.equal(review.destination,file);assert.ok(Object.isFrozen(review));await absent(file);
 await assert.rejects(saveGeneratedCode(review),/confirmation/);await absent(file);
 const result=await saveGeneratedCode(review,{confirmed:true});assert.equal(result.file,file);assert.equal(await fs.readFile(file,'utf8'),extractGeneratedCode(message).source);
 await assert.rejects(saveGeneratedCode(review,{confirmed:true}),/already exists/);assert.equal(await fs.readFile(file,'utf8'),extractGeneratedCode(message).source);
 await assert.rejects(reviewGeneratedSave(message,'hello.py',{cwd:directory}),/already exists/);
});

test('source hashes and a destination created after review prevent unreviewed writes or overwrites',async t=>{
 const directory=await temporary(t),review=await reviewGeneratedSave(response(),'race.py',{cwd:directory});
 await assert.rejects(saveGeneratedCode({...review,source:'print("changed")\n'},{confirmed:true}),/changed since review/);await absent(review.destination);
 await fs.writeFile(review.destination,'KEEP EXISTING\n');
 await assert.rejects(saveGeneratedCode(review,{confirmed:true}),/already exists/);assert.equal(await fs.readFile(review.destination,'utf8'),'KEEP EXISTING\n');
 await assert.rejects(reviewGeneratedSave(response(),'wrong.js',{cwd:directory}),/Python block needs/);
 await assert.rejects(reviewGeneratedSave(response(),'new-folder/test.py',{cwd:directory}),/folder does not exist/);
});

test('relative paths cannot escape cwd, explicit absolute paths work, and script symlinks are refused',async t=>{
 const directory=await temporary(t),outside=await temporary(t);
 await assert.rejects(reviewGeneratedSave(response(),'../outside.py',{cwd:directory}),/must stay inside/);
 const absolute=await reviewGeneratedSave(response(),path.join(outside,'explicit.py'),{cwd:directory});assert.equal(absolute.destination,path.join(outside,'explicit.py'));
 if(process.platform==='win32')return;
 await fs.symlink(outside,path.join(directory,'link'),'dir');await assert.rejects(reviewGeneratedSave(response(),'link/escape.py',{cwd:directory}),/must stay inside/);
 await fs.writeFile(path.join(directory,'real.py'),'print(1)\n');await fs.symlink(path.join(directory,'real.py'),path.join(directory,'alias.py'));
 await assert.rejects(reviewGeneratedSave(response(),'alias.py',{cwd:directory}),/symlinks/);await assert.rejects(reviewGeneratedRun('alias.py',{cwd:directory}),/symlinks/);
});

test('existing script review refuses binary, invalid UTF-8, oversized source, and invalid argv',async t=>{
 const directory=await temporary(t);
 for(const [name,value] of [['binary.py',Buffer.from([0,1,2])],['invalid.py',Buffer.from([0xc3,0x28])],['large.py',Buffer.alloc(GENERATED_CODE_MAX_BYTES+1,32)]]){
  await fs.writeFile(path.join(directory,name),value);await assert.rejects(reviewGeneratedRun(name,{cwd:directory}),/UTF-8|binary|1 MiB/);
 }
 await fs.writeFile(path.join(directory,'valid.mjs'),'console.log("okay");\n');
 await assert.rejects(reviewGeneratedRun('valid.mjs',{cwd:directory,args:'bad'}),/literal argument array/);
 await assert.rejects(reviewGeneratedRun('valid.mjs',{cwd:directory,args:['bad\0value']}),/Invalid argument/);
});

test('save-and-run planning exposes exact interpreter/argv/cwd before the file exists without installing or launching',async t=>{
 const directory=await temporary(t),save=await reviewGeneratedSave(response(),'planned.py',{cwd:directory});let discoveries=0;
 const run=await reviewGeneratedRunFromSave(save,{args:['a b','; literal'],discover:async()=>{discoveries++;return [{id:'python',name:'Python 3',status:'installed',executable:process.execPath}];}});
 assert.equal(discoveries,1);assert.equal(run.executable,process.execPath);assert.deepEqual(run.args,['-u',save.destination,'a b','; literal']);assert.equal(run.cwd,directory);assert.equal(run.timeoutMs,300000);assert.equal(run.generatedCode.source,save.source);assert.ok(Object.isFrozen(run.generatedCode));await absent(save.destination);
 await assert.rejects(reviewGeneratedRunFromSave(save,{discover:async()=>[]}),/Python 3 was not found/);await absent(save.destination);
});

test('changed source or replacement symlink is rejected before any process launches',async t=>{
 const directory=await temporary(t),file=path.join(directory,'changed.mjs');await fs.writeFile(file,'console.log("reviewed");\n');
 const review=await reviewGeneratedRun(file,{cwd:directory});let launches=0;const runner={run:async()=>{launches++;},cancel:()=>{}};
 await fs.writeFile(file,'console.log("unreviewed");\n');await assert.rejects(runGeneratedCode(review,{confirmed:true,runner}),/changed since review/);assert.equal(launches,0);
 if(process.platform!=='win32'){
  await fs.unlink(file);await fs.writeFile(path.join(directory,'replacement.mjs'),review.generatedCode.source);await fs.symlink(path.join(directory,'replacement.mjs'),file);
  await assert.rejects(verifyGeneratedRun(review),/symlinks/);
 }
});

test('harmless Python source actually saves and runs with literal arguments, stdout and exit status',async t=>{
 if(!await python(t))return;
 const directory=await temporary(t),source='import json, sys\nprint("PYTHON_FIXTURE 界", json.dumps(sys.argv[1:], ensure_ascii=False))\n',save=await reviewGeneratedSave(response(source),'actual.py',{cwd:directory});
 const review=await reviewGeneratedRunFromSave(save,{args:['a b','$(not-shell)',';literal']});await saveGeneratedCode(save,{confirmed:true});
 await assert.rejects(runGeneratedCode(review),/confirmation/);
 const result=await runGeneratedCode(review,{confirmed:true});assert.equal(result.status,'completed');assert.equal(result.exitCode,0);assert.match(result.stdout,/PYTHON_FIXTURE 界/);assert.match(result.stdout,/\$\(not-shell\)/);assert.match(result.stdout,/;literal/);
 assert.equal(await fs.readFile(save.destination,'utf8'),source);
});

test('running generated Python can be cancelled, and an already aborted run never launches',async t=>{
 if(!await python(t))return;
 const directory=await temporary(t),save=await reviewGeneratedSave(response('import time\nprint("READY_FOR_CANCEL", flush=True)\ntime.sleep(20)\n'),'cancel.py',{cwd:directory});await saveGeneratedCode(save,{confirmed:true});
 const review=await reviewGeneratedRun(save.destination,{cwd:directory}),runner=new ToolRunner();t.after(()=>runner.close());
 const controller=new AbortController(),pending=runGeneratedCode(review,{confirmed:true,runner,signal:controller.signal});
 await waitFor(()=>runner.state.stdout?.includes('READY_FOR_CANCEL'));controller.abort();const result=await pending;assert.equal(result.status,'cancelled');assert.equal(runner.child,null);
 const aborted=new AbortController();aborted.abort();let launches=0;
 await assert.rejects(runGeneratedCode(review,{confirmed:true,runner:{run:async()=>{launches++;}},signal:aborted.signal}),/abort/i);assert.equal(launches,0);
});

test('JavaScript uses the current Node executable and surfaces a real nonzero exit',async t=>{
 const directory=await temporary(t),save=await reviewGeneratedSave(response('console.log("NODE_FIXTURE");\nprocess.exit(19);\n','javascript'),'example.mjs',{cwd:directory});await saveGeneratedCode(save,{confirmed:true});
 const review=await reviewGeneratedRun(save.destination,{cwd:directory});assert.equal(review.executable,process.execPath);
 const result=await runGeneratedCode(review,{confirmed:true});assert.equal(result.status,'failed');assert.equal(result.exitCode,19);assert.match(result.stdout,/NODE_FIXTURE/);
});
