import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {constants} from 'node:fs';
import {TextDecoder} from 'node:util';
import {discoverTools,makeReview,ToolRunner} from './tool-runner.mjs';

export const GENERATED_CODE_MAX_BYTES=1024*1024;
const hash=source=>crypto.createHash('sha256').update(source).digest('hex');
const languageFor=value=>({py:'python',python:'python',python3:'python',js:'javascript',javascript:'javascript',node:'javascript',nodejs:'javascript'})[String(value).toLowerCase()];
const extensionFor=file=>({'.py':'python','.js':'javascript','.mjs':'javascript','.cjs':'javascript'})[path.extname(file).toLowerCase()];
const controls=/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/;
const inside=(base,file)=>file!==base&&!path.relative(base,file).startsWith('..'+path.sep)&&path.relative(base,file)!=='..'&&!path.isAbsolute(path.relative(base,file));
const identity=stat=>Object.freeze({dev:String(stat.dev),ino:String(stat.ino)});
const sameIdentity=(a,b)=>a.dev===b.dev&&a.ino===b.ino;
function sourceDetails(source){
 if(typeof source!=='string'||!source.trim())throw new Error('The selected code block is empty.');
 const bytes=Buffer.byteLength(source);
 if(bytes>GENERATED_CODE_MAX_BYTES)throw new Error('Generated scripts are limited to 1 MiB of source.');
 if(controls.test(source))throw new Error('Script source must be UTF-8 text without binary or terminal control characters.');
 if(Buffer.from(source,'utf8').toString('utf8')!==source)throw new Error('Script source must be valid UTF-8 text.');
 return {source,sourceHash:hash(source),bytes};
}
function validatePath(file){
 if(typeof file!=='string'||!file||/[\x00-\x1f\x7f-\x9f]/.test(file))throw new Error('Choose a file path without control characters.');
}
async function resolveTarget(file,{cwd=process.cwd(),mustExist=false}={}){
 validatePath(file);validatePath(cwd);
 if(!path.isAbsolute(cwd))throw new Error('The working directory must be absolute.');
 const base=await fs.realpath(cwd);
 if(!(await fs.stat(base)).isDirectory())throw new Error('The working directory must exist.');
 const requested=path.resolve(base,file),parent=await fs.realpath(path.dirname(requested)).catch(error=>{
  if(error.code==='ENOENT')throw new Error('The destination folder does not exist. Choose an existing folder.');throw error;
 });
 const target=path.join(parent,path.basename(requested));
 if(!path.isAbsolute(file)&&!inside(base,target))throw new Error('Relative script paths must stay inside the working directory. Use an explicit absolute path for another location.');
 const parentStat=await fs.stat(parent);
 if(!parentStat.isDirectory())throw new Error('The destination parent must be a directory.');
 let stat;try{stat=await fs.lstat(target);}catch(error){if(error.code!=='ENOENT')throw error;}
 if(stat?.isSymbolicLink())throw new Error('Script symlinks are not accepted. Choose the actual file path.');
 if(stat&&!stat.isFile())throw new Error('Choose a regular script file.');
 if(mustExist&&!stat)throw new Error('The script file does not exist. Save it first.');
 return {file:target,cwd:base,parent,parentIdentity:identity(parentStat),exists:Boolean(stat)};
}
function languageAt(file,expected){
 const language=extensionFor(file);
 if(!language)throw new Error('Choose a .py Python file or a .js, .mjs or .cjs JavaScript file.');
 if(expected&&expected!==language)throw new Error(`The selected ${expected==='python'?'Python':'JavaScript'} block needs a ${expected==='python'?'.py':'.js, .mjs or .cjs'} destination.`);
 return language;
}

