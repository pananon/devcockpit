// Reads Claude Code's session transcripts (~/.claude/projects/<dir>/<id>.jsonl).
// The format is internal to Claude Code and undocumented, so every field is
// optional here and unknown lines are skipped.
import { app } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import type { SessionSearchHit, SessionSummary, TranscriptItem } from '@shared/types';

const INDEX_VERSION = 2;
const MAX_SEARCH_CHARS = 300_000;
const MAX_FILE_PATHS = 500;

interface Indexed {
  mtimeMs: number;
  size: number;
  summary: Omit<SessionSummary, 'repoPath' | 'cwd'>;
  cwdCounts: Record<string, number>;
  filePaths: string[];
  searchText: string;
}

const configDir = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const projectsDir = () => path.join(configDir(), 'projects');
const indexFile = () => path.join(app.getPath('userData'), 'session-index.json');

let index: Map<string, Indexed> | null = null;

function loadIndex(): Map<string, Indexed> {
  if (index) return index;
  try {
    const raw = JSON.parse(fs.readFileSync(indexFile(), 'utf8'));
    if (raw.version === INDEX_VERSION) index = new Map(Object.entries(raw.entries as Record<string, Indexed>));
  } catch {
    // missing or corrupt: rebuild
  }
  return (index ??= new Map());
}

function saveIndex() {
  try {
    fs.mkdirSync(path.dirname(indexFile()), { recursive: true });
    fs.writeFileSync(indexFile(), JSON.stringify({ version: INDEX_VERSION, entries: Object.fromEntries(index!) }));
  } catch {
    // cache only; safe to lose
  }
}

/** Text of a message's content, whether it is a string or an array of blocks. */
function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n');
}

/** A prompt the human typed, as opposed to tool results or injected context. */
function humanPrompt(o: any): string | null {
  if (o.type !== 'user' || o.isMeta || o.isSidechain) return null;
  if (o.origin && o.origin.kind !== 'human') return null;
  const content = o.message?.content;
  if (Array.isArray(content) && content.some((b: any) => b?.type === 'tool_result')) return null;
  const text = textOf(content).trim();
  if (!text || text.startsWith('<system-reminder>') || text.startsWith('<local-command-stdout>')) return null;
  // "/model" style commands are stored as <command-name>/model</command-name>
  const cmd = text.match(/<command-name>([^<]+)<\/command-name>/);
  return cmd ? cmd[1].trim() : text;
}

function toolDetail(input: any): string {
  if (!input || typeof input !== 'object') return '';
  const v = input.command ?? input.file_path ?? input.path ?? input.pattern ?? input.url ?? input.query ?? input.description ?? input.prompt;
  return typeof v === 'string' ? v : '';
}

const oneLine = (s: string, n = 140) => s.replace(/\s+/g, ' ').trim().slice(0, n);

