import {detailPalette as palette,portraits} from './assets/hacker-glitch.mjs';

// Each character encodes a 2x2 sample using two colors and a quadrant glyph.
// Color and ASCII forms share the same bounds, preserving the responsive layout.
const cellsByText=new Map(),asciiByText=new Map();
const quadrants=' ▘▝▀▖▌▞▛▗▚▐▜▄▙▟█';
function compilePortrait({width,height,rows,backdrop}){
 const cells=[],asciiCells=[],ramp=' .:=+*#@';let text='',ascii='';
 for(let y=0;y<height;y++){
  for(let x=0;x<width;x++){
   const offset=x*3,mask=parseInt(rows[y][offset],16),foreground=parseInt(rows[y][offset+1],36),background=parseInt(rows[y][offset+2],36);
   const solid=mask===0||foreground===background;
   const char=solid?(background===0?' ':'█'):quadrants[mask];
   const cell={text:char,color:palette[solid?background:foreground],backgroundColor:palette[solid?0:background],backdrop:char===' '&&backdrop[y][x]==='1'};
   const coverage=[0,1,2,3].reduce((sum,bit)=>sum+((mask>>bit)&1),0)/4;
   const level=Math.round((foreground*coverage+background*(1-coverage))/(palette.length-1)*(ramp.length-1));
   const asciiCell={text:ramp[level],color:palette[mask===0?background:Math.max(foreground,background)],backgroundColor:palette[0],backdrop:cell.backdrop};
   cells.push(cell);asciiCells.push(asciiCell);text+=char;ascii+=asciiCell.text;
  }
  if(y<height-1){
   const newline={text:'\n',color:palette[0],backgroundColor:palette[0]};
   cells.push(newline);asciiCells.push(newline);text+='\n';ascii+='\n';
  }
 }
 cellsByText.set(text,cells);cellsByText.set(ascii,asciiCells);asciiByText.set(text,ascii);
 return text;
}
const compiled=Object.fromEntries(Object.entries(portraits).map(([name,data])=>[name,compilePortrait(data)]));
export const hood=compiled.large;
export const compactHood=compiled.compact;
export const smallHood=compiled.small;
export const microHood=compiled.micro;
export function portraitForLayout({variant,heroHeight}){
 if(variant==='large')return heroHeight>=29?compiled.large:compiled.largeShort;
 if(variant==='balanced')return compiled.balanced;
 if(variant==='compact')return compiled.compactTall;
 if(variant==='small')return smallHood;
 if(variant==='micro')return microHood;
 return compactHood;
}
export const asciiPortrait=art=>asciiByText.get(art)??art;
export const portraitCells=art=>cellsByText.get(art);
