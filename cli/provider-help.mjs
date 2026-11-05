// Account setup help only: no credentials, network requests or settings writes.
export const cloudProviders=Object.freeze([
 Object.freeze({id:'openai',name:'OpenAI',label:'ChatGPT / OpenAI',keyEnv:'OPENAI_API_KEY',keyUrl:'https://platform.openai.com/api-keys',docsUrl:'https://developers.openai.com/api/reference/overview'}),
 Object.freeze({id:'xai',name:'xAI',label:'Grok / xAI',keyEnv:'XAI_API_KEY',keyUrl:'https://console.x.ai',docsUrl:'https://docs.x.ai/developers/quickstart'}),
 Object.freeze({id:'anthropic',name:'Anthropic',label:'Claude / Anthropic',keyEnv:'ANTHROPIC_API_KEY',keyUrl:'https://platform.claude.com/settings/keys',docsUrl:'https://platform.claude.com/docs/en/get-api-key'}),
]);
export const providers=cloudProviders;
const aliases={openai:'openai',chatgpt:'openai',xai:'xai',grok:'xai',anthropic:'anthropic',claude:'anthropic'};
export function normalizeProvider(value){
 const name=String(value??'').trim().toLowerCase();
 if(!Object.hasOwn(aliases,name))throw new Error('Choose openai (ChatGPT), xai (Grok), or anthropic (Claude).');
 return aliases[name];
}
function shellName(value){
 const name=String(value).toLowerCase().split(/[\\/]/).pop();
 if(['powershell','powershell.exe','pwsh','pwsh.exe','win32'].includes(name))return 'powershell';
 if(name==='bash')return 'bash';
 if(name==='zsh')return 'zsh';
 throw new Error('Choose shell zsh, bash, or powershell for API key instructions.');
}
export function providerKeyCommands(provider,{shell='zsh'}={}){
 const entry=cloudProviders.find(item=>item.id===normalizeProvider(provider)),selected=shellName(shell),key=entry.keyEnv;
 if(selected==='powershell')return [
  `$timApiKey = Read-Host 'Paste your ${entry.name} API key' -AsSecureString`,
  "$timApiCredential = [System.Net.NetworkCredential]::new('', $timApiKey)",
  `$env:${key} = $timApiCredential.Password`,
  'Remove-Variable timApiKey, timApiCredential',
 ].join('\n');
 return [
  selected==='zsh'?`read -r -s '${key}?Paste your ${entry.name} API key: '`:`read -r -s -p 'Paste your ${entry.name} API key: ' ${key}`,
  `export ${key}`,
  "printf '\\n'",
 ].join('\n');
}
export function providerOverview(){
 return [
  'TIM / CLOUD PROVIDERS',
  '',
  'Use TIM entirely in your terminal with any of these model APIs:',
  ...cloudProviders.map(entry=>`  ${entry.label}: tim providers ${entry.id}`),
  '',
  'Each guide covers creating an API key, setting it privately in your shell,',
  'listing models available to your account, and starting TIM.',
  'In TIM, /providers opens the same guides. The model chooser also has P.',
  '',
  'TIM connects to model APIs. Signing in to a ChatGPT, Grok or Claude app',
  'does not automatically sign TIM in. Check API access, billing and credits',
  'in the provider account; subscription benefits vary by provider and plan.',
  'No desktop Model Library or local model download is needed for cloud use.',
 ].join('\n');
}
export function providerGuide(provider,{shell='zsh'}={}){
 const entry=cloudProviders.find(item=>item.id===normalizeProvider(provider)),selected=shellName(shell),id=entry.id;
 return [
  `TIM / ${entry.label.toUpperCase()} SETUP`,
  '',
  '1. Create an API key',
  `   ${entry.keyUrl}`,
  id==='xai'?'   In xAI Console, choose your team, then API Keys.':id==='anthropic'?'   Create a key scoped to the workspace you will use with TIM.':'   Select your OpenAI API project, then create a secret key.',
  '   Check API access and billing/credits in that provider account.',
  '',
  `2. Quit TIM, then run in ${selected==='powershell'?'PowerShell':selected}:`,
  ...providerKeyCommands(id,{shell:selected}).split('\n').map(line=>'   '+line),
  '   Paste the key only when the shell asks. Input is hidden.',
  '   These commands set it for this terminal session; the secret is not',
  '   part of the command you type or your shell command history.',
  '',
  '3. List the models your account can access:',
  `   tim models --provider ${id}`,
  '',
  '4. Start TIM with an ID from that list:',
  `   tim --provider ${id} --model MODEL_ID`,
  '   Replace MODEL_ID with the exact ID; do not type it literally.',
  '   Choose a text model. Planning needs structured-output support.',
  '   A listed model is not a guarantee of every TIM capability.',
  '',
  'Already using another backend with --url?',
  `Set ${entry.keyEnv} in that backend's terminal before starting it.`,
  'Setting the key only in the connecting TIM terminal is not enough.',
  'Close other TIM sessions using the same data directory before changing keys,',
  'or use a separate --data-dir to start a new backend with the new key.',
  '',
  'Your ChatGPT, Grok or Claude app login does not automatically sign TIM in.',
  'TIM uses the provider API. Check API billing/credits in that account;',
  'subscription benefits vary by provider and plan.',
  'TIM sends your typed cloud prompts and that cloud session text history',
  'to the selected provider. No local model download is needed.',
  '',
  'Keep the key out of the TIM prompt, screenshots, source and shared files.',
  'TIM reads the environment; this guide does not save or print your key.',
  'A new terminal needs the key again, or a secret manager you configure.',
  '',
  'If setup fails:',
  `- Missing ${entry.keyEnv}: set it in the backend terminal.`,
  '- 401/403: check the key, project/workspace and model permissions.',
  '- 429: check API credits and limits, then retry manually.',
  '- Model/capability rejected: list models again and choose a compatible ID.',
  '',
  `Official setup: ${entry.docsUrl}`,
  `Remove key from this terminal: ${selected==='powershell'?`$env:${entry.keyEnv} = $null`:`unset ${entry.keyEnv}`}`,
 ].join('\n');
}
