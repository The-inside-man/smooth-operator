import test from 'node:test';
import assert from 'node:assert/strict';
import {Writable} from 'node:stream';
import {clipboardCommands,copyText,latestAssistantResponse,fencedClipboardCode,copyLatestResponse} from '../cli/clipboard.mjs';

function clipboardFixture(outcomes=[]){
 const calls=[];
 const execFileImpl=(file,args,options,callback)=>{
  const outcome=outcomes[calls.length]||{},call={file,args:[...args],options,input:''};calls.push(call);
  if(outcome.throw)throw outcome.throw;
  const stdin=new Writable({write(chunk,_encoding,done){call.input+=chunk.toString('utf8');done();},final(done){done();queueMicrotask(()=>callback(outcome.error||null,'',''));}});
  return {stdin,kill(){call.killed=true;}};
 };
 return {calls,execFileImpl};
}

test('macOS copy uses pbcopy with UTF-8 stdin and never places response data in arguments',async()=>{
 const fixture=clipboardFixture(),text='print("界👩‍💻")\n$(do-not-run) `literal` ; private text';
 const result=await copyText(text,{platform:'darwin',env:{LC_ALL:'C'},execFileImpl:fixture.execFileImpl});
 assert.equal(fixture.calls.length,1);const call=fixture.calls[0];
 assert.equal(call.file,'/usr/bin/pbcopy');assert.deepEqual(call.args,[]);assert.equal(call.input,text);
 assert.equal(call.options.shell,false);assert.equal(call.options.windowsHide,true);assert.equal(call.options.timeout,5000);assert.equal(call.options.env.LC_CTYPE,'UTF-8');assert.equal(call.options.env.LC_ALL,'en_US.UTF-8');
 assert.equal(result.bytes,Buffer.byteLength(text));assert.equal(result.characters,[...text].length);assert.equal(result.tool,'pbcopy');
});

