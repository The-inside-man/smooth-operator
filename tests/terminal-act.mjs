import {act} from 'react';
import {setImmediate as turn} from 'node:timers/promises';

// Flush React's pending state and input-handler effects before the next key.
// Keep the act flag scoped to the helper so clock ticks outside assertions do
// not produce unrelated test warnings.
export async function terminalAct(action){
 const previous=globalThis.IS_REACT_ACT_ENVIRONMENT;
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 try{
  // A frame can be written before passive effects replace its input handler.
  // Flush work from previous async/backend updates before dispatching a key.
  await act(async()=>{await turn();});
  await act(async()=>{await action();});
 }
 finally{
  if(previous===undefined)delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  else globalThis.IS_REACT_ACT_ENVIRONMENT=previous;
 }
}