/** Local calendar day, e.g. "2026-11-02". */
export function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function parseSession(file: string, stat: fs.Stats): Promise<Indexed> {
  const id = path.basename(file, '.jsonl');
  let title = '';
  let firstPrompt = '';
  let lastPrompt = '';
  let gitBranch: string | null = null;
  let startedAt: string | null = null;
  let updatedAt: string | null = null;
  let userTurns = 0;
  let costUSD: number | null = null;
  // Claude Code writes a running cost total; each increase is charged to the day it was seen.
  let lastTotal = 0;
  const promptDays: Record<string, number> = {};
  const costDays: Record<string, number> = {};
  const cwdCounts: Record<string, number> = {};
  const filePaths: string[] = [];
  let searchText = '';

  const rl = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    let o: any;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof o.timestamp === 'string') {
      startedAt ??= o.timestamp;
      updatedAt = o.timestamp;
    }
    if (typeof o.cwd === 'string' && (o.type === 'user' || o.type === 'assistant')) cwdCounts[o.cwd] = (cwdCounts[o.cwd] ?? 0) + 1;
    if (typeof o.gitBranch === 'string' && o.gitBranch && o.gitBranch !== 'HEAD') gitBranch = o.gitBranch;

    if (o.type === 'ai-title' && typeof o.aiTitle === 'string') title = o.aiTitle;
    else if (o.type === 'summary' && typeof o.summary === 'string' && !title) title = o.summary;
    else if (o.type === 'last-prompt' && typeof o.lastPrompt === 'string') lastPrompt = o.lastPrompt;
    else if (o.type === 'cost-state' && typeof o.totalCostUSD === 'number') {
      costUSD = o.totalCostUSD;
      // A lower total means a new process resumed the session and started counting from zero.
      const added = o.totalCostUSD >= lastTotal ? o.totalCostUSD - lastTotal : o.totalCostUSD;
      lastTotal = o.totalCostUSD;
      const day = dayKey(updatedAt ?? new Date(stat.mtimeMs).toISOString());
      if (added > 0) costDays[day] = (costDays[day] ?? 0) + added;
    }

    const prompt = humanPrompt(o);
    if (prompt) {
      userTurns++;
      const day = dayKey(typeof o.timestamp === 'string' ? o.timestamp : (updatedAt ?? new Date(stat.mtimeMs).toISOString()));
      promptDays[day] = (promptDays[day] ?? 0) + 1;
      if (!firstPrompt) firstPrompt = prompt;
      if (searchText.length < MAX_SEARCH_CHARS) searchText += `\n${prompt}`;
    }
    if (o.type === 'assistant' && !o.isSidechain && Array.isArray(o.message?.content)) {
      for (const b of o.message.content) {
        if (b?.type === 'text' && typeof b.text === 'string' && searchText.length < MAX_SEARCH_CHARS) searchText += `\n${b.text}`;
        if (b?.type === 'tool_use' && filePaths.length < MAX_FILE_PATHS) {
          const p = b.input?.file_path ?? b.input?.notebook_path ?? b.input?.path;
          if (typeof p === 'string' && path.isAbsolute(p)) filePaths.push(p);
        }
      }
    }
  }

  return {
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    summary: {
      id,
      file,
      title: title || oneLine(firstPrompt, 80) || '(untitled session)',
      firstPrompt: oneLine(firstPrompt, 300),
      lastPrompt: oneLine(lastPrompt, 300),
      gitBranch,
      startedAt,
      updatedAt: updatedAt ?? new Date(stat.mtimeMs).toISOString(),
      userTurns,
      costUSD,
      promptDays,
      costDays,
    },
    cwdCounts,
    filePaths,
    searchText: searchText.slice(0, MAX_SEARCH_CHARS),
  };
}

