// Fixed pixel lettering: solid green faces, an offset outline and scan fragments.
// The finite set of sizes is cached; this artwork has no timers or random frames.
import {palette as portraitPalette} from './assets/hacker-glitch.mjs';
const titleGlyphs = {
 T: ['1111111','1111111','0011100','0011100','0011100','0011100','0011100'],
 I: ['1111111','1111111','0011100','0011100','0011100','1111111','1111111'],
 M: ['1100011','1110111','1111111','1101011','1100011','1100011','1100011'],
};
const subtitleGlyphs = {
 S: ['11111','11000','11000','11111','00011','00011','11111'],
 T: ['11111','11111','00100','00100','00100','00100','00100'],
 U: ['11011','11011','11011','11011','11011','11011','11111'],
 D: ['11110','11011','11011','11011','11011','11011','11110'],
 I: ['11111','00100','00100','00100','00100','00100','11111'],
 O: ['01110','11011','11011','11011','11011','11011','01110'],
};
const tinyGlyphs = {
 T: ['111','010','010'], I: ['111','010','111'], M: ['101','111','101'],
 S: ['011','010','110'], U: ['101','101','111'], D: ['110','101','110'], O: ['111','101','111'],
};
const palette = {face:portraitPalette[6],edge:portraitPalette[4],highlight:portraitPalette[7],shadow:portraitPalette[5]};
const sizes = {
 large: {width:77,titleScale:3,titleRows:[0,0,1,1,2,2,3,3,4,4,5,5,6,6],gap:3,subScale:2,subRows:[0,1,2,3,3,4,5,6]},
 compact: {width:48,titleScale:2,titleRows:[0,0,1,2,3,3,4,5,5,6],gap:2,subScale:1,subRows:[0,1,2,3,5,6]},
 narrow: {width:26,titleScale:1,titleRows:[0,1,2,3,4,5,6],gap:1,subScale:1,subRows:[0,1,2],tinySubtitle:true},
 short: {width:26,titleScale:2,titleRows:[0,1,2],gap:2,tinyTitle:true},
};
function pixels(word,glyphs,scale,rows,gap){
 return rows.map(y=>[...word].map(letter=>[...glyphs[letter][y]].map(bit=>bit.repeat(scale)).join('')).join('0'.repeat(gap)));
}
function block(mask,width,{ascii,glitch=false}={}){
 const offset=Math.floor((width-mask[0].length-1)/2);
 const cells=Array.from({length:mask.length+1},()=>Array.from({length:width},()=>({text:' ',color:palette.face})));
 const filled=(x,y)=>mask[y]?.[x]==='1';
 // Place an offset outline behind the solid letter faces.
 for(let y=0;y<mask.length;y++)for(let x=0;x<mask[y].length;x++)if(filled(x,y)){
  const horizontal=!filled(x,y-1)||!filled(x,y+1),vertical=!filled(x-1,y)||!filled(x+1,y);
  if(horizontal||vertical)cells[y+1][offset+x+1]={text:horizontal&&vertical?(ascii?'+':'└'):horizontal?(ascii?'-':'─'):(ascii?'|':'│'),color:palette.edge};
 }
 for(let y=0;y<mask.length;y++)for(let x=0;x<mask[y].length;x++)if(filled(x,y))cells[y][offset+x]={text:ascii?'#':'█',color:palette.face};
 if(glitch){
  const right=offset+mask[0].length;
  const stripe=(y,start,end,color)=>{for(let x=Math.max(0,start);x<Math.min(width,end);x++)cells[y][x]={text:ascii?'=':'▀',color};};
  stripe(1,right-3,width-1,palette.highlight);
  stripe(Math.min(3,mask.length-1),right-7,right-1,palette.shadow);
  stripe(Math.min(4,mask.length-1),right-4,width,palette.highlight);
 }
 return cells;
}
const cache = new Map();
function wordmark({large=false,variant=large?'large':'compact',ascii=process.env.TIM_ASCII==='1'}={}){
 const key=variant+':'+Boolean(ascii);if(cache.has(key))return cache.get(key);
 const size=sizes[variant];if(!size)throw new Error('Unknown wordmark size: '+variant);
 const rows=block(pixels('TIM',size.tinyTitle?tinyGlyphs:titleGlyphs,size.titleScale,size.titleRows,size.gap),size.width,{ascii,glitch:variant!=='short'});
 const blank=()=>Array.from({length:size.width},()=>({text:' ',color:palette.face}));
 if(variant==='short'){
  const line=blank(),label='S T U D I O',left=Math.floor((size.width-label.length)/2);
  [...label].forEach((text,i)=>{line[left+i]={text,color:palette.face};});rows.push(line);
 }else{
  rows.push(blank());
  rows.push(...block(pixels('STUDIO',size.tinySubtitle?tinyGlyphs:subtitleGlyphs,size.subScale,size.subRows,size.subScale),size.width,{ascii}));
 }
 const runs=[];
 for(const [y,row] of rows.entries())for(const cell of [...row,...(y<rows.length-1?[{text:'\n',color:palette.face}]:[])]){
  const last=runs.at(-1);if(last?.color===cell.color)last.text+=cell.text;else runs.push({...cell});
 }
 const result={text:runs.map(run=>run.text).join(''),runs};cache.set(key,result);return result;
}
export const retroWordmark=options=>wordmark(options).text;
export const wordmarkRuns=options=>wordmark(options).runs;
