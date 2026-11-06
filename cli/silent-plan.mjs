import {namespacePolicy} from './silent-namespace.mjs';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
export const silentWarning='Silent Mode does not guarantee anonymity';
const policies={
 win32:{backend:'Windows Filtering Platform / Windows Defender Firewall',requirements:['local recovery console','reviewed Tor client process identity','explicit application proxy configuration','saved firewall policy and concurrent-change detection'],operations:['create owned outbound-filter profile','allow only reviewed Tor transport process upstream','block other direct TCP/UDP and IPv6 paths','verify DNS leak and reboot recovery in isolated VM']},
 darwin:{backend:'pf owned anchor',requirements:['local recovery console','reviewed Tor process and proxy settings','saved pf anchor/routing/DNS state','OS-specific pf coexistence review'],operations:['prepare separate owned pf anchor','route only explicitly proxy-configured application TCP','block uncovered UDP/DNS/IPv6 direct egress','verify anchor order and local rollback in isolated VM']},
 linux:{backend:'nftables owned table / isolated namespace',requirements:['local recovery console','reviewed Tor TransPort/DNSPort configuration, not SOCKS alone','Tor UID and existing firewall snapshot','namespace and IPv6 policy review'],operations:['prepare owned namespace/table plan','redirect approved TCP to validated Tor TransPort','route scoped DNS to validated DNSPort','block remaining UDP/direct IPv6 egress','verify concurrent firewall coexistence and namespace rollback in isolated VM']}
};
export function silentPlan(platform,{snapshot}={}){
 if(!policies[platform])throw new Error('Choose win32, darwin or linux.');
 if(snapshot&&(snapshot.version!==1||snapshot.platform!==platform||!snapshot.state||typeof snapshot.state!=='object'||Array.isArray(snapshot.state)||JSON.stringify(snapshot).length>1000000))throw new Error('Invalid explicit baseline snapshot.');
 const baseline=snapshot?crypto.createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'):null;
 return {version:1,platform,status:'INACTIVE DESIGN PLAN',warning:silentWarning,executionSupported:false,hostChanged:false,baselineFingerprint:baseline,profile:policies[platform],coverage:'No applications or host traffic are currently locked down. SOCKS alone cannot transparently torify a host. No relay/exit configuration.',rollback:{requiresLocalConsole:true,requiresMatchingBaseline:true,removeOnlyOwnedObjects:true,restoreExplicitlyApprovedSettingsOnly:true,automaticDirectFallback:false},snapshot:snapshot||null};
}
export function rollbackPlan(plan,currentBaselineFingerprint){
 if(!plan?.baselineFingerprint||currentBaselineFingerprint!==plan.baselineFingerprint)throw new Error('Baseline missing/changed; rollback must not overwrite concurrent host settings.');
 return {status:'INACTIVE ROLLBACK PLAN',executionSupported:false,hostChanged:false,platform:plan.platform,baselineFingerprint:plan.baselineFingerprint,restore:structuredClone(plan.snapshot.state),rules:plan.rollback};
}
export async function silentCommand(args){
 if(!args.length){console.log(silentWarning+'\nDESIGN/PREFLIGHT ONLY: whole-machine lockdown unsupported. No host settings changed.\nUse tim silent plan --platform win32|darwin|linux [--snapshot FILE] for an inactive audited plan.');return;}
 if(args[0]==='policy'){
  const opts={platform:process.platform};for(let i=1;i<args.length;i++){
   const key={'--platform':'platform','--namespace':'namespace','--tor-uid':'torUid','--app-uid':'appUid','--socks-port':'socksPort'}[args[i]];
   if(!key||!args[i+1])throw new Error('Use silent policy --platform linux --namespace tim-NAME --tor-uid UID --app-uid UID [--socks-port PORT]. No apply option is available.');
   const value=args[++i];opts[key]=['torUid','appUid','socksPort'].includes(key)?Number(value):value;
  }
  console.log(JSON.stringify(namespacePolicy(opts),null,2));return;
 }
 if(args[0]!=='plan')throw new Error('Only inactive plan generation is implemented. Activation/privileged execution is disabled.');
 let platform=process.platform,snapshot;
 for(let i=1;i<args.length;i++){if(args[i]==='--platform'&&args[i+1])platform=args[++i];else if(args[i]==='--snapshot'&&args[i+1])snapshot=JSON.parse(await fs.readFile(args[++i],'utf8'));else throw new Error('Use silent plan --platform win32|darwin|linux [--snapshot FILE].');}
 console.log(JSON.stringify(silentPlan(platform,{snapshot}),null,2));
}
