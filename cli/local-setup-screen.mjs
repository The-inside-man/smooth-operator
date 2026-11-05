import React,{useEffect,useRef,useState} from 'react';
import {Box,Text,useCursor} from 'ink';
import {useEditorInput} from './editor-input.mjs';
import {clean} from './core.mjs';
import {cellWidth,wrapCells} from './layout.mjs';
import {localSetupStatus,setupBytes,startLocalSetup} from './local-setup.mjs';
import {getModelRecommendations} from './model-recommendations.mjs';
import {scrollAction,scrollStep} from './scroll.mjs';

const h=React.createElement,colors={text:'#C5F7D4',green:'#8EE8AA',cyan:'#67D9EF',muted:'#758D80',amber:'#DAA85A'};
const line=value=>clean(value).replace(/[\r\n\t]/g,' '),GiB=2**30;
const gib=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?`${(value/GiB).toFixed(1)} GiB`:'unknown';
const segments=new Intl.Segmenter(undefined,{granularity:'grapheme'});
function fit(value,width){
 const source=line(value);if(cellWidth(source)<=width)return source;
 let result='';for(const {segment} of segments.segment(source)){if(cellWidth(result+segment)>Math.max(0,width-1))break;result+=segment;}return result+'…';
}
const text=(value,props={})=>h(Text,{color:colors.text,...props},clean(value));
const installedState=option=>option.installed?option.available?'installed':'needs repair':'download';

