import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('real CLI stays bounded while idle with animated true-color artwork', {timeout: 90000}, async () => {
  const env = {...process.env};
  delete env.NODE_ENV;
  delete env.TIM_IDLE_TEST_FRAMES;
  const child = spawn(process.execPath, ['--expose-gc', '--max-old-space-size=128', fileURLToPath(new URL('./cli-idle-fixture.mjs', import.meta.url))], {
    env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  });
  let output = '', errors = '';
  // Keep diagnostics bounded even if a regression floods the synthetic terminal.
  child.stdout.on('data', chunk => { output = (output + chunk).slice(-16384); });
  child.stderr.on('data', chunk => { errors = (errors + chunk).slice(-8192); });
  const timer = setTimeout(() => child.kill(), 85000);
  try {
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    assert.equal(code, 0, errors || 'CLI did not exit normally');
    const match = /TIM_IDLE_REPORT (.+)/.exec(output);
    assert.ok(match, output);
    const report = JSON.parse(match[1]);
    assert.equal(report.mode, 'production', 'renderer mode must be set before importing React/Ink');
    assert.equal(report.frames, 640);
    assert.ok(report.welcome && report.colored, 'must render the full animated true-color welcome');
    assert.ok(report.writes > 32, 'must repaint through multiple animation cycles');
    assert.equal(report.samples.length, 5);
    assert.ok(report.samples.every(sample => sample.measures === 0), 'idle renders must not retain development profiling records');
    const baseline = report.samples[0].heap;
    assert.ok(report.samples.every(sample => sample.heap < 96 * 1024 * 1024), JSON.stringify(report.samples));
    assert.ok(report.samples.at(-1).heap - baseline < 16 * 1024 * 1024, JSON.stringify(report.samples));
    assert.equal(report.timers, 0, 'quitting must clean up both idle timers');
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
});
