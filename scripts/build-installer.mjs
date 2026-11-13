import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Arch, Platform, build, getArchSuffix } from 'electron-builder';
import { buildVoice } from './build-voice.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const { platform, arch } = process;
const desktopRelease = path.join(root, 'release');
const installerRelease = path.join(root, 'release-installer');
const electronDist = path.join(root, 'node_modules', 'electron', 'dist');
const productName = 'TIM Studio Installer';
const cliDependencies = ['ink', 'react', 'strip-ansi', 'string-width'];
const copyTree = { recursive: true, verbatimSymlinks: true };
const readJson = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const writeJson = (file, value) => fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);

function desktopPayload(version) {
  if (platform === 'darwin') {
    const entry = 'TIM Studio.app';
    const source = path.join(desktopRelease, `mac${getArchSuffix(Arch[arch])}`, entry);
    return { entry, source, check: path.join(source, 'Contents', 'MacOS', 'TIM Studio'), copyToEntry: true };
  }
  if (platform === 'win32') {
    const entry = 'TIM Studio.exe';
    const source = path.join(desktopRelease, 'win-unpacked');
    return { entry, source, check: path.join(source, entry), copyToEntry: false };
  }
  const entry = `TIM-Studio-${version}-linux-x86_64.AppImage`;
  const source = path.join(desktopRelease, entry);
  return { entry, source, check: source, copyToEntry: true };
}

async function copyProductionDependencies(cliDir) {
  const { packages } = await readJson(path.join(root, 'package-lock.json'));
  for (const [relative, pkg] of Object.entries(packages)) {
    if (!relative.startsWith('node_modules/') || pkg.dev) continue;
    const source = path.join(root, relative);
    const destination = path.join(cliDir, relative);
    const installed = await readJson(path.join(source, 'package.json')).catch(error => {
      if (pkg.optional && error.code === 'ENOENT') return null;
      throw error;
    });
    if (!installed) continue;
    if (installed.version !== pkg.version) throw new Error(`Run npm ci before packaging. ${relative} differs from package-lock.json.`);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    // Nested package paths have their own lockfile entries.
    await fs.cp(source, destination, { ...copyTree, filter: file => file !== path.join(source, 'node_modules') });
  }
}

function nodeOptions() {
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  delete env.NODE_PATH;
  return { encoding: 'utf8', env, timeout: 15000, windowsHide: true };
}

function checkPortableNode(node) {
  const options = nodeOptions();
  const metadata = JSON.parse(execFileSync(node, ['-p', 'JSON.stringify([process.platform,process.arch,process.versions.node])'], options));
  if (metadata[0] !== platform || metadata[1] !== arch || Number(metadata[2].split('.')[0]) < 24) {
    throw new Error(`Bundle Node.js 24+ for ${platform}-${arch}. Set TIM_INSTALLER_NODE to its executable.`);
  }
  if (platform === 'darwin') {
    const links = execFileSync('/usr/bin/otool', ['-L', node], options).split('\n').slice(1).filter(line => line.trim());
    if (links.some(line => !/^\s+(?:\/usr\/lib\/|\/System\/Library\/)/.test(line))) {
      throw new Error('The Node.js binary links to non-system libraries. Set TIM_INSTALLER_NODE to the executable from an official Node.js distribution.');
    }
  }
}

function ensureMacSignature(app) {
  const verify = ['--verify', '--deep', '--strict', app];
  try {
    execFileSync('/usr/bin/codesign', verify, { stdio: 'pipe' });
  } catch {
    execFileSync('/usr/bin/codesign', ['--sign', '-', '--force', '--deep', app], { stdio: 'inherit' });
    execFileSync('/usr/bin/codesign', verify, { stdio: 'inherit' });
  }
}

async function nodeLicense(node) {
  const bin = path.dirname(node);
  const distribution = platform === 'win32' ? bin : path.dirname(bin);
  const license = path.resolve(process.env.TIM_INSTALLER_NODE_LICENSE || path.join(distribution, 'LICENSE'));
  if (!(await fs.stat(license).catch(() => null))?.isFile()) {
    throw new Error('The bundled Node.js license is missing. Set TIM_INSTALLER_NODE_LICENSE to the LICENSE file from the same Node.js distribution.');
  }
  return license;
}

