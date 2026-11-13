import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {Studio,jobSettings} from '../server/studio.mjs';
import {scriptInstructions} from '../server/script-format.mjs';
test('script formatting is an explicit language hint, not execution authority',()=>{
 assert.equal(scriptInstructions(undefined),'');assert.match(scriptInstructions('python'),/exactly one complete fenced python/);assert.match(scriptInstructions('javascript'),/user's approval/);assert.throws(()=>scriptInstructions('python; run anything'),/Choose Python or JavaScript/);assert.equal(jobSettings({prompt:'Create code',scriptLanguage:'python'},'chat').scriptLanguage,'python');assert.throws(()=>jobSettings({scriptLanguage:'python'},'image'),/Chat, Code or Agent/);
});
for(const provider of ['local','openai'])test(`${provider} keeps the user request intact and adds a source-only formatting instruction`,async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'tim-script-format-')),studio=new Studio(dir),received=[];for(const folder of [studio.workDir,studio.outputDir,studio.uploadDir])await fs.mkdir(folder,{recursive:true});
 studio.config={context:4096,maxTokens:0,systemPrompt:'Fixture assistant',temperature:.1};studio.registry={models:[{id:'fixture',name:'Fixture',kind:'chat',available:true}],runtimes:{chat:{}}};studio.loadChat=async()=>{};studio.llama={modelId:'fixture',generate:async(messages,_settings,_signal,onToken)=>{received.push(messages);onToken('```python\nprint("fixture")\n```');},unload:async()=>{}};studio.generateCloud=async({messages,onText})=>{received.push(messages);onText('```python\nprint("fixture")\n```');};t.after(async()=>{await studio.close();await fs.rm(dir,{recursive:true,force:true});});
 const session=await studio.newSession(),prompt='Create orbit.py and run it',job=await studio.enqueue({sessionId:session.id,kind:'chat',modelId:'fixture',provider,prompt,scriptLanguage:'python'});for(let n=0;n<200&&['queued','running'].includes(job.status);n++)await delay(5);
 assert.equal(job.status,'completed',job.phase);assert.equal(received.length,1);assert.match(received[0][0].content,/separate terminal Save\/Run review/);assert.equal(received[0].at(-1).content,prompt);assert.equal(job.settings.scriptLanguage,'python');
});
