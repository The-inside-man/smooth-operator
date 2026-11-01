#!/usr/bin/env node
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const python=process.env.TIM_NATIVE_PYTHON||'python3';
const child=spawn(python,[fileURLToPath(new URL('./native.py',import.meta.url)),...process.argv.slice(2)],{stdio:'inherit',windowsHide:true});
child.on('error',e=>{console.error('Native adapter unavailable: '+e.message+'. Install the documented optional dependencies; nothing was controlled.');process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code||0;});
for(const s of ['SIGINT','SIGTERM'])process.once(s,()=>child.kill());
