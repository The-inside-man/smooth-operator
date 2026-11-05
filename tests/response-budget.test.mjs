import test from 'node:test';
import assert from 'node:assert/strict';
import {Llama} from '../server/llama.mjs';

const signal=()=>new AbortController().signal;
const messages=[{role:'system',content:'Keep instructions'},{role:'user',content:'Write the complete answer'}];
function engine(context=32768,count=1000){
 const llama=new Llama('/unused');llama.port=123;llama.contextTokens=context;
 llama.countPrompt=async body=>typeof count==='function'?count(body):count;
 return llama;
}

test('Auto uses the remaining loaded context instead of a fixed short response budget',async()=>{
 const llama=engine();
 const prepared=await llama.prepareContext({messages,max_tokens:0},signal());
 assert.equal(prepared.body.max_tokens,31752);assert.equal(prepared.responseTokens,31752);
 assert.equal(prepared.promptTokens,1000);assert.deepEqual(prepared.body.messages,messages);
 const manual=await llama.prepareContext({messages,max_tokens:16000},signal());assert.equal(manual.body.max_tokens,16000);
 await assert.rejects(llama.prepareContext({messages,max_tokens:1.5},signal()),/integer/);
});

test('Auto removes complete older turns to leave answer space while preserving the active request',async()=>{
 const older=[messages[0],{role:'user',content:'Old question'},{role:'assistant',content:'Old answer'},messages[1]];
 const llama=engine(4096,body=>body.messages.length>2?3800:600);
 const prepared=await llama.prepareContext({messages:older,max_tokens:0},signal());
 assert.equal(prepared.removedMessages,2);assert.equal(prepared.responseTokens,3480);
 assert.deepEqual(prepared.body.messages,messages);assert.equal(older.length,4);
});

test('Auto preserves a large current request and its tool chain even when less response space remains',async()=>{
 const active=[...messages,{role:'assistant',content:null,tool_calls:[{id:'tool',type:'function',function:{name:'run_chat',arguments:'{}'}}]},{role:'tool',tool_call_id:'tool',content:'Keep this result'}];
 const llama=engine(4096,3000);
 const prepared=await llama.prepareContext({messages:active,max_tokens:0},signal());
 assert.equal(prepared.responseTokens,1080);assert.deepEqual(prepared.body.messages,active);
 llama.countPrompt=async()=>4090;
 await assert.rejects(llama.prepareContext({messages:active,max_tokens:0},signal()),/context.+kept intact/i);
});

test('Auto passes the engine unlimited sentinel when no tokenizer or context metadata is available',async()=>{
 for(const context of [4096,null]){
  const llama=engine(context,null),prepared=await llama.prepareContext({messages,max_tokens:0},signal());
  assert.equal(prepared.body.max_tokens,-1);assert.equal(prepared.responseTokens,0);assert.equal(prepared.method,'engine');
 }
});

test('Auto recomputes against an engine-reported smaller native context before retrying',async t=>{
 const llama=engine(),requests=[];let usage;
 t.mock.method(globalThis,'fetch',async(_url,options)=>{
  const body=JSON.parse(options.body);requests.push(body);
  return requests.length===1?Response.json({error:{type:'exceed_context_size_error',n_ctx:8192,n_prompt_tokens:1000}},{status:400}):Response.json({choices:[{finish_reason:'stop',message:{role:'assistant',content:'Complete answer'}}]});
 });
 const answer=await llama.turn(messages,{maxTokens:0},signal(),[],value=>{usage=value;});
 assert.equal(answer.content,'Complete answer');assert.equal(requests.length,2);
 assert.equal(requests[0].max_tokens,31752);assert.equal(requests[1].max_tokens,7176);
 assert.deepEqual(requests[1].messages,messages);assert.equal(usage.contextTokens,8192);assert.equal(usage.removedMessages,0);
});

test('Auto cutoff guidance points to context and keeps partial streamed text',async t=>{
 const llama=engine(4096,1000);let output='';
 t.mock.method(globalThis,'fetch',async()=>new Response('data: '+JSON.stringify({choices:[{delta:{content:'A useful partial answer'},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'length'}]})+'\n\ndata: [DONE]\n\n'));
 await assert.rejects(llama.generate(messages,{maxTokens:0},signal(),token=>{output+=token;}),/filled the available context.+partial answer was kept.+\/context NUMBER/);
 assert.equal(output,'A useful partial answer');
});

test('truncated plain agent answers retain their text, while incomplete tool calls remain unusable',async t=>{
 const llama=engine();let tool=false;
 t.mock.method(globalThis,'fetch',async()=>Response.json({choices:[{finish_reason:'length',message:{content:'The complete first section',...(tool?{tool_calls:[{id:'partial'}]}:{})}}]}));
 await assert.rejects(llama.turn(messages,{maxTokens:0},signal()),error=>/truncated.+context/.test(error.message)&&error.partialText==='The complete first section');
 tool=true;
 await assert.rejects(llama.turn(messages,{maxTokens:0},signal()),error=>/truncated/.test(error.message)&&error.partialText===undefined);
 tool=false;
 await assert.rejects(llama.turn(messages,{maxTokens:0,toolChoice:'required'},signal(),[{type:'function',function:{name:'run_chat'}}]),error=>/truncated/.test(error.message)&&error.partialText===undefined);
});
