import test from 'node:test';
import assert from 'node:assert/strict';
import {cloudSelection,generateCloud,listCloudModels} from '../server/cloud-provider.mjs';
import {intentSchema} from '../server/provider-intents.mjs';

const env={ANTHROPIC_API_KEY:'dummy-anthropic-secret'};
const event=(type,extra={})=>'event: '+type+'\r\ndata: '+JSON.stringify({type,...extra})+'\r\n\r\n';
const start=()=>event('message_start',{message:{role:'assistant',content:[],stop_reason:null}});
const block=()=>event('content_block_start',{index:0,content_block:{type:'text',text:''}});
const text=value=>event('content_block_delta',{index:0,delta:{type:'text_delta',text:value}});
const stop=(reason='end_turn')=>[event('content_block_stop',{index:0}),event('message_delta',{delta:{stop_reason:reason}}),event('message_stop')];
const complete=value=>[start(),block(),text(value),...stop()];
function fixture(frames,{hold=false,delay=0}={}){
 return async(_url,options)=>new Response(new ReadableStream({start(controller){
  let timer,i=0;const abort=()=>{clearTimeout(timer);try{controller.error(options.signal.reason);}catch{}};
  options.signal.addEventListener('abort',abort,{once:true});
  const next=()=>{if(options.signal.aborted){abort();return;}try{if(i<frames.length){controller.enqueue(new TextEncoder().encode(frames[i++]));timer=setTimeout(next,delay);}else if(!hold){controller.close();options.signal.removeEventListener('abort',abort);}}catch{}};
  timer=setTimeout(next,delay);
 },cancel(){}}),{headers:{'content-type':'text/event-stream'}});
}
const generate=options=>generateCloud({provider:'anthropic',modelId:'selected-claude-model',messages:[{role:'user',content:'typed request'}],maxTokens:8192,env,...options});

test('Claude uses Messages, versioned key headers, separate system prompts and native intent schemas',async()=>{
 const calls=[],output=[],phases=[];
 const delta=text('{"action":"read"}');
 const stream=fixture([start(),event('content_block_start',{index:1,content_block:{type:'thinking',thinking:''}}),event('content_block_delta',{index:1,delta:{type:'thinking_delta',thinking:'HIDDEN REASONING'}}),event('content_block_delta',{index:1,delta:{type:'signature_delta',signature:'HIDDEN SIGNATURE'}}),event('content_block_stop',{index:1}),': transport heartbeat\r\n\r\n',block(),delta.slice(0,34),delta.slice(34),...stop()],{delay:2});
 await generate({messages:[{role:'system',content:'system one'},{role:'user',content:'question'},{role:'assistant',content:'prior answer'},{role:'system',content:'system two'},{role:'user',content:'follow up'}],intentKind:'read',fetchImpl:async(url,options)=>{calls.push({url,options});return stream(url,options);},onText:value=>output.push(value),onActivity:value=>phases.push(value)});
 assert.deepEqual(output,['{"action":"read"}']);assert.ok(phases.some(p=>p.includes('no visible output')));assert.doesNotMatch(JSON.stringify({output,phases}),/HIDDEN/);
 assert.equal(calls.length,1);assert.equal(calls[0].url,'https://api.anthropic.com/v1/messages');assert.equal(calls[0].options.redirect,'error');
 assert.deepEqual(calls[0].options.headers,{'x-api-key':env.ANTHROPIC_API_KEY,'anthropic-version':'2026-10-21','content-type':'application/json'});
 const body=JSON.parse(calls[0].options.body);assert.equal(body.system,'system one\n\nsystem two');assert.deepEqual(body.messages,[{role:'user',content:'question'},{role:'assistant',content:'prior answer'},{role:'user',content:'follow up'}]);
 assert.equal(body.model,'selected-claude-model');assert.equal(body.stream,true);assert.equal(body.max_tokens,8192);assert.deepEqual(body.output_config,{format:{type:'json_schema',schema:intentSchema('read')}});
 for(const field of ['tools','input','store','thinking'])assert.equal(body[field],undefined);
});

