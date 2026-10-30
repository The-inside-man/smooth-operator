import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import React from 'react';
import {renderToString} from 'ink';
import {edit,clean,endpoint,Client,demoState} from '../cli/core.mjs';
import {App} from '../cli/app.mjs';
import {retroWordmark} from '../cli/retro.mjs';
import {hood,compactHood} from '../cli/art.mjs';
test('multiline editing, navigation, paste and deletion',()=>{
 let s=edit({text:'abc',cursor:1},'',{return:true});assert.deepEqual(s,{text:'a\nbc',cursor:2});
 s=edit(s,'X\nY');assert.equal(s.text,'a\nX\nYbc');
 s=edit(s,'',{leftArrow:true});s=edit(s,'',{delete:true});assert.equal(s.text,'a\nX\nbc');
 s=edit(s,'',{upArrow:true});assert.equal(s.cursor,2);
 s=edit(s,'',{backspace:true});assert.equal(s.text,'aX\nbc');
 assert.equal(edit(s,'q',{ctrl:true}).text,s.text);
});
test('terminal escapes stripped; URL restricted to loopback',()=>{
 assert.equal(clean('\x1b[2Jhello\x1b]0;bad\x07'),'hello');
 assert.throws(()=>endpoint('https://example.com'));assert.throws(()=>endpoint('http://user@localhost:4317'));
 assert.equal(endpoint('http://127.0.0.1:4317'),'http://127.0.0.1:4317');
});
test('real protocol: fragmented streaming snapshots, submit and cancel',async()=>{
 const calls=[];let stream;
 const server=http.createServer(async(req,res)=>{if(req.url==='/api/events'){stream=res;res.writeHead(200,{'content-type':'text/event-stream'});res.write('data: {"jobs":');setTimeout(()=>res.write('[]}\n\n'),5);return;}let body='';for await(const chunk of req)body+=chunk;calls.push([req.url,JSON.parse(body||'{}'),req.headers['x-tim-request']]);res.setHeader('content-type','application/json');res.end(JSON.stringify(req.url==='/api/jobs'?{id:'job',sessionId:'session'}:{ok:true}));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const client=new Client(`http://127.0.0.1:${server.address().port}`);
 try{let received;const watch=client.watch(s=>{received=s;client.close();}).catch(e=>{if(e.name!=='AbortError')throw e;});await watch;assert.deepEqual(received,{jobs:[]});
 const writer=new Client(client.url);await writer.request('jobs',{prompt:'hello',sessionId:'session',kind:'agent'});await writer.request('cancel',{id:'job'});writer.close();assert.equal(calls[0][1].prompt,'hello');assert.equal(calls[1][1].id,'job');assert.equal(calls[0][2],'1');
 }finally{client.close();stream?.end();server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('responsive frames fit the viewport and preserve composer',()=>{
 for(const [w,h] of [[160,52],[154,50],[144,50],[110,38],[100,34],[80,24],[44,18]]){const output=clean(renderToString(React.createElement(App,{demo:true,initial:demoState,staticPreview:true,dimensions:{w,h}}),{columns:w}));const lines=output.split('\n');assert.ok(lines.length<=h,`${w}x${h}: ${lines.length}`);assert.ok(lines.every(l=>l.length<=w));assert.match(output,/COMMAND/);assert.match(output,/Ctrl\+S/);}
});

test('outlined lettering remains printable ASCII with hollow paired strokes',()=>{
 for(const large of [true,false]){
  const block=retroWordmark({large}),ascii=retroWordmark({large,ascii:true});
  assert.match(block,/\|\|/);assert.match(block,/_{3}/);assert.doesNotMatch(block,/[\u2580-\u259f#]/);assert.match(ascii,/^[ -~\n]+$/);
  assert.deepEqual(block.split('\n').map(s=>s.length),ascii.split('\n').map(s=>s.length));
  assert.ok(block.split('\n').every(line=>line.length<78));
 }
 const previous=process.env.TIM_ASCII;process.env.TIM_ASCII='1';
 try{const frame=clean(renderToString(React.createElement(App,{demo:true,initial:demoState,staticPreview:true,dimensions:{w:160,h:52}}),{columns:160}));assert.match(frame,/^[ -~\n]+$/);assert.match(frame,/COMMAND/);}finally{if(previous===undefined)delete process.env.TIM_ASCII;else process.env.TIM_ASCII=previous;}
});

test('reviewed hoodie is fully visible at both minimum hero breakpoints',()=>{
 for(const [w,h,art] of [[154,50,hood],[100,38,compactHood]]){
  const output=clean(renderToString(React.createElement(App,{demo:true,initial:demoState,staticPreview:true,dimensions:{w,h}}),{columns:w}));
  for(const line of art.split('\n'))assert.ok(output.includes(line.trimEnd()),'Clipped hoodie row at '+w+'x'+h+': '+line);
  assert.ok(output.split('\n').length<=h);assert.ok(output.split('\n').every(line=>line.length<=w));assert.match(output,/COMMAND/);assert.match(output,/WORKSPACE/);assert.match(output,/SESSION/);
 }
});

test('hoodie bottom aligns to hero prompt without moving surrounding UI',()=>{
 for(const [w,h,art,panelY,sessionX,commandY,footerY,promptX,promptY] of [[160,52,hood,36,69,46,49,76,32],[154,50,hood,36,67,44,47,76,32],[100,38,compactHood,25,44,32,35,51,22]]){
  const lines=clean(renderToString(React.createElement(App,{demo:true,initial:demoState,staticPreview:true,dimensions:{w,h}}),{columns:w})).split('\n');
  const position=label=>{const y=lines.findIndex(line=>line.includes(label));return {x:lines[y]?.indexOf(label),y};};
  assert.deepEqual(position('WORKSPACE'),{x:3,y:panelY});assert.deepEqual(position('SESSION'),{x:sessionX,y:panelY});
  assert.deepEqual(position('COMMAND'),{x:3,y:commandY});assert.deepEqual(position('Ctrl+S send'),{x:1,y:footerY});
  assert.deepEqual(position('>   W h a t   a r e   w e   b u i l d i n g ?'),{x:promptX,y:promptY});
  assert.equal(lines.findIndex(line=>line.includes(art.split('\n').at(-1))),promptY);
  assert.equal(lines[promptY-1].indexOf('Y O U R   W O R K .   O N E   T E R M I N A L .'),promptX);
  const large=w>=154,mark=retroWordmark({large}).split('\n'),markTop=large?5:4;
  mark.forEach((line,i)=>{if(line.trim())assert.equal(lines[markTop+i].indexOf(line),promptX);});
 }
});
