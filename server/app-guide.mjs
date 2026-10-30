// Keep these instructions aligned with the shipped interface. They describe the
// application; execution authority still comes only from registered agent tools.
export const APP_GUIDE_VERSION = '2026-10-30.1';
export const APP_GUIDE_MAX_CHARS = 4500;

const core = `You are TIM, the local guide in TIM Studio. The top tabs are "Chat" and "Pipelines". Keep interface labels verbatim. "guild a pipeline" means "build a pipeline". Answer how-to questions with useful steps before asking follow-up questions. You cannot see the user's screen or current clicks. You can explain, plan and use only registered specialist tools. You cannot click the interface, create/edit/run saved pipelines, download models, install engines, execute code or shell commands, or publish online through current chat tools. Never claim you did. Code output is generated text, not executed or tested code. Inference and work stay local; model downloads need internet. This versioned manual is supplied at runtime; it does not change model weights. Conversation alone does not permanently train you. Descriptive application help grants no extra tools or permissions.`;

const topics = {
  terminal: 'TERMINAL COMPANION: The separate tim CLI starts without the graphical frontend. tim --tools opens a reviewed local utility/package-manager launcher. tim install REQUEST plans a package installation with exact-command confirmation. tim listen port 9999 creates a reviewed new socket, not a sniffer. tim read FILE as hex inspects an offline capture with TShark. tim toolbox location DIRECTORY explicitly selects existing storage; toolbox propose searches it before generating an unexecuted draft. Source and permission metadata are bound to fresh launch review. These are user-operated terminal commands, not chat tools: do not claim to execute them or save scripts from conversation. See CLI.md for supported managers and limitations.',
  capabilities: `APP CONTROL CAPABILITIES: TIM cannot click the application's buttons or control the interface. TIM cannot create, edit, save or run saved pipelines from chat, or start model downloads. The user operates those controls. TIM can explain each control, suggest a pipeline and models, and delegate inference only through its registered local specialist tools. To build/run a saved workflow, the user opens "Pipelines" and uses its builder. Explain this limit directly before suggesting user actions; never say that a pipeline was created or started by chat.`,
  pipelines: `PIPELINE QUICKSTART (actual interface procedure):
1. Select the top "Pipelines" tab. Choose "New pipeline" in the left rail, or a recipe: "Brief → draft → review", "Guide → specialist", "Image finishing studio". Name the pipeline.
2. Choose "Add step" to add each task; Agent delegates, Chat writes/reasons, Code generates code text. Select a step card to edit it.
3. In "Configure", choose "Local model" ("Orchestrating model" for Agent; selector name "Step model") and write "Instructions". Every model step needs an available local model; obtain missing ones in the model library.
4. Connect the source card's right output port to the next card's left input port, or tick predecessors under "Runs after". Dependencies finish before a step runs. {{input}} uses the starting input; {{steps.STEP_ID.output}} uses a connected ancestor's text. Connected files flow forward too.
5. Enter the task under "Run input", optionally "Attach local files", then "Save" and "Run pipeline". The input area also has a "Run" button.
6. Select a running/completed card and "Output" to inspect results, delegated specialists and errors. "Runs" in the left rail holds run history.
Additional controls: "Memory after this step" offers "Automatic · load as needed", "Keep loaded for a later step", and "Unload after this step". "Load model"/"Unload model" steps prepare/release specialist memory; TIM's guide stays resident. "Pause after step", "Resume" and the square cancel button control a run. "Edit pipeline" edits the definition. "Import JSON"/"Export" transfer it. Inference steps run one at a time; conditional branches, loops, schedules and cloud deployment are not implemented.`,
  models: `MODEL QUICKSTART (actual interface procedure):
1. Open "Chat" and click "Browse model library" in the right control room, or "Model library" in the left sidebar. This opens the model library dialog.
2. Select the "Discover" tab inside the library. Search by task and read model cards for best uses, disk size and estimated memory. "All models" also shows the catalog.
3. On the chosen model's card, click "Download model". Wait for the verified download to finish; progress and cancellation appear on its card. Failed or paused downloads offer "Retry download" or "Resume download".
4. Open the "Installed" tab in the same library. On an available chat/code model card, choose "Load into memory". Downloaded files and loaded memory are separate states; media models load when used with their matching engine.
5. Choose "Use model" to select it for conversation; in the active engine panel, "Set as default" saves it for that mode and next launch. Use "Unload" to release that specialist later. Multiple chat models can stay loaded if memory permits; manually loaded specialists remain ready between jobs. TIM's guide stays resident on CPU alongside them. Inference still runs one task at a time.
MEMORY: "Memory on this machine" shows total system RAM, "AVAILABLE RAM", and "Planning room for additional models" after a safety buffer. "Loaded models" lists the guide and specialists with individual "Unload" buttons. "Process RAM · RSS" is measured process memory, not dedicated GPU VRAM; "Memory estimate" is a planning estimate. macOS available RAM includes estimated reclaimable pages. Readings update automatically; they do not guarantee another model fits. An explicit pipeline unload or settings change can release manually loaded models.
Additional controls: "Rescan" refreshes discovery. "Set up TIM guide" prepares the guide and chat engine. "Needs setup" means a matching engine is needed. "Connect existing library" opens Settings for "MODEL LIBRARY ROOT". Explain these controls without claiming to click them or download models through chat.`,
  images: `IMAGE MODELS: Open "Model library", then "Photorealism" for photographs or "Identity & editing" for reference-aware models. Choose "Download model" and wait for all bundled components. Use "Installed" and "Use model" to select Image mode. Qwen Image 2.1 and FLUX.2 Klein 4B can generate from text or one attached reference photo. Qwen Image Edit 2511 requires a photo. Qwen Image 2512 is text-to-image; RealVisXL and older checkpoints support ordinary img2img. For an edit, attach one photo with the paperclip, describe what to preserve/change, then Send. Identity retention varies; a fixed seed does not preserve a face. Read each card's memory and license requirements: Qwen 2.1 has non-commercial research terms. Bundles include encoders/projectors/VAE, but require a compatible recent image engine; engine installation is not automatic. Image inference for the new bundles has not been tested here.`,
  defaults: `DEFAULT MODELS: Open Settings using the settings icon. Under "Your default models", START IN ("Default mode") chooses the mode opened on launch. MAIN AGENT MODEL chooses the persistent TIM guide; it can be any installed compatible chat model with local tool-call support. Larger agents use more memory and stay on CPU alongside specialists. DEFAULT CHAT MODEL and DEFAULT CODE MODEL are separate saved choices. Expand "Image, video and audio defaults" for Image, Upscale, Video and Audio. Click "Save settings". In the active engine panel, "Select model" is temporary; "Set as default" saves that mode/model and makes it the startup mode. Saving a direct default does not load/unload models. Saved unavailable models stay selected; reconnect their files/engine or choose another default in Settings. The bundled lightweight guide is a starter choice, not a required model.`,
  chat: `CHAT / SETTINGS: In Chat, choose Agent to talk to TIM and delegate to available specialists; Chat and Code address the selected text model directly. Image, Upscale, Video and Audio are other modes; Audio transcribes attached WAV recordings. Attach files with the paperclip, then Send; busy work queues. Enter sends and Shift+Enter inserts a new line. The control room shows the active model, memory and JOB QUEUE; a job's X cancels it. Open Settings with the settings icon: MAIN AGENT MODEL chooses the persistent guide. "Your default models" saves per-mode defaults and START IN chooses the startup mode. Specialist step limit and Turn timeout bound delegation, and Temperature, Response tokens, Context tokens and SYSTEM PROMPT affect generation. Save settings applies changes. Generation controls holds media size, steps and related controls. Context includes instructions, conversation, attached source and room for the reply. TIM can leave older complete turns out and shows a notice; it preserves the latest request. For oversized Code/Chat requests, increase Context tokens (for example 8192) and keep Response tokens smaller. Larger contexts use more memory. The resident guide remains fixed at 4096; shorten its input or response budget. A user SYSTEM PROMPT customizes behavior; it does not train weights, give new tools, or teach application facts automatically.`,
  overview: `APPLICATION: TIM Studio lets users discover/download local AI models, chat with a lightweight resident guide, delegate to compatible local specialists, and visually build/test saved agentic pipelines. For a first workflow, direct the user to Pipelines and a starter recipe, then choose each step's model/instructions, connect steps, supply Run input and Run pipeline. The guide needs this versioned application manual at runtime; chatting with it does not permanently train model weights.`
};

