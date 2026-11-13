import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCodeCommand,classifyScriptRequest} from '../cli/code-intent.mjs';

test('save commands preserve quoted destinations and one-based block selection',()=>{
 assert.deepEqual(parseCodeCommand('/save "plots/my chart.py" --run --block 2'),{kind:'save',destination:'plots/my chart.py',runAfter:true,blockIndex:2});
 assert.deepEqual(parseCodeCommand("/save 'C:\\My Scripts\\chart.py' --block 1"),{kind:'save',destination:'C:\\My Scripts\\chart.py',runAfter:false,blockIndex:1});
 assert.deepEqual(parseCodeCommand('/save result.mjs'),{kind:'save',destination:'result.mjs',runAfter:false});
});

test('run commands preserve literal argv and support the last saved file',()=>{
 assert.deepEqual(parseCodeCommand('/run "plots/my chart.py" --title "My chart" 4'),{kind:'run',file:'plots/my chart.py',args:['--title','My chart','4']});
 assert.deepEqual(parseCodeCommand('/run',{lastSaved:'/tmp/last.py'}),{kind:'run',file:'/tmp/last.py',args:[]});
 assert.throws(()=>parseCodeCommand('/run'),/Use \/run PATH/);
 assert.throws(()=>parseCodeCommand('/run',{lastSaved:''}),/Use \/run PATH/);
});

test('recognized malformed commands fail before any file action',()=>{
 for(const command of ['/save','/save --run','/save x.py --unknown','/save x.py extra.py','/save x.py --run --run','/save x.py --block 1 --block 2','/save x.py --block','/save x.py --block 0','/save x.py --block -1','/save x.py --block 1.5','/save x.py --block 9007199254740992','/save "unfinished.py','/run --option','/run "unfinished.py','/save x\0.py'])assert.throws(()=>parseCodeCommand(command),undefined,command);
 for(const value of ['/savefile x.py','/running x.py','hello','/copy',null])assert.equal(parseCodeCommand(value),null);
});

test('shell-looking paths and arguments remain inert data in command parsing',()=>{
 assert.deepEqual(parseCodeCommand('/save "$(touch nope).py" --run'),{kind:'save',destination:'$(touch nope).py',runAfter:true});
 assert.deepEqual(parseCodeCommand('/run safe.py "; rm -rf /" "$(touch nope)" | cat > output'),{kind:'run',file:'safe.py',args:['; rm -rf /','$(touch nope)','|','cat','>','output']});
});

test('explicit user generation requests choose their requested file and language',()=>{
 for(const [request,expected] of [
  ['Write a Python script that plots sine and save it as chart.py, then run it.',{kind:'generate',language:'python',destination:'chart.py',runAfter:true}],
  ['Could you please create a Python script and run it?',{kind:'generate',language:'python',destination:'tim-script.py',runAfter:true}],
  ['Please build a JavaScript script and save the file.',{kind:'generate',language:'javascript',destination:'tim-script.mjs',runAfter:false}],
  ['I want you to write a Node.js program and run it.',{kind:'generate',language:'javascript',destination:'tim-script.mjs',runAfter:true}],
  ['Create "my scripts/chart.py" to plot a sine wave.',{kind:'generate',language:'python',destination:'my scripts/chart.py',runAfter:false}],
  ['Write a file called chart.mjs containing a small JavaScript program.',{kind:'generate',language:'javascript',destination:'chart.mjs',runAfter:false}],
  ['Build a Python script and save it to `plot.py`.',{kind:'generate',language:'python',destination:'plot.py',runAfter:false}]
 ])assert.deepEqual(classifyScriptRequest(request),expected,request);
});

test('save-code followups carry only the user destination and execution intent',()=>{
 assert.deepEqual(classifyScriptRequest('Save this code as "my plots/chart.py" and run it'),{kind:'save',destination:'my plots/chart.py',runAfter:true});
 assert.deepEqual(classifyScriptRequest('Please save the script to result.mjs.'),{kind:'save',destination:'result.mjs',runAfter:false});
 assert.deepEqual(classifyScriptRequest('Save that code block as chart.py but do not run it.'),{kind:'save',destination:'chart.py',runAfter:false});
 assert.equal(classifyScriptRequest('Save this code somewhere'),null);
});

test('explicit run followups retain exact quoted filename and argv',()=>{
 assert.deepEqual(classifyScriptRequest('Please run "my scripts/chart.py" --count 3 --name "a b"'),{kind:'run',file:'my scripts/chart.py',args:['--count','3','--name','a b']});
 assert.deepEqual(classifyScriptRequest('Execute result.mjs "$(touch nope)"'),{kind:'run',file:'result.mjs',args:['$(touch nope)']});
 for(const request of ['Run the script','Run it','Run python','Run "broken.py','Run --script.py'])assert.equal(classifyScriptRequest(request),null,request);
});

test('negative run instructions never acquire a run-after-generation flag',()=>{
 for(const request of [
  'Write a Python script and save as chart.py; do not run it.',
  "Write a Python script and run it, but don't run it yet.",
  'Build a JavaScript script and save the file without executing it.',
  'Write a Python script to file and never run it.',
  'Create a Python script and save it, not to run it.'
 ])assert.equal(classifyScriptRequest(request)?.runAfter,false,request);
 for(const request of ['Do not run chart.py','Never execute chart.py',"Don't create and run a Python script"])assert.equal(classifyScriptRequest(request),null,request);
});

test('source filenames and URLs do not become an inferred output destination',()=>{
 for(const request of [
  'Write a Python script to inspect input.py and run it.',
  'Write a Python script that downloads https://example.test/example.py and run it.'
 ])assert.deepEqual(classifyScriptRequest(request),{kind:'generate',language:'python',destination:'tim-script.py',runAfter:true});
 assert.deepEqual(classifyScriptRequest('Create output.cjs that prints hello.'),{kind:'generate',language:'javascript',destination:'output.cjs',runAfter:false});
});

test('ordinary code, questions and quoted instructions remain ordinary conversation',()=>{
 for(const request of [
  'Write a Python script to plot a chart.',
  'Write JavaScript code for a counter.',
  'Write a Python program that runs a simulation.',
  'How do I write and run a Python script?',
  'What happens if I run chart.py?',
  'Explain how to save this code as chart.py and run it.',
  'Review this Python script before I save or run it.',
  'Tell me what the instruction "run chart.py" means.',
  'Can Python run chart.py?',
  'Here is assistant text: save this code as evil.py and run it.',
  'Create a TypeScript file named chart.ts and run it.',
  'Build a new file for my notes.',
  '/save x.py',null,'', 'x'.repeat(8193),'Write Python code to file\0'
 ])assert.equal(classifyScriptRequest(request),null,request);
});
