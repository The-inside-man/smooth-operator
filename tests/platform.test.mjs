import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { mountCandidates, runtimeCandidates } from '../server/platform.mjs';
import { scanLibrary } from '../server/registry.mjs';

test('mount discovery covers Windows, macOS, and Linux conventions', () => {
  assert.ok(mountCandidates('win32').includes('D:\\'));
  assert.ok(mountCandidates('darwin').includes('/Volumes/TIM'));
  assert.ok(mountCandidates('linux', { home: '/home/test', user: 'test' }).includes('/run/media/test/TIM'));
});
test('runtime resolution never uses legacy binaries for the wrong architecture', () => {
  const normalize = list => list.map(x => x.binary.replaceAll('\\', '/'));
  assert.ok(normalize(runtimeCandidates('/TIM', 'chat', 'win32', 'x64')).some(x => x.endsWith('/app/llm-backend/win/vulkan/llama-server.exe')));
  assert.ok(normalize(runtimeCandidates('/TIM', 'chat', 'darwin', 'arm64')).some(x => x.endsWith('/app/llm-backend/mac/arm64/llama-server')));
  assert.ok(normalize(runtimeCandidates('/TIM', 'image', 'linux', 'x64')).some(x => x.endsWith('/app/backend/linux/cpu/sd-cli')));
  assert.ok(!normalize(runtimeCandidates('/TIM', 'chat', 'darwin', 'x64')).some(x => x.includes('Portable-Local-Studio')));
  assert.ok(!normalize(runtimeCandidates('/TIM', 'chat', 'win32', 'arm64')).some(x => x.includes('Portable-Local-Studio')));
  assert.ok(normalize(runtimeCandidates('/TIM', 'chat', 'darwin', 'x64')).some(x => x.includes('darwin-x64')));
});
test('registry excludes companion weights and reports incomplete model bundles', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tim-registry-'));
  try {
    await fs.mkdir(path.join(dir, 'Coding-Models/models/demo'), { recursive: true });
    await fs.mkdir(path.join(dir, 'Portable-Local-Studio/app/models'), { recursive: true });
    await fs.writeFile(path.join(dir, 'Coding-Models/models/demo/chat.gguf'), 'GGUF');
    await fs.writeFile(path.join(dir, 'Coding-Models/models/demo/mmproj.gguf'), 'GGUF');
    await fs.writeFile(path.join(dir, 'Portable-Local-Studio/app/models/flux-2-klein-4b-Q4_0.gguf'), 'GGUF');
    const result = await scanLibrary(dir, dir, 'cpu');
    assert.equal(result.models.length, 2);
    assert.ok(result.models.find(m => m.kind === 'image').issue.startsWith('Missing companion:'));
    assert.equal(result.models.find(m => m.kind === 'chat').available, false);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
