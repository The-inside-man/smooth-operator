import {intentSchema} from './provider-intents.mjs';
export const providers=Object.freeze({openai:{origin:'https://api.openai.com/v1',key:'OPENAI_API_KEY'},xai:{origin:'https://api.x.ai/v1',key:'XAI_API_KEY'}});
export function cloudSelection(provider,model){
 if(!Object.hasOwn(providers,provider))throw new Error('Choose local, openai or xai explicitly.');
 if(typeof model!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/.test(model))throw new Error('Choose a provider model ID with --model.');
 return {provider,modelId:model};
}
function credentials(provider,env){const entry=providers[provider];if(!entry)throw new Error('Unknown cloud provider.');const key=env[entry.key];if(!key)throw new Error('Missing '+entry.key+' in the backend environment. No fallback was attempted.');return {entry,key};}
class ProviderError extends Error {}
function httpError(provider,response){const code=response.status;const retry=response.headers.get('retry-after');return new ProviderError(provider+' API '+code+': '+(code===401||code===403?'authentication or access denied':code===429?'rate limit; retry manually'+(/^\d{1,6}$/.test(retry||'')?' after '+retry+'s':''):code===400?'request/model capability rejected (Responses text or strict JSON schema may be unsupported)':code>=500?'provider unavailable; retry manually':'request rejected')+'. No automatic retry.');}
export async function listCloudModels(provider,{fetchImpl=fetch,env=process.env,signal}={}){
 const {entry,key}=credentials(provider,env);
 let response;try{response=await fetchImpl(entry.origin+'/models',{headers:{authorization:'Bearer '+key},redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)});}catch{throw new Error('Model discovery connection failed; no retry.');}
 if(!response.ok)throw httpError(provider,response);
 let body;try{body=await response.json();}catch{throw new Error('Invalid model discovery response.');}if(!Array.isArray(body.data))throw new Error('Invalid model discovery response.');
 return body.data.map(m=>m.id).filter(id=>typeof id==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/.test(id)).slice(0,1000);
}
// No arbitrary URLs, provider tools, uploads, background work, automatic retries or reasoning disclosure.
export async function generateCloud({provider,modelId,messages,intentKind,signal,onText=()=>{},onActivity=()=>{},fetchImpl=fetch,env=process.env,idleMs=90000,totalMs=600000}){
 cloudSelection(provider,modelId);const {entry,key}=credentials(provider,env);
 const body={model:modelId,input:messages,stream:true,store:false};
 if(intentKind)body.text={format:{type:'json_schema',name:'tim_'+intentKind,strict:true,schema:intentSchema(intentKind)}};
 const controller=new AbortController(),combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
 let idleTimer,totalTimer,reader,completed=false,outputSize=0,received=false;
 const arm=()=>{clearTimeout(idleTimer);idleTimer=setTimeout(()=>controller.abort(new Error('Provider stream silent for '+Math.round(idleMs/1000)+'s; connection closed locally. Retry manually.')),idleMs);};
 totalTimer=setTimeout(()=>controller.abort(new Error('Provider request time limit reached; connection closed locally.')),totalMs);arm();
 try{
  onActivity('Connecting to '+provider,{source:'client'});
  const response=await fetchImpl(entry.origin+'/responses',{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify(body),signal:combined,redirect:'error'});
  if(!response.ok)throw httpError(provider,response);
  if(!response.headers.get('content-type')?.includes('text/event-stream'))throw new ProviderError('Provider did not return an event stream.');
  onActivity('Waiting for provider output',{source:'provider'});reader=response.body.getReader();
  const decoder=new TextDecoder();let buffer='';
  while(true){
   const chunk=await reader.read();if(chunk.done)break;arm();buffer+=decoder.decode(chunk.value,{stream:true});
   if(buffer.length>1048576)throw new ProviderError('Provider event exceeded size limit.');
   let match;
   while((match=/\r?\n\r?\n/.exec(buffer))){const frame=buffer.slice(0,match.index);buffer=buffer.slice(match.index+match[0].length);const data=frame.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');
    if(!data||data==='[DONE]')continue; // Transport keepalives are not model progress.
    let event;try{event=JSON.parse(data);}catch{throw new ProviderError('Malformed provider stream event.');}
    const type=event.type;
    if(type==='response.output_text.delta'){
     if(typeof event.delta!=='string')throw new ProviderError('Invalid provider text delta.');outputSize+=event.delta.length;if(outputSize>1048576)throw new ProviderError('Provider output exceeded limit.');
     received=true;onActivity('Generating response',{source:'provider'});onText(event.delta.split(key).join('[redacted]'));
    }else if(type==='response.completed'){completed=true;onActivity('Response complete',{source:'provider'});}
    else if(['response.failed','response.incomplete','error'].includes(type))throw new ProviderError('Provider response failed or incomplete. Partial output retained; retry manually.');
    else if(type==='response.refusal.delta'||type==='response.refusal.done')throw new ProviderError('Provider declined this request.');
    else if(type==='response.created'||type==='response.in_progress'||type==='response.queued'||type==='response.output_item.added'||type==='response.output_item.done'||typeof type==='string'&&type.startsWith('response.reasoning'))onActivity(received?'Provider processing':'Provider processing; no visible output yet',{source:'provider'});
   }
   if(completed)break;
  }
  if(!completed)throw new ProviderError('Provider disconnected before completion. Partial output retained; no automatic retry.');
 }catch(error){
  if(signal?.aborted)throw new Error('Cancelled locally; provider-side stopping and billing are not confirmed.');
  if(controller.signal.aborted)throw controller.signal.reason;
  // Never forward fetch errors, response bodies, headers or provider-supplied error text.
  if(error instanceof ProviderError)throw error;
  throw new ProviderError('Provider connection failed. Outcome may be uncertain; no automatic retry.');
 }finally{clearTimeout(idleTimer);clearTimeout(totalTimer);controller.abort();await reader?.cancel().catch(()=>{});}
}
