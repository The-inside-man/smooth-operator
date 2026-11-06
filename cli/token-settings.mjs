const maximum=1048576;
const integer=value=>/^\d+$/.test(String(value))&&Number.isSafeInteger(Number(value));

export function parseResponseTokens(value){
 if(typeof value==='string'&&value.toLowerCase()==='auto')return 0;
 if(!integer(value)||Number(value)<1||Number(value)>maximum)throw new Error('Use auto or a whole response-token count from 1 to 1048576.');
 return Number(value);
}
export function parseContextTokens(value){
 if(!integer(value)||Number(value)<512||Number(value)>maximum)throw new Error('Use a whole local context-token count from 512 to 1048576.');
 return Number(value);
}
export function tokenSettingsFromOptions(options={}){
 const patch={};
 if(options['max-tokens']!==undefined)patch.maxTokens=parseResponseTokens(options['max-tokens']);
 if(options.context!==undefined)patch.context=parseContextTokens(options.context);
 return patch;
}
export function tokenCommandPatch(command,args=[]){
 if(!args.length)return null;
 if(args.length!==1)throw new Error(command==='/tokens'?'Use /tokens auto or /tokens NUMBER.':'Use /context NUMBER.');
 return command==='/tokens'?{maxTokens:parseResponseTokens(args[0])}:{context:parseContextTokens(args[0])};
}
export const responseBudgetLabel=config=>config?.maxTokens===0?'Auto':Number.isInteger(config?.maxTokens)&&config.maxTokens>0?config.maxTokens+' tokens':'not set';
export const contextBudgetLabel=config=>Number.isInteger(config?.context)&&config.context>0?config.context+' tokens':'not set';
export function tokenSettingsNotice(config={},command='/tokens'){
 const response='Response budget: '+responseBudgetLabel(config)+(config.maxTokens===0?' (model/context limit).':'.');
 const context='Local context: '+contextBudgetLabel(config)+'.';
 return command==='/context'?context+'\nUse /context NUMBER (512–1048576) to change the local model context.\nLarger contexts need more memory; model limits still apply.\n'+response:
  response+'\nUse /tokens auto for no fixed TIM response-token cap, or /tokens NUMBER (1–1048576).\n'+context+' Use /context NUMBER to change it.\nThe model, remaining context, and provider limits still apply.';
}
export async function saveTokenSettings(client,patch,snapshot={}){
 if(!client?.request)throw new Error('Connect to a TIM backend to change response or context settings.');
 if(snapshot.loadingModel||snapshot.orchestrator?.status==='loading'||snapshot.localSetup?.status==='installing'||(snapshot.jobs||[]).some(job=>['queued','running'].includes(job.status)))throw new Error('Finish or cancel current work before changing response or context settings.');
 await client.request('settings',patch);
 return client.request('state');
}
