import {useCallback,useEffect,useRef,useState} from 'react';
import {mouseDisable,mouseEnable} from './mouse.mjs';

// Own only the reporting modes TIM enabled. Native selection/copy remains the
// terminal's responsibility; clipboard escape sequences are never emitted.
export function createSelectionMode({write,mouseEnabled=true,onChange=()=>{}}){
 let active=false,disposed=false,restoreReporting=false;
 const reporting=()=>typeof mouseEnabled==='function'?Boolean(mouseEnabled()):Boolean(mouseEnabled);
 const enter=()=>{
  if(disposed||active)return false;
  restoreReporting=reporting();
  if(restoreReporting)write(mouseDisable);
  active=true;onChange(true);return true;
 };
 const exit=()=>{
  if(!active)return false;
  const restore=restoreReporting&&reporting();active=false;restoreReporting=false;
  if(restore)write(mouseEnable);
  onChange(false);return true;
 };
 const dispose=()=>{
  if(disposed)return;
  const restore=active&&restoreReporting&&reporting();active=false;restoreReporting=false;disposed=true;
  // A closed terminal must not turn renderer cleanup into a second failure.
  if(restore)try{write(mouseEnable);}catch{}
 };
 return {get active(){return active;},get disposed(){return disposed;},enter,exit,toggle:()=>active?exit():enter(),dispose};
}

// The caller routes F2/Esc and pauses repaint sources while `selecting` is true.
// isSelecting() reads the synchronous controller for input/backend callbacks
// arriving before React commits the selection banner.
export function useSelectionMode({stdout=process.stdout,mouseEnabled=true,onChange}={}){
 const [selecting,setSelecting]=useState(false),stdoutRef=useRef(stdout),mouseRef=useRef(mouseEnabled),changeRef=useRef(onChange),controller=useRef(null);
 stdoutRef.current=stdout;mouseRef.current=mouseEnabled;changeRef.current=onChange;
 const makeController=()=>createSelectionMode({write:value=>stdoutRef.current.write(value),mouseEnabled:()=>mouseRef.current,onChange:value=>{setSelecting(value);changeRef.current?.(value);}});
 if(!controller.current)controller.current=makeController();
 useEffect(()=>{
  // Development StrictMode may clean up and re-run this mount effect.
  if(controller.current.disposed)controller.current=makeController();
  return()=>controller.current.dispose();
 },[]);
 const enter=useCallback(()=>controller.current.enter(),[]),exit=useCallback(()=>controller.current.exit(),[]),toggle=useCallback(()=>controller.current.toggle(),[]),isSelecting=useCallback(()=>controller.current.active,[]);
 return {selecting,enter,exit,toggle,isSelecting};
}