test('Windows copies Unicode through stdin into a fixed Set-Clipboard program',async()=>{
 const fixture=clipboardFixture(),text="' ; $(Remove-Item NEVER) ; print('界')";
 await copyText(text,{platform:'win32',env:{SystemRoot:'C:\\Windows Fixture'},execFileImpl:fixture.execFileImpl});
 const call=fixture.calls[0];assert.equal(call.file,'C:\\Windows Fixture\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
 assert.ok(call.args.includes('-NoProfile'));assert.ok(call.args.includes('-NonInteractive'));assert.match(call.args.at(-1),/Set-Clipboard.*ReadToEnd/);assert.match(call.args.at(-1),/UTF8Encoding/);
 assert.equal(call.input,text);assert.ok(call.args.every(arg=>!arg.includes('Remove-Item NEVER')));assert.equal(call.options.shell,false);
});

test('Linux tries Wayland then xclip using stdin and explicit clipboard selection',async()=>{
 const fixture=clipboardFixture([{error:Object.assign(new Error('missing'),{code:'ENOENT'})},{}]),text='Unicode 界\nsecond line';
 const result=await copyText(text,{platform:'linux',env:{DISPLAY:':fixture'},execFileImpl:fixture.execFileImpl});
 assert.deepEqual(fixture.calls.map(call=>[call.file,call.args]),[['wl-copy',['--type','text/plain;charset=utf-8']],['xclip',['-selection','clipboard']]]);
 assert.ok(fixture.calls.every(call=>call.input===text&&call.options.shell===false));assert.equal(result.tool,'xclip');
 const wayland=clipboardFixture();await copyText(text,{platform:'linux',execFileImpl:wayland.execFileImpl});assert.equal(wayland.calls.length,1);
});

test('clipboard failures are actionable and never echo response data or underlying stderr',async()=>{
 const secret='PRIVATE_RESPONSE_DO_NOT_PRINT',fixture=clipboardFixture([{error:new Error(secret)},{error:new Error(secret)}]);
 await assert.rejects(copyText(secret,{platform:'linux',execFileImpl:fixture.execFileImpl}),error=>{
  assert.match(error.message,/graphical session.*wl-copy or xclip.*F2/);assert.ok(!error.message.includes(secret));return true;
 });
 const mac=clipboardFixture([{throw:new Error(secret)}]);await assert.rejects(copyText(secret,{platform:'darwin',execFileImpl:mac.execFileImpl}),/macOS clipboard is unavailable.*F2/);
});

test('empty input, unsupported platforms and cancellation do not touch a clipboard',async()=>{
 const fixture=clipboardFixture();
 await assert.rejects(copyText(' \n ',{platform:'darwin',execFileImpl:fixture.execFileImpl}),/no response text/);
 await assert.rejects(copyText('data',{platform:'unsupported',execFileImpl:fixture.execFileImpl}),/unavailable on this platform.*F2/);
 const controller=new AbortController();controller.abort();await assert.rejects(copyText('data',{platform:'linux',signal:controller.signal,execFileImpl:fixture.execFileImpl}),/cancelled/);
 assert.equal(fixture.calls.length,0);
 const aborted=clipboardFixture([{error:Object.assign(new Error('cancelled'),{name:'AbortError'})}]);
 await assert.rejects(copyText('data',{platform:'linux',execFileImpl:aborted.execFileImpl}),/cancelled/);assert.equal(aborted.calls.length,1,'cancellation must not start another helper');
});

test('copy sanitizes terminal control sequences while preserving source whitespace and literal escapes',async()=>{
 const fixture=clipboardFixture();
 await copyText('\x1b]52;c;UNTRUSTED\x07\x1b[31mred\x1b[0m\r\n\tprint("\\x1b")\0',{platform:'darwin',execFileImpl:fixture.execFileImpl});
 assert.equal(fixture.calls[0].input,'red\n\tprint("\\x1b")');assert.doesNotMatch(fixture.calls[0].input,/\x1b/);
});

test('latest response selection permits partial failed assistant text but excludes users and empty messages',async()=>{
 const messages=[{role:'assistant',content:'older'},{role:'user',content:'USER_MUST_NOT_COPY'},{role:'assistant',content:'latest partial 界',status:'failed'},{role:'assistant',content:'',status:'running'},null];
 assert.equal(latestAssistantResponse(messages),'latest partial 界');
 const fixture=clipboardFixture(),result=await copyLatestResponse(messages,{platform:'darwin',execFileImpl:fixture.execFileImpl});
 assert.equal(fixture.calls[0].input,'latest partial 界');assert.equal(result.blocks,0);
 assert.throws(()=>latestAssistantResponse([{role:'user',content:'only user'}]),/no response text/);
});

test('code copy joins complete fenced blocks without prose, fence markers or language labels',async()=>{
 const response='Explanation\n```python\ndef hello():\n    print("界")\n```\nMore prose\n~~~json\n{"ok": true}\n~~~~\nDone';
 assert.deepEqual(fencedClipboardCode(response),['def hello():\n    print("界")','{"ok": true}']);
 const fixture=clipboardFixture(),result=await copyLatestResponse([{role:'assistant',content:response}],{code:true,platform:'darwin',execFileImpl:fixture.execFileImpl});
 assert.equal(result.blocks,2);assert.equal(fixture.calls[0].input,'def hello():\n    print("界")\n\n{"ok": true}');
 assert.deepEqual(fencedClipboardCode('````text\n``` inner marker\n````'),['``` inner marker']);
});

test('unfinished or absent code fences fail before copying and never fall back to an older response',async()=>{
 const fixture=clipboardFixture();
 await assert.rejects(copyLatestResponse([{role:'assistant',content:'```python\nprint(1)'}],{code:true,platform:'darwin',execFileImpl:fixture.execFileImpl}),/unfinished code fence/);
 await assert.rejects(copyLatestResponse([{role:'assistant',content:'```python\nold()\n```'},{role:'assistant',content:'No code in this latest answer'}],{code:true,platform:'darwin',execFileImpl:fixture.execFileImpl}),/no complete fenced code/);
 assert.equal(fixture.calls.length,0);
});

test('clipboard helper commands contain no OSC 52 or response-derived executable names',()=>{
 for(const platform of ['darwin','win32','linux'])for(const command of clipboardCommands(platform)){
  assert.doesNotMatch(command.file+command.args.join(' '),/\x1b|OSC.?52/);assert.ok(command.file.length>0);
 }
});
