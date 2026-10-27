import { useState } from 'react';
import { ArrowRight, AudioLines, Check, CheckCircle2, Code2, Cpu, Download, ExternalLink, HardDrive, Image as ImageIcon, Layers, LoaderCircle, Maximize2, MemoryStick, MessageSquare, RefreshCw, Search, ShieldCheck, Sparkles, Square, Video, X } from 'lucide-react';
import type { CatalogModel, LoadedModel, Model, ModelDownload, State } from './types';
import './model-memory.css';
import './model-discovery.css';

const kindIcons = { chat: MessageSquare, code: Code2, image: ImageIcon, upscale: Maximize2, video: Video, transcribe: AudioLines };
const categories = [{ value: 'all', label: 'All capabilities' }, { value: 'chat', label: 'Chat & coding' }, { value: 'image', label: 'Images & editing' }, { value: 'upscale', label: 'Image upscaling' }, { value: 'video', label: 'Video generation' }, { value: 'transcribe', label: 'Transcription' }];
const GiB = 1024 ** 3;
const bytes = (value: number) => value >= GiB ? `${(value / GiB).toFixed(1)} GiB` : `${Math.max(0, Math.round(value / 1024 ** 2))} MiB`;
const validBytes = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const activeDownload = (download?: ModelDownload) => !!download && ['queued', 'downloading', 'verifying'].includes(download.status);
type Action = (endpoint: string, data?: unknown) => Promise<unknown>;
const memoryBusy = (state: State) => state.loadingModel || state.orchestrator?.status === 'loading' || state.jobs.some(job => ['running', 'queued'].includes(job.status));
const isLoaded = (state: State, id?: string) => !!id && (state.loadedModels ? state.loadedModels.some(model => model.modelId === id) : state.loadedModelId === id || (state.orchestrator?.modelId === id && state.orchestrator.loaded));
type ImageTask = 'all' | 'photorealism' | 'identity';
const imageTasks: { id: ImageTask; label: string }[] = [{ id: 'all', label: 'All tasks' }, { id: 'photorealism', label: 'Photorealism' }, { id: 'identity', label: 'Identity & editing' }];

function ModelLink({ url, children }: { url?: string; children: React.ReactNode }) {
  let href: string | null = null;
  try {
    const parsed = new URL(url || '');
    if (parsed.protocol === 'https:' && parsed.hostname === 'huggingface.co' && !parsed.username && !parsed.password && !parsed.port) href = parsed.href;
  } catch { /* Unsupported source links remain plain text. */ }
  if (!href) return <span>{children}</span>;
  return <a href={href} target="_blank" rel="noopener noreferrer" onClick={event => {
    if (window.timDesktop?.openExternal) { event.preventDefault(); void window.timDesktop.openExternal(href!); }
  }}>{children}<ExternalLink size={10}/></a>;
}

function memorySnapshot(state: State) {
  const memory = state.memory;
  const total = validBytes(memory?.totalBytes) ? memory.totalBytes : validBytes(memory?.total) ? memory.total : null;
  const available = validBytes(memory?.availableBytes) ? Math.min(memory.availableBytes, total ?? Infinity) : memory?.availableBytes === null ? null : validBytes(memory?.free) ? Math.min(memory.free, total ?? Infinity) : null;
  const reserve = validBytes(memory?.reserveBytes) ? memory.reserveBytes : total ? Math.max(GiB, total * .1) : null;
  const used = validBytes(memory?.usedBytes) ? Math.min(memory.usedBytes, total ?? Infinity) : total !== null && available !== null ? total - available : null;
  const budget = validBytes(memory?.modelBudgetBytes) ? memory.modelBudgetBytes : memory?.modelBudgetBytes === null ? null : available !== null && reserve !== null ? Math.max(0, available - reserve) : null;
  return { total, available, used, reserve, budget, stale: !!memory?.stale || memory?.status === 'stale', estimated: memory?.availableSource !== 'os' };
}

