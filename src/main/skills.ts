// The skills library: skills Claude used in your sessions, saved once and installable
// in any repo (or for every repo, via ~/.claude/skills).
//
// Trust rules, because a skill is instructions Claude follows and may include scripts:
// - Sources are found only in known places: ~/.claude/skills, the .claude/skills folder
//   of a repo from the repo list, and Claude Code's plugin folder. Names come from the
//   session index and are checked against a strict pattern; no path comes from the UI.
// - Nothing is saved or installed without a review in the UI and a confirmation
//   dialog shown by the main process.
// - Saving writes the exact bytes that were reviewed (checked by SHA-256). Installing
//   re-checks the library copy against the hash saved with it.
// - Symlinks are never followed inside a skill, sizes are capped, copied files are
//   never marked executable, and a replaced install goes to the Recycle Bin.
import { app } from 'electron';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { LibrarySkill, SkillCandidate, SkillFile, SkillFinding, SkillReview, SkillSourceKind, SkillTarget } from '@shared/types';
import { getSettings } from './config';
import { findRepos } from './repos';
import { hasSecrets, scanSkill } from './skillScan';
import { configDir, SKILL_NAME, skillUsage } from './sessions';

export const MAX_FILES = 200;
export const MAX_FILE_BYTES = 512 * 1024;
export const MAX_TOTAL_BYTES = 4 * 1024 * 1024;
export const MAX_DEPTH = 6;
const SKIP = new Set(['.git', 'node_modules', '.DS_Store', '__pycache__']);
export const ID = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

export interface Confirm {
  (opts: { title: string; message: string; detail: string; ok: string; danger?: boolean }): Promise<boolean>;
}

// ---------- reading a skill folder ----------

export interface Loaded {
  files: SkillFile[];
  buffers: Map<string, Buffer>;
  hash: string;
  totalBytes: number;
  /** problems met while reading, such as skipped symlinks */
  notes: SkillFinding[];
}

const isText = (b: Buffer) => !b.subarray(0, 8192).includes(0);

/** Reads every file in a skill folder, without following symlinks, within the size caps. */
function loadFolder(root: string): Loaded {
  if (!fs.lstatSync(root).isDirectory()) throw new Error('Not a skill folder');
  const buffers = new Map<string, Buffer>();
  const notes: SkillFinding[] = [];
  let total = 0;
  const walk = (dir: string, rel: string, depth: number) => {
    if (depth > MAX_DEPTH) throw new Error('Skill folder is nested too deeply');
    for (const d of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (SKIP.has(d.name)) continue;
      const r = rel ? `${rel}/${d.name}` : d.name;
      const full = path.join(dir, d.name);
      if (d.isSymbolicLink()) {
        notes.push({ level: 'warn', file: r, line: null, message: 'Symlink skipped: it points outside the skill and is not copied' });
        continue;
      }
      if (d.isDirectory()) walk(full, r, depth + 1);
      else if (d.isFile()) {
        if (buffers.size >= MAX_FILES) throw new Error(`Skill has more than ${MAX_FILES} files`);
        const size = fs.statSync(full).size;
        if (size > MAX_FILE_BYTES) throw new Error(`${r} is larger than ${MAX_FILE_BYTES / 1024} KB`);
        total += size;
        if (total > MAX_TOTAL_BYTES) throw new Error(`Skill is larger than ${MAX_TOTAL_BYTES / 1024 / 1024} MB`);
        buffers.set(r, fs.readFileSync(full));
      }
    }
  };
  walk(root, '', 0);
  return fromBuffers(buffers, notes, total);
}

/** Hashes and lists a skill's files (read from disk or downloaded). Paths use forward slashes. */
export function fromBuffers(buffers: Map<string, Buffer>, notes: SkillFinding[], total: number): Loaded {
  if (!buffers.has('SKILL.md')) throw new Error('No SKILL.md in the skill folder');
  const h = createHash('sha256');
  const files: SkillFile[] = [];
  for (const [p, b] of buffers) {
    h.update(`${p}\0${b.length}\0`).update(b);
    files.push({ path: p, size: b.length, text: isText(b) ? b.toString('utf8') : null });
  }
  // SKILL.md first, so the review opens on it.
  files.sort((a, b) => (a.path === 'SKILL.md' ? -1 : b.path === 'SKILL.md' ? 1 : 0));
  return { files, buffers, hash: h.digest('hex'), totalBytes: total, notes };
}

