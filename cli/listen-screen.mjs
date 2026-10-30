import React,{useState,useEffect} from 'react';
import {Box,Text,useInput} from 'ink';
import {RawListener,listenerConfig} from './listener.mjs';
import {modelIntent} from './planner.mjs';
import {clean} from './core.mjs';
const h=React.createElement;
export function ListenScreen({client,request,options={},onQuit}){
 const [listener]=useState(()=>new RawListener()),[controller]=useState(()=>new AbortController()),[state,setState]=useState(listener.state),[phase,setPhase]=useState('planning'),[notice,setNotice]=useState('Resolving listener intent…'),[plan,setPlan]=useState(null),[choice,setChoice]=useState(0),[size,setSize]=useState({w:process.stdout.columns||100,h:process.stdout.rows||30});
 useEffect(()=>{const update=s=>setState(s),resize=()=>setSize({w:process.stdout.columns||100,h:process.stdout.rows||30});listener.on('state',update);process.stdout.on('resize',resize);let alive=true;
  (async()=>{
   let intent;try{intent=await modelIntent(client,'listen',request,{signal:controller.signal,onStatus:s=>alive&&setNotice(s)});}catch(error){
    const match=/^(?:port\s+)?(\d+)$/.exec(request.trim());if(!match)throw error;
    intent={action:'listen',mode:null,protocol:null,port:Number(match[1]),host:'127.0.0.1'};setNotice('Using a typed port request. Choose protocol and mode; no model claim is made.');
   }
   if(!alive)return;
   if(options.mode)intent.mode=options.mode;if(options.protocol)intent.protocol=options.protocol;if(options.host)intent.host=options.host;
   if(!Number.isInteger(intent.port)||intent.port<1||intent.port>65535)throw new Error('Invalid port.');
   if(intent.mode==='capture')throw new Error('Capturing existing traffic is a separate operation. The built-in listener cannot sniff an occupied port. Use tim --tools to review a supported capture utility; nothing was started.');
   setPlan(intent);setPhase('choose');
  })().catch(e=>{if(alive){setNotice(e.message);setPhase('error');}});
  return()=>{alive=false;controller.abort();void listener.stop();listener.off('state',update);process.stdout.off('resize',resize);};
 },[]);
 const quit=async()=>{controller.abort();await listener.stop();onQuit();};
 useInput((input,key)=>{
  if(key.ctrl&&['q','c'].includes(input)){void quit();return;}
  if(key.escape){if(phase==='running'){void listener.stop();setPhase('review');setNotice('Stopped. Fresh confirmation is required to bind again.');}else if(phase==='review')setPhase('choose');else void quit();return;}
  if(phase==='choose'){
   if(key.upArrow||key.downArrow)setChoice(n=>1-n);
   if(key.return)try{setPlan(listenerConfig({...plan,mode:'bind',protocol:options.protocol||(['tcp','udp'][choice])}));setPhase('review');setNotice('Built-in fixed-source helper proposed. No system tool or generated script has executed.');}catch(e){setNotice(e.message);}return;
  }
  if(phase==='review'&&key.ctrl&&input==='s'){setPhase('running');void listener.start(plan,{confirmed:true}).catch(e=>{setNotice(e.message);setPhase('review');});}
 });
 let content;
 if(phase==='choose')content=`Mode: NEW listener (not packet capture)\nPort: ${plan.port}\n\n${choice===0?'>':' '} TCP / new client connections\n${choice===1?'>':' '} UDP / datagrams\n\nUp/Down chooses protocol. Enter opens exact bind review.\nExisting traffic capture is not performed by this helper.`;
 else if(phase==='review')content=`REVIEW BUILT-IN LISTENER\n\nMode: new ${plan.protocol.toUpperCase()} listener\nBind: ${plan.host}:${plan.port}\n${plan.external?'EXTERNAL BIND: other machines may reach this socket.':'LOOPBACK ONLY: local processes can connect.'}\nDuration: at most ${plan.durationMs/1000}s; 8 TCP clients; 64 KiB display tail.\nNo firewall changes, elevation, raw-byte files or model uploads.\n\nSource: cli/listener.mjs (fixed reviewed helper; Node built-ins only)\nEquivalent launch: tim listen port ${plan.port} --mode bind --protocol ${plan.protocol} --host ${plan.host}\n\nCtrl+S confirms this exact bind once. Esc goes back.`;
 else if(phase==='running')content=`${state.status.toUpperCase()} / ${state.bytes} bytes / ${state.connections} TCP connections\nOmitted from hex display: ${state.droppedBytes} bytes; only the latest 64 KiB of display is retained.\n${state.output}`;
 else content=notice;
 const width=Math.max(20,size.w-6),rows=Math.max(4,size.h-7),lines=clean(content).split('\n').flatMap(line=>{const out=[];for(let i=0;i<line.length;i+=width)out.push(line.slice(i,i+width));return out.length?out:[''];}),visible=phase==='running'?lines.slice(-rows):lines.slice(0,rows);
 return h(Box,{flexDirection:'column',width:size.w,height:size.h-1,paddingX:1,backgroundColor:'#080D0B'},h(Text,{color:'#8EE8AA',bold:true},'TIM / LISTEN'),h(Box,{borderStyle:process.env.TIM_ASCII==='1'?'classic':'double',borderColor:'#8EE8AA',paddingX:1,height:rows+2,overflow:'hidden'},h(Text,{color:'#C5F7D4'},visible.join('\n'))),h(Text,{color:'#DAA85A',wrap:'truncate'},clean(notice)),h(Text,{color:'#758D80'},'Esc stop/back  Ctrl+Q quit / owned sockets close'));
}
