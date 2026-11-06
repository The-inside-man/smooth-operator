// Standard paging keys and compact-keyboard alternatives. Paste remains text.
export function scrollAction(input,key={}){
 if(key.paste||key.eventType==='release')return null;
 if(key.wheel==='up')return 'wheel-up';
 if(key.wheel==='down')return 'wheel-down';
 if(key.ctrl&&!key.meta&&!key.super){
  if(input==='p')return 'up';
  if(input==='n')return 'down';
  if(input==='l')return 'latest';
 }
 if(key.pageUp||key.meta&&!key.ctrl&&!key.shift&&key.upArrow)return 'up';
 if(key.pageDown||key.meta&&!key.ctrl&&!key.shift&&key.downArrow)return 'down';
 return null;
}

export const pageSize=visible=>Math.max(1,Math.floor(Number.isFinite(visible)?visible:1)-1);
// Wheel reports represent terminal scroll ticks, not native pixel deltas.
export const scrollStep=(action,visible)=>action==='wheel-up'?-3:action==='wheel-down'?3:action==='up'?-pageSize(visible):action==='down'?pageSize(visible):0;

// A null position follows new output; a numeric position anchors review to the
// same top line while new text is appended below it.
export function scrollWindow(total,visible,position=null){
 total=Math.max(0,Math.floor(Number.isFinite(total)?total:0));
 visible=Math.max(1,Math.floor(Number.isFinite(visible)?visible:1));
 const maximum=Math.max(0,total-visible);
 const start=position===null?maximum:Math.max(0,Math.min(maximum,Math.floor(Number.isFinite(position)?position:0)));
 return {start,end:Math.min(total,start+visible),maximum,total,visible,following:position===null};
}

export function pagePosition(position,action,total,visible){
 const view=scrollWindow(total,visible,position);
 if(action==='latest')return null;
 const step=scrollStep(action,visible);
 if(step<0)return Math.max(0,view.start+step);
 if(step>0){
  const next=Math.min(view.maximum,view.start+step);
  return next>=view.maximum?null:next;
 }
 return position;
}
