// Types shared by the main process, preload and renderer.

export interface Repo {
  path: string;
  name: string;
  branch: string;
  remoteUrl: string | null;
  /** owner/name when the remote is on GitHub */
  github: string | null;
  uncommitted: string[];
  ahead: number;
  behind: number;
  hasUpstream: boolean;
  lastCommit: { hash: string; subject: string; date: string } | null;
  recentCommits: { hash: string; subject: string; date: string }[];
  /** unchecked "- [ ]" items from TODO.md / actions.md / ROADMAP.md */
  todos: { file: string; text: string }[];
}

export interface SessionSummary {
  id: string;
  file: string;
  title: string;
  firstPrompt: string;
  lastPrompt: string;
  /** directory the session mostly worked in */
  cwd: string;
  /** repo the session belongs to, if it could be determined */
  repoPath: string | null;
  gitBranch: string | null;
  startedAt: string | null;
  updatedAt: string;
  userTurns: number;
  costUSD: number | null;
}

export type TranscriptItem =
  | { kind: 'user'; text: string; at: string | null }
  | { kind: 'assistant'; text: string; at: string | null }
  | { kind: 'tool'; name: string; detail: string; at: string | null };

export interface SessionSearchHit {
  id: string;
  snippet: string;
}

export interface PullRequest {
  repo: string;
  number: number;
  title: string;
  url: string;
  author: string;
  isDraft: boolean;
  updatedAt: string;
  state: string;
}

export interface PrBuckets {
  mine: PullRequest[];
  reviewRequested: PullRequest[];
  recentlyMerged: PullRequest[];
  error: string | null;
}

export interface Settings {
  /** folders scanned (two levels deep) for git repos */
  projectRoots: string[];
  /** default Ollama model for local tasks */
  localModel: string | null;
}

export interface TerminalSpec {
  cwd: string;
  /** 'claude' runs Claude Code; 'shell' runs the default shell */
  program: 'claude' | 'shell';
  /** resume this Claude Code session */
  resumeId?: string;
  title?: string;
}

export interface GpuInfo {
  name: string;
  vendor: 'nvidia' | 'amd' | 'intel' | 'apple' | 'other';
  vramGB: number;
  dedicated: boolean;
}

export interface SystemInfo {
  platform: string;
  arch: string;
  cpu: string;
  cores: number;
  ramGB: number;
  gpus: GpuInfo[];
  bestGpu: GpuInfo | null;
  freeDiskGB: number | null;
}

export interface CatalogModel {
  tag: string;
  family: string;
  paramsB: number;
  approxGB: number;
  /** rough relative quality, 1-10 */
  quality: number;
  use: 'general' | 'code' | 'reasoning';
  blurb: string;
}

/** gpu: fully on GPU (fast); cpu: CPU-only but usable; partial: split/slow; no: won't fit */
export type ModelFit = 'gpu' | 'cpu' | 'partial' | 'no';

export interface ModelOption extends CatalogModel {
  sizeGB: number;
  sizeExact: boolean;
  fit: ModelFit;
  reason: string;
}

export interface ModelReport {
  system: SystemInfo;
  options: ModelOption[];
  recommended: string | null;
  fastPick: string | null;
}

export interface OllamaStatus {
  installed: boolean;
  running: boolean;
  version: string | null;
  models: { name: string; sizeGB: number; modifiedAt: string }[];
}

export interface PullProgress {
  tag: string;
  status: string;
  completed?: number;
  total?: number;
  done?: boolean;
  error?: string;
}

export type AiTask = { kind: 'summarize'; sessionId: string } | { kind: 'brief' } | { kind: 'ask'; prompt: string };

export interface AiEvent {
  taskId: string;
  text?: string;
  done?: boolean;
  error?: string;
}

export interface CockpitApi {
  getSettings(): Promise<Settings>;
  setProjectRoots(roots: string[]): Promise<Settings>;
  pickFolder(): Promise<string | null>;
  listRepos(): Promise<Repo[]>;
  listSessions(): Promise<SessionSummary[]>;
  getTranscript(id: string): Promise<TranscriptItem[]>;
  searchSessions(query: string): Promise<SessionSearchHit[]>;
  listPrs(): Promise<PrBuckets>;
  openExternal(url: string): Promise<void>;
  termCreate(spec: TerminalSpec): Promise<string>;
  termWrite(id: string, data: string): void;
  termResize(id: string, cols: number, rows: number): void;
  termKill(id: string): void;
  onTermData(cb: (id: string, data: string) => void): () => void;
  onTermExit(cb: (id: string, code: number) => void): () => void;
  setLocalModel(tag: string | null): Promise<Settings>;
  scanModels(): Promise<ModelReport>;
  ollamaStatus(): Promise<OllamaStatus>;
  pullModel(tag: string): Promise<void>;
  cancelPull(tag: string): void;
  removeModel(tag: string): Promise<void>;
  onPullProgress(cb: (p: PullProgress) => void): () => void;
  /** starts a local-model task; output arrives through onAiEvent */
  runAi(task: AiTask): Promise<string>;
  cancelAi(taskId: string): void;
  onAiEvent(cb: (e: AiEvent) => void): () => void;
}
