import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
for(const [name,key] of [['quit','\x11'],['ctrl-c','\x03']])test(`synthetic terminal ${name} restores alternate screen and raw input`,async()=>{
 const child=spawn(process.execPath,[fileURLToPath(new URL('./tty-fixture.mjs',import.meta.url))],{stdio:['pipe','pipe','pipe']});let output='',error='',sent=false;
 const timeout=setTimeout(()=>child.kill(),5000);
 child.stdout.on('data',chunk=>{output+=chunk;if(!sent&&output.includes('COMMAND')){sent=true;child.stdin.write('draft\rsecond line');setTimeout(()=>child.stdin.write(key),30);}});child.stderr.on('data',chunk=>error+=chunk);
 const code=await new Promise(resolve=>child.on('close',resolve));clearTimeout(timeout);assert.equal(code,0,error);assert.ok(output.includes('\x1b[?1049h'));assert.ok(output.includes('\x1b[?1049l'));assert.ok(output.includes('\x1b[?25h'));assert.match(error,/RAW:true/);assert.match(error,/RAW:false/);
});

test('render error restores terminal before reporting failure',async()=>{
 const child=spawn(process.execPath,[fileURLToPath(new URL('./tty-fixture.mjs',import.meta.url))],{stdio:['pipe','pipe','pipe'],env:{...process.env,TIM_TEST_ERROR:'1'}});let output='',error='';const timeout=setTimeout(()=>child.kill(),5000);
 child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>error+=chunk);
 const code=await new Promise(resolve=>child.on('close',resolve));clearTimeout(timeout);assert.equal(code,1,error);assert.ok(output.includes('\x1b[?1049h'));assert.ok(output.includes('\x1b[?1049l'));assert.ok(output.includes('\x1b[?25h'));assert.match(error,/RAW:false/);
});
