import test from 'node:test';
import assert from 'node:assert/strict';
import {composerReducer,historyScope,sessionHistory} from '../cli/history.mjs';
const scope=historyScope('local','session');
const initial=()=>({draft:{text:'Draft 界',cursor:6},scope,provider:'local',buckets:{[scope]:['Old','New']},navigation:null});
const input=(state,key,text='')=>composerReducer(state,{type:'input',scope,provider:'local',input:text,key});

test('history retains recent whole user requests, consecutive repeats collapse, and other roles/providers stay private',()=>{
 const session={messages:[{role:'system',content:'private system'},{role:'assistant',content:'private answer'},{role:'tool',content:'private tool'},...Array.from({length:205},(_,index)=>({role:'user',content:'Request '+index})),{role:'user',content:'Request 204'},{role:'user',content:'x'.repeat(100001)}]};
 const entries=sessionHistory(session);assert.equal(entries.length,200);assert.equal(entries[0],'Request 5');assert.equal(entries.at(-1),'Request 204');
 assert.deepEqual(sessionHistory(session,'openai'),[]);
 assert.deepEqual(sessionHistory({provider:'xai',messages:[{role:'user',content:'A'},{role:'user',content:'B'},{role:'user',content:'A'}]},'xai'),['A','B','A']);
});

test('late snapshot seeds do not duplicate an accepted prompt or reorder a later slash command',()=>{
 let state=initial();
 for(const text of ['Accepted request','/help'])state=composerReducer(state,{type:'record',scope,text});
 state=composerReducer(state,{type:'scope',scope,provider:'local',seed:['Old','New','Accepted request']});
 state=input(state,{upArrow:true});assert.equal(state.draft.text,'/help');
 state=input(state,{upArrow:true});assert.equal(state.draft.text,'Accepted request');
 state=input(state,{upArrow:true});assert.equal(state.draft.text,'New');
});

test('a no-op late draft setter preserves active history navigation and its original scratch cursor',()=>{
 let state=input(initial(),{upArrow:true});
 state=composerReducer(state,{type:'set',scope,provider:'local',value:current=>current.text==='Some earlier submission'?{text:'',cursor:0}:current});
 assert.equal(state.draft.text,'New');assert.ok(state.navigation);
 state=input(state,{downArrow:true});assert.deepEqual(state.draft,{text:'Draft 界',cursor:6});
});

test('a late record remains in its origin bucket without changing the destination draft',()=>{
 const other=historyScope('local','other');
 let state=composerReducer(initial(),{type:'scope',scope:other,provider:'local',seed:['Destination request']});
 state=composerReducer(state,{type:'record',scope,text:'Late origin request'});
 assert.equal(state.scope,other);assert.equal(state.draft.text,'Draft 界');assert.equal(state.buckets[scope].at(-1),'Late origin request');
 state=composerReducer(state,{type:'input',scope:other,provider:'local',input:'',key:{upArrow:true}});assert.equal(state.draft.text,'Destination request');
});