const tryLoad = (root: string): Loaded | null => {
  try {
    return loadFolder(root);
  } catch {
    return null;
  }
};

/** The description from SKILL.md's frontmatter, folded onto one line. */
export function describe(files: SkillFile[]): string {
  const text = files.find((f) => f.path === 'SKILL.md')?.text ?? '';
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '';
  const m = fm.match(/^description:[ \t]*(.*(?:\r?\n[ \t]+.*)*)/m);
  return (m?.[1] ?? '').replace(/^[>|][-+]?/, '').replace(/^['"]|['"]$/g, '').replace(/\s+/g, ' ').trim().slice(0, 400);
}

// ---------- finding a used skill on disk ----------

interface Source {
  dir: string;
  kind: SkillSourceKind;
  label: string;
}

const userSkillsDir = () => path.join(configDir(), 'skills');
const home = (p: string) => p.replace(os.homedir(), '~');

/** Plugin skills live under ~/.claude/plugins/…/<plugin>/…/skills/<skill>/SKILL.md. */
function pluginSkill(plugin: string, skill: string): string | null {
  const base = path.join(configDir(), 'plugins');
  let best: { dir: string; mtime: number } | null = null;
  const walk = (dir: string, depth: number, segs: string[]) => {
    if (depth > 6) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of entries) {
      if (!d.isDirectory() || SKIP.has(d.name)) continue; // Dirent.isDirectory() is false for symlinks
      const full = path.join(dir, d.name);
      if (d.name === 'skills' && segs.includes(plugin)) {
        const cand = path.join(full, skill);
        try {
          const st = fs.lstatSync(path.join(cand, 'SKILL.md'));
          if (st.isFile() && (!best || st.mtimeMs > best.mtime)) best = { dir: cand, mtime: st.mtimeMs };
        } catch {
          // not here
        }
        continue;
      }
      walk(full, depth + 1, [...segs, d.name]);
    }
  };
  walk(base, 0, []);
  return (best as { dir: string } | null)?.dir ?? null;
}

const hasSkillMd = (dir: string) => {
  try {
    return fs.statSync(path.join(dir, 'SKILL.md')).isFile();
  } catch {
    return false;
  }
};

/** Where Claude Code would have loaded this skill from, looking only in known places. */
function resolveSkill(name: string, repos: string[]): Source | null {
  if (!SKILL_NAME.test(name)) return null;
  const [a, b] = name.split(':');
  if (b) {
    const dir = pluginSkill(a, b);
    return dir ? { dir, kind: 'plugin', label: `plugin ${a}` } : null;
  }
  const user = path.join(userSkillsDir(), a);
  if (hasSkillMd(user)) return { dir: fs.realpathSync.native(user), kind: 'user', label: home(userSkillsDir()) };
  const known = new Set(findRepos(getSettings().projectRoots));
  for (const r of repos) {
    if (!known.has(r)) continue;
    const dir = path.join(r, '.claude', 'skills', a);
    if (hasSkillMd(dir)) return { dir: fs.realpathSync.native(dir), kind: 'project', label: `repo ${path.basename(r)}` };
  }
  return null;
}

// ---------- the library ----------

interface Meta {
  name: string;
  description: string;
  sourceKind: SkillSourceKind;
  sourceLabel: string;
  savedAt: string;
  hash: string;
  fileCount: number;
  totalBytes: number;
  repoInstalls: string[];
  /** where an online skill was downloaded from, pinned to a commit */
  origin?: { repo: string; path: string; sha: string };
}

interface Manifest {
  version: 1;
  skills: Record<string, Meta>;
  /** skill names never to offer again */
  ignored: string[];
  /** when each skill was last offered, so it's offered again only after a new use */
  prompted: Record<string, string>;
}

const libraryDir = () => path.join(app.getPath('userData'), 'skills');
const manifestFile = () => path.join(app.getPath('userData'), 'skills-library.json');

function loadManifest(): Manifest {
  try {
    const m = JSON.parse(fs.readFileSync(manifestFile(), 'utf8'));
    if (m?.version === 1 && m.skills && typeof m.skills === 'object') {
      const skills: Record<string, Meta> = {};
      for (const [id, meta] of Object.entries(m.skills)) if (ID.test(id)) skills[id] = meta as Meta;
      return { version: 1, skills, ignored: Array.isArray(m.ignored) ? m.ignored.filter((x: unknown) => typeof x === 'string') : [], prompted: m.prompted ?? {} };
    }
  } catch {
    // first run
  }
  return { version: 1, skills: {}, ignored: [], prompted: {} };
}

function saveManifest(m: Manifest) {
  fs.mkdirSync(path.dirname(manifestFile()), { recursive: true });
  fs.writeFileSync(manifestFile(), JSON.stringify(m, null, 2));
}

/** Folder name for a skill: the part after "plugin:". */
export function skillId(name: string): string {
  const id = name.split(':').pop() ?? '';
  if (!ID.test(id)) throw new Error('Invalid skill name');
  return id;
}

/**
 * Writes the files into a fresh folder next to dest, then swaps it in. Any existing
 * folder goes to the Recycle Bin first. Every path is checked to stay inside dest.
 */
async function writeFolder(dest: string, buffers: Map<string, Buffer>, trash: (p: string) => Promise<void>) {
  const parent = path.dirname(dest);
  fs.mkdirSync(parent, { recursive: true });
  const tmp = path.join(parent, `.${path.basename(dest)}.tmp-${randomUUID().slice(0, 8)}`);
  try {
    for (const [rel, buf] of buffers) {
      const out = path.resolve(tmp, ...rel.split('/'));
      if (!out.startsWith(tmp + path.sep) || rel.split('/').some((s) => s === '..' || s === '')) throw new Error(`Unsafe path in skill: ${rel}`);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, buf, { mode: 0o644 });
    }
    if (fs.existsSync(dest)) await trash(dest);
    fs.renameSync(tmp, dest);
  } catch (e) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw e;
  }
}

