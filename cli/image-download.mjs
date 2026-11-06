import tls from 'node:tls';
import {torSocket,createTorIsolation} from './tor.mjs';
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import dns from 'node:dns/promises';import net from 'node:net';import http from 'node:http';import https from 'node:https';import crypto from 'node:crypto';
const entities=s=>s.replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#(?:x([0-9a-f]+)|(\d+));/gi,(_,x,n)=>String.fromCodePoint(Math.min(0x10ffff,parseInt(x||n,x?16:10))));
export function publicAddress(ip){
 if(net.isIP(ip)===4){const [a,b,c]=ip.split('.').map(Number);return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0)||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113);}
 return net.isIP(ip)===6&&/^[23][0-9a-f]{3}:/i.test(ip)&&!/^2001:(db8|0):/i.test(ip)&&!/^2002:/i.test(ip);
}
export function imageUrls(html,base){const found=new Set();
 for(const tag of html.matchAll(/<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi)){
  for(const attr of tag[0].matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)){
   const key=attr[1].toLowerCase();if(!['src','srcset','data-src','data-srcset','data-original','data-lazy-src'].includes(key))continue;
   const value=entities(attr[2]??attr[3]??attr[4]??'');const values=key.endsWith('srcset')?value.split(',').map(v=>v.trim().split(/\s+/)[0]):[value];
   for(const candidate of values)try{const u=new URL(candidate,base);u.hash='';if(['http:','https:'].includes(u.protocol)&&!u.username&&!u.password)found.add(u.href);}catch{}
  }
 }return [...found];}