function loadedModels(state: State): LoadedModel[] {
  if (state.loadedModels) return state.loadedModels;
  const guideId = state.orchestrator?.loaded ? state.orchestrator.modelId : undefined;
  return [...new Set([guideId, state.loadedModelId].filter((id): id is string => !!id))].map(modelId => {
    const model = state.models.find(item => item.id === modelId);
    const entry = state.catalog?.find(item => item.modelId === modelId);
    return { modelId, name: model?.name || entry?.name || 'Local model', role: modelId === guideId ? 'guide' : 'specialist', rssBytes: null, estimatedBytes: entry?.memoryGB ? entry.memoryGB * GiB : null, memorySource: entry?.memoryGB ? 'estimate' : 'unavailable' };
  });
}

function MemoryPanel({ state, onAction }: { state: State; onAction: Action }) {
  const [pending, setPending] = useState<string | null>(null);
  const snapshot = memorySnapshot(state);
  const models = loadedModels(state);
  const measurable = models.filter(model => validBytes(model.rssBytes));
  const rss = !models.length ? null : validBytes(state.memory?.modelRssBytes) ? state.memory.modelRssBytes : measurable.length ? measurable.reduce((sum, model) => sum + (model.rssBytes || 0), 0) : null;
  const usedPercent = snapshot.total && snapshot.used !== null ? Math.min(100, snapshot.used / snapshot.total * 100) : 0;
  const low = snapshot.budget !== null && snapshot.budget < GiB;
  const format = (value: number | null) => value === null ? 'Unavailable' : bytes(value);
  const unload = async (id: string) => { setPending(id); try { await onAction('models/unload', { id }); } finally { setPending(null); } };
  return <section className={`library-memory ${low ? 'memory-low' : ''}`} aria-labelledby="library-memory-title">
    <div className="memory-panel-heading"><div><MemoryStick size={17}/><h2 id="library-memory-title">Memory on this machine</h2></div><span className={`memory-live ${snapshot.stale ? 'is-stale' : ''}`}><i/>{snapshot.stale ? 'Updating reading…' : 'Live'}</span></div>
    <div className="memory-overview">
      <div className="memory-headroom"><span>{snapshot.estimated ? 'AVAILABLE RAM · ESTIMATE' : 'AVAILABLE RAM'}</span><strong data-testid="memory-available">{format(snapshot.available)}</strong><p>of {format(snapshot.total)} system memory</p></div>
      <div className="memory-system"><div className="memory-usage-label"><span>System memory</span><span data-testid="memory-used">{format(snapshot.used)} in use</span></div><div className="memory-usage-track" role="meter" aria-label="System memory in use" aria-valuemin={0} aria-valuemax={100} aria-valuenow={snapshot.used === null || !snapshot.total ? undefined : Math.round(usedPercent)}><i style={{ width: `${usedPercent}%` }}/></div><div className="memory-usage-key"><span><i/>In use by all apps and system</span><span><i/>Available{snapshot.estimated ? ' (estimate)' : ''}</span></div><div className="memory-budget"><span>{low ? 'Limited room for another model' : 'Planning room for additional models'}</span><strong data-testid="memory-budget">{format(snapshot.budget)}</strong></div><p className="memory-buffer">{snapshot.reserve !== null ? `${bytes(snapshot.reserve)} kept as a safety buffer for TIM and other apps.` : 'Headroom will appear when a host memory reading is available.'}</p></div>
    </div>
    <div className="memory-loaded-heading"><h3>Loaded models <span>{models.length}</span></h3><span>{rss !== null ? `${bytes(rss)} process RAM${measurable.length < models.length ? ' · partial reading' : ''}` : models.length ? 'Process readings unavailable' : 'Ready when you are'}</span></div>
    {models.length ? <ul className="memory-model-list" aria-label="Loaded models">{models.map(model => {
      const guide = model.role === 'guide' || (model.modelId === state.orchestrator?.modelId && state.orchestrator.loaded);
      const measured = validBytes(model.rssBytes);
      const media = model.role === 'media';
      return <li className="memory-model" key={`${model.modelId}-${model.pid || ''}`} data-model-id={model.modelId}><div className={`memory-model-icon ${guide ? 'is-guide' : ''}`}>{guide ? <Sparkles size={15}/> : <Cpu size={15}/>}</div><div className="memory-model-copy"><strong>{model.name}</strong><span>{guide ? 'TIM guide · Always resident' : media ? 'Running task · Unloads when finished' : model.role === 'pipeline-agent' ? 'Pipeline agent · Loaded' : 'Specialist · Loaded'}</span></div><div className="memory-model-size"><strong>{measured ? bytes(model.rssBytes!) : validBytes(model.estimatedBytes) ? `~${bytes(model.estimatedBytes)}` : 'Unavailable'}</strong><span>{measured ? 'Process RAM · RSS' : validBytes(model.estimatedBytes) ? 'Memory estimate' : 'Memory reading'}</span></div>{guide ? <span className="memory-persistent" title="The guide stays loaded to help you choose models."><ShieldCheck size={14}/><span>Persistent</span></span> : media ? <span className="memory-persistent memory-working"><LoaderCircle size={12} className="spin"/><span>Working</span></span> : <button className="memory-unload" aria-label={`Unload ${model.name}`} disabled={!!pending || memoryBusy(state)} title={memoryBusy(state) ? 'Wait for current work to finish before unloading.' : `Release ${model.name} from memory`} onClick={() => void unload(model.modelId)}>{pending === model.modelId ? <LoaderCircle size={12} className="spin"/> : <Square size={10}/>}<span>Unload</span></button>}</li>;
    })}</ul> : <div className="memory-empty"><Layers size={18}/><p>No models loaded yet. Download a model below, then choose <strong>Load into memory</strong>.</p></div>}
    <p className="memory-footnote">{snapshot.available === null ? 'Host memory readings are unavailable. ' : snapshot.stale ? 'Memory details are updating; capacity may have changed. ' : ''}{state.memory?.availableSource === 'reclaimable-estimate' ? 'Available RAM includes potentially reclaimable memory. ' : snapshot.estimated ? 'Only free RAM is reported; reclaimable cache may add room. ' : ''}Load multiple chat models while there is room. Estimates change with context; loading checks memory again. Process RAM includes runtime and shared pages, which can overlap; dedicated GPU memory is separate.</p>
  </section>;
}

