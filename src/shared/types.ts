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
}

export interface TerminalSpec {
  cwd: string;
  /** 'claude' runs Claude Code; 'shell' runs the default shell */
  program: 'claude' | 'shell';
  /** resume this Claude Code session */
  resumeId?: string;
  title?: string;
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
}
