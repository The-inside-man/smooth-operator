import type { Config, Mode, Model } from './types';
import './model-defaults.css';

export const modeLabels: Record<Mode, string> = { agent: 'Agent', chat: 'Chat', code: 'Code', image: 'Image', upscale: 'Upscale', video: 'Video', transcribe: 'Audio' };
const directModes: Exclude<Mode, 'agent'>[] = ['chat', 'code', 'image', 'upscale', 'video', 'transcribe'];

function ModelOptions({ models, value }: { models: Model[]; value: string }) {
  return <>
    <option value="">Choose a model</option>
    {value && !models.some(model => model.id === value) && <option value={value} disabled>Saved model — unavailable</option>}
    {models.map(model => <option key={model.id} value={model.id} disabled={!model.available}>{model.name}{!model.available ? ' — unavailable' : ''}</option>)}
  </>;
}

export default function ModelDefaults({ config, models, onChange }: { config: Config; models: Model[]; onChange: (next: Config) => void }) {
  const chooseDefault = (mode: Exclude<Mode, 'agent'>, modelId: string) => {
    const defaultModels = { ...config.defaultModels };
    if (modelId) defaultModels[mode] = modelId;
    else delete defaultModels[mode];
    onChange({ ...config, defaultModels });
  };
  const defaultSelect = (mode: Exclude<Mode, 'agent'>) => <label key={mode}>DEFAULT {modeLabels[mode].toUpperCase()} MODEL
    <select aria-label={`Default ${modeLabels[mode]} model`} value={config.defaultModels?.[mode] || ''} onChange={event => chooseDefault(mode, event.target.value)}>
      <ModelOptions models={models.filter(model => model.kind === (mode === 'code' ? 'chat' : mode))} value={config.defaultModels?.[mode] || ''}/>
    </select>
  </label>;
  return <section className="model-default-settings" aria-label="Default models">
    <div className="default-settings-heading"><strong>Your default models</strong><p>Choose the models you want to use. Your choices are saved on this machine.</p></div>
    <label>START IN<select aria-label="Default mode" value={config.defaultMode || 'agent'} onChange={event => onChange({ ...config, defaultMode: event.target.value as Mode })}>{Object.entries(modeLabels).map(([mode, label]) => <option key={mode} value={mode}>{label}</option>)}</select><small>The mode TIM opens when you launch the app.</small></label>
    <label>MAIN AGENT MODEL<select aria-label="Main agent model" value={config.mainAgentModelId || ''} onChange={event => onChange({ ...config, mainAgentModelId: event.target.value })}><ModelOptions models={models.filter(model => model.kind === 'chat')} value={config.mainAgentModelId || ''}/></select><small>Your chosen agent stays in CPU memory alongside specialists. Larger models use more memory; choose one with local tool-call support.</small></label>
    <div className="default-model-grid">{directModes.slice(0, 2).map(defaultSelect)}</div>
    <details className="default-media-models"><summary>Image, video and audio defaults</summary><div className="default-model-grid">{directModes.slice(2).map(defaultSelect)}</div></details>
    <p className="default-settings-note">You can switch models for individual tasks. A saved model that becomes unavailable stays selected until you choose a replacement.</p>
  </section>;
}