export function GuideSetup({ state, onAction, compact = false }: { state: State; onAction: Action; compact?: boolean }) {
  const [pending, setPending] = useState(false);
  const guide = state.orchestrator;
  if (!guide) return null;
  const catalog = state.catalog?.find(model => model.id === guide.catalogId);
  const download = state.downloads?.find(item => item.catalogId === guide.catalogId);
  const downloading = activeDownload(download) || state.runtimeSetup?.status === 'downloading';
  const loading = guide.status === 'loading';
  const busy = pending || downloading || loading;
  const loaded = guide.loaded;
  const issue = guide.error || state.runtimeSetup?.error || download?.error;
  const status = loaded ? 'Your guide is in memory' : downloading ? 'Setting up your local guide' : loading ? 'Loading your guide into memory' : 'Meet your always-ready guide';
  const setup = async () => { setPending(true); try { await onAction('setup', {}); } finally { setPending(false); } };
  return <div className={`guide-setup ${compact ? 'compact' : ''} ${loaded ? 'is-ready' : ''}`} role="status">
    <div className="guide-symbol"><Sparkles size={compact ? 18 : 23}/></div>
    <div className="guide-copy"><div className="guide-eyebrow">TIM GUIDE <span>YOUR DEFAULT AGENT</span></div><h2>{status}</h2>
      <p>{loaded ? `${guide.name || 'Your chosen guide'} stays on the CPU while specialists run alongside it. Choose your default agent in Settings.` : guide.modelId ? `${guide.name || 'Your saved agent'} is your selected guide. Your choice is kept if the model needs setup; change it in Settings.` : `Start with ${catalog?.name || 'a small local model'}, then choose any compatible agent in Settings. It helps you choose models and hands work to specialists.`}</p>
      {!loaded && !busy && <small>{guide.modelId ? guide.memoryGB ? `About ${guide.memoryGB} GiB estimated memory when loaded.` : 'Memory use depends on your selected model.' : `${catalog ? `${bytes(catalog.downloadBytes)} model download · ` : ''}Includes the local chat engine. Internet needed once; runs locally afterward.`}</small>}
      {downloading && <small>{state.runtimeSetup?.status === 'downloading' ? 'Preparing the local chat engine…' : download?.totalBytes ? `${bytes(download.downloadedBytes)} of ${bytes(download.totalBytes)} downloaded` : 'Preparing the model download…'}</small>}
      {issue && <div className="model-issue">{issue}</div>}
    </div>
    {loaded ? <span className="guide-ready"><CheckCircle2 size={15}/> Resident · CPU</span> : <button className="guide-setup-button" disabled={busy} onClick={setup}>{busy ? <LoaderCircle size={15} className="spin"/> : <Download size={15}/>}<span>{downloading ? 'Setting up…' : loading ? 'Loading…' : pending ? 'Starting…' : issue ? 'Retry guide setup' : guide.status === 'ready' ? 'Start TIM guide' : 'Set up TIM guide'}</span></button>}
  </div>;
}

