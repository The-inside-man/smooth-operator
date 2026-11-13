import React,{useEffect,useRef,useState} from 'react';
import {Box,Text,useCursor,useStdout} from 'ink';
import {useEditorInput} from './editor-input.mjs';
import {useClock,activity,observeJob} from './activity.mjs';
import {scrollAction,scrollStep} from './scroll.mjs';
import {wrapCells} from './layout.mjs';
import {clean} from './core.mjs';
import {ToolRunner} from './tool-runner.mjs';
import {useSelectionMode} from './selection-mode.mjs';
import {reviewGeneratedSave,saveGeneratedCode,reviewGeneratedRun,reviewGeneratedRunFromSave,runGeneratedCode} from './generated-code.mjs';

const h=React.createElement;
const label=(value,props={})=>h(Text,{color:'#C5F7D4',wrap:'truncate',...props},clean(value));
const runningStatus=run=>['running','cancelling','stopping (timeout)'].includes(run.status);
function reviewLines(plan){
 const run=plan.run,source=plan.save?.source||run.generatedCode.source;
 const lines=[plan.save?`SAVE ${plan.save.language==='python'?'PYTHON':'JAVASCRIPT'}${run?' AND RUN':' FILE'}`:'RUN EXISTING SCRIPT',
  `File: ${plan.save?.destination||run.generatedCode.file}`,
  `SHA-256: ${plan.save?.sourceHash||run.generatedCode.sourceHash}`,
  `Source: ${plan.save?.bytes||run.generatedCode.bytes} bytes`,
  ...(run?[`Executable: ${run.executable}`,`Arguments: ${JSON.stringify(run.args)}`,`Working directory: ${run.cwd}`,`Timeout: ${run.timeoutMs/1000}s / retained output 64 KiB / stdin closed`]:[`Working directory: ${plan.save.cwd}`]),
  '',plan.save?'Saving creates a new file only; existing files are never overwritten.':'This exact file is checked again before launch.',
  ...(run?['Runs with your user privileges and inherited environment.','Code can change files, use the network, and open windows.','No package installation or elevation. Esc cancels the owned process.']:[]),
  '','SOURCE / review the complete code below','',...source.replace(/\r\n?/g,'\n').split('\n'),
  '',run?'Ctrl+S confirms this exact source and command once.':'Ctrl+S confirms this exact source and destination once.'];
 return lines;
}
function outputLines(run,saved,notice){
 return [saved?'Saved: '+saved.file:'',`RUN / ${run.status.toUpperCase()}${run.exitCode!==null&&run.exitCode!==undefined?' / exit '+run.exitCode:''}`,run.error||'',notice||'',run.truncated?'[Only the most recent 64 KiB are retained]':'','',run.output||'Waiting for output…'];
}

