const api = window.timInstaller;
const byId = id => document.getElementById(id);
const els = Object.fromEntries([
  'version', 'message', 'loading', 'components', 'desktop', 'cli', 'desktop-note', 'cli-note',
  'existing-installation', 'existing-version', 'existing-target', 'versions', 'installed-version', 'available-version',
  'other-installations', 'other-installation-paths', 'imports', 'import-choices',
  'hardware', 'model-fit', 'models', 'model-total', 'model-category', 'filter-row', 'local', 'portable', 'portable-note',
  'directory', 'browse', 'review', 'plan-status', 'plan-errors', 'plan-warnings', 'recheck',
  'heading-4', 'install-intro', 'progress-panel', 'progress-label', 'progress-value', 'progress',
  'progress-detail', 'cancel-status', 'done-panel', 'done-components', 'done-folder',
  'done-portable', 'open-status', 'progress-announcement', 'back', 'skip', 'cancel', 'next'
].map(id => [id, byId(id)]));
const launchButtons = [...document.querySelectorAll('[data-action]')];
const directories = { local: '', portable: '' };
const modelInputs = new Map();
let step = 1, stage = 'loading', plan = null, checking = false, choosing = false;
let planRevision = 0, installAttempt = 0, installStage = 'idle', cancelPending = false, cancelRequested = false;
let activeLaunch = false, lastAnnouncement = '', unsubscribe, availableVersion = '', installReview = null;
let legacy = {}, importFrom = '', importAllowed = false;
const importLabels = { cli: 'TIM CLI', desktop: 'TIM Desktop' };

const string = value => typeof value === 'string' ? value : '';
const errorText = (error, fallback) => {
  const raw = string(error?.message) || string(error);
  return raw.replace(/^Error invoking remote method 'tim-installer:[a-z-]+': (?:Error: )?/, '') || fallback;
};
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const integer = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const diskSize = value => !number(value) ? 'Unknown' : value >= 1e9
  ? decimal.format(value / 1e9) + ' GB' : integer.format(value / 1e6) + ' MB';
const ramSize = value => number(value) ? decimal.format(value / 2 ** 30) + ' GiB' : 'Unknown';
const versionLabel = value => string(value) ? 'v' + value.replace(/^v/, '') : '';
const files = input => input.desktop && input.cli ? 'TIM Desktop and TIM CLI'
  : input.desktop ? 'TIM Desktop' : input.cli ? 'TIM CLI' : 'No apps selected';
const locationKey = () => els.portable.checked ? 'portable' : 'local';
const readSelection = () => ({
  desktop: els.desktop.checked && !els.desktop.disabled,
  cli: els.cli.checked && !els.cli.disabled,
  modelIds: [...modelInputs].filter(([, { input }]) => input.checked).map(([id]) => id),
  portable: els.portable.checked,
  directory: directories[locationKey()],
  importFrom
});

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function pairs(list, entries) {
  list.replaceChildren(...entries.flatMap(([label, value]) => [element('dt', label), element('dd', value)]));
}

function issues(list, items) {
  const valid = Array.isArray(items) ? items.filter(value => typeof value === 'string' && value.trim()) : [];
  list.replaceChildren(...valid.map(value => element('li', value)));
  list.hidden = valid.length === 0;
}

function message(value = '') {
  els.message.textContent = value;
  els.message.hidden = !value;
}

function canInstall() {
  return Boolean(plan && string(plan.target) && !checking && !choosing
    && plan.operation !== 'downgrade' && Array.isArray(plan.errors) && plan.errors.length === 0);
}

function controls() {
  const installing = step === 4 && installStage === 'running';
  const done = step === 4 && installStage === 'done';
  const retrying = step === 4 && installStage === 'retry-check';
  els.back.hidden = step === 1 || installing || done;
  els.back.disabled = choosing || retrying;
  els.skip.hidden = step !== 2 || modelInputs.size === 0;
  els.cancel.hidden = !installing;
  els.cancel.disabled = cancelPending || cancelRequested;
  els.cancel.textContent = installReview?.operation === 'upgrade' ? 'Cancel upgrade' : 'Cancel installation';
  els.next.hidden = installing || done;
  els.next.textContent = retrying ? 'Checking…' : step === 4 || stage === 'error' ? 'Retry'
    : step === 3 ? ({ upgrade: 'Upgrade TIM Studio', migrate: 'Install and copy TIM data', current: 'Apply selections', downgrade: 'Newer version installed' }[plan?.operation] || 'Install TIM Studio')
      : 'Continue';
  els.next.disabled = step === 1
    ? stage === 'loading' || stage === 'ready' && !readSelection().desktop && !readSelection().cli
    : step === 3 ? !canInstall() : retrying;
  els.browse.disabled = choosing;
  els.local.disabled = choosing;
  els.portable.disabled = choosing;
  els.recheck.hidden = checking || !plan?.errors?.length;
  els.recheck.disabled = choosing;
}

