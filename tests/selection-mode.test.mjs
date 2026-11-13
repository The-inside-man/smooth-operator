import './terminal-env.mjs';
import {terminalAct} from './terminal-act.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {Writable,PassThrough} from 'node:stream';
import {render,Text} from 'ink';
import {createSelectionMode,useSelectionMode} from '../cli/selection-mode.mjs';
import {mouseDisable,mouseEnable} from '../cli/mouse.mjs';

test('selection disables only TIM mouse modes and restores them on exit or cleanup',()=>{
 const writes=[],changes=[],mode=createSelectionMode({write:value=>writes.push(value),onChange:value=>changes.push(value)});
 assert.equal(mode.enter(),true);assert.equal(mode.active,true);assert.deepEqual(writes,[mouseDisable]);
 assert.equal(mode.enter(),false);assert.equal(writes.length,1);
 assert.equal(mode.exit(),true);assert.equal(mode.active,false);assert.deepEqual(writes,[mouseDisable,mouseEnable]);assert.deepEqual(changes,[true,false]);
 mode.toggle();assert.equal(mode.active,true);mode.dispose();assert.equal(mode.active,false);assert.deepEqual(writes,[mouseDisable,mouseEnable,mouseDisable,mouseEnable]);
 mode.dispose();assert.equal(writes.length,4);assert.equal(mode.enter(),false);
});

test('--no-mouse selection still freezes the UI without enabling mouse reporting',()=>{
 const writes=[],changes=[],mode=createSelectionMode({write:value=>writes.push(value),mouseEnabled:false,onChange:value=>changes.push(value)});
 mode.enter();assert.equal(mode.active,true);mode.exit();mode.enter();mode.dispose();
 assert.deepEqual(writes,[]);assert.deepEqual(changes,[true,false,true]);
});

test('cleanup respects an updated no-mouse preference and tolerates a closed output stream',()=>{
 const writes=[];let enabled=true;
 const mode=createSelectionMode({write:value=>writes.push(value),mouseEnabled:()=>enabled});mode.enter();enabled=false;mode.dispose();assert.deepEqual(writes,[mouseDisable]);
 const closed=createSelectionMode({write:value=>{if(value===mouseEnable)throw new Error('Fixture output closed');}});closed.enter();assert.doesNotThrow(()=>closed.dispose());
 const untouched=createSelectionMode({write:()=>{throw new Error('Nothing should be emitted');}});assert.doesNotThrow(()=>untouched.dispose());
});

async function mountedHook({mouseEnabled=true,strict=false}={}){
 const writes=[],changes=[];let api;
 const controlOutput={write:value=>{writes.push(value);return true;}};
 function Fixture(){api=useSelectionMode({stdout:controlOutput,mouseEnabled,onChange:value=>changes.push(value)});return React.createElement(Text,null,api.selecting?'SELECTING':'NORMAL');}
 const stdin=new PassThrough();stdin.isTTY=true;stdin.ref=()=>stdin;stdin.unref=()=>stdin;stdin.setRawMode=()=>stdin;
 const stdout=new Writable({write(_chunk,_encoding,done){done();}});stdout.isTTY=true;stdout.columns=80;stdout.rows=16;
 let ui;await terminalAct(()=>{ui=render(strict?React.createElement(React.StrictMode,null,React.createElement(Fixture)):React.createElement(Fixture),{stdin,stdout,stderr:stdout,patchConsole:false,exitOnCtrlC:false});});
 const exited=ui.waitUntilExit();
 return {writes,changes,get api(){return api;},async act(action){await terminalAct(()=>action(api));},async close(){try{await terminalAct(()=>ui.unmount());await exited;}finally{ui.cleanup();stdin.destroy();stdout.destroy();}}};
}

test('React hook exposes a synchronous selection guard before state commits and handles quick toggles',async()=>{
 const fixture=await mountedHook();
 try{
  await fixture.act(api=>{api.enter();assert.equal(api.isSelecting(),true);});assert.equal(fixture.api.selecting,true);assert.deepEqual(fixture.writes,[mouseDisable]);
  await fixture.act(api=>{api.exit();assert.equal(api.isSelecting(),false);});assert.equal(fixture.api.selecting,false);
  await fixture.act(api=>{api.toggle();api.toggle();assert.equal(api.isSelecting(),false);});assert.equal(fixture.api.selecting,false);
  assert.deepEqual(fixture.writes,[mouseDisable,mouseEnable,mouseDisable,mouseEnable]);
 }finally{await fixture.close();}
});

test('hook unmount restores mouse reporting once, while --no-mouse and StrictMode stay safe',async()=>{
 for(const mouseEnabled of [true,false]){
  const fixture=await mountedHook({mouseEnabled,strict:true});
  await fixture.act(api=>api.enter());assert.equal(fixture.api.selecting,true);await fixture.close();
  assert.deepEqual(fixture.writes,mouseEnabled?[mouseDisable,mouseEnable]:[]);assert.equal(fixture.api.isSelecting(),false);
 }
});