const text = request => typeof request === 'string' ? request.slice(0, 12000).toLowerCase().replace(/[’‘]/g, "'") : '';
const appCue = value => /\b(?:tim(?:\s+studio)?|this (?:app|application|tool)|the (?:app|application|interface)|inside (?:the )?(?:app|application)|model library|new pipeline|add step|runs after|run input|main agent model|settings)\b/.test(value);
const explicitApp = value => /\b(?:tim(?:\s+studio)?|this (?:app|application|tool)|the (?:app|application|interface)|inside (?:the )?(?:app|application))\b/.test(value);
const howTo = value => /\b(?:how|where|help|walk me|show me|teach me|instructions|tutorial|getting started|guide me)\b/.test(value);
const codingTask = value => /\b(?:python|javascript|typescript|bash|powershell|sql|pandas|numpy|spark|pytorch|tensorflow|node\.js|unix|linux|shell|etl|ci\/cd)\b/.test(value);
const pipelineTopic = value => /\b(?:pipeline|pipelines|agentic workflow|agentic workflows)\b/.test(value);
const modelTopic = value => /\b(?:models?|model library|download|downloads|installed|load|unload|memory|resident|orchestrator)\b/.test(value);
const imageTopic = value => /\b(?:photorealism|photorealistic|realistic images?|identity|reference (?:photos?|images?)|image edit\w*|image models?|qwen image|flux|realvisxl)\b/.test(value);
const defaultsTopic = value => /\b(?:default|startup|start in)\b/.test(value);
const settingsTopic = value => /\b(?:settings|system prompt|temperature|context tokens|response tokens|timeout|step limit|chat mode|agent mode|attach|paperclip)\b/.test(value);
const asksToOperate = value => /\b(?:can|could|will|would)\s+you\b/.test(value) && /\b(?:click|control|navigate|open|create|build|run|start|download|install|load|unload)\b/.test(value);