function showStep(value) {
  step = value;
  message();
  for (const indicator of document.querySelectorAll('.steps [data-step]')) {
    const position = Number(indicator.dataset.step);
    if (position < step) indicator.dataset.complete = 'true';
    else delete indicator.dataset.complete;
    if (position === step) indicator.setAttribute('aria-current', 'step');
    else indicator.removeAttribute('aria-current');
    byId('step-' + position).hidden = position !== step;
  }
  controls();
  byId('heading-' + step).focus();
}

function setComponents(settings) {
  const { hardware = {} } = settings;
  for (const [id, available] of [['desktop', settings.desktopAvailable], ['cli', settings.cliAvailable]]) {
    els[id].disabled = !available;
    els[id].checked = Boolean(available);
    els[id + '-note'].hidden = Boolean(available);
  }
  const platforms = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' };
  const os = [platforms[hardware.platform] || string(hardware.platform), string(hardware.osVersion)].filter(Boolean).join(' ');
  const arch = { arm64: 'ARM64', x64: 'x64' }[hardware.arch] || string(hardware.arch);
  const cores = number(hardware.logicalCores) && hardware.logicalCores > 0
    ? integer.format(hardware.logicalCores) + ' logical cores' : '';
  const memory = hardware.memory || {};
  const existingVersion = versionLabel(settings.existing?.version);
  els['existing-installation'].hidden = !existingVersion;
  els['existing-version'].textContent = existingVersion ? 'TIM Studio ' + existingVersion + ' is installed in your default location.' : '';
  els['existing-target'].textContent = string(settings.existing?.target);
  els['existing-target'].hidden = !els['existing-target'].textContent;
  legacy = settings.legacy || {};
  const other = Object.entries(importLabels).map(([key, label]) => {
    const entry = legacy[key];
    return entry ? [label, versionLabel(entry.version), string(entry.path)].filter(Boolean).join(' · ') : '';
  }).filter(Boolean);
  els['other-installations'].hidden = !other.length;
  issues(els['other-installation-paths'], [...new Set(other)]);
  setImportChoices();
  pairs(els.hardware, [
    ['Operating system', [os, arch].filter(Boolean).join(' · ') || 'Unknown'],
    ['Processor', [string(hardware.cpuName), cores].filter(Boolean).join(' · ') || 'Unknown'],
    ['Installed memory', ramSize(memory.totalBytes)],
    ['Available memory', ramSize(memory.availableBytes)],
    ['Estimated model budget', ramSize(memory.modelBudgetBytes)]
  ]);
}

function fitOf(model, budget) {
  if (['comfortable', 'tight', 'too-large', 'unknown'].includes(model.fit)) return model.fit;
  if (!number(budget) || !number(model.memoryGB) || model.memoryGB === 0) return 'unknown';
  const required = model.memoryGB * 2 ** 30;
  return required > budget ? 'too-large' : required > budget * 0.8 ? 'tight' : 'comfortable';
}

function showModelTotal() {
  const selected = [...modelInputs.values()].filter(({ input }) => input.checked);
  const count = selected.length;
  const amount = selected.every(({ model }) => number(model.downloadBytes))
    ? diskSize(selected.reduce((sum, { model }) => sum + model.downloadBytes, 0)) : 'Unknown size';
  els['model-total'].textContent = count ? count + (count === 1 ? ' model' : ' models') + ' · ' + amount + ' to download'
    : 'No starter models selected.';
}

function filterModels() {
  const category = els['model-category'].value;
  for (const { label, modelCategory } of modelInputs.values()) label.hidden = Boolean(category) && modelCategory !== category;
  els.models.scrollTop = 0;
}

