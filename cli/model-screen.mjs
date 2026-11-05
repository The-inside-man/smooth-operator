import React,{useEffect,useRef,useState} from 'react';
import {Box,Text,useCursor} from 'ink';
import {useEditorInput} from './editor-input.mjs';
import {clean} from './core.mjs';
import {cellWidth,wrapCells} from './layout.mjs';
import {getModelChoices} from './model-recommendations.mjs';
import {setupBytes} from './local-setup.mjs';
import {scrollAction,scrollStep} from './scroll.mjs';

const h=React.createElement;
const colors={text:'#C5F7D4',green:'#8EE8AA',cyan:'#67D9EF',muted:'#758D80',amber:'#DAA85A'};
const singleLine=value=>clean(value).replace(/[\r\n\t]/g,' ');
const label=(value,props={})=>h(Text,{color:colors.text,...props},clean(value));
const identity=model=>({id:model?.id||'',catalogId:model?.catalogId||''});
const fit=(value,width)=>{
 const text=singleLine(value);if(cellWidth(text)<=width)return text;
 let result='';for(const character of new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(text)){
  if(cellWidth(result+character.segment)>Math.max(0,width-1))break;
  result+=character.segment;
 }return result+'…';
};

export function ModelScreen({size,models=[],catalog=[],memory,hardware,currentModelId,mode='agent',draft='',onSelect,onDownload,onBack,onRefresh,onSetup,onProviders,onQuit,staticPreview=false}){
 const {choices}=getModelChoices({models,catalog,memory,hardware});
 const preferred=choices.find(model=>model.id===currentModelId)||choices.find(model=>model.available)||choices.find(model=>model.suggested)||choices[0];
 const [selection,setSelection]=useState(()=>identity(preferred)),[number,setNumber]=useState(''),[numberInvalid,setNumberInvalid]=useState(false),[busy,setBusy]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const busyRef=useRef(false),mounted=useRef(true),{setCursorPosition}=useCursor();
 const chosen=choices.find(model=>model.id===selection.id&&(!selection.catalogId||model.catalogId===selection.catalogId))||(selection.catalogId?choices.find(model=>model.catalogId===selection.catalogId):undefined)||(!selection.id?preferred:undefined);
 const index=choices.findIndex(model=>model.id===chosen?.id),missing=Boolean(selection.id&&!chosen);
 const title={agent:'Agent',chat:'Chat',code:'Code'}[mode]||singleLine(mode);
 const saved=Boolean(String(draft??'').trim()),width=Math.max(1,size.w-6);
 const availableCount=choices.filter(model=>model.installed&&model.available).length,downloadCount=choices.filter(model=>!model.installed&&model.catalogId).length,needsSetup=choices.length>0&&availableCount===0&&!choices.some(model=>model.catalogId);
 const panelHeight=Math.max(3,size.h-8-(saved?1:0)),visible=Math.max(1,panelHeight-2-(needsSetup?2:0));
 const start=Math.max(0,Math.min(index-Math.floor(visible/2),choices.length-visible));
 useEffect(()=>{mounted.current=true;setCursorPosition(undefined);return()=>{mounted.current=false;};},[setCursorPosition]);
 useEffect(()=>{if(chosen&&(chosen.id!==selection.id||(chosen.catalogId||'')!==selection.catalogId))setSelection(identity(chosen));},[chosen?.id,chosen?.catalogId,selection.id,selection.catalogId]);
 const perform=async(message,operation)=>{
  if(busyRef.current)return;
  busyRef.current=true;setBusy(message);setError('');setNotice('');
  try{await operation();}
  catch(error){if(mounted.current)setError(singleLine(error?.message||error));}
  finally{busyRef.current=false;if(mounted.current)setBusy('');}
 };
 const move=next=>{setSelection(current=>{
  let currentIndex=choices.findIndex(model=>model.id===current.id&&(!current.catalogId||model.catalogId===current.catalogId));
  if(currentIndex<0&&current.catalogId)currentIndex=choices.findIndex(model=>model.catalogId===current.catalogId);
  const position=typeof next==='function'?next(currentIndex<0?index:currentIndex):next;
  return identity(choices[Math.max(0,Math.min(choices.length-1,position))]);
 });setNumber('');setNumberInvalid(false);setError('');setNotice('');};
 const updateNumber=value=>{
  const typed=value.slice(0,6),position=Number(typed),valid=typed!==''&&value.length<=6&&position>=1&&position<=choices.length;
  setNumber(typed);setNumberInvalid(Boolean(typed)&&!valid);setNotice('');
  if(valid){setSelection(identity(choices[position-1]));setError('');}
  else if(!typed)setError('');
  else setError(value.length>6?'Model number is too long. Backspace or use Up/Down.':'No model numbered '+typed+'. Use Up/Down to choose a model.');
 };
 useEditorInput((input,key)=>{
  if(key.ctrl&&['q','c'].includes(input)){onQuit?.();return;}
  if(busyRef.current)return;
  if(key.escape){onBack?.();return;}
  if(!key.ctrl&&!key.meta&&input.toLowerCase()==='s'){onSetup?.();return;}
  if(!key.ctrl&&!key.meta&&input.toLowerCase()==='p'){onProviders?.();return;}
  if(key.ctrl&&input==='r'){
   if(onRefresh)void perform('Refreshing models…',async()=>{await onRefresh();if(mounted.current){setNumber('');setNumberInvalid(false);setNotice('Model list refreshed.');}});
   else setError('Refresh is unavailable. Restart TIM to read the model library.');
   return;
  }
  const action=scrollAction(input,key);
  if(action){move(action==='latest'?choices.length-1:current=>current+scrollStep(action,visible+1));return;}
  if(key.upArrow){move(current=>current-1);return;}if(key.downArrow){move(current=>current+1);return;}
  if(key.return){
   if(number&&(numberInvalid||Number(number)<1||Number(number)>choices.length)){setError('No model numbered '+number+'. Use Up/Down to choose a model.');return;}
   const current=choices.find(model=>model.id===chosen?.id);
   if(!current){if(missing)setError('Your selected model is no longer available. Use Up/Down or a number to choose again.');return;}
   if(current.installed&&current.available){
    if(onSelect)void perform('Selecting '+singleLine(current.name||current.id)+'…',()=>onSelect(models.find(model=>model.id===current.id)||current));
   }else if(current.catalogId){
    if(onDownload)void perform('Opening setup review for '+singleLine(current.name||current.id)+'…',()=>onDownload(current));
    else setError('Press S to browse local models and review setup for this model.');
   }else setError('Unavailable: '+singleLine(current.issue||'This imported model is not ready. Reconnect its library with tim --library PATH.'));
   return;
  }
  if(key.backspace){updateNumber(number.slice(0,-1));return;}
  if(!key.ctrl&&!key.meta&&/^\d+$/.test(input))updateNumber(number+input);
 },{isActive:!staticPreview});
 const countWidth=String(choices.length).length;
 const rows=choices.slice(start,start+visible).map((model,offset)=>{
  const active=start+offset===index,prefix=`${active?'>':' '} ${String(start+offset+1).padStart(countWidth)}. `;
  const badges=(model.id===currentModelId?'[CURRENT] ':'')+(model.suggested?'[SUGGESTED] ':'');
  const state=model.installed?model.available?'installed':'needs setup':'download';
  const ram=typeof model.estimatedMemoryBytes==='number'?'~'+(model.estimatedMemoryBytes/2**30).toFixed(1)+' GiB RAM':'';
  const details=[!model.installed?setupBytes(model.downloadBytes):'',ram].filter(Boolean).join(' / '),suffix=state+(details?' / '+details:'');
  const name=fit(model.name||model.id,Math.max(1,width-cellWidth(prefix+badges+suffix)-2));
  return label(prefix+name+' '+badges+suffix,{key:model.id||start+offset,color:model.suggested?colors.cyan:active?colors.green:model.available||model.catalogId?colors.text:colors.muted,bold:active,wrap:'truncate'});
 });
 const empty=[
  'No chat models found.',
  'Press S to browse supported local models and set up here.',
  'Press P for ChatGPT, Grok or Claude connection steps.',
  'Already have models? tim --library PATH',
  'Ctrl+R rescans the current library.'
 ];
 const status=busy||error||(missing?'Your selected model is no longer available. Use Up/Down or a number to choose again.':'')||notice||(chosen?.installed&&!chosen.available?'Unavailable: '+singleLine(chosen.issue||'This model needs setup. Enter reviews catalog setup; S browses models.'):chosen?.suggested?'Suggested: '+singleLine(chosen.reason):chosen?.catalogId&&!chosen.installed?'Download available. Enter opens setup review; nothing downloads yet.':availableCount?'Enter selects an installed model or reviews a model download.':'Press S for local setup or P for cloud provider instructions.');
 const fitWarning=chosen?.fit==='too-large'?'Memory warning: estimate exceeds your current model budget.':chosen?.fit==='tight'?'Memory warning: little headroom remains; longer chats may need more RAM.':'';
 const statusLines=!busy&&!error&&fitWarning?[fit(status,Math.max(1,size.w-2)),fitWarning]:wrapCells(clean(status),Math.max(1,size.w-2)).lines.slice(0,2);
 return h(Box,{flexDirection:'column',width:size.w,height:Math.max(1,size.h-1),paddingX:1,backgroundColor:'#080D0B'},
  label('TIM / MODELS',{color:colors.green,bold:true,wrap:'truncate'}),
  label(`Choose a model for ${title} mode. Enter selects or opens setup review.`,{color:colors.muted,wrap:'truncate'}),
  saved?label('Your request is saved.',{color:colors.green,wrap:'truncate'}):null,
  label(`${choices.length} chat model${choices.length===1?'':'s'} / ${availableCount} available / ${downloadCount} downloadable${number?' / number '+number:''}${choices.length?index<0?' / choose again':' / '+(index+1)+' selected':''}`,{color:colors.muted,wrap:'truncate'}),
  h(Box,{flexDirection:'column',borderStyle:process.env.TIM_ASCII==='1'?'classic':'double',borderColor:colors.green,height:panelHeight,flexShrink:0,paddingX:1,overflow:'hidden'},
   choices.length?rows:label(empty.map(line=>fit(line,width)).join('\n')),
   needsSetup?label('S: browse local models and setup. P: ChatGPT / Grok / Claude.\nExisting model library: tim --library PATH',{color:colors.amber}):null),
  h(Box,{height:2,flexShrink:0},label(statusLines.join('\n'),{color:chosen?.suggested&&!error&&!busy?colors.cyan:colors.amber})),
  label('Wheel/Up/Down select  Ctrl+P/N page  Ctrl+L bottom  Number + Enter choose',{color:colors.muted,wrap:'truncate'}),
  label('S local setup  P cloud help  Esc back  Ctrl+R refresh  Ctrl+Q quit',{color:colors.muted,wrap:'truncate'}));
}
