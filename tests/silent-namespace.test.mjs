import test from 'node:test';import assert from 'node:assert/strict';
import {namespacePolicy,validateNamespaceLifecycle,exitNamespaceFixture} from '../cli/silent-namespace.mjs';
import {execFileSync} from 'node:child_process';
const policy=()=>namespacePolicy({namespace:'tim-fixture',torUid:990,appUid:1000});
function fixture(){const state={owned:true,fresh:true,hostNamespace:false,processes:0,fingerprint:'baseline'},calls=[];let sealed=false;return {testOnly:true,state,calls,inspect:async()=>({...state}),seal:async()=>{sealed=true;calls.push('seal');},isSealed:async()=>sealed,install:async()=>calls.push('install'),probe:async p=>Object.fromEntries(p.checks.map(n=>[n,true])),removeOwned:async table=>calls.push('remove:'+table)};}
const approve=async r=>r.digest||r.token;
test('namespace policy is scoped proxy-only, denies both families/direct DNS/UDP and never claims host protection',()=>{
 const p=policy();assert.equal(p.executionSupported,false);assert.equal(p.hostChanged,false);assert.match(p.warning,/does not guarantee anonymity/);
 assert.equal((p.rules.match(/policy drop/g)||[]).length,3);assert.equal((p.rules.match(/meta nfproto ipv6 drop/g)||[]).length,2);
 assert.doesNotMatch(p.rules,/udp.*accept|flush ruleset|redirect|masquerade/);assert.match(p.rules,/meta skuid 1000 oifname "lo" ip daddr 127\.0\.0\.1 tcp dport 9050 accept/);
 assert.match(p.torrc,/ClientOnly 1/);assert.match(p.torrc,/SafeSocks 1/);assert.match(p.torrc,/IsolateSOCKSAuth/);assert.match(p.torrc,/ORPort 0/);assert.match(p.torrc,/TestSocks 0/);
 for(const bad of [{platform:'win32'},{namespace:'root; nft flush ruleset'},{torUid:0},{appUid:990},{socksPort:53}])assert.throws(()=>namespacePolicy({namespace:'tim-fixture',torUid:990,appUid:1000,...bad}));
});
test('isolated lifecycle seals before install and leaves filter in place after probe failure or cancellation',async()=>{
 const p=policy(),a=fixture();const result=await validateNamespaceLifecycle(p,a,{approve});assert.deepEqual(a.calls,['seal','install']);assert.equal(result.hostProtected,false);assert.equal(result.kernelValidated,false);
 for(const failure of ['probe','cancel','networkchange','torcrash']){const f=fixture(),c=new AbortController();if(failure==='cancel')f.install=async()=>{f.calls.push('install');c.abort();};f.probe=async()=>{c.signal.throwIfAborted();return {...Object.fromEntries(p.checks.map(n=>[n,true])),[failure==='torcrash'?'tor-down-no-direct-fallback':'application-direct-tcp-blocked']:false};};
 await assert.rejects(validateNamespaceLifecycle(p,f,{approve,signal:c.signal}),/stopped/);assert.equal(f.calls.at(-1),'seal');assert.ok(!f.calls.some(n=>n.startsWith('remove')));}
});
test('unapproved/host/occupied namespace never installs; explicit exit rejects concurrent changes',async()=>{
 const p=policy(),declined=fixture();await assert.rejects(validateNamespaceLifecycle(p,declined,{approve:async()=>''}),/declined/);assert.deepEqual(declined.calls,[]);
 for(const change of [{hostNamespace:true},{owned:false},{fresh:false},{processes:1}]){const f=fixture();Object.assign(f.state,change);await assert.rejects(validateNamespaceLifecycle(p,f,{approve}),/fresh/);assert.deepEqual(f.calls,[]);}
 await assert.rejects(validateNamespaceLifecycle(p,{...fixture(),testOnly:false},{approve}),/host activation/);
 const f=fixture();await assert.rejects(exitNamespaceFixture(p,f,{baselineFingerprint:'changed',approve}),/concurrent/);await assert.rejects(exitNamespaceFixture(p,f,{baselineFingerprint:'baseline',approve:async()=>''}),/declined/);
 const r=await exitNamespaceFixture(p,f,{baselineFingerprint:'baseline',approve});assert.equal(r.hostChanged,false);assert.deepEqual(f.calls,['remove:'+p.table]);
});
test('CLI exposes policy without activation and refuses host apply flags',()=>{
 const args=['cli/index.mjs','silent','policy','--platform','linux','--namespace','tim-fixture','--tor-uid','990','--app-uid','1000'];
 const p=JSON.parse(execFileSync(process.execPath,args,{encoding:'utf8'}));assert.equal(p.status,'TEST-ONLY NAMESPACE POLICY');assert.throws(()=>execFileSync(process.execPath,[...args,'--apply'],{stdio:'pipe'}));
});

test('exit rechecks after approval and passes atomic target guards to adapter',async()=>{
 const p=policy(),f=fixture();await assert.rejects(exitNamespaceFixture(p,f,{baselineFingerprint:'baseline',approve:async r=>{f.state.processes=1;return r.token;}}),/concurrent/);assert.deepEqual(f.calls,[]);
 const a=fixture();a.removeOwned=async(table,guard)=>{assert.equal(table,p.table);assert.deepEqual(guard,{namespace:p.namespace,baselineFingerprint:'baseline',requireEmpty:true,atomicIdentityCheck:true});};await exitNamespaceFixture(p,a,{baselineFingerprint:'baseline',approve});
});
test('partial seal failures, changed targets and late cancellation never claim containment',async()=>{
 const p=policy(),f=fixture();f.seal=async()=>{throw new Error('partial apply');};await assert.rejects(validateNamespaceLifecycle(p,f,{approve}),/containment UNKNOWN: partial apply/);
 const changed=fixture();changed.install=async()=>{changed.state.fingerprint='other';};await assert.rejects(validateNamespaceLifecycle(p,changed,{approve}),/containment UNKNOWN: Namespace identity/);assert.deepEqual(changed.calls,['seal']);
 const c=new AbortController(),late=fixture();late.probe=async()=>{c.abort();return Object.fromEntries(p.checks.map(n=>[n,true]));};await assert.rejects(validateNamespaceLifecycle(p,late,{approve,signal:c.signal}),/Validation stopped/);assert.equal(late.calls.at(-1),'seal');
 const bad={...p,rules:'accept everything'};await assert.rejects(validateNamespaceLifecycle(bad,fixture(),{approve}),/Modified/);
});