test('Claude chat omits the schema and invalid text input never makes a request',async()=>{
 await generate({fetchImpl:async(url,options)=>{const body=JSON.parse(options.body);assert.equal(body.output_config,undefined);assert.equal(body.system,undefined);return fixture(complete('hello'))(url,options);}});
 for(const messages of [[{role:'tool',content:'private tool output'}],[{role:'user',content:[{type:'image'}]}],null])await assert.rejects(generate({messages,fetchImpl:()=>assert.fail('must validate input first')}),/typed text/);
 assert.deepEqual(cloudSelection('anthropic','selected-claude-model'),{provider:'anthropic',modelId:'selected-claude-model'});
});

test('Claude discovers available model IDs with bounded cursor pagination and no hardcoded model defaults',async()=>{
 const calls=[];
 const ids=await listCloudModels('anthropic',{env,fetchImpl:async(url,options)=>{
  calls.push(url);assert.equal(options.method,undefined);assert.equal(options.redirect,'error');assert.equal(options.headers['x-api-key'],env.ANTHROPIC_API_KEY);assert.equal(options.headers['anthropic-version'],'2026-10-21');
  return Response.json(calls.length===1?{data:[{id:'claude-new'},{id:'bad\x1bmodel'},{id:'claude-older'}],has_more:true,last_id:'claude-older'}:{data:[{id:'claude-older'},{id:'claude-other'}],has_more:false,last_id:'claude-other'});
 }});
 assert.deepEqual(ids,['claude-new','claude-older','claude-other']);assert.deepEqual(calls,['https://api.anthropic.com/v1/models?limit=100','https://api.anthropic.com/v1/models?limit=100&after_id=claude-older']);
 let pages=0;const bounded=await listCloudModels('anthropic',{env,fetchImpl:async()=>{const id='model-'+(++pages);return Response.json({data:[{id}],has_more:true,last_id:id});}});assert.equal(pages,10);assert.equal(bounded.length,10);
 await assert.rejects(listCloudModels('anthropic',{env,fetchImpl:async()=>Response.json({data:[{id:'test'}],has_more:true,last_id:'invalid\n'})}),/pagination/);
});

test('Claude completion requires end_turn and message_stop; incomplete, tool and refusal outcomes fail honestly',async()=>{
 for(const reason of ['tool_use','pause_turn','stop_sequence','unknown',null])await assert.rejects(generate({fetchImpl:fixture([start(),block(),text('partial'),...stop(reason)])}),/incomplete/);
 await assert.rejects(generate({fetchImpl:fixture([start(),block(),text('partial'),...stop('refusal')])}),/declined/);
 for(const frames of [[start(),block(),text('partial')],[start(),block(),text('partial'),event('content_block_stop',{index:0}),event('message_delta',{delta:{stop_reason:'end_turn'}})]])await assert.rejects(generate({fetchImpl:fixture(frames)}),/disconnected/);
 await assert.rejects(generate({fetchImpl:fixture([start(),block(),event('message_delta',{delta:{stop_reason:'end_turn'}}),event('message_stop')])}),/incomplete/);
 await assert.rejects(generate({fetchImpl:fixture([start(),event('content_block_start',{index:0,content_block:{type:'tool_use',name:'untrusted',input:{}}})])}),/unsupported tool/);
});

test('Claude discards reasoning and redacts API keys split across text deltas',async()=>{
 const output=[],phases=[];
 await generate({onText:value=>output.push(value),onActivity:value=>phases.push(value),fetchImpl:fixture([start(),block(),text('before dummy-anth'),text('ropic-secret after'),...stop()])});
 assert.equal(output.join(''),'before [redacted] after');assert.doesNotMatch(JSON.stringify({output,phases}),/dummy-anthropic-secret/);
 await assert.rejects(generate({fetchImpl:fixture([start(),event('content_block_start',{index:0,content_block:{type:'thinking',thinking:''}}),text('HIDDEN REASONING')]),onText:()=>assert.fail('thinking block is never text')}),/Invalid provider text block/);
});

