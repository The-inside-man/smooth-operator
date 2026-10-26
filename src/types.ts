export type Mode = 'agent' | 'chat' | 'code' | 'image' | 'upscale' | 'video' | 'transcribe';
export type Model = { id: string; name: string; kind: string; size: number; relativePath: string; available: boolean; issue: string; validation: string; defaults?: { steps: number; cfg: number } };
export type Artifact = { filename: string; kind: string; size: number };
export type AgentStep = { id: string; parentJobId: string; modelId: string; modelName: string; kind: string; status: string; phase: string; result?: { text?: string; error?: string; artifact?: Artifact } };
export type Message = { id: string; role: string; content: string; createdAt: string; steps?: AgentStep[]; attachments?: string[]; jobId?: string; model?: string; kind?: string; status?: string; artifact?: Artifact; error?: string };
export type Session = { id: string; title: string; createdAt: string; messages: Message[] };
export type Job = { id: string; sessionId: string; modelId: string; modelName: string; kind: string; status: string; phase: string; progress: number | null; createdAt: string; startedAt?: number; finishedAt?: number };
export type Config = { mainAgentModelId: string; agentMaxSteps: number; agentTimeoutSeconds: number; libraryRoot: string; backend: string; systemPrompt: string; temperature: number; maxTokens: number; context: number; scanlines: boolean };
export type State = { platform: string; arch: string; hostname: string; memory: { total: number; free: number }; gpu: { name: string; total: number; used: number; utilization: number } | null; libraryRoot: string | null; dataDir: string; config: Config; models: Model[]; engines: Record<string, { available: boolean; backend?: string }>; sessions: Session[]; jobs: Job[]; loadedModelId: string | null };
declare global { interface Window { timDesktop?: { pickLibrary: () => Promise<string | null>; saveOutput: (filename: string) => Promise<boolean> } } }
