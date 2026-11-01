import {cellWidth} from './layout.mjs';
import {observeJob,clockNow} from './activity.mjs';
import stripAnsi from 'strip-ansi';
export const clean = value => stripAnsi(String(value ?? '')).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
const graphemes=new Intl.Segmenter(undefined,{granularity:'grapheme'});
export function edit(state,input,key={}){
 let {text,cursor}=state;const points=[...graphemes.segment(text)].map(g=>g.index);points.push(text.length);
 const previous=()=>points.filter(p=>p<cursor).at(-1)??0,next=()=>points.find(p=>p>cursor)??text.length;
 const insert=value=>({text:text.slice(0,cursor)+value+text.slice(cursor),cursor:cursor+value.length});
 const beforeWord=()=>cursor-(text.slice(0,cursor).match(/\S+\s*$/u)?.[0].length||cursor);
 const afterWord=()=>cursor+(text.slice(cursor).match(/^\s*\S+/u)?.[0].length||text.length-cursor);
 if(key.leftArrow||key.meta&&input==='b')return {text,cursor:key.ctrl||key.meta?beforeWord():previous()};
 if(key.rightArrow||key.meta&&input==='f')return {text,cursor:key.ctrl||key.meta?afterWord():next()};
 if(key.home||key.ctrl&&input==='a')return {text,cursor:text.lastIndexOf('\n',cursor-1)+1};
 if(key.end||key.ctrl&&input==='e'){const end=text.indexOf('\n',cursor);return {text,cursor:end<0?text.length:end};}
 if(key.upArrow||key.downArrow){const start=text.lastIndexOf('\n',cursor-1)+1,col=cellWidth(text.slice(start,cursor));let target,end;
  if(key.upArrow){if(!start)return state;target=text.lastIndexOf('\n',start-2)+1;end=start-1;}else{target=text.indexOf('\n',cursor)+1;if(!target)return state;end=text.indexOf('\n',target);if(end<0)end=text.length;}
  let width=0,pos=target;for(const g of graphemes.segment(text.slice(target,end))){if(width+cellWidth(g.segment)>col)break;width+=cellWidth(g.segment);pos+=g.segment.length;}return {text,cursor:pos};
 }
 if(key.backspace||key.ctrl&&['h','w'].includes(input)){const from=key.meta||key.ctrl&&input==='w'?beforeWord():previous();return {text:text.slice(0,from)+text.slice(cursor),cursor:from};}
 if(key.delete||key.meta&&input==='d'){const to=key.ctrl||key.meta?afterWord():next();return {text:text.slice(0,cursor)+text.slice(to),cursor};}
 if(key.ctrl&&input==='u'){const start=text.lastIndexOf('\n',cursor-1)+1;return {text:text.slice(0,start)+text.slice(cursor),cursor:start};}
 if(key.ctrl&&input==='k'){let end=text.indexOf('\n',cursor);if(end<0)end=text.length;return {text:text.slice(0,cursor)+text.slice(end),cursor};}
 if(key.return||key.ctrl&&input==='j')return insert('\n');
 if(key.ctrl||key.meta||key.escape||key.tab)return state;
 return insert(clean(input.replace(/\r\n?/g,'\n')).replaceAll('\t','    '));
}
export function endpoint(value) {
 const url=new URL(value); if(url.protocol!=='http:' || !['127.0.0.1','localhost'].includes(url.hostname) || url.username || url.password || url.pathname!=='/' || url.search || url.hash) throw new Error('Use a loopback HTTP URL, e.g. http://127.0.0.1:4317'); return url.origin;
}
export class Client {
 constructor(url,selection={provider:'local'},authToken){this.authToken=authToken;this.url=endpoint(url);this.selection=selection;this.controller=new AbortController();}
 async request(route,body){const res=await fetch(this.url+'/api/'+route,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json','x-tim-request':'1',...(this.authToken?{authorization:'Bearer '+this.authToken}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.any([this.controller.signal,AbortSignal.timeout(10000)])});const data=await res.json();if(!res.ok)throw new Error(data.error||res.statusText);return data.jobs?{...data,jobs:data.jobs.map(observeJob)}:data;}
 async watch(onState,{onTransport=()=>{},idleMs=45000}={}){
  this.watchController?.abort();const streamController=new AbortController();this.watchController=streamController;
  const signal=AbortSignal.any([this.controller.signal,streamController.signal]);let timer;
  const arm=()=>{clearTimeout(timer);timer=setTimeout(()=>streamController.abort(new Error('Backend event stream stale. Ctrl+R reconnects without resubmitting.')),idleMs);};arm();
  try{const res=await fetch(this.url+'/api/events',{signal,headers:this.authToken?{authorization:'Bearer '+this.authToken}:{}});if(!res.ok)throw new Error('Event stream unavailable');let buffer='';const decoder=new TextDecoder();
   for await(const chunk of res.body){arm();onTransport(clockNow());buffer+=decoder.decode(chunk,{stream:true});if(buffer.length>16*1024*1024)throw new Error('Backend event exceeds limit');let match;
    while((match=/\r?\n\r?\n/.exec(buffer))){const event=buffer.slice(0,match.index);buffer=buffer.slice(match.index+match[0].length);for(const line of event.split(/\r?\n/))if(line.startsWith('data: ')){const data=JSON.parse(line.slice(6));onState(data.jobs?{...data,jobs:data.jobs.map(observeJob)}:data);};}
   }if(!signal.aborted)throw new Error('Backend disconnected. Ctrl+R reconnects without resubmitting.');
  }catch(error){if(streamController.signal.aborted&&!this.controller.signal.aborted)throw streamController.signal.reason;throw error;}finally{clearTimeout(timer);}
 }
 close(){this.controller.abort();}
}
export const demoState = {config:{mainAgentModelId:''},models:[],sessions:[{id:'demo',title:'New session',messages:[]}],jobs:[],engines:{}};