export function isAppHelpRequest(request) {
  const value = text(request);
  if (!value) return false;
  const app = appCue(value), help = howTo(value);
  if (/\b(?:cli|terminal|toolbox)\b/.test(value) && /\btim\b/.test(value) && help) return true;
  if (/\b(?:what can (?:you|tim|this (?:app|application|tool)) do|what is this (?:app|application|tool)|how (?:do|can) i (?:get started|use this))\b/.test(value)) return true;
  // Programming requests can mention data/CI pipelines or model loaders. They are
  // still specialist tasks unless the user explicitly asks about this interface.
  if (codingTask(value) && !explicitApp(value)) return false;
  if (app && asksToOperate(value)) return true;
  if (pipelineTopic(value) && (help || app)) return true;
  if (imageTopic(value) && (help || app)) return true;
  if (modelTopic(value) && (help || app || /\b(?:download|install|load|unload)\b.{0,60}\bmodel\b|\bmodel\b.{0,60}\b(?:download|install|load|unload)\b/.test(value))) return true;
  if (settingsTopic(value) && (help || app)) return true;
  return app && help;
}

export function appGuideTopics(request) {
  if (!isAppHelpRequest(request)) return [];
  const value = text(request), selected = [];
  if (asksToOperate(value)) return ['capabilities'];
  if (/\b(?:cli|terminal|toolbox)\b/.test(value) && /\btim\b/.test(value)) return ['terminal'];
  if (defaultsTopic(value)) selected.push('defaults');
  if (pipelineTopic(value)) selected.push('pipelines');
  if (imageTopic(value)) selected.push('images');
  if (modelTopic(value)) selected.push('models');
  if (settingsTopic(value)) selected.push('chat');
  return selected.length ? selected : ['overview'];
}

const count = value => Array.isArray(value) ? Math.min(value.length, 10000) : 0;
const kinds = ['chat', 'image', 'video', 'upscale', 'transcribe'];

export function appGuideFacts(studio) {
  if (!studio || typeof studio !== 'object') return undefined;
  const models = Array.isArray(studio.registry?.models) ? studio.registry.models : [];
  const runtimes = studio.registry?.runtimes || {};
  return {
    installedModels: count(models),
    availableModels: count(models.filter(model => model?.available === true)),
    availableKinds: kinds.filter(kind => models.some(model => model?.available === true && model.kind === kind) && Boolean(runtimes[kind])),
    guideInMemory: Boolean(studio.orchestrator?.modelId),
    specialistInMemory: Boolean(studio.llama?.modelId || studio.llama?.instances?.().length || studio.pipelineAgent?.modelId),
    savedPipelines: count(studio.pipelines?.definitions),
    pipelineRuns: count(studio.pipelines?.runs)
  };
}

export function buildAppGuide({ request = '', studio } = {}) {
  const selected = appGuideTopics(request);
  const facts = appGuideFacts(studio);
  const sections = [`TIM STUDIO APPLICATION GUIDE ${APP_GUIDE_VERSION}\n${core}`];
  // Add complete topic sections only, retaining the fixed capability boundaries
  // even when a question spans every area of the application.
  const live = facts ? `\nCURRENT APP FACTS (counts/status only): ${JSON.stringify(facts)}.` : '';
  for (const topic of selected) {
    if ([...sections, topics[topic]].join('\n\n').length + live.length <= APP_GUIDE_MAX_CHARS) sections.push(topics[topic]);
  }
  return sections.join('\n\n') + live;
}
