import {intentSchema} from './provider-intents.mjs';
export const providers=Object.freeze({openai:{origin:'https://api.openai.com/v1',key:'OPENAI_API_KEY'},xai:{origin:'https://api.x.ai/v1',key:'XAI_API_KEY'},anthropic:{origin:'https://api.anthropic.com/v1',key:'ANTHROPIC_API_KEY'}});
const modelIdPattern=/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/;
const validModelId=id=>typeof id==='string'&&modelIdPattern.test(id);
const providerHeaders=(provider,key)=>provider==='anthropic'?{'x-api-key':key,'anthropic-version':'2026-10-21'}:{authorization:'Bearer '+key};
export function cloudSelection(provider,model){
 if(!Object.hasOwn(providers,provider))throw new Error('Choose local, openai, xai or anthropic explicitly.');
 if(!validModelId(model))throw new Error('Choose a provider model ID with --model.');
 return {provider,modelId:model};
}
function credentials(provider,env){const entry=providers[provider];if(!entry)throw new Error('Unknown cloud provider.');const key=env[entry.key];if(!key)throw new Error('Missing '+entry.key+' in the backend environment. No fallback was attempted. Run tim providers '+provider+' for API-key setup instructions.');return {entry,key};}
class ProviderError extends Error {}
function httpError(provider,response,maxTokens=0){const code=response.status;const retry=response.headers.get('retry-after');return new ProviderError(provider+' API '+code+': '+(code===401||code===403?'authentication or access denied':code===429?'rate limit; retry manually'+(/^\d{1,6}$/.test(retry||'')?' after '+retry+'s':''):code===400?'request/model capability rejected (streaming text or JSON schema may be unsupported)'+(maxTokens?' or manual token budget unsupported; try /tokens auto or a budget within this model\'s output limit':''):code>=500?'provider unavailable; retry manually':'request rejected')+'. No automatic retry.');}
export async function listCloudModels(provider,{fetchImpl=fetch,env=process.env,signal}={}){
 const {entry,key}=credentials(provider,env);
 const discoverySignal=signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000),ids=new Set();let cursor='';
 // Pagination is discovery only, never an automatic retry of an inference request.
 for(let page=0;page<(provider==='anthropic'?10:1);page++){
  const suffix=provider==='anthropic'?'?limit=100'+(cursor?'&after_id='+encodeURIComponent(cursor):''):'';
  let response;try{response=await fetchImpl(entry.origin+'/models'+suffix,{headers:providerHeaders(provider,key),redirect:'error',signal:discoverySignal});}catch{throw new Error('Model discovery connection failed; no retry.');}
  if(!response.ok)throw httpError(provider,response);
  let body;try{body=await response.json();}catch{throw new Error('Invalid model discovery response.');}if(!body||!Array.isArray(body.data))throw new Error('Invalid model discovery response.');
  for(const model of body.data)if(validModelId(model?.id))ids.add(model.id);
  if(provider!=='anthropic'||!body.has_more||ids.size>=1000)break;
  if(!body.data.length||!validModelId(body.last_id)||body.last_id===cursor)throw new Error('Invalid model discovery pagination.');
  cursor=body.last_id;
 }
 return [...ids].slice(0,1000);
}
function messageBody(modelId,messages,intentKind){
 if(!Array.isArray(messages)||messages.some(m=>!m||!['system','user','assistant'].includes(m.role)||typeof m.content!=='string'))throw new Error('Claude supports typed text conversation only.');
 const system=messages.filter(m=>m.role==='system').map(m=>m.content).join('\n\n');
 const body={model:modelId,messages:messages.filter(m=>m.role!=='system').map(({role,content})=>({role,content})),stream:true};
 if(system)body.system=system;
 if(intentKind)body.output_config={format:{type:'json_schema',schema:intentSchema(intentKind)}};
 return body;
}
function tokenLimitError(maxTokens){
 return new ProviderError('Provider reached its output-token limit'+(maxTokens?' (manual budget '+maxTokens+')':'')+'. Partial output retained. '+(maxTokens?'Use /tokens auto or raise the response budget, then retry manually.':'Auto already uses the provider limit; choose a model with a larger output limit or split the request into smaller parts.')+' Available context can also limit the response. No automatic continuation.');
}
function contextLimitError(){return new ProviderError('Provider reached the model context limit. Partial output retained. Start a new session or shorten the conversation; raising the response-token budget cannot enlarge the context window. No automatic continuation.');}
async function anthropicTokenMaximum(modelId,{entry,key,fetchImpl,signal}){
 let response;
 try{response=await fetchImpl(entry.origin+'/models/'+encodeURIComponent(modelId),{headers:providerHeaders('anthropic',key),redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(15000)])});}
 catch{throw new ProviderError('Could not read this Claude model\'s output limit. Retry manually or set an explicit supported budget with /tokens NUMBER. No inference was started.');}
 if(!response.ok)throw httpError('anthropic',response);
 let metadata;try{metadata=await response.json();}catch{throw new ProviderError('Invalid Claude model capacity response. Set an explicit supported budget with /tokens NUMBER; no inference was started.');}
 if(!validModelId(metadata?.id)||!Number.isSafeInteger(metadata.max_tokens)||metadata.max_tokens<1)throw new ProviderError('Claude did not report this model\'s maximum output tokens. Set an explicit supported budget with /tokens NUMBER; Auto cannot safely choose one. No inference was started.');
 return metadata.max_tokens;
}
// No arbitrary URLs, provider tools, uploads, background work, automatic retries or reasoning disclosure.
export async function generateCloud({provider,modelId,messages,intentKind,maxTokens=0,signal,onText=()=>{},onActivity=()=>{},fetchImpl=fetch,env=process.env,idleMs=90000,totalMs=600000}){
 cloudSelection(provider,modelId);const {entry,key}=credentials(provider,env);
 if(!Number.isInteger(maxTokens)||maxTokens<0||maxTokens>1048576)throw new Error('Response tokens must be Auto (0) or a whole number from 1 to 1048576.');
 if(provider==='openai'&&maxTokens>0&&maxTokens<16)throw new Error('OpenAI Responses requires at least 16 output tokens. Use /tokens auto or /tokens 16 (or higher). No inference was started.');
 const anthropic=provider==='anthropic',body=anthropic?messageBody(modelId,messages,intentKind):{model:modelId,input:messages,stream:true,store:false};
 if(intentKind&&!anthropic)body.text={format:{type:'json_schema',name:'tim_'+intentKind,strict:true,schema:intentSchema(intentKind)}};
 if(maxTokens)body[anthropic?'max_tokens':'max_output_tokens']=maxTokens;
 const textLimit=intentKind?1048576:16*1048576;
 const controller=new AbortController(),combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
 let idleTimer,totalTimer,reader,completed=false,outputSize=0,received=false,pendingText='',messageStarted=false,stopReason;
 const blocks=new Map();
 const emitText=text=>{
  if(typeof text!=='string')throw new ProviderError('Invalid provider text delta.');
  outputSize+=text.length;if(outputSize>textLimit)throw new ProviderError('Provider '+(intentKind?'structured ':'')+'output exceeded TIM\'s '+(intentKind?'1':'16')+' MiB text safety limit. Partial output retained; ask for shorter sections.');
  received=true;onActivity('Generating response',{source:'provider'});
  pendingText=(pendingText+text).split(key).join('[redacted]');
  // Keep a possible key prefix private even when a provider splits it across deltas.
  let suffix=0;for(let length=1;length<key.length&&length<=pendingText.length;length++)if(pendingText.endsWith(key.slice(0,length)))suffix=length;
  const visible=pendingText.slice(0,pendingText.length-suffix);pendingText=pendingText.slice(pendingText.length-suffix);if(visible)onText(visible);
 };
 const arm=()=>{clearTimeout(idleTimer);idleTimer=setTimeout(()=>controller.abort(new Error('Provider stream silent for '+Math.round(idleMs/1000)+'s; connection closed locally. Retry manually.')),idleMs);};
 totalTimer=setTimeout(()=>controller.abort(new Error('Provider request time limit reached; connection closed locally.')),totalMs);arm();
 try{
  onActivity('Connecting to '+provider,{source:'client'});
  if(anthropic&&!maxTokens){onActivity('Checking model output capacity',{source:'client'});body.max_tokens=await anthropicTokenMaximum(modelId,{entry,key,fetchImpl,signal:combined});arm();}
  const response=await fetchImpl(entry.origin+(anthropic?'/messages':'/responses'),{method:'POST',headers:{...providerHeaders(provider,key),'content-type':'application/json'},body:JSON.stringify(body),signal:combined,redirect:'error'});
  if(!response.ok)throw httpError(provider,response,maxTokens);
  if(!response.headers.get('content-type')?.includes('text/event-stream'))throw new ProviderError('Provider did not return an event stream.');
  onActivity('Waiting for provider output',{source:'provider'});reader=response.body.getReader();
  const decoder=new TextDecoder();let buffer='';
  while(true){
   const chunk=await reader.read();if(chunk.done)break;arm();buffer+=decoder.decode(chunk.value,{stream:true});
   if(buffer.length>textLimit)throw new ProviderError('Provider event exceeded size limit. Partial output retained.');
   let match;
   while((match=/\r?\n\r?\n/.exec(buffer))){const frame=buffer.slice(0,match.index);buffer=buffer.slice(match.index+match[0].length);const data=frame.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');
    if(!data||data==='[DONE]')continue; // Transport keepalives are not model progress.
    let event;try{event=JSON.parse(data);}catch{throw new ProviderError('Malformed provider stream event.');}
    if(!event||typeof event!=='object'||Array.isArray(event))throw new ProviderError('Malformed provider stream event.');
    const type=event.type;
    if(anthropic){
     if(type==='error')throw new ProviderError('Provider response failed or incomplete. Partial output retained; retry manually.');
     if(type==='message_start'){if(messageStarted)throw new ProviderError('Invalid provider message start.');messageStarted=true;onActivity('Provider processing; no visible output yet',{source:'provider'});}
     else if(type==='content_block_start'){
      if(!messageStarted||!Number.isInteger(event.index)||blocks.has(event.index)||typeof event.content_block?.type!=='string')throw new ProviderError('Invalid provider content block.');
      const block=event.content_block;blocks.set(event.index,block.type);
      if(block.type==='tool_use'||block.type==='server_tool_use')throw new ProviderError('Provider requested an unsupported tool. No tool was run.');
      if(block.type==='text'){if(typeof block.text!=='string')throw new ProviderError('Invalid provider text delta.');if(block.text)emitText(block.text);}
     }else if(type==='content_block_delta'){
      if(!blocks.has(event.index)||!event.delta||typeof event.delta.type!=='string')throw new ProviderError('Invalid provider content delta.');
      if(event.delta.type==='text_delta'){if(blocks.get(event.index)!=='text')throw new ProviderError('Invalid provider text block.');emitText(event.delta.text);}
      else if(event.delta.type==='thinking_delta'||event.delta.type==='signature_delta')onActivity(received?'Provider processing':'Provider processing; no visible output yet',{source:'provider'});
     }else if(type==='content_block_stop'){if(!blocks.delete(event.index))throw new ProviderError('Invalid provider content stop.');}
     else if(type==='message_delta'){
      if(!messageStarted||!event.delta||typeof event.delta!=='object')throw new ProviderError('Invalid provider message delta.');
      if(event.delta.stop_reason!==undefined&&event.delta.stop_reason!==null)stopReason=event.delta.stop_reason;
     }else if(type==='message_stop'){
      if(stopReason==='refusal')throw new ProviderError('Provider declined this request.');
      if(stopReason==='max_tokens')throw tokenLimitError(maxTokens);
      if(stopReason==='model_context_window_exceeded')throw contextLimitError();
      if(!messageStarted||blocks.size||stopReason!=='end_turn')throw new ProviderError('Provider response failed or incomplete. Partial output retained; retry manually.');
      completed=true;onActivity('Response complete',{source:'provider'});
     }
    }else if(type==='response.output_text.delta')emitText(event.delta);
    else if(type==='response.completed'||type==='response.failed'||type==='response.incomplete'||type==='error'){
     const reason=event.response?.incomplete_details?.reason,code=event.response?.error?.code||event.error?.code||event.code;
     if(['context_length_exceeded','model_context_window_exceeded'].includes(reason)||['context_length_exceeded','model_context_window_exceeded'].includes(code))throw contextLimitError();
     if(reason==='max_output_tokens')throw tokenLimitError(maxTokens);
     if(type!=='response.completed'||event.response?.status&&event.response.status!=='completed')throw new ProviderError('Provider response failed or incomplete. Partial output retained; retry manually.');
     completed=true;onActivity('Response complete',{source:'provider'});
    }
    else if(type==='response.refusal.delta'||type==='response.refusal.done')throw new ProviderError('Provider declined this request.');
    else if(type==='response.created'||type==='response.in_progress'||type==='response.queued'||type==='response.output_item.added'||type==='response.output_item.done'||typeof type==='string'&&type.startsWith('response.reasoning'))onActivity(received?'Provider processing':'Provider processing; no visible output yet',{source:'provider'});
   }
   if(completed)break;
  }
  if(!completed)throw new ProviderError('Provider disconnected before completion. Partial output retained; no automatic retry.');
  if(pendingText)onText(pendingText);
 }catch(error){
  if(signal?.aborted)throw new Error('Cancelled locally; provider-side stopping and billing are not confirmed.');
  if(controller.signal.aborted)throw controller.signal.reason;
  // Never forward fetch errors, response bodies, headers or provider-supplied error text.
  if(error instanceof ProviderError)throw error;
  throw new ProviderError('Provider connection failed. Outcome may be uncertain; no automatic retry.');
 }finally{clearTimeout(idleTimer);clearTimeout(totalTimer);controller.abort();await reader?.cancel().catch(()=>{});}
}
