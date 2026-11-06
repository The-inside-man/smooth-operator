import {useCallback,useEffect,useReducer,useRef} from 'react';
import {clean,edit} from './core.mjs';

const maxEntries=200,maxCharacters=1_000_000,maxEntryCharacters=100_000,maxScopes=32;
const emptyDraft=()=>({text:'',cursor:0});
const draftFor=text=>({text,cursor:text.length});
export const historyScope=(provider='local',sessionId='')=>JSON.stringify([provider,sessionId||'']);
function append(entries,value){
 if(typeof value!=='string')return entries;
 const text=clean(value).replace(/\r\n?/g,'\n');
 if(!text.trim()||text.length>maxEntryCharacters||entries.at(-1)===text)return entries;
 const next=[...entries,text];let length=next.reduce((sum,item)=>sum+item.length,0);
 while(next.length>maxEntries||length>maxCharacters)length-=next.shift().length;
 return next;
}
export function sessionHistory(session,provider='local'){
 if(!session||(session.provider||'local')!==provider)return [];
 return (session.messages||[]).reduce((entries,message)=>message.role==='user'?append(entries,message.content):entries,[]);
}
function bucket(state,scope,seed=[]){
 if(Object.hasOwn(state.buckets,scope))return state;
 const buckets={...state.buckets,[scope]:seed.reduce(append,[])};
 while(Object.keys(buckets).length>maxScopes)delete buckets[Object.keys(buckets)[0]];
 return {...state,buckets};
}
function activate(state,action){
 state=bucket(state,action.scope,action.seed);
 if(state.scope===action.scope)return state;
 return {...state,scope:action.scope,provider:action.provider,navigation:null,
  draft:state.provider!==action.provider?emptyDraft():state.navigation?.scratch||state.draft};
}
function navigate(state,direction){
 const old=state.navigation;
 if(!old&&direction==='down')return state;
 const entries=old?.entries||state.buckets[state.scope];
 if(!entries.length)return state;
 const index=old?.index??entries.length;
 const next=Math.max(0,Math.min(entries.length,index+(direction==='up'?-1:1)));
 const scratch=old?.scratch||{...state.draft};
 const edits={...old?.edits,...(old?{[index]:{...state.draft}}:{})};
 if(next===entries.length)return {...state,draft:scratch,navigation:null};
 return {...state,draft:edits[next]||draftFor(entries[next]),navigation:{scope:state.scope,entries,index:next,scratch,edits}};
}
export function composerReducer(state,action){
 // Record against the submission's captured origin, including a late response.
 // Snapshot updates do not re-seed existing buckets or duplicate accepted text.
 if(action.type==='record'){
  state=bucket(state,action.scope,action.seed);
  return {...state,buckets:{...state.buckets,[action.scope]:append(state.buckets[action.scope],action.text)}};
 }
 state=activate(state,action);
 if(action.type==='scope')return state;
 if(action.type==='set'){
  const draft=typeof action.value==='function'?action.value(state.draft):action.value;
  return draft===state.draft?state:{...state,draft,navigation:null};
 }
 if(action.type!=='input')return state;
 const {input,key={}}=action;
 const plain=!key.paste&&!key.ctrl&&!key.meta&&!key.shift&&!key.super&&key.eventType!=='release';
 if(plain&&(key.upArrow||key.downArrow)){
  const direction=key.upArrow?'up':'down';
  const boundary=key.upArrow?!state.draft.text.slice(0,state.draft.cursor).includes('\n'):!state.draft.text.slice(state.draft.cursor).includes('\n');
  if(state.navigation||boundary)return navigate(state,direction);
 }
 return {...state,draft:edit(state.draft,input,key)};
}
export function useCommandHistory({initialDraft=emptyDraft(),scope,provider='local',seed=[]}){
 const [state,reactDispatch]=useReducer(composerReducer,null,()=>({draft:initialDraft,scope,provider,buckets:{[scope]:seed.reduce(append,[])},navigation:null}));
 const currentState=useRef(state);currentState.current=state;
 // Ink can emit Up and Enter before React renders again. Apply the same pure
 // transitions in input order so submission reads the text the user recalled.
 const dispatch=useCallback(action=>{currentState.current=composerReducer(currentState.current,action);reactDispatch(action);},[]);
 const currentScope=useRef(scope);currentScope.current=scope;
 useEffect(()=>{dispatch({type:'scope',scope,provider,seed});},[scope,provider]);
 const setDraft=useCallback(value=>{if(currentScope.current===scope)dispatch({type:'set',value,scope,provider,seed});},[scope,provider]);
 const editDraft=useCallback((input,key)=>{if(currentScope.current===scope)dispatch({type:'input',input,key,scope,provider,seed});},[scope,provider]);
 const remember=useCallback((text,destination=scope)=>dispatch({type:'record',text,scope:destination,seed:destination===scope?seed:[]}),[scope]);
 const getDraft=useCallback(()=>currentScope.current===scope&&currentState.current.provider===provider?currentState.current.draft:emptyDraft(),[scope,provider]);
 return {draft:state.provider===provider?state.draft:emptyDraft(),setDraft,editDraft,remember,getDraft};
}
