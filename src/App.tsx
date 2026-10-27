import { useEffect, useRef, useState } from 'react';
import { Activity, ArrowDown, ArrowRight, AudioLines, Check, CheckCircle2, ChevronDown, ChevronRight, Code2, Copy, Cpu, Download, FolderOpen, HardDrive, Image as ImageIcon, Layers, Library, LoaderCircle, MessageSquare, Monitor, Paperclip, Plus, Radio, RefreshCw, Search, Send, Settings2, SlidersHorizontal, Sparkles, Square, Terminal, Trash2, Upload, Video, Waves, X, Zap, Maximize2 } from 'lucide-react';
import type { Config, Message, Mode, Model, State } from './types';
import ModelLibrary, { GuideSetup } from './ModelLibrary';
import PipelineWorkspace from './PipelineWorkspace';
import ContextNotice from './ContextNotice';
import ModelDefaults, { modeLabels } from './ModelDefaults';
const icons = { agent: Sparkles, chat: MessageSquare, code: Code2, image: ImageIcon, upscale: Maximize2, video: Video, transcribe: AudioLines };
const modes: { id: Mode; label: string; hint: string }[] = [
  { id: 'agent', label: 'Agent', hint: 'Ask TIM to help or delegate to a local specialist.' },
  { id: 'chat', label: 'Chat', hint: 'Ask, explore, or work through an idea…' },
  { id: 'code', label: 'Code', hint: 'Describe the code you want to build…' },
  { id: 'image', label: 'Image', hint: 'Describe an image. Attach one to edit it…' },
  { id: 'upscale', label: 'Upscale', hint: 'Attach an image for a 4× upscale…' },
  { id: 'video', label: 'Video', hint: 'Describe a short video or animate an attached image…' },
  { id: 'transcribe', label: 'Audio', hint: 'Attach a WAV recording to transcribe locally…' }
];
const size = (n: number) => n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : `${(n / 1024 ** 2).toFixed(1)} MB`;
const short = (s: string, length = 27) => s.length > length ? s.slice(0, length - 1) + '…' : s;
async function api(endpoint: string, data?: unknown) {
  const response = await fetch('/api/' + endpoint, data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tim-Request': '1' }, body: JSON.stringify(data) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Request failed'); return result;
}
function Logo({ small = false }: { small?: boolean }) { return <span className={`logo-mark ${small ? 'small' : ''}`}><Zap size={small ? 17 : 25} fill="currentColor" /></span>; }
function NeonScene() {
  return <svg className="neon-scene" viewBox="0 0 800 260" aria-hidden="true">
    <defs><linearGradient id="sun" x2="0" y2="1"><stop stopColor="#f34bce"/><stop offset="1" stopColor="#6545ea" stopOpacity=".05"/></linearGradient><linearGradient id="fade" x2="0" y2="1"><stop stopColor="#37daf5" stopOpacity="0"/><stop offset="1" stopColor="#704ff2" stopOpacity=".8"/></linearGradient></defs>
    <circle cx="400" cy="118" r="89" fill="url(#sun)"/>
    {[133,145,158,173,191].map(y => <rect key={y} x="300" y={y} width="200" height="5" fill="#0b0d22"/>)}
    <g fill="#0b0d22" stroke="#354574" strokeWidth="1"><path d="M0 193V171H30V142H64V184H100V127H132V163H166V109H180V91H193V109H208V185H240V145H268V196H303V160H326V199H470V173H496V131H520V174H543V104H559V83H575V104H592V166H619V137H658V182H695V125H722V156H748V190H800V260H0Z"/></g>
    <g stroke="url(#fade)" strokeWidth=".7">{Array.from({length: 15}, (_,i) => <path key={i} d={`M400 197L${i * 100 - 300} 260`}/>)}{[202,210,224,245].map(y => <path key={y} d={`M0 ${y}H800`}/>)}</g>
    <path d="M0 197H800" stroke="#26d9ea" strokeOpacity=".7"/><g fill="#30d9e6">{[105,113,172,184,550,567,703,710].map((x,i)=><rect key={x} x={x} y={140+i%3*10} width="3" height="5" opacity=".7"/>)}</g>
  </svg>;
}
function TextBody({ text }: { text: string }) {
  return <div className="message-text">{text.split(/```/g).map((part, i) => i % 2 ? <div className="code-block" key={i}><div className="code-bar"><span>{part.split('\n')[0] || 'CODE'}</span><button title="Copy code" onClick={() => navigator.clipboard.writeText(part.slice(part.indexOf('\n') + 1))}><Copy size={13}/> Copy</button></div><pre>{part.slice(part.indexOf('\n') + 1)}</pre></div> : <span key={i}>{part}</span>)}</div>;
}
function MessageCard({ message, phase, onUse, onError }: { message: Message; phase?: string; onUse: (file: string, mode: Mode) => void; onError: (s: string) => void }) {
  const running = message.status === 'running' || message.status === 'queued';
  const artifact = message.artifact;
  const emptyCompleted = message.role === 'assistant' && message.status === 'completed' && !message.content?.trim() && !artifact && !message.steps?.length;
  const download = async () => { try { if (window.timDesktop) await window.timDesktop.saveOutput(artifact!.filename); else { const a = document.createElement('a'); a.href = `/api/files/${artifact!.filename}?download=1`; a.download = artifact!.filename; a.click(); } } catch (e) { onError((e as Error).message); } };
  return <article className={`message ${message.role}`}>
    <div className="avatar">{message.role === 'user' ? <Terminal size={17}/> : <Logo small/>}</div>
    <div className="message-main"><div className="message-heading"><strong>{message.role === 'user' ? 'You' : 'TIM'}</strong>{message.model && <span className="model-tag">{short(message.model, 39)}</span>}<time>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div>
      {message.content && <TextBody text={message.content}/>}
      <ContextNotice usage={message.contextUsage}/>
      {!!message.attachments?.length && <div className="attachment-note"><Paperclip size={12}/>{message.attachments.length} attached file{message.attachments.length > 1 ? 's' : ''}</div>}
      {running && <div className="working"><LoaderCircle size={13} className="spin"/>{phase || 'Queued'}</div>}
      {(message.error || emptyCompleted) && <div className="message-error">{message.error || 'No answer was returned for this completed job. Please send the request again.'}</div>}
      {message.status === 'interrupted' && <div className="message-error">Interrupted when the app closed. Submit again to retry.</div>}
      {message.status === 'cancelled' && !message.error && <div className="attachment-note">Cancelled.</div>}
      {artifact && <div className="artifact"><div className="artifact-title"><span><span className="live-dot"/> {artifact.kind.toUpperCase()} OUTPUT</span><span>{size(artifact.size)}</span></div>{artifact.kind === 'image' && <img src={'/api/files/' + artifact.filename} alt="Generated output"/>}{artifact.kind === 'video' && <video controls src={'/api/files/' + artifact.filename}/>}
        <div className="artifact-actions"><button onClick={download}><Download size={14}/> Save output</button>{artifact.kind === 'image' && <><button onClick={() => onUse(artifact.filename, 'upscale')}><Maximize2 size={14}/> Upscale 4×</button><button onClick={() => onUse(artifact.filename, 'image')}><SlidersHorizontal size={14}/> Edit</button><button onClick={() => onUse(artifact.filename, 'video')}><Video size={14}/> Animate</button></>}</div>
      </div>}
      {!!message.steps?.length && <details open><summary>Specialist steps ({message.steps.length}) · media not visually inspected</summary>{message.steps.map(step => <MessageCard key={step.id} message={{ id: step.id, role: 'assistant', content: step.result?.text || step.phase, model: step.modelName, status: step.status, error: step.result?.error, artifact: step.result?.artifact, createdAt: message.createdAt, contextUsage: step.contextUsage }} phase={step.phase} onUse={onUse} onError={onError}/>)}</details>}
    </div>
  </article>;
}
function App() {
  const [workspace, setWorkspace] = useState<'chat' | 'pipelines'>('chat');
  const [pipelineVisited, setPipelineVisited] = useState(false);
  const [pipelineRunRequest, setPipelineRunRequest] = useState<{ runId: string; sequence: number } | null>(null);
  const openPipelines = (runId?: string) => { setPipelineVisited(true); if (runId) setPipelineRunRequest(current => ({ runId, sequence: (current?.sequence || 0) + 1 })); setWorkspace('pipelines'); };
  const [state, setState] = useState<State | null>(null), [connected, setConnected] = useState(false), [error, setError] = useState('');
  const [mode, setMode] = useState<Mode>('agent'), [selected, setSelected] = useState<Record<string, string>>({}), [sessionId, setSessionId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState(''), [attachments, setAttachments] = useState<{ filename: string; name: string }[]>([]), [sending, setSending] = useState(false);
  const [modal, setModal] = useState<'settings' | 'library' | null>(null), [query, setQuery] = useState('');
  const [generationOpen, setGenerationOpen] = useState(false), [generation, setGeneration] = useState({ width: 512, height: 512, seed: -1, steps: '', cfg: '', frames: 33, negativePrompt: '' });
  const [config, setConfig] = useState<Config | null>(null), [saving, setSaving] = useState(false), [uploading, setUploading] = useState(false);
  const defaultsInitialized = useRef(false);
  const [savingDefault, setSavingDefault] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null), promptRef = useRef<HTMLTextAreaElement>(null), fileRef = useRef<HTMLInputElement>(null), following = useRef(true);
  useEffect(() => {
    api('state').then(setState).catch(e => setError(e.message));
    const events = new EventSource('/api/events');
    events.onmessage = e => { setState(JSON.parse(e.data)); setConnected(true); };
    events.onerror = () => setConnected(false);
    return () => events.close();
  }, []);
  useEffect(() => { if (state && sessionId === null && state.sessions.length) setSessionId(state.sessions[0].id); }, [state, sessionId]);
  useEffect(() => { if (state && !defaultsInitialized.current) { defaultsInitialized.current = true; setMode(state.config.defaultMode || 'agent'); } }, [state]);
  const session = state?.sessions.find(s => s.id === sessionId);
  useEffect(() => { if (following.current && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [session?.messages, workspace]);
  useEffect(() => { const keyboard = (event: KeyboardEvent) => { if (event.key === 'Escape') setModal(null); }; document.addEventListener('keydown', keyboard); return () => document.removeEventListener('keydown', keyboard); }, []);
  const kind = mode === 'code' || mode === 'agent' ? 'chat' : mode;
  const models = state?.models.filter(m => m.kind === kind) || [];
  const defaultModelId = mode === 'agent' ? state?.config.mainAgentModelId || state?.orchestrator?.modelId : state?.config.defaultModels?.[mode];
  const selectedId = mode === 'agent' ? defaultModelId : selected[mode] || defaultModelId;
  const model = selectedId ? models.find(m => m.id === selectedId && m.available) : mode === 'agent' ? undefined : models.find(m => m.available);
  const missingDefault = !!defaultModelId && !model && (mode === 'agent' || !selected[mode]);
  const isDefault = !!model && model.id === defaultModelId;
  useEffect(() => {
    if (kind === 'image' && model) setGeneration(current => ({ ...current, width: model.defaults?.width || 512, height: model.defaults?.height || 512, steps: '', cfg: '' }));
  }, [model?.id, kind]);
  const activeJobs = state?.jobs.filter(j => ['running', 'queued'].includes(j.status)) || [];
  const readyCount = state?.models.filter(m => m.available).length || 0;
  const selectMode = (next: Mode) => { setMode(next); setGeneration(g => ({ ...g, height: next === 'video' ? 288 : 512, steps: '', cfg: '' })); promptRef.current?.focus(); };
  const run = async (action: () => Promise<unknown>) => { try { setError(''); await action(); } catch (e) { setError((e as Error).message); } };
  const newSession = () => run(async () => { const result = await api('sessions', {}); setSessionId(result.id); setPrompt(''); setAttachments([]); following.current = true; });
  const upload = async (files: FileList | File[] | null) => {
    if (!files?.length) return;
    setUploading(true); await run(async () => {
      const uploaded: { filename: string; name: string }[] = [];
      for (const file of Array.from(files)) {
        if (file.size > 32 * 1024 * 1024) throw new Error('Choose a file smaller than 32 MB.');
        const base64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file); });
        uploaded.push(await api('upload', { name: file.name, base64 }));
      }
      setAttachments(current => [...current, ...uploaded]);
    }); setUploading(false); if (fileRef.current) fileRef.current.value = '';
  };
  const submit = async () => {
    if (sending || uploading || !model) return;
    setSending(true); await run(async () => {
      const job = await api('jobs', { kind: mode, sessionId, modelId: model.id, prompt, attachments: attachments.map(a => a.filename), settings: { ...generation, steps: generation.steps ? Number(generation.steps) : undefined, cfg: generation.cfg ? Number(generation.cfg) : undefined } });
      setSessionId(job.sessionId); setPrompt(''); setAttachments([]); following.current = true;
    }); setSending(false);
  };
  const useOutput = (filename: string, next: Mode) => run(async () => { const uploaded = await api('use-output', { filename }); setAttachments([uploaded]); selectMode(next); setPrompt(next === 'image' ? 'Describe your edit here' : ''); });
  const openSettings = () => { if (state) setConfig({ ...state.config, libraryRoot: state.libraryRoot || state.config.libraryRoot }); setModal('settings'); };
  const exportSession = () => { if (!session) return; const url = URL.createObjectURL(new Blob([JSON.stringify(session, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = 'tim-session.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
  const loadedModel = state?.models.find(m => m.id === state.loadedModelId);
  const modelAction = (endpoint: string, data?: unknown) => run(() => api(endpoint, data));
  const chooseModel = (chosen: Model) => { const next = chosen.id === state?.config.mainAgentModelId ? 'agent' : chosen.kind === 'chat' && mode === 'code' ? 'code' : chosen.kind as Mode; setSelected(current => ({ ...current, [next]: chosen.id })); selectMode(next); setWorkspace('chat'); setModal(null); };
  const saveDefault = async () => {
    if (!model) return;
    setSavingDefault(true);
    await run(async () => {
      await api('models/default', { mode, modelId: model.id });
      setState(current => current ? { ...current, config: { ...current.config, defaultMode: mode, ...(mode === 'agent' ? { mainAgentModelId: model.id } : { defaultModels: { ...current.config.defaultModels, [mode]: model.id } }) } } : current);
    });
    setSavingDefault(false);
  };
  return <div className={`studio ${state?.config.scanlines ? 'scanlines' : ''}`}>
    <header className="topbar"><div className="brand"><Logo/><span>TIM<span className="brand-light">STUDIO</span><small>LOCAL INTELLIGENCE / UNLIMITED POSSIBILITIES</small></span><span className="version">α 0.1</span></div>
      <nav className="workspace-tabs" aria-label="Workspace"><button className={workspace === 'chat' ? 'active' : ''} onClick={() => setWorkspace('chat')}><MessageSquare size={14}/> Chat</button><button className={workspace === 'pipelines' ? 'active' : ''} onClick={() => openPipelines()}><Layers size={14}/> Pipelines</button></nav><div className="top-status"><span><i className="live-dot"/>LOCAL MODE</span><span className="offline"><Radio size={12}/> OFFLINE ENGINES</span></div><button className="icon-button top-settings" title="Settings" onClick={openSettings}><Settings2 size={18}/></button>
    </header>
    <div className="workspace">
      {pipelineVisited && <div className="pipeline-host" style={{ display: workspace === 'pipelines' ? 'flex' : 'none' }}><PipelineWorkspace state={state} runRequest={pipelineRunRequest} onAction={api} onOpenLibrary={() => setModal('library')}/></div>}
      {workspace === 'chat' && <>
      <aside className="sidebar"><div className="side-heading"><span>YOUR WORKSPACE</span><span>01</span></div><button className="new-session" onClick={newSession}><Plus size={16}/> New session<span>↵</span></button>
        <label className="search-box"><Search size={14}/><input placeholder="Find a session…" value={query} onChange={e => setQuery(e.target.value)} aria-label="Find a session"/></label>
        <div className="rail-label">SESSIONS <span>{state?.sessions.length || '00'}</span></div><div className="session-list">
          {state?.sessions.filter(s => s.title.toLowerCase().includes(query.toLowerCase())).map(s => <button key={s.id} className={`session-item ${sessionId === s.id ? 'selected' : ''}`} onClick={() => { setSessionId(s.id); following.current = true; }}><MessageSquare size={15}/><span>{short(s.title)}<small>{s.messages.length ? `${s.messages.length} messages` : 'Ready when you are'}</small></span>{sessionId === s.id && <span className="session-dot"/>}</button>)}
          {!state?.sessions.length && <div className="rail-empty">A fresh frequency.<br/>Your sessions will appear here.</div>}
        </div>
        <button className="library-link" onClick={() => setModal('library')}><Library size={18}/><span>Model library<small>{state ? `${state.catalog?.length || state.models.length} to explore · ${state.models.length} installed` : 'Discovering models…'}</small></span><ChevronRight size={15}/></button>
        <div className="drive-card"><HardDrive size={17}/><div><strong>{state?.libraryRoot ? 'TIM CONNECTED' : 'LOCAL MODEL STORAGE'}</strong><span>{state?.libraryRoot || 'Downloads stay on this machine'}</span></div><button title="Configure library" onClick={openSettings}><ChevronRight size={15}/></button></div>
        <div className="rail-art"><NeonScene/><span>YOUR MACHINE.<br/><strong>YOUR UNIVERSE.</strong></span><small>NO CLOUD REQUIRED</small></div>
      </aside>
      <main className="main-panel" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); upload(e.dataTransfer.files); }}>
        <div className="session-bar"><span className="session-name"><span className="pink-square"/>{session?.title || 'New frequency'}<span className="session-kind">WORKSPACE</span></span><div><button className="icon-button" disabled={!session} title="Export session" onClick={exportSession}><Download size={16}/></button><button className="icon-button" title="Generation settings" onClick={() => setGenerationOpen(v => !v)}><SlidersHorizontal size={16}/></button></div></div>
        <div className="conversation" ref={scrollRef} onScroll={() => { const el = scrollRef.current!; following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100; }}>
          {!session?.messages.length ? <div className="welcome"><div className="welcome-kicker"><span className="live-dot"/> SYSTEM ONLINE <span>//</span> BUILD WITH AGENTS</div><div className="welcome-art"><NeonScene/><div className="welcome-orbit"><Logo/></div></div><h1>Local AI.<br/><span>Agents at work.</span></h1><p>Choose your models. Connect your agents.<br/>Build and run AI workflows on your machine.</p>
            <div className="welcome-guide">{state && <GuideSetup state={state} onAction={modelAction}/>}<button className="welcome-explore" onClick={() => setModal('library')}><Layers size={15}/> Explore {state?.catalog?.length || 'local'} models <ArrowRight size={15}/></button></div>
            <div className="starter-grid">
              {[{ mode: 'chat' as Mode, icon: MessageSquare, title: 'Follow an idea', subtitle: 'Think out loud with a local model', prompt: 'Help me brainstorm a creative project.' },{ mode: 'image' as Mode, icon: ImageIcon, title: 'Make something visual', subtitle: 'Turn a prompt into a new image', prompt: 'A cinematic neon city at night, wet streets reflecting cyan and magenta lights, retrofuturist, detailed.' },{ mode: 'code' as Mode, icon: Code2, title: 'Build your next thing', subtitle: 'Write, explain, and refine code', prompt: 'Write a Python function that searches a folder for duplicate files using SHA-256.' },{ mode: 'transcribe' as Mode, icon: AudioLines, title: 'Find the words', subtitle: 'Transcribe a WAV recording', prompt: '' }].map(item => <button key={item.mode} className="starter" onClick={() => { selectMode(item.mode); setPrompt(item.prompt); if (item.mode === 'transcribe') fileRef.current?.click(); }}><item.icon size={19}/><div><strong>{item.title}</strong><span>{item.subtitle}</span></div><ArrowRight size={15}/></button>)}
            </div><div className="welcome-foot"><Cpu size={12}/>{readyCount} MODELS AVAILABLE <span>·</span> ALL INFERENCE STAYS LOCAL</div>
          </div> : session.messages.map(message => <MessageCard key={message.id} message={message} phase={state?.jobs.find(j => j.id === message.jobId)?.phase} onUse={useOutput} onError={setError}/>)}
        </div>
        <div className="composer-area">
          {error && <div className="error-banner" role="alert"><span>{error}</span><button title="Dismiss error" onClick={() => setError('')}><X size={15}/></button></div>}
          {generationOpen && <div className="generation-panel"><div className="panel-title"><span>GENERATION CONTROLS</span><button title="Close generation settings" onClick={() => setGenerationOpen(false)}><X size={14}/></button></div>{['image', 'video'].includes(kind) ? <><div className="field-row">{(['width', 'height', 'seed'] as const).map(key => <label key={key}>{key}<input type="number" value={generation[key]} step={key === 'seed' ? 1 : 32} onChange={e => setGeneration(g => ({ ...g, [key]: Number(e.target.value) }))}/></label>)}<label>Steps<input type="number" placeholder={String(model?.defaults?.steps || 20)} value={generation.steps} onChange={e => setGeneration(g => ({ ...g, steps: e.target.value }))}/></label><label>Guidance<input type="number" step=".5" placeholder={String(model?.defaults?.cfg || 7)} value={generation.cfg} onChange={e => setGeneration(g => ({ ...g, cfg: e.target.value }))}/></label>{kind === 'video' && <label>Frames<input type="number" step="4" value={generation.frames} onChange={e => setGeneration(g => ({ ...g, frames: Number(e.target.value) }))}/></label>}</div><label className="negative-prompt">Negative prompt<input value={generation.negativePrompt} onChange={e => setGeneration(g => ({ ...g, negativePrompt: e.target.value }))} placeholder="Optional"/></label></> : <p>{kind === 'chat' ? 'Temperature, context, and system prompt are in Settings.' : kind === 'upscale' ? 'Real-ESRGAN x4plus · 4× output · tiled processing.' : 'Whisper transcription · attach a WAV recording.'}</p>}</div>}
          {!!attachments.length && <div className="attached-files">{attachments.map(a => <span key={a.filename}><Paperclip size={12}/>{short(a.name, 35)}<button title={`Remove ${a.name}`} onClick={() => setAttachments(list => list.filter(f => f.filename !== a.filename))}><X size={12}/></button></span>)}</div>}
          {missingDefault && <div className="guide-composer-note default-unavailable" role="status"><Cpu size={13}/><span>Your saved default for {modeLabels[mode]} is unavailable. Choose another model or update your defaults in Settings.</span><button onClick={openSettings}>Settings <ArrowRight size={12}/></button></div>}
          {mode === 'agent' && !model && !missingDefault && <div className="guide-composer-note" role="status"><Sparkles size={13}/><span>{state?.orchestrator ? 'TIM guide is getting ready. Browse models while setup completes.' : 'Set up a local guide to start a conversation.'}</span><button onClick={() => setModal('library')}>Open model library <ArrowRight size={12}/></button></div>}
          {kind === 'image' && model && <div className="guide-composer-note" role="status"><ImageIcon size={13}/><span>{model.requiresReference ? 'Reference image required. Attach a photo, then describe what to change and what to keep.' : model.inputMode === 'reference' ? 'Generate from text, or attach one reference photo to guide subject consistency.' : model.inputMode === 'none' ? 'Text-to-image model. Choose an editing model to work from a reference photo.' : 'Generate from text, or attach an image as an image-to-image starting point.'}</span></div>}
          <div className="composer"><textarea ref={promptRef} aria-label="Message" placeholder={modes.find(m => m.id === mode)!.hint} value={prompt} onChange={e => setPrompt(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }}/><div className="composer-bottom"><div><input ref={fileRef} type="file" hidden multiple onChange={e => upload(e.target.files)} accept=".png,.jpg,.jpeg,.webp,.wav,.txt,.md,.js,.ts,.py,.json,.csv,.html,.css"/><button className="icon-button" title="Attach files" disabled={uploading} onClick={() => fileRef.current?.click()}>{uploading ? <LoaderCircle className="spin" size={18}/> : <Paperclip size={18}/>}</button><span className="composer-model"><span className="live-dot"/>{model ? short(model.name, 30) : 'Choose a model'}</span></div><button className="send-button" disabled={sending || uploading || !model || (!prompt.trim() && !['upscale', 'transcribe'].includes(kind))} onClick={submit}>{sending ? <LoaderCircle className="spin" size={15}/> : <Send size={15}/>}<span>{activeJobs.length ? 'Queue' : 'Send'}</span><kbd>↵</kbd></button></div></div>
          <div className="mode-row">{modes.map(item => { const Icon = icons[item.id]; return <button key={item.id} className={mode === item.id ? 'active' : ''} onClick={() => selectMode(item.id)}><Icon size={14}/>{item.label}</button>; })}<button className={`controls-button ${generationOpen ? 'active' : ''}`} title="Generation controls" onClick={() => setGenerationOpen(v => !v)}><SlidersHorizontal size={15}/></button></div><div className="composer-note"><span>SHIFT + ENTER FOR A NEW LINE</span><span>{mode === 'transcribe' ? 'WAV → TEXT' : 'YOUR IDEAS STAY HERE'} <span className="tiny-square"/></span></div>
        </div>
      </main>
      <aside className="inspector"><div className="inspector-heading"><Activity size={14}/><span>CONTROL ROOM</span><span className="stripes"/></div>
        <section className="inspector-section"><div className="section-heading"><span>ACTIVE ENGINE</span><span className="index">01</span></div><label className="engine-select"><span className="engine-icon">{(() => { const Icon = icons[mode]; return <Icon size={21}/>; })()}</span><div><small>{mode === 'agent' ? 'MAIN AGENT' : mode === 'code' ? 'CODE / CHAT' : mode === 'transcribe' ? 'SPEECH TO TEXT' : kind.toUpperCase()}</small><select disabled={mode === 'agent'} aria-label="Select model" value={model?.id || ''} onChange={e => setSelected(s => ({ ...s, [mode]: e.target.value }))}><option value="" disabled>{missingDefault ? 'Saved default unavailable' : models.length ? 'Select a model' : 'No compatible models'}</option>{models.map(m => <option key={m.id} value={m.id} disabled={!m.available}>{m.name}{!m.available ? ' — unavailable' : ''}</option>)}</select></div><ChevronDown size={13}/></label><div className="engine-meta"><span><i className="live-dot"/>{state?.engines[kind]?.backend?.toUpperCase() || 'NO RUNTIME'}</span><span>{model?.size ? size(model.size) : 'LOCAL'}</span></div><div className="engine-default">{isDefault ? <span><CheckCircle2 size={12}/> Default for {modeLabels[mode]}</span> : <button disabled={!model || savingDefault} onClick={() => void saveDefault()}>{savingDefault ? <LoaderCircle size={12} className="spin"/> : <Check size={12}/>} Set as default</button>}{(state?.config.defaultMode || 'agent') === mode && <small>Opens in {modeLabels[mode]}</small>}</div><button className="outline-button" onClick={() => setModal('library')}><Layers size={13}/> Browse model library<ArrowRight size={13}/></button>{state?.orchestrator?.loaded && <div className="resident-note"><Sparkles size={12}/><span>TIM guide stays ready · CPU</span></div>}{loadedModel && <button className="unload" disabled={state?.loadingModel || !!activeJobs.length} onClick={() => run(() => api('unload', {}))}><Square size={10}/> Unload {short(loadedModel.name, 22)}</button>}</section>
        <section className="inspector-section"><div className="section-heading"><span>SYSTEM RESOURCES</span><span className="index">02</span></div><div className="hardware"><Cpu size={25}/><div><strong>{state?.gpu?.name.replace('NVIDIA GeForce ', '') || (state?.platform === 'darwin' ? 'Apple / system memory' : 'System compute')}</strong><span>{state?.gpu ? `${Math.round(state.gpu.total / 1024)} GB DEDICATED MEMORY` : `${state?.arch || '…'} · GPU METRICS UNAVAILABLE`}</span></div></div>
          {state?.gpu && <><Meter label="VRAM" value={state.gpu.used / state.gpu.total * 100} text={`${(state.gpu.used / 1024).toFixed(1)} / ${(state.gpu.total / 1024).toFixed(0)} GB`} color="pink"/><Meter label="GPU" value={state.gpu.utilization} text={`${state.gpu.utilization}%`} color="cyan"/></>}{state && <Meter label="RAM" value={(state.memory.usedBytes ?? state.memory.total - state.memory.free) / state.memory.total * 100} text={`${size(state.memory.usedBytes ?? state.memory.total - state.memory.free)} / ${size(state.memory.total)}`} color="purple"/>}<div className="resource-note"><Monitor size={11}/>{state ? `${({ win32: 'Windows', darwin: 'macOS', linux: 'Linux' } as Record<string,string>)[state.platform] || state.platform} · ${state.arch}` : 'Reading host…'}</div>
        </section>
        <section className="inspector-section queue-section"><div className="section-heading"><span>JOB QUEUE <b>{activeJobs.length.toString().padStart(2,'0')}</b></span><span className="index">03</span></div>{!state?.jobs.length ? <div className="queue-empty"><Waves size={27}/><strong>All quiet on the wire.</strong><span>Your jobs will show up here.<br/>One engine at a time.</span></div> : <div className="jobs">{state.jobs.slice(0, 8).map(job => { const Icon = icons[job.kind as Mode] || Activity; const active = ['running', 'queued'].includes(job.status); return <div key={job.id} className={`job ${job.status}`}><div className="job-top"><Icon size={15}/><button onClick={() => { if (job.pipelineRunId) openPipelines(job.pipelineRunId); else { setSessionId(job.sessionId); following.current = true; } }}>{short(job.modelName, 23)}</button>{active ? <button title="Cancel job" onClick={() => run(() => api('cancel', { id: job.id }))}><X size={13}/></button> : job.status === 'completed' ? <Check size={13}/> : <span className="job-failed">!</span>}</div><span className="job-phase" title={job.phase}>{short(job.phase, 64)}</span>{active && <div className={`progress ${job.progress === null ? 'indeterminate' : ''}`}><i style={{ width: `${job.progress ?? 30}%` }}/></div>}{!active && <span className="job-state">{job.status.toUpperCase()}{job.startedAt && job.finishedAt ? ` · ${((job.finishedAt - job.startedAt)/1000).toFixed(1)}s` : ''}</span>}</div>; })}</div>}</section>
        <div className="inspector-bottom"><span className="signal"><i/><i/><i/><i/><i/></span><span>THE FUTURE IS LOCAL.</span></div>
      </aside>
      </>}
    </div>
    <footer className="statusbar"><span><i className={`live-dot ${connected ? '' : 'dim'}`}/>{connected ? 'CONNECTED' : 'CONNECTING'}<span className="status-divider">/</span>{activeJobs.length ? `${activeJobs.length} JOB${activeJobs.length > 1 ? 'S' : ''} IN QUEUE` : 'READY WHEN YOU ARE'}</span><span>{state?.hostname || 'TIM STUDIO'} <span className="status-divider">/</span> v0.1.0 <span className="pink">■ ■ ■</span></span></footer>
    {modal && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setModal(null); }}><section role="dialog" aria-modal="true" aria-label={modal === 'library' ? 'Model library' : 'Settings'} className={`modal ${modal === 'library' ? 'library-modal' : ''}`}><div className="modal-heading"><span>{modal === 'library' ? <Library size={20}/> : <Settings2 size={20}/>} {modal === 'library' ? 'MODEL LIBRARY' : 'STUDIO SETTINGS'}</span><button title="Close dialog" onClick={() => setModal(null)}><X size={20}/></button></div>
      {modal === 'library' ? <ModelLibrary state={state} onAction={modelAction} onChoose={chooseModel} error={error} onDismissError={() => setError('')} onSettings={openSettings}/> : config && <form className="settings-form" onSubmit={async e => { e.preventDefault(); setSaving(true); await run(async () => { await api('settings', config); setSelected({}); selectMode(config.defaultMode || 'agent'); setState(current => current ? { ...current, config } : current); setModal(null); }); setSaving(false); }}><label>MODEL LIBRARY ROOT<div className="path-input"><input value={config.libraryRoot} onChange={e => setConfig({ ...config, libraryRoot: e.target.value })} placeholder="TIM drive or folder"/>{window.timDesktop && <button type="button" title="Choose library folder" onClick={async () => { const chosen = await window.timDesktop!.pickLibrary(); if (chosen) setConfig({ ...config, libraryRoot: chosen }); }}><FolderOpen size={17}/></button>}</div><small>The folder containing Coding-Models and Portable-Local-Studio. Auto-discovery follows your drive across computers.</small></label><ModelDefaults config={config} models={state?.models || []} onChange={setConfig}/><div className="field-row"><label>Specialist step limit<input type="number" min="1" max="8" value={config.agentMaxSteps ?? 4} onChange={e => setConfig({ ...config, agentMaxSteps: Number(e.target.value) })}/></label><label>Turn timeout (seconds)<input type="number" min="30" max="1800" value={config.agentTimeoutSeconds ?? 600} onChange={e => setConfig({ ...config, agentTimeoutSeconds: Number(e.target.value) })}/></label></div><label>COMPUTE BACKEND<select value={config.backend} onChange={e => setConfig({ ...config, backend: e.target.value })}>{['auto', 'cpu', 'cuda', 'vulkan', 'metal'].map(v => <option key={v}>{v}</option>)}</select></label><div className="field-row"><label>Temperature<input type="number" min="0" max="2" step=".1" value={config.temperature} onChange={e => setConfig({ ...config, temperature: Number(e.target.value) })}/></label><label>Response tokens<input type="number" min="1" max="8192" value={config.maxTokens} onChange={e => setConfig({ ...config, maxTokens: Number(e.target.value) })}/></label><label>Context tokens<input type="number" min="512" max="32768" value={config.context} onChange={e => setConfig({ ...config, context: Number(e.target.value) })}/></label></div><label>SYSTEM PROMPT<textarea rows={4} value={config.systemPrompt} onChange={e => setConfig({ ...config, systemPrompt: e.target.value })}/></label><label className="toggle-label"><input type="checkbox" checked={config.scanlines} onChange={e => setConfig({ ...config, scanlines: e.target.checked })}/><span>Subtle CRT scanlines</span></label><div className="settings-storage"><HardDrive size={15}/><div>LOCAL DATA<small>{state?.dataDir}</small></div></div>{error && <div className="message-error">{error}</div>}<button className="save-button" disabled={saving}>{saving ? <LoaderCircle size={16} className="spin"/> : <CheckCircle2 size={16}/>} Save settings</button></form>}
    </section></div>}
  </div>;
}
function Meter({ label, text, value, color }: { label: string; text: string; value: number; color: string }) { return <div className="meter"><div><span>{label}</span><span>{text}</span></div><div className={`meter-track ${color}`}><i style={{ width: `${Math.max(0, Math.min(100, value))}%` }}/></div></div>; }
export default App;
