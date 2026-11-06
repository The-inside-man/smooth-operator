import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import dgram from 'node:dgram';
import {RawListener,listenerConfig,hexDump} from '../cli/listener.mjs';
const waitFor=async(check)=>{for(let i=0;i<100;i++){if(check())return;await new Promise(r=>setTimeout(r,10));}throw new Error('Listener fixture timeout');};
const unusedPort=async()=>{const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));return port;};
test('listener validates mode/protocol/port and never interprets raw control bytes',()=>{
 for(const port of [-1,0,65536,NaN,1.5])assert.throws(()=>listenerConfig({port,protocol:'tcp'}));
 assert.throws(()=>listenerConfig({port:9999}));assert.throws(()=>listenerConfig({port:9999,protocol:'tcp',mode:'capture'}));
 assert.equal(listenerConfig({port:9999,protocol:'udp'}).external,false);
 const text=hexDump(Buffer.from([0x1b,0x5b,0x32,0x4a,0,0xff,65]));assert.match(text,/1b 5b 32 4a 00 ff 41/);assert.ok(!text.includes('\x1b'));
});
test('TCP listener reconnects, bounds output and closes owned sockets',async()=>{
 const listener=new RawListener(),port=await unusedPort(),config=listenerConfig({port,protocol:'tcp'});await assert.rejects(listener.start(config),/confirm/);
 await listener.start(config,{confirmed:true});try{
  for(let i=0;i<2;i++){const socket=net.connect(port,'127.0.0.1');await new Promise(r=>socket.once('connect',r));socket.end(Buffer.from([27,91,50,74,0,65]));await new Promise(r=>socket.once('close',r));}
  await waitFor(()=>listener.state.bytes===12);assert.equal(listener.state.connections,2);assert.ok(!listener.state.output.includes('\x1b'));
  listener.receive(Buffer.alloc(100000,65),'fixture');assert.ok(listener.state.output.length<=65536);assert.ok(listener.state.droppedBytes>0);
 }finally{await listener.stop();}assert.equal(listener.state.status,'stopped');assert.equal(listener.peers.size,0);
 await listener.start(config,{confirmed:true});await listener.stop();
});
test('UDP loopback datagrams and address-in-use failure are explicit',async()=>{
 const listener=new RawListener(),port=await unusedPort();await listener.start(listenerConfig({port,protocol:'udp'}),{confirmed:true});const sender=dgram.createSocket('udp4');
 try{await new Promise((resolve,reject)=>sender.send(Buffer.from('local fixture'),port,'127.0.0.1',e=>e?reject(e):resolve()));await waitFor(()=>listener.state.bytes>0);assert.match(listener.state.output,/6c 6f 63 61 6c/);}finally{sender.close();await listener.stop();}
 const existing=net.createServer();await new Promise(r=>existing.listen(0,'127.0.0.1',r));const blocked=new RawListener();try{await assert.rejects(blocked.start(listenerConfig({port:existing.address().port,protocol:'tcp'}),{confirmed:true}),/EADDRINUSE/);assert.equal(blocked.state.status,'failed');assert.ok(existing.listening);}finally{await blocked.stop();await new Promise(r=>existing.close(r));}
});
