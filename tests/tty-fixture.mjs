process.env.TERM='xterm-256color'; delete process.env.CI;
// Test-only synthetic terminal. No inference or application state is touched.
Object.defineProperty(process.stdin,'isTTY',{value:true});
Object.defineProperty(process.stdout,'isTTY',{value:true});
process.stdout.columns=110;process.stdout.rows=38;
process.stdin.setRawMode=value=>{process.stderr.write(`RAW:${value}\n`);return process.stdin;};
process.argv=['node','cli/index.mjs',...(process.env.TIM_TEST_URL?['--url',process.env.TIM_TEST_URL]:['--demo'])];
if(process.env.TIM_TEST_ERROR==='1'){const {demoState}=await import('../cli/core.mjs');demoState.sessions[0].messages='invalid test shape';}
setTimeout(()=>{process.stdout.columns=80;process.stdout.rows=24;process.stdout.emit('resize');},150).unref();
await import('../cli/index.mjs');
