import stringWidth from 'string-width';
const segmenter=new Intl.Segmenter(undefined,{granularity:'grapheme'});
export const cellWidth=value=>stringWidth(value);
export function wrapCells(value,width,cursor=value.length){
 width=Math.max(1,width);const lines=[''];let row=0,col=0,cursorRow=0,cursorCol=0;
 for(const {segment,index} of segmenter.segment(value)){
  if(segment==='\n'){if(index===cursor){cursorRow=row;cursorCol=col;}lines.push('');row++;col=0;if(index<cursor){cursorRow=row;cursorCol=0;}continue;}
  const cells=cellWidth(segment);if(col+cells>width){lines.push('');row++;col=0;}
  if(index<=cursor){cursorRow=row;cursorCol=col;}
  lines[row]+=segment;col+=cells;
  if(index+segment.length<=cursor){cursorRow=row;cursorCol=col;}
 }
 if(cursor===value.length&&col>=width){lines.push('');cursorRow=++row;cursorCol=0;}
 return {lines,cursorRow,cursorCol};
}
export function layout(w,h,home,active,inputRows=1){
 const wide=w>=100,composerHeight=3+inputRows;
 let headerHeight=wide?4:3,available=h-1-headerHeight-composerHeight-2,variant='none',heroHeight=0,panelHeight=Math.max(3,available),showHeroCopy=true;
 if(home&&!active&&wide){
  if(w>=154&&available>=38){variant='large';heroHeight=31;panelHeight=available-heroHeight;}
  else if(w>=154&&available>=26){variant='large';showHeroCopy=available>=29;heroHeight=showHeroCopy?29:26;panelHeight=0;}
  else if(w>=125&&available>=29){variant='balanced';heroHeight=25;panelHeight=available-heroHeight;}
  else if(available>=26){variant='compact';heroHeight=22;panelHeight=available-heroHeight;}
  else{
   headerHeight=h>=30?3:1;available=h-1-headerHeight-composerHeight-2;
   if(available>=19){variant='compact';showHeroCopy=available>=22;heroHeight=showHeroCopy?22:19;panelHeight=0;}
   else if(available>=15){variant='narrow';showHeroCopy=available>=16;heroHeight=showHeroCopy?16:15;panelHeight=0;}
   else{headerHeight=wide?4:3;available=h-1-headerHeight-composerHeight-2;panelHeight=Math.max(3,available);}
  }
 }
 if(home&&!active&&w>=80&&variant==='none'){
  headerHeight=1;available=h-1-headerHeight-composerHeight-2;
  if(w<100&&available>=35){variant='stacked';showHeroCopy=available>=38;heroHeight=showHeroCopy?38:35;panelHeight=available-heroHeight>=5?available-heroHeight:0;}
  else if(available>=15){variant='narrow';showHeroCopy=available>=16;heroHeight=showHeroCopy?16:15;panelHeight=available>=21?available-heroHeight:0;}
  else {variant=available>=9?'small':'micro';heroHeight=variant==='small'?9:5;showHeroCopy=false;panelHeight=0;}
 }
 return {wide,variant,hero:variant!=='none',large:variant==='large',headerHeight,heroHeight,composerHeight,panelHeight,showHeroCopy,heroSpare:variant!=='none'&&panelHeight===0?Math.max(0,available-heroHeight):0};
}
export const smallHood=String.raw`       .:===:.
     .//#####\.
    //##:   :##\
   |##:       :##|
   |#|         |#|
    \#:       :#/
   .:/##:.__.:##\:.
 .//###/\####/\###\.
:####::..\##/..::####:`;
export const smallLogo=" ________  ______  __    __\n|__    __||__  __||  \\/  |\n   || ||     ||   ||\\/|| |\n   || ||   __||__ ||   || |\n  _|| ||_ |      |||   || |\n |_______||______||____||_|\n  -------  ------ ---- --\n      _           _ _\n ____| |_ _   _ _| (_) ___\n/ ___| __| | | / _  |/ _ \\\n\\__ \\ |_| |_| |(_| | (_) |\n|___/\\__|\\___/\\____|\\___/\n ---  --   ---  ----  ---";

export const microHood=String.raw`     .:===:.
   .//:   :\.
   |#:     :#|
    \:.   .:/
 .:###/\_ /\###:.`;

export const shortLogo=" ________  ______  __    __\n|__    __||__  __||  \\  /  |\n   |  |    __| |__| |\\/| |\n   |__|   |______||_|  |_|\n          s t u d i o";
