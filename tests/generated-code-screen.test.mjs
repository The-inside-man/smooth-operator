import './terminal-env.mjs';
import {terminalAct} from './terminal-act.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {PassThrough,Writable} from 'node:stream';
import {setTimeout as delay} from 'node:timers/promises';
import {render} from 'ink';
import stringWidth from 'string-width';
import {GeneratedCodeScreen} from '../cli/generated-code-screen.mjs';
import {discoverTools,ToolRunner} from '../cli/tool-runner.mjs';
import {clean} from '../cli/core.mjs';
import {mouseDisable,mouseEnable} from '../cli/mouse.mjs';

const message=(source='print("SCREEN_FIXTURE 界🙂")\n',language='python')=>({role:'assistant',status:'completed',content:'```'+language+'\n'+source+'```'});
const absent=async file=>assert.rejects(fs.stat(file),{code:'ENOENT'});
const waitFor=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await delay(10);}throw new Error('Screen fixture did not become ready.');};
async function temporary(t){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'tim-code-screen-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));return fs.realpath(directory);}
async function mount(t,{request,size={w:100,h:34},onSaved=()=>{},mouseReporting=true}){
 let output='',back=0,quit=0;const saved=[];
 const stdin=new PassThrough();stdin.isTTY=true;stdin.ref=()=>stdin;stdin.unref=()=>stdin;stdin.setRawMode=()=>stdin;
 const stdout=new Writable({write(chunk,_encoding,done){output+=chunk;done();}});stdout.isTTY=true;stdout.columns=size.w;stdout.rows=size.h;
 let ui;await terminalAct(()=>{ui=render(React.createElement(GeneratedCodeScreen,{size,request,mouseReporting,onSaved:value=>{saved.push(value);onSaved(value);},onBack:()=>{back++;},onQuit:()=>{quit++;}}),{stdin,stdout,stderr:stdout,exitOnCtrlC:false,patchConsole:false});});
 const exited=ui.waitUntilExit();
 const frame=()=>{const value=clean(output);return value.slice(Math.max(0,value.lastIndexOf('TIM / CODE')));};
 const key=async value=>{await terminalAct(()=>stdin.write(value));await delay(35);return frame();};
 t.after(async()=>{await terminalAct(()=>ui.unmount());await exited;ui.cleanup();stdin.destroy();stdout.destroy();});
 await waitFor(()=>/CODE \/ (REVIEW|ERROR)/.test(frame()));
 return {key,saved,get frame(){return frame();},get raw(){return output;},get back(){return back;},get quit(){return quit;}};
}

test('reviewing, Enter, pasted confirmation bytes and Escape do not save or run code',async t=>{
 const directory=await temporary(t),file=path.join(directory,'cancel.py');let runs=0;
 t.mock.method(ToolRunner.prototype,'run',async()=>{runs++;});
 const app=await mount(t,{request:{kind:'save',message:message(),destination:file,cwd:directory}});
 assert.match(app.frame,/REVIEW/);await absent(file);await app.key('\r');await absent(file);
 await app.key('\x1b[200~');await app.key('\x13');await app.key('\x1b[201~');await absent(file);
 await app.key('\x1b');assert.equal(app.back,1);assert.equal(runs,0);assert.equal(app.saved.length,0);await absent(file);
});

test('save-only confirmation creates the displayed source once without launching',async t=>{
 const directory=await temporary(t),file=path.join(directory,'saved.py');let runs=0;t.mock.method(ToolRunner.prototype,'run',async()=>{runs++;});
 const app=await mount(t,{request:{kind:'save',message:message(),destination:'saved.py',cwd:directory}});
 assert.match(app.frame,/saved\.py/);assert.match(app.frame,/SHA-256/);assert.match(app.frame,/SCREEN_FIXTURE 界🙂/);await absent(file);
 await app.key('\x13');await waitFor(()=>/CODE \/ SAVED/.test(app.frame));await app.key('\x13');
 assert.equal(await fs.readFile(file,'utf8'),'print("SCREEN_FIXTURE 界🙂")\n');assert.equal(app.saved.length,1);assert.equal(app.saved[0].file,file);assert.equal(runs,0);assert.match(app.frame,/No code was run/);
});

test('one save-and-run approval shows exact execution details and actually runs harmless Python',async t=>{
 const [python]=await discoverTools([{id:'python',name:'Python 3',command:'python3',platforms:[process.platform]}]);if(python.status!=='installed'){t.skip('Python 3 is unavailable.');return;}
 const directory=await temporary(t),file=path.join(directory,'run.py');
 const app=await mount(t,{request:{kind:'save',message:message('import sys\nprint("SCREEN_PYTHON", sys.argv[1:])\n'),destination:file,cwd:directory,runAfter:true,args:['a b','; literal']}});
 assert.match(app.frame,/SAVE PYTHON AND RUN/);assert.match(app.frame,/Executable:/);assert.match(app.frame,/Arguments:.*-u/);assert.match(app.frame,/Working directory:/);assert.match(app.frame,/Timeout: 300s/);await absent(file);
 await app.key('\x13');await waitFor(()=>/RUN \/ COMPLETED/.test(app.frame));assert.equal(app.saved.length,1);assert.match(app.frame,/SCREEN_PYTHON/);assert.match(app.frame,/a b/);assert.match(app.frame,/; literal/);assert.match(app.frame,/exit 0/);
});

test('standalone run refuses changed source after review before starting a process',async t=>{
 const directory=await temporary(t),file=path.join(directory,'changed.mjs');await fs.writeFile(file,'console.log("REVIEWED_SOURCE");\n');let runs=0;t.mock.method(ToolRunner.prototype,'run',async()=>{runs++;});
 const app=await mount(t,{request:{kind:'run',file,cwd:directory}});assert.match(app.frame,/REVIEWED_SOURCE/);
 await fs.writeFile(file,'console.log("CHANGED_SOURCE");\n');await app.key('\x13');await waitFor(()=>/CODE \/ ERROR/.test(app.frame));
 assert.match(app.frame,/changed since review/);assert.equal(runs,0);assert.equal(app.saved.length,0);
});

test('source review pages Unicode text within an 80 by 16 terminal and never writes while scrolling',async t=>{
 const directory=await temporary(t),file=path.join(directory,'unicode.py'),source=Array.from({length:35},(_,i)=>'# SOURCE_'+i+' 界🙂 '+('long '.repeat(20))).join('\n')+'\nprint("END_OF_SOURCE")\n';
 const app=await mount(t,{size:{w:80,h:16},request:{kind:'save',message:message(source),destination:file,cwd:directory}});
 const initial=app.frame;await app.key('\x0e');assert.notEqual(app.frame,initial);await app.key('\x0c');assert.match(app.frame,/END_OF_SOURCE/);
 for(const line of app.frame.trimEnd().split('\n'))assert.ok(stringWidth(line)<=80,`line exceeded terminal width: ${line}`);
 await absent(file);assert.equal(app.saved.length,0);await app.key('\x1b');assert.equal(app.back,1);
});

test('Escape cancels only the script process and a later quit closes ownership',async t=>{
 const directory=await temporary(t),file=path.join(directory,'cancel.mjs');await fs.writeFile(file,'console.log("SCREEN_RUNNING");setInterval(()=>{},1000);\n');
 const app=await mount(t,{request:{kind:'run',file,cwd:directory}});await app.key('\x13');await waitFor(()=>/\[stdout\] SCREEN_RUNNING/.test(app.frame));
 await app.key('\x1b');await waitFor(()=>/RUN \/ CANCELLED/.test(app.frame));assert.match(app.frame,/SCREEN_RUNNING/);await app.key('\x11');await waitFor(()=>app.quit===1);
});

test('F2 supports native source selection, blocks save, and no-mouse mode never enables reports',async t=>{
 const directory=await temporary(t),file=path.join(directory,'selected.py');
 const app=await mount(t,{request:{kind:'save',message:message(),destination:file,cwd:directory},mouseReporting:false});
 await app.key('\x1bOQ');assert.match(app.frame,/SELECT TEXT/);assert.match(app.frame,/Cmd\+C on Mac/);
 const frozen=app.raw;await app.key('\x13');await app.key('ignored typing');await delay(300);assert.equal(app.raw,frozen);await absent(file);
 await app.key('\x1b');assert.equal(app.back,0);assert.doesNotMatch(app.frame,/SELECT TEXT/);assert.ok(!app.raw.includes(mouseDisable));assert.ok(!app.raw.includes(mouseEnable));
 await app.key('\x13');await waitFor(()=>/CODE \/ SAVED/.test(app.frame));assert.equal(app.saved.length,1);
});

test('native output selection freezes runner output and clock until Escape resumes completed output',async t=>{
 const directory=await temporary(t),file=path.join(directory,'selection.mjs');
 await fs.writeFile(file,'console.log("SELECTION_START");setTimeout(()=>console.log("SELECTION_LATER"),250);setTimeout(()=>process.exit(0),500);\n');
 const app=await mount(t,{request:{kind:'run',file,cwd:directory}});await app.key('\x13');await waitFor(()=>/\[stdout\] SELECTION_START/.test(app.frame));
 await app.key('\x1bOQ');assert.match(app.frame,/SELECT TEXT/);assert.equal(app.raw.split(mouseDisable).length-1,1);
 const frozen=app.raw;await delay(650);assert.equal(app.raw,frozen,'stdout, completion and the UI clock cannot repaint selected text');
 await app.key('\x1b');await waitFor(()=>/RUN \/ COMPLETED/.test(app.frame));assert.equal(app.back,0);assert.match(app.frame,/SELECTION_LATER/);assert.equal(app.raw.split(mouseEnable).length-1,1);
});
