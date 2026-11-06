import './terminal-env.mjs';
// Exercise the real launcher in a synthetic TTY without a model or backend.
// Advance only the app's idle timers; React/Ink still mount and render normally.
import {setImmediate as turn, setTimeout as delay} from 'node:timers/promises';

process.env.TERM = 'xterm-256color';
process.env.COLORTERM = 'truecolor';
process.env.FORCE_COLOR = '3';
for (const name of ['CI', 'NO_COLOR', 'TIM_NO_ANIMATION', 'TIM_REDUCED_MOTION']) delete process.env[name];
Object.defineProperty(process.stdin, 'isTTY', {value: true});
Object.defineProperty(process.stdout, 'isTTY', {value: true});
process.stdout.columns = 160;
process.stdout.rows = 52;
process.stdin.setRawMode = () => process.stdin;
process.argv = [process.execPath, 'cli/index.mjs', '--demo'];

const write = process.stdout.write.bind(process.stdout);
let writes = 0, welcome = false, colored = false;
// Discard terminal output, so the test harness itself cannot retain frames.
process.stdout.write = (chunk, encoding, callback) => {
  const text = String(chunk);
  writes++;
  welcome ||= text.includes('COMMAND');
  colored ||= text.includes('\x1b[38;2;');
  (typeof encoding === 'function' ? encoding : callback)?.();
  return true;
};
const timers = new Map();
const originalSet = globalThis.setInterval, originalClear = globalThis.clearInterval;
globalThis.setInterval = (callback, ms, ...args) => {
  if (ms !== 160 && ms !== 1000) return originalSet(callback, ms, ...args);
  const id = {};
  timers.set(id, {ms, tick: () => callback(...args)});
  return id;
};
globalThis.clearInterval = id => { if (!timers.delete(id)) originalClear(id); };

const running = import('../cli/index.mjs');
// Attach a rejection handler immediately, before waiting for mount.
let startupError;
running.catch(error => { startupError = error; });
const samples = [], frames = Number(process.env.TIM_IDLE_TEST_FRAMES || 640);
try {
  for (let i = 0; i < 500 && timers.size < 2 && !startupError; i++) await delay(10);
  if (startupError) throw startupError;
  if (timers.size !== 2) throw new Error('Idle clock and animation did not mount');
  for (let frame = 1; frame <= frames; frame++) {
    for (const {ms, tick} of timers.values()) if (ms === 160 || frame % 6 === 0) tick();
    await turn();
    if (frame % 128 === 0) {
      global.gc();
      samples.push({frame, heap: process.memoryUsage().heapUsed, measures: performance.getEntriesByType('measure').length});
    }
  }
  process.stdin.push('\x11'); // Real Ctrl+Q input path, including renderer cleanup.
  await running;
  write('TIM_IDLE_REPORT ' + JSON.stringify({mode: process.env.NODE_ENV, frames, writes, welcome, colored, samples, timers: timers.size}) + '\n');
} finally {
  globalThis.setInterval = originalSet;
  globalThis.clearInterval = originalClear;
  process.stdout.write = write;
}