const count = (f: SkillFinding[], level: SkillFinding['level']) => f.filter((x) => x.level === level).length;

function findingSummary(findings: SkillFinding[]): string {
  const d = count(findings, 'danger');
  const w = count(findings, 'warn');
  if (!d && !w) return 'The scanner found nothing risky, but it cannot prove a skill is safe.';
  return `The scanner flagged ${d ? `${d} serious issue${d === 1 ? '' : 's'}` : ''}${d && w ? ' and ' : ''}${w ? `${w} thing${w === 1 ? '' : 's'} to check` : ''}. Make sure you read them.`;
}

const scriptsIn = (files: SkillFile[]) => files.filter((f) => /\.(sh|bash|zsh|ps1|psm1|bat|cmd|py|js|mjs|cjs|ts|rb|pl|php)$/i.test(f.path)).map((f) => f.path);

// ---------- public API (each one backs an IPC channel) ----------

export async function candidates(): Promise<SkillCandidate[]> {
  const repos = findRepos(getSettings().projectRoots);
  const usage = await skillUsage(repos);
  const m = loadManifest();
  const out: SkillCandidate[] = [];
  for (const [name, u] of usage) {
    if (m.ignored.includes(name)) continue;
    const src = resolveSkill(name, u.repos);
    const loaded = src && tryLoad(src.dir);
    if (!src || !loaded) continue; // built-in command, or a skill that's gone
    const saved = m.skills[skillId(name)];
    if (saved?.hash === loaded.hash) continue;
    out.push({
      name,
      description: describe(loaded.files),
      sourceKind: src.kind,
      sourceLabel: src.label,
      uses: u.uses,
      lastUsedAt: u.lastUsedAt,
      repos: u.repos,
      changed: !!saved,
      promptedAt: m.prompted[name] ?? null,
    });
  }
  return out.sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt));
}

async function usedSource(name: string): Promise<Source> {
  const usage = await skillUsage(findRepos(getSettings().projectRoots));
  const u = usage.get(name);
  if (!u) throw new Error("That skill hasn't been used in any session");
  const src = resolveSkill(name, u.repos);
  if (!src) throw new Error('The skill folder could not be found');
  return src;
}

