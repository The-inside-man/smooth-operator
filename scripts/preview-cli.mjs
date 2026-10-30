import fs from 'node:fs/promises';
delete process.env.NO_COLOR; process.env.FORCE_COLOR='3';
const [{default:React},{renderToString},{App},{demoState,clean},{chromium}]=await Promise.all([import('react'),import('ink'),import('../cli/app.mjs'),import('../cli/core.mjs'),import('playwright')]);
const output=renderToString(React.createElement(App,{demo:true,initial:demoState,staticPreview:true,dimensions:{w:160,h:52}}),{columns:160});
if(!/\x1b\[38;2;/.test(output))throw new Error('Truecolor ANSI output is missing from the preview');
await fs.mkdir('artifacts',{recursive:true});await fs.writeFile('artifacts/tim-terminal-frame.ansi',output);await fs.writeFile('artifacts/tim-terminal-frame.txt',clean(output));
const escape=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
let foreground='#C5F7D4',background='#080D0B',bold=false,html='',index=0;
const append=s=>{if(s)html+=`<span style="color:${foreground};background:${background};font-weight:${bold?'bold':'normal'}">${escape(s)}</span>`;};
for(const match of output.matchAll(/\x1b\[([0-9;]*)m/g)){
 append(output.slice(index,match.index));index=match.index+match[0].length;
 const codes=match[1].split(';').map(Number);
 for(let i=0;i<codes.length;i++){
  if(codes[i]===0){foreground='#C5F7D4';background='#080D0B';bold=false;}
  else if(codes[i]===39)foreground='#C5F7D4';else if(codes[i]===49)background='#080D0B';
  else if(codes[i]===1)bold=true;else if(codes[i]===22)bold=false;
  else if((codes[i]===38||codes[i]===48)&&codes[i+1]===2){const color=`rgb(${codes[i+2]},${codes[i+3]},${codes[i+4]})`;if(codes[i]===38)foreground=color;else background=color;i+=4;}
 }
}
append(output.slice(index));
const browser=await chromium.launch({headless:true,channel:'msedge'});
try{const page=await browser.newPage({viewport:{width:1800,height:1150},deviceScaleFactor:1});await page.setContent(`<html><body style="margin:0;background:#080D0B;color:#C5F7D4;padding:28px"><pre style="font:18px/21px 'Consolas',monospace;margin:0">${html}</pre><div style="font:12px monospace;color:#758D80;margin-top:14px">ACTUAL INK COMPONENT RENDER / SAMPLE DATA / browser rasterization, not a native terminal capture</div></body></html>`);await page.screenshot({path:'artifacts/tim-terminal-preview.png'});}finally{await browser.close();}
