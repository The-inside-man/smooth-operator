import fs from 'node:fs/promises';
import path from 'node:path';
import {makeReview} from './tool-runner.mjs';

export function captureFilter(value=''){
 if(typeof value!=='string'||value.length>1024||! /^[A-Za-z0-9_ .:=!&|()<>/+-]*$/.test(value))throw new Error('Use a simple TShark display filter (fields, numbers, addresses and comparisons). Quotes/control characters and complex string filters are unsupported.');
 return value;
}
export async function captureReview(tool,file,{view='hex',filter=''}={}){
 if(!['hex','ascii'].includes(view))throw new Error('Choose hex or ascii packet view.');
 const filename=await fs.realpath(path.resolve(file));if(!/\.pcap(?:ng)?$/i.test(filename)||!(await fs.stat(filename)).isFile())throw new Error('Select a regular .pcap or .pcapng file.');
 filter=captureFilter(filter);
 const args=['-n','-r',filename,'-c','200',...(filter?['-Y',filter]:[])];
 if(view==='hex')args.push('-x');else args.push('-T','fields','-e','frame.number','-e','tcp.payload','-e','udp.payload','-e','data.data');
 return Object.freeze({...makeReview({...tool,network:false,privileged:false,risk:'Offline read of at most 200 captured packets. No live interface, name resolution, reassembly, decryption or model upload. File contents are untrusted.'},args),capture:true,outputFormat:view==='ascii'?'packet-ascii':'hex',file:filename});
}
export function packetAscii(text){
 return text.split('\n').filter(Boolean).map(line=>{
  const [frame,...fields]=line.trimEnd().split('\t'),hex=fields.find(field=>field&&/^[0-9a-fA-F:]+$/.test(field));
  if(!/^\d+$/.test(frame))return '[Unrecognized packet metadata omitted]';
  if(!hex)return `Packet ${frame}: no extracted TCP/UDP/data payload (other protocols or encrypted content may be present).`;
  const digits=hex.replaceAll(':','');if(digits.length%2)return `Packet ${frame}: malformed payload omitted`;
  const bytes=Buffer.from(digits,'hex');return `Packet ${frame}: `+[...bytes].map(n=>n>=32&&n<=126?String.fromCharCode(n):'\\x'+n.toString(16).padStart(2,'0')).join('');
 }).join('\n');
}