export function LocalSetupScreen({size,client,onReady,onBack,onQuit,staticPreview=false,initial,initialCatalogId='',startInReview=false,mode='agent'}){
 const [snapshot,setSnapshot]=useState(initial||{}),[phase,setPhase]=useState(()=>startInReview&&initialCatalogId?'review':'list'),[selectedId,setSelectedId]=useState(()=>initialCatalogId),[number,setNumber]=useState(''),[numberInvalid,setNumberInvalid]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[reading,setReading]=useState(!staticPreview);
 const alive=useRef(true),busyRef=useRef(false),readingRef=useRef(false),controller=useRef(null),readGeneration=useRef(0),{setCursorPosition}=useCursor();
 const {memory,options:catalogOptions,suggestedIds}=getModelRecommendations(snapshot);
 const configured=(snapshot.models||[]).find(model=>model.id===snapshot.config?.mainAgentModelId&&model.kind==='chat');
 const external=configured&&!configured.catalogId&&!catalogOptions.some(option=>option.modelId===configured.id)?{...configured,external:true,installed:true,estimatedMemoryBytes:configured.memoryGB>0?configured.memoryGB*GiB:null,fit:'unknown',reason:'Use your currently selected installed model. No catalog model download is needed.'}:null;
 const options=mode==='agent'&&external?[...catalogOptions,external]:catalogOptions;
 const configuredId=configured?.catalogId||configured?.id||(snapshot.config?.mainAgentModelId||'').replace(/^catalog:/,'');
 const preferred=options.find(option=>option.id===configuredId)||options.find(option=>option.id===suggestedIds[0])||options[0];
 const selected=options.find(option=>option.id===selectedId)||(phase==='list'||!selectedId?preferred:undefined),index=Math.max(0,options.findIndex(option=>option.id===selected?.id));
 const status=localSetupStatus(snapshot,{catalogId:selected?.external?undefined:selected?.id,mode});
 const width=Math.max(1,size.w-6),panelHeight=Math.max(3,size.h-9),visible=Math.max(1,panelHeight-2);
 const start=Math.max(0,Math.min(index-Math.floor(visible/2),options.length-visible));
 const refresh=async()=>{
  if(readingRef.current||busyRef.current||!client?.request)return;
  const generation=++readGeneration.current;readingRef.current=true;setReading(true);setError('');
  try{const value=await client.request('setup/options');if(alive.current&&generation===readGeneration.current){setSnapshot(value);setNumber('');setNumberInvalid(false);}}
  catch(error){if(alive.current&&generation===readGeneration.current)setError(line(error.message||error));}
  finally{if(generation===readGeneration.current){readingRef.current=false;if(alive.current)setReading(false);}}
 };
 useEffect(()=>{
  alive.current=true;setCursorPosition(undefined);
  if(!staticPreview)void refresh();
  return()=>{alive.current=false;readGeneration.current++;readingRef.current=false;controller.current?.abort();};
 // Parent snapshots update below without restarting the setup monitor or its connection.
 },[client,staticPreview,setCursorPosition]);
 useEffect(()=>{if(initial)setSnapshot(current=>({...current,...initial}));},[initial]);
 useEffect(()=>{if(phase==='list'&&selected?.id!==selectedId)setSelectedId(selected?.id||'');},[phase,selected?.id,selectedId]);
 const choose=next=>{setSelectedId(current=>{
  const known=options.findIndex(option=>option.id===current),position=typeof next==='function'?next(known<0?index:known):next;
  return options[Math.max(0,Math.min(options.length-1,position))]?.id||'';
 });setNumber('');setNumberInvalid(false);setError('');};
 const updateNumber=value=>{
  const typed=value.slice(0,6),position=Number(typed),valid=typed!==''&&value.length<=6&&position>=1&&position<=options.length;
  setNumber(typed);setNumberInvalid(Boolean(typed)&&!valid);
  if(valid){setSelectedId(options[position-1].id);setError('');}
  else setError(typed?'Choose a model number from 1 to '+options.length+'. Use Backspace or Up/Down.':'');
 };
 const startSetup=async()=>{
  if(busyRef.current||readingRef.current||!selected)return;
  const target=options.find(option=>option.id===selected.id);if(!target)return;
  busyRef.current=true;setBusy(true);setPhase('running');setError('');controller.current=new AbortController();
  try{
   const ready=await startLocalSetup(client,{catalogId:target.external?undefined:target.id,mode,signal:controller.current.signal,onState:value=>{if(alive.current)setSnapshot(value);}});
   if(alive.current){setSnapshot(ready);await onReady?.(ready);}
  }catch(error){if(alive.current&&!controller.current.signal.aborted){setError(line(error.message||error));setPhase('review');}}
  finally{busyRef.current=false;if(alive.current)setBusy(false);}
 };
 useEditorInput((input,key)=>{
  if(key.ctrl&&['q','c'].includes(input)){controller.current?.abort();onQuit?.();return;}
  if(key.escape){
   if(busyRef.current){controller.current?.abort();onBack?.();}
   else if(phase==='review'){setPhase('list');setError('');}
   else onBack?.();return;
  }
  if(busyRef.current)return;
  if(key.ctrl&&input==='r'){if(!staticPreview)void refresh();return;}
  if(phase==='list'){
   const action=scrollAction(input,key);
   if(action){choose(action==='latest'?options.length-1:current=>current+scrollStep(action,visible+1));return;}
   if(key.upArrow){choose(current=>current-1);return;}if(key.downArrow){choose(current=>current+1);return;}
   if(key.backspace){updateNumber(number.slice(0,-1));return;}
   if(!key.ctrl&&!key.meta&&/^\d+$/.test(input)){updateNumber(number+input);return;}
   if(key.return&&!readingRef.current&&selected){
    if(number&&(numberInvalid||Number(number)<1||Number(number)>options.length)){setError('Choose a valid model number before opening review.');return;}
    setPhase('review');setError('');
   }return;
  }
  if(key.return)void startSetup();
 },{isActive:!staticPreview});
 const panel=[];
 const add=(value,color=colors.text,max=1)=>{for(const row of wrapCells(clean(value),width).lines.slice(0,max))panel.push({value:row,color});};
 if(phase==='list'){
  const digits=String(options.length).length;
  for(const [offset,option] of options.slice(start,start+visible).entries()){
   const prefix=`${start+offset===index?'>':' '} ${String(start+offset+1).padStart(digits)}. `,badge=option.suggested?'[SUGGESTED] ':'',info=`${option.external?'no download':setupBytes(option.downloadBytes)} / ~${gib(option.estimatedMemoryBytes)} RAM / ${installedState(option)}`;
   const name=fit(option.name||option.id,Math.max(1,width-cellWidth(prefix+badge+info)-2));
   panel.push({value:prefix+name+' '+badge+info,color:option.suggested?colors.cyan:start+offset===index?colors.green:colors.text,bold:start+offset===index});
  }
  if(!options.length){add(reading?'Reading supported chat models…':'No supported chat catalog models were returned.',colors.amber);add('Ctrl+R refreshes the catalog and current system memory.',colors.muted);add('Connect to the local backend to choose a model for download.',colors.muted);}
 }else if(phase==='review'){
  add(selected?'REVIEW / '+line(selected.name||selected.id):'Selected model is no longer available',selected?colors.green:colors.amber);
  add(`${selected?.installed?'Model files: already installed':'Model download: '+setupBytes(selected?.downloadBytes)} / estimated RAM: ${gib(selected?.estimatedMemoryBytes)}`);
  add(status.runtimeAvailable?'Chat engine: already installed.':'Chat engine: install if needed (about 12–25 MB).');
  add('Internet is needed for downloads. Chat runs locally afterward.',colors.muted);
  add(error?'Press Enter to retry; verified completed files are reused.':mode==='agent'?'Confirm to select this as the main agent and load it locally.':`Confirm to switch to ${mode==='code'?'Code':'Chat'} mode and load this model locally.`,colors.muted);
 }else{
  add(status.ready?'Starting selected local model':status.title,colors.green);
  add('Model: '+line(selected?.name||selected?.id));
  if(status.progress!==null)add(`${Math.round(status.progress)}%${status.phase.includes('engine')&&status.runtime.totalBytes?' / '+setupBytes(status.runtime.downloadedBytes||0)+' of '+setupBytes(status.runtime.totalBytes):status.download?.totalBytes?' / '+setupBytes(status.download.downloadedBytes||0)+' of '+setupBytes(status.download.totalBytes):''}`);
  add(status.phase==='loading'||status.ready?'Downloads are complete. Loading into memory…':'Keep TIM open while setup finishes.',colors.muted);
  add('Esc stops monitoring; backend setup continues.',colors.muted);
 }
 const reason=error?'Setup: '+error:reading?'Refreshing supported models and current system memory…':phase!=='list'&&!selected?'Selected model disappeared from the catalog. Press Esc to choose again.':selected?.installed&&!selected.available?'Unavailable: '+line(selected.issue||'The local model or engine needs repair.'):selected?.suggested?'Suggested: '+selected.reason:selected?.external?selected.reason:selected?.description||'Choose any supported model. Enter opens its setup review.';
 const fitMessage=memory.stale?memory.notice:selected?.fit==='too-large'?'Memory warning: estimate exceeds the current model budget. Choose smaller.':selected?.fit==='tight'?'Memory warning: little headroom remains; longer chats may need more RAM.':selected?.fit==='comfortable'?'Estimated fit: within budget with headroom; actual use varies with context.':memory.modelBudgetBytes===null?memory.notice:'Memory estimate unavailable for this model; actual use must be checked.';
 const detailColor=error||['too-large','tight','unknown'].includes(selected?.fit)?colors.amber:colors.muted;
 const footer=busy?'Esc back (setup continues)  Ctrl+Q / Ctrl+C quit':phase==='review'?`${error?'Enter retry':'Enter start setup'}  Esc models  Ctrl+Q / Ctrl+C quit`:'Wheel/Up/Down select  Ctrl+P/N page  Ctrl+L bottom  Number + Enter review';
 return h(Box,{flexDirection:'column',width:size.w,height:Math.max(1,size.h-1),paddingX:1,backgroundColor:'#080D0B'},
  text(`TIM / LOCAL SETUP  ${catalogOptions.length} supported chat models`,{color:colors.green,bold:true,wrap:'truncate'}),
  text(fit(`RAM ${gib(memory.totalBytes)} / available ${gib(memory.availableBytes)} / model budget ${gib(memory.modelBudgetBytes)}${memory.stale?' / stale':memory.source==='free-fallback'?' / conservative':''}`,Math.max(1,size.w-2)),{color:colors.muted,wrap:'truncate'}),
  text('[SUGGESTED] system-spec suggestions; Enter reviews before download.',{color:colors.cyan,wrap:'truncate'}),
  h(Box,{flexDirection:'column',borderStyle:process.env.TIM_ASCII==='1'?'classic':'double',borderColor:colors.green,height:panelHeight,flexShrink:0,paddingX:1,overflow:'hidden'},...panel.slice(0,visible).map((row,index)=>text(row.value,{key:index,color:row.color,bold:row.bold,wrap:'truncate'}))),
  text(fit(reason,Math.max(1,size.w-2)),{color:error?colors.amber:selected?.suggested?colors.cyan:colors.muted,wrap:'truncate'}),
  text(fit(fitMessage,Math.max(1,size.w-2)),{color:detailColor,wrap:'truncate'}),
  text(fit(snapshot.dataDir?'Save to: '+line(snapshot.dataDir):'Save to: your TIM data directory (--data-dir to choose another).',Math.max(1,size.w-2)),{color:colors.muted,wrap:'truncate'}),
  text(fit(footer,Math.max(1,size.w-2)),{color:colors.muted,wrap:'truncate'}),
  text(phase==='list'?'Esc back  Ctrl+R refresh  Ctrl+Q / Ctrl+C quit':'Your saved request is kept. Setup starts only after review confirmation.',{color:colors.muted,wrap:'truncate'}));
}
