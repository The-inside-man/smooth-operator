import test from 'node:test';
import assert from 'node:assert/strict';
import {hood,asciiPortrait,portraitCells} from '../cli/art.mjs';
import {wordmarkRuns} from '../cli/retro.mjs';
import {sceneRuns} from '../cli/scene.mjs';
import {SHIMMER_FRAMES} from '../cli/animation.mjs';

const options={width:158,height:31,art:hood,portraitX:3,portraitY:0,wordmarkX:77,wordmarkY:1,wordmarkOptions:{variant:'large',ascii:false},caption:['YOUR WORK. ONE TERMINAL.','> What are we building?'],captionY:27};
const expand=runs=>runs.flatMap(run=>[...run.text].map(text=>({...run,text}))).filter(cell=>cell.text!=='\n');
const at=(cells,x,y)=>cells[y*options.width+x];
const black=color=>color.toLowerCase()==='#080d0b';

test('signal reaches both scene edges without filling the hidden face or dark cloth',()=>{
 const cells=expand(sceneRuns(options,-1));
 assert.equal(cells.length,options.width*options.height);
 for(const x of [0,options.width-1])assert.ok(Array.from({length:options.height},(_,y)=>at(cells,x,y)).filter(cell=>!black(cell.backgroundColor)).length>=8,'signal must span the full welcome width');
 const original=portraitCells(hood).filter(cell=>cell.text!=='\n');
 for(const [index,cell] of original.entries())if(!cell.backdrop){
  const painted=at(cells,options.portraitX+index%69,Math.floor(index/69));
  assert.equal(painted.text,cell.text,'portrait glyph changed');
  assert.equal(painted.backgroundColor.toLowerCase(),cell.backgroundColor.toLowerCase(),'backdrop leaked into the figure');
  assert.equal(painted.color.toLowerCase(),cell.color.toLowerCase());
 }
 for(const frame of [-1,8,16,24]){
  const animated=expand(sceneRuns(options,frame));
  for(const [x,y] of [[40,12],[43,13],[40,15]]){
   const face=at(animated,options.portraitX+x,y);
   assert.equal(face.text,' ');assert.ok(black(face.color)&&black(face.backgroundColor));
  }
 }
});

test('lettering remains intact over the signal and frames repeat without changing glyphs',()=>{
 const first=sceneRuns(options,0),cells=expand(first);let x=options.wordmarkX,y=options.wordmarkY;
 for(const run of wordmarkRuns(options.wordmarkOptions))for(const text of run.text){
  if(text==='\n'){x=options.wordmarkX;y++;continue;}
  if(text!==' '){const cell=at(cells,x,y);assert.equal(cell.text,text);assert.equal(cell.color,run.color);assert.ok(black(cell.backgroundColor));}
  x++;
 }
 assert.strictEqual(sceneRuns(options,SHIMMER_FRAMES),first);
 assert.equal(sceneRuns(options,16).map(run=>run.text).join(''),first.map(run=>run.text).join(''));
});

test('one sweep crosses the entire backdrop and both words while preserving dark cutouts and captions',()=>{
 const baseline=expand(sceneRuns(options,-1)),foreground=new Set(),background=new Set(),frames=[];
 for(let frame=0;frame<SHIMMER_FRAMES;frame++){
  const cells=expand(sceneRuns(options,frame));frames.push(cells);
  for(const [index,base] of baseline.entries()){
   const cell=cells[index];assert.equal(cell.text,base.text,'shimmer must not change geometry');
   if(cell.color!==base.color)foreground.add(index);
   if(cell.backgroundColor!==base.backgroundColor)background.add(index);
   if(black(base.color))assert.ok(black(cell.color),'black foreground illuminated');
   if(black(base.backgroundColor))assert.ok(black(cell.backgroundColor),'black cutout illuminated');
   if(base.bold){assert.equal(cell.color,base.color);assert.equal(cell.backgroundColor,base.backgroundColor);}
  }
 }
 // Every visible green channel must catch the sweep, including space glyphs
 // whose background color draws the signal, and both halves of portrait cells.
 for(const [index,cell] of baseline.entries()){
  if(!black(cell.backgroundColor))assert.ok(background.has(index),'unlit backdrop cell '+index);
  if(!cell.bold&&cell.text!==' '&&!black(cell.color))assert.ok(foreground.has(index),'unlit portrait or lettering cell '+index);
 }
 const row=Array.from({length:options.height},(_,y)=>y).find(y=>!black(at(baseline,0,y).backgroundColor)&&!black(at(baseline,options.width-1,y).backgroundColor));
 assert.notEqual(row,undefined);
 const green=hex=>parseInt(hex.slice(3,5),16);
 const peak=x=>{const values=frames.map(cells=>green(at(cells,x,row).backgroundColor));return values.indexOf(Math.max(...values));};
 assert.ok(peak(0)<peak(options.width-1),'the light must reach the left edge before the right edge');
});

test('ASCII scene retains the full footprint and captions without Unicode blocks',()=>{
 const runs=sceneRuns({...options,art:asciiPortrait(hood),wordmarkOptions:{variant:'large',ascii:true}},-1);
 const text=runs.map(run=>run.text).join(''),rows=text.split('\n');
 assert.match(text,/^[ -~\n]+$/);assert.equal(rows.length,options.height);
 assert.ok(rows.every(row=>row.length===options.width));
 assert.match(text,/YOUR WORK\. ONE TERMINAL\./);assert.match(text,/> What are we building\?/);
});
