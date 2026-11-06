import './terminal-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {PassThrough,Writable} from 'node:stream';
import {setTimeout as delay} from 'node:timers/promises';
import {render,renderToString} from 'ink';
import {cloudProviders,normalizeProvider,providerGuide,providerKeyCommands,providerOverview} from '../cli/provider-help.mjs';
import {ProviderScreen} from '../cli/provider-screen.mjs';
import {clean} from '../cli/core.mjs';
import {cellWidth} from '../cli/layout.mjs';

test('provider guides cover real account setup, private keys and discovered model IDs for all three services',()=>{
 assert.deepEqual(cloudProviders.map(entry=>entry.id),['openai','xai','anthropic']);
 for(const entry of cloudProviders){
  const guide=providerGuide(entry.id);
  assert.ok(guide.includes(entry.keyUrl));assert.ok(guide.includes(entry.docsUrl));assert.ok(guide.includes(entry.keyEnv));
  assert.ok(guide.includes(`tim models --provider ${entry.id}`));assert.ok(guide.includes(`tim --provider ${entry.id} --model MODEL_ID`));
  assert.match(guide,/does not automatically sign TIM in/);assert.match(guide,/billing\/credits/);assert.match(guide,/Input is hidden/);
  assert.match(guide,/backend's terminal before starting it/);assert.match(guide,/A listed model is not a guarantee/);assert.match(guide,/subscription benefits vary/);
  assert.doesNotMatch(guide,/--model (?:gpt|grok|claude)-/,'model availability must come from the user account');
 }
 assert.match(providerGuide('anthropic'),/key scoped to the workspace/);
 assert.match(providerOverview(),/tim providers anthropic/);assert.match(providerOverview(),/\/providers/);
});

test('brand aliases resolve to canonical API providers and unknown names fail clearly',()=>{
 assert.equal(normalizeProvider('ChatGPT'),'openai');assert.equal(normalizeProvider(' Grok '),'xai');assert.equal(normalizeProvider('Claude'),'anthropic');
 assert.equal(providerGuide('Claude'),providerGuide('anthropic'));
 assert.throws(()=>providerGuide('unrecognized'),/Choose openai.*xai.*anthropic/);
 assert.throws(()=>providerGuide('constructor'),/Choose openai.*xai.*anthropic/);
 assert.throws(()=>providerGuide('__proto__'),/Choose openai.*xai.*anthropic/);
 assert.throws(()=>providerGuide('openai',{shell:'unknown'}),/shell zsh, bash, or powershell/);
});

test('shell guidance reads the secret privately instead of embedding it into a saved command',()=>{
 for(const entry of cloudProviders){
  const zsh=providerKeyCommands(entry.id,{shell:'zsh'}),bash=providerKeyCommands(entry.id,{shell:'/bin/bash'}),powershell=providerKeyCommands(entry.id,{shell:'pwsh'});
  assert.ok(zsh.includes(`read -r -s '${entry.keyEnv}?`));assert.ok(zsh.includes(`export ${entry.keyEnv}`));
  assert.match(bash,/read -r -s -p /);assert.ok(bash.includes(` ${entry.keyEnv}\n`));
  assert.match(powershell,/Read-Host .* -AsSecureString/);assert.ok(powershell.includes(`$env:${entry.keyEnv} = $timApiCredential.Password`));
  assert.match(powershell,/Remove-Variable timApiKey, timApiCredential/);
  assert.ok(powershell.split('\n').every(line=>line.length+3<=74),'PowerShell instructions fit the minimum guide width');
  assert.doesNotMatch(zsh+bash+powershell,/your[-_]api[-_]key|sk-ant-|sk-proj-/);
 }
});

test('provider setup screen fits minimum and large viewports for every provider',()=>{
 for(const size of [{w:80,h:16},{w:160,h:52}])for(const entry of cloudProviders){
  const output=clean(renderToString(React.createElement(ProviderScreen,{size,initialProvider:entry.id,staticPreview:true}),{columns:size.w})),lines=output.split('\n');
  assert.ok(lines.length<=size.h,`${entry.id} ${size.w}x${size.h}: ${lines.length} rows`);
  assert.ok(lines.every(line=>cellWidth(line)<=size.w),`${entry.id} ${size.w}x${size.h}: overflowing line`);
  assert.match(output,/TIM \/ CLOUD PROVIDERS/);assert.match(output,/Tab\/Left\/Right provider/);assert.match(output,/Up\/Down lines/);assert.match(output,/Ctrl\+P\/N page/);assert.match(output,/Ctrl\+L bottom/);
  assert.ok(output.includes(`tim providers ${entry.id}`));assert.match(output,/Create an API key/);
 }
});

test('minimum-size guide scrolls through all setup steps and provider selection never connects or saves keys',async t=>{
 const network=t.mock.method(globalThis,'fetch',async()=>{throw new Error('Provider guides must not connect');});
 const stdin=new PassThrough();stdin.isTTY=true;stdin.ref=()=>stdin;stdin.unref=()=>stdin;stdin.setRawMode=()=>stdin;
 let output='',backs=0,quits=0;
 const stdout=new Writable({write(chunk,_encoding,done){output+=chunk;done();}});stdout.isTTY=true;stdout.columns=80;stdout.rows=16;
 const ui=render(React.createElement(ProviderScreen,{size:{w:80,h:16},onBack:()=>{backs++;},onQuit:()=>{quits++;}}),{stdin,stdout,stderr:stdout,exitOnCtrlC:false,patchConsole:false});
 const exited=ui.waitUntilExit();
 const key=async value=>{const offset=output.length;stdin.write(value);await delay(90);return clean(output.slice(offset));};
 try{
  await delay(90);
  const wheelDown=await key('\x1b[<65;10;8M');assert.match(wheelDown,/Guide lines 4-11/);assert.match(wheelDown,/tim providers openai/);
  assert.match(await key('\x1b[<64;10;8M'),/Guide lines 1-8/);
  await key('\x1b[<64;10;8M');const current=clean(output);assert.match(current.slice(current.lastIndexOf('TIM / CLOUD PROVIDERS')),/Guide lines 1-8/);assert.equal(network.mock.callCount(),0);
  const burst=await key('\x1b[<65;10;8M'.repeat(3));assert.match(burst,/Guide lines 10-17/);assert.match(burst,/tim providers openai/);
  assert.match(await key('\x1b[<64;10;8M'.repeat(3)),/Guide lines 1-8/);assert.equal(network.mock.callCount(),0);
  assert.match(await key('\x0e'),/Guide lines 9-16/);assert.match(await key('\x10'),/Guide lines 1-8/);
  assert.match(await key('\x1b[1;3B'),/Guide lines 9-16/);assert.match(await key('\x1b[1;3A'),/Guide lines 1-8/);
  assert.match(await key('\x0c'),/Remove key from this terminal/);assert.equal(network.mock.callCount(),0);
  for(let i=0;i<12;i++)await key('\x10');
  let pages=clean(output);
  for(let i=0;i<12;i++)pages+=await key('\x1b[6~');
  assert.match(pages,/tim models --provider openai/);assert.match(pages,/tim --provider openai --model MODEL_ID/);assert.match(pages,/Remove key from this terminal/);
  const xai=await key('\t');assert.match(xai,/GROK \/ XAI SETUP/);assert.match(xai,/Guide lines 1-/);
  const anthropic=await key('\x1b[C');assert.match(anthropic,/CLAUDE \/ ANTHROPIC SETUP/);
  const backToXai=await key('\x1b[D');assert.match(backToXai,/GROK \/ XAI SETUP/);
  await key('a pretend key pasted into the guide');assert.doesNotMatch(clean(output),/a pretend key pasted/);
  await key('\x1b');assert.equal(backs,1);await key('\x11');assert.equal(quits,1);assert.equal(network.mock.callCount(),0);
 }finally{ui.unmount();await exited;ui.cleanup();stdin.destroy();stdout.destroy();}
});
