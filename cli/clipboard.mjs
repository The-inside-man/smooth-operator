import {execFile} from 'node:child_process';
import path from 'node:path';
import {clean} from './core.mjs';

const windowsScript="$ErrorActionPreference='Stop'; [Console]::InputEncoding=[System.Text.UTF8Encoding]::new($false); Set-Clipboard -Value ([Console]::In.ReadToEnd())";
export function clipboardCommands(platform=process.platform,env=process.env){
 if(platform==='darwin')return [{file:'/usr/bin/pbcopy',args:[]}];
 if(platform==='win32')return [{file:path.win32.join(env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),args:['-NoLogo','-NoProfile','-NonInteractive','-Command',windowsScript]}];
 if(platform==='linux')return [{file:'wl-copy',args:['--type','text/plain;charset=utf-8']},{file:'xclip',args:['-selection','clipboard']}];
 return [];
}
const clipboardText=value=>typeof value==='string'?clean(value.replace(/\r\n?/g,'\n')):'';
const cancelled=signal=>signal?.aborted;

function writeClipboard(command,text,{execFileImpl,env,signal}){
 return new Promise((resolve,reject)=>{
  let settled=false,child;
  const finish=error=>{if(settled)return;settled=true;error?reject(error):resolve();};
  try{
   child=execFileImpl(command.file,command.args,{encoding:'utf8',windowsHide:true,shell:false,timeout:5000,maxBuffer:65536,env,...(signal?{signal}:{})},finish);
   if(settled)return;
   if(!child.stdin){finish(new Error('Clipboard input is unavailable.'));child.kill?.();return;}
   child.stdin.once('error',finish);
   // Response text is always data on stdin, never shell source or an argument.
   child.stdin.end(text,'utf8');
  }catch(error){finish(error);child?.kill?.();}
 });
}

export async function copyText(value,{platform=process.platform,env=process.env,execFileImpl=execFile,signal}={}){
 const text=clipboardText(value);
 if(!text.trim())throw new Error('There is no response text to copy yet.');
 if(cancelled(signal))throw new Error('Clipboard copy cancelled.');
 const commands=clipboardCommands(platform,env);
 const childEnv=platform==='darwin'?{...env,LC_CTYPE:'UTF-8',LC_ALL:'en_US.UTF-8'}:env;
 if(!commands.length)throw new Error('Native clipboard copying is unavailable on this platform. Press F2 to select text and use your terminal Copy action.');
 for(const command of commands){
  try{
   await writeClipboard(command,text,{execFileImpl,env:childEnv,signal});
   return {characters:[...text].length,bytes:Buffer.byteLength(text,'utf8'),tool:path[platform==='win32'?'win32':'posix'].basename(command.file)};
  }catch(error){if(cancelled(signal)||error.name==='AbortError')throw new Error('Clipboard copy cancelled.');}
 }
 throw new Error(platform==='linux'?'Clipboard unavailable. Run TIM in a graphical session with wl-copy or xclip installed, or press F2 and use your terminal Copy action.':
  platform==='win32'?'Windows clipboard is unavailable. Close any clipboard dialog and retry, or press F2 and use your terminal Copy action.':
  'macOS clipboard is unavailable. Run TIM in your logged-in desktop session and retry, or press F2 and use your terminal Copy action.');
}

export function latestAssistantResponse(messages=[]){
 const message=[...messages].reverse().find(message=>message?.role==='assistant'&&typeof message.content==='string'&&message.content.trim());
 if(!message)throw new Error('There is no response text to copy yet.');
 return message.content;
}
export function fencedClipboardCode(value){
 const text=clipboardText(value),blocks=[];let fence=null,body=[];
 for(const line of text.split('\n')){
  if(!fence){
   const opening=/^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
   if(opening){fence=opening[1];body=[];}
  }else if(new RegExp('^ {0,3}'+(fence[0]==='`'?'`':'~')+'{'+fence.length+',}\\s*$').test(line)){
   if(body.join('\n').trim())blocks.push(body.join('\n'));
   fence=null;body=[];
  }else body.push(line);
 }
 if(fence)throw new Error('The latest response has an unfinished code fence. Wait for it to finish, or use /copy for the response text.');
 if(!blocks.length)throw new Error('The latest response has no complete fenced code blocks. Use /copy or press F2 to select text.');
 return blocks;
}
export async function copyLatestResponse(messages,{code=false,...options}={}){
 const response=latestAssistantResponse(messages),blocks=code?fencedClipboardCode(response):[];
 return {...await copyText(code?blocks.join('\n\n'):response,options),blocks:blocks.length};
}
