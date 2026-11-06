import {EventEmitter} from 'node:events';
export class VoiceSession extends EventEmitter {
 constructor({run,approve=async()=>{},wake='tim',minConfidence=0.8}={}){super();this.run=run;this.approve=approve;this.wake=wake.toLowerCase();this.minConfidence=minConfidence;this.status='muted';this.captureReady=false;this.seen=new Set();this.recent=new Map();this.pending=null;this.controller=null;}
 snapshot(){return {state:this.status,listening:this.captureReady,muted:!this.captureReady,pending:this.pending?{code:this.pending.code,description:this.pending.description}:null};}
 publish(){this.emit('state',this.snapshot());}
 ready(){this.captureReady=true;this.status=this.controller?'processing':'listening';this.publish();}
 mute(){this.captureReady=false;this.status=this.controller?'processing':'muted';this.emit('mute');this.publish();}
 stop(){this.controller?.abort();this.pending=null;this.mute();this.status='stopped';this.publish();this.emit('stop');}
 fail(message){this.captureReady=false;this.status='error';this.emit('output',message);this.publish();}
 queue(description,execute){this.pending={code:String(Math.floor(1000+Math.random()*9000)),description,execute};this.emit('output','Approval required: '+description+'. Say "tim approve '+this.pending.code+'" or use the terminal.');this.publish();}
 async transcript(event){
  if(!this.captureReady||event.type!=='transcript'||event.final!==true||typeof event.id!=='string'||typeof event.text!=='string'||event.text.length>8192||!Number.isFinite(event.confidence)||event.confidence<this.minConfidence)return;
  const text=event.text.trim(),lower=text.toLowerCase();if(!lower.startsWith(this.wake+' '))return;
  if(this.seen.has(event.id)||Date.now()-(this.recent.get(lower)||0)<5000)return;this.seen.add(event.id);this.recent.set(lower,Date.now());if(this.seen.size>256)this.seen.delete(this.seen.values().next().value);if(this.recent.size>256)this.recent.delete(this.recent.keys().next().value);
  await this.command(text.slice(this.wake.length+1).trim());
 }
 async command(text){
  if(text.toLowerCase()==='stop'){this.stop();return;}if(text.toLowerCase()==='mute'){this.mute();return;}if(text.toLowerCase()==='cancel'){this.controller?.abort();this.pending=null;this.publish();return;}
  if(this.controller){this.emit('output','An action is active; say tim cancel first.');return;}
  const approval=/^approve (\d{4})$/i.exec(text);
  if(approval){if(!this.pending||this.pending.code!==approval[1]){this.emit('output','No matching approval. Nothing executed.');return;}const item=this.pending;this.pending=null;return this.perform(signal=>item.execute(signal));}
  if(this.pending){this.emit('output','Review or cancel the pending action first.');return;}
  return this.perform(signal=>this.run(text,{signal,onStatus:s=>this.emit('output',s),queue:(description,execute)=>this.queue(description,execute)}));
 }
 async perform(fn){this.controller=new AbortController();this.status='processing';this.publish();try{const output=await fn(this.controller.signal);if(output)this.emit('output',output);}catch(error){this.emit('output',error.message);}finally{this.controller=null;if(this.status!=='stopped'){this.status=this.captureReady?'listening':'muted';this.publish();}}}
}
