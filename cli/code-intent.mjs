import {parseArguments} from './tool-runner.mjs';

const saveUsage='Use /save PATH [--run] [--block N]. Quote paths containing spaces.';
const runUsage='Use /run PATH [ARGS...] or /run after saving a script.';
const scriptFile=value=>typeof value==='string'&&/\.(?:py|mjs|cjs|js)$/i.test(value);

// This parser only describes a review. It never expands paths, evaluates shell
// syntax, writes files, installs dependencies or starts a process.
export function parseCodeCommand(input,{lastSaved}={}){
 if(typeof input!=='string')return null;
 const match=/^\s*(\/save|\/run)(?=\s|$)/.exec(input);
 if(!match)return null;
 const tokens=parseArguments(input.slice(match[0].length));
 if(match[1]==='/run'){
  const file=tokens.length?tokens.shift():lastSaved;
  if(typeof file!=='string'||!file.trim()||file.startsWith('--'))throw new Error(runUsage);
  return {kind:'run',file,args:tokens};
 }
 const destination=tokens.shift();
 if(!destination||destination.startsWith('--'))throw new Error(saveUsage);
 let runAfter=false,blockIndex;
 while(tokens.length){
  const option=tokens.shift();
  if(option==='--run'&&!runAfter){runAfter=true;continue;}
  if(option==='--block'&&blockIndex===undefined){
   const value=tokens.shift();
   if(!/^[1-9]\d*$/.test(value||'')||!Number.isSafeInteger(Number(value)))throw new Error('Block number must be a positive whole number. '+saveUsage);
   blockIndex=Number(value);continue;
  }
  throw new Error('Unknown or repeated save option: '+option+'. '+saveUsage);
 }
 return {kind:'save',destination,runAfter,...(blockIndex===undefined?{}:{blockIndex})};
}

function requestBody(input){
 return input.trim().replace(/^(?:hey\s+tim[,!:]?\s*)?/i,'').replace(/^(?:please\s+|(?:can|could|would|will)\s+you\s+(?:please\s+)?|i\s+(?:want|need)\s+you\s+to\s+|i(?:'d| would)\s+like\s+you\s+to\s+)/i,'');
}

function wantsRun(value){
 // A negative instruction wins over a conflicting positive phrase. The user
 // can still choose /run later; prose never bypasses the launch review.
 if(/\b(?:do\s+not|don't|never|without|avoid|not\s+to)\b[^.!?\n]{0,48}\b(?:run(?:ning)?|execut(?:e|ing|ion))\b/i.test(value))return false;
 return /\b(?:and|then|also)\s+(?:run|execute)\b|\b(?:run|execute)\s+(?:it|this\s+(?:code|script|file)|the\s+(?:code|script|file))\b/i.test(value);
}

function explicitFile(value,{destinationOnly=false}={}){
 // Quoted paths stay literal, including $(), semicolons and Windows slashes.
 // Only concrete supported filenames qualify; prose cannot invent a folder.
 const token=/(?:"(?:[^"\\]|\\.|\\)*"|'(?:[^'\\]|\\.|\\)*'|`[^`]*`|[^\s"'`]+)/g;
 for(const match of value.matchAll(token)){
  const raw=match[0];let candidate;
  try{candidate=raw.startsWith('`')?raw.slice(1,-1):parseArguments(raw)[0];}catch{continue;}
  if(!/^['"`]/.test(raw)){
   candidate=candidate.replace(/[),;.!?:]+$/,'');
   if(/^node\.js$/i.test(candidate))continue;
  }
  if(!scriptFile(candidate)||candidate.startsWith('--')||/^[a-z][a-z\d+.-]*:\/\//i.test(candidate))continue;
  if(destinationOnly){
   const before=value.slice(0,match.index).trim();
   const location=/\b(?:as|to|into|in|at)\s+(?:(?:a|the|new)\s+)?(?:file\s+)?$/i.test(before+' ');
   const named=/\b(?:named|called)$/i.test(before);
   const direct=/^(?:create|write|build|generate|make)\s*(?:(?:a|an|the|new)\s+)?(?:(?:python|javascript|node(?:\.js)?)\s+)?(?:(?:script|file|program)\s*)?$/i.test(before);
   if(!location&&!named&&!direct)continue;
  }
  return candidate;
 }
 return null;
}

// Classify only the current user's request. Assistant text and prior model
// output must never be passed here as authority to save or execute anything.
export function classifyScriptRequest(input){
 if(typeof input!=='string'||!input.trim()||input.length>8192||input.includes('\0'))return null;
 const body=requestBody(input);
 if(/^(?:how|what|why|when|where|explain|describe|review|debug|read|summarize|tell|show)\b/i.test(body))return null;
 if(/^(?:do\s+not|don't|never|avoid)\b/i.test(body))return null;

 const run=/^(?:run|execute)\s+([\s\S]+)$/i.exec(body);
 if(run){
  let tokens;try{tokens=parseArguments(run[1]);}catch{return null;}
  const file=tokens.shift();
  return scriptFile(file)&&!file.startsWith('--')?{kind:'run',file,args:tokens}:null;
 }

 const save=/^save\s+(?:this|that|the|my)\s+(?:code|script|program)(?:\s+(?:block|above))?\s+(?:as|to|in)\s+([\s\S]+)$/i.exec(body);
 if(save){
  const destination=explicitFile(save[1]);
  return destination?{kind:'save',destination,runAfter:wantsRun(body)}:null;
 }

 if(!/^(?:create|write|build|generate|make)\b/i.test(body))return null;
 const destination=explicitFile(body,{destinationOnly:true});
 const language=destination?/\.py$/i.test(destination)?'python':'javascript':/\bpython\b/i.test(body)?'python':/\b(?:javascript|node(?:\.js)?)\b/i.test(body)?'javascript':null;
 if(!language||!destination&&!/\b(?:script|code|program)\b/i.test(body))return null;
 const runAfter=wantsRun(body);
 if(!destination&&!runAfter&&!/\b(?:save|file|disk|run|execute)\b/i.test(body))return null;
 return {kind:'generate',language,destination:destination||(language==='python'?'tim-script.py':'tim-script.mjs'),runAfter};
}