export async function get(url,{signal,maxBytes,allowTestLoopback=false,redirects=0,transport={mode:'direct'},onProgress=()=>{}}){
 if(transport.mode==='tor'&&!transport.isolation)transport={...transport,isolation:createTorIsolation()};
 const u=new URL(url);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw new Error('Only public HTTP(S) URLs without credentials are supported.');
 const host=u.hostname.replace(/^\[|\]$/g,'');if(transport.mode!=='tor'&&host.endsWith('.onion'))throw new Error('Onion URLs require explicit --route tor.');
 let torConnection;if(transport.mode==='tor')torConnection=await torSocket(host,Number(u.port)||(u.protocol==='https:'?443:80),{proxy:transport.proxy,signal,isolation:transport.isolation});
 const addresses=transport.mode==='tor'?[]:net.isIP(host)?[{address:host,family:net.isIP(host)}]:await dns.lookup(host,{all:true});
 if(transport.mode!=='tor'&&(!addresses.length||addresses.some(a=>!publicAddress(a.address)&&!(allowTestLoopback&&['127.0.0.1','::1'].includes(a.address)))))throw new Error('Private, loopback, reserved or metadata destination blocked.');
 signal?.throwIfAborted();const pinned=addresses[0];let agent;if(torConnection){agent=u.protocol==='https:'?new https.Agent():new http.Agent();agent.createConnection=()=>u.protocol==='https:'?tls.connect({socket:torConnection,servername:host}):torConnection;}
 return new Promise((resolve,reject)=>{
  const req=(u.protocol==='https:'?https:http).get(u,{agent,signal,timeout:15000,headers:{'user-agent':'TIM-Studio-image-downloader/0.1','accept-encoding':'identity'},lookup:(_host,options,cb)=>options.all?cb(null,[pinned]):cb(null,pinned.address,pinned.family)},res=>{
   if([301,302,303,307,308].includes(res.statusCode)){res.resume();if(redirects>=5||!res.headers.location)return reject(new Error('Redirect limit or missing location'));get(new URL(res.headers.location,u).href,{signal,maxBytes,allowTestLoopback,redirects:redirects+1,transport,onProgress}).then(resolve,reject);return;}
   if(res.statusCode!==200){res.resume();reject(new Error('HTTP '+res.statusCode));return;}
   const chunks=[];let size=0;res.on('data',chunk=>{size+=chunk.length;onProgress(size,Number(res.headers['content-length'])||null);if(size>maxBytes){reject(new Error('Response exceeds size limit'));res.destroy();req.destroy();return;}chunks.push(chunk);});
   res.on('end',()=>resolve({url:u.href,type:String(res.headers['content-type']||'').split(';')[0].toLowerCase(),bytes:Buffer.concat(chunks)}));res.on('error',reject);
  });req.on('timeout',()=>req.destroy(new Error('Request timeout')));req.on('error',reject);
 });
}
export const imageDestination=()=>path.join(os.homedir(),'Downloads','TIM-images-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomUUID().slice(0,8));
export async function downloadImages({url,destination,signal,onStatus=()=>{},allowTestLoopback=false,maxImages=100,maxImageBytes=10*1024*1024,maxTotalBytes=100*1024*1024,transport={mode:'direct'}}){
 if(transport.mode==='tor')transport={...transport,isolation:createTorIsolation()};
 if(!path.isAbsolute(destination))throw new Error('Choose an absolute destination folder.');
 // A fresh per-task directory prevents overwriting preexisting files or symlink targets.
 try{await fs.lstat(destination);throw new Error('Destination already exists; choose a new per-task folder.');}catch(error){if(error.code!=='ENOENT')throw error;}
 const deadline=AbortSignal.timeout(120000),combined=signal?AbortSignal.any([signal,deadline]):deadline;
 onStatus((transport.mode==='tor'?'TOR / connecting; fail closed':'DIRECT')+' / Reading one public page; no site crawl.');const page=await get(url,{signal:combined,maxBytes:2*1024*1024,allowTestLoopback,transport});
 if(!['text/html','application/xhtml+xml'].includes(page.type))throw new Error('Page must be HTML.');const urls=imageUrls(page.bytes.toString('utf8'),page.url);
 combined.throwIfAborted();await fs.mkdir(path.dirname(destination),{recursive:true});await fs.mkdir(destination);
 const manifest={page:page.url,createdAt:new Date().toISOString(),scope:'single HTML page; img/src/srcset/lazy attributes only; no JS/CSS evaluation',discovered:urls.length,saved:[],failures:[],limited:urls.length>maxImages,cancelled:false,skippedDuplicates:0};let total=0;const finalUrls=new Set();
 const extensions={'image/png':'.png','image/jpeg':'.jpg','image/gif':'.gif','image/webp':'.webp','image/avif':'.avif','image/bmp':'.bmp','image/x-icon':'.ico'};
 try{for(const [index,source] of urls.slice(0,maxImages).entries()){
  combined.throwIfAborted();onStatus('Downloading image '+(index+1)+'/'+Math.min(urls.length,maxImages)+'; '+manifest.saved.length+' saved');
  try{const result=await get(source,{signal:combined,maxBytes:maxImageBytes,allowTestLoopback,transport});if(finalUrls.has(result.url)){manifest.skippedDuplicates++;continue;}finalUrls.add(result.url);const ext=extensions[result.type];if(!ext)throw new Error('Unsupported image content type (SVG/HTML are not saved).');
   if(total+result.bytes.length>maxTotalBytes){manifest.limited=true;throw new Error('Total byte limit reached');}
   const filename=String(index+1).padStart(3,'0')+'-'+crypto.createHash('sha256').update(source).digest('hex').slice(0,12)+ext;
   const temp=path.join(destination,filename+'.part');try{await fs.writeFile(temp,result.bytes,{flag:'wx'});combined.throwIfAborted();await fs.rename(temp,path.join(destination,filename));}finally{await fs.unlink(temp).catch(()=>{});}
   total+=result.bytes.length;manifest.saved.push({url:source,filename,bytes:result.bytes.length});
  }catch(error){if(combined.aborted)throw error;manifest.failures.push({url:source,error:error.message});}
 }}catch(error){manifest.cancelled=combined.aborted;manifest.error=error.message;}finally{manifest.bytes=total;await fs.writeFile(path.join(destination,'manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx'});}
 return {...manifest,destination};
}
