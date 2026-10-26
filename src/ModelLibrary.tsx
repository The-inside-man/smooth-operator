import { useState } from 'react';
import { ArrowRight, AudioLines, Check, CheckCircle2, Code2, Cpu, Download, HardDrive, Image as ImageIcon, Layers, LoaderCircle, Maximize2, MessageSquare, RefreshCw, Search, ShieldCheck, Sparkles, Square, Video, X } from 'lucide-react';
import type { CatalogModel, Model, ModelDownload, State } from './types';

const kindIcons = { chat: MessageSquare, code: Code2, image: ImageIcon, upscale: Maximize2, video: Video, transcribe: AudioLines };
const categories = [{ value: 'all', label: 'All capabilities' }, { value: 'chat', label: 'Chat & coding' }, { value: 'image', label: 'Image generation' }, { value: 'upscale', label: 'Image upscaling' }, { value: 'video', label: 'Video generation' }, { value: 'transcribe', label: 'Transcription' }];
const bytes = (value: number) => value >= 1024 ** 3 ? `${(value / 1024 ** 3).toFixed(1)} GB` : `${Math.max(1, Math.round(value / 1024 ** 2))} MB`;
const activeDownload = (download?: ModelDownload) => !!download && ['queued', 'downloading', 'verifying'].includes(download.status);
type Action = (endpoint: string, data?: unknown) => Promise<unknown>;
const memoryBusy = (state: State) => state.loadingModel || state.orchestrator?.status === 'loading' || state.jobs.some(job => ['running', 'queued'].includes(job.status));

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
    <div className="guide-copy"><div className="guide-eyebrow">TIM GUIDE <span>DEFAULT ORCHESTRATOR</span></div><h2>{status}</h2>
      <p>{loaded ? 'Ask TIM what to use. Your lightweight guide stays on the CPU while specialists run alongside it.' : `Start with ${catalog?.name || 'a small local model'}. It helps you choose models and hands work to specialists, with about ${guide.memoryGB || catalog?.memoryGB || 1} GB of memory reserved.`}</p>
      {!loaded && !busy && <small>{catalog ? `${bytes(catalog.downloadBytes)} model download · ` : ''}Includes the local chat engine. Internet needed once; runs locally afterward.</small>}
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
  const loaded = state.loadedModelId === entry.modelId || resident;
  const reserveGB = entry.defaultOrchestrator ? 1 : (state.orchestrator?.memoryGB || 1.6) + 1;
  const tooLarge = entry.memoryGB + reserveGB > state.memory.total / 1024 ** 3;
  const issue = entry.issue || installedModel?.issue;
  const act = async (endpoint: string, data: unknown) => { setPending(true); try { await onAction(endpoint, data); } finally { setPending(false); } };
  const hostname = (() => { try { return new URL(entry.sourceUrl).hostname.replace(/^www\./, ''); } catch { return 'Model publisher'; } })();
  return <article className={`model-card catalog-card ${entry.defaultOrchestrator ? 'recommended' : ''} ${loaded ? 'loaded' : ''}`}>
    <div className="model-card-top"><Icon size={19}/><span>{entry.kind === 'chat' ? 'CHAT / CODE' : entry.kind.toUpperCase()}</span><span className={loaded || installed ? 'available-badge' : 'catalog-badge'}>{loaded ? 'IN MEMORY' : installed ? 'DOWNLOADED' : 'DOWNLOADABLE'}</span></div>
    <h3>{entry.name}</h3>
    {entry.defaultOrchestrator && <div className="default-badge"><Sparkles size={11}/> Default TIM guide</div>}
    <p className="model-description">{entry.description}</p>
    <div className="model-tasks" aria-label="Best for">{entry.bestFor.map(task => <span key={task}>{task}</span>)}</div>
    <div className="model-specs"><span title="Download size"><HardDrive size={13}/><b>{bytes(entry.downloadBytes)}</b> disk</span><span title="Estimated memory when loaded"><Cpu size={13}/><b>~{entry.memoryGB} GB</b> memory</span></div>
    <div className="model-source"><span>{[entry.parameterSize, entry.quantization].filter(Boolean).join(' · ')}</span><span title={`${entry.license} · ${entry.sourceUrl}`}>{entry.license} · {hostname}</span></div>
    {tooLarge && <div className="model-issue">This model leaves too little room for TIM and other apps on this {bytes(state.memory.total)} machine. Choose a smaller model to run here.</div>}
    {issue && <div className="model-issue">{issue}</div>}
    {download?.status === 'failed' && <div className="model-issue" role="alert">Download failed: {download.error || 'Try again when you are online.'}</div>}
    {downloading && download ? <DownloadProgress download={download} onCancel={() => void act('models/cancel', { id: entry.id })}/> : <div className="model-actions">
      {!installed ? <button className="model-download" disabled={pending} onClick={() => void act('models/download', { id: entry.id })}>{pending ? <LoaderCircle size={14} className="spin"/> : <Download size={14}/>}<span>{pending ? 'Starting…' : download?.status === 'failed' ? 'Retry download' : download && ['cancelled', 'paused'].includes(download.status) ? 'Resume download' : 'Download model'}</span></button> : <>
        {resident ? <span className="resident-label"><ShieldCheck size={13}/> Guide stays in memory · CPU</span> : entry.kind === 'chat' && <button className={loaded ? 'model-memory unload-memory' : 'model-memory'} disabled={pending || !installedModel?.available || memoryBusy(state) || (!loaded && tooLarge)} title={memoryBusy(state) ? 'Wait for current work to finish before changing models in memory.' : tooLarge ? 'Choose a smaller model for this machine.' : undefined} onClick={() => void act(loaded ? 'models/unload' : 'models/load', { id: entry.modelId })}>{pending ? <LoaderCircle size={14} className="spin"/> : loaded ? <Square size={12}/> : <Cpu size={14}/>}<span>{loaded ? 'Unload' : 'Load into memory'}</span></button>}
        <button className="model-use" disabled={!installedModel?.available} onClick={() => installedModel && onChoose(installedModel)}>Use model <ArrowRight size={14}/></button>
      </>}
    </div>}
  </article>;
}

