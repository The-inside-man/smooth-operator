import {useShimmer,reducedMotion} from './animation.mjs';
import {sceneRuns} from './scene.mjs';
import {DesktopScreen} from './desktop-screen.mjs';
import {usableTerminal,WidthMessage} from './terminal-boundary.mjs';
import {ImageScreen} from './image-screen.mjs';
import {naturalRequest} from './natural.mjs';
import {InstallScreen} from './install-screen.mjs';
import {ListenScreen} from './listen-screen.mjs';
import {useEditorInput} from './editor-input.mjs';
import {scrollAction,scrollWindow,pagePosition} from './scroll.mjs';
import {layout,wrapCells} from './layout.mjs';
import {activity,useClock,boundary} from './activity.mjs';
import React, {useState,useEffect,useRef,useMemo} from 'react';
import {Box,Text,useInput,useCursor,useStdout} from 'ink';
import {clean,demoState} from './core.mjs';
import {portraitForLayout,asciiPortrait} from './art.mjs';
import {ToolScreen} from './tool-screen.mjs';
import {ModelScreen} from './model-screen.mjs';
import {getModelChoices} from './model-recommendations.mjs';
import {LocalSetupScreen} from './local-setup-screen.mjs';
import {ProviderScreen} from './provider-screen.mjs';
import {retroWordmark} from './retro.mjs';
import {tokenCommandPatch,tokenSettingsNotice,saveTokenSettings,responseBudgetLabel,contextBudgetLabel} from './token-settings.mjs';
import {memoryStatus,memoryRows,readMemory,unloadMemory} from './memory-status.mjs';
import {historyScope,sessionHistory,useCommandHistory} from './history.mjs';
const h=React.createElement, green='#C5F7D4', muted='#758D80', amber='#DAA85A';
const text=(value,props={})=>h(Text,{color:green,wrap:'truncate',...props},clean(value));
const scene=(options,frame)=>h(Text,{wrap:'truncate'},...sceneRuns(options,frame).map((run,i)=>h(Text,{key:i,color:run.color,backgroundColor:run.backgroundColor,bold:run.bold},run.text)));
const tracked=(value,width)=>{const spaced=[...value].join(' ');return spaced.length<=width?spaced:value;};
const panel=(title,children,props={})=>h(Box,{borderStyle:process.env.TIM_ASCII==='1'?'classic':'double',borderColor:'#8EE8AA',flexDirection:'column',paddingX:1,...props},text(title,{color:'#8EE8AA'}),...children);
export const help='/setup  /providers  /memory  /unload idle|NUMBER  /tokens auto|NUMBER  /context NUMBER  /eta-reset  /reconnect  /retry  /tools  /agent N  /home  /new  /sessions  /session N  /models  /model N  /mode agent|chat|code  /help';
export function App({client,demo=false,onQuit,initial=demoState,staticPreview=false,dimensions,startTools=false,startSetup=false,initialRequest='',animation=true,previewFrame=0,onSelection=()=>{}}) {
 const {setCursorPosition}=useCursor();const {stdout}=useStdout();
 const naturalController=useRef(null),naturalHistory=useRef([]),initialSent=useRef(false),pendingInitial=useRef(initialRequest);
 const pendingScroll=useRef([]);
 const shownMemory=useRef([]);
 const [naturalMode,setNaturalMode]=useState(!!initialRequest);
 const [route,setRoute]=useState(null),[localMessages,setLocalMessages]=useState([]);
 const now=useClock(!staticPreview),pending=useRef(null),submitting=useRef(false);
 const selected=client?.selection||{provider:'local'},cloud=selected.provider!=='local';
 const initialMode=cloud||selected.modelId?'chat':'agent';
 const [modelsOpen,setModelsOpen]=useState(()=>!demo&&!cloud&&!!client&&!startTools&&!startSetup&&!initial.models?.some(m=>m.kind==='chat'&&m.available&&m.id===(initialMode==='agent'?initial.config?.mainAgentModelId:selected.modelId)));
 const [setupOpen,setSetupOpen]=useState(startSetup),[setupTarget,setSetupTarget]=useState(null),[providersOpen,setProvidersOpen]=useState(false);
 const [connected,setConnected]=useState(true),[connectionAttempt,setConnectionAttempt]=useState(0),[transport,setTransport]=useState(Date.now());
 const [toolsOpen,setToolsOpen]=useState(startTools);
 const [state,setState]=useState(initial),[sessionId,setSession]=useState(initial.sessions?.[0]?.id),[modelId,setModel]=useState(selected.modelId||''),[mode,setMode]=useState(initialMode),[notice,setNotice]=useState(demo?'':'Connecting to local studio…'),[home,setHome]=useState(true),[busy,setBusy]=useState(false),[scroll,setScroll]=useState(null),[size,setSize]=useState({w:dimensions?.w||stdout.columns||120,h:dimensions?.h||stdout.rows||40});
 useEffect(()=>{if(staticPreview)return;const resize=()=>setSize({w:stdout.columns||80,h:stdout.rows||24});stdout.on('resize',resize);return()=>stdout.off('resize',resize);},[]);
 useEffect(()=>{if(demo||staticPreview||!client)return;let alive=true;client.watch(s=>{if(!alive)return;setConnected(true);setState(s);setSession(id=>id||s.sessions[0]?.id);setNotice(old=>old==='Connecting to local studio…'?boundary(selected):old);},{onTransport:setTransport}).catch(e=>{if(alive&&!client.controller.signal.aborted){setConnected(false);setNotice(e.message);}});return()=>{alive=false;client.watchController?.abort();};},[connectionAttempt]);

 const session=state.sessions?.find(s=>s.id===sessionId),jobs=(state.jobs||[]).filter(j=>j.sessionId===sessionId),active=jobs.find(j=>['running','queued'].includes(j.status));
 const provider=selected.provider||'local',recallScope=historyScope(provider,sessionId);
 // Each scope is seeded once; token/animation updates must not scan old prompts.
 const recallSeed=useMemo(()=>sessionHistory(session,provider),[recallScope]);
 const {draft,setDraft,editDraft,remember,getDraft}=useCommandHistory({initialDraft:{text:initialRequest,cursor:initialRequest.length},scope:recallScope,provider,seed:recallSeed});
 const currentScope=useRef(recallScope);currentScope.current=recallScope;
 useEffect(()=>{naturalHistory.current=[];setLocalMessages([]);},[recallScope]);
 function openModelSetup(choice,targetMode=mode){
  if(!choice?.catalogId)throw new Error('Choose a downloadable model from /models.');
  setSetupTarget({catalogId:choice.catalogId,mode:targetMode});setSetupOpen(true);
 }
 async function chooseModel(choice,targetMode=mode){
  const model=state.models?.find(m=>m.id===choice.id&&m.kind==='chat'&&m.available);
  if(!model)throw new Error('That model is no longer available. Refresh the list and choose another.');
  if(targetMode==='agent'){
   await client.request('settings',{mainAgentModelId:model.id});
   setState(old=>({...old,config:{...old.config,mainAgentModelId:model.id}}));
  }
  const next={...selected,modelId:model.id};if(targetMode!=='agent')await onSelection(next);client.selection=next;setModel(model.id);setMode(targetMode);
  setModelsOpen(false);setHome(false);setScroll(null);
  setNotice(`${targetMode==='agent'?'Agent':targetMode==='code'?'Code':'Chat'} model: ${model.name}. ${draft.text?'Your request is ready; press Enter to send.':'Enter a request below.'}`);
 }
 async function refreshModels(){await client.request('rescan',{});setState(await client.request('setup/options'));}
 async function finishSetup(snapshot){
  const targetMode=setupTarget?.mode||'agent';
  const model=snapshot.models?.find(m=>m.kind==='chat'&&m.available&&(targetMode==='agent'?m.id===snapshot.config?.mainAgentModelId:m.catalogId===(snapshot.localSetup?.catalogId||setupTarget?.catalogId)));
  if(!model)throw new Error('Setup has not produced an available chat model yet.');
  const next={provider:'local',modelId:model.id};await onSelection(next);client.selection=next;
  setState(snapshot);setModel(model.id);setMode(targetMode);setSetupTarget(null);setSetupOpen(false);setModelsOpen(false);setHome(false);
  setNotice(`Local model ready: ${model.name}. ${draft.text?'Your request is ready; press Enter to send.':'Enter a request below.'}`);
 }
 async function cancel(){if(naturalController.current){naturalController.current.abort();setNotice('Cancelling current plan/action; draft retained.');return;}if(demo){setNotice('SAMPLE DATA / no running job');return;}try{const current=active||(pending.current&&(await client.request('state')).jobs.find(j=>j.requestId===pending.current.id));if(!current){setNotice('No accepted job found; draft retained.');return;}await client.request('cancel',{id:current.id});setNotice('Cancellation requested');}catch(e){setNotice(e.message);}}
 // The ref owns admission; a just-rendered error can precede Ink's handler refresh.
 async function submit(){const currentDraft=getDraft();if(submitting.current||!currentDraft.text.trim())return;submitting.current=true;const original=currentDraft.text,input=currentDraft.text.trim();let acceptedScope=recallScope;setBusy(true);try{
  const commandInput=input.startsWith('/')&&help.split(/\s+/).includes(input.split(/\s+/)[0]);
  if(!commandInput&&!demo&&!cloud&&client){
   const id=naturalMode||input.startsWith('/')?selected.modelId||state.loadedModelId||state.config?.mainAgentModelId:mode==='agent'?state.config?.mainAgentModelId:modelId;
   if(!state.models?.some(m=>m.id===id&&m.kind==='chat'&&m.available)){setModelsOpen(true);setNotice('Choose a model. Your request is saved.');return;}
  }
  if(commandInput){const [command,arg]=input.split(/\s+/,2);const number=Number(arg)-1;
   if(command==='/setup'){if(demo||!client)throw new Error('Run tim setup to browse supported local models.');if(cloud)throw new Error('Run tim setup from your shell to configure local models. /providers explains cloud setup.');setSetupTarget(null);setSetupOpen(true);}
   else if(command==='/providers'){setProvidersOpen(true);}
   else if(command==='/memory'){
    if(input.split(/\s+/).length!==1)throw new Error('Use /memory to inspect current RAM and loaded model processes.');
    const next=demo?state:await readMemory(client);shownMemory.current=memoryRows(next);setState(next);setNotice(memoryStatus(next,{demo}));setHome(false);
   }
   else if(command==='/unload'){
    if(demo)throw new Error('Demo memory is sample data. Connect without --demo to unload idle model processes.');
    const result=await unloadMemory(client,{args:input.split(/\s+/).slice(1),shown:shownMemory.current,snapshot:state});
    shownMemory.current=memoryRows(result.snapshot);setState(result.snapshot);setNotice(result.message+'\n'+memoryStatus(result.snapshot));setHome(false);
   }
   else if(command==='/tokens'||command==='/context'){
    const patch=tokenCommandPatch(command,input.split(/\s+/).slice(1));
    if(patch){if(demo)throw new Error('Demo settings are sample data. Connect without --demo to save response settings.');const next=await saveTokenSettings(client,patch,state);setState(next);setNotice('Saved response settings.\n'+tokenSettingsNotice(next.config,command));}
    else setNotice(tokenSettingsNotice(state.config,command));
    setHome(false);
   }
   else if(command==='/eta-reset'){await client.request('timing/reset',{});setNotice('Aggregate timing history reset. New estimates need five comparable completions.');}
   else if(command==='/reconnect'){setConnectionAttempt(n=>n+1);setNotice('Reconnecting only; no job resubmitted.');}
   else if(command==='/retry'){if(active)throw new Error('Cancel or finish the current job before retrying.');if(!['failed','cancelled','interrupted'].includes(jobs[0]?.status))throw new Error('No failed/cancelled turn to retry.');const previous=[...(session?.messages||[])].reverse().find(m=>m.role==='user');if(previous){remember(input);setDraft({text:previous.content,cursor:previous.content.length});setNotice('Previous request restored. Review it, then Ctrl+S submits a NEW turn.');}return;}
   else if(command==='/tools'){setToolsOpen(true);}
   else if(command==='/agent'){if(cloud)throw new Error('Local agent mode is unavailable with a cloud provider. Restart with --provider local.');if(!client)throw new Error('Connect a local backend to configure an agent model.');const m=getModelChoices(state).choices[number];if(!m)throw new Error('Choose a model number from /models');if(!m.available&&m.catalogId)openModelSetup(m,'agent');else await chooseModel(m,'agent');}
   else if(command==='/home'){setHome(true);setNotice('Welcome to TIM Studio');}
   else if(command==='/help'){setHome(false);setNotice('KEYBOARD / use Control on Mac, not Command\nCtrl+P previous page / Ctrl+N next page / Ctrl+L latest output\nUp/Down recalls older/newer requests and commands; Enter runs the recalled text.\nDown past newest restores your unsent draft. Multiline drafts edit until a boundary.\nTwo-finger trackpad / mouse wheel scrolls messages and lists.\nTerminal on Mac: View > Allow Mouse Reporting.\niTerm2: Profiles > Terminal > Enable mouse reporting + Report mouse wheel events.\nRestart with --no-mouse for native terminal selection/scrollback.\nOption+Up/Down also pages when forwarded by your terminal.\nEnter send / Ctrl+J newline / Esc cancel / Ctrl+Q quit\n\nRESPONSE SETTINGS\n'+tokenSettingsNotice(state.config)+'\n\nMODEL MEMORY\n/memory shows measured resident RAM and loaded model processes.\n/unload or /unload idle releases idle non-guide models.\n/unload NUMBER uses the last /memory list, not /models numbering.\n\nCOMMANDS\n'+help);}
   else if(command==='/models'&&cloud){const result=await client.request('provider-models',{provider:selected.provider});setNotice(result.models.join('\n')+'\nRestart with --model ID to select a different cloud model.');}
   else if(command==='/models'){if(demo)setNotice('SAMPLE DATA / connect a local backend to choose a model.');else setModelsOpen(true);}
   else if(command==='/model'){if(cloud)throw new Error('Select a cloud model with --model ID at launch.');const m=getModelChoices(state).choices[number];if(!m)throw new Error('Choose a model number from /models');if(!m.available&&m.catalogId)openModelSetup(m,'chat');else await chooseModel(m,'chat');if(pendingInitial.current)setDraft({text:pendingInitial.current,cursor:pendingInitial.current.length});}
   else if(command==='/mode'){if(cloud&&arg==='agent')throw new Error('Cloud agent mode is unsupported; use chat/code.');if(!['agent','chat','code'].includes(arg))throw new Error('Use /mode agent, chat or code');setMode(arg);}
   else if(command==='/sessions')setNotice((state.sessions||[]).map((s,i)=>`${i+1}. ${s.title}`).join('\n')||'No sessions yet. /new starts one.');
   else if(command==='/session'){const s=state.sessions[number];if(!s)throw new Error('Choose a session number from /sessions');setSession(s.id);setScroll(null);}
   else if(command==='/new'){if(demo)throw new Error('Demo sessions are sample data. Connect without --demo for real sessions.');const s=await client.request('sessions',{});setSession(s.id);setState(old=>({...old,sessions:[s,...old.sessions]}));setScroll(null);}
   else throw new Error('Unknown command. '+help);
  }else if((naturalMode||input.startsWith('/'))&&!demo){
   setNaturalMode(true);setHome(false);naturalController.current=new AbortController();setNotice('Interpreting request with '+selected.provider+' / no system action yet');
   try{const result=await naturalRequest(client,[...naturalHistory.current,input].join('\n'),{signal:naturalController.current.signal,onStatus:setNotice});
    pendingInitial.current='';if(currentScope.current===recallScope){naturalHistory.current.push(input);if(result.route)setRoute(result);else{setLocalMessages(old=>[...old,{role:'user',content:input},{role:'assistant',content:result.text}]);setNotice('Completed / local action output stays local');}}
   }finally{naturalController.current=null;}
  }else if(demo){setHome(false);setNotice('SAMPLE DATA / submitted locally; no inference');setState(old=>({...old,sessions:old.sessions.map(s=>({...s,messages:[...s.messages,{role:'user',content:input},{role:'assistant',content:'Preview only. Connect to TIM Studio to run your configured models.',status:'completed'}]}))}));}
  else{if(!connected)throw new Error('Reconnect with Ctrl+R before sending. Draft preserved.');if(!client)throw new Error('Restart without --tools for local chat, or use --demo for a preview.');setHome(false);if(active)throw new Error('Wait for this session’s job, or press Esc to cancel.');if(mode!=='agent'&&!modelId)throw new Error('Select a chat model with /models then /model N');const payload={sessionId,kind:mode,modelId,provider:selected.provider,prompt:input,attachments:[]};const signature=JSON.stringify(payload);if(pending.current?.signature!==signature)pending.current={signature,id:crypto.randomUUID()};const job=await client.request('jobs',{...payload,requestId:pending.current.id});pending.current=null;acceptedScope=historyScope(provider,job.sessionId);setState(old=>({...old,jobs:[job,...old.jobs.filter(j=>j.id!==job.id)]}));setSession(job.sessionId);setNotice('Queued in TIM Studio');}
  remember(input,acceptedScope);
  setDraft(current=>current.text===original?{text:'',cursor:0}:current);setScroll(commandInput&&['/help','/memory','/unload','/tokens','/context'].includes(input.split(/\s+/)[0])?0:null);
 }catch(e){setNotice(e.message);}finally{submitting.current=false;setBusy(false);}}
 useEffect(()=>{if(initialRequest&&!initialSent.current&&!staticPreview&&usableTerminal(size.w,size.h)){initialSent.current=true;if(!modelsOpen&&!setupOpen)void submit();}return()=>{};},[size.w,size.h]);
 useEffect(()=>()=>naturalController.current?.abort(),[]);
 useEditorInput((input,key)=>{if(key.ctrl&&['c','q'].includes(input)){naturalController.current?.abort();onQuit();return;}if(key.escape){void cancel();return;}if(key.ctrl&&input==='r'){setConnectionAttempt(n=>n+1);setNotice('Reconnecting only; no resubmission.');return;}const action=scrollAction(input,key);if(action){if(hero){pendingScroll.current.push(action);setHome(false);}else setScroll(position=>pagePosition(position,action,lines.length,bodyHeight));return;}if(key.return&&!key.meta||key.ctrl&&input==='s'){void submit();return;}editDraft(input,key);},{isActive:!staticPreview&&!toolsOpen&&!route&&!modelsOpen&&!setupOpen&&!providersOpen});
 const inputWidth=Math.max(1,size.w-6),wrappedInput=wrapCells(draft.text,inputWidth,draft.cursor);
 const inputLines=wrappedInput.lines,{cursorRow,cursorCol}=wrappedInput;
 const inputRows=Math.min(3,inputLines.length),inputStart=Math.max(0,cursorRow-inputRows+1);
 const {wide,hero,large,variant,headerHeight,heroHeight,composerHeight,panelHeight:availablePanelHeight,showHeroCopy,heroSpare}=layout(size.w,size.h,home,active,inputRows);
 const animationFrame=useShimmer(animation&&!reducedMotion()&&!staticPreview&&stdout.isTTY&&hero&&!toolsOpen&&!route);
 const panelHeight=hero?Math.min(large?10:8,availablePanelHeight):availablePanelHeight;
 const spare=availablePanelHeight-panelHeight+heroSpare;
 const sidePanels=hero&&size.w>=100,bodyHeight=Math.max(0,panelHeight-3);
 const narrowArt=['narrow','small','micro'].includes(variant);
 const wordmarkOptions={variant:narrowArt?(variant==='micro'||variant==='small'?'short':'narrow'):large?'large':'compact',ascii:process.env.TIM_ASCII==='1'};
 const mark=retroWordmark(wordmarkOptions);
 const logoWidth=Math.max(...mark.split('\n').map(line=>line.length));
 const selectedArt=portraitForLayout({variant,heroHeight});
 const heroArt=process.env.TIM_ASCII==='1'||Object.hasOwn(process.env,'NO_COLOR')||process.env.FORCE_COLOR==='0'?asciiPortrait(selectedArt):selectedArt;
 const logoTop=large?1:variant==='balanced'?1:0;
 const rightHeroHeight=Math.min(heroHeight,logoTop+mark.split('\n').length+(showHeroCopy?3:0));
 const groupWidth=Math.max(...heroArt.split('\n').map(line=>line.length))+logoWidth+(large?5:4);
 const heroLeft=Math.max(0,Math.floor((size.w-2-groupWidth)/2));
 const portraitPadding=Math.max(0,rightHeroHeight-heroArt.split('\n').length);
 const artWidth=Math.max(...heroArt.split('\n').map(line=>line.length)),stacked=variant==='stacked';
 const sceneOptions={width:size.w-2,height:heroHeight,art:heroArt,
  portraitX:stacked?Math.floor((size.w-2-artWidth)/2):heroLeft,portraitY:stacked?0:portraitPadding,
  wordmarkX:stacked?Math.floor((size.w-2-logoWidth)/2):heroLeft+artWidth+(large?5:4),wordmarkY:stacked?heroArt.split('\n').length+1:logoTop,wordmarkOptions,
  caption:showHeroCopy?[large?tracked('YOUR WORK. ONE TERMINAL.',logoWidth):'YOUR WORK. ONE TERMINAL.',large?tracked('> What are we building?',logoWidth):'> What are we building?']:null,
  captionY:(stacked?heroArt.split('\n').length+1:logoTop)+mark.split('\n').length+1};
 const content=(localMessages.length?localMessages:session?.messages||[]).map(m=>`${m.role==='user'?'YOU':'TIM'}${m.status?' / '+m.status:''}\n${m.content||'Waiting for response.'}${m.error?'\n'+m.error:''}${m.artifact?'\nArtifact: '+m.artifact.filename:''}${m.steps?.length?'\n'+m.steps.map(s=>`${s.status}: ${s.tool||s.kind} - ${s.phase||''}`).join('\n'):''}`).join('\n\n')||'No task running.\n\nStart with a request below.';
 const width=Math.max(1,size.w-(wide&&!hero?38:6)),noticeLines=clean(notice).split('\n').flatMap(line=>wrapCells(line,width).lines),showNotice=notice.includes('\n')||noticeLines.length>1;
 const lines=showNotice?noticeLines:clean(content).split('\n').flatMap(line=>wrapCells(line,width).lines);
 const view=scrollWindow(lines.length,bodyHeight,scroll),visible=lines.slice(view.start,view.end);
 useEffect(()=>{
  if(pendingScroll.current.length){const actions=pendingScroll.current;pendingScroll.current=[];setScroll(position=>actions.reduce((next,action)=>pagePosition(next,action,lines.length,bodyHeight),position));}
  else if(scroll!==null&&scroll>view.maximum)setScroll(view.maximum);
 },[home,lines.length,bodyHeight,scroll]);
 const reviewStatus=scroll!==null?`Review lines ${view.start+1}-${view.end} of ${view.total} / Ctrl+L latest${active?' / response continues':''}`:null;
 const model=cloud?selected.modelId:(state.models||[]).find(m=>m.id===(mode==='agent'?state.config?.mainAgentModelId:modelId))?.name||'not selected';
 setCursorPosition(!staticPreview&&!toolsOpen&&!modelsOpen&&!setupOpen&&!providersOpen&&usableTerminal(size.w,size.h)?{x:3+cursorCol,y:size.h-composerHeight+cursorRow-inputStart}:undefined);
 if(route?.route==='desktop')return h(DesktopScreen,{client,request:route.request,onQuit:()=>setRoute(null)});
 if(route?.route==='images')return h(ImageScreen,{...route,onQuit:()=>setRoute(null)});
 if(route)return h(route.route==='install'?InstallScreen:ListenScreen,{client,request:route.request,onQuit:()=>setRoute(null)});
 if(toolsOpen)return h(ToolScreen,{size,onBack:()=>setToolsOpen(false),onQuit});
 if(!usableTerminal(size.w,size.h))return h(WidthMessage,{w:size.w,h:size.h});
 if(providersOpen)return h(ProviderScreen,{size,initialProvider:cloud?selected.provider:'openai',onBack:()=>setProvidersOpen(false),onQuit,staticPreview});
 if(setupOpen)return h(LocalSetupScreen,{size,client,initial:state,initialCatalogId:setupTarget?.catalogId||'',startInReview:Boolean(setupTarget),mode:setupTarget?.mode||'agent',onReady:finishSetup,onBack:()=>{setSetupOpen(false);setSetupTarget(null);setModelsOpen(true);},onQuit,staticPreview});
 if(modelsOpen)return h(ModelScreen,{size,models:state.models,catalog:state.catalog,memory:state.memory,hardware:state.hardware,currentModelId:mode==='agent'?state.config?.mainAgentModelId:modelId,mode,draft:draft.text,onSelect:chooseModel,onDownload:openModelSetup,onRefresh:refreshModels,onSetup:()=>{setSetupTarget(null);setSetupOpen(true);},onProviders:()=>setProvidersOpen(true),onBack:()=>{setModelsOpen(false);setNotice('Request preserved. Choose a model with /models, or submit to choose.');},onQuit,staticPreview});
 const workspace=[text('project    smooth-operator'),text('mode       '+mode+' / '+selected.provider),text('model      '+model,{wrap:'truncate'}),text('response   '+responseBudgetLabel(state.config)),text('context    '+contextBudgetLabel(state.config)),text('/memory    /unload idle',{color:muted}),text('/tokens    /context',{color:muted}),text('/models    /tools    /help',{color:muted})];
 const idleSession=[text('No task running.'),text(' '),text(session?.messages?.length?`${session.messages.length} messages in the selected session.`:'Start with a request below.'),text(' '),text('Responses and tool activity appear here.',{color:muted})];
 return h(Box,{flexDirection:'column',width:size.w,height:Math.max(1,size.h-1),paddingX:1,overflow:'hidden',backgroundColor:'#080D0B'},
  h(Box,{height:headerHeight,flexShrink:0,flexDirection:'column',paddingTop:headerHeight>=4?1:0},
   h(Box,{justifyContent:'space-between',height:1,flexShrink:0},text('TIM / STUDIO',{bold:true,color:'#8EE8AA'}),text(demo?'SAMPLE STATE'+(cloud?' / '+selected.provider.toUpperCase():''):cloud?selected.provider.toUpperCase()+' / CLOUD':active?'WORKING':'LOCAL',{color:amber})),
   headerHeight>=3?h(Box,{justifyContent:'space-between'},text('smooth-operator',{color:muted}),text(active?active.phase:cloud?'Typed requests sent to cloud':'READY',{color:muted,wrap:'truncate'})):null,
   headerHeight>=3?text((process.env.TIM_ASCII==='1'?'-':'═').repeat(Math.max(1,size.w-2)),{color:'#8EE8AA'}):null),
  hero&&spare?h(Box,{height:Math.min(1,spare),flexShrink:0}):null,
  hero?h(Box,{height:heroHeight,flexShrink:0},scene(sceneOptions,!animation||reducedMotion()?-1:staticPreview?previewFrame:animationFrame)):null,
  hero&&spare?h(Box,{height:Math.min(1,Math.max(0,spare-1)),flexShrink:0}):null,
  panelHeight>0?h(Box,{height:panelHeight,flexShrink:0,overflow:'hidden',gap:1},
   sidePanels?panel('WORKSPACE',workspace.slice(0,bodyHeight),{width:Math.floor((size.w-3)*0.42),overflow:'hidden'}):panel('SESSION / '+(session?.title||'new session'),[text(visible.join('\n'))],{flexGrow:1,flexBasis:0,overflow:'hidden'}),
   sidePanels?panel('SESSION',showNotice?[text(visible.join('\n'))]:idleSession.slice(0,bodyHeight),{flexGrow:1,flexBasis:0,overflow:'hidden'}):wide&&!hero?panel('WORKSPACE',[text(('MODE    '+mode+'\nMODEL   '+model+'\nTOKENS  '+responseBudgetLabel(state.config)+'\nCONTEXT '+contextBudgetLabel(state.config)+'\n'+(active?active.phase:'Idle / ready')+'\n'+(active?activity(active,now).text.split(' | ').join('\n')+'\n'+activity(active,now).heartbeat:'')+'\n'+(connected?'Backend stream age '+Math.max(0,Math.floor((now-transport)/1000))+'s':'DISCONNECTED / Ctrl+R')+'\nEsc cancel / /retry restores draft').split('\n').slice(0,bodyHeight).join('\n'))],{width:31,overflow:'hidden'}):null):null,
  hero&&spare>2?h(Box,{height:spare-2,flexShrink:0}):null,
  h(Box,{height:1,flexShrink:0},text(reviewStatus||(active&&connected?activity(active,now).text+(activity(active,now).stale?' / NO RECENT ACTIVITY; Esc cancel':' / UI clock only'):cloud&&!notice?boundary(selected):notice.split('\n').slice(0,2).join('  |  ')),{color:amber,wrap:'truncate'})),
  panel('COMMAND'+(busy?' / sending':''),[text(draft.text?inputLines.slice(inputStart,inputStart+inputRows).join('\n'):'Ask TIM to build, fix, or explore...  Up/Down history',{color:draft.text?green:muted})],{borderColor:busy?amber:green,height:composerHeight,flexShrink:0,overflow:'hidden'}),
  text(size.w<100?'Ctrl+P/N scroll  Ctrl+L latest  Enter send  Esc cancel  Ctrl+Q quit  Wheel scroll':'Enter send  Ctrl+J newline  Ctrl+P/N scroll  Ctrl+L latest  Esc cancel  Ctrl+Q quit  Wheel scroll',{color:muted,wrap:'truncate'}));
}
