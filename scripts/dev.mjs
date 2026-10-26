import { spawn } from 'node:child_process';
const children = [spawn(process.execPath, ['server/index.mjs'], { stdio: 'inherit', env: { ...process.env, TIM_DEV: '1' } }), spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { stdio: 'inherit' })];
for (const child of children) child.on('exit', () => { children.forEach(c => c.kill()); process.exit(); });
process.on('SIGINT', () => children.forEach(c => c.kill()));
