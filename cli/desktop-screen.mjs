import React,{useState,useEffect,useRef} from 'react';
import {Box,Text,useStdout} from 'ink';
import {useEditorInput} from './editor-input.mjs';
import {edit,clean} from './core.mjs';
import {wrapCells} from './layout.mjs';
import {desktopTask} from './desktop-task.mjs';
import {scrollAction,scrollStep} from './scroll.mjs';
const h=React.createElement;
export function DesktopScreen({client,request,onQuit,runTask=desktopTask}){
 const {stdout}=useStdout(),[size,setSize]=useState({w:stdout.columns||100,h:stdout.rows||30});
 const [phase,setPhase]=useState('adapter'),[adapter,setAdapter]=useState(''),[draft,setDraft]=useState({text:'',cursor:0}),[content,setContent]=useState('Task: '+request+'\nEnter native for the platform accessibility adapter, or a trusted semantic adapter absolute executable path. No foreground input or observation yet.'),[offset,setOffset]=useState(0);
 const controller=useRef(null),pending=useRef(null);
 useEffect(()=>{const resize=()=>setSize({w:stdout.columns||100,h:stdout.rows||30});stdout.on('resize',resize);return()=>{stdout.off('resize',resize);controller.current?.abort();pending.current?.reject(new Error('Desktop review closed'));};},[]);
 const start=async pid=>{
  controller.current=new AbortController();setPhase('running');setDraft({text:'',cursor:0});
  try{const result=await runTask({task:request,adapter,'target-pid':pid},{client,signal:controller.current.signal,onStatus:s=>{if(!pending.current)setContent(s);},review:(review,signal)=>new Promise((resolve,reject)=>{const abort=()=>{pending.current=null;reject(signal.reason||new Error('Cancelled'));};signal.addEventListener('abort',abort,{once:true});pending.current={resolve:v=>{signal.removeEventListener('abort',abort);pending.current=null;resolve(v);},reject};setContent(JSON.stringify(review,null,2));setOffset(0);setDraft({text:'',cursor:0});setPhase('review');})});setContent(JSON.stringify(result,null,2));}
  catch(e){setContent(e.message);}finally{pending.current=null;setPhase('done');controller.current=null;}
 };
 useEditorInput((input,key)=>{
  if(key.escape||key.ctrl&&['q','c'].includes(input)){controller.current?.abort();pending.current?.reject(new Error('Declined/cancelled'));if(!controller.current||key.ctrl)onQuit();return;}
  const action=scrollAction(input,key);
  if(action){setOffset(n=>action==='latest'?maximum:Math.max(0,Math.min(maximum,Math.min(n,maximum)+scrollStep(action,budget))));return;}
  if(['running','done'].includes(phase)&&!key.ctrl&&!key.meta&&(key.upArrow||key.downArrow)){setOffset(n=>Math.max(0,Math.min(maximum,Math.min(n,maximum)+(key.upArrow?-1:1))));return;}
  if(key.return){if(phase==='adapter'){setAdapter(draft.text.trim());setDraft({text:'',cursor:0});setPhase('pid');setContent('Task: '+request+'\nEnter the already-open target application PID. The adapter must provide semantic observations and emergency/manual interruption support.');}
   else if(phase==='pid'){if(!/^[1-9][0-9]*$/.test(draft.text))return;void start(Number(draft.text));}
   else if(phase==='review'){const answer=draft.text;setPhase('running');setDraft({text:'',cursor:0});pending.current?.resolve(answer);}
   else if(phase==='done')onQuit();return;
  }
  if(['adapter','pid','review'].includes(phase))setDraft(d=>edit(d,input,key));
 });
 const lines=wrapCells(clean(content),Math.max(1,size.w-6)).lines,budget=Math.max(1,size.h-9),maximum=Math.max(0,lines.length-budget),startRow=Math.min(offset,maximum);
 return h(Box,{width:size.w,height:Math.max(1,size.h-1),flexDirection:'column',borderStyle:process.env.TIM_ASCII==='1'?'classic':'double',borderColor:'#8EE8AA',paddingX:1},
 h(Text,{bold:true,color:'#8EE8AA'},'TIM / DESKTOP REVIEW / '+phase.toUpperCase()),
 h(Text,null,lines.slice(startRow,startRow+budget).join('\n')),
 h(Text,{color:'#DAA85A'},'Review '+(startRow+1)+'-'+Math.min(lines.length,startRow+budget)+'/'+lines.length+' / Wheel scroll / Ctrl+P/N page / Ctrl+L bottom'),
 h(Text,null,(phase==='review'?'Exact token: ':phase==='pid'?'PID: ':phase==='adapter'?'Adapter: ':'')+clean(draft.text)),
 h(Text,null,'Enter continue / Esc cancel / Ctrl+Q back. Background mode never takes over input.'));
}