function setModels(settings) {
  const budget = settings.hardware?.memory?.modelBudgetBytes;
  const badges = { comfortable: ['Fits budget', 'good'], tight: ['Tight fit', 'caution'],
    'too-large': ['Exceeds budget', 'caution'], unknown: ['Fit unknown', ''] };
  modelInputs.clear();
  els.models.replaceChildren();
  const categories = new Set();
  const names = { chat: 'Chat & Code', image: 'Image', transcribe: 'Speech to Text', video: 'Video', upscale: 'Upscale' };
  const catalog = Array.isArray(settings.models) ? settings.models : [];
  const recommended = model => Boolean(model?.suggested && fitOf(model, budget) !== 'too-large');
  const ordered = [...catalog].sort((a, b) => Number(recommended(b)) - Number(recommended(a)));
  for (const model of ordered) {
    if (!string(model?.id) || modelInputs.has(model.id)) continue;
    const fit = fitOf(model, budget);
    const [fitLabel, fitClass] = badges[fit];
    const label = element('label', '', 'choice model');
    const modelCategory = string(model.category) || names[model.kind] || 'Chat & Code';
    categories.add(modelCategory);
    const input = element('input');
    input.type = 'checkbox';
    input.value = model.id;
    const body = element('span', '', 'choice-body');
    const name = element('span', '', 'model-name');
    name.append(element('strong', string(model.name) || model.id));
    name.append(element('span', modelCategory, 'badge'));
    if (recommended(model)) name.append(element('span', 'Recommended', 'badge good'));
    name.append(element('span', fitLabel, 'badge ' + fitClass));
    body.append(name);
    if (string(model.description)) body.append(element('span', model.description));
    const memory = number(model.memoryGB) && model.memoryGB > 0
      ? 'about ' + decimal.format(model.memoryGB) + ' GiB RAM' : 'RAM estimate unknown';
    body.append(element('span', diskSize(model.downloadBytes) + ' download · ' + memory, 'model-details'));
    if (string(model.reason)) body.append(element('span', model.reason));
    if (string(model.engineRequirement) && model.engineRequirement !== model.reason) body.append(element('small', model.engineRequirement));
    const requirements = (Array.isArray(model.requirements) ? model.requirements : [model.requirements])
      .filter(value => string(value) && value !== model.reason && value !== model.engineRequirement);
    if (requirements.length) body.append(element('span', requirements.join(' ')));
    label.append(input, body);
    els.models.append(label);
    input.addEventListener('change', showModelTotal);
    modelInputs.set(model.id, { input, model, fit, label, modelCategory });
  }
  const all = element('option', 'All categories');
  all.value = '';
  els['model-category'].replaceChildren(all, ...[...categories].map(category => {
    const option = element('option', category);
    option.value = category;
    return option;
  }));
  els['filter-row'].hidden = categories.size < 2;
  const choices = [...modelInputs.values()];
  const note = !choices.length ? 'No starter models are listed. You can continue and add a model later in TIM.'
    : choices.every(({ fit }) => fit === 'too-large') ? 'None of these models fits the current memory budget. Skip models for now, close other apps, or choose a smaller model later. Larger models may fail to load.'
      : choices.every(({ fit }) => fit === 'too-large' || fit === 'unknown')
        ? 'Setup could not confirm a model fits this machine. You can skip models and choose one later in TIM.' : '';
  els['model-fit'].textContent = note;
  els['model-fit'].hidden = !note;
  showModelTotal();
}

async function load() {
  stage = 'loading';
  message();
  els.loading.hidden = false;
  els.components.hidden = true;
  controls();
  try {
    if (!api) throw new Error('Open TIM Studio Setup from the installer to continue.');
    const setup = await api.getSetup();
    if (!setup || typeof setup !== 'object') throw new Error('Setup information is unavailable.');
    directories.local = string(setup.defaultDirectory);
    availableVersion = string(setup.version);
    els.version.textContent = versionLabel(availableVersion);
    els.version.hidden = !els.version.textContent;
    setComponents(setup);
    setModels(setup);
    stage = 'ready';
    els.components.hidden = false;
    if (!setup.desktopAvailable && !setup.cliAvailable) message('This installer contains no apps for this machine.');
  } catch (error) {
    stage = 'error';
    message(errorText(error, 'Could not check this machine. Try again.'));
  } finally {
    els.loading.hidden = true;
    controls();
  }
}