export function toReview(name: string, src: { kind: SkillSourceKind; label: string }, loaded: Loaded): SkillReview {
  return {
    name,
    description: describe(loaded.files),
    sourceKind: src.kind,
    sourceLabel: src.label,
    files: loaded.files,
    findings: [...loaded.notes, ...scanSkill(loaded.files, src.kind, src.label)],
    hash: loaded.hash,
    totalBytes: loaded.totalBytes,
  };
}

export async function reviewSkill(name: string): Promise<SkillReview> {
  const src = await usedSource(name);
  return toReview(name, src, loadFolder(src.dir));
}

export async function saveSkill(name: string, reviewedHash: string, confirm: Confirm, trash: (p: string) => Promise<void>): Promise<LibrarySkill | null> {
  const src = await usedSource(name);
  const loaded = loadFolder(src.dir);
  if (loaded.hash !== reviewedHash) throw new Error('The skill changed since you reviewed it. Review it again.');
  const saved = await storeInLibrary({ name, id: skillId(name), kind: src.kind, label: src.label }, loaded, confirm, trash);
  if (saved) {
    const m = loadManifest();
    m.prompted[name] = new Date().toISOString();
    saveManifest(m);
  }
  return saved;
}

/**
 * Copies reviewed files into the library after a confirmation. The caller has
 * already checked that `loaded` is exactly what the person reviewed.
 */
export async function storeInLibrary(
  skill: { name: string; id: string; kind: SkillSourceKind; label: string; origin?: Meta['origin']; extra?: string },
  loaded: Loaded,
  confirm: Confirm,
  trash: (p: string) => Promise<void>
): Promise<LibrarySkill | null> {
  const id = skillId(skill.id);
  const review = toReview(skill.name, skill, loaded);
  const m = loadManifest();
  const ok = await confirm({
    title: 'Save skill',
    message: `Save “${skill.name}” to your DevCockpit library?`,
    detail:
      `${loaded.files.length} file${loaded.files.length === 1 ? '' : 's'} from ${skill.label}. ${findingSummary(review.findings)}` +
      (skill.extra ? `\n\n${skill.extra}` : '') +
      (m.skills[id] ? `\n\nThis replaces “${m.skills[id].name}”, already in your library under the same folder name.` : '') +
      '\n\nSaving only keeps a copy. Nothing is installed until you choose where.',
    ok: 'Save to library',
    danger: count(review.findings, 'danger') > 0,
  });
  if (!ok) return null;
  await writeFolder(path.join(libraryDir(), id), loaded.buffers, trash);
  m.skills[id] = {
    name: skill.name,
    description: review.description,
    sourceKind: skill.kind,
    sourceLabel: skill.label,
    savedAt: new Date().toISOString(),
    hash: loaded.hash,
    fileCount: loaded.files.length,
    totalBytes: loaded.totalBytes,
    repoInstalls: m.skills[id]?.repoInstalls ?? [],
    origin: skill.origin,
  };
  saveManifest(m);
  return listLibrary().find((s) => s.id === id) ?? null;
}

/** Library entries by folder name, with the online origin when there is one. */
export function libraryIndex(): Map<string, { hash: string; origin?: Meta['origin'] }> {
  return new Map(Object.entries(loadManifest().skills).map(([id, m]) => [id, { hash: m.hash, origin: m.origin }]));
}

