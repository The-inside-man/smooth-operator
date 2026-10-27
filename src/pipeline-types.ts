import type { AgentStep, Artifact, ContextUsage } from './types';

export type PipelineNodeType = 'input' | 'agent' | 'chat' | 'code' | 'image' | 'video' | 'upscale' | 'transcribe' | 'load' | 'unload';
export type PipelineMemoryPolicy = 'auto' | 'keep' | 'unload';
export type PipelineNode = {
  id: string;
  name: string;
  type: PipelineNodeType;
  modelId: string;
  prompt: string;
  systemPrompt?: string;
  inputRef?: string;
  dependsOn: string[];
  position: { x: number; y: number };
  settings?: Record<string, unknown>;
  memoryPolicy: PipelineMemoryPolicy;
};
export type PipelineDefinition = {
  schemaVersion: 1;
  id: string;
  name: string;
  description: string;
  nodes: PipelineNode[];
  createdAt?: string | number;
  updatedAt?: string | number;
};
export type PipelineNodeRun = {
  nodeId: string;
  status: string;
  phase?: string;
  text?: string;
  artifact?: Artifact;
  steps?: AgentStep[];
  progress?: number | null;
  error?: string;
  startedAt?: string | number;
  finishedAt?: string | number;
  jobId?: string;
  modelId?: string;
  modelName?: string;
  contextUsage?: ContextUsage;
  logs?: Array<string | { message?: string; text?: string; at?: string }>;
};
export type PipelineRun = {
  id: string;
  pipelineId: string;
  pipelineName: string;
  status: string;
  input: string;
  attachments?: string[];
  definition: PipelineDefinition;
  nodeRuns: PipelineNodeRun[];
  createdAt: string | number;
  startedAt?: string | number;
  finishedAt?: string | number;
  activeNodeId?: string;
  error?: string;
  pauseRequested?: boolean;
};
