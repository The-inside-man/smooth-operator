import {activity,useClock,observeJob} from './activity.mjs';
import {verifyToolRun,recordToolRun} from './toolbox.mjs';
import React,{useState,useEffect} from 'react';
import {Box,Text,useInput,useCursor} from 'ink';
import {packetAscii} from './capture.mjs';
import {clean,edit} from './core.mjs';
import {ToolRunner,readRegistry,discoverTools,parseArguments,makeReview} from './tool-runner.mjs';
import {packageManagers,packageReview} from './package-managers.mjs';
const h=React.createElement;
const label=(value,props={})=>h(Text,{color:'#C5F7D4',...props},clean(value));
const wrap=(value,width)=>clean(value).split('\n').flatMap(line=>{const result=[];for(let i=0;i<line.length;i+=width)result.push(line.slice(i,i+width));return result.length?result:[''];});
const operations=['version','search','list','install','update','remove'];

export function ToolScreen({size,onBack,onQuit,initialTools=null,initialReview=null,staticPreview=false}) {
 const now=useClock(!staticPreview);
 const [runner]=useState(()=>new ToolRunner()),[tools,setTools]=useState(initialTools||[]),[query,setQuery]=useState(''),[category,setCategory]=useState('All'),[selected,setSelected]=useState(0),[phase,setPhase]=useState(initialReview?'review':'menu'),[tool,setTool]=useState(null),[operation,setOperation]=useState('version'),[draft,setDraft]=useState({text:'',cursor:0}),[review,setReview]=useState(initialReview),[run,setRun]=useState(runner.state),[notice,setNotice]=useState(initialTools?'':'Discovering installed tools on PATH…'),[scroll,setScroll]=useState(0),[closing,setClosing]=useState(false);
 const {setCursorPosition}=useCursor();
 const categories=['All','Development','Network','Security','System','Packages'];
 const filtered=tools.filter(t=>(category==='All'||t.category===category)&&`${t.name} ${t.description}`.toLowerCase().includes(query.toLowerCase()));
 const index=Math.min(selected,Math.max(0,filtered.length-1));
 const running=['running','cancelling','stopping (timeout)'].includes(run.status);
 const refresh=async()=>{setNotice('Discovering installed tools on PATH…');try{setTools(await discoverTools([...(await readRegistry()),...packageManagers]));setNotice('Discovery reads PATH; no tool has been executed.');}catch(e){setNotice(e.message);}};
 useEffect(()=>{if(!initialTools&&!staticPreview)void refresh();const listener=s=>{setRun(observeJob(s));setScroll(0);};runner.on('state',listener);return()=>{runner.off('state',listener);void runner.close();};},[]);
 useEffect(()=>{setCursorPosition(undefined);},[phase]);
 const choose=t=>{if(t.status!=='installed'){setNotice(`${t.name}: ${t.status}. Interactive tools and shell shims are not executed.`);return;}setTool(t);setOperation('version');setDraft({text:t.manager?'':t.defaultArgs.map(a=>JSON.stringify(a)).join(' '),cursor:0});setPhase(t.manager?'operation':'args');setScroll(0);setNotice('');};
 const propose=()=>{try{const next=tool.manager?packageReview(tool,operation,draft.text):makeReview(tool,[...(tool.prefixArgs||[]),...parseArguments(draft.text)]);setReview(next);setPhase('review');setScroll(0);setNotice('Nothing has run. Ctrl+S confirms this exact command once. Esc returns to editing.');}catch(e){setNotice(e.message);}};
 const launch=()=>{if(!review||running)return;setPhase('output');setNotice('Running with current privileges. Esc cancels this process tree.');setScroll(0);void (async()=>{await verifyToolRun(review);const result=await runner.run(review,{confirmed:true});await recordToolRun(review,result);})().catch(e=>{setNotice(e.message);});setReview(null);};
 const quit=async()=>{if(closing)return;setClosing(true);await runner.close();onQuit();};
 useInput((input,key)=>{
  if(closing)return;
  if(key.ctrl&&['q','c'].includes(input)){void quit();return;}
  if(key.escape){if(running){void runner.cancel();setNotice('Cancellation requested for this tool only.');}else if(initialReview||phase==='menu')onBack();else{setPhase(phase==='review'?'args':'menu');setReview(null);setScroll(0);}return;}
  if(key.pageUp){setScroll(n=>phase==='output'?n+5:Math.max(0,n-5));return;}if(key.pageDown){setScroll(n=>phase==='output'?Math.max(0,n-5):n+5);return;}
  if(phase==='menu'){
   if(key.tab){setCategory(categories[(categories.indexOf(category)+1)%categories.length]);setSelected(0);return;}
   if(key.upArrow){setSelected(Math.max(0,index-1));return;}if(key.downArrow){setSelected(Math.min(filtered.length-1,index+1));return;}
   if(key.return){if(filtered[index])choose(filtered[index]);return;}
   if(key.ctrl&&input==='r'){void refresh();return;}
   if(key.backspace){setQuery(q=>q.slice(0,-1));setSelected(0);return;}
   if(!key.ctrl&&!key.meta){setQuery(q=>q+clean(input));setSelected(0);}return;
  }
  if(phase==='operation'){
   const supported=operations.filter(op=>tool.operations[op]),current=supported.indexOf(operation);
   if(key.upArrow)setOperation(supported[(current-1+supported.length)%supported.length]);
   if(key.downArrow)setOperation(supported[(current+1)%supported.length]);
   if(key.return){setPhase('args');setDraft({text:'',cursor:0});}return;
  }
  if(phase==='args'){if(key.return){propose();return;}setDraft(old=>edit(old,input,key));return;}
  if(phase==='review'){if(key.ctrl&&input==='s')launch();return;}
  if(phase==='output'&&!running&&key.return){if(initialReview){setReview(initialReview);setPhase('review');return;}setPhase('args');setNotice('Review again before another launch.');setScroll(0);}
 },{isActive:!staticPreview});
 const width=Math.max(20,size.w-6),height=Math.max(3,size.h-9);let lines=[];
 if(phase==='menu'){
  const visible=Math.max(1,height-2),start=Math.max(0,index-visible+1);
  lines=[`Search: ${query||'(type to filter)'}   Category: ${category}`,'',...filtered.slice(start,start+visible).map((t,i)=>`${start+i===index?'>':' '} ${t.name.padEnd(13)} ${t.category.padEnd(12)} ${t.status}`)];
  if(!filtered.length)lines.push('No matching tools. Tab changes category; Ctrl+R rescans PATH.');
 }else if(phase==='operation')lines=[`${tool.name} / supported adapter operations`,'',...operations.map(op=>`${operation===op?'>':' '} ${op.padEnd(9)} ${tool.operations[op]?'supported':'unsupported'}`),'','Only declared operations are available.'];
 else if(phase==='args')lines=[`${tool.name}${tool.manager?' / '+operation:''}`,tool.description,'',tool.manager?'Package identifier (leave empty for version/list):':'Arguments: quote arguments containing spaces. No shell expansion.',...wrap(draft.text.slice(0,draft.cursor)+'|'+draft.text.slice(draft.cursor),width),'',`Executable: ${tool.executable}`,`Working directory: ${process.cwd()}`,'Enter opens launch review. Nothing runs from this editor.'];
 else if(phase==='review')lines=[`REVIEW / ${review.name}${review.mutation?' / PACKAGE MUTATION':''}`,'',`Executable: ${review.executable}`,`Arguments / targets: ${JSON.stringify(review.args)}`,`Working directory: ${review.cwd}`,`Limit: ${review.timeoutMs/1000}s; retained output: 64 KiB; stdin: closed`,'',review.activeScan?'ACTIVE NETWORK SCAN: confirm authorization and every target.':review.network?'NETWORK: this command may contact the displayed targets/registries.':'LOCAL: check the command’s effects before continuing.',review.privileged?'PRIVILEGES: may require elevated rights; TIM never elevates.':'Current user privileges only.',review.risk,'','Ctrl+S = run this exact command once. Esc = no launch.'];
 else lines=[`${run.review?.name||tool?.name} / ${run.status.toUpperCase()}${run.exitCode!==null?' / exit '+run.exitCode:''}`,run.error||'',run.truncated?'[Only the most recent 64 KiB are retained]':'',(run.review?.outputFormat==='packet-ascii'?packetAscii(run.stdout||''):run.output)||'Waiting for output…'];
 const wrapped=lines.flatMap(line=>wrap(line,width));
 const maximum=Math.max(0,wrapped.length-height),start=phase==='output'?maximum-Math.min(scroll,maximum):Math.min(scroll,maximum),view=wrapped.slice(start,start+height);
 return h(Box,{flexDirection:'column',width:size.w,height:Math.max(1,size.h-1),paddingX:1,backgroundColor:'#080D0B'},
  label('TIM / TOOLS  '+(phase==='menu'?'installed utilities and package managers':phase.toUpperCase()),{color:'#8EE8AA',bold:true}),
  label('Local processes / exact argv review / no automatic elevation',{color:'#758D80'}),
  h(Box,{borderStyle:process.env.TIM_ASCII==='1'?'classic':'double',borderColor:'#8EE8AA',height:height+2,flexShrink:0,paddingX:1,overflow:'hidden'},label(view.join('\n'))),
  label(phase==='output'?activity(run,now).text+(activity(run,now).stale?' / no recent output':' / UI clock only'):phase==='review'?'Waiting for exact-command approval / ETA unavailable':notice,{color:'#DAA85A',wrap:'truncate'}),
  label(phase==='menu'?'Type search  Tab category  Up/Down select  Enter choose  Ctrl+R rescan':phase==='review'?'Ctrl+S confirm exact command  Esc edit  PgUp/PgDn review':phase==='output'?'Esc cancel/back  Enter review another run  PgUp/PgDn output':'Up/Down operation  Enter review  Esc back',{color:'#758D80',wrap:'truncate'}),
  label('Ctrl+Q / Ctrl+C cancel owned tool and quit; chat jobs are separate.',{color:'#758D80',wrap:'truncate'}));
}
