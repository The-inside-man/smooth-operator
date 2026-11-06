import {useEffect,useState} from 'react';
import {portraitCells} from './art.mjs';
export const SHIMMER_FRAMES=32,SHIMMER_INTERVAL=160;
// Fixed printable cells: animation is a broad, low-contrast light sweep, never glyph noise.
export const shimmerFrame=art=>art;
const blend=(base,target,amount)=>'#'+base.match(/../g).map((v,i)=>Math.round(parseInt(v,16)+(parseInt(target.slice(i*2,i*2+2),16)-parseInt(v,16))*amount).toString(16).padStart(2,'0')).join('');
export const shimmerIndex=frame=>Number.isFinite(frame)&&frame>=0?Math.trunc(frame)%SHIMMER_FRAMES:-1;
export function shimmerLighting(width,height,frame){
 frame=shimmerIndex(frame);
 const radius=Math.max(12,width*.14);
 const center=-radius+frame/(SHIMMER_FRAMES-1)*(width-1+(height-1)*.45+radius*2);
 return (cell,x,y)=>{
  if(frame<0||cell.steady)return cell;
  const strength=Math.max(0,1-Math.abs(x+y*.45-center)/radius)**2*.24;
  if(!strength)return cell;
  const tint=color=>!color||color.toLowerCase()==='#080d0b'?color:blend(color.slice(1),'DBFF85',strength);
  // Background colors carry half of each portrait cell and the signal plate.
  // Keep black cutouts dark, including the hidden face and letter contours.
  return {...cell,color:tint(cell.color),backgroundColor:tint(cell.backgroundColor)};
 };
}
// Only the known portrait sizes/fallbacks and 33 frame states enter this cache.
const frameCache=new Map();
export function shimmerRuns(art,frame=-1){
 const cells=portraitCells(art),boundedFrame=shimmerIndex(frame);
 const cacheKey=cells?art+'|'+boundedFrame:null;
 if(cacheKey&&frameCache.has(cacheKey))return frameCache.get(cacheKey);
 frame=boundedFrame;
 const width=Math.max(...art.split('\n').map(l=>l.length)),rows=art.split('\n').length;
 const light=shimmerLighting(width,rows,frame),runs=[];let x=0,y=0;
 let index=0;
 for(const char of art){const cell=cells?.[index++]??{color:/[.:;░]/.test(char)?'#5A8B28':/[#=█▀▄▓]/.test(char)?'#A5D536':'#8EA92F'};
 const {color,backgroundColor}=light(cell,x,y),previous=runs.at(-1);
 if(previous?.color===color&&previous.backgroundColor===backgroundColor)previous.text+=char;else runs.push({text:char,color,...(backgroundColor?{backgroundColor}:{})});
 if(char==='\n'){x=0;y++;}else x++;
 }if(cacheKey)frameCache.set(cacheKey,runs);return runs;
}
export function startShimmer(onFrame,{setInterval:set=globalThis.setInterval,clearInterval:clear=globalThis.clearInterval}={}){
 let frame=0;const timer=set(()=>onFrame(frame=(frame+1)%SHIMMER_FRAMES),SHIMMER_INTERVAL);return()=>clear(timer);
}
export function useShimmer(enabled){const [frame,setFrame]=useState(0);useEffect(()=>{if(!enabled){setFrame(0);return;}return startShimmer(setFrame);},[enabled]);return frame;}
export const reducedMotion=()=>process.env.TIM_REDUCED_MOTION==='1'||process.env.TIM_NO_ANIMATION==='1'||Object.hasOwn(process.env,'NO_COLOR');
