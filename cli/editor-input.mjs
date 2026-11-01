import {useSafeInput as useInput} from './terminal-boundary.mjs';
import {useEffect,useRef} from 'react';
import {useStdin,useStdout} from 'ink';
// Ink 6 distinguishes DEL from BS but discards the original bytes in useInput.
// Observe its parsed input event before useInput to preserve physical Backspace
// and bracketed-paste semantics. Integration tests cover this Ink adapter.
export function useEditorInput(handler,options){
 const {stdout}=useStdout();const {internal_eventEmitter}=useStdin();const raw=useRef(''),paste=useRef(null);
 useEffect(()=>{const reset=()=>{if(stdout.columns<100||stdout.rows<16)paste.current=null;};const observe=value=>{reset();raw.current=value;};stdout.on('resize',reset);internal_eventEmitter.prependListener('input',observe);return()=>{stdout.off('resize',reset);internal_eventEmitter.off('input',observe);};},[internal_eventEmitter]);
 useInput((input,key)=>{
  if(key.eventType==='release')return;
  const value=raw.current;
  if(value==='\x1b[200~'){paste.current='';return;}
  if(value==='\x1b[201~'){if(paste.current!==null){handler(paste.current,{paste:true});paste.current=null;}return;}
  if(paste.current!==null){paste.current+=value;return;}
  if(value==='\x7f'||value==='\x1b\x7f')key={...key,delete:false,backspace:true};
  if(value==='\n'){handler('j',{ctrl:true});return;}
  if(value==='\x1b\r'){handler('',{return:true,meta:true});return;}
  handler(input,key);
 },options);
}