function LocalCard({ model, state, onChoose, onAction }: { model: Model; state: State; onChoose: (model: Model) => void; onAction: Action }) {
  const [pending, setPending] = useState(false);
  const Icon = kindIcons[model.kind as keyof typeof kindIcons] || Layers;
  const resident = state.orchestrator?.modelId === model.id && state.orchestrator.loaded;
  const loaded = state.loadedModelId === model.id || resident;
  const load = async () => { setPending(true); try { await onAction(loaded ? 'models/unload' : 'models/load', { id: model.id }); } finally { setPending(false); } };
  return <article className={`model-card ${!model.available ? 'unavailable' : ''} ${loaded ? 'loaded' : ''}`}><div className="model-card-top"><Icon size={20}/><span>{model.kind.toUpperCase()}</span><span className={model.available ? 'available-badge' : 'missing-badge'}>{loaded ? 'IN MEMORY' : model.available ? 'LOCAL FILE' : 'NEEDS SETUP'}</span></div><h3>{model.name}</h3><p>{model.size ? bytes(model.size) : 'Engine model'} · {model.validation}</p><small title={model.relativePath}>{model.relativePath}</small>{model.issue && <div className="model-issue">{model.issue}</div>}<div className="model-actions">{resident && <span className="resident-label"><ShieldCheck size={13}/> Guide stays in memory · CPU</span>}{model.kind === 'chat' && !resident && <button className="model-memory" disabled={!model.available || pending || memoryBusy(state)} title={memoryBusy(state) ? 'Wait for current work to finish before changing models in memory.' : undefined} onClick={load}>{pending ? <LoaderCircle size={14} className="spin"/> : <Cpu size={14}/>} {loaded ? 'Unload' : 'Load into memory'}</button>}<button className="model-use" onClick={() => onChoose(model)} disabled={!model.available}>Use model <ArrowRight size={14}/></button></div></article>;
}