async function stageCli(project, original, node, license) {
  const cliDir = path.join(project, 'cli-payload');
  const cliNode = platform === 'win32' ? 'node.exe' : 'node';
  await fs.mkdir(cliDir);
  for (const directory of ['cli', 'server']) await fs.cp(path.join(root, directory), path.join(cliDir, directory), copyTree);
  await fs.copyFile(path.join(root, 'LICENSE'), path.join(cliDir, 'LICENSE'));
  await fs.copyFile(license, path.join(cliDir, 'NODE-LICENSE'));
  const targetNode = path.join(cliDir, cliNode);
  await fs.copyFile(node, targetNode);
  if (platform !== 'win32') await fs.chmod(targetNode, 0o755);
  const capture = await buildVoice(root);
  if (capture) {
    await fs.copyFile(capture, path.join(cliDir, 'cli', 'voice', 'WindowsCapture.exe'));
    await fs.copyFile(path.join(path.dirname(capture), 'WindowsControl.exe'), path.join(cliDir, 'cli', 'control', 'WindowsControl.exe'));
  }
  await writeJson(path.join(cliDir, 'package.json'), {
    name: '@tim-studio/cli', version: original.version, license: original.license, type: 'module',
    bin: { tim: 'cli/index.mjs' }, engines: { node: '>=24' },
    dependencies: Object.fromEntries(cliDependencies.map(name => [name, original.dependencies[name]])),
  });
  await copyProductionDependencies(cliDir);
  const output = execFileSync(targetNode, ['cli/index.mjs', '--help'], { ...nodeOptions(), cwd: cliDir });
  if (!output.includes('TIM Studio')) throw new Error('The staged CLI did not print its help text.');
  return { cliDir, cliNode };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 1 || args[0] !== '--dir')) throw new Error('Use npm run pack:installer [-- --dir].');
  const targets = { darwin: 'zip', win32: 'zip', linux: 'AppImage' };
  if (!targets[platform] || (arch !== 'x64' && !(platform === 'darwin' && arch === 'arm64'))) {
    throw new Error(`No desktop installer target is configured for ${platform}-${arch}.`);
  }
  const original = await readJson(path.join(root, 'package.json'));
  const desktop = desktopPayload(original.version);
  await fs.access(desktop.check).catch(() => { throw new Error(`Build the desktop release with npm run dist first. Missing ${desktop.check}`); });
  const electronVersion = original.devDependencies.electron;
  const localElectron = await fs.readFile(path.join(electronDist, 'version'), 'utf8').catch(() => '');
  if (localElectron.trim() !== electronVersion) throw new Error('Run npm run setup:desktop to prepare the matching native Electron runtime.');
  const node = await fs.realpath(process.env.TIM_INSTALLER_NODE || process.execPath);
  checkPortableNode(node);
  const license = await nodeLicense(node);
  await fs.mkdir(path.join(root, 'artifacts'), { recursive: true });
  const project = await fs.mkdtemp(path.join(root, 'artifacts', 'installer-build-'));
  try {
    const appDir = path.join(project, 'app');
    await fs.mkdir(appDir);
    for (const directory of ['installer', 'server']) await fs.cp(path.join(root, directory), path.join(appDir, directory), copyTree);
    const fonts = path.join(appDir, 'installer', 'fonts');
    const mono = path.join(root, 'node_modules', '@fontsource', 'ibm-plex-mono');
    const face = 'ibm-plex-mono-latin-400-normal.woff2';
    await fs.mkdir(fonts);
    await fs.copyFile(path.join(mono, 'files', face), path.join(fonts, face));
    await fs.copyFile(path.join(mono, 'LICENSE'), path.join(fonts, 'IBM-Plex-Mono-LICENSE'));
    await fs.mkdir(path.join(appDir, 'cli'));
    await fs.copyFile(path.join(root, 'cli', 'model-recommendations.mjs'), path.join(appDir, 'cli', 'model-recommendations.mjs'));
    await fs.copyFile(path.join(root, 'LICENSE'), path.join(appDir, 'LICENSE'));
    await writeJson(path.join(appDir, 'package.json'), {
      name: 'tim-studio-installer', version: original.version, description: 'Install TIM Studio desktop and terminal components',
      license: original.license, author: original.author, type: 'module', main: 'installer/main.cjs',
    });
    const { cliDir, cliNode } = await stageCli(project, original, node, license);
    await build({
      projectDir: appDir,
      targets: Platform.current().createTarget([args.length ? 'dir' : targets[platform]], Arch[arch]),
      publish: 'never',
      config: {
        appId: 'studio.tim.installer', productName, electronVersion, electronDist,
        icon: path.join(root, 'build', 'icon.png'),
        directories: { output: installerRelease },
        files: ['installer/**/*', 'server/**/*', 'cli/model-recommendations.mjs', 'LICENSE', 'package.json'],
        asar: true, npmRebuild: false,
        artifactName: 'TIM-Studio-Installer-${version}-${os}-${arch}.${ext}',
        mac: { category: 'public.app-category.utilities' },
        linux: { category: 'Utility' },
        // Preserve nested app bundle symlinks and include all desktop runtime files.
        async afterPack({ appOutDir, packager }) {
          const resources = packager.getResourcesDir(appOutDir);
          const payload = path.join(resources, 'tim-install-payload');
          const desktopDir = path.join(payload, 'desktop');
          await fs.mkdir(desktopDir, { recursive: true });
          await fs.cp(desktop.source, desktop.copyToEntry ? path.join(desktopDir, desktop.entry) : desktopDir, copyTree);
          await fs.cp(cliDir, path.join(payload, 'cli'), copyTree);
          await writeJson(path.join(payload, 'payload.json'), { platform, arch, version: original.version, desktopEntry: desktop.entry, cliNode });
          if (platform === 'darwin') {
            ensureMacSignature(path.join(desktopDir, desktop.entry));
            ensureMacSignature(path.resolve(resources, '../..'));
          }
        },
      },
    });
  } finally {
    await fs.rm(project, { recursive: true, force: true });
  }
}

await main();
