export function parseArgs(args){
 const options={},request=[],commands=['install','listen','read','models','toolbox','setup','providers'];
 const command=commands.includes(args[0])?args[0]:null;
 for(let i=command?1:0;i<args.length;i++){
  const arg=args[i];if(arg==='--'){request.push(...args.slice(i+1));break;}
  if(['--demo','--tools','--no-color','--no-animation','--no-mouse'].includes(arg)){options[arg.slice(2)]=true;continue;}
  if(['--provider','--model','--url','--data-dir','--library','--manager','--protocol','--mode','--host','--filter','--view','--route','--socks','--shell','--max-tokens','--context'].includes(arg)){
   if(!args[i+1]||args[i+1].startsWith('--'))throw new Error(arg+' requires a value');options[arg.slice(2)]=args[++i];continue;
  }
  if(arg.startsWith('-'))throw new Error('Unrecognized option '+arg+'. Check --help; use -- before literal request text beginning with a dash.');
  request.push(arg);
 }
 return {options,request,command,natural:!command&&request.length>0};
}