export default function ModelLibrary({ state, onAction, onChoose, error, onDismissError, onSettings }: { state: State | null; onAction: Action; onChoose: (model: Model) => void; error: string; onDismissError: () => void; onSettings: () => void }) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('all');
  const [tab, setTab] = useState<'all' | 'discover' | 'installed'>('all');
  const [rescanning, setRescanning] = useState(false);
  const catalog = state?.catalog || [];
  const matching = (entry: { name: string; kind: string; description?: string; bestFor?: string[] }) => (kind === 'all' || entry.kind === kind) && [entry.name, entry.description, ...entry.bestFor || []].join(' ').toLowerCase().includes(query.trim().toLowerCase());
  const visibleCatalog = catalog.filter(entry => matching(entry) && (tab === 'all' || (tab === 'installed' ? entry.installed : !entry.installed)));
  const catalogModelIds = new Set(catalog.map(entry => entry.modelId).filter(Boolean));
  const locals = tab === 'discover' ? [] : state?.models.filter(model => !catalogModelIds.has(model.id) && matching(model)) || [];
  const installedCount = state?.models.length || 0;
  const downloadingCount = state?.downloads?.filter(activeDownload).length || 0;
  const rescan = async () => { setRescanning(true); try { await onAction('rescan', {}); } finally { setRescanning(false); } };
  return <div className="model-library-content">
    <div className="library-intro"><div><h2>Find the right model for your next idea.</h2><p>Download once to your machine. Load when you need it. Your work stays local.</p></div><span><HardDrive size={14}/>{installedCount} installed</span></div>
    {state && <div className="library-guide"><GuideSetup state={state} onAction={onAction} compact/></div>}
    <div className="library-tabs" role="tablist" aria-label="Model library view">{([{ id: 'all', label: 'All models' }, { id: 'discover', label: 'Discover' }, { id: 'installed', label: 'Installed' }] as const).map(item => <button role="tab" aria-selected={tab === item.id} key={item.id} onClick={() => setTab(item.id)}>{item.id === 'discover' ? <Sparkles size={13}/> : item.id === 'installed' ? <Check size={13}/> : <Layers size={13}/>} {item.label}{item.id === 'installed' && <span>{installedCount}</span>}</button>)}{downloadingCount > 0 && <span className="library-download-count"><LoaderCircle size={12} className="spin"/> {downloadingCount} downloading</span>}</div>
    <div className="library-toolbar"><label className="search-box"><Search size={15}/><input aria-label="Search models" placeholder="Search models, tasks, or capabilities…" value={query} onChange={event => setQuery(event.target.value)}/></label><select aria-label="Model category" value={kind} onChange={event => setKind(event.target.value)}>{categories.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select><button className="outline-button" disabled={rescanning} onClick={rescan}><RefreshCw size={14} className={rescanning ? 'spin' : ''}/> Rescan</button></div>
    {error && <div className="error-banner library-error" role="alert"><span>{error}</span><button title="Dismiss error" onClick={onDismissError}><X size={15}/></button></div>}
    <p className="library-description">{tab === 'installed' ? 'Your downloaded models and connected library. Chat models can be preloaded; media engines load on first use.' : 'A curated catalog of compatible models. Memory estimates vary with context and output size; leave room for TIM and your other apps.'}</p>
    {state ? <div className="model-grid">{visibleCatalog.map(entry => <CatalogCard key={entry.id} entry={entry} state={state} onAction={onAction} onChoose={onChoose}/>)}{locals.map(model => <LocalCard key={model.id} model={model} state={state} onChoose={onChoose} onAction={onAction}/>)}</div> : <div className="empty-library"><LoaderCircle size={20} className="spin"/><p>Loading your model library…</p></div>}
    {state && !visibleCatalog.length && !locals.length && <div className="empty-library"><Layers size={27}/><h3>{tab === 'installed' && !installedCount ? 'Your local collection starts here.' : 'No matching models.'}</h3><p>{tab === 'installed' && !installedCount ? 'Discover models for writing, coding, images, and more.' : 'Try another search or capability.'}</p>{tab === 'installed' && <button className="outline-button" onClick={() => { setQuery(''); setKind('all'); setTab('discover'); }}>Explore the catalog <ArrowRight size={14}/></button>}</div>}
    <div className="library-storage"><HardDrive size={15}/><div><strong>MODEL STORAGE</strong><span>{state?.libraryRoot || (state ? `${state.dataDir}/models` : 'Your local machine')}</span></div><button onClick={onSettings}>Connect existing library <ArrowRight size={13}/></button></div>
  </div>;
}
