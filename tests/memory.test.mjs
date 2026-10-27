import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryMonitor, estimateModelBytes, parseLinuxMemory, parseMacMemory, parseWindowsMemory, parsePsMemory, parseWindowsProcesses, readHostMemory, readProcessMemory } from '../server/memory.mjs';
import { Studio } from '../server/studio.mjs';

const GiB = 2 ** 30;
const macStats = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free: 100.
Pages active: 900.
Pages inactive: 200.
Pages speculative: 50.
Pages purgeable: 75.
Pages occupied by compressor: 80.
`;
const host = (available = 8 * GiB) => ({ total: 16 * GiB, free: GiB, totalBytes: 16 * GiB, availableBytes: available, usedBytes: 16 * GiB - available, reserveBytes: 1.6 * GiB, modelBudgetBytes: available - 1.6 * GiB, availableSource: 'os' });
const child = pid => ({ pid, exitCode: null, signalCode: null });
const entry = (id, pid, role = 'specialist') => ({ engine: { modelId: id, child: child(pid) }, model: { id, name: id, size: GiB }, role });

test('host parsers use reclaimable availability instead of only completely free RAM', () => {
  assert.equal(parseLinuxMemory('MemFree: 10 kB\nMemAvailable: 12000 kB\nCached: 9999 kB\n'), 12000 * 1024);
  assert.equal(parseMacMemory(macStats), 350 * 16384);
  assert.equal(parseMacMemory(macStats.replace('16384', '4096')), 350 * 4096);
  assert.equal(parseWindowsMemory('\uFEFF 12345\r\n'), 12345 * 1024);
  assert.equal(parseLinuxMemory('MemAvailable: 0 kB'), 0);
});

test('invalid and incomplete host samples are not interpreted as zero or unlimited availability', () => {
  for (const text of ['', 'MemFree: 400 kB', 'MemAvailable: -1 kB', 'MemAvailable: NaN kB']) assert.throws(() => parseLinuxMemory(text));
  for (const text of ['', macStats.replace('Pages inactive: 200.\n', ''), macStats.replace('16384', '0'), macStats.replace('200.', '-1.')]) assert.throws(() => parseMacMemory(text));
  for (const text of ['', 'NaN', '-123', '1e5', '1\n2']) assert.throws(() => parseWindowsMemory(text));
});

test('host snapshots reserve headroom, preserve total/free compatibility, and clamp values', async () => {
  const memory = await readHostMemory({ platform: 'linux', total: 16 * GiB, free: GiB, readFile: async () => `MemAvailable: ${8 * GiB / 1024} kB` });
  assert.equal(memory.total, 16 * GiB); assert.equal(memory.totalBytes, memory.total); assert.equal(memory.free, GiB);
  assert.equal(memory.availableBytes, 8 * GiB); assert.equal(memory.usedBytes, 8 * GiB);
  assert.equal(memory.reserveBytes, Math.round(1.6 * GiB));
  assert.equal(memory.modelBudgetBytes, memory.availableBytes - memory.reserveBytes);
  const excessive = await readHostMemory({ platform: 'linux', total: GiB, free: 2 * GiB, readFile: async () => `MemAvailable: ${4 * GiB / 1024} kB` });
  assert.equal(excessive.availableBytes, GiB); assert.equal(excessive.free, GiB); assert.equal(excessive.modelBudgetBytes, 0);
});

test('platform probes call only their fixed system commands and safely fall back when unavailable', async () => {
  const calls = [];
  const run = async (binary, args, options) => { calls.push({ binary, args, options }); return { stdout: binary.includes('vm_stat') ? macStats : '65536' }; };
  const mac = await readHostMemory({ platform: 'darwin', total: GiB, free: 100, run });
  assert.equal(mac.availableSource, 'reclaimable-estimate'); assert.equal(calls[0].binary, '/usr/bin/vm_stat'); assert.deepEqual(calls[0].args, []);
  const windows = await readHostMemory({ platform: 'win32', total: GiB, free: 100, run });
  assert.equal(windows.availableBytes, 65536 * 1024); assert.equal(calls[1].binary, 'powershell.exe'); assert.ok(calls[1].args.includes('-NoProfile')); assert.equal(calls[1].options.timeout, 3000);
  for (const platform of ['darwin', 'linux', 'win32', 'unsupported']) {
    const fallback = await readHostMemory({ platform, total: 2 * GiB, free: GiB, run: async () => { throw new Error('Denied'); }, readFile: async () => 'bad data' });
    assert.equal(fallback.availableSource, 'free-fallback'); assert.equal(fallback.availableBytes, GiB); assert.equal(fallback.modelBudgetBytes, 0);
  }
});

test('per-process parsers map only requested PIDs and distinguish missing measurements', () => {
  assert.deepEqual([...parsePsMemory(' 42 1000\n 51 2000\n99 3000\n42 NaN\n', [42, 51])], [[42, 1000 * 1024], [51, 2000 * 1024]]);
  assert.deepEqual([...parseWindowsProcesses('{"Id":42,"WorkingSet64":4096}', [42])], [[42, 4096]]);
  assert.deepEqual([...parseWindowsProcesses('[{"Id":42,"WorkingSet64":0},{"Id":51,"WorkingSet64":-1},{"Id":99,"WorkingSet64":100}]', [42, 51])], [[42, 0]]);
  assert.deepEqual([...parseWindowsProcesses('', [42])], []);
});

test('process sampling survives individual exits and never interpolates invalid process IDs', async () => {
  const paths = [];
  const linux = await readProcessMemory([42, 51, 60, -5, '$(touch /tmp/nope)', 42], { platform: 'linux', readFile: async file => {
    paths.push(file);
    if (file.includes('/42/')) return 'Name: llama\nVmRSS: 1234 kB\n';
    if (file.includes('/51/')) throw new Error('Gone');
    return 'Name: no resident statistic';
  } });
  assert.deepEqual([...linux], [[42, 1234 * 1024]]);
  assert.deepEqual(paths, ['/proc/42/status', '/proc/51/status', '/proc/60/status']);
  const calls = [];
  await readProcessMemory([42, '1;bad', -1, Infinity, 51], { platform: 'win32', run: async (binary, args) => { calls.push([binary, args]); return { stdout: '[]' }; } });
  assert.match(calls[0][1].at(-1), /-Id 42,51 /); assert.doesNotMatch(calls[0][1].at(-1), /bad|Infinity/);
  assert.deepEqual([...await readProcessMemory([42], { platform: 'darwin', run: async () => { throw new Error('Denied'); } })], []);
  let invoked = false;
  await readProcessMemory([], { platform: 'darwin', run: async () => { invoked = true; } });
  assert.equal(invoked, false);
});

test('model estimates prefer catalog runtime budgets over weight sizes and keep unknowns explicit', () => {
  assert.equal(estimateModelBytes({ catalogId: 'tiny', size: GiB }, [{ id: 'tiny', memoryGB: 1.6 }]), Math.round(1.6 * GiB));
  assert.equal(estimateModelBytes({ size: GiB }), Math.round(1.7 * GiB));
  assert.equal(estimateModelBytes({}), null);
});

test('live samples report all processes, measured RAM, estimates, and unloaded rows without stale identity reuse', async () => {
  let now = 1000;
  const monitor = new MemoryMonitor({ now: () => now, total: () => 16 * GiB, free: () => GiB, host: async () => host(), processes: async () => new Map([[42, 4000], [51, 5000]]) });
  const guide = entry('guide', 42, 'guide'), specialist = entry('code', 51), unknown = entry('custom', 60, 'pipeline-agent');
  unknown.model = { id: 'custom', name: 'Custom' };
  const sampled = await monitor.sample([guide, specialist]);
  assert.equal(sampled.memory.modelRssBytes, 9000); assert.equal(sampled.memory.stale, false); assert.equal(sampled.memory.status, 'ok');
  assert.equal(sampled.loadedModels[0].memorySource, 'measured'); assert.equal(sampled.loadedModels[0].role, 'guide');
  assert.equal(monitor.snapshot([unknown]).loadedModels[0].memorySource, 'unavailable');
  specialist.engine.child = child(51); // The same numeric PID is a different process identity.
  const reloaded = monitor.snapshot([guide, specialist]);
  assert.equal(reloaded.loadedModels[1].rssBytes, null); assert.equal(reloaded.loadedModels[1].memorySource, 'estimate'); assert.equal(reloaded.memory.modelRssBytes, null);
  assert.equal(monitor.snapshot([]).memory.modelRssBytes, 0); assert.deepEqual(monitor.snapshot([]).loadedModels, []);
  now += 16000;
  const stale = monitor.snapshot([guide]);
  assert.equal(stale.memory.status, 'stale'); assert.equal(stale.memory.availableSource, 'free-fallback'); assert.equal(stale.memory.availableBytes, GiB); assert.equal(stale.loadedModels[0].rssBytes, null);
});

test('probe errors and processes exiting during a sample leave useful conservative telemetry', async () => {
  const model = entry('code', 42);
  const monitor = new MemoryMonitor({ total: () => 16 * GiB, free: () => 2 * GiB, host: async () => { throw new Error('No permission'); }, processes: async () => { model.engine.child = null; throw new Error('Exited'); } });
  const sampled = await monitor.sample([model]);
  assert.equal(sampled.memory.status, 'fallback'); assert.equal(sampled.memory.availableBytes, 2 * GiB); assert.equal(sampled.loadedModels[0].rssBytes, null);
});

test('concurrent samples share work, while a later admission gets new capacity', async () => {
  let calls = 0, release;
  const wait = new Promise(resolve => { release = resolve; });
  const monitor = new MemoryMonitor({ total: () => 16 * GiB, free: () => GiB, host: async () => { calls++; await wait; return host(calls * GiB); }, processes: async () => new Map() });
  const first = monitor.sample(), second = monitor.sample();
  release(); await Promise.all([first, second]);
  assert.equal(calls, 1);
  const next = await monitor.sample();
  assert.equal(calls, 2); assert.equal(next.memory.availableBytes, 2 * GiB);
});

test('Studio collects every live pool member and guide once, excluding exited children and unknown IDs', () => {
  const studio = new Studio('/tmp/tim-memory-fixture');
  const guide = entry('guide', 42, 'guide'), one = entry('one', 51), two = entry('two', 60), exited = entry('exited', 70), missing = entry('missing', 80);
  exited.engine.child.exitCode = 1;
  studio.registry.models = [guide.model, one.model, two.model, exited.model];
  studio.orchestrator = guide.engine;
  studio.llama = { instances: () => [{ engine: one.engine, pinned: true }, { engine: two.engine, pinned: false }, { engine: exited.engine }, { engine: missing.engine }, { engine: guide.engine }] };
  const entries = studio.loadedEngines();
  assert.deepEqual(entries.map(row => row.model.id), ['guide', 'one', 'two']);
  assert.equal(entries[1].pinned, true);
  studio.memoryMonitor = new MemoryMonitor({ total: () => 16 * GiB, free: () => GiB });
  const state = studio.snapshot();
  assert.deepEqual(state.loadedModels.map(row => row.modelId), ['guide', 'one', 'two']);
  assert.equal(state.memory.total, 16 * GiB); assert.equal(state.loadedModels[1].memorySource, 'estimate');
});
