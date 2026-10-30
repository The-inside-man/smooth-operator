#!/usr/bin/env node
import React from 'react';
import {render} from 'ink';
import path from 'node:path';
import {App,help} from './app.mjs';
import {Client,demoState,clean} from './core.mjs';
import {closeOwnedTools} from './tool-runner.mjs';
import {ownBackend} from './backend.mjs';
const args=process.argv.slice(2);
const usage=`TIM Studio terminal 0.1.0
Usage: tim [--demo | --tools] [--url http://127.0.0.1:PORT]
           [--data-dir DIRECTORY] [--library DIRECTORY] [--no-color]
       tim install REQUEST [--manager NAME]
       tim listen port 9999 [--protocol tcp|udp] [--mode bind] [--host IP]
       tim toolbox location DIRECTORY
       tim toolbox list|search|show|add|propose|run [--toolbox DIRECTORY]
       tim listen --show-source
       tim read capture.pcap as hex [--filter "tcp.port == 9999"]

tim starts its own loopback-only headless backend; no GUI is required.
--url attaches to a server you own without stopping it on exit.
--demo is sample data only. --tools opens local utilities without a model/backend.
--library selects an existing model library. No models are downloaded or run on startup.
${help}
Ctrl+S sends; Enter inserts a newline; Esc cancels; Ctrl+Q quits.
First run: /models, /model N for chat; /agent N configures the main agent.
Package operations always require an exact command review before mutation.`;
if(args.includes('--help')||args.includes('-h')){console.log(usage);process.exit(0);}
if(args.includes('--version')||args.includes('-v')){console.log('TIM Studio 0.1.0');process.exit(0);}
if(args.includes('--no-color'))process.env.FORCE_COLOR='0';
if(args[0]==='listen'&&args.includes('--show-source')){const fs=await import('node:fs/promises');console.log(await fs.readFile(new URL('./listener.mjs',import.meta.url),'utf8'));process.exit(0);}
if(args[0]==='toolbox'){try{const {toolboxCommand}=await import('./toolbox-command.mjs');await toolboxCommand(args.slice(1));}catch(error){console.error('TIM toolbox: '+clean(error.message));process.exitCode=1;}process.exit(process.exitCode||0);}
const interactive=!!process.stdin.isTTY&&!!process.stdout.isTTY&&process.env.TERM!=='dumb';
let client,backend,ui,restored=false,closing;
const restore=()=>{if(restored)return;restored=true;client?.close();ui?.unmount();if(interactive){process.stdin.setRawMode?.(false);process.stdout.write('\x1b[0m\x1b[?25h\x1b[?1049l');}process.stdin.pause();};
const close=()=>closing||(closing=(async()=>{await closeOwnedTools();restore();await backend?.close();})());
try{
 const options={},request=[];const install=args[0]==='install',listen=args[0]==='listen',read=args[0]==='read';
 for(let i=install||listen||read?1:0;i<args.length;i++){
  const arg=args[i];
  if(['--demo','--tools','--no-color'].includes(arg)){options[arg.slice(2)]=true;continue;}
  if(['--url','--data-dir','--library','--manager','--protocol','--mode','--host','--filter','--view'].includes(arg)){if(!args[i+1]||args[i+1].startsWith('--'))throw new Error(arg+' requires a value');options[arg.slice(2)]=args[++i];continue;}
  if((install||listen||read)&&!arg.startsWith('--'))request.push(arg);else throw new Error('Unknown argument: '+arg);
 }
 if((options.demo||options.tools)&&(install||listen||read)||options.demo&&options.tools)throw new Error('Choose one of --demo, --tools or install.');
 if(options.manager&&!install)throw new Error('--manager is only valid with tim install.');
 if((install||listen||read)&&!request.length)throw new Error('Supply a request after tim install or tim listen.');
 if(!interactive&&!options.demo){
  if(install||listen||read)throw new Error('This action needs an interactive terminal for exact command confirmation. Nothing was installed.');
  console.log(usage+'\nOpen an interactive terminal to start TIM. No backend was started.');
 }else{
  if(!options.demo&&!options.tools){
   if(!options.url)backend=await ownBackend({dataDir:options['data-dir'],libraryRoot:options.library&&path.resolve(options.library)});
   client=new Client(options.url||backend.url);
  }
  const initial=client?await client.request('state'):structuredClone(demoState);
  if(!interactive){console.log('TIM Studio / SAMPLE DATA');console.log('Interactive terminal required for composing.');}
  else{
   process.stdout.write('\x1b[?1049h\x1b[2J\x1b[H');process.once('exit',restore);
   const signal=()=>{void close().catch(e=>{process.stderr.write(clean(e.message)+'\n');process.exitCode=1;});};
   process.once('SIGINT',signal);process.once('SIGTERM',signal);
   let component;
   if(read){const {CaptureScreen}=await import('./capture-screen.mjs');component=React.createElement(CaptureScreen,{client,file:request[0],request:request.slice(1).join(' '),options,onQuit:signal});}
   else if(listen){const {ListenScreen}=await import('./listen-screen.mjs');component=React.createElement(ListenScreen,{client,request:request.join(' '),options,onQuit:signal});}
   else if(install){const {InstallScreen}=await import('./install-screen.mjs');component=React.createElement(InstallScreen,{client,request:request.join(' '),manager:options.manager,onQuit:signal});}
   else component=React.createElement(App,{client,demo:!!options.demo,initial,startTools:!!options.tools,onQuit:signal});
   ui=render(component,{exitOnCtrlC:false,maxFps:20,patchConsole:true});await ui.waitUntilExit();
   process.off('SIGINT',signal);process.off('SIGTERM',signal);
  }
 }
 await close();
}catch(error){await close().catch(()=>{});console.error('TIM Studio: '+clean(error.message));process.exitCode=1;}
