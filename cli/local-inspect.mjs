import {discoverTools,makeReview,ToolRunner} from './tool-runner.mjs';
import {clean} from './core.mjs';
export function portRows(output,port,protocol='all'){
 return clean(output).split('\n').filter(line=>{
  const fields=line.trim().split(/\s+/),proto=fields[0]?.toLowerCase();
  if(!/^(tcp|udp)/.test(proto)||protocol!=='all'&&!proto.startsWith(protocol))return false;
  // netstat: proto, local, remote on Windows; proto, queues, local on Unix.
  const local=fields.find((f,i)=>i>0&&/[:.]\d+$/.test(f));
  return local&&new RegExp('[:.]'+port+'$').test(local);
 }).join('\n');
}
export async function inspectPort(intent,{signal,onStatus=()=>{},platform=process.platform,discover=discoverTools,runnerFactory=()=>new ToolRunner()}={}){
 if(intent.action!=='inspect_port'||!Number.isInteger(intent.port)||intent.port<1||intent.port>65535||!['tcp','udp','all'].includes(intent.protocol))throw new Error('Invalid local inspection intent.');
 const names=platform==='win32'?['netstat']:platform==='darwin'?['lsof','netstat']:['ss','netstat'];
 const registry=names.map(command=>({id:'inspect-'+command,name:command,command,platforms:[platform],network:false,interactive:false}));
 const tool=(await discover(registry,{platform})).find(t=>t.executable&&t.status==='installed');
 if(!tool){const error=new Error('No supported local inspection utility found. Search your toolbox or propose a reviewed tool draft.');error.code='TOOL_MISSING';throw error;}
 let args;if(tool.command==='ss')args=['-H','-a','-n','-t','-u','-p','sport = :'+intent.port];
 else if(tool.command==='lsof')args=['-nP','-i'+(intent.protocol==='all'?'':intent.protocol.toUpperCase())+':'+intent.port];
 else args=platform==='win32'?['-a','-n','-o']:platform==='linux'?['-a','-n','-t','-u','-p']:['-a','-n'];
 onStatus('Inspecting LOCAL '+intent.protocol.toUpperCase()+' port '+intent.port+' with '+tool.command+'; read-only, no connections/capture.');
 const runner=runnerFactory(),abort=()=>void runner.cancel();signal?.throwIfAborted();signal?.addEventListener('abort',abort,{once:true});
 try{const result=await runner.run(makeReview(tool,args,{timeoutMs:15000}),{confirmed:true});signal?.throwIfAborted();
  if(result.status!=='completed'&&!(tool.command==='lsof'&&result.exitCode===1&&!result.stderr))throw new Error(result.error||clean(result.stderr)||'Inspection failed: exit '+result.exitCode);
  const output=tool.command==='netstat'?portRows(result.stdout||'',intent.port,intent.protocol):clean(result.stdout||'').trim();
  return {output:output||'No matching local sockets reported.',exitCode:result.exitCode,stderr:clean(result.stderr||''),summary:'LOCAL port '+intent.port+' / '+tool.command+' / exit '+result.exitCode+'\n'+(result.truncated?'Output truncated; results may be incomplete.\n':'')+'Process IDs/names are shown only when the OS permits. Socket state is not packet or bandwidth statistics.'};
 }finally{signal?.removeEventListener('abort',abort);await runner.close();}
}
