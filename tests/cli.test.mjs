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
 for(const [w,h] of [[160,52],[154,50],[144,50],[110,38],[100,34],[80,24],[44,18]]){const output=clean(renderToString(React.createElement(App,{demo:true,initial:demoState,staticPreview:true,dimensions:{w,h}}),{columns:w}));const lines=output.split('\n');assert.ok(lines.length<=h,`${w}x${h}: ${lines.length}`);assert.ok(lines.every(l=>l.length<=w));if(w<80){assert.match(output.replaceAll('\n',''),/80 columns/);}else{assert.match(output,/COMMAND/);assert.match(output,/Enter send/);}}
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
 for(const [w,h,art] of [[154,50,hood],[160,52,hood]]){
  const output=clean(renderToString(React.createElement(App,{demo:true,initial:demoState,staticPreview:true,dimensions:{w,h}}),{columns:w}));
  for(const line of art.split('\n'))assert.ok(output.includes(line.trimEnd()),'Clipped hoodie row at '+w+'x'+h+': '+line);
  assert.ok(output.split('\n').length<=h);assert.ok(output.split('\n').every(line=>line.length<=w));assert.match(output,/COMMAND/);assert.match(output,/WORKSPACE/);assert.match(output,/SESSION/);
 }
});

test('hoodie bottom aligns to hero prompt without moving surrounding UI',()=>{
 for(const [w,h,art,panelY,sessionX,commandY,footerY,promptX,promptY] of [[160,52,hood,36,69,47,50,78,32],[154,50,hood,36,67,45,48,75,32]]){
  const lines=clean(renderToString(React.createElement(App,{demo:true,initial:demoState,staticPreview:true,dimensions:{w,h}}),{columns:w})).split('\n');
  const position=label=>{const y=lines.findIndex(line=>line.includes(label));return {x:lines[y]?.indexOf(label),y};};
  assert.deepEqual(position('WORKSPACE'),{x:3,y:panelY});assert.deepEqual(position('SESSION'),{x:sessionX,y:panelY});
  assert.deepEqual(position('COMMAND'),{x:3,y:commandY});assert.deepEqual(position('Enter send'),{x:1,y:footerY});
  assert.deepEqual(position('>   W h a t   a r e   w e   b u i l d i n g ?'),{x:promptX,y:promptY});
  assert.equal(lines.findIndex(line=>line.includes(art.split('\n').at(-1))),promptY);
  assert.equal(lines[promptY-1].indexOf('Y O U R   W O R K .   O N E   T E R M I N A L .'),promptX);
  const large=w>=154,mark=retroWordmark({large}).split('\n'),markTop=large?5:4;
  mark.forEach((line,i)=>{if(line.trim())assert.equal(lines[markTop+i].indexOf(line),promptX);});
 }
});

test('active provider status fits large, compact and narrow layouts without moving the composer',()=>{
 const initial=structuredClone(demoState),now=Date.now();initial.jobs=[{id:'fixture',sessionId:'demo',status:'running',phase:'Provider processing',startedAt:now-70000,lastActivityAt:now-65000}];
 for(const dimensions of [{w:160,h:52},{w:100,h:38},{w:60,h:20}]){const frame=clean(renderToString(React.createElement(App,{initial,client:{selection:{provider:'xai',modelId:'fixture'}},staticPreview:true,dimensions}),{columns:dimensions.w}));if(dimensions.w<80){assert.match(frame,/Running jobs continue/);}else{assert.match(frame,/XAI \/ CLOUD/);assert.match(frame,/ETA unavailable/);assert.match(frame,/COMMAND/);}assert.ok(frame.split('\n').every(line=>line.length<=dimensions.w));}
});

import {cellWidth,wrapCells,layout,smallLogo} from '../cli/layout.mjs';
test('half-screen and short viewport matrix preserves all boundaries and composer',()=>{
 for(const w of [80,90,100,110,120,140,160])for(const h of [24,30,40,50,52]){
 const frame=clean(renderToString(React.createElement(App,{demo:true,staticPreview:true,dimensions:{w,h}}),{columns:w}));
 assert.ok(frame.split('\n').length<=h,w+'x'+h);assert.ok(frame.split('\n').every(l=>cellWidth(l)<=w));if(w<80){assert.match(frame,/80 columns/);}else{assert.match(frame,/Enter send/);assert.match(frame,/COMMAND/);if(layout(w,h,true,false).showHeroCopy)assert.match(frame,/What\s+are\s+we\s+building|W h a t/);}
 }
});
test('grapheme editing and wrapped cursor use terminal cells',()=>{
 let s={text:'A👩‍💻é界Z',cursor:'A👩‍💻é界'.length};s=edit(s,'',{backspace:true});assert.equal(s.text,'A👩‍💻éZ');s=edit(s,'',{leftArrow:true});s=edit(s,'',{backspace:true});assert.equal(s.text,'AéZ');assert.equal(wrapCells('界界a',4,2).cursorCol,0);assert.equal(wrapCells('a\n',5,2).cursorRow,1);
});


