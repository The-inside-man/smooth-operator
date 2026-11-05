import React,{useEffect,useState} from 'react';
import {Box,Text,useCursor} from 'ink';
import {useEditorInput} from './editor-input.mjs';
import {clean} from './core.mjs';
import {wrapCells} from './layout.mjs';
import {cloudProviders,normalizeProvider,providerGuide} from './provider-help.mjs';
import {scrollAction,scrollStep} from './scroll.mjs';

const h=React.createElement;
const colors={text:'#C5F7D4',green:'#8EE8AA',muted:'#758D80',amber:'#DAA85A'};
const label=(value,props={})=>h(Text,{color:colors.text,...props},clean(value));
const currentShell=()=>process.platform==='win32'?'powershell':process.platform==='darwin'?'zsh':'bash';

export function ProviderScreen({size,onBack,onQuit,staticPreview=false,initialProvider='openai'}){
 const [provider,setProvider]=useState(()=>{try{return normalizeProvider(initialProvider);}catch{return 'openai';}}),[scroll,setScroll]=useState(0);
 const {setCursorPosition}=useCursor(),index=cloudProviders.findIndex(entry=>entry.id===provider);
 const width=Math.max(1,size.w-6),visible=Math.max(1,size.h-8);
 const lines=providerGuide(provider,{shell:currentShell()}).split('\n').flatMap(line=>wrapCells(line,width).lines);
 const maximum=Math.max(0,lines.length-visible),start=Math.max(0,Math.min(scroll,maximum));
 useEffect(()=>{setCursorPosition(undefined);},[setCursorPosition]);
 const choose=next=>{setProvider(cloudProviders[(next+cloudProviders.length)%cloudProviders.length].id);setScroll(0);};
 useEditorInput((input,key)=>{
  if(key.ctrl&&['q','c'].includes(input)){onQuit?.();return;}
  if(key.escape){onBack?.();return;}
  if(key.tab){choose(index+(key.shift?-1:1));return;}
  if(key.leftArrow){choose(index-1);return;}if(key.rightArrow){choose(index+1);return;}
  const action=scrollAction(input,key);
  if(action){setScroll(current=>action==='latest'?maximum:Math.max(0,Math.min(maximum,Math.min(current,maximum)+scrollStep(action,visible+1))));return;}
  if(key.upArrow){setScroll(current=>Math.max(0,Math.min(current,maximum)-1));return;}if(key.downArrow){setScroll(current=>Math.min(maximum,current+1));return;}
  if(key.return){setScroll(current=>Math.min(maximum,current+visible));return;}
  if(key.home){setScroll(0);return;}if(key.end)setScroll(maximum);
 },{isActive:!staticPreview});
 return h(Box,{flexDirection:'column',width:size.w,height:Math.max(1,size.h-1),paddingX:1,backgroundColor:'#080D0B'},
  label('TIM / CLOUD PROVIDERS',{color:colors.green,bold:true,wrap:'truncate'}),
  label(cloudProviders.map(entry=>(entry.id===provider?'> ':'  ')+entry.label).join('  |  '),{color:colors.green,wrap:'truncate'}),
  label('Wheel scroll / Ctrl+L bottom / no keys or settings changed here',{color:colors.muted,wrap:'truncate'}),
  h(Box,{flexDirection:'column',borderStyle:process.env.TIM_ASCII==='1'?'classic':'double',borderColor:colors.green,height:visible+2,flexShrink:0,paddingX:1,overflow:'hidden'},label(lines.slice(start,start+visible).join('\n'))),
  label(`Guide lines ${start+1}-${Math.min(lines.length,start+visible)} of ${lines.length} / tim providers ${provider}`,{color:colors.amber,wrap:'truncate'}),
  label('Tab/Left/Right provider  Up/Down lines  Ctrl+P/N page  Esc back  Ctrl+Q quit',{color:colors.muted,wrap:'truncate'}));
}
