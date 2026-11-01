// Compile the approved PNG into portable terminal cells. The CLI only imports
// the generated data: it needs no image decoder, browser, or graphics protocol.
import fs from 'node:fs/promises';
import {chromium} from 'playwright';

const source = new URL('../cli/assets/hacker-glitch.png', import.meta.url);
const destination = new URL('../cli/assets/hacker-glitch.mjs', import.meta.url);
const palette = ['#080D0B','#142713','#23441A','#345E20','#4C7E29','#6CA332','#94CD3D','#B2EE4F'];
// Keep the shared wordmark colors stable; add intermediate portrait shades.
const detailPalette=palette.flatMap((color,i)=>i===palette.length-1?[color]:Array.from({length:4},(_,step)=>'#'+[1,3,5].map(channel=>{
 const a=parseInt(color.slice(channel,channel+2),16),b=parseInt(palette[i+1].slice(channel,channel+2),16);
 return Math.round(a+(b-a)*step/4).toString(16).padStart(2,'0');
}).join('')));
const sizes = {large:[69,29],largeShort:[69,26],balanced:[69,23],compactTall:[44,19],compact:[44,15],small:[21,9],micro:[16,5]};
const browser = await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
try {
 const page = await browser.newPage();
 const image = 'data:image/png;base64,' + (await fs.readFile(source)).toString('base64');
 const portraits = await page.evaluate(async ({image,palette,sizes}) => {
  const bitmap = new Image();bitmap.src=image;await bitmap.decode();
  const rgb=palette.map(hex=>[1,3,5].map(index=>parseInt(hex.slice(index,index+2),16)));
  const error=(a,b)=>(a[0]-b[0])**2+2*(a[1]-b[1])**2+(a[2]-b[2])**2;
  const nearest=color=>rgb.reduce((best,candidate,i)=>error(color,candidate)<error(color,rgb[best])?i:best,0);
  // Fit each four-sample cell to two colors and a standard Unicode quadrant.
  // All two-group partitions are considered, including a single-color cell.
  function encode(samples){
   let best,errorBest=Infinity;
   for(let mask=0;mask<8;mask++){
    const groups=[[],[]];samples.forEach((sample,i)=>groups[(mask>>i)&1].push(sample));
    const indices=groups.map(group=>group.length?nearest([0,1,2].map(channel=>group.reduce((sum,sample)=>sum+sample[channel],0)/group.length)):0);
    const score=samples.reduce((sum,sample,i)=>sum+error(sample,rgb[indices[(mask>>i)&1]]),0);
    if(score<errorBest){errorBest=score;best=mask.toString(16)+indices[1].toString(36)+indices[0].toString(36);}
   }
   return best;
  }
  // Fit the visible artwork rather than wasting terminal cells on its margins.
  const original=document.createElement('canvas');original.width=bitmap.width;original.height=bitmap.height;
  const originalContext=original.getContext('2d');originalContext.drawImage(bitmap,0,0);
  const source=originalContext.getImageData(0,0,bitmap.width,bitmap.height).data;
  let left=bitmap.width,top=bitmap.height,right=0,bottom=0;
  for(let y=0;y<bitmap.height;y++)for(let x=0;x<bitmap.width;x++){
   const offset=(y*bitmap.width+x)*4;
   if(source[offset+1]>30&&source[offset+1]-source[offset]>7){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
  }
  const padding=Math.ceil(Math.min(bitmap.width,bitmap.height)*.01);
  left=Math.max(0,left-padding);top=Math.max(0,top-padding);right=Math.min(bitmap.width,right+padding+1);bottom=Math.min(bitmap.height,bottom+padding+1);
  const sourceWidth=right-left,sourceHeight=bottom-top;
  // Conservative outline of the approved figure in normalized source space.
  // Its open, dark cloth folds must never become holes in the extended backdrop.
  const silhouette=[[.44,.085],[.58,.13],[.68,.25],[.78,.39],[.76,.48],[.70,.58],[.65,.65],[.70,.73],[.79,.92],[.76,.96],[.23,.96],[.08,.85],[0,.78],[0,.65],[.14,.54],[.21,.51],[.20,.43],[.23,.31],[.30,.18],[.38,.11]];
  function protectedFigure(x,y){let inside=false;for(let i=0,j=silhouette.length-1;i<silhouette.length;j=i++){
   const [xi,yi]=silhouette[i],[xj,yj]=silhouette[j];if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)inside=!inside;
  }return inside;}
  const result={};
  for(const [name,[width,height]] of Object.entries(sizes)){
   // Two horizontal samples per column retain finer edges at the same footprint.
   // Terminal cells are roughly twice as tall as wide; compensate when fitting.
   const canvas=document.createElement('canvas');canvas.width=width*2;canvas.height=height*2;
   const context=canvas.getContext('2d');context.fillStyle=palette[0];context.fillRect(0,0,width*2,height*2);
   const scale=Math.min(width/sourceWidth,height*2/sourceHeight),w=Math.round(sourceWidth*scale),h=Math.round(sourceHeight*scale);
   context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';
   context.drawImage(bitmap,left,top,sourceWidth,sourceHeight,Math.floor((width-w)/2)*2,Math.floor((height*2-h)/2),w*2,h);
   const {data}=context.getImageData(0,0,width*2,height*2),rows=[],backdrop=[];
   // Only edge-connected black is transparent. The enclosed face stays opaque.
   const outside=new Uint8Array(width*2*height*2),queue=[];
   const visit=(x,y)=>{if(x<0||x>=width*2||y<0||y>=height*2)return;const index=y*width*2+x;
    if(outside[index]||data[index*4+1]>18)return;outside[index]=1;queue.push(index);};
   for(let x=0;x<width*2;x++){visit(x,0);visit(x,height*2-1);}
   for(let y=0;y<height*2;y++){visit(0,y);visit(width*2-1,y);}
   for(let i=0;i<queue.length;i++){const x=queue[i]%(width*2),y=Math.floor(queue[i]/(width*2));visit(x-1,y);visit(x+1,y);visit(x,y-1);visit(x,y+1);}
   for(let y=0;y<height;y++){
    let row='',clear='';
    for(let x=0;x<width;x++){
     const samples=[[0,0],[1,0],[0,1],[1,1]].map(([dx,dy])=>{
      const offset=((y*2+dy)*width*2+x*2+dx)*4;
      return [data[offset],data[offset+1],data[offset+2]];
     });
     row+=encode(samples);
     const sourceX=(left+(x-Math.floor((width-w)/2)+.5)/w*sourceWidth)/bitmap.width;
     const sourceY=(top+(y*2-Math.floor((height*2-h)/2)+1)/h*sourceHeight)/bitmap.height;
     clear+=!protectedFigure(sourceX,sourceY)&&[[0,0],[1,0],[0,1],[1,1]].every(([dx,dy])=>outside[(y*2+dy)*width*2+x*2+dx])?'1':'0';
    }
    rows.push(row);
    backdrop.push(clear);
   }
   result[name]={width,height,rows,backdrop};
  }
  return result;
 },{image,palette:detailPalette,sizes});
 const data='// Generated from hacker-glitch.png by scripts/build-terminal-art.mjs.\n'+
  'export const palette = '+JSON.stringify(palette)+';\n'+
  'export const detailPalette = '+JSON.stringify(detailPalette)+';\n'+
  'export const portraits = '+JSON.stringify(portraits,null,2)+';\n';
 await fs.writeFile(destination,data);
 console.log('Compiled approved hacker artwork for '+Object.keys(portraits).join(', ')+' terminals.');
} finally { await browser.close(); }
