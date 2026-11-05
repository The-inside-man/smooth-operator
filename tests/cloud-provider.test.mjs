import test from 'node:test';
import assert from 'node:assert/strict';
import {generateCloud,listCloudModels} from '../server/cloud-provider.mjs';
import {intentSchema} from '../server/provider-intents.mjs';
const env={OPENAI_API_KEY:'dummy-openai-secret',XAI_API_KEY:'dummy-xai-secret'};
const event=(type,extra={})=>'data: '+JSON.stringify({type,...extra})+'\r\n\r\n';
function fixture(frames,{hold=false,delay=0}={}){return async(_url,options)=>new Response(new ReadableStream({start(controller){let timer;const abort=()=>{clearTimeout(timer);try{controller.error(options.signal.reason);}catch{}};options.signal.addEventListener('abort',abort,{once:true});let i=0;const next=()=>{if(options.signal.aborted)return;try{if(i<frames.length){controller.enqueue(new TextEncoder().encode(frames[i++]));timer=setTimeout(next,delay);}else if(!hold){controller.close();options.signal.removeEventListener('abort',abort);}}catch{}};timer=setTimeout(next,delay);},cancel(){}}),{headers:{'content-type':'text/event-stream'}});}
for(const provider of ['openai','xai']){
 test(provider+': delayed first text, reasoning-only activity, fragmented SSE and strict schema',async()=>{
  const phases=[],text=[],calls=[];const stream=fixture([event('response.created'),': heartbeat\r\n\r\n',event('response.reasoning_summary_text.delta',{delta:'HIDDEN REASONING'}),event('response.output_text.delta',{delta:'{"action":"read"}'}).slice(0,20),event('response.output_text.delta',{delta:'{"action":"read"}'}).slice(20),event('response.completed')],{delay:8});
  await generateCloud({provider,modelId:'user-selected-model',messages:[{role:'user',content:'typed request'}],intentKind:'read',env,fetchImpl:async(url,options)=>{calls.push({url,options});return stream(url,options);},onText:t=>text.push(t),onActivity:p=>phases.push(p)});
  assert.deepEqual(text,['{"action":"read"}']);assert.ok(phases.some(p=>p.includes('no visible output')));assert.ok(!JSON.stringify(phases).includes('HIDDEN'));assert.equal(phases.length,6,'comments and fragments must not be progress');
  const payload=JSON.parse(calls[0].options.body);assert.equal(payload.store,false);assert.equal(payload.stream,true);assert.equal(payload.model,'user-selected-model');assert.deepEqual(payload.text.format.schema,intentSchema('read'));assert.equal(payload.tools,undefined);assert.equal(calls.length,1);
  assert.equal(calls[0].url,provider==='xai'?'https://api.x.ai/v1/responses':'https://api.openai.com/v1/responses');
 });
 test(provider+': heartbeat-only traffic never marks inference progress; cancellation closes locally',async()=>{
  const controller=new AbortController(),phases=[];const timer=setTimeout(()=>controller.abort(),40);
  try{await assert.rejects(generateCloud({provider,modelId:'test',messages:[],env,signal:controller.signal,fetchImpl:fixture(Array(30).fill(': keepalive\n\n'),{hold:true,delay:3}),onActivity:p=>phases.push(p)}),/Cancelled locally/);assert.deepEqual(phases,['Connecting to '+provider,'Waiting for provider output']);}finally{clearTimeout(timer);}
 });
 test(provider+': silent connection, premature EOF, malformed stream, refusal and incomplete output fail honestly',async()=>{
  await assert.rejects(generateCloud({provider,modelId:'test',messages:[],env,idleMs:15,fetchImpl:fixture([],{hold:true})}),/silent/);
  for(const [frames,pattern] of [[[event('response.output_text.delta',{delta:'partial'})],/disconnected/],[['data: broken\n\n'],/Malformed/],[[event('response.refusal.delta')],/declined/],[[event('response.incomplete')],/incomplete/]])await assert.rejects(generateCloud({provider,modelId:'test',messages:[],env,fetchImpl:fixture(frames)}),pattern);
 });
 test(provider+': auth/rate limits/capability errors are redacted and never retried',async()=>{
  for(const code of [400,401,403,429,503]){let calls=0;await assert.rejects(generateCloud({provider,modelId:'test',messages:[],env,fetchImpl:async()=>{calls++;return new Response('SECRET '+JSON.stringify(env),{status:code,headers:{'retry-after':'12'}});}}),error=>{assert.match(error.message,new RegExp(String(code)));assert.ok(!error.message.includes('secret'));assert.match(error.message,/No automatic retry/);return true;});assert.equal(calls,1);}
  await assert.rejects(generateCloud({provider,modelId:'test',messages:[],env,fetchImpl:async()=>{throw new Error('Provider leaked '+env.OPENAI_API_KEY);}}),error=>!error.message.includes('secret'));
  await assert.rejects(generateCloud({provider,modelId:'test',messages:[],env:{},fetchImpl:()=>assert.fail('must not call without key')}),/Missing/);
 });
 test(provider+': dynamic model discovery makes only an explicit models request',async()=>{
  const ids=await listCloudModels(provider,{env,fetchImpl:async(url,options)=>{assert.match(url,/\/models$/);assert.equal(options.method,undefined);return Response.json({data:[{id:'current-user-choice'},{id:'bad\x1bmodel'}]});}});assert.deepEqual(ids,['current-user-choice']);
 });
 test(provider+': Auto omits a TIM token cap and manual budgets use Responses max_output_tokens',async()=>{
  for(const maxTokens of [0,65536,1048576]){
   let calls=0;await generateCloud({provider,modelId:'test',messages:[],maxTokens,env,fetchImpl:async(url,options)=>{calls++;const body=JSON.parse(options.body);assert.equal(body.max_output_tokens,maxTokens||undefined);assert.equal(body.max_tokens,undefined);assert.equal(body.max_completion_tokens,undefined);return fixture([event('response.completed')])(url,options);}});assert.equal(calls,1);
  }
  for(const maxTokens of [-1,1.5,1048577,'8192',NaN])await assert.rejects(generateCloud({provider,modelId:'test',messages:[],maxTokens,env,fetchImpl:()=>assert.fail('invalid budget must not call API')}),/Response tokens/);
 });
 test(provider+': output-token and context cutoffs retain partial text with actionable errors',async()=>{
  for(const maxTokens of [0,8192]){
   const text=[];await assert.rejects(generateCloud({provider,modelId:'test',messages:[],maxTokens,env,onText:value=>text.push(value),fetchImpl:fixture([event('response.output_text.delta',{delta:'partial answer'}),event('response.incomplete',{response:{status:'incomplete',incomplete_details:{reason:'max_output_tokens'}}})])}),error=>{assert.match(error.message,/output-token limit.*Partial output retained/);assert.match(error.message,maxTokens?/\/tokens auto|raise/:/Auto already uses the provider limit/);return true;});assert.equal(text.join(''),'partial answer');
  }
  for(const type of ['response.failed','response.incomplete'])await assert.rejects(generateCloud({provider,modelId:'test',messages:[],env,fetchImpl:fixture([event(type,{response:{error:{code:'context_length_exceeded',message:env.OPENAI_API_KEY}}})])}),error=>/context limit.*cannot enlarge/.test(error.message)&&!error.message.includes(env.OPENAI_API_KEY));
  await assert.rejects(generateCloud({provider,modelId:'test',messages:[],env,fetchImpl:fixture([event('response.completed',{response:{status:'incomplete',incomplete_details:{reason:'max_output_tokens'}}})])}),/output-token limit/);
 });
 test(provider+': long ordinary answers exceed 1 MiB while structured output stays bounded',async()=>{
  const delta='x'.repeat(65536),frames=[...Array.from({length:20},()=>event('response.output_text.delta',{delta})),event('response.completed')];let size=0;
  await generateCloud({provider,modelId:'test',messages:[],env,fetchImpl:fixture(frames),onText:chunk=>{size+=chunk.length;}});assert.equal(size,delta.length*20);
  await assert.rejects(generateCloud({provider,modelId:'test',messages:[],intentKind:'read',env,fetchImpl:fixture(frames)}),/structured output exceeded/);
 });
}
test('OpenAI manual token budgets below the Responses API minimum fail before inference',async()=>{
 for(const maxTokens of [1,15])await assert.rejects(generateCloud({provider:'openai',modelId:'test',messages:[],maxTokens,env,fetchImpl:()=>assert.fail('unsupported budget must not call API')}),/at least 16.*\/tokens auto/);
});
