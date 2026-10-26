import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
let nvidiaProbe;
async function hasNvidia() {
  nvidiaProbe ||= promisify(execFile)('nvidia-smi', ['--query-gpu=name', '--format=csv,noheader'], { windowsHide: true, timeout: 2500 }).then(result => Boolean(result.stdout.trim())).catch(() => false);
  return nvidiaProbe;
}
export const exists = async file => { try { await fs.access(file); return true; } catch { return false; } };
const directories = async root => { try { return (await fs.readdir(root, { withFileTypes: true })).filter(x => x.isDirectory()).map(x => path.join(root, x.name)); } catch { return []; } };

export function mountCandidates(platform, { home = os.homedir(), user = process.env.USER || process.env.USERNAME || path.basename(os.homedir()) } = {}) {
  if (platform === 'win32') return Array.from({ length: 26 }, (_, n) => `${String.fromCharCode(65 + n)}:\\`);
  if (platform === 'darwin') return ['/Volumes/TIM', '/Volumes'];
  return [`/media/${user}/TIM`, `/run/media/${user}/TIM`, '/mnt/TIM', '/media', '/run/media', '/mnt', home];
}
export async function discoverLibrary(preferred) {
  const roots = [preferred, process.env.TIM_LIBRARY_ROOT, ...mountCandidates(process.platform)].filter(Boolean);
  if (process.platform !== 'win32') {
    for (const base of ['/Volumes', '/media', '/run/media', '/mnt']) {
      for (const dir of await directories(base)) roots.push(dir, ...await directories(dir));
    }
  }
  roots.push(path.resolve(process.cwd(), '..'));
  for (const root of [...new Set(roots)]) {
    if (await exists(path.join(root, 'Portable-Local-Studio', 'app'))) return path.resolve(root);
    if (await exists(path.join(root, 'app', 'llm-backend'))) return path.dirname(path.resolve(root));
    if (await exists(path.join(root, 'Coding-Models'))) return path.resolve(root);
  }
  return null;
}

// New runtime packs are architecture-specific. Legacy TIM packs have known architectures.
export function runtimeCandidates(library, kind, platform = process.platform, arch = process.arch, preference = 'auto', dataDir = '') {
  const exe = platform === 'win32' ? '.exe' : '';
  const binary = { chat: 'llama-server', image: 'sd-cli', video: 'sd-cli', upscale: 'realesrgan-ncnn-vulkan', transcribe: 'whisper-cli' }[kind] + exe;
  const variants = preference === 'auto' ? (platform === 'darwin' ? ['metal', 'cpu'] : ['cuda', 'vulkan', 'cpu']) : [preference];
  const roots = [dataDir && path.join(dataDir, 'runtimes', `${platform}-${arch}`), library && path.join(library, 'TIM-Studio', 'runtimes', `${platform}-${arch}`)].filter(Boolean);
  const candidates = roots.flatMap(root => variants.map(backend => ({ binary: path.join(root, kind, backend, binary), backend })));
  if (!library || !((platform === 'darwin' && arch === 'arm64') || (['win32', 'linux'].includes(platform) && arch === 'x64'))) return candidates;
  const osFolder = { win32: 'win', darwin: 'mac', linux: 'linux' }[platform];
  const folder = { chat: 'llm-backend', image: 'backend', video: 'backend', upscale: 'upscale-backend', transcribe: 'speech-backend' }[kind];
  const base = path.join(library, 'Portable-Local-Studio', 'app', folder, osFolder);
  if (kind === 'upscale') candidates.push({ binary: path.join(base, binary), backend: platform === 'darwin' ? 'metal' : 'vulkan' });
  else if (platform === 'darwin') {
    candidates.push({ binary: path.join(base, 'arm64', binary), backend: preference === 'cpu' ? 'cpu' : 'metal' });
    candidates.push({ binary: path.join(base, binary), backend: preference === 'cpu' ? 'cpu' : 'metal' });
  } else for (const backend of kind === 'transcribe' ? ['cpu'] : variants) candidates.push({ binary: path.join(base, backend, binary), backend });
  return candidates;
}
export async function findRuntime(library, kind, preference = 'auto', dataDir = '') {
  for (const candidate of runtimeCandidates(library, kind, process.platform, process.arch, preference, dataDir)) {
    if (candidate.backend === 'cuda' && preference === 'auto' && !await hasNvidia()) continue;
    if (await exists(candidate.binary)) return candidate;
  }
  return null;
}
export function runtimeEnv(binary, workDir) {
  const env = { ...process.env, TMP: workDir, TEMP: workDir, TMPDIR: workDir };
  const key = process.platform === 'win32' ? 'PATH' : process.platform === 'darwin' ? 'DYLD_LIBRARY_PATH' : 'LD_LIBRARY_PATH';
  env[key] = path.dirname(binary) + path.delimiter + (env[key] || '');
  return env;
}
