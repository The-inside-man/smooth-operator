import {boundary,useClock} from './activity.mjs';
import React,{useState,useEffect} from 'react';
import {Box,Text,useInput} from 'ink';
import {ToolScreen} from './tool-screen.mjs';
import {readRegistry,discoverTools} from './tool-runner.mjs';
import {packageManagers} from './package-managers.mjs';
import {resolveInstall,proposeToolDraft} from './planner.mjs';
import {clean} from './core.mjs';
const h=React.createElement;
export function InstallScreen({client,request,manager,onQuit}){
 const now=useClock(),[startedAt]=useState(Date.now);
 const [status,setStatus]=useState('Discovering compatible managers…'),[review,setReview]=useState(null),[failed,setFailed]=useState(false),[proposing,setProposing]=useState(false),[controller]=useState(()=>new AbortController()),[size,setSize]=useState({w:process.stdout.columns||100,h:process.stdout.rows||30});
 useEffect(()=>{const resize=()=>setSize({w:process.stdout.columns||100,h:process.stdout.rows||30});process.stdout.on('resize',resize);let alive=true;
  (async()=>{const tools=await discoverTools([...(await readRegistry()),...packageManagers]);const plan=await resolveInstall({request,manager,client,tools,signal:controller.signal,onStatus:s=>alive&&setStatus(s)});if(alive)setReview(plan);})().catch(e=>{if(alive){setStatus(e.message);setFailed(true);}});
  return()=>{alive=false;controller.abort();process.stdout.off('resize',resize);};
 },[]);
 const propose=async()=>{if(proposing)return;setProposing(true);setStatus('Searching selected toolbox before proposing a small tool.');try{const result=await proposeToolDraft({request,client,signal:controller.signal,onStatus:setStatus});setStatus(result.kind==='reuse'?'Existing candidates: '+result.candidates.map(c=>c.id+' / '+c.name).join(', ')+'. Inspect with tim toolbox show ID.':'Saved draft '+result.draft.id+'. Inspect with tim toolbox show '+result.draft.id+'. Nothing executed.');}catch(error){setStatus(error.message);}finally{setProposing(false);}};
 useInput((input,key)=>{if(key.ctrl&&input==='b'&&failed){void propose();return;}if(key.escape||key.ctrl&&['c','q'].includes(input)){controller.abort();onQuit();}},{isActive:!review});
 if(review)return h(ToolScreen,{size,initialReview:review,initialTools:[],onBack:onQuit,onQuit});
 return h(Box,{width:size.w,flexDirection:'column',padding:1},h(Text,{color:'#8EE8AA',bold:true},'TIM / INSTALL PLAN / '+boundary(client?.selection)),h(Text,null,clean(request)),h(Text,{color:failed?'#DAA85A':'#C5F7D4'},clean(status)),h(Text,{color:'#758D80'},'elapsed '+Math.floor((now-startedAt)/1000)+'s | ETA unavailable | UI clock only'),h(Text,null,failed?'Nothing was installed. Use tim --tools for manually reviewed adapters, or retry with --manager NAME and an exact package ID.':'No installation occurs until an exact-command review is confirmed.'),h(Text,null,failed?'Ctrl+B searches toolbox / proposes a small-tool draft; Esc quits':'Esc / Ctrl+Q cancel and quit'));
}
