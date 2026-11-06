import './terminal-env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import React,{useState,useEffect} from 'react';
import {PassThrough,Writable} from 'node:stream';
import {render,Text} from 'ink';
import {renderToString} from 'ink';
import {TerminalBoundary,WidthMessage,useSafeInput,guardLines} from '../cli/terminal-boundary.mjs';
import {useEditorInput} from '../cli/editor-input.mjs';
import {edit,clean} from '../cli/core.mjs';
import {App} from '../cli/app.mjs';
import {cellWidth} from '../cli/layout.mjs';
test('80-column boundary fits tiny/short/ASCII/no-color frames and 79/80/81 transition',()=>{
 for(const w of [1,8,40,79,80,81])for(const h of [1,8,15,16,30]){
  const message=renderToString(React.createElement(WidthMessage,{w,h}),{columns:w});
  assert.ok(clean(message).split(String.fromCharCode(10)).every(l=>cellWidth(l)<=w));assert.ok(guardLines(w,h).length<=Math.max(1,h-1));
 }
 for(const w of [79,80,81]){
 const frame=clean(renderToString(React.createElement(App,{demo:true,staticPreview:true,dimensions:{w,h:30}}),{columns:w}));
 if(w===79){assert.match(frame,/Current: 79 columns/);assert.doesNotMatch(frame,/COMMAND/);assert.match(frame,/Esc cancel/);}
 else assert.match(frame,/COMMAND/);
 }
});
test('mounted screen preserves unicode cursor/job/approval while narrow input is discarded and cancel remains live',async()=>{
 const stdin=new PassThrough();stdin.isTTY=true;stdin.ref=()=>stdin;stdin.unref=()=>stdin;stdin.setRawMode=()=>stdin;let bytes='',state,approve=0,cancels=0,unmounts=0,tick;
 const stdout=new Writable({write(c,_e,done){bytes+=c;done();}});stdout.isTTY=true;stdout.columns=81;stdout.rows=30;
 const delay=()=>new Promise(r=>setTimeout(r,60));
 function Screen(){const [draft,setDraft]=useState({text:'A界B',cursor:2}),[job,setJob]=useState('stream-one');
 useEffect(()=>{tick=setJob;return()=>unmounts++;},[]);
 useEditorInput((input,key)=>{if(key.escape){cancels++;return;}if(key.return){approve++;return;}setDraft(d=>edit(d,input,key));});
 state={draft,job};return React.createElement(Text,null,job+' '+draft.text);}
 const ui=render(React.createElement(TerminalBoundary,null,React.createElement(Screen)),{stdin,stdout,stderr:stdout,exitOnCtrlC:false,patchConsole:false});
 try{await delay();stdout.columns=79;stdout.emit('resize');await delay();tick('stream-two');stdin.write('discarded');stdin.write(String.fromCharCode(13));await delay();assert.equal(approve,0);assert.equal(state.draft.text,'A界B');assert.equal(state.draft.cursor,2);assert.equal(state.job,'stream-two');assert.equal(unmounts,0);
 stdin.write('');await delay();assert.equal(cancels,1);
 stdout.columns=80;stdout.emit('resize');await delay();assert.equal(state.draft.cursor,2);stdin.write('X');await delay();assert.equal(state.draft.text,'A界XB');stdin.write(String.fromCharCode(13));await delay();assert.equal(approve,1);assert.equal(state.job,'stream-two');assert.match(clean(bytes),/80 columns/);
 }finally{ui.unmount();await ui.waitUntilExit();stdin.destroy();stdout.destroy();}
});
