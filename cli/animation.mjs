import {useEffect,useState} from 'react';
export const SHIMMER_FRAMES=32,SHIMMER_INTERVAL=160;
// Fixed printable cells: animation is a broad, low-contrast light sweep, never glyph noise.
export const shimmerFrame=art=>art;
const blend=(base,target,amount)=>'#'+base.match(/../g).map((v,i)=>Math.round(parseInt(v,16)+(parseInt(target.slice(i*2,i*2+2),16)-parseInt(v,16))*amount).toString(16).padStart(2,'0')).join('');
export function shimmerRuns(art,frame=-1){
 const width=Math.max(...art.split('\n').map(l=>l.length)),rows=art.split('\n').length;
 const phase=((frame%SHIMMER_FRAMES)+SHIMMER_FRAMES)%SHIMMER_FRAMES/SHIMMER_FRAMES;
 const center=-20+phase*(width+rows*.45+40),runs=[];let x=0,y=0;
 for(const char of art){const base=/[.:;]/.test(char)?'78CCA0':/[#=]/.test(char)?'C5F7D4':'8EE8AA';
 const distance=Math.abs(x+y*.45-center),strength=frame<0||/\s/.test(char)?0:Math.max(0,1-distance/12)**2*.34;
 const color=blend(base,'E0FFE9',strength);const previous=runs.at(-1);
 if(previous?.color===color)previous.text+=char;else runs.push({text:char,color});
 if(char==='\n'){x=0;y++;}else x++;
 }return runs;
}
export function startShimmer(onFrame,{setInterval:set=globalThis.setInterval,clearInterval:clear=globalThis.clearInterval}={}){
 let frame=0;const timer=set(()=>onFrame(frame=(frame+1)%SHIMMER_FRAMES),SHIMMER_INTERVAL);return()=>clear(timer);
}
export function useShimmer(enabled){const [frame,setFrame]=useState(0);useEffect(()=>{if(!enabled){setFrame(0);return;}return startShimmer(setFrame);},[enabled]);return frame;}
export const reducedMotion=()=>process.env.TIM_REDUCED_MOTION==='1'||process.env.TIM_NO_ANIMATION==='1'||Object.hasOwn(process.env,'NO_COLOR');
