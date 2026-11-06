import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
for(const deny of [true,false])test('launcher synthetic TTY '+(deny?'declines without executing':'confirms, streams, cancels and reviews repeat'),async()=>{
 const child=spawn(process.execPath,[fileURLToPath(new URL('./tool-ui-fixture.mjs',import.meta.url))],{stdio:['pipe','pipe','pipe']});let out='',err='',stage=0;const timeout=setTimeout(()=>child.kill(),20000);
 const input=value=>setTimeout(()=>{if(child.exitCode===null)child.stdin.write(value);},50);
 // Render output can arrive before Ink commits its fresh input-handler closure.
 child.stderr.on('data',c=>err+=c);child.stdout.on('data',c=>{
  out+=c;
  if(stage===0&&out.includes('REVIEW / FIXTURE')){stage=1;input(deny?'\x1b':'\x13');}
  else if(!deny&&stage===1&&out.includes('[stdout] FIXTURE_RUNNING')){stage=2;input('\x1b');}
  else if(!deny&&stage===2&&out.includes('CANCELLED')){stage=3;input('\r');}
  else if(!deny&&stage===3&&String(c).includes('REVIEW / FIXTURE')){stage=4;input('\x1b');}
 });
 const code=await new Promise(r=>child.on('close',r));clearTimeout(timeout);assert.equal(code,0,err+'\n'+out.slice(-1800));assert.equal(stage,deny?1:4);assert.ok(err.includes('RAW:false'));if(deny)assert.ok(!out.includes('[stdout] FIXTURE_RUNNING'));
});
