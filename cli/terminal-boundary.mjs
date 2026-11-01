import React,{useEffect,useState} from 'react';
import {Box,Text,useInput as inkInput,useStdout} from 'ink';
export const MIN_COLUMNS=80;
export const usableTerminal=(w,h)=>w>=MIN_COLUMNS&&h>=16;
export function guardLines(w,h){
 const full=[w<80?'Please widen your terminal to at least 80 columns.':'Please increase terminal height to at least 16 rows.',
  'Current: '+w+' columns x '+h+' rows. Required: 80 x 16.',
  'Draft/session preserved. Running jobs continue.',
  'Typing and approvals paused. Esc cancel / Ctrl+Q quit.'];
 const lines=[];for(const line of full)for(let i=0;i<line.length;i+=Math.max(1,w))lines.push(line.slice(i,i+Math.max(1,w)));
 return lines.slice(0,Math.max(1,h-1));
}
export function WidthMessage({w,h}){return React.createElement(Box,{width:Math.max(1,w),height:Math.max(1,h-1),flexDirection:'column',overflow:'hidden'},...guardLines(w,h).map((line,i)=>React.createElement(Text,{key:i},line)));}
export function useSafeInput(handler,options){const {stdout}=useStdout();inkInput((input,key)=>{
 if(!usableTerminal(stdout.columns||80,stdout.rows||24)&&!(key.escape||key.ctrl&&['c','q'].includes(input)))return;
 handler(input,key);
},options);}
export function TerminalBoundary({children}){const {stdout}=useStdout(),[size,setSize]=useState({w:stdout.columns||80,h:stdout.rows||24});
 useEffect(()=>{const resize=()=>setSize({w:stdout.columns||80,h:stdout.rows||24});stdout.on('resize',resize);return()=>stdout.off('resize',resize);},[stdout]);
 const blocked=!usableTerminal(size.w,size.h);
 return React.createElement(Box,{flexDirection:'column'},React.createElement(Box,{display:blocked?'none':'flex'},children),blocked?React.createElement(WidthMessage,size):null);
}
