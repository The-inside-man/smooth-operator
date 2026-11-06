import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

test('synthetic terminals emit live Ink frames when launched from either CI environment',()=>{
 const code=`
  import './tests/terminal-env.mjs';
  import assert from 'node:assert/strict';
  import React from 'react';
  import {render,Text} from 'ink';
  import isInCi from 'is-in-ci';
  import {PassThrough,Writable} from 'node:stream';
  import {setTimeout as delay} from 'node:timers/promises';
  assert.equal(isInCi,false,'CI must be cleared before Ink is imported');
  const stdin=new PassThrough();stdin.isTTY=true;stdin.ref=()=>stdin;stdin.unref=()=>stdin;stdin.setRawMode=()=>stdin;
  let output='';const stdout=new Writable({write(chunk,_encoding,done){output+=chunk;done();}});
  stdout.isTTY=true;stdout.columns=80;stdout.rows=24;
  const ui=render(React.createElement(Text,null,'LIVE_TERMINAL_OK'),{stdin,stdout,stderr:stdout,exitOnCtrlC:false,patchConsole:false});
  const exited=ui.waitUntilExit();
  try{
   for(let i=0;i<100&&!output.includes('LIVE_TERMINAL_OK');i++)await delay(10);
   assert.ok(output.includes('LIVE_TERMINAL_OK'),'the frame must be visible before unmount');
  }finally{
   try{ui.unmount();await exited;}finally{ui.cleanup();stdin.destroy();stdout.destroy();}
  }
  console.log('LIVE_TERMINAL_OK');
 `;
 for(const flags of [{CI:'true',CONTINUOUS_INTEGRATION:'false'},{CI:'false',CONTINUOUS_INTEGRATION:'true'},{CI:'true',CONTINUOUS_INTEGRATION:'true'}]){
  const child=spawnSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8',timeout:5000,env:{...process.env,...flags}});
  assert.equal(child.status,0,child.stderr||child.error?.message);
  assert.match(child.stdout,/LIVE_TERMINAL_OK/);
 }
});