function DownloadProgress({ download, onCancel }: { download: ModelDownload; onCancel: () => void }) {
  const progress = download.totalBytes ? Math.max(0, Math.min(100, download.downloadedBytes / download.totalBytes * 100)) : null;
  return <div className="download-status"><div><span><LoaderCircle size={12} className="spin"/>{download.status === 'queued' ? 'Queued' : download.status === 'verifying' ? 'Verifying download…' : `${bytes(download.downloadedBytes)}${download.totalBytes ? ` / ${bytes(download.totalBytes)}` : ''}`}</span><button title="Cancel download" onClick={onCancel}><X size={14}/></button></div><div className={`progress ${progress === null ? 'indeterminate' : ''}`} role="progressbar" aria-label="Model download" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress ?? undefined}><i style={{ width: `${progress ?? 30}%` }}/></div></div>;
}

function CatalogCard({ entry, state, onAction, onChoose }: { entry: CatalogModel; state: State; onAction: Action; onChoose: (model: Model) => void }) {
  const [pending, setPending] = useState(false);
  const Icon = kindIcons[entry.kind as keyof typeof kindIcons] || Layers;
  const installedModel = state.models.find(model => model.id === entry.modelId);
  const installed = entry.installed || !!installedModel;
  const download = state.downloads?.find(item => item.catalogId === entry.id);
  const downloading = activeDownload(download);
  const resident = state.orchestrator?.modelId === entry.modelId && state.orchestrator?.loaded;
  const loaded = isLoaded(state, entry.modelId) || resident;
  const snapshot = memorySnapshot(state);
  const aboveBudget = !loaded && snapshot.budget !== null && entry.memoryGB * GiB > snapshot.budget;
  const issue = entry.issue || installedModel?.issue;
  const act = async (endpoint: string, data: unknown) => { setPending(true); try { await onAction(endpoint, data); } finally { setPending(false); } };
  const hostname = (() => { try { return new URL(entry.sourceUrl).hostname.replace(/^www\./, ''); } catch { return 'Model publisher'; } })();
  return <article className={`model-card catalog-card ${entry.defaultOrchestrator ? 'recommended' : ''} ${loaded ? 'loaded' : ''}`}>
    <div className="model-card-top"><Icon size={19}/><span>{entry.kind === 'chat' ? 'CHAT / CODE' : entry.kind.toUpperCase()}</span><span className={loaded || installed ? 'available-badge' : 'catalog-badge'}>{loaded ? 'IN MEMORY' : installed ? 'DOWNLOADED' : 'DOWNLOADABLE'}</span></div>
    <h3>{entry.name}</h3>
    {(entry.modelId && entry.modelId === state.config.mainAgentModelId || entry.defaultOrchestrator) && <div className="default-badge"><Sparkles size={11}/>{entry.modelId && entry.modelId === state.config.mainAgentModelId ? 'Your default agent' : 'Starter TIM guide'}</div>}
    <p className="model-description">{entry.description}</p>
    <div className="model-tasks" aria-label="Best for">{entry.bestFor.map(task => <span key={task}>{task}</span>)}</div>
    {entry.kind === 'image' && <div className="model-image-requirements">
      <div className={`model-reference ${entry.requiresReference ? 'is-required' : ''}`}><ImageIcon size={12}/><strong>{entry.requiresReference ? 'Reference image required' : entry.inputMode === 'reference' ? 'Text or reference image' : entry.inputMode === 'img2img' ? 'Text or image-to-image' : 'Text-to-image'}</strong></div>
      {!!entry.requirements?.length && <ul aria-label="Model requirements">{entry.requirements.map(requirement => <li key={requirement}>{requirement}</li>)}</ul>}
      <span className={`model-local-validation ${installedModel?.validation === 'Ran successfully' ? 'is-validated' : ''}`}>{installedModel?.validation === 'Ran successfully' ? <CheckCircle2 size={11}/> : <Cpu size={11}/>}<span>{installedModel?.validation === 'Ran successfully' ? 'Ran successfully on this machine' : installedModel?.validation === 'Last run failed' ? 'Last local run failed' : 'Image inference not yet tested here'}</span></span>
    </div>}
    <div className="model-specs"><span title="Total download size, including companion files"><HardDrive size={13}/><b>{bytes(entry.downloadBytes)}</b> {entry.bundleFiles && entry.bundleFiles > 1 ? `· ${entry.bundleFiles} files` : 'disk'}</span><span title="Estimated memory when loaded; actual usage varies with context and image size"><Cpu size={13}/><b>~{entry.memoryGB} GiB</b> memory</span></div>
    <div className="model-source"><span>{[entry.parameterSize, entry.quantization].filter(Boolean).join(' · ')}</span><span title={entry.license}>{entry.license}</span></div>
    <div className="model-source-links"><ModelLink url={entry.publisherUrl || entry.sourceUrl}>Model card</ModelLink>{entry.publisherUrl && entry.publisherUrl !== entry.sourceUrl && <ModelLink url={entry.sourceUrl}>Download source</ModelLink>}{entry.licenseUrl && <ModelLink url={entry.licenseUrl}>License terms</ModelLink>}<span>{hostname}</span></div>
    {!loaded && <div className={`model-capacity ${aboveBudget ? 'above-budget' : ''}`}><MemoryStick size={12}/><span>{snapshot.budget === null ? 'Live memory headroom unavailable' : aboveBudget ? `Above current ${bytes(snapshot.budget)} planning room · unload a model or free RAM first` : `Within current ${bytes(snapshot.budget)} planning room · estimate only`}</span></div>}
    {issue && <div className="model-issue">{issue}</div>}
    {download?.status === 'failed' && <div className="model-issue" role="alert">Download failed: {download.error || 'Try again when you are online.'}</div>}
    {downloading && download ? <DownloadProgress download={download} onCancel={() => void act('models/cancel', { id: entry.id })}/> : <div className="model-actions">
      {!installed ? <button className="model-download" disabled={pending} onClick={() => void act('models/download', { id: entry.id })}>{pending ? <LoaderCircle size={14} className="spin"/> : <Download size={14}/>}<span>{pending ? 'Starting…' : download?.status === 'failed' ? 'Retry download' : download && ['cancelled', 'paused'].includes(download.status) ? 'Resume download' : 'Download model'}</span></button> : <>
        {resident ? <span className="resident-label"><ShieldCheck size={13}/> Guide stays in memory · CPU</span> : entry.kind === 'chat' && <button className={loaded ? 'model-memory unload-memory' : 'model-memory'} disabled={pending || !installedModel?.available || memoryBusy(state)} title={memoryBusy(state) ? 'Wait for current work to finish before changing models in memory.' : aboveBudget ? 'This estimate exceeds current headroom. Loading checks available memory again.' : undefined} onClick={() => void act(loaded ? 'models/unload' : 'models/load', { id: entry.modelId })}>{pending ? <LoaderCircle size={14} className="spin"/> : loaded ? <Square size={12}/> : <Cpu size={14}/>}<span>{loaded ? 'Unload' : 'Load into memory'}</span></button>}
        <button className="model-use" disabled={!installedModel?.available} onClick={() => installedModel && onChoose(installedModel)}>Use model <ArrowRight size={14}/></button>
      </>}
    </div>}
  </article>;
}

