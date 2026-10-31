import {selection,boundary} from './activity.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import React,{useEffect,useState} from 'react';
import {closeOwnedTools} from './tool-runner.mjs';
import {render} from 'ink';
import {toolboxRoot,selectToolbox,searchToolbox,readTool,saveDraft,toolboxReview} from './toolbox.mjs';
import {clean,Client} from './core.mjs';
import {ownBackend} from './backend.mjs';
import {proposeToolDraft} from './planner.mjs';
import {ToolScreen} from './tool-screen.mjs';
export async function toolboxCommand(argv){
 const args=[],options={};for(let i=0;i<argv.length;i++){if(['--provider','--model','--toolbox','--data-dir','--url','--library','--name','--id'].includes(argv[i])){if(!argv[i+1])throw new Error('Missing option value');options[argv[i].slice(2)]=argv[++i];}else args.push(argv[i]);}
 if(options['data-dir'])process.env.TIM_DATA_DIR=path.resolve(options['data-dir']);
 const [action,...rest]=args;
 if(action==='location'){if(rest.length!==1)throw new Error('Usage: tim toolbox location ABSOLUTE_EXISTING_DIRECTORY');console.log('Selected toolbox: '+clean(await selectToolbox(rest[0])));return;}
 const root=await toolboxRoot(options.toolbox);
 if(action==='list'||action==='search'){const items=await searchToolbox(root,rest.join(' '));console.log(clean(JSON.stringify(items.map(({source,base,...m})=>m),null,2)));return;}
 if(action==='show'){const item=await readTool(root,rest[0]);console.log(clean(JSON.stringify({...item,source:undefined},null,2))+'\n\n'+clean(item.source));return;}
 if(action==='add'){
  if(rest.length<2)throw new Error('Usage: tim toolbox add SOURCE.mjs "why this tool was created" [--name NAME]');
  const source=await fs.readFile(path.resolve(rest[0]),'utf8'),request=rest.slice(1).join(' ');
  const draft=await saveDraft(root,{id:options.id,name:options.name||path.basename(rest[0]),description:request,originalRequest:request,why:request,source});console.log('Saved draft '+draft.id+' v'+draft.version+'. Nothing executed.');return;
 }
 if(action==='propose'){
  const request=rest.join(' ');if(!request)throw new Error('Supply a tool request.');
  let backend;const controller=new AbortController(),stop=()=>controller.abort();process.once('SIGINT',stop);process.once('SIGTERM',stop);try{
   const chosen=selection(options);console.log(clean(boundary(chosen)));
   let actualClient;const client={selection:chosen,get url(){return actualClient?.url;},async request(...args){if(!actualClient){if(!options.url)backend=await ownBackend({dataDir:options['data-dir'],libraryRoot:options.library&&path.resolve(options.library)});controller.signal.throwIfAborted();actualClient=new Client(options.url||backend.url,chosen);}return actualClient.request(...args);}};
   const result=await proposeToolDraft({root,request,client,signal:controller.signal,onStatus:message=>console.log(clean(message))});
   if(result.kind==='reuse')console.log(clean('Existing candidates found BEFORE generation. Review with tim toolbox show ID; run with tim toolbox run ID:\n'+result.candidates.map(c=>c.id+' v'+c.version+' '+c.name+' ('+c.reviewState+')').join('\n')));
   else console.log('Saved unexecuted draft '+result.draft.id+' v'+result.draft.version+'. Review with tim toolbox show '+result.draft.id+'.');
  }finally{await backend?.close();process.off('SIGINT',stop);process.off('SIGTERM',stop);}return;
 }
 if(action==='run'){
  if(!process.stdin.isTTY||!process.stdout.isTTY)throw new Error('Toolbox execution requires a terminal and fresh exact-command review.');
  const review=await toolboxReview(root,rest[0],rest.slice(1));let ui;const restore=()=>{ui?.unmount();process.stdin.setRawMode?.(false);process.stdout.write('\x1b[0m\x1b[?25h\x1b[?1049l');};
  const signal=()=>{void closeOwnedTools().finally(restore);};
  function Screen(){const [size,setSize]=useState({w:process.stdout.columns||100,h:process.stdout.rows||38});useEffect(()=>{const resize=()=>setSize({w:process.stdout.columns||100,h:process.stdout.rows||38});process.stdout.on('resize',resize);return()=>process.stdout.off('resize',resize);},[]);return React.createElement(ToolScreen,{size,initialTools:[],initialReview:review,onBack:restore,onQuit:restore});}
  process.once('SIGINT',signal);process.once('SIGTERM',signal);process.stdout.write('\x1b[?1049h');try{ui=render(React.createElement(Screen),{exitOnCtrlC:false});await ui.waitUntilExit();}finally{await closeOwnedTools();restore();process.off('SIGINT',signal);process.off('SIGTERM',signal);}return;
 }
 throw new Error('Toolbox commands: location, list, search, show, add, propose, run. Use --toolbox DIRECTORY for an explicit one-time location.');
}
