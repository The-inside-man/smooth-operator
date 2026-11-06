import {useSafeInput as useInput} from './terminal-boundary.mjs';
import {useEffect,useRef} from 'react';
import {useStdin,useStdout} from 'ink';
import {createMouseInput} from './mouse.mjs';
// Ink 6 distinguishes DEL from BS but discards the original bytes in useInput.
// Observe its parsed input event before useInput to preserve physical Backspace
// and bracketed-paste semantics. Integration tests cover this Ink adapter.
export function useEditorInput(handler,options){
 const {stdout}=useStdout();const {internal_eventEmitter}=useStdin();const raw=useRef(''),paste=useRef(null),mouse=useRef(createMouseInput());
 useEffect(()=>{const reset=()=>{if(stdout.columns<80||stdout.rows<16){paste.current=null;mouse.current.reset();}};const observe=value=>{reset();raw.current=value;};stdout.on('resize',reset);internal_eventEmitter.prependListener('input',observe);return()=>{stdout.off('resize',reset);internal_eventEmitter.off('input',observe);};},[internal_eventEmitter]);
 useEffect(()=>{mouse.current.reset();paste.current=null;},[options?.isActive]);
 useInput((input,key)=>{
  if(key.eventType==='release')return;
  const value=raw.current;
  if(value==='\x1b[200~'){mouse.current.reset();paste.current='';return;}
  if(value==='\x1b[201~'){if(paste.current!==null){handler(paste.current,{paste:true});paste.current=null;}return;}
  if(paste.current!==null){paste.current+=value;return;}
  const report=mouse.current.read(value);
  if(report){if(report.wheel)handler('',{wheel:report.wheel});if(report.text)handler(report.text,{});return;}
  if(value==='\x7f'||value==='\x1b\x7f')key={...key,delete:false,backspace:true};
  if(value==='\n'){handler('j',{ctrl:true});return;}
  if(value==='\x1b\r'){handler('',{return:true,meta:true});return;}
  handler(input,key);
 },options);
}