function LocalCard({ model, state, onChoose, onAction }: { model: Model; state: State; onChoose: (model: Model) => void; onAction: Action }) {
  const [pending, setPending] = useState(false);
  const Icon = kindIcons[model.kind as keyof typeof kindIcons] || Layers;
  const resident = state.orchestrator?.modelId === model.id && state.orchestrator.loaded;
  const loaded = isLoaded(state, model.id) || resident;
  const load = async () => { setPending(true); try { await onAction(loaded ? 'models/unload' : 'models/load', { id: model.id }); } finally { setPending(false); } };
  return <article className={`model-card ${!model.available ? 'unavailable' : ''} ${loaded ? 'loaded' : ''}`}><div className="model-card-top"><Icon size={20}/><span>{model.kind.toUpperCase()}</span><span className={model.available ? 'available-badge' : 'missing-badge'}>{loaded ? 'IN MEMORY' : model.available ? 'LOCAL FILE' : 'NEEDS SETUP'}</span></div><h3>{model.name}</h3><p>{model.size ? bytes(model.size) : 'Engine model'} · {model.validation}</p><small title={model.relativePath}>{model.relativePath}</small>{model.issue && <div className="model-issue">{model.issue}</div>}<div className="model-actions">{resident && <span className="resident-label"><ShieldCheck size={13}/> Guide stays in memory · CPU</span>}{model.kind === 'chat' && !resident && <button className="model-memory" disabled={!model.available || pending || memoryBusy(state)} title={memoryBusy(state) ? 'Wait for current work to finish before changing models in memory.' : undefined} onClick={load}>{pending ? <LoaderCircle size={14} className="spin"/> : <Cpu size={14}/>} {loaded ? 'Unload' : 'Load into memory'}</button>}<button className="model-use" onClick={() => onChoose(model)} disabled={!model.available}>Use model <ArrowRight size={14}/></button></div></article>;
}

