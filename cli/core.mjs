import {observeJob,clockNow} from './activity.mjs';
import stripAnsi from 'strip-ansi';
export const clean = value => stripAnsi(String(value ?? '')).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
export function edit(state, input, key = {}) {
  let {text, cursor} = state;
  const insert = value => ({text: text.slice(0,cursor)+value+text.slice(cursor), cursor: cursor+value.length});
  if (key.leftArrow) return {text,cursor:Math.max(0,cursor-1)};
  if (key.rightArrow) return {text,cursor:Math.min(text.length,cursor+1)};
  if (key.home || key.ctrl && input === 'a') return {text,cursor:text.lastIndexOf('\n',cursor-1)+1};
  if (key.end || key.ctrl && input === 'e') {const end=text.indexOf('\n',cursor); return {text,cursor:end<0?text.length:end};}
  if (key.upArrow || key.downArrow) {
    const start=text.lastIndexOf('\n',cursor-1)+1, col=cursor-start;
    if(key.upArrow) {if(!start)return state; const previous=text.lastIndexOf('\n',start-2)+1; return {text,cursor:Math.min(previous+col,start-1)};}
    const end=text.indexOf('\n',cursor); if(end<0)return state;
    const next=text.indexOf('\n',end+1);return {text,cursor:Math.min(end+1+col,next<0?text.length:next)};
  }
  if (key.backspace) return cursor ? {text:text.slice(0,cursor-1)+text.slice(cursor),cursor:cursor-1}:state;
  if (key.delete) return {text:text.slice(0,cursor)+text.slice(cursor+1),cursor};
  if (key.return || key.ctrl && input==='j') return insert('\n');
  if (key.ctrl || key.meta || key.escape || key.tab) return state;
  return insert(clean(input.replace(/\r\n?/g,'\n')));
}
export function endpoint(value) {
 const url=new URL(value); if(url.protocol!=='http:' || !['127.0.0.1','localhost'].includes(url.hostname) || url.username || url.password || url.pathname!=='/' || url.search || url.hash) throw new Error('Use a loopback HTTP URL, e.g. http://127.0.0.1:4317'); return url.origin;
}
export class Client {
 constructor(url,selection={provider:'local'}){this.url=endpoint(url);this.selection=selection;this.controller=new AbortController();}
 async request(route,body){const res=await fetch(this.url+'/api/'+route,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json','x-tim-request':'1'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.any([this.controller.signal,AbortSignal.timeout(10000)])});const data=await res.json();if(!res.ok)throw new Error(data.error||res.statusText);return data.jobs?{...data,jobs:data.jobs.map(observeJob)}:data;}
 async watch(onState,{onTransport=()=>{},idleMs=45000}={}){
  this.watchController?.abort();const streamController=new AbortController();this.watchController=streamController;
  const signal=AbortSignal.any([this.controller.signal,streamController.signal]);let timer;
  const arm=()=>{clearTimeout(timer);timer=setTimeout(()=>streamController.abort(new Error('Backend event stream stale. Ctrl+R reconnects without resubmitting.')),idleMs);};arm();
  try{const res=await fetch(this.url+'/api/events',{signal});if(!res.ok)throw new Error('Event stream unavailable');let buffer='';const decoder=new TextDecoder();
   for await(const chunk of res.body){arm();onTransport(clockNow());buffer+=decoder.decode(chunk,{stream:true});if(buffer.length>16*1024*1024)throw new Error('Backend event exceeds limit');let match;
    while((match=/\r?\n\r?\n/.exec(buffer))){const event=buffer.slice(0,match.index);buffer=buffer.slice(match.index+match[0].length);for(const line of event.split(/\r?\n/))if(line.startsWith('data: ')){const data=JSON.parse(line.slice(6));onState(data.jobs?{...data,jobs:data.jobs.map(observeJob)}:data);};}
   }if(!signal.aborted)throw new Error('Backend disconnected. Ctrl+R reconnects without resubmitting.');
  }catch(error){if(streamController.signal.aborted&&!this.controller.signal.aborted)throw streamController.signal.reason;throw error;}finally{clearTimeout(timer);}
 }
 close(){this.controller.abort();}
}
export const demoState = {config:{mainAgentModelId:''},models:[],sessions:[{id:'demo',title:'New session',messages:[]}],jobs:[],engines:{}};