function setImportChoices() {
  const entries = Object.entries(importLabels).filter(([key]) => string(legacy[key]?.dataDir));
  els['import-choices'].replaceChildren();
  if (!entries.length) return;
  for (const [key, title] of [['', 'Start fresh'], ...entries.map(([id, label]) => [id, 'Copy existing ' + label + ' data'])]) {
    const label = element('label', '', 'choice');
    const input = element('input');
    input.type = 'radio';
    input.name = 'import-source';
    input.value = key;
    input.checked = key === importFrom;
    const body = element('span', '', 'choice-body');
    body.append(element('strong', title));
    if (key) body.append(element('span', legacy[key].dataDir, 'path'));
    label.append(input, body);
    els['import-choices'].append(label);
    input.addEventListener('change', () => {
      if (!input.checked || !importAllowed) return;
      importFrom = key;
      void checkPlan();
    });
  }
}

function clearImport() {
  importFrom = '';
  importAllowed = false;
  setImportChoices();
}

function updateReview(input) {
  els['portable-note'].hidden = !input.portable;
  els.directory.textContent = input.directory || 'No folder selected';
  const names = input.modelIds.map(id => modelInputs.get(id)?.model.name || id);
  const installed = versionLabel(plan?.installedVersion), available = versionLabel(plan?.availableVersion || availableVersion);
  els.versions.hidden = !(plan?.operation || installed) || !available;
  els['installed-version'].textContent = installed || (['install', 'migrate'].includes(plan?.operation) ? 'None detected' : 'Unknown');
  els['available-version'].textContent = available;
  els.imports.hidden = !importAllowed || !els['import-choices'].childElementCount;
  const upgrading = Array.isArray(plan?.upgradingComponents) ? plan.upgradingComponents : [];
  pairs(els.review, [
    ['Apps', files({ desktop: input.desktop || upgrading.includes('desktop'), cli: input.cli || upgrading.includes('cli') })],
    ...(upgrading.length ? [['Existing apps to upgrade', upgrading.map(key => importLabels[key]).filter(Boolean).join(' and ')]] : []),
    ['Starter models', names.join(', ') || 'None · add later in TIM'],
    ...(input.importFrom ? [['Copy TIM data from', importLabels[input.importFrom]]] : []),
    ['Install to', string(plan?.target) || 'Waiting for a folder check'],
    ['Space required', diskSize(plan?.requiredBytes)],
    ['Free space', diskSize(plan?.freeBytes)]
  ]);
  issues(els['plan-warnings'], plan?.warnings);
  issues(els['plan-errors'], plan?.errors);
  controls();
}

async function checkPlan() {
  const revision = ++planRevision;
  const input = readSelection();
  plan = null;
  checking = Boolean(input.directory);
  els['plan-status'].textContent = checking ? 'Checking available space and installation requirements…'
    : input.portable ? 'Choose a folder on your external drive to continue.' : 'Choose an installation folder to continue.';
  updateReview(input);
  if (!checking) return false;
  try {
    const value = await api.plan(input);
    if (revision !== planRevision) return false;
    if (!value || typeof value !== 'object' || !Array.isArray(value.errors)) throw new Error('Setup could not check this folder.');
    plan = value;
    importAllowed = !value.installedVersion && ['install', 'migrate'].includes(value.operation);
    if (!importAllowed && importFrom) clearImport();
    if (!string(value.target) && value.errors.length === 0) throw new Error('Setup did not return an installation destination.');
    if (value.operation === 'downgrade') {
      els['plan-status'].textContent = 'This folder has a newer version. Use a newer installer or choose another folder.';
    } else if (value.errors.length) {
      els['plan-status'].textContent = 'Resolve the issues below before continuing.';
    } else {
      els['plan-status'].textContent = {
        upgrade: 'All existing apps in this folder will be upgraded. Your settings, models, and workspace data will be kept.',
        migrate: 'A copy of the selected TIM data will be added to this folder. The original will stay in place.',
        current: 'This version is up to date. You can still add apps or models.',
      }[value.operation] || 'Ready to install. Review your choices before continuing.';
    }
  } catch (error) {
    if (revision !== planRevision) return false;
    plan = { errors: [errorText(error, 'Could not check this folder. Choose another folder or try again.')] };
    els['plan-status'].textContent = '';
  } finally {
    if (revision === planRevision) {
      checking = false;
      updateReview(input);
    }
  }
  return revision === planRevision && canInstall();
}

function destination() {
  showStep(3);
  void checkPlan();
}

