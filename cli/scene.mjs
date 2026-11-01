import {portraitCells} from './art.mjs';
import {wordmarkRuns} from './retro.mjs';
import {palette,detailPalette} from './assets/hacker-glitch.mjs';
import {shimmerLighting,shimmerIndex} from './animation.mjs';

const background=palette[0];
const noise=n=>{n=Math.imul(n^0x45d9f3b,0x45d9f3b);return (n^(n>>>16))>>>0;};
// Retain only the current viewport and one animation cycle, even during resize.
let current;
const blank=color=>({text:' ',color:background,backgroundColor:color});
function build(options){
 const {width,height,art,portraitX,portraitY,wordmarkX,wordmarkY,wordmarkOptions,caption,captionY}=options;
 const artHeight=art.split('\n').length;
 const signalBottom=caption?Math.min(height-1,captionY-1):height-1;
 const cells=Array.from({length:width*height},(_,index)=>{
  const x=index%width,y=Math.floor(index/width),row=y-portraitY;
  const within=y>=Math.max(1,portraitY+Math.floor(artHeight*.08))&&y<signalBottom;
  if(!within)return blank(background);
  // Long signal bands, staggered dropouts and subtle cell grain; no random frames.
  const band=noise(row+71),gapStart=band%width,gapWidth=3+(band%Math.max(4,Math.floor(width/4)));
  const dropout=(x>=gapStart&&x<gapStart+gapWidth)||band%11===0;
  const shade=dropout?0:21+noise(row*13)%4;
  const color=detailPalette[shade];
  // Half-row dropouts echo the source's thin horizontal scan fragments.
  const cutStart=noise(row+19)%Math.max(1,Math.floor(width*.65));
  const cut=row%3===1&&x>=cutStart&&x<cutStart+width*.55;
  return cut&&!dropout?{text:wordmarkOptions.ascii?'=':'▀',color,backgroundColor:background}:blank(color);
 });
 const set=(x,y,cell)=>{if(x>=0&&x<width&&y>=0&&y<height)cells[y*width+x]=cell;};
 const mark=[];let x=wordmarkX,y=wordmarkY;
 for(const run of wordmarkRuns(wordmarkOptions))for(const text of run.text){
  if(text==='\n'){x=wordmarkX;y++;continue;}
  if(text!==' ')mark.push({x,y,cell:{text,color:run.color,backgroundColor:background}});
  x++;
 }
 // A dark contour keeps the lime lettering readable within the shared signal.
 for(const {x,y} of mark)for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)set(x+dx,y+dy,blank(background));
 for(const item of mark)set(item.x,item.y,item.cell);
 if(caption){
  for(const [offset,line] of caption.entries())for(const [index,text] of [...line].entries())set(wordmarkX+index,captionY+offset,{text,color:offset?'#DAA85A':'#C5F7D4',backgroundColor:background,bold:true,steady:true});
 }
 x=portraitX;y=portraitY;
 for(const cell of portraitCells(art)){
  if(cell.text==='\n'){x=portraitX;y++;continue;}
  if(!cell.backdrop)set(x,y,cell);x++;
 }
 return {cells,frames:new Map()};
}
export function sceneRuns(options,frame=-1){
 const key=JSON.stringify(options);
 if(current?.key!==key)current={key,...build(options)};
 frame=shimmerIndex(frame);
 if(current.frames.has(frame))return current.frames.get(frame);
 const light=shimmerLighting(options.width,options.height,frame);
 const runs=[];
 const append=cell=>{const last=runs.at(-1);if(last?.color===cell.color&&last?.backgroundColor===cell.backgroundColor&&last?.bold===cell.bold)last.text+=cell.text;else runs.push({...cell});};
 for(let y=0;y<options.height;y++){
  for(let x=0;x<options.width;x++)append(light(current.cells[y*options.width+x],x,y));
  if(y<options.height-1)append({text:'\n',color:background,backgroundColor:background});
 }
 current.frames.set(frame,runs);return runs;
}
