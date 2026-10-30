import net from 'node:net';
import dgram from 'node:dgram';
import {EventEmitter} from 'node:events';

export function listenerConfig({port,protocol,host='127.0.0.1',mode='bind',durationMs=300000}) {
 if(mode!=='bind')throw new Error('Existing traffic capture is not supported by the built-in listener. It receives only new connections/datagrams sent to its own socket.');
 if(!['tcp','udp'].includes(protocol))throw new Error('Choose TCP or UDP explicitly.');
 if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Port must be an integer from 1 to 65535.');
 if(!net.isIP(host))throw new Error('Bind host must be an explicit IP address.');
 if(!Number.isInteger(durationMs)||durationMs<1||durationMs>300000)throw new Error('Listener duration must be at most five minutes.');
 return Object.freeze({port,protocol,host,mode,durationMs,external:!['127.0.0.1','::1'].includes(host)});
}

export function hexDump(buffer){
 const lines=[];for(let offset=0;offset<buffer.length;offset+=16){const row=buffer.subarray(offset,offset+16);lines.push(offset.toString(16).padStart(4,'0')+'  '+[...row].map(n=>n.toString(16).padStart(2,'0')).join(' ').padEnd(47)+'  '+[...row].map(n=>n>=32&&n<=126?String.fromCharCode(n):'.').join(''));}return lines.join('\n');
}

export class RawListener extends EventEmitter {
 constructor(){super();this.state={status:'idle',output:'',bytes:0,connections:0,droppedBytes:0};this.peers=new Set();}
 publish(){this.emit('state',{...this.state});}
 append(value){this.state.output=(this.state.output+value+'\n').slice(-65536);}
 receive(bytes,peer){this.state.bytes+=bytes.length;const shown=bytes.subarray(0,2048);this.state.droppedBytes+=bytes.length-shown.length;this.append(`${peer} / ${bytes.length} bytes\n${hexDump(shown)}`);}
 async start(config,{confirmed=false}={}){
  if(!confirmed)throw new Error('Review and confirm the exact listener before binding.');
  if(this.server)throw new Error('Listener is already running.');this.config=listenerConfig(config);config=this.config;
  this.state={status:'starting',output:'',bytes:0,connections:0,droppedBytes:0};this.publish();
  const fail=error=>{this.state.status='failed';this.append(error.message);this.publish();};
  const ready=new Promise((resolve,reject)=>{
   if(config.protocol==='tcp'){
    this.server=net.createServer(socket=>{
     if(this.peers.size>=8){socket.destroy();return;}this.peers.add(socket);this.state.connections++;
     const peer=`${socket.remoteAddress}:${socket.remotePort}`;this.append('Connected '+peer);
     socket.setTimeout(60000,()=>socket.destroy());
     socket.on('data',bytes=>{socket.pause();this.receive(bytes,peer);const timer=setTimeout(()=>{if(!socket.destroyed)socket.resume();},20);timer.unref();});
     socket.on('error',error=>this.append('Connection error: '+error.message));socket.on('close',()=>{this.peers.delete(socket);this.append('Disconnected '+peer);});
    });this.server.once('error',reject);this.server.listen(config.port,config.host,resolve);
   }else{
    this.server=dgram.createSocket(net.isIP(config.host)===6?'udp6':'udp4');
    this.server.on('message',(bytes,peer)=>this.receive(bytes,`${peer.address}:${peer.port}`));this.server.once('error',reject);this.server.bind(config.port,config.host,resolve);
   }
  });
  try{await ready;this.state.status='listening';this.append(`Bound ${config.protocol.toUpperCase()} ${config.host}:${config.port}. Only traffic sent to this socket is received.`);this.server.on('error',fail);this.interval=setInterval(()=>this.publish(),100);this.timer=setTimeout(()=>void this.stop(),config.durationMs);this.publish();return this.state;}
  catch(error){fail(error);await this.stop(true);throw error;}
 }
 async stop(preserveError=false){
  clearInterval(this.interval);clearTimeout(this.timer);for(const socket of this.peers)socket.destroy();this.peers.clear();const server=this.server;this.server=null;
  if(server)await new Promise(resolve=>{try{server.close(resolve);}catch{resolve();}});
  if(!preserveError)this.state.status='stopped';this.publish();
 }
}
