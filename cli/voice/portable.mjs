#!/usr/bin/env node
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const child=spawn(process.env.TIM_SPEECH_PYTHON||'python3',[fileURLToPath(new URL('./portable.py',import.meta.url)),...process.argv.slice(2)],{stdio:'inherit',windowsHide:true});
child.on('error',e=>{console.log(JSON.stringify({type:'error',message:'Portable local speech unavailable: '+e.message+'. Requires Python, sounddevice/PortAudio, vosk and an explicitly selected local TIM_SPEECH_MODEL directory.'}));process.exitCode=1;});
child.on('exit',code=>process.exitCode=code||0);
for(const s of ['SIGINT','SIGTERM'])process.once(s,()=>child.kill());
