import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import {connectDesktopAdapter} from './control/adapter.mjs';
import {runSemanticTask,semanticCapabilityError} from './control/semantic.mjs';
import {modelIntent} from './planner.mjs';
import {Client,clean} from './core.mjs';
import {ownBackend} from './backend.mjs';
import {loadSelection,preferenceRoot} from './preferences.mjs';
import {selection} from './activity.mjs';
export function parseDesktopTask(args){
 const options={};for(let i=0;i<args.length;i++){if(!['--task','--target-pid','--adapter','--provider','--model','--data-dir'].includes(args[i])||!args[i+1])throw new Error('Use tim control --task "REQUEST" --target-pid PID --adapter ABSOLUTE_EXECUTABLE [--provider NAME --model ID]');options[args[i].slice(2)]=args[++i];}
 if(!options.task||!Number.isInteger(Number(options['target-pid']))||Number(options['target-pid'])<=0||!options.adapter||options.adapter!=='native'&&!path.isAbsolute(options.adapter))throw new Error('Choose an explicit task, positive target PID and trusted semantic adapter executable.');
 return options;
}
export async function desktopTask(options,{client,review,signal,onStatus=()=>{},connect=connectDesktopAdapter,plan}={}){
 parseDesktopTask(['--task',options.task||'','--target-pid',String(options['target-pid']||''),'--adapter',options.adapter||'']);
 let adapter;if(options.adapter==='native'){if(process.platform==='win32'){let executable;for(const candidate of [fileURLToPath(new URL('./control/WindowsControl.exe',import.meta.url)),path.resolve('artifacts/voice/WindowsControl.exe')])try{await fs.access(candidate);executable=candidate;break;}catch{}if(!executable)throw new Error('Windows UIA binary missing. Build the optional native helper first.');adapter=await connect(executable);}else adapter=await connectDesktopAdapter(process.execPath,{spawnAdapter:()=>spawn(process.execPath,[fileURLToPath(new URL('./control/native.mjs',import.meta.url))],{stdio:['pipe','pipe','pipe'],windowsHide:true})});}else adapter=await connect(options.adapter);let backend,ownedClient;
 try{
  if(adapter.capabilities.semanticVersion!==1||!adapter.capabilities.foregroundInput||!adapter.capabilities.emergencyStop||!adapter.capabilities.manualInputInterruption)throw new Error(adapter.capabilities.error||semanticCapabilityError);
  const saved=await loadSelection(preferenceRoot(options)),chosen=client?.selection||selection({provider:options.provider||process.env.TIM_PROVIDER||saved.provider||'local',model:options.model||process.env.TIM_MODEL||saved.modelId||''});
  const planner=plan|| (async(context,stepSignal)=>{if(!client){backend=await ownBackend({dataDir:options['data-dir']});client=ownedClient=new Client(backend.url,chosen);}return modelIntent(client,'desktop',JSON.stringify(context),{signal:stepSignal,onStatus});});
  return await runSemanticTask({task:options.task,targetPid:Number(options['target-pid']),adapter,provider:chosen.provider,modelId:chosen.modelId,review,signal,onStatus,plan:planner});
 }finally{await adapter.close();ownedClient?.close();await backend?.close();}
}
export async function semanticCommand(args,{input=process.stdin,output=process.stdout,...dependencies}={}){
 const options=parseDesktopTask(args);if(!input.isTTY)throw new Error('Desktop task needs interactive exact-task and step approval; nothing observed or controlled.');
 const terminal=readline.createInterface({input,output}),controller=new AbortController(),abort=()=>controller.abort(new Error('Desktop cancelled'));process.once('SIGINT',abort);process.once('SIGTERM',abort);
 const log=v=>output.write(clean(typeof v==='string'?v:JSON.stringify(v,null,2))+'\n');
 try{const result=await desktopTask(options,{...dependencies,signal:controller.signal,onStatus:log,review:async(review,signal)=>{log(review);return terminal.question('Type this exact token to approve, or anything else to decline: ',{signal});}});log(result);return result;}
 finally{terminal.close();process.off('SIGINT',abort);process.off('SIGTERM',abort);}
}
