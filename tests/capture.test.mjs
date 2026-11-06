import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {captureReview,captureFilter,packetAscii} from '../cli/capture.mjs';
test('offline capture uses exact file/filter argv and bounded packet views; no live capture or payload upload',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'tim-capture-'));try{
  const file=path.join(root,'sample with spaces.pcap');await fs.writeFile(file,Buffer.from('d4c3b2a1020004000000000000000000ffff000001000000','hex'));
  const tool={id:'fixture',name:'TShark fixture',status:'installed',executable:process.execPath};
  const canonicalFile=await fs.realpath(file);
  const hex=await captureReview(tool,file,{filter:'tcp.port == 9999'});assert.deepEqual(hex.args,['-n','-r',canonicalFile,'-c','200','-Y','tcp.port == 9999','-x']);assert.equal(hex.file,canonicalFile);assert.equal(hex.network,false);
  const ascii=await captureReview(tool,file,{view:'ascii'});assert.equal(ascii.outputFormat,'packet-ascii');assert.ok(ascii.args.includes('tcp.payload'));
  assert.throws(()=>captureFilter('x\n-i any'));assert.throws(()=>captureFilter('"; evil'));await assert.rejects(captureReview(tool,file,{view:'stream'}),/hex or ascii/);
  assert.equal(packetAscii('1\t411b5b33316d00\t\n'),'Packet 1: A\\x1b[31m\\x00');assert.ok(!packetAscii('1\t1b\n').includes('\x1b'));
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('offline capture canonicalizes directory aliases while keeping file and filter literal',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'tim-capture-alias-'));try{
  const directory=path.join(root,'real captures'),alias=path.join(root,'capture alias');await fs.mkdir(directory);
  // Directory junctions do not need Windows symlink privileges.
  await fs.symlink(directory,alias,process.platform==='win32'?'junction':'dir');
  const filename='sample with spaces; literal.pcap',file=path.join(directory,filename),input=path.join(alias,filename);
  await fs.writeFile(file,Buffer.from('d4c3b2a1020004000000000000000000ffff000001000000','hex'));
  const canonicalFile=await fs.realpath(file);assert.notEqual(input,canonicalFile);
  const tool={id:'fixture',name:'TShark fixture',status:'installed',executable:process.execPath};
  const review=await captureReview(tool,input,{filter:'tcp.port == 9999 || udp.port == 53'});
  assert.equal(review.file,canonicalFile);
  assert.deepEqual(review.args,['-n','-r',canonicalFile,'-c','200','-Y','tcp.port == 9999 || udp.port == 53','-x']);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
