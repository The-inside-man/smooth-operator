// Request button/wheel reports with SGR coordinates, without pointer motion.
export const mouseEnable='\x1b[?1006h\x1b[?1000h';
export const mouseDisable='\x1b[?1000l\x1b[?1006l';

function wheel(button,release=false){
 // Only vertical wheel buttons (64/65), including Shift/Alt/Ctrl modifiers.
 // Motion, horizontal scrolling, extra buttons and releases do nothing.
 const base=button&~28;
 return !release&&Number.isSafeInteger(button)&&button>=0&&button<=255&&(base===64||base===65)?base===64?'up':'down':null;
}

// Ink already splits complete CSI sequences from text. Keep unfinished mouse
// reports across its escape timeout, and handle older X10-only terminals too.
// A handled report must never reach an editor or an approval shortcut.
export function createMouseInput(){
 let pending='',legacy=null;
 const reset=()=>{pending='';legacy=null;};
 const read=value=>{
  if(legacy!==null){
   const needed=3-legacy.length,part=value.slice(0,needed);legacy+=part;
   if([...part].some(char=>char.charCodeAt(0)<32)){reset();return null;}
   if(legacy.length<3)return {wheel:null};
   const bytes=[...legacy].map(char=>char.charCodeAt(0));legacy=null;
   return {wheel:bytes.every(byte=>byte>=32&&byte<=255)?wheel(bytes[0]-32):null,text:value.slice(needed)};
  }
  const continuation=!!pending;
  if(!continuation&&!value.startsWith('\x1b[<')&&value!=='\x1b[M'&&value!=='\x1b[')return null;
  const sequence=pending+value;pending='';
  if(sequence==='\x1b[M'){legacy='';return {wheel:null};}
  if(sequence==='\x1b['){pending=sequence;return {wheel:null};}
  const match=/^\x1b\[<(\d+);(\d+);(\d+)([Mm])/.exec(sequence);
  if(match){
   const [,button,x,y,end]=match;
   return {wheel:Number(x)>0&&Number(y)>0?wheel(Number(button),end==='m'):null,text:sequence.slice(match[0].length)};
  }
  if(/^\x1b\[<[\d;]*$/.test(sequence)&&sequence.length<96){pending=sequence;return {wheel:null};}
  // Discard malformed mouse reports, but don't swallow an unrelated key that
  // arrives after an incomplete report.
  return continuation?null:{wheel:null};
 };
 return {read,reset};
}