function sessionFiles(): string[] {
  const out: string[] = [];
  let dirs: fs.Dirent[] = [];
  try {
    dirs = fs.readdirSync(projectsDir(), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const dir = path.join(projectsDir(), d.name);
    try {
      for (const f of fs.readdirSync(dir)) if (f.endsWith('.jsonl')) out.push(path.join(dir, f));
    } catch {
      // unreadable dir: skip
    }
  }
  return out;
}

const norm = (p: string) => path.resolve(p).replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();
const inside = (child: string, parent: string) => child === parent || child.startsWith(`${parent}/`);

/** The repo containing p (deepest match), or null. */
function repoFor(p: string, repos: string[]): string | null {
  const n = norm(p);
  let best: string | null = null;
  for (const r of repos) if (inside(n, norm(r)) && (!best || r.length > best.length)) best = r;
  return best;
}

/**
 * Sessions are often started from a parent folder (e.g. C:\Project) and then
 * work inside one repo, so vote using both working directories and touched files.
 */
function assignRepo(entry: Indexed, repos: string[]): { cwd: string; repoPath: string | null } {
  const cwds = Object.entries(entry.cwdCounts).sort((a, b) => b[1] - a[1]);
  const cwd = cwds[0]?.[0] ?? '';
  const votes = new Map<string, number>();
  const vote = (p: string, w: number) => {
    const r = repoFor(p, repos);
    if (r) votes.set(r, (votes.get(r) ?? 0) + w);
  };
  for (const [dir, count] of cwds) vote(dir, count);
  for (const f of entry.filePaths) vote(f, 1);
  const top = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
  return { cwd, repoPath: top?.[0] ?? null };
}

export async function listSessions(repos: string[]): Promise<SessionSummary[]> {
  const idx = loadIndex();
  const files = sessionFiles();
  const live = new Set(files);
  let changed = false;

  for (const file of files) {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(file);
    } catch {
      continue;
    }
    const cached = idx.get(file);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) continue;
    try {
      idx.set(file, await parseSession(file, stat));
      changed = true;
    } catch {
      // skip files that vanish or can't be read mid-scan
    }
  }
  for (const file of [...idx.keys()]) {
    if (!live.has(file)) {
      idx.delete(file);
      changed = true;
    }
  }
  if (changed) saveIndex();

  return [...idx.values()]
    .filter((e) => e.summary.userTurns > 0)
    .map((e) => ({ ...e.summary, ...assignRepo(e, repos) }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function findIndexed(id: string): Indexed | undefined {
  for (const e of loadIndex().values()) if (e.summary.id === id) return e;
  return undefined;
}

export function searchSessions(query: string): SessionSearchHit[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const hits: (SessionSearchHit & { updatedAt: string })[] = [];
  for (const e of loadIndex().values()) {
    const hay = `${e.summary.title}\n${e.searchText}`;
    const at = hay.toLowerCase().indexOf(q);
    if (at < 0) continue;
    const start = Math.max(0, at - 70);
    hits.push({
      id: e.summary.id,
      snippet: `${start > 0 ? '…' : ''}${oneLine(hay.slice(start, at + q.length + 90), 220)}`,
      updatedAt: e.summary.updatedAt,
    });
  }
  return hits.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 100).map(({ id, snippet }) => ({ id, snippet }));
}

export async function getTranscript(id: string): Promise<TranscriptItem[]> {
  // Only open files we indexed ourselves; never build a path from renderer input.
  const entry = findIndexed(id);
  if (!entry) return [];
  const items: TranscriptItem[] = [];
  const rl = readline.createInterface({ input: fs.createReadStream(entry.summary.file, 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) {
    if (items.length >= 5000) break;
    let o: any;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const at = typeof o.timestamp === 'string' ? o.timestamp : null;
    const prompt = humanPrompt(o);
    if (prompt) items.push({ kind: 'user', text: prompt, at });
    if (o.type === 'assistant' && !o.isSidechain && Array.isArray(o.message?.content)) {
      for (const b of o.message.content) {
        if (b?.type === 'text' && typeof b.text === 'string' && b.text.trim()) items.push({ kind: 'assistant', text: b.text, at });
        if (b?.type === 'tool_use') items.push({ kind: 'tool', name: String(b.name ?? 'tool'), detail: oneLine(toolDetail(b.input), 200), at });
      }
    }
  }
  return items;
}

/**
 * Moves sessions to the Recycle Bin / Trash: the transcript and its sidecar folder
 * (subagent and tool-output files). Paths come from our own index, never the renderer.
 */
export async function trashSessions(ids: string[], trash: (p: string) => Promise<void>): Promise<number> {
  let removed = 0;
  for (const id of ids) {
    const entry = findIndexed(id);
    if (!entry) continue;
    const file = entry.summary.file;
    const sidecar = path.join(path.dirname(file), id);
    try {
      await trash(file);
      if (/^[0-9a-f-]{36}$/i.test(id) && fs.existsSync(sidecar)) await trash(sidecar);
      index!.delete(file);
      removed++;
    } catch {
      // locked or already gone: leave it in the list
    }
  }
  if (removed) saveIndex();
  return removed;
}

export const sessionTitles = (ids: string[]) => ids.map((id) => findIndexed(id)?.summary.title).filter((t): t is string => !!t);

/**
 * Where to resume a session: the folder it was started in (the first working
 * directory in its transcript), so a session started in a git worktree reopens in
 * that worktree, not the main checkout. The path comes from a transcript file, so
 * it's only trusted if it resolves to an existing directory inside one of the
 * user's project folders. null = unknown, gone, or outside them.
 */
export function resumeCwd(id: string, roots: string[]): string | null {
  const first = Object.keys(findIndexed(id)?.cwdCounts ?? {})[0];
  if (!first) return null;
  try {
    const real = fs.realpathSync(first);
    if (!fs.statSync(real).isDirectory()) return null;
    const allowed = roots.some((r) => {
      try {
        return inside(norm(real), norm(fs.realpathSync(r)));
      } catch {
        return false;
      }
    });
    return allowed ? real : null;
  } catch {
    return null;
  }
}
