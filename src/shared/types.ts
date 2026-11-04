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
  todos: Todo[];
}

export interface Todo {
  file: string;
  text: string;
  /** 0-based line in the file, used to tick it off */
  line: number;
  /** from a trailing <!-- YYYY-MM-DD --> marker, if present */
  addedAt: string | null;
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
  /** prompts typed per local day, e.g. { "2026-11-02": 14 } */
  promptDays: Record<string, number>;
  /** Claude spend per local day in USD */
  costDays: Record<string, number>;
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
  /** keep running in the tray and start at login, so routines run with the window closed */
  backgroundMode: boolean;
  /** Claude sessions opened from DevCockpit may add todos to the repo's TODO.md when asked */
  saveTodos: boolean;
  /** false = no local model: the brief uses rules, Ask and summaries are hidden, Ollama is never contacted */
  localAi: boolean;
  /** how the user pays for Claude Code; costs in session files are always API-equivalent */
  billing: Billing;
  /** monthly subscription price in USD, used when billing is 'subscription' */
  planPrice: number;
  /** offer to save a skill to the library when a Claude session uses one */
  skillPrompts: boolean;
}

/** 'api' = billed per token; 'subscription' = a flat Pro or Max plan. */
export type Billing = 'api' | 'subscription';

export interface TerminalSpec {
  cwd: string;
  /** 'claude' runs Claude Code; 'shell' the default shell; 'ollama-install' the official Ollama installer */
  program: 'claude' | 'shell' | 'ollama-install';
  /** resume this Claude Code session */
  resumeId?: string;
  /** first message for a new Claude session */
  prompt?: string;
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

/** Live machine load for the status bar. GPU fields are null when they can't be read. */
export interface SystemUsage {
  cpuPct: number;
  ramUsedGB: number;
  ramTotalGB: number;
  gpu: { name: string; pct: number; vramUsedGB: number; vramTotalGB: number } | null;
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
  /** what the model was given, e.g. ['my-app'] */
  context?: string[];
  done?: boolean;
  error?: string;
}

export type RoutineSchedule = { kind: 'daily'; time: string; days: number[] } | { kind: 'interval'; hours: number };

export type RoutineAction =
  | { type: 'brief' }
  | { type: 'ask'; prompt: string }
  | { type: 'claude'; prompt: string; cwd: string };

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

/** Where a skill came from: ~/.claude/skills, a repo's .claude/skills, a Claude Code plugin, or GitHub (via the finder). */
export type SkillSourceKind = 'user' | 'project' | 'plugin' | 'online';

/** Something in a skill worth a look before trusting it. 'danger' items block installing into a repo. */
export interface SkillFinding {
  level: 'danger' | 'warn' | 'info';
  file: string;
  /** 1-based line, when the finding is about one line */
  line: number | null;
  message: string;
}

export interface SkillFile {
  /** path inside the skill folder, always with forward slashes */
  path: string;
  size: number;
  /** null for binary files, which can't be reviewed here */
  text: string | null;
}

/** A skill Claude used in a session that isn't in the library yet, or changed since it was saved. */
export interface SkillCandidate {
  /** as Claude invoked it, e.g. "build-awards-website" or "creative-claw:creativeclaw-generate-video" */
  name: string;
  description: string;
  sourceKind: SkillSourceKind;
  /** e.g. "~/.claude/skills", "repo tatvafit", "plugin creative-claw" */
  sourceLabel: string;
  uses: number;
  lastUsedAt: string;
  /** repos the sessions that used it belong to */
  repos: string[];
  /** saved before, but its source has changed since */
  changed: boolean;
  /** time it was last offered in the save prompt, if ever */
  promptedAt: string | null;
}

/** Everything needed to decide whether to trust a skill: every file, plus the scanner's findings. */
export interface SkillReview {
  name: string;
  description: string;
  sourceKind: SkillSourceKind;
  sourceLabel: string;
  files: SkillFile[];
  findings: SkillFinding[];
  /** SHA-256 of every file's path and bytes; saving refuses if the source no longer matches it */
  hash: string;
  totalBytes: number;
}

export interface LibrarySkill {
  /** folder name, also the name Claude Code sees once installed */
  id: string;
  /** name it was used under */
  name: string;
  description: string;
  sourceKind: SkillSourceKind;
  sourceLabel: string;
  savedAt: string;
  hash: string;
  fileCount: number;
  totalBytes: number;
  findings: SkillFinding[];
  /** the files on disk no longer match what was saved; installing is blocked */
  tampered: boolean;
  /** installed in ~/.claude/skills: 'same' as the library copy, or a 'different' version is there */
  userInstall: 'same' | 'different' | null;
  /** repos it was installed into from here */
  repoInstalls: string[];
  /** for skills from the finder: the GitHub folder it was downloaded from, at the pinned commit */
  url: string | null;
}

/** 'claude' = Claude Code searches the web (uses your Claude plan); 'github' = GitHub code search only, no AI. */
export type SkillSearchMode = 'claude' | 'github';

/** A skill found online. Everything except `why` and `concerns` was checked by DevCockpit itself on GitHub. */
export interface SkillSearchResult {
  /** opaque id; reviewing and saving only accept ids from a search */
  id: string;
  /** folder name, and the name it gets in your library */
  name: string;
  /** from the SKILL.md at the pinned commit */
  description: string;
  /** owner/name on GitHub */
  repo: string;
  /** folder holding SKILL.md, '' for the repo root */
  path: string;
  /** commit the skill is pinned to: what you review is exactly what gets saved */
  sha: string;
  url: string;
  stars: number;
  license: string | null;
  pushedAt: string;
  archived: boolean;
  fork: boolean;
  /** published by Anthropic */
  official: boolean;
  /** Claude's reason it fits, and anything it thinks you should check. Written by an AI that read web pages: treat as a hint */
  why: string;
  concerns: string;
  /** the scanner's findings for SKILL.md (the full folder is scanned on review) */
  findings: SkillFinding[];
  /** a skill with this folder name is already in your library */
  inLibrary: boolean;
}

export interface SkillSearch {
  results: SkillSearchResult[];
  /** suggestions thrown away because they weren't on GitHub, didn't exist, or had no SKILL.md */
  dropped: number;
  /** API-equivalent cost of Claude's search, when Claude Code reports it */
  costUSD: number | null;
  mode: SkillSearchMode;
}

/** 'user' = ~/.claude/skills, available in every repo; otherwise a repo path from the repo list. */
export type SkillTarget = 'user' | { repoPath: string };

export interface CockpitApi {
  getSettings(): Promise<Settings>;
  setProjectRoots(roots: string[]): Promise<Settings>;
  pickFolder(): Promise<string | null>;
  listRepos(): Promise<Repo[]>;
  listSessions(): Promise<SessionSummary[]>;
  getTranscript(id: string): Promise<TranscriptItem[]>;
  searchSessions(query: string): Promise<SessionSearchHit[]>;
  /** asks for confirmation, then moves the transcripts to the Recycle Bin; resolves to how many were removed */
  deleteSessions(ids: string[]): Promise<number>;
  addTodo(repoPath: string, text: string): Promise<void>;
  completeTodo(repoPath: string, todo: Todo): Promise<void>;
  setSaveTodos(on: boolean): Promise<Settings>;
  setBilling(billing: Billing, planPrice: number): Promise<Settings>;
  /** turning off unloads the model from memory and stops the Ollama server if DevCockpit started it */
  setLocalAi(on: boolean): Promise<Settings>;
  listPrs(): Promise<PrBuckets>;
  openExternal(url: string): Promise<void>;
  termCreate(spec: TerminalSpec): Promise<string>;
  termWrite(id: string, data: string): void;
  termResize(id: string, cols: number, rows: number): void;
  termKill(id: string): void;
  onTermData(cb: (id: string, data: string) => void): () => void;
  onTermExit(cb: (id: string, code: number) => void): () => void;
  /** clipboard goes through the main process: the page itself has no clipboard permission */
  clipboardRead(): Promise<string>;
  clipboardWrite(text: string): void;
  setLocalModel(tag: string | null): Promise<Settings>;
  startOllama(): Promise<boolean>;
  scanModels(): Promise<ModelReport>;
  systemUsage(): Promise<SystemUsage>;
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
  /** skills Claude used recently that aren't saved (or changed since) */
  skillCandidates(): Promise<SkillCandidate[]>;
  /** reads a used skill from disk for review; name must be one from skillCandidates */
  reviewSkill(name: string): Promise<SkillReview>;
  /** asks for confirmation, then copies the reviewed skill into the library; refuses if it changed since the review */
  saveSkill(name: string, hash: string): Promise<LibrarySkill | null>;
  listLibrary(): Promise<LibrarySkill[]>;
  /** the library copy's files, for reading */
  librarySkillFiles(id: string): Promise<SkillReview>;
  /** asks for confirmation, then copies a library skill into ~/.claude/skills or a repo's .claude/skills */
  installSkill(id: string, target: SkillTarget): Promise<boolean>;
  /** asks for confirmation, then moves the library copy to the Recycle Bin (installed copies stay) */
  removeLibrarySkill(id: string): Promise<boolean>;
  /** 'later' = don't offer again until it's used again; 'never' = never offer this skill */
  dismissSkill(name: string, how: 'later' | 'never'): Promise<void>;
  setSkillPrompts(on: boolean): Promise<Settings>;
  /** finds skills on GitHub; every result is verified with gh and pinned to a commit */
  searchSkills(query: string, mode: SkillSearchMode): Promise<SkillSearch>;
  cancelSkillSearch(): void;
  /** downloads a search result's whole folder at its pinned commit, for review; nothing is written to disk */
  reviewOnlineSkill(id: string): Promise<SkillReview>;
  /** asks for confirmation, then saves the reviewed download to the library; refuses if it differs from the review */
  saveOnlineSkill(id: string, hash: string): Promise<LibrarySkill | null>;
  onNavigate(cb: (view: string) => void): () => void;
}