async function browse() {
  if (choosing) return;
  const key = locationKey();
  choosing = true;
  message();
  controls();
  let selected = false;
  try {
    const picked = await api.chooseDirectory({ portable: key === 'portable' });
    if (string(picked)) {
      if (directories[key] !== picked) clearImport();
      directories[key] = picked;
      selected = true;
    }
  } catch (error) {
    message(errorText(error, 'Could not open the folder picker. Try again.'));
  } finally {
    choosing = false;
    controls();
  }
  if (selected) void checkPlan();
}

function progress(event = {}) {
  if (installStage !== 'running') return;
  const { phase, label, detail, completedBytes, totalBytes, percent } = event || {};
  const upgrading = installReview?.operation === 'upgrade';
  const title = upgrading && phase === 'copy' ? string(label).replace(/^Installing(?= TIM\b)/, 'Upgrading') : string(label);
  const headline = title || (upgrading ? 'Upgrading TIM Studio…' : 'Installing TIM Studio…');
  let done = number(percent) ? percent : number(completedBytes) && number(totalBytes) && totalBytes > 0
    ? 100 * completedBytes / totalBytes : null;
  if (done !== null) done = Math.min(100, Math.round(done));
  els['progress-label'].textContent = headline;
  els['progress-detail'].textContent = string(detail);
  if (done === null) els.progress.removeAttribute('value');
  else els.progress.value = done;
  const bytes = number(completedBytes) && number(totalBytes) && totalBytes > 0
    ? diskSize(completedBytes) + ' of ' + diskSize(totalBytes) : '';
  els['progress-value'].textContent = [done === null ? '' : done + '%', bytes].filter(Boolean).join(' · ');
  const key = string(phase) + ':' + headline;
  if (key !== lastAnnouncement) {
    lastAnnouncement = key;
    els['progress-announcement'].textContent = headline;
  }
}

function finish(result) {
  installStage = 'done';
  const operation = result.operation || installReview?.operation;
  const upgraded = operation === 'upgrade';
  const version = versionLabel(result.version || installReview?.availableVersion || availableVersion);
  els['heading-4'].textContent = upgraded ? 'TIM Studio has been upgraded' : 'TIM Studio is ready';
  els['install-intro'].textContent = upgraded
    ? 'Your settings, models, and workspace data were kept. Choose what to open.'
    : operation === 'current' ? 'Your selections are ready. Choose what to open.'
      : operation === 'migrate' ? 'Your TIM data was copied. The original installation remains in place. Choose what to open.'
        : 'Installation is complete. Choose what to open.';
  els['progress-panel'].hidden = true;
  els['done-panel'].hidden = false;
  els['done-components'].textContent = files(result) + (version ? ' · ' + version : '');
  els['done-folder'].textContent = result.target;
  els['done-portable'].hidden = !result.portable;
  for (const button of launchButtons) {
    const action = button.dataset.action;
    button.hidden = action !== 'folder' && !result[action];
    button.classList.toggle('primary', action === 'desktop' || action === 'cli' && !result.desktop);
  }
  els['heading-4'].focus();
}

function readReview() {
  return {
    target: string(plan?.target),
    operation: plan?.operation || 'install',
    installedVersion: plan?.installedVersion ?? null,
    availableVersion: plan?.availableVersion || availableVersion,
    upgradingComponents: Array.isArray(plan?.upgradingComponents) ? [...plan.upgradingComponents].sort().join(',') : '',
    importFrom
  };
}

async function startInstall() {
  if (!canInstall() || installStage === 'running') return;
  installReview = readReview();
  const upgrading = installReview.operation === 'upgrade';
  const migrating = installReview.operation === 'migrate';
  const input = { ...readSelection(), reviewedVersion: installReview.installedVersion };
  installAttempt++;
  installStage = 'running';
  cancelRequested = cancelPending = false;
  lastAnnouncement = '';
  els['heading-4'].textContent = upgrading ? 'Upgrading TIM Studio' : migrating ? 'Installing TIM Studio and copying data' : 'Installing TIM Studio';
  els['install-intro'].textContent = upgrading
    ? 'Keep this window open until the upgrade finishes.'
    : 'Keep this window open until setup finishes.';
  els['progress-panel'].hidden = false;
  els['done-panel'].hidden = true;
  els['cancel-status'].hidden = true;
  els['cancel-status'].textContent = '';
  progress({ phase: 'starting', label: upgrading ? 'Starting upgrade…' : 'Starting installation…' });
  showStep(4);
  try {
    const result = await api.install(input);
    if (!result || !string(result.target) || !result.desktop && !result.cli) throw new Error('The installer did not report a completed installation.');
    finish(result);
  } catch (error) {
    const description = errorText(error, 'Setup could not finish. Check the destination and try again.');
    installStage = 'failed';
    const paused = /cancelled|canceled|setup paused/i.test(description);
    els['heading-4'].textContent = (upgrading ? 'Upgrade' : 'Installation') + (paused ? ' paused' : ' stopped');
    els['install-intro'].textContent = 'Your choices are saved in this window. Retry, or go back to change them.';
    els['progress-panel'].hidden = true;
    message(description);
    els['heading-4'].focus();
  } finally {
    cancelRequested = cancelPending = false;
    controls();
  }
}

