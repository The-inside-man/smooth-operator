import crypto from 'node:crypto';
import net from 'node:net';
import {publicAddress} from './image-download.mjs';
export function torProxy(value='127.0.0.1:9050'){const u=new URL('socks5://'+value);if(!['127.0.0.1','[::1]'].includes(u.hostname)||!u.port||u.username||u.password||u.pathname||u.search||u.hash)throw new Error('Tor SOCKS endpoint must be a literal loopback host:port, e.g. 127.0.0.1:9050.');return {host:u.hostname.replace(/[\[\]]/g,''),port:Number(u.port)};}
export const createTorIsolation=()=>({username:crypto.randomBytes(16).toString('hex'),password:crypto.randomBytes(16).toString('hex')});
async function exchange(proxy,command,address,port,signal,isolation){
 const socket=net.createConnection(torProxy(proxy));let buffer=Buffer.alloc(0),waiting,error;
 const wake=()=>waiting?.();const data=c=>{if(buffer.length+c.length>65536){error=new Error('Tor SOCKS reply exceeds limit');socket.destroy();wake();return;}buffer=Buffer.concat([buffer,c]);wake();},fail=e=>{error=e;wake();};socket.on('data',data);socket.on('error',fail);socket.on('end',()=>fail(new Error('Tor SOCKS closed unexpectedly')));
 const abort=()=>socket.destroy(new Error('Tor request cancelled'));signal?.addEventListener('abort',abort,{once:true});socket.setTimeout(15000,()=>socket.destroy(new Error('Tor SOCKS timeout')));
 const read=async n=>{while(buffer.length<n){if(error)throw error;await new Promise(r=>waiting=r);waiting=null;}const out=buffer.subarray(0,n);buffer=buffer.subarray(n);return out;};
 try{signal?.throwIfAborted();await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('error',reject);});socket.write(Buffer.from([5,1,2]));if(!(await read(2)).equals(Buffer.from([5,2])))throw new Error('Tor SOCKS isolation authentication rejected; no downgrade.');
  const user=Buffer.from(isolation.username),pass=Buffer.from(isolation.password);if(!user.length||user.length>255||!pass.length||pass.length>255)throw new Error('Invalid isolation identity');socket.write(Buffer.concat([Buffer.from([1,user.length]),user,Buffer.from([pass.length]),pass]));if(!(await read(2)).equals(Buffer.from([1,0])))throw new Error('Tor SOCKS isolation negotiation failed; no fallback.');
  let addr;if(net.isIP(address)===4)addr=Buffer.from([1,...address.split('.').map(Number)]);else if(net.isIP(address)===6){const expanded=address.includes('::')?(()=>{const [a,b]=address.split('::'),left=a?a.split(':'):[],right=b?b.split(':'):[];return [...left,...Array(8-left.length-right.length).fill('0'),...right];})():address.split(':');addr=Buffer.alloc(17);addr[0]=4;expanded.forEach((v,i)=>addr.writeUInt16BE(parseInt(v,16),1+i*2));}else{const name=Buffer.from(address,'ascii');if(name.length>255)throw new Error('Tor hostname too long');addr=Buffer.concat([Buffer.from([3,name.length]),name]);}
  const p=Buffer.alloc(2);p.writeUInt16BE(port);socket.write(Buffer.concat([Buffer.from([5,command,0]),addr,p]));const head=await read(4);if(head[0]===5&&head[1]===2&&command===1&&net.isIP(address))throw new Error('Tor denied pinned-IP CONNECT (SOCKS policy 2). SafeSocks may reject this even after remote RESOLVE with the same isolation identity. No hostname retry, SafeSocks downgrade or direct fallback.');if(head[0]!==5||head[1]!==0)throw new Error('Tor SOCKS request failed ('+head[1]+'); no direct fallback.');let resolved;
  if(head[3]===1)resolved=[...(await read(4))].join('.');else if(head[3]===4){const b=await read(16);resolved=Array.from({length:8},(_,i)=>b.readUInt16BE(i*2).toString(16)).join(':');}else if(head[3]===3)resolved=(await read((await read(1))[0])).toString('ascii');else throw new Error('Invalid SOCKS reply');await read(2);
  socket.off('data',data);if(buffer.length)socket.unshift(buffer);socket.setTimeout(0);if(command===0xf0){socket.destroy();return resolved;}return socket;
 }catch(e){socket.destroy();throw e;}finally{signal?.removeEventListener('abort',abort);}
}
export async function torSocket(host,port,{proxy='127.0.0.1:9050',signal,isolation=createTorIsolation()}={}){
 host=host.toLowerCase();if(host.endsWith('.onion')){if(!/^[a-z2-7]{56}\.onion$/.test(host))throw new Error('Only v3 onion hostnames are supported.');return exchange(proxy,1,host,port,signal,isolation);}
 if(!host.includes('.')&&!net.isIP(host)||host.endsWith('.local')||host==='localhost')throw new Error('Local hostnames are blocked.');
 const address=net.isIP(host)?host:await exchange(proxy,0xf0,host,0,signal,isolation);if(!publicAddress(address))throw new Error('Tor resolved a non-public address; blocked.');return exchange(proxy,1,address,port,signal,isolation);
}
