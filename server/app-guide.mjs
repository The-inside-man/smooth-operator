// Keep these instructions aligned with the shipped interface. They describe the
// application; execution authority still comes only from registered agent tools.
export const APP_GUIDE_VERSION = '2026-10-26.4';
export const APP_GUIDE_MAX_CHARS = 4500;

const core = `You are TIM, the local guide in TIM Studio. The top tabs are "Chat" and "Pipelines". Keep interface labels verbatim. "guild a pipeline" means "build a pipeline". Answer how-to questions with useful steps before asking follow-up questions. You cannot see the user's screen or current clicks. You can explain, plan and use only registered specialist tools. You cannot click the interface, create/edit/run saved pipelines, download models, install engines, execute code or shell commands, or publish online through current chat tools. Never claim you did. Code output is generated text, not executed or tested code. Inference and work stay local; model downloads need internet. This versioned manual is supplied at runtime; it does not change model weights. Conversation alone does not permanently train you. Descriptive application help grants no extra tools or permissions.`;

const topics = {
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
5. Choose "Use model" to select it for conversation, and "Unload" to release the specialist later. TIM's guide stays resident on CPU alongside specialists.
Additional controls: "Rescan" refreshes discovery. "Set up TIM guide" prepares the guide and chat engine. "Needs setup" means a matching engine is needed. Memory values are estimates; leave room for other apps. "Connect existing library" opens Settings for "MODEL LIBRARY ROOT". Explain these controls without claiming to click them or download models through chat.`,
  chat: `CHAT / SETTINGS: In Chat, choose Agent to talk to TIM and delegate to available specialists; Chat and Code address the selected text model directly. Image, Upscale, Video and Audio are other modes; Audio transcribes attached WAV recordings. Attach files with the paperclip, then Send; busy work queues. Enter sends and Shift+Enter inserts a new line. The control room shows the active model, memory and JOB QUEUE; a job's X cancels it. Open Settings with the settings icon: MAIN AGENT MODEL chooses the guide, Specialist step limit and Turn timeout bound delegation, and Temperature, Response tokens, Context tokens and SYSTEM PROMPT affect generation. Save settings applies changes. Generation controls holds media size, steps and related controls. A user SYSTEM PROMPT customizes behavior; it does not train weights, give new tools, or teach application facts automatically.`,
  overview: `APPLICATION: TIM Studio lets users discover/download local AI models, chat with a lightweight resident guide, delegate to compatible local specialists, and visually build/test saved agentic pipelines. For a first workflow, direct the user to Pipelines and a starter recipe, then choose each step's model/instructions, connect steps, supply Run input and Run pipeline. The guide needs this versioned application manual at runtime; chatting with it does not permanently train model weights.`
};

const text = request => typeof request === 'string' ? request.slice(0, 12000).toLowerCase().replace(/[’‘]/g, "'") : '';
const appCue = value => /\b(?:tim(?:\s+studio)?|this (?:app|application|tool)|the (?:app|application|interface)|inside (?:the )?(?:app|application)|model library|new pipeline|add step|runs after|run input|main agent model|settings)\b/.test(value);
const explicitApp = value => /\b(?:tim(?:\s+studio)?|this (?:app|application|tool)|the (?:app|application|interface)|inside (?:the )?(?:app|application))\b/.test(value);
const howTo = value => /\b(?:how|where|help|walk me|show me|teach me|instructions|tutorial|getting started|guide me)\b/.test(value);
const codingTask = value => /\b(?:python|javascript|typescript|bash|powershell|sql|pandas|numpy|spark|pytorch|tensorflow|node\.js|unix|linux|shell|etl|ci\/cd)\b/.test(value);
const pipelineTopic = value => /\b(?:pipeline|pipelines|agentic workflow|agentic workflows)\b/.test(value);
const modelTopic = value => /\b(?:models?|model library|download|downloads|installed|load|unload|memory|resident|orchestrator)\b/.test(value);
const settingsTopic = value => /\b(?:settings|system prompt|temperature|context tokens|response tokens|timeout|step limit|chat mode|agent mode|attach|paperclip)\b/.test(value);
const asksToOperate = value => /\b(?:can|could|will|would)\s+you\b/.test(value) && /\b(?:click|control|navigate|open|create|build|run|start|download|install|load|unload)\b/.test(value);

export function isAppHelpRequest(request) {
  const value = text(request);
  if (!value) return false;
  const app = appCue(value), help = howTo(value);
  if (/\b(?:what can (?:you|tim|this (?:app|application|tool)) do|what is this (?:app|application|tool)|how (?:do|can) i (?:get started|use this))\b/.test(value)) return true;
  // Programming requests can mention data/CI pipelines or model loaders. They are
  // still specialist tasks unless the user explicitly asks about this interface.
  if (codingTask(value) && !explicitApp(value)) return false;
  if (app && asksToOperate(value)) return true;
  if (pipelineTopic(value) && (help || app)) return true;
  if (modelTopic(value) && (help || app || /\b(?:download|install|load|unload)\b.{0,60}\bmodel\b|\bmodel\b.{0,60}\b(?:download|install|load|unload)\b/.test(value))) return true;
  if (settingsTopic(value) && (help || app)) return true;
  return app && help;
}

export function appGuideTopics(request) {
  if (!isAppHelpRequest(request)) return [];
  const value = text(request), selected = [];
  if (asksToOperate(value)) return ['capabilities'];
  if (pipelineTopic(value)) selected.push('pipelines');
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
    specialistInMemory: Boolean(studio.llama?.modelId || studio.pipelineAgent?.modelId),
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