export function GeneratedCodeScreen({size,request,onSaved=()=>{},onBack,onQuit,staticPreview=false,selectionController,mouseReporting=true}){
 const [runner]=useState(()=>new ToolRunner()),[plan,setPlan]=useState(null),[phase,setPhase]=useState('preparing'),[run,setRun]=useState(runner.state),[saved,setSaved]=useState(null),[notice,setNotice]=useState('Preparing source and file review. Nothing has been saved or run.'),[scroll,setScroll]=useState(0),[closing,setClosing]=useState(false);
 const {setCursorPosition}=useCursor(),{stdout}=useStdout();
 const ownSelection=useSelectionMode({stdout,mouseEnabled:selectionController?false:mouseReporting}),selection=selectionController||ownSelection,selectionRef=useRef(selection);selectionRef.current=selection;
 const now=useClock(!staticPreview&&!selection.selecting),alive=useRef(true),launching=useRef(false),controller=useRef(null),screen=useRef(null),previousRun=useRef(runner.state),heldRun=useRef(null),heldError=useRef(null);
 const width=Math.max(1,size.w-6),height=Math.max(1,size.h-8),isRunning=runningStatus(run);
 const lines=phase==='review'&&plan?reviewLines(plan):phase==='output'?outputLines(run,saved,notice):phase==='saved'?[`Saved: ${saved.file}`,`SHA-256: ${saved.sourceHash}`,'','The file was saved. No code was run.','Esc returns to TIM.']:[notice];
 const wrapped=lines.flatMap(line=>wrapCells(clean(line),width).lines),maximum=Math.max(0,wrapped.length-height),start=phase==='output'?maximum-Math.min(scroll,maximum):Math.min(scroll,maximum);
 screen.current={phase,width,height,saved,notice};
 const paintRun=next=>{
  const current=screen.current;
  const count=state=>outputLines(state,current.saved,current.notice).flatMap(line=>wrapCells(clean(line),current.width).lines).length;
  const oldMaximum=Math.max(0,count(previousRun.current)-current.height),nextMaximum=Math.max(0,count(next)-current.height);
  setRun(next);setScroll(offset=>current.phase==='output'&&offset>0?Math.max(0,nextMaximum-(oldMaximum-Math.min(offset,oldMaximum))):offset);previousRun.current=next;
 };
 useEffect(()=>{
  alive.current=true;
  const listener=value=>{
   const next=observeJob(value);
   if(selectionRef.current.isSelecting()){heldRun.current=next;return;}
   heldRun.current=null;
   paintRun(next);
  };
  runner.on('state',listener);
  return()=>{alive.current=false;controller.current?.abort();runner.off('state',listener);void runner.close();};
 },[]);
 useEffect(()=>{
  if(selection.selecting)return;
  if(heldRun.current){const next=heldRun.current;heldRun.current=null;paintRun(next);}
  if(heldError.current){setPhase('error');setNotice(heldError.current);heldError.current=null;}
 },[selection.selecting]);
 useEffect(()=>{
  let current=true;
  setPhase('preparing');setPlan(null);setSaved(null);setScroll(0);setNotice('Preparing source and file review. Nothing has been saved or run.');
  void (async()=>{
   let next;
   if(request?.kind==='save'){
    const save=await reviewGeneratedSave(request.message,request.destination,{cwd:request.cwd,blockIndex:request.blockIndex});
    const run=request.runAfter?await reviewGeneratedRunFromSave(save,{cwd:request.cwd||save.cwd,args:request.args||[],timeoutMs:request.timeoutMs}):null;
    next={save,run};
   }else if(request?.kind==='run')next={save:null,run:await reviewGeneratedRun(request.file,{cwd:request.cwd,args:request.args||[],timeoutMs:request.timeoutMs})};
   else throw new Error('Choose generated code to save, or a script file to run.');
   if(current){setPlan(next);setPhase('review');setNotice('Review the complete source and destination'+(next.run?', executable, arguments and working directory.':'.'));}
  })().catch(error=>{if(current){setPhase('error');setNotice(error.message);}});
  return()=>{current=false;};
 },[request]);
 useEffect(()=>{setCursorPosition(undefined);},[phase]);
 const launch=()=>{
  if(!plan||launching.current||phase!=='review')return;
  launching.current=true;controller.current=new AbortController();setScroll(0);setNotice('');
  let savedResult=saved;
  void (async()=>{
   let result;
   if(plan.save){
    setPhase('saving');result=await saveGeneratedCode(plan.save,{confirmed:true});
    if(!alive.current)return;
    savedResult=result;setSaved(result);onSaved(result);
   }
   if(plan.run){
    if(!alive.current)return;
    if(controller.current.signal.aborted){setPhase(result?'saved':'error');setNotice(result?'File saved; launch cancelled.':'Launch cancelled.');return;}
    setPhase('output');setNotice('Running reviewed code. Esc cancels this process; its earlier effects remain.');
    await runGeneratedCode(plan.run,{confirmed:true,runner,signal:controller.current.signal});
   }else if(alive.current){setPhase('saved');setNotice('Saved '+result.file);}
  })().catch(error=>{if(alive.current){const message=(savedResult?'Saved '+savedResult.file+'. ':'')+error.message;if(selectionRef.current.isSelecting())heldError.current=message;else{setPhase('error');setNotice(message);}}}).finally(()=>{launching.current=false;controller.current=null;});
 };
 const quit=async()=>{if(closing)return;setClosing(true);controller.current?.abort();await runner.close();onQuit();};
 useEditorInput((input,key)=>{
  if(closing)return;
  if(key.ctrl&&['q','c'].includes(input)){if(selection.isSelecting())selection.exit();void quit();return;}
  if(key.f2){
   if(selection.isSelecting())selection.exit();
   else if(!['preparing','saving'].includes(phase)&&!(launching.current&&!runner.pending))selection.enter();
   return;
  }
  if(selection.isSelecting()){if(key.escape)selection.exit();return;}
  if(key.escape){
   if(isRunning){controller.current?.abort();void runner.cancel();setNotice('Cancellation requested for this script. Its earlier effects remain.');}
   else if(launching.current){controller.current?.abort();setNotice('Stopping this request.');}
   else onBack();
   return;
  }
  const action=scrollAction(input,key);
  if(action){setScroll(offset=>action==='latest'?phase==='output'?0:maximum:Math.max(0,Math.min(maximum,Math.min(offset,maximum)+scrollStep(action,height)*(phase==='output'?-1:1))));return;}
  if(!key.ctrl&&!key.meta&&(key.upArrow||key.downArrow)){setScroll(offset=>Math.max(0,Math.min(maximum,Math.min(offset,maximum)+(key.upArrow?-1:1)*(phase==='output'?-1:1))));return;}
  if(phase==='review'&&key.ctrl&&input==='s')launch();
 },{isActive:!staticPreview});
 return h(Box,{flexDirection:'column',width:size.w,height:Math.max(1,size.h-1),paddingX:1,backgroundColor:'#080D0B'},
  label(`TIM / CODE / ${phase.toUpperCase()} / lines ${Math.min(wrapped.length,start+1)}-${Math.min(wrapped.length,start+height)}/${wrapped.length}`,{color:'#8EE8AA',bold:true}),
  label('Review source, file and command before confirming',{color:'#758D80'}),
  h(Box,{borderStyle:process.env.TIM_ASCII==='1'?'classic':'double',borderColor:'#8EE8AA',height:height+2,flexShrink:0,paddingX:1,overflow:'hidden'},label(wrapped.slice(start,start+height).join('\n'))),
  label(selection.selecting?'SELECT TEXT / drag to highlight, then use terminal Copy / F2 or Esc resumes':phase==='output'?activity(run,now).text:notice,{color:'#DAA85A'}),
  label(selection.selecting?'Drag to select / Cmd+C on Mac / F2 or Esc resumes':phase==='review'?'F2 select  Ctrl+P/N page  Ctrl+L bottom  Ctrl+S confirm  Esc back':isRunning?'F2 select  Ctrl+P/N scroll  Ctrl+L latest  Esc cancel':'F2 select  Ctrl+P/N scroll  Esc back',{color:'#758D80'}),
  label('Ctrl+Q / Ctrl+C cancels the owned process and quits',{color:'#758D80'}));
}