export function extractGeneratedCode(message,{blockIndex}={}){
 if(message?.role!=='assistant'||message.status!=='completed'||typeof message.content!=='string')throw new Error('Wait for a completed assistant response before saving generated code.');
 const blocks=[];let fence=null,incomplete=false;
 for(const chunk of message.content.match(/[^\n]*(?:\n|$)/g)||[]){
  if(!chunk)continue;
  const line=chunk.replace(/\r?\n$/,'');
  if(fence){
   const close=line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
   if(close&&close[1][0]===fence.marker&&close[1].length>=fence.length){
    if(fence.language)blocks.push(Object.freeze({index:blocks.length+1,language:fence.language,...sourceDetails(fence.source)}));
    fence=null;
   }else fence.source+=chunk;
  }else{
   const open=line.match(/^ {0,3}(`{3,}|~{3,})([^\r\n]*)$/);
   if(open){const info=open[2].trim();if(open[1][0]==='`'&&info.includes('`'))continue;fence={marker:open[1][0],length:open[1].length,language:languageFor(info.split(/\s+/)[0]),source:''};}
  }
 }
 incomplete=Boolean(fence?.language);
 if(incomplete)throw new Error('The response contains an unfinished code fence. Ask TIM to finish the code before saving.');
 if(!blocks.length)throw new Error('No complete Python or JavaScript fenced code block was found in this response.');
 if(blockIndex!==undefined&&(!Number.isInteger(blockIndex)||blockIndex<1||blockIndex>blocks.length))throw new Error(`Choose a code block number from 1 to ${blocks.length}.`);
 if(blocks.length>1&&blockIndex===undefined)throw new Error(`This response has ${blocks.length} runnable code blocks. Choose one explicitly with --block NUMBER.`);
 return blocks[(blockIndex||1)-1];
}

export async function reviewGeneratedSave(message,destination,{cwd=process.cwd(),blockIndex}={}){
 const code=extractGeneratedCode(message,{blockIndex}),target=await resolveTarget(destination,{cwd});
 languageAt(target.file,code.language);
 if(target.exists)throw new Error('The destination already exists. Choose a new filename; TIM will not overwrite it.');
 return Object.freeze({kind:'generated-save',destination:target.file,file:target.file,cwd:target.cwd,parentIdentity:target.parentIdentity,language:code.language,blockIndex:code.index,source:code.source,sourceHash:code.sourceHash,bytes:code.bytes});
}
function assertSaveReview(review){
 if(review?.kind!=='generated-save'||!path.isAbsolute(review.destination||'')||!path.isAbsolute(review.cwd||''))throw new Error('Review the generated source and destination before saving.');
 const details=sourceDetails(review.source);
 if(details.sourceHash!==review.sourceHash||details.bytes!==review.bytes)throw new Error('Generated source changed since review. Review it again before saving.');
 languageAt(review.destination,review.language);
 return details;
}
export async function saveGeneratedCode(review,{confirmed=false}={}){
 if(!confirmed)throw new Error('Explicit save confirmation is required.');
 assertSaveReview(review);
 const target=await resolveTarget(review.destination,{cwd:review.cwd});
 if(target.file!==review.destination||!sameIdentity(target.parentIdentity,review.parentIdentity))throw new Error('The destination folder changed since review. Review the destination again.');
 if(target.exists)throw new Error('The destination already exists. Choose a new filename; TIM will not overwrite it.');
 let handle,created,success=false;
 try{
  handle=await fs.open(review.destination,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|(constants.O_NOFOLLOW||0),0o600);
  created=identity(await handle.stat());await handle.writeFile(review.source,'utf8');await handle.sync();success=true;
  return Object.freeze({file:review.destination,destination:review.destination,language:review.language,sourceHash:review.sourceHash,bytes:review.bytes});
 }catch(error){
  if(error.code==='EEXIST')throw new Error('The destination already exists. Choose a new filename; TIM will not overwrite it.');throw error;
 }finally{
  await handle?.close();
  if(created&&!success){try{const stat=await fs.lstat(review.destination);if(!stat.isSymbolicLink()&&sameIdentity(identity(stat),created))await fs.unlink(review.destination);}catch{}}
 }
}

async function readSource(file){
 let handle;
 try{
  handle=await fs.open(file,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
  const before=await handle.stat({bigint:true});
  if(!before.isFile())throw new Error('Choose a regular script file.');
  if(before.size>BigInt(GENERATED_CODE_MAX_BYTES))throw new Error('Generated scripts are limited to 1 MiB of source.');
  const buffer=Buffer.alloc(GENERATED_CODE_MAX_BYTES+1);let offset=0;
  while(offset<buffer.length){const result=await handle.read(buffer,offset,buffer.length-offset,null);if(!result.bytesRead)break;offset+=result.bytesRead;}
  if(offset>GENERATED_CODE_MAX_BYTES)throw new Error('Generated scripts are limited to 1 MiB of source.');
  const after=await handle.stat({bigint:true});
  if(before.size!==after.size||before.mtimeNs!==after.mtimeNs||before.ctimeNs!==after.ctimeNs)throw new Error('Script source changed while reading it. Review it again.');
  let source;try{source=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(buffer.subarray(0,offset));}catch{throw new Error('Script source must be valid UTF-8 text, not binary data.');}
  return {...sourceDetails(source),identity:identity(after)};
 }finally{await handle?.close();}
}
async function interpreter(language,{env=process.env,platform=process.platform,discover=discoverTools}={}){
 if(language==='javascript')return {id:'generated-javascript',name:'JavaScript / Node.js',status:'installed',executable:process.execPath};
 const [tool]=await discover([{id:'generated-python',name:'Python 3',command:'python3',platforms:['darwin','linux','win32'],interactive:false}],{env,platform});
 if(tool?.status!=='installed'||!tool.executable)throw new Error('Python 3 was not found on PATH. Install Python 3, reopen TIM from that terminal, and review the run again. No package or interpreter was installed.');
 return tool;
}
async function makeRunReview(file,code,{cwd,args=[],timeoutMs=300000,...discovery}={}){
 if(!Array.isArray(args))throw new Error('Script arguments must be a literal argument array.');
 const tool=await interpreter(code.language,discovery);
 const review=makeReview({...tool,risk:'Generated code runs with your user privileges and inherited environment. It can read or change files, access the network, and open windows. Review the complete source before running.'},[...(code.language==='python'?['-u']:[]),file,...args],{cwd,timeoutMs});
 return Object.freeze({...review,generatedCode:Object.freeze({file,language:code.language,source:code.source,sourceHash:code.sourceHash,bytes:code.bytes,identity:code.identity||null})});
}
export async function reviewGeneratedRun(file,{cwd=process.cwd(),...options}={}){
 const target=await resolveTarget(file,{cwd,mustExist:true}),language=languageAt(target.file),code=await readSource(target.file);
 return makeRunReview(target.file,{...code,language},{...options,cwd:target.cwd});
}
export async function reviewGeneratedRunFromSave(saveReview,{cwd=saveReview?.cwd,...options}={}){
 assertSaveReview(saveReview);
 const target=await resolveTarget(saveReview.destination,{cwd});
 if(target.file!==saveReview.destination)throw new Error('The destination changed since review. Review it again.');
 return makeRunReview(target.file,saveReview,{...options,cwd:target.cwd});
}
export async function verifyGeneratedRun(review){
 if(!review?.generatedCode)return;
 const ref=review.generatedCode;
 const fileArgument=ref.language==='python'?1:0;
 if(!path.isAbsolute(ref.file||'')||review.args?.[fileArgument]!==ref.file||fileArgument&&review.args[0]!=='-u')throw new Error('The generated script launch target changed since review.');
 const details=sourceDetails(ref.source);
 if(details.sourceHash!==ref.sourceHash||details.bytes!==ref.bytes)throw new Error('Generated source changed since review. Review it again before running.');
 const target=await resolveTarget(ref.file,{cwd:review.cwd,mustExist:true});
 if(target.file!==ref.file)throw new Error('The script path changed since review. Review it again before running.');
 const current=await readSource(ref.file);
 if(current.sourceHash!==ref.sourceHash||ref.identity&&!sameIdentity(current.identity,ref.identity))throw new Error('Script source or file identity changed since review. Review it again before running.');
}
export async function runGeneratedCode(review,{confirmed=false,runner,signal}={}){
 if(!confirmed)throw new Error('Explicit launch confirmation is required.');
 if(!review?.generatedCode)throw new Error('Review the generated script before running it.');
 signal?.throwIfAborted();await verifyGeneratedRun(review);signal?.throwIfAborted();
 const owned=!runner;if(!runner)runner=new ToolRunner();
 const cancel=()=>void runner.cancel();signal?.addEventListener('abort',cancel,{once:true});
 try{signal?.throwIfAborted();return await runner.run(review,{confirmed:true});}
 finally{signal?.removeEventListener('abort',cancel);if(owned)await runner.close();}
}
