import {boundary,useClock} from './activity.mjs';
import React,{useState,useEffect} from 'react';
import {Box,Text,useInput} from 'ink';
import {ToolScreen} from './tool-screen.mjs';
import {readRegistry,discoverTools} from './tool-runner.mjs';
import {captureReview} from './capture.mjs';
import {modelIntent} from './planner.mjs';
import {clean} from './core.mjs';
const h=React.createElement;
export function CaptureScreen({client,file,request,options={},onQuit}){
 const now=useClock(),[startedAt]=useState(Date.now);
 const [review,setReview]=useState(null),[message,setMessage]=useState('Locating TShark…'),[controller]=useState(()=>new AbortController()),[size,setSize]=useState({w:process.stdout.columns||100,h:process.stdout.rows||30});
 useEffect(()=>{let alive=true;const resize=()=>setSize({w:process.stdout.columns||100,h:process.stdout.rows||30});process.stdout.on('resize',resize);
  (async()=>{
   const registry=await readRegistry(),tools=await discoverTools(registry.filter(t=>t.id==='tshark'));const tool=tools[0];
   if(tool.status!=='installed')throw new Error('TShark is not installed/supported here. No capture was read. Install it separately through a reviewed package plan, then retry.');
   let view=options.view||'hex',filter=options.filter||'';
   if(request&&!/^as (hex|ascii)$/i.test(request)){
    // Only the request text is sent to the model, never file contents or payloads.
    const intent=await modelIntent(client,'read',request,{signal:controller.signal,onStatus:s=>alive&&setMessage(s)});view=options.view||intent.view;filter=options.filter||intent.filter;
   }else if(request)view=options.view||request.split(' ')[1].toLowerCase();
   const plan=await captureReview(tool,file,{view,filter});if(alive)setReview(plan);
  })().catch(e=>alive&&setMessage(e.message));
  return()=>{alive=false;controller.abort();process.stdout.off('resize',resize);};
 },[]);
 useInput((input,key)=>{if(key.escape||key.ctrl&&['q','c'].includes(input)){controller.abort();onQuit();}},{isActive:!review});
 if(review)return h(ToolScreen,{size,initialReview:review,initialTools:[],onBack:onQuit,onQuit});
 return h(Box,{flexDirection:'column',padding:1},h(Text,{color:'#8EE8AA'},'TIM / OFFLINE CAPTURE / '+boundary(client?.selection)),h(Text,{color:'#DAA85A'},clean(message)),h(Text,{color:'#758D80'},'elapsed '+Math.floor((now-startedAt)/1000)+'s | ETA unavailable | UI clock only'),h(Text,null,'Packet bytes remain local. Encrypted payloads stay encrypted. Esc quits.'));
}