test('short welcome retains approved complete portrait and outlined wordmark',()=>{
 for(const [w,h] of [[100,24],[100,30],[100,38],[120,24],[120,30],[120,37],[120,40],[140,24],[140,30],[140,50],[160,40],[160,52]]){
  const frame=clean(renderToString(React.createElement(App,{demo:true,staticPreview:true,dimensions:{w,h}}),{columns:w}));
  const large=w>=154&&h>=37;
  assert.doesNotMatch(frame,/Full TIM artwork needs/);
  for(const line of (large||(w>=125&&h>=40)?hood:compactHood).split('\n'))assert.ok(frame.includes(line.trimEnd()),w+'x'+h+' missing portrait row '+line);
  for(const line of (layout(w,h,true,false).variant==='narrow'?smallLogo:retroWordmark({large})).split('\n'))if(line.trim())assert.ok(frame.includes(line.trimEnd()),w+'x'+h+' missing wordmark row');
  assert.match(frame,/COMMAND/);assert.ok(frame.split('\n').length<=h);
 }
});

import {shimmerFrame} from '../cli/animation.mjs';
test('rendered full hero shimmer changes cloth only and respects disabled animation',()=>{
 const render=(previewFrame,animation=true)=>clean(renderToString(React.createElement(App,{demo:true,staticPreview:true,dimensions:{w:160,h:52},previewFrame,animation}),{columns:160}));
 const first=render(0),next=render(16);assert.equal(first,next,'color-only animation preserves every rendered cell');assert.equal(render(16,false),first);
 assert.equal(first.replace(/[#=]/g,'X'),next.replace(/[#=]/g,'X'));
 for(const line of shimmerFrame(hood,1).split('\n'))assert.ok(next.includes(line));
 assert.equal(first.split('\n').findIndex(l=>l.includes('COMMAND')),next.split('\n').findIndex(l=>l.includes('COMMAND')));
});

test('compact tall welcome keeps content near header rather than vertically floating',()=>{
 const lines=clean(renderToString(React.createElement(App,{demo:true,staticPreview:true,dimensions:{w:110,h:50}}),{columns:110})).split('\n');
 const logo=retroWordmark({large:false}).split('\n')[0];assert.ok(lines.findIndex(l=>l.includes(logo))<=5);
 const bottom=lines.findIndex(l=>l.includes(compactHood.split('\n').at(-1))),panel=lines.findIndex(l=>l.includes('WORKSPACE'));assert.ok(panel-bottom<=5);
 assert.ok(lines.some(l=>l.includes('YOUR WORK. ONE TERMINAL.')));assert.match(lines.join('\n'),/COMMAND/);
});

test('80-column welcome matrix always contains complete selected art and input',async()=>{
 const {layout,smallHood,microHood,smallLogo,shortLogo}=await import('../cli/layout.mjs');
 for(const w of [80,81,90,99,100,110,120,125,140,153,154,160])for(const h of [16,18,24,30,37,40,50]){
 const l=layout(w,h,true,false),art=l.variant==='micro'?microHood:l.variant==='small'?smallHood:l.large||l.variant==='balanced'?hood:compactHood;
 const frame=clean(renderToString(React.createElement(App,{demo:true,staticPreview:true,dimensions:{w,h}}),{columns:w}));
 assert.ok(l.hero,w+'x'+h+' missing art tier');for(const row of art.split('\n'))assert.ok(frame.includes(row.trimEnd()),w+'x'+h+' incomplete hoodie');
 const mark=['narrow','small','micro'].includes(l.variant)?(['small','micro'].includes(l.variant)?shortLogo:smallLogo):retroWordmark({large:l.large});
 for(const row of mark.split('\n'))if(row.trim())assert.ok(frame.includes(row.trimEnd()),w+'x'+h+' incomplete lettering');
 assert.match(frame,/COMMAND/);assert.ok(frame.split('\n').length<=h);assert.ok(frame.split('\n').every(row=>cellWidth(row)<=w));
 }
});

test('compact wordmark has independently spaced glyphs, open M and distinct lowercase dot',()=>{
 const rows=retroWordmark({large:false}).split('\n');assert.equal(rows.length,19);assert.equal(rows[11],'');assert.ok(rows.every(r=>r.length<=48));
 for(const row of rows.slice(0,11)){assert.equal(row.padEnd(48)[15],' ');assert.equal(row.padEnd(48)[27],' ');}
 for(const row of rows.slice(12)){for(const gap of [8,16,25,34,39])assert.equal(row.padEnd(48)[gap],' ');}
 assert.equal(rows[13].slice(35,39),'|__|');assert.match(rows[5],/\\\//);assert.doesNotMatch(rows.join('\n'),/[#█]/);
});