export default function ModelLibrary({ state, onAction, onChoose, error, onDismissError, onSettings }: { state: State | null; onAction: Action; onChoose: (model: Model) => void; error: string; onDismissError: () => void; onSettings: () => void }) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('all');
  const [imageTask, setImageTask] = useState<ImageTask>('all');
  const [tab, setTab] = useState<'all' | 'discover' | 'installed'>('all');
  const [rescanning, setRescanning] = useState(false);
  const catalog = state?.catalog || [];
  const matching = (entry: Pick<CatalogModel, 'name' | 'kind'> & Partial<CatalogModel>) => (kind === 'all' || entry.kind === kind) && (imageTask === 'all' || entry.kind === 'image' && (imageTask === 'photorealism' ? entry.imageUseCases?.includes('photorealism') : entry.imageUseCases?.some(item => item === 'identity' || item === 'reference-editing') || entry.inputMode === 'reference')) && [entry.name, entry.description, ...entry.bestFor || [], ...entry.requirements || []].join(' ').toLowerCase().includes(query.trim().toLowerCase());
  const visibleCatalog = catalog.filter(entry => matching(entry) && (tab === 'all' || (tab === 'installed' ? entry.installed : !entry.installed)));
  const catalogModelIds = new Set(catalog.map(entry => entry.modelId).filter(Boolean));
  const locals = tab === 'discover' ? [] : state?.models.filter(model => !catalogModelIds.has(model.id) && matching(model)) || [];
  const installedCount = state?.models.length || 0;
  const downloadingCount = state?.downloads?.filter(activeDownload).length || 0;
  const rescan = async () => { setRescanning(true); try { await onAction('rescan', {}); } finally { setRescanning(false); } };
  return <div className="model-library-content">
    <div className="library-intro"><div><h2>Find the right model for your next idea.</h2><p>Download once to your machine. Load when you need it. Your work stays local.</p></div><span><HardDrive size={14}/>{installedCount} installed</span></div>
    {state && <div className="library-guide"><GuideSetup state={state} onAction={onAction} compact/></div>}
    {state && <MemoryPanel state={state} onAction={onAction}/>}
    <div className="library-tabs" role="tablist" aria-label="Model library view">{([{ id: 'all', label: 'All models' }, { id: 'discover', label: 'Discover' }, { id: 'installed', label: 'Installed' }] as const).map(item => <button role="tab" aria-selected={tab === item.id} key={item.id} onClick={() => setTab(item.id)}>{item.id === 'discover' ? <Sparkles size={13}/> : item.id === 'installed' ? <Check size={13}/> : <Layers size={13}/>} {item.label}{item.id === 'installed' && <span>{installedCount}</span>}</button>)}{downloadingCount > 0 && <span className="library-download-count"><LoaderCircle size={12} className="spin"/> {downloadingCount} downloading</span>}</div>
    <div className="library-toolbar"><label className="search-box"><Search size={15}/><input aria-label="Search models" placeholder="Search models, tasks, or capabilities…" value={query} onChange={event => setQuery(event.target.value)}/></label><select aria-label="Model category" value={kind} onChange={event => { setKind(event.target.value); if (event.target.value !== 'image') setImageTask('all'); }}>{categories.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select><button className="outline-button" disabled={rescanning} onClick={rescan}><RefreshCw size={14} className={rescanning ? 'spin' : ''}/> Rescan</button></div>
    {catalog.some(entry => entry.imageUseCases?.length) && <div className="library-task-filters" role="group" aria-label="Explore models by task"><span>EXPLORE BY TASK</span>{imageTasks.map(task => <button key={task.id} aria-pressed={imageTask === task.id} onClick={() => { setImageTask(task.id); setKind(task.id === 'all' ? 'all' : 'image'); setQuery(''); setTab('all'); }}>{task.id === 'photorealism' ? <ImageIcon size={12}/> : task.id === 'identity' ? <Sparkles size={12}/> : <Layers size={12}/>} {task.label}</button>)}</div>}
    {error && <div className="error-banner library-error" role="alert"><span>{error}</span><button title="Dismiss error" onClick={onDismissError}><X size={15}/></button></div>}
    <p className="library-description">{tab === 'installed' ? 'Your downloaded models and connected library. Chat models can be preloaded; media engines load on first use.' : 'A curated catalog with local download recipes. Check engine requirements before downloading; successful local runs validate image inference.'}</p>
    {(kind === 'image' || imageTask !== 'all') && <div className="library-image-guidance"><ImageIcon size={17}/><div><strong>{imageTask === 'identity' ? 'Keep the subject. Change the scene.' : 'Choose an image model for your machine.'}</strong><p>{imageTask === 'identity' ? 'Use a reference photo with an editing model for subject consistency. Identity retention varies by model and edit; a seed alone does not preserve a face.' : 'Download sizes include the listed companion files. Memory grows with image resolution; reference editing needs a photo and a compatible local image engine.'}</p></div></div>}
    {state ? <div className="model-grid">{visibleCatalog.map(entry => <CatalogCard key={entry.id} entry={entry} state={state} onAction={onAction} onChoose={onChoose}/>)}{locals.map(model => <LocalCard key={model.id} model={model} state={state} onChoose={onChoose} onAction={onAction}/>)}</div> : <div className="empty-library"><LoaderCircle size={20} className="spin"/><p>Loading your model library…</p></div>}
    {state && !visibleCatalog.length && !locals.length && <div className="empty-library"><Layers size={27}/><h3>{tab === 'installed' && !installedCount ? 'Your local collection starts here.' : 'No matching models.'}</h3><p>{tab === 'installed' && !installedCount ? 'Discover models for writing, coding, images, and more.' : 'Try another search or capability.'}</p>{tab === 'installed' && <button className="outline-button" onClick={() => { setQuery(''); setKind('all'); setImageTask('all'); setTab('discover'); }}>Explore the catalog <ArrowRight size={14}/></button>}</div>}
    <div className="library-storage"><HardDrive size={15}/><div><strong>MODEL STORAGE</strong><span>{state?.libraryRoot || (state ? `${state.dataDir}/models` : 'Your local machine')}</span></div><button onClick={onSettings}>Connect existing library <ArrowRight size={13}/></button></div>
  </div>;
}