export function listLibrary(): LibrarySkill[] {
  const m = loadManifest();
  return Object.entries(m.skills)
    .map(([id, meta]) => {
      const loaded = tryLoad(path.join(libraryDir(), id));
      const installed = tryLoad(path.join(userSkillsDir(), id));
      return {
        id,
        name: meta.name,
        description: meta.description,
        sourceKind: meta.sourceKind,
        sourceLabel: meta.sourceLabel,
        savedAt: meta.savedAt,
        hash: meta.hash,
        fileCount: meta.fileCount,
        totalBytes: meta.totalBytes,
        findings: loaded ? [...loaded.notes, ...scanSkill(loaded.files, meta.sourceKind, meta.sourceLabel)] : [],
        tampered: loaded?.hash !== meta.hash,
        userInstall: installed ? (installed.hash === meta.hash ? 'same' : 'different') : null,
        url: meta.origin ? `https://github.com/${meta.origin.repo}/tree/${meta.origin.sha}${meta.origin.path ? `/${meta.origin.path}` : ''}` : null,
        repoInstalls: meta.repoInstalls.filter((r) => tryLoad(path.join(r, '.claude', 'skills', id))?.hash === meta.hash),
      } satisfies LibrarySkill;
    })
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

function libraryCopy(id: string): { meta: Meta; loaded: Loaded } {
  const meta = loadManifest().skills[skillId(id)];
  if (!meta) throw new Error('Not in your library');
  const loaded = loadFolder(path.join(libraryDir(), skillId(id)));
  return { meta, loaded };
}

export function librarySkillFiles(id: string): SkillReview {
  const { meta, loaded } = libraryCopy(id);
  return toReview(meta.name, { kind: meta.sourceKind, label: meta.sourceLabel }, loaded);
}

export async function installSkill(id: string, target: SkillTarget, confirm: Confirm, trash: (p: string) => Promise<void>): Promise<boolean> {
  const { meta, loaded } = libraryCopy(id);
  if (loaded.hash !== meta.hash) throw new Error('The library copy was changed on disk after it was saved. Remove it and save it again.');
  const findings = scanSkill(loaded.files, meta.sourceKind, meta.sourceLabel);
  let base: string;
  let where: string;
  let repo: string | null = null;
  if (target === 'user') {
    base = userSkillsDir();
    where = `${home(base)}: Claude Code loads it in every repo.`;
  } else {
    repo = findRepos(getSettings().projectRoots).find((r) => r === target?.repoPath) ?? null;
    if (!repo) throw new Error('Not one of your repos');
    if (hasSecrets(findings)) throw new Error('This skill seems to contain a secret (an API key or token). Remove it from the skill before installing it into a repo, where it could be committed.');
    base = path.join(repo, '.claude', 'skills');
    where = `${path.basename(repo)}/.claude/skills. If you commit it, everyone who clones ${path.basename(repo)} gets this skill, and Claude can use it in their sessions.`;
  }
  const dest = path.join(base, skillId(id));
  const existing = tryLoad(dest) ?? (fs.existsSync(dest) ? ({ hash: '' } as Loaded) : null);
  if (existing?.hash === meta.hash) return true; // already there, identical
  const scripts = scriptsIn(loaded.files);
  const ok = await confirm({
    title: 'Install skill',
    message: `Install “${meta.name}”?`,
    detail:
      `Into ${where}\n\n${findingSummary(findings)}` +
      (scripts.length ? `\n\nIt includes scripts Claude may run: ${scripts.slice(0, 6).join(', ')}${scripts.length > 6 ? '…' : ''}` : '') +
      (existing ? `\n\nA different version is already there. It will be moved to the ${process.platform === 'win32' ? 'Recycle Bin' : 'Trash'}.` : ''),
    ok: existing ? 'Replace and install' : 'Install',
    danger: count(findings, 'danger') > 0 || !!existing,
  });
  if (!ok) return false;
  await writeFolder(dest, loaded.buffers, trash);
  if (repo) {
    const m = loadManifest();
    const s = m.skills[skillId(id)];
    if (s && !s.repoInstalls.includes(repo)) s.repoInstalls.push(repo);
    saveManifest(m);
  }
  return true;
}

export async function removeLibrarySkill(id: string, confirm: Confirm, trash: (p: string) => Promise<void>): Promise<boolean> {
  const key = skillId(id);
  const m = loadManifest();
  const meta = m.skills[key];
  if (!meta) return false;
  const ok = await confirm({
    title: 'Remove skill',
    message: `Remove “${meta.name}” from your library?`,
    detail: `The library copy moves to the ${process.platform === 'win32' ? 'Recycle Bin' : 'Trash'}. Copies you installed in ~/.claude/skills or in repos stay where they are.`,
    ok: 'Remove from library',
    danger: true,
  });
  if (!ok) return false;
  const dir = path.join(libraryDir(), key);
  if (fs.existsSync(dir)) await trash(dir);
  delete m.skills[key];
  saveManifest(m);
  return true;
}

export function dismissSkill(name: string, how: 'later' | 'never') {
  if (!SKILL_NAME.test(name)) throw new Error('Invalid skill name');
  const m = loadManifest();
  if (how === 'never' && !m.ignored.includes(name)) m.ignored.push(name);
  m.prompted[name] = new Date().toISOString();
  saveManifest(m);
}
