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
  voiceModel: VoiceModel;
  /** Whisper language name, e.g. 'english', 'hindi', or 'auto' */
  voiceLanguage: string;
  /** Electron accelerator for push-to-talk, or null to disable */
  voiceHotkey: string | null;
  /** stop recording automatically after a pause */
  voiceAutoStop: boolean;
  /** extra words to recognise (repo names are always included) */
  voiceVocabulary: string[];
  /** keep running in the tray and start at login, so routines run with the window closed */
  backgroundMode: boolean;
  /** connected mailbox (the password is stored separately, encrypted) */
  email: EmailAccount | null;
  emailProfile: EmailProfile;
  /** the email routine saves drafts to the mailbox automatically */
  emailAutoDraft: boolean;
}

export interface EmailAccount {
  provider: string;
  host: string;
  port: number;
  user: string;
  displayName: string;
}

export interface EmailProfile {
  name: string;
  signature: string;
  /** who you are and what you are looking for; guides drafts */
  about: string;
}

export interface MailMessage {
  uid: number;
  messageId: string;
  references: string[];
  fromName: string;
  fromAddress: string;
  replyTo: string | null;
  subject: string;
  date: string;
  text: string;
  /** you already replied */
  answered: boolean;
  /** newsletter or automated sender */
  bulk: boolean;
  /** a draft reply already exists in the mailbox */
  draftExists: boolean;
}

export type MailCategory = 'job' | 'reply' | 'fyi' | 'spam';

export interface TriageItem extends MailMessage {
  category: MailCategory;
  reason: string;
  draft: string | null;
  draftSaved: boolean;
}

export interface TriageResult {
  checkedAt: string;
  items: TriageItem[];
  /** local model used for sorting, or null when rules were used */
  usedModel: string | null;
}

export interface EmailConnectInput {
  provider: string;
  user: string;
  password: string;
  displayName: string;
  host?: string;
  port?: number;
}

export type VoiceModel = 'base' | 'small' | 'turbo';

export type VoiceSettings = Pick<Settings, 'voiceModel' | 'voiceLanguage' | 'voiceHotkey' | 'voiceAutoStop' | 'voiceVocabulary'>;

export interface VoiceState {
  phase: 'idle' | 'listening' | 'working' | 'error';
  message: string;
}

export interface TerminalSpec {
  cwd: string;
  /** 'claude' runs Claude Code; 'shell' the default shell; 'ollama-install' the official Ollama installer */
  program: 'claude' | 'shell' | 'ollama-install';
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

export type AiTask = { kind: 'summarize'; sessionId: string } | { kind: 'ask'; prompt: string };

export interface BriefRef {
  kind: 'repo' | 'pr' | 'session';
  /** repo path, PR url, or session id */
  id: string;
  label: string;
}

export interface BriefItem {
  action: string;
  ref: BriefRef;
  /** the fact this priority is based on, shown on hover */
  fact: string;
}

export interface Brief {
  recent: { repo: string; titles: string[] }[];
  focus: BriefItem[];
  model: string | null;
  /** false when priorities came from the rule-based fallback */
  usedModel: boolean;
}

export interface AiEvent {
  taskId: string;
  text?: string;
  /** what the model was given, e.g. ['tatvafit'] */
  context?: string[];
  done?: boolean;
  error?: string;
}

export type RoutineSchedule = { kind: 'daily'; time: string; days: number[] } | { kind: 'interval'; hours: number };

export type RoutineAction =
  | { type: 'brief' }
  | { type: 'ask'; prompt: string }
  | { type: 'claude'; prompt: string; cwd: string }
  | { type: 'email' };

export interface Routine {
  id: string;
  name: string;
  enabled: boolean;
  notify: boolean;
  schedule: RoutineSchedule;
  action: RoutineAction;
  lastRunAt: string | null;
  nextRunAt: string | null;
}

export type RoutineInput = Omit<Routine, 'id' | 'lastRunAt' | 'nextRunAt'> & { id?: string };

export interface RoutineRun {
  id: string;
  routineId: string;
  routineName: string;
  startedAt: string;
  finishedAt: string | null;
  status: 'running' | 'ok' | 'error';
  output: string;
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
  startOllama(): Promise<boolean>;
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
  buildBrief(): Promise<Brief>;
  listRoutines(): Promise<Routine[]>;
  saveRoutine(r: RoutineInput): Promise<Routine>;
  deleteRoutine(id: string): Promise<void>;
  runRoutineNow(id: string): Promise<void>;
  listRoutineRuns(): Promise<RoutineRun[]>;
  onRoutineRun(cb: (run: RoutineRun) => void): () => void;
  setBackgroundMode(on: boolean): Promise<Settings>;
  onNavigate(cb: (view: string) => void): () => void;
  emailStatus(): Promise<{ account: EmailAccount | null; connected: boolean; profile: EmailProfile; autoDraft: boolean }>;
  emailConnect(input: EmailConnectInput): Promise<string>;
  emailDisconnect(): Promise<void>;
  emailSetProfile(p: EmailProfile, autoDraft: boolean): Promise<void>;
  emailTriage(): Promise<TriageResult>;
  emailLastTriage(): Promise<TriageResult | null>;
  emailDraft(uid: number): Promise<string>;
  emailSaveDraft(uid: number, body: string): Promise<void>;
  setVoiceSettings(v: Partial<VoiceSettings>): Promise<Settings & { voiceHotkeyActive: boolean }>;
  voiceRecording(recording: boolean, fromHotkey: boolean): void;
  voiceTranscribe(audio: Float32Array): Promise<{ text: string; pasted: boolean }>;
  onVoiceCommand(cb: (cmd: 'start' | 'stop') => void): () => void;
  onVoiceState(cb: (s: VoiceState) => void): () => void;
}