test('Claude ignores transport and ping activity; idle, total and user cancellation close locally',async()=>{
 const phases=[],controller=new AbortController();const timer=setTimeout(()=>controller.abort(),35);
 try{await assert.rejects(generate({signal:controller.signal,onActivity:phase=>phases.push(phase),fetchImpl:fixture(Array(30).fill(': heartbeat\n\n'+event('ping')),{hold:true,delay:2})}),/Cancelled locally/);assert.deepEqual(phases,['Connecting to anthropic','Waiting for provider output']);}finally{clearTimeout(timer);}
 await assert.rejects(generate({idleMs:10,fetchImpl:fixture([],{hold:true})}),/silent/);
 await assert.rejects(generate({totalMs:20,idleMs:100,fetchImpl:fixture(Array(40).fill(event('ping')),{hold:true,delay:2})}),/time limit/);
});

test('Claude malformed/error/HTTP failures are sanitized and never retried',async()=>{
 for(const frames of [['data: invalid\n\n'],['data: null\n\n'],[start(),block(),text(23)],[event('error',{error:{type:'overloaded_error',message:env.ANTHROPIC_API_KEY}})]])await assert.rejects(generate({fetchImpl:fixture(frames)}),error=>{assert.doesNotMatch(error.message,/dummy-anthropic-secret/);return true;});
 for(const status of [400,401,403,429,503]){
  let calls=0;await assert.rejects(generate({fetchImpl:async()=>{calls++;return new Response(env.ANTHROPIC_API_KEY,{status,headers:{'retry-after':'12'}});}}),error=>{assert.match(error.message,new RegExp(String(status)));assert.match(error.message,/No automatic retry/);assert.doesNotMatch(error.message,/dummy-anthropic-secret/);return true;});assert.equal(calls,1);
 }
 await assert.rejects(generate({env:{},fetchImpl:()=>assert.fail('must require credentials')}),/Missing ANTHROPIC_API_KEY/);
 await assert.rejects(generate({fetchImpl:async()=>{throw new Error(env.ANTHROPIC_API_KEY);}}),error=>!error.message.includes(env.ANTHROPIC_API_KEY));
 await assert.rejects(generate({intentKind:'read',fetchImpl:fixture([start(),block(),text('x'.repeat(1048577))])}),/size limit|output exceeded/);
});

test('Claude Auto reads the selected account model maximum instead of imposing 8192 tokens',async()=>{
 for(const maximum of [131072,2097152]){
  const calls=[],output=[];
  await generate({maxTokens:0,onText:value=>output.push(value),fetchImpl:async(url,options)=>{
   calls.push({url,options});
   if(options.method!=='POST'){assert.equal(url,'https://api.anthropic.com/v1/models/selected-claude-model');assert.equal(options.headers['x-api-key'],env.ANTHROPIC_API_KEY);assert.equal(options.redirect,'error');return Response.json({id:'resolved-claude-model',max_tokens:maximum});}
   const body=JSON.parse(options.body);assert.equal(body.max_tokens,maximum);assert.equal(body.model,'selected-claude-model','metadata must not change the requested alias');return fixture(complete('Auto output'))(url,options);
  }});
  assert.equal(calls.length,2);assert.deepEqual(output,['Auto output']);
 }
});

