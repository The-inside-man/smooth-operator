import './terminal-env.mjs';
process.env.TERM='xterm-256color';
// Test-only synthetic terminal. No inference or application state is touched.
Object.defineProperty(process.stdin,'isTTY',{value:true});
Object.defineProperty(process.stdout,'isTTY',{value:true});
process.stdout.columns=110;process.stdout.rows=38;
process.stdin.setRawMode=value=>{process.stderr.write(`RAW:${value}\n`);return process.stdin;};
const {mkdtemp,rm}=await import('node:fs/promises');
const {tmpdir}=await import('node:os');
const {join}=await import('node:path');
const dataDir=await mkdtemp(join(tmpdir(),'tim-tty-fixture-'));
process.argv=['node','cli/index.mjs',...(process.env.TIM_TEST_ARGS?JSON.parse(process.env.TIM_TEST_ARGS):[]),'--data-dir',dataDir,...(process.env.TIM_TEST_URL?['--url',process.env.TIM_TEST_URL]:['--demo'])];
if(process.env.TIM_TEST_ERROR==='1'){
 // This fault-injection branch preloads React through core/activity before the
 // launcher. Match its default mode so React and Ink use the same build.
 process.env.NODE_ENV ||= 'production';
 const {demoState}=await import('../cli/core.mjs');demoState.sessions[0].messages='invalid test shape';
}
setTimeout(()=>{process.stdout.columns=100;process.stdout.rows=24;process.stdout.emit('resize');},150).unref();
// Portable handler coverage only: Windows OS termination never dispatches a
// catchable SIGTERM. IPC lets tests exercise the registered JS cleanup handler.
const dispatchSignal=message=>{if(message?.type==='dispatch-sigterm')process.emit('SIGTERM');};
if(process.send)process.on('message',dispatchSignal);
try{await import('../cli/index.mjs');}
finally{process.off('message',dispatchSignal);if(process.connected)process.disconnect();await rm(dataDir,{recursive:true,force:true});}
