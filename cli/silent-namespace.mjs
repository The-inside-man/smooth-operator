import crypto from 'node:crypto';
const warning='Silent Mode does not guarantee anonymity';
const forbiddenIPv4=['0.0.0.0/8','10.0.0.0/8','100.64.0.0/10','127.0.0.0/8','169.254.0.0/16','172.16.0.0/12','192.0.0.0/24','192.0.2.0/24','192.168.0.0/16','198.18.0.0/15','198.51.100.0/24','203.0.113.0/24','224.0.0.0/4','240.0.0.0/4'];
export function namespacePolicy({platform='linux',namespace,torUid,appUid,socksPort=9050,diagnostics=false}={}){
 if(platform!=='linux')throw new Error('Executable host lockdown is unsupported on this platform. Linux policy output is test-only, not a Windows/macOS substitute.');
 if(!/^tim-[a-z0-9][a-z0-9-]{0,40}$/.test(namespace||''))throw new Error('Choose a dedicated tim- namespace name.');
 for(const uid of [torUid,appUid])if(!Number.isSafeInteger(uid)||uid<1||uid>2147483647)throw new Error('Use distinct, non-root numeric Tor/application UIDs.');
 if(torUid===appUid)throw new Error('Tor and application identities must be different.');
 if(!Number.isInteger(socksPort)||socksPort<1024||socksPort>65535)throw new Error('Choose an unprivileged SOCKS port.');
 const id=crypto.createHash('sha256').update(JSON.stringify({namespace,torUid,appUid,socksPort})).digest('hex').slice(0,12),table='tim_silent_'+id;
 // No global flush, redirect, host interface, route, DNS or sysctl operations.
 const rules=`table inet ${table} {
 chain input { type filter hook input priority 0; policy drop;
  meta nfproto ipv6 drop
  ct state invalid drop
  ct state established,related accept
  iifname "lo" ip saddr 127.0.0.1 ip daddr 127.0.0.1 tcp dport ${socksPort} accept
 }
 chain forward { type filter hook forward priority 0; policy drop; }
 chain output { type filter hook output priority 0; policy drop;
  meta nfproto ipv6 drop
  ct state invalid drop
  meta skuid ${appUid} oifname "lo" ip daddr 127.0.0.1 tcp dport ${socksPort} accept
  meta skuid ${torUid} oifname "lo" ip saddr 127.0.0.1 tcp sport ${socksPort} ct state established accept
  ip daddr { ${forbiddenIPv4.join(', ')} } drop
  meta skuid ${torUid} meta nfproto ipv4 meta l4proto tcp accept
 }
}
`;
 const seal=`table inet ${table} { chain input { type filter hook input priority 0; policy drop; } chain forward { type filter hook forward priority 0; policy drop; } chain output { type filter hook output priority 0; policy drop; } }\n`;
 const torrc=`ClientOnly 1\nSocksPort 127.0.0.1:${socksPort} IsolateSOCKSAuth\nSafeSocks 1\nTestSocks ${diagnostics?1:0}\nClientUseIPv6 0\nControlPort 0\nORPort 0\nDirPort 0\n`;
 return {schema:1,status:'TEST-ONLY NAMESPACE POLICY',executionSupported:false,hostChanged:false,warning,platform,namespace,torUid,appUid,socksPort,table,rules,seal,torrc,
 scope:'Only an independently created, dedicated disposable Linux namespace. Never the root/host namespace. Applications must explicitly use SOCKS5 remote DNS; direct traffic is blocked, not transparently torified.',
 prerequisites:['isolated Linux VM with local recovery console','fresh dedicated namespace with no processes/sockets and no shared host network','separate unprivileged Tor/app UIDs; application has no CAP_NET_ADMIN/CAP_NET_RAW/setuid escape','independently installed/verified Tor, nftables and iproute2; retain default internal-address rejection options (do not override testing-only options)','Tor/app launch only after default-deny seal is verified','per-application distinct SOCKS authentication for circuit isolation'],
 limits:['No Windows/macOS host execution adapter','No UDP/QUIC, IPv6 or direct DNS; these fail closed','No private bridge/relay addresses; IP-only bootstrap dependencies required','No browser fingerprinting/cookie/account-identity protection','SafeSocks rejects unsafe numeric-IP requests; ordinary RESOLVE plus pinned-IP CONNECT is not SafeSocks-compatible by association alone; TIM fails closed on rejection and this profile is not ready for TIM clearnet fetching','No relay/exit/hidden-service hosting','Policy compilation, Tor config and real packet probes still require isolated native Linux validation'],
 checks:['application-direct-tcp-blocked','application-dns-udp-blocked','application-dns-tcp-blocked','application-quic-blocked','ipv6-blocked','tor-down-no-direct-fallback','unapproved-uid-blocked','loopback-other-service-blocked','tor-private-egress-blocked','crash-seal-survives','explicit-exit-requires-stopped-workload']};
}
function snapshotPolicy(policy){
 const copy=JSON.parse(JSON.stringify(policy));
 const expected=namespacePolicy({...copy,diagnostics:copy.torrc?.includes('TestSocks 1')});
 if(JSON.stringify(copy)!==JSON.stringify(expected))throw new Error('Modified or unsupported policy refused.');
 Object.freeze(copy.checks);return Object.freeze(copy);
}
async function sameTarget(adapter,policy,baseline,{empty=false}={}){
 const state=await adapter.inspect(policy.namespace);
 if(!state?.owned||state.hostNamespace||state.fingerprint!==baseline.fingerprint||(empty&&state.processes!==0))throw new Error('Namespace identity/workload changed; concurrent changes refused.');
}
// Isolated adapter protocol, deliberately not wired to host execution.
// Adapter mutations must atomically compare the namespace fingerprint, hold a target
// lifetime handle, and atomically replace only this table (never delete then add).
// JS rechecks do not establish kernel-level atomicity. A production executor is withheld until kernel/Tor packet tests pass.
export async function validateNamespaceLifecycle(policy,adapter,{approve,signal}={}){
 if(policy?.status!=='TEST-ONLY NAMESPACE POLICY'||adapter?.testOnly!==true)throw new Error('Only an explicit isolated test adapter is accepted; host activation unavailable.');
 policy=snapshotPolicy(policy);
 const digest=crypto.createHash('sha256').update(JSON.stringify(policy)).digest('hex');
 if(await approve?.({kind:'isolated-policy-test',digest,policy})!==digest)throw new Error('Exact policy approval declined.');
 signal?.throwIfAborted();
 const baseline=await adapter.inspect(policy.namespace);
 if(!baseline?.owned||!baseline.fresh||baseline.hostNamespace||baseline.processes!==0||typeof baseline.fingerprint!=='string')throw new Error('Namespace is not a fresh, owned, empty isolated target.');
 let sealAttempted=false;
 try{
  sealAttempted=true;await adapter.seal(policy,baseline);
  if(!await adapter.isSealed(policy))throw new Error('Default-deny seal unverified.');
  signal?.throwIfAborted();await sameTarget(adapter,policy,baseline,{empty:true});await adapter.install(policy,baseline);
  const checks=await adapter.probe(policy,signal);
  signal?.throwIfAborted();await sameTarget(adapter,policy,baseline);
  if(!policy.checks.every(name=>checks[name]===true))throw new Error('Required leak/lifecycle probe failed or missing.');
  return {status:'ISOLATED FIXTURE VALIDATED',hostProtected:false,kernelValidated:false,baselineFingerprint:baseline.fingerprint,policyDigest:digest};
 }catch(error){
  let containment='not verified';
  if(sealAttempted){try{await sameTarget(adapter,policy,baseline);await adapter.seal(policy,baseline);containment=await adapter.isSealed(policy)?'resealed and verified':'UNKNOWN: reseal unverified';}catch(resealError){containment='UNKNOWN: '+resealError.message;}}
  // Never remove filtering or restore direct internet on cancellation/failure.
  throw new Error('Validation stopped; containment '+containment+'; no direct-network rollback attempted: '+error.message);
 }
}
export async function exitNamespaceFixture(policy,adapter,{baselineFingerprint,approve}={}){
 if(adapter?.testOnly!==true)throw new Error('Host exit executor unavailable.');
 policy=snapshotPolicy(policy);
 const state=await adapter.inspect(policy.namespace);
 if(state.hostNamespace||!state.owned||state.processes!==0||state.fingerprint!==baselineFingerprint)throw new Error('Exit requires the same owned namespace and stopped workload; concurrent changes refused.');
 const token=crypto.createHash('sha256').update(policy.table+baselineFingerprint+'explicit-exit').digest('hex');
 if(await approve?.({kind:'explicit-isolated-exit',token,namespace:policy.namespace})!==token)throw new Error('Exit declined; filtering retained.');
 await sameTarget(adapter,policy,state,{empty:true});
 await adapter.removeOwned(policy.table,{namespace:policy.namespace,baselineFingerprint:state.fingerprint,requireEmpty:true,atomicIdentityCheck:true});return {status:'FIXTURE EXITED',hostChanged:false};
}