test('Claude Auto cannot infer an absent model maximum and never starts inference after discovery failure',async()=>{
 for(const metadata of [{id:'selected-claude-model'},{id:'selected-claude-model',max_tokens:null},{id:'selected-claude-model',max_tokens:0},{id:'selected-claude-model',max_tokens:1.5},{id:'selected-claude-model',max_tokens:'131072'}]){
  let calls=0;await assert.rejects(generate({maxTokens:0,fetchImpl:async(_url,options)=>{calls++;assert.equal(options.method,undefined);return Response.json(metadata);}}),/\/tokens NUMBER.*No inference/);assert.equal(calls,1);
 }
 for(const status of [401,429,503]){let calls=0;await assert.rejects(generate({maxTokens:0,fetchImpl:async(_url,options)=>{calls++;assert.equal(options.method,undefined);return new Response(env.ANTHROPIC_API_KEY,{status});}}),error=>error.message.includes(String(status))&&!error.message.includes(env.ANTHROPIC_API_KEY));assert.equal(calls,1);}
 await assert.rejects(generate({maxTokens:0,fetchImpl:async()=>{throw new Error(env.ANTHROPIC_API_KEY);}}),error=>error.message.includes('/tokens NUMBER')&&!error.message.includes(env.ANTHROPIC_API_KEY));
 await assert.rejects(generate({maxTokens:0,fetchImpl:async()=>new Response(env.ANTHROPIC_API_KEY,{headers:{'content-type':'application/json'}})}),error=>error.message.includes('Invalid Claude model capacity')&&!error.message.includes(env.ANTHROPIC_API_KEY));
});

test('Claude Auto metadata lookup honors cancellation before starting an inference request',async()=>{
 const controller=new AbortController();let calls=0;
 const timer=setTimeout(()=>controller.abort(),10);
 try{
  await assert.rejects(generate({maxTokens:0,signal:controller.signal,fetchImpl:async(_url,options)=>{calls++;assert.equal(options.method,undefined);return new Promise((_resolve,reject)=>{options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true});});}}),/Cancelled locally/);
  assert.equal(calls,1);
 }finally{clearTimeout(timer);}
});

test('Claude manual budget is sent exactly without model discovery; invalid budgets never call the API',async()=>{
 for(const maxTokens of [1,65536,1048576]){
  let calls=0;await generate({maxTokens,fetchImpl:async(url,options)=>{calls++;assert.equal(options.method,'POST');assert.equal(JSON.parse(options.body).max_tokens,maxTokens);return fixture(complete('manual output'))(url,options);}});assert.equal(calls,1);
 }
 for(const maxTokens of [-1,1.5,1048577,'8192',NaN])await assert.rejects(generate({maxTokens,fetchImpl:()=>assert.fail('invalid budget must not call API')}),/Response tokens/);
 await assert.rejects(generate({maxTokens:1048576,fetchImpl:async()=>new Response(env.ANTHROPIC_API_KEY,{status:400})}),error=>error.message.includes('/tokens auto')&&!error.message.includes(env.ANTHROPIC_API_KEY));
});

test('Claude token cutoffs and context cutoffs have distinct actionable errors and retain partial output',async()=>{
 for(const maxTokens of [0,8192]){
  const output=[],stream=fixture([start(),block(),text('partial answer'),...stop('max_tokens')]);
  await assert.rejects(generate({maxTokens,onText:value=>output.push(value),fetchImpl:async(url,options)=>options.method==='POST'?stream(url,options):Response.json({id:'selected-claude-model',max_tokens:131072})}),error=>{assert.match(error.message,/output-token limit.*Partial output retained/);assert.match(error.message,maxTokens?/\/tokens auto|raise/:/Auto already uses the provider limit/);return true;});
  assert.equal(output.join(''),'partial answer');
 }
 await assert.rejects(generate({fetchImpl:fixture([start(),block(),text('partial answer'),...stop('model_context_window_exceeded')])}),/context limit.*shorten.*cannot enlarge/);
});

test('Claude output may exceed the old 1 MiB ceiling while structured intentions remain bounded',async()=>{
 const value='x'.repeat(65536),frames=[start(),block(),...Array.from({length:20},()=>text(value)),...stop()];let size=0;
 await generate({maxTokens:0,onText:chunk=>{size+=chunk.length;},fetchImpl:async(url,options)=>options.method==='POST'?fixture(frames)(url,options):Response.json({id:'selected-claude-model',max_tokens:131072})});
 assert.equal(size,value.length*20);assert.ok(size>1048576);
});
