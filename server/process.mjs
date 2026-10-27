import { spawn } from 'node:child_process';
import { runtimeEnv } from './platform.mjs';
export function runProcess(binary, args, { signal, cwd, onOutput = () => {}, onProcess = () => {}, timeout = 30 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Cancelled'));
    let tail = '', timedOut = false;
    const child = spawn(binary, args, { cwd, windowsHide: true, shell: false, env: runtimeEnv(binary, cwd), stdio: ['ignore', 'pipe', 'pipe'] });
    onProcess(child);
    const kill = () => child.kill('SIGKILL');
    const timer = setTimeout(() => { timedOut = true; kill(); }, timeout);
    signal?.addEventListener('abort', kill, { once: true });
    const collect = chunk => { const value = chunk.toString(); tail = (tail + value).slice(-8000); onOutput(value); };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    const clean = () => { clearTimeout(timer); signal?.removeEventListener('abort', kill); };
    child.once('error', error => { clean(); reject(error); });
    child.once('close', code => {
      clean();
      const lines = tail.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').split(/[\r\n]+/);
      const diagnostic = lines.filter(line => /error|failed|cannot|not supported|out of memory/i.test(line)).slice(-5).join('\n') || lines.slice(-8).join('\n');
      if (signal?.aborted) reject(new Error('Cancelled'));
      else if (timedOut) reject(new Error('Engine timed out.'));
      else if (code !== 0) reject(new Error(`Engine exited (${code}). ${diagnostic.slice(-1800)}`));
      else resolve(tail);
    });
  });
}
