import React, {useState,useEffect} from 'react';
import {Box,Text,useInput,useCursor} from 'ink';
import {clean,edit,demoState} from './core.mjs';
import {hood,compactHood} from './art.mjs';
import {ToolScreen} from './tool-screen.mjs';
import {retroWordmark} from './retro.mjs';
const h=React.createElement, green='#C5F7D4', muted='#758D80', amber='#DAA85A';
const text=(value,props={})=>h(Text,{color:green,...props},clean(value));
const portrait=value=>h(Text,{color:'#8EE8AA'},...value.split(/([#=]+|[.:;]+)/g).map((part,i)=>h(Text,{key:i,color:/^[.:;]+$/.test(part)?'#78CCA0':/^[#=]+$/.test(part)?'#C5F7D4':'#8EE8AA'},part)));
const lettering=large=>text(retroWordmark({large}),{color:'#8EE8AA'});
const tracked=(value,width)=>{const spaced=[...value].join(' ');return spaced.length<=width?spaced:value;};
const panel=(title,children,props={})=>h(Box,{borderStyle:process.env.TIM_ASCII==='1'?'classic':'double',borderColor:'#8EE8AA',flexDirection:'column',paddingX:1,...props},text(title,{color:'#8EE8AA'}),...children);
export const help='/tools  /agent N  /home  /new  /sessions  /session N  /models  /model N  /mode agent|chat|code  /help';
export function App({client,demo=false,onQuit,initial=demoState,staticPreview=false,dimensions,startTools=false}) {
 const {setCursorPosition}=useCursor();
 const [toolsOpen,setToolsOpen]=useState(startTools);
 const [state,setState]=useState(initial),[sessionId,setSession]=useState(initial.sessions?.[0]?.id),[modelId,setModel]=useState(''),[mode,setMode]=useState('agent'),[draft,setDraft]=useState({text:'',cursor:0}),[notice,setNotice]=useState(demo?'':'Connecting to local studio…'),[home,setHome]=useState(true),[busy,setBusy]=useState(false),[scroll,setScroll]=useState(0),[size,setSize]=useState({w:dimensions?.w||process.stdout.columns||120,h:dimensions?.h||process.stdout.rows||40});
 useEffect(()=>{if(staticPreview)return;const resize=()=>setSize({w:process.stdout.columns||80,h:process.stdout.rows||24});process.stdout.on('resize',resize);return()=>process.stdout.off('resize',resize);},[]);
 useEffect(()=>{if(demo||staticPreview||!client)return;let alive=true;client.watch(s=>{if(!alive)return;setState(s);setSession(id=>id||s.sessions[0]?.id);setNotice(old=>old==='Connecting to local studio…'?'Connected / local studio':old);}).catch(e=>{if(alive&&!client.controller.signal.aborted)setNotice(e.message);});return()=>{alive=false;client.close();};},[]);
 const session=state.sessions?.find(s=>s.id===sessionId),jobs=(state.jobs||[]).filter(j=>j.sessionId===sessionId),active=jobs.find(j=>['running','queued'].includes(j.status));
 async function cancel(){if(demo){setNotice('SAMPLE DATA / no running job');return;}if(active)try{await client.request('cancel',{id:active.id});setNotice('Cancellation requested');}catch(e){setNotice(e.message);}}
 async function submit(){if(busy||!draft.text.trim())return;const original=draft.text,input=draft.text.trim();setBusy(true);try{
  if(input.startsWith('/')){const [command,arg]=input.split(/\s+/,2);const number=Number(arg)-1;
   if(command==='/tools'){setToolsOpen(true);}
   else if(command==='/agent'){if(!client)throw new Error('Connect a local backend to configure an agent model.');const m=(state.models||[]).filter(m=>m.kind==='chat')[number];if(!m?.available)throw new Error('Choose an available model number from /models');await client.request('settings',{mainAgentModelId:m.id});setMode('agent');setNotice('Main agent model selected; native tool support still needs validation.');}
   else if(command==='/home'){setHome(true);setNotice('Welcome to TIM Studio');}
   else if(command==='/help')setNotice(help);
   else if(command==='/models')setNotice((state.models||[]).filter(m=>m.kind==='chat').map((m,i)=>`${i+1}. ${m.name}${m.available?'':' (unavailable)'}`).join('\n')||'No chat models found. Configure the library in desktop Settings.');
   else if(command==='/model'){const m=(state.models||[]).filter(m=>m.kind==='chat')[number];if(!m?.available)throw new Error('Choose an available model number from /models');setModel(m.id);setMode('chat');setNotice(`Chat model: ${m.name}. Agent uses the main model from Settings.`);}
   else if(command==='/mode'){if(!['agent','chat','code'].includes(arg))throw new Error('Use /mode agent, chat or code');setMode(arg);}
   else if(command==='/sessions')setNotice((state.sessions||[]).map((s,i)=>`${i+1}. ${s.title}`).join('\n')||'No sessions yet. /new starts one.');
   else if(command==='/session'){const s=state.sessions[number];if(!s)throw new Error('Choose a session number from /sessions');setSession(s.id);setScroll(0);}
   else if(command==='/new'){if(demo)throw new Error('Demo sessions are sample data. Connect without --demo for real sessions.');const s=await client.request('sessions',{});setSession(s.id);setState(old=>({...old,sessions:[s,...old.sessions]}));setScroll(0);}
   else throw new Error('Unknown command. '+help);
  }else if(demo){setHome(false);setNotice('SAMPLE DATA / submitted locally; no inference');setState(old=>({...old,sessions:old.sessions.map(s=>({...s,messages:[...s.messages,{role:'user',content:input},{role:'assistant',content:'Preview only. Connect to TIM Studio to run your configured models.',status:'completed'}]}))}));}
  else{if(!client)throw new Error('Restart without --tools for local chat, or use --demo for a preview.');setHome(false);if(active)throw new Error('Wait for this session’s job, or press Esc to cancel.');if(mode!=='agent'&&!modelId)throw new Error('Select a chat model with /models then /model N');const job=await client.request('jobs',{sessionId,kind:mode,modelId,prompt:input,attachments:[]});setSession(job.sessionId);setNotice('Queued in TIM Studio');}
  setDraft(current=>current.text===original?{text:'',cursor:0}:current);setScroll(0);
 }catch(e){setNotice(e.message);}finally{setBusy(false);}}
 useInput((input,key)=>{if(key.ctrl&&['c','q'].includes(input)){onQuit();return;}if(key.escape){void cancel();return;}if(key.pageUp){setScroll(n=>n+5);return;}if(key.pageDown){setScroll(n=>Math.max(0,n-5));return;}if(key.ctrl&&input==='s'){void submit();return;}setDraft(old=>edit(old,input,key));},{isActive:!staticPreview&&!toolsOpen});
 const wide=size.w>=100,hero=home&&wide&&size.h>=38&&!active,large=hero&&size.w>=154&&size.h>=50;
 const inputWidth=Math.max(1,size.w-6),inputLines=[];let cursorRow=0,cursorCol=0,offset=0;
 for(const line of draft.text.split('\n')){if(draft.cursor>=offset&&draft.cursor<=offset+line.length){cursorRow=inputLines.length+Math.floor((draft.cursor-offset)/inputWidth);cursorCol=(draft.cursor-offset)%inputWidth;}for(let i=0;i<=line.length;i+=inputWidth)inputLines.push(line.slice(i,i+inputWidth));offset+=line.length+1;}
 const inputRows=Math.min(3,inputLines.length),inputStart=Math.max(0,cursorRow-inputRows+1),composerHeight=3+inputRows;
 const headerHeight=wide?4:3,heroHeight=hero?(large?31:20):0;
 const logoWidth=Math.max(...retroWordmark({large}).split('\n').map(line=>line.length));
 const heroArt=large?hood:compactHood;
 const rightHeroHeight=Math.min(heroHeight,(large?1:0)+retroWordmark({large}).split('\n').length+3);
 const portraitPadding=Math.max(0,rightHeroHeight-heroArt.split('\n').length);
 const panelHeight=Math.max(4,size.h-1-headerHeight-heroHeight-composerHeight-2),bodyHeight=panelHeight-3;
 const content=(session?.messages||[]).map(m=>`${m.role==='user'?'YOU':'TIM'}${m.status?' / '+m.status:''}\n${m.content||'Waiting for response.'}${m.error?'\n'+m.error:''}${m.artifact?'\nArtifact: '+m.artifact.filename:''}${m.steps?.length?'\n'+m.steps.map(s=>`${s.status}: ${s.tool||s.kind} - ${s.phase||''}`).join('\n'):''}`).join('\n\n')||'No task running.\n\nStart with a request below.';
 const width=Math.max(12,size.w-(wide&&!hero?35:6)),lines=clean(notice.includes('\n')?notice:content).split('\n').flatMap(line=>{const a=[];for(let i=0;i<line.length;i+=width)a.push(line.slice(i,i+width));return a.length?a:[''];});
 const visible=lines.slice(Math.max(0,lines.length-bodyHeight-scroll),Math.max(0,lines.length-scroll));
 const model=(state.models||[]).find(m=>m.id===(mode==='agent'?state.config?.mainAgentModelId:modelId))?.name||'not selected';
 useEffect(()=>{if(!staticPreview&&!toolsOpen)setCursorPosition(size.w>=40&&size.h>=16?{x:3+cursorCol,y:size.h-composerHeight+cursorRow-inputStart}:undefined);},[cursorCol,cursorRow,inputStart,composerHeight,size.w,size.h,staticPreview,toolsOpen]);
 if(toolsOpen)return h(ToolScreen,{size,onBack:()=>setToolsOpen(false),onQuit});
 if(size.w<40||size.h<16)return h(Box,{flexDirection:'column'},text('TIM studio'),text('Enlarge terminal to at least 40 x 16.'),text('Ctrl+Q quit / draft preserved'));
 const workspace=[text('project    smooth-operator'),text('mode       '+mode),text('model      '+model,{wrap:'truncate'}),text(' '),text('/models    /tools    /help',{color:muted})];
 const idleSession=[text('No task running.'),text(' '),text(session?.messages?.length?`${session.messages.length} messages in the selected session.`:'Start with a request below.'),text(' '),text('Responses and tool activity appear here.',{color:muted})];
 return h(Box,{flexDirection:'column',width:size.w,height:Math.max(1,size.h-1),paddingX:1,backgroundColor:'#080D0B'},
  h(Box,{height:headerHeight,flexShrink:0,flexDirection:'column',paddingTop:wide?1:0},
   h(Box,{justifyContent:'space-between'},text('TIM / STUDIO',{bold:true,color:'#8EE8AA'}),text(demo?'SAMPLE STATE':active?'WORKING':'LOCAL',{color:amber})),
   h(Box,{justifyContent:'space-between'},text('smooth-operator',{color:muted}),text(active?active.phase:'READY',{color:muted,wrap:'truncate'})),
   text((process.env.TIM_ASCII==='1'?'-':'═').repeat(Math.max(1,size.w-2)),{color:'#8EE8AA'})),
  hero?h(Box,{height:heroHeight,flexShrink:0,gap:large?5:4,paddingLeft:large?1:2},h(Box,{paddingTop:portraitPadding,flexShrink:0},portrait(heroArt)),h(Box,{flexDirection:'column',paddingTop:large?1:0},lettering(large),text('\n'+tracked('YOUR WORK. ONE TERMINAL.',logoWidth),{color:'#C5F7D4',bold:true}),text(tracked('> What are we building?',logoWidth),{color:amber,bold:true}))):null,
  h(Box,{height:panelHeight,flexShrink:0,overflow:'hidden',gap:1},
   hero?panel('WORKSPACE',workspace.slice(0,bodyHeight),{width:Math.floor((size.w-3)*0.42),overflow:'hidden'}):panel('SESSION / '+(session?.title||'new session'),[text(visible.join('\n'))],{flexGrow:1,flexBasis:0,overflow:'hidden'}),
   hero?panel('SESSION',notice.includes('\n')?[text(visible.join('\n'))]:idleSession.slice(0,bodyHeight),{flexGrow:1,flexBasis:0,overflow:'hidden'}):wide?panel('WORKSPACE',[text(('MODE    '+mode+'\nMODEL   '+model+'\n\n'+(active?active.phase:'Idle / ready')+'\n\nSession '+(sessionId||'none').slice(0,12)+'\nQuit leaves jobs running').split('\n').slice(0,bodyHeight).join('\n'))],{width:31,overflow:'hidden'}):null),
  text(notice.split('\n').slice(0,2).join('  |  '),{color:amber,wrap:'truncate'}),
  panel('COMMAND'+(busy?' / sending':''),[text(draft.text?inputLines.slice(inputStart,inputStart+inputRows).join('\n'):'Ask TIM to build, fix, or explore...',{color:draft.text?green:muted})],{borderColor:busy?amber:green,height:composerHeight,flexShrink:0,overflow:'hidden'}),
  text('Ctrl+S send  Enter newline  Esc cancel  PgUp/Dn scroll  Ctrl+Q quit',{color:muted,wrap:'truncate'}));
}
