import test from 'node:test';
import assert from 'node:assert/strict';
import {createMouseInput,mouseEnable,mouseDisable} from '../cli/mouse.mjs';
import {parseArgs} from '../cli/arguments.mjs';
import {scrollAction,scrollStep,pagePosition} from '../cli/scroll.mjs';

test('SGR mouse input recognizes vertical wheel reports and consumes other mouse events',()=>{
 const mouse=createMouseInput();
 for(const modifiers of [0,4,8,16,28]){
  assert.equal(mouse.read(`\x1b[<${64+modifiers};1000;600M`).wheel,'up');
  assert.equal(mouse.read(`\x1b[<${65+modifiers};12;4M`).wheel,'down');
 }
 for(const report of ['\x1b[<64;12;4m','\x1b[<0;12;4M','\x1b[<3;12;4m','\x1b[<32;12;4M','\x1b[<66;12;4M','\x1b[<67;12;4M','\x1b[<96;12;4M','\x1b[<128;12;4M','\x1b[<4294967360;12;4M','\x1b[<64;0;4M'])assert.equal(mouse.read(report).wheel,null,JSON.stringify(report));
 assert.equal(mouse.read('ordinary text'),null);assert.equal(mouse.read('\x1b[A'),null);
});

test('mouse reports reassemble after the Ink CSI timeout and preserve unrelated text',()=>{
 const mouse=createMouseInput();
 assert.deepEqual(mouse.read('\x1b[<64;'),{wheel:null});
 assert.deepEqual(mouse.read('1000;'),{wheel:null});
 assert.deepEqual(mouse.read('400Mafter'),{wheel:'up',text:'after'});
 assert.deepEqual(mouse.read('\x1b['),{wheel:null});
 assert.deepEqual(mouse.read('<65;10;4M'),{wheel:'down',text:''});
 mouse.read('\x1b[<65;');assert.equal(mouse.read('unrelated'),null);
 mouse.read('\x1b[<64;');mouse.reset();assert.equal(mouse.read('3;3M'),null);
 assert.deepEqual(mouse.read('\x1b[<invalid'),{wheel:null});
 mouse.read('\x1b[<');assert.equal(mouse.read('1'.repeat(100)),null);
});

test('legacy X10 fallback consumes exactly three payload characters across input events',()=>{
 const mouse=createMouseInput();
 assert.deepEqual(mouse.read('\x1b[M'),{wheel:null});
 assert.deepEqual(mouse.read('`'),{wheel:null});
 assert.deepEqual(mouse.read('!'),{wheel:null});
 assert.deepEqual(mouse.read('!after'),{wheel:'up',text:'after'});
 mouse.read('\x1b[M');assert.deepEqual(mouse.read('a!!'),{wheel:'down',text:''});
 mouse.read('\x1b[M');assert.deepEqual(mouse.read(' !!'),{wheel:null,text:''});
 mouse.read('\x1b[M');mouse.reset();assert.equal(mouse.read('ordinary text'),null);
 for(const cancel of ['\x1b','\x11','\x03']){mouse.read('\x1b[M');assert.equal(mouse.read(cancel),null);}
});

test('wheel steps are gradual, bounded and share the anchored output window',()=>{
 assert.equal(scrollAction('',{wheel:'up'}),'wheel-up');assert.equal(scrollAction('',{wheel:'down'}),'wheel-down');
 assert.equal(scrollAction('',{wheel:'up',paste:true}),null);
 assert.equal(scrollStep('wheel-up',40),-3);assert.equal(scrollStep('wheel-down',40),3);
 assert.equal(scrollStep('up',40),-39);assert.equal(scrollStep('latest',40),0);
 assert.equal(pagePosition(null,'wheel-up',100,10),87);
 assert.equal(pagePosition(87,'wheel-up',120,10),84);
 assert.equal(pagePosition(0,'wheel-up',100,10),0);
 assert.equal(pagePosition(87,'wheel-down',100,10),null);
 assert.equal(pagePosition(null,'wheel-down',0,10),null);
});

test('mouse reporting has an explicit opt-out and requests no pointer motion',()=>{
 assert.equal(parseArgs(['--no-mouse']).options['no-mouse'],true);
 assert.equal(mouseEnable,'\x1b[?1006h\x1b[?1000h');
 assert.equal(mouseDisable,'\x1b[?1000l\x1b[?1006l');
});