async function requestCancel() {
  if (installStage !== 'running' || cancelRequested || cancelPending) return;
  const attempt = installAttempt;
  cancelPending = true;
  message();
  els['cancel-status'].hidden = false;
  els['cancel-status'].textContent = 'Requesting cancellation…';
  controls();
  try {
    await api.cancel();
    if (installStage === 'running' && installAttempt === attempt) {
      cancelRequested = true;
      els['cancel-status'].textContent = installReview?.operation === 'upgrade'
        ? 'Waiting for the upgrade to stop…' : 'Waiting for installation to stop…';
    }
  } catch (error) {
    if (installStage === 'running' && installAttempt === attempt) {
      els['cancel-status'].hidden = true;
      message(errorText(error, 'Could not request cancellation. Try again.'));
    }
  } finally {
    if (installAttempt === attempt) {
      cancelPending = false;
      controls();
    }
  }
}

async function retryInstall() {
  if (installStage !== 'failed') return;
  installStage = 'retry-check';
  message();
  controls();
  const ready = await checkPlan();
  if (installStage !== 'retry-check') return;
  const changed = ready && Object.entries(readReview()).some(([key, value]) => value !== installReview?.[key]);
  if (ready && !changed) await startInstall();
  else {
    installStage = 'failed';
    showStep(3);
    if (changed) els['plan-status'].textContent = 'The installation has changed. Review the destination and versions before continuing.';
  }
}

async function open(action) {
  if (installStage !== 'done' || activeLaunch) return;
  const labels = { desktop: 'TIM Desktop', cli: 'TIM CLI', folder: 'the installation folder' };
  if (!Object.hasOwn(labels, action)) return;
  activeLaunch = true;
  message();
  for (const button of launchButtons) button.disabled = true;
  els['open-status'].hidden = false;
  els['open-status'].textContent = 'Opening ' + labels[action] + '…';
  try {
    await api.open({ action });
    els['open-status'].textContent = 'Opened ' + labels[action] + '.';
  } catch (error) {
    els['open-status'].hidden = true;
    message(errorText(error, 'Could not open ' + labels[action] + '. Try again.'));
  } finally {
    activeLaunch = false;
    for (const button of launchButtons) button.disabled = false;
  }
}

for (const field of [els.desktop, els.cli]) field.addEventListener('change', controls);
els['model-category'].addEventListener('change', filterModels);
for (const field of [els.local, els.portable]) field.addEventListener('change', () => {
  message();
  clearImport();
  void checkPlan();
});
els.browse.addEventListener('click', () => { void browse(); });
els.recheck.addEventListener('click', () => { void checkPlan(); });
els.back.addEventListener('click', () => {
  if (step === 4) destination();
  else if (step > 1) showStep(step - 1);
});
els.skip.addEventListener('click', () => {
  for (const { input } of modelInputs.values()) input.checked = false;
  showModelTotal();
  destination();
});
els.next.addEventListener('click', () => {
  if (step === 1) {
    if (stage === 'error') void load();
    else if (readSelection().desktop || readSelection().cli) showStep(2);
  } else if (step === 2) destination();
  else if (step === 3) void startInstall();
  else if (step === 4) void retryInstall();
});
els.cancel.addEventListener('click', () => { void requestCancel(); });
for (const button of launchButtons) button.addEventListener('click', () => { void open(button.dataset.action); });
if (typeof api?.onProgress === 'function') unsubscribe = api.onProgress(progress);
window.addEventListener('pagehide', () => { if (typeof unsubscribe === 'function') unsubscribe(); }, { once: true });
void load();
