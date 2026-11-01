import {shimmerRuns,useShimmer,reducedMotion} from './animation.mjs';
import {DesktopScreen} from './desktop-screen.mjs';
import {usableTerminal,WidthMessage} from './terminal-boundary.mjs';
import {ImageScreen} from './image-screen.mjs';
import {naturalRequest} from './natural.mjs';
import {InstallScreen} from './install-screen.mjs';
import {ListenScreen} from './listen-screen.mjs';
import {useEditorInput} from './editor-input.mjs';
import {layout,wrapCells,smallHood,smallLogo,microHood,shortLogo} from './layout.mjs';
import {activity,useClock,boundary} from './activity.mjs';
import React, {useState,useEffect,useRef} from 'react';
import {Box,Text,useInput,useCursor,useStdout} from 'ink';
import {clean,edit,demoState} from './core.mjs';
import {hood,compactHood} from './art.mjs';
import {ToolScreen} from './tool-screen.mjs';
import {retroWordmark} from './retro.mjs';
const h=React.createElement, green='#C5F7D4', muted='#758D80', amber='#DAA85A';
const text=(value,props={})=>h(Text,{color:green,wrap:'truncate',...props},clean(value));
const portrait=(value,frame)=>h(Text,{color:'#8EE8AA'},...shimmerRuns(value,frame).map((run,i)=>h(Text,{key:i,color:run.color},run.text)));
const lettering=large=>text(retroWordmark({large}),{color:'#8EE8AA'});
const tracked=(value,width)=>{const spaced=[...value].join(' ');return spaced.length<=width?spaced:value;};
const panel=(title,children,props={})=>h(Box,{borderStyle:process.env.TIM_ASCII==='1'?'classic':'double',borderColor:'#8EE8AA',flexDirection:'column',paddingX:1,...props},text(title,{color:'#8EE8AA'}),...children);
export const help='/eta-reset  /reconnect  /retry  /tools  /agent N  /home  /new  /sessions  /session N  /models  /model N  /mode agent|chat|code  /help';
export function App({client,demo=false,onQuit,initial=demoState,staticPreview=false,dimensions,startTools=false,initialRequest='',animation=true,previewFrame=0,onSelection=()=>{}}) {
 const {setCursorPosition}=useCursor();const {stdout}=useStdout();
 const naturalController=useRef(null),naturalHistory=useRef([]),initialSent=useRef(false),pendingInitial=useRef(initialRequest);
 const [naturalMode,setNaturalMode]=useState(!!initialRequest);
 const [route,setRoute]=useState(null),[localMessages,setLocalMessages]=useState([]);
 const now=useClock(!staticPreview),pending=useRef(null),submitting=useRef(false);
 const selected=client?.selection||{provider:'local'},cloud=selected.provider!=='local';
 const [connected,setConnected]=useState(true),[connectionAttempt,setConnectionAttempt]=useState(0),[transport,setTransport]=useState(Date.now());
 const [toolsOpen,setToolsOpen]=useState(startTools);
 const [state,setState]=useState(initial),[sessionId,setSession]=useState(initial.sessions?.[0]?.id),[modelId,setModel]=useState(selected.modelId||''),[mode,setMode]=useState(cloud||selected.modelId?'chat':'agent'),[draft,setDraft]=useState({text:initialRequest,cursor:initialRequest.length}),[notice,setNotice]=useState(demo?'':'Connecting to local studio…'),[home,setHome]=useState(true),[busy,setBusy]=useState(false),[scroll,setScroll]=useState(0),[size,setSize]=useState({w:dimensions?.w||stdout.columns||120,h:dimensions?.h||stdout.rows||40});
 useEffect(()=>{if(staticPreview)return;const resize=()=>setSize({w:stdout.columns||80,h:stdout.rows||24});stdout.on('resize',resize);return()=>stdout.off('resize',resize);},[]);
 useEffect(()=>{if(demo||staticPreview||!client)return;let alive=true;client.watch(s=>{if(!alive)return;setConnected(true);setState(s);setSession(id=>id||s.sessions[0]?.id);setNotice(old=>old==='Connecting to local studio…'?boundary(selected):old);},{onTransport:setTransport}).catch(e=>{if(alive&&!client.controller.signal.aborted){setConnected(false);setNotice(e.message);}});return()=>{alive=false;client.watchController?.abort();};},[connectionAttempt]);

 const session=state.sessions?.find(s=>s.id===sessionId),jobs=(state.jobs||[]).filter(j=>j.sessionId===sessionId),active=jobs.find(j=>['running','queued'].includes(j.status));
 async function cancel(){if(naturalController.current){naturalController.current.abort();setNotice('Cancelling current plan/action; draft retained.');return;}if(demo){setNotice('SAMPLE DATA / no running job');return;}try{const current=active||(pending.current&&(await client.request('state')).jobs.find(j=>j.requestId===pending.current.id));if(!current){setNotice('No accepted job found; draft retained.');return;}await client.request('cancel',{id:current.id});setNotice('Cancellation requested');}catch(e){setNotice(e.message);}}
 async function submit(){if(submitting.current||busy||!draft.text.trim())return;submitting.current=true;const original=draft.text,input=draft.text.trim();setBusy(true);try{
  if(input.startsWith('/')&&help.split(/\s+/).includes(input.split(/\s+/)[0])){const [command,arg]=input.split(/\s+/,2);const number=Number(arg)-1;
   if(command==='/eta-reset'){await client.request('timing/reset',{});setNotice('Aggregate timing history reset. New estimates need five comparable completions.');}
   else if(command==='/reconnect'){setConnectionAttempt(n=>n+1);setNotice('Reconnecting only; no job resubmitted.');}
   else if(command==='/retry'){if(active)throw new Error('Cancel or finish the current job before retrying.');if(!['failed','cancelled','interrupted'].includes(jobs[0]?.status))throw new Error('No failed/cancelled turn to retry.');const previous=[...(session?.messages||[])].reverse().find(m=>m.role==='user');if(previous){setDraft({text:previous.content,cursor:previous.content.length});setNotice('Previous request restored. Review it, then Ctrl+S submits a NEW turn.');}return;}
   else if(command==='/tools'){setToolsOpen(true);}
   else if(command==='/agent'){if(cloud)throw new Error('Local agent mode is unavailable with a cloud provider. Restart with --provider local.');if(!client)throw new Error('Connect a local backend to configure an agent model.');const m=(state.models||[]).filter(m=>m.kind==='chat')[number];if(!m?.available)throw new Error('Choose an available model number from /models');await client.request('settings',{mainAgentModelId:m.id});setMode('agent');setNotice('Main agent model selected; native tool support still needs validation.');}
   else if(command==='/home'){setHome(true);setNotice('Welcome to TIM Studio');}
   else if(command==='/help')setNotice(help);
   else if(command==='/models'&&cloud){const result=await client.request('provider-models',{provider:selected.provider});setNotice(result.models.join('\n')+'\nRestart with --model ID to select a different cloud model.');}
   else if(command==='/models')setNotice((state.models||[]).filter(m=>m.kind==='chat').map((m,i)=>`${i+1}. ${m.name}${m.available?'':' (unavailable)'}`).join('\n')||'No chat models found. Configure the library in desktop Settings.');
   else if(command==='/model'){if(cloud)throw new Error('Select a cloud model with --model ID at launch.');const m=(state.models||[]).filter(m=>m.kind==='chat')[number];if(!m?.available)throw new Error('Choose an available model number from /models');setModel(m.id);client.selection={...selected,modelId:m.id};await onSelection(client.selection);setMode('chat');setNotice(`Chat model: ${m.name}. Agent uses the main model from Settings.`);if(pendingInitial.current)setDraft({text:pendingInitial.current,cursor:pendingInitial.current.length});}
   else if(command==='/mode'){if(cloud&&arg==='agent')throw new Error('Cloud agent mode is unsupported; use chat/code.');if(!['agent','chat','code'].includes(arg))throw new Error('Use /mode agent, chat or code');setMode(arg);}
   else if(command==='/sessions')setNotice((state.sessions||[]).map((s,i)=>`${i+1}. ${s.title}`).join('\n')||'No sessions yet. /new starts one.');
   else if(command==='/session'){const s=state.sessions[number];if(!s)throw new Error('Choose a session number from /sessions');setSession(s.id);setScroll(0);}
   else if(command==='/new'){if(demo)throw new Error('Demo sessions are sample data. Connect without --demo for real sessions.');const s=await client.request('sessions',{});setSession(s.id);setState(old=>({...old,sessions:[s,...old.sessions]}));setScroll(0);}
   else throw new Error('Unknown command. '+help);
  }else if((naturalMode||input.startsWith('/'))&&!demo){
   setNaturalMode(true);setHome(false);naturalController.current=new AbortController();setNotice('Interpreting request with '+selected.provider+' / no system action yet');
   try{const result=await naturalRequest(client,[...naturalHistory.current,input].join('\n'),{signal:naturalController.current.signal,onStatus:setNotice});
    pendingInitial.current='';naturalHistory.current.push(input);if(result.route)setRoute(result);else{setLocalMessages(old=>[...old,{role:'user',content:input},{role:'assistant',content:result.text}]);setNotice('Completed / local action output stays local');}
   }finally{naturalController.current=null;}
  }else if(demo){setHome(false);setNotice('SAMPLE DATA / submitted locally; no inference');setState(old=>({...old,sessions:old.sessions.map(s=>({...s,messages:[...s.messages,{role:'user',content:input},{role:'assistant',content:'Preview only. Connect to TIM Studio to run your configured models.',status:'completed'}]}))}));}
  else{if(!connected)throw new Error('Reconnect with Ctrl+R before sending. Draft preserved.');if(!client)throw new Error('Restart without --tools for local chat, or use --demo for a preview.');setHome(false);if(active)throw new Error('Wait for this session’s job, or press Esc to cancel.');if(mode!=='agent'&&!modelId)throw new Error('Select a chat model with /models then /model N');const payload={sessionId,kind:mode,modelId,provider:selected.provider,prompt:input,attachments:[]};const signature=JSON.stringify(payload);if(pending.current?.signature!==signature)pending.current={signature,id:crypto.randomUUID()};const job=await client.request('jobs',{...payload,requestId:pending.current.id});pending.current=null;setState(old=>({...old,jobs:[job,...old.jobs.filter(j=>j.id!==job.id)]}));setSession(job.sessionId);setNotice('Queued in TIM Studio');}
  setDraft(current=>current.text===original?{text:'',cursor:0}:current);setScroll(0);
 }catch(e){setNotice(e.message);}finally{submitting.current=false;setBusy(false);}}
 useEffect(()=>{if(initialRequest&&!initialSent.current&&!staticPreview&&usableTerminal(size.w,size.h)){initialSent.current=true;void submit();}return()=>{};},[size.w,size.h]);
 useEffect(()=>()=>naturalController.current?.abort(),[]);
 useEditorInput((input,key)=>{if(key.ctrl&&['c','q'].includes(input)){naturalController.current?.abort();onQuit();return;}if(key.escape){void cancel();return;}if(key.ctrl&&input==='r'){setConnectionAttempt(n=>n+1);setNotice('Reconnecting only; no resubmission.');return;}if(key.pageUp){setScroll(n=>n+5);return;}if(key.pageDown){setScroll(n=>Math.max(0,n-5));return;}if(key.return&&!key.meta||key.ctrl&&input==='s'){void submit();return;}setDraft(old=>edit(old,input,key));},{isActive:!staticPreview&&!toolsOpen&&!route});
 const inputWidth=Math.max(1,size.w-6),wrappedInput=wrapCells(draft.text,inputWidth,draft.cursor);
 const inputLines=wrappedInput.lines,{cursorRow,cursorCol}=wrappedInput;
 const inputRows=Math.min(3,inputLines.length),inputStart=Math.max(0,cursorRow-inputRows+1);
 const {wide,hero,large,variant,headerHeight,heroHeight,composerHeight,panelHeight:availablePanelHeight,showHeroCopy,heroSpare}=layout(size.w,size.h,home,active,inputRows);
 const animationFrame=useShimmer(animation&&!reducedMotion()&&!staticPreview&&stdout.isTTY&&hero&&!toolsOpen&&!route);
 const panelHeight=hero?Math.min(large?10:8,availablePanelHeight):availablePanelHeight;
 const spare=availablePanelHeight-panelHeight+heroSpare;
 const sidePanels=hero&&size.w>=100,bodyHeight=Math.max(0,panelHeight-3);
 const narrowArt=['narrow','small','micro'].includes(variant);
 const mark=narrowArt?(variant==='micro'||variant==='small'?shortLogo:smallLogo):retroWordmark({large});
 const logoWidth=Math.max(...mark.split('\n').map(line=>line.length));
 const heroArt=variant==='micro'?microHood:variant==='small'?smallHood:large||variant==='balanced'?hood:compactHood;
 const logoTop=large?1:variant==='balanced'?1:0;
 const rightHeroHeight=Math.min(heroHeight,logoTop+mark.split('\n').length+(showHeroCopy?3:0));
 const groupWidth=Math.max(...heroArt.split('\n').map(line=>line.length))+logoWidth+(large?5:4);
 const heroLeft=Math.max(0,Math.floor((size.w-2-groupWidth)/2));
 const portraitPadding=Math.max(0,rightHeroHeight-heroArt.split('\n').length);
 const content=(localMessages.length?localMessages:session?.messages||[]).map(m=>`${m.role==='user'?'YOU':'TIM'}${m.status?' / '+m.status:''}\n${m.content||'Waiting for response.'}${m.error?'\n'+m.error:''}${m.artifact?'\nArtifact: '+m.artifact.filename:''}${m.steps?.length?'\n'+m.steps.map(s=>`${s.status}: ${s.tool||s.kind} - ${s.phase||''}`).join('\n'):''}`).join('\n\n')||'No task running.\n\nStart with a request below.';
 const width=Math.max(1,size.w-(wide&&!hero?38:6)),lines=clean(notice.includes('\n')?notice:content).split('\n').flatMap(line=>wrapCells(line,width).lines);
 const visible=lines.slice(Math.max(0,lines.length-bodyHeight-scroll),Math.max(0,lines.length-scroll));
 const model=cloud?selected.modelId:(state.models||[]).find(m=>m.id===(mode==='agent'?state.config?.mainAgentModelId:modelId))?.name||'not selected';
 setCursorPosition(!staticPreview&&!toolsOpen&&usableTerminal(size.w,size.h)?{x:3+cursorCol,y:size.h-composerHeight+cursorRow-inputStart}:undefined);
 if(route?.route==='desktop')return h(DesktopScreen,{client,request:route.request,onQuit:()=>setRoute(null)});
 if(route?.route==='images')return h(ImageScreen,{...route,onQuit:()=>setRoute(null)});
 if(route)return h(route.route==='install'?InstallScreen:ListenScreen,{client,request:route.request,onQuit:()=>setRoute(null)});
 if(toolsOpen)return h(ToolScreen,{size,onBack:()=>setToolsOpen(false),onQuit});
 if(!usableTerminal(size.w,size.h))return h(WidthMessage,{w:size.w,h:size.h});
 const workspace=[text('project    smooth-operator'),text('mode       '+mode+' / '+selected.provider),text('model      '+model,{wrap:'truncate'}),text(' '),text('/models    /tools    /help',{color:muted})];
 const idleSession=[text('No task running.'),text(' '),text(session?.messages?.length?`${session.messages.length} messages in the selected session.`:'Start with a request below.'),text(' '),text('Responses and tool activity appear here.',{color:muted})];
 return h(Box,{flexDirection:'column',width:size.w,height:Math.max(1,size.h-1),paddingX:1,overflow:'hidden',backgroundColor:'#080D0B'},
  h(Box,{height:headerHeight,flexShrink:0,flexDirection:'column',paddingTop:headerHeight>=4?1:0},
   h(Box,{justifyContent:'space-between',height:1,flexShrink:0},text('TIM / STUDIO',{bold:true,color:'#8EE8AA'}),text(demo?'SAMPLE STATE'+(cloud?' / '+selected.provider.toUpperCase():''):cloud?selected.provider.toUpperCase()+' / CLOUD':active?'WORKING':'LOCAL',{color:amber})),
   headerHeight>=3?h(Box,{justifyContent:'space-between'},text('smooth-operator',{color:muted}),text(active?active.phase:cloud?'Typed requests sent to cloud':'READY',{color:muted,wrap:'truncate'})):null,
   headerHeight>=3?text((process.env.TIM_ASCII==='1'?'-':'═').repeat(Math.max(1,size.w-2)),{color:'#8EE8AA'}):null),
  hero&&spare?h(Box,{height:Math.min(1,spare),flexShrink:0}):null,
  hero&&variant==='stacked'?h(Box,{height:heroHeight,flexShrink:0,flexDirection:'column',alignItems:'center'},portrait(heroArt,!animation||reducedMotion()?-1:staticPreview?previewFrame:animationFrame),text(' '),text(mark,{color:'#8EE8AA'}),showHeroCopy?text('\nYOUR WORK. ONE TERMINAL.',{bold:true}):null,showHeroCopy?text('> What are we building?',{color:amber,bold:true}):null):hero?h(Box,{height:heroHeight,flexShrink:0,gap:large?5:4,paddingLeft:heroLeft},h(Box,{paddingTop:portraitPadding,flexShrink:0},portrait(heroArt,!animation||reducedMotion()?-1:staticPreview?previewFrame:animationFrame)),h(Box,{flexDirection:'column',paddingTop:logoTop,minWidth:0,flexShrink:1},text(mark,{color:'#8EE8AA'}),showHeroCopy?text('\n'+(large?tracked('YOUR WORK. ONE TERMINAL.',logoWidth):narrowArt?'YOUR WORK. ONE TERMINAL.':'YOUR WORK. ONE TERMINAL.'),{color:'#C5F7D4',bold:true}):null,showHeroCopy?text((large?tracked('> What are we building?',logoWidth):narrowArt?'> What are we building?':'> What are we building?'),{color:amber,bold:true}):null)):null,
  hero&&spare?h(Box,{height:Math.min(1,Math.max(0,spare-1)),flexShrink:0}):null,
  panelHeight>0?h(Box,{height:panelHeight,flexShrink:0,overflow:'hidden',gap:1},
   sidePanels?panel('WORKSPACE',workspace.slice(0,bodyHeight),{width:Math.floor((size.w-3)*0.42),overflow:'hidden'}):panel('SESSION / '+(session?.title||'new session'),[text(visible.join('\n'))],{flexGrow:1,flexBasis:0,overflow:'hidden'}),
   sidePanels?panel('SESSION',notice.includes('\n')?[text(visible.join('\n'))]:idleSession.slice(0,bodyHeight),{flexGrow:1,flexBasis:0,overflow:'hidden'}):wide&&!hero?panel('WORKSPACE',[text(('MODE    '+mode+'\nMODEL   '+model+'\n\n'+(active?active.phase:'Idle / ready')+'\n'+(active?activity(active,now).text.split(' | ').join('\n')+'\n'+activity(active,now).heartbeat:'')+'\n'+(connected?'Backend stream age '+Math.max(0,Math.floor((now-transport)/1000))+'s':'DISCONNECTED / Ctrl+R')+'\nEsc cancel / /retry restores draft').split('\n').slice(0,bodyHeight).join('\n'))],{width:31,overflow:'hidden'}):null):null,
  hero&&spare>2?h(Box,{height:spare-2,flexShrink:0}):null,
  h(Box,{height:1,flexShrink:0},text((active&&connected?activity(active,now).text+(activity(active,now).stale?' / NO RECENT ACTIVITY; Esc cancel':' / UI clock only'):cloud&&!notice?boundary(selected):notice.split('\n').slice(0,2).join('  |  ')),{color:amber,wrap:'truncate'})),
  panel('COMMAND'+(busy?' / sending':''),[text(draft.text?inputLines.slice(inputStart,inputStart+inputRows).join('\n'):'Ask TIM to build, fix, or explore...',{color:draft.text?green:muted})],{borderColor:busy?amber:green,height:composerHeight,flexShrink:0,overflow:'hidden'}),
  text(size.w<100?'Enter send  Ctrl+J newline  Esc cancel  Ctrl+Q quit':'Enter send  Ctrl+J newline  Esc cancel  Ctrl+R reconnect  PgUp/Dn scroll  Ctrl+Q quit',{color:muted,wrap:'truncate'}));
}
