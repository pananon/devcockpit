import fs from 'node:fs';
import path from 'node:path';
import type { Repo } from '@shared/types';
import { tryRun } from './exec';

const SKIP = new Set(['node_modules', 'dist', 'build', 'out', 'vendor', 'target']);
const TODO_FILES = ['todo.md', 'actions.md', 'roadmap.md'];

const isRepo = (dir: string) => fs.existsSync(path.join(dir, '.git'));

function subdirs(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.') && !SKIP.has(d.name))
      .map((d) => path.join(dir, d.name));
  } catch {
    return [];
  }
}

/** Git repos at a root, its children, or its grandchildren. */
export function findRepos(roots: string[]): string[] {
  const found = new Set<string>();
  for (const root of roots) {
    if (isRepo(root)) {
      found.add(root);
      continue;
    }
    for (const child of subdirs(root)) {
      if (isRepo(child)) found.add(child);
      else for (const grandchild of subdirs(child)) if (isRepo(grandchild)) found.add(grandchild);
    }
  }
  return [...found].sort((a, b) => a.localeCompare(b));
}

export function parseGithub(url: string | null): string | null {
  const m = url?.match(/github\.com[/:]([^/]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
  return m ? `${m[1]}/${m[2]}` : null;
}

function readTodos(repo: string): Repo['todos'] {
  const todos: Repo['todos'] = [];
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(repo);
  } catch {
    return todos;
  }
  for (const name of entries.filter((n) => TODO_FILES.includes(n.toLowerCase()))) {
    try {
      for (const line of fs.readFileSync(path.join(repo, name), 'utf8').split(/\r?\n/)) {
        const m = line.match(/^\s*[-*] \[ \]\s+(.+)/);
        if (m) todos.push({ file: name, text: m[1].trim() });
        if (todos.length >= 25) return todos;
      }
    } catch {
      // unreadable file: skip
    }
  }
  return todos;
}

export async function inspectRepo(repo: string): Promise<Repo> {
  const [status, log, remote] = await Promise.all([
    tryRun('git', ['status', '--porcelain=v1', '-b'], repo),
    tryRun('git', ['log', '-8', '--format=%h%x1f%s%x1f%cI'], repo),
    tryRun('git', ['remote', 'get-url', 'origin'], repo),
  ]);

  const lines = (status ?? '').split(/\r?\n/).filter(Boolean);
  const head = lines[0]?.startsWith('## ') ? lines.shift()!.slice(3) : '';
  // "main...origin/main [ahead 1, behind 2]" | "main" | "No commits yet on main" | "HEAD (no branch)"
  const branch = head.replace(/^No commits yet on /, '').split('...')[0].split(' ')[0] || 'HEAD';
  const commits = (log ?? '')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => {
      const [hash, subject, date] = l.split('\x1f');
      return { hash, subject, date };
    });
  const remoteUrl = remote?.trim() || null;

  return {
    path: repo,
    name: path.basename(repo),
    branch,
    remoteUrl,
    github: parseGithub(remoteUrl),
    uncommitted: lines,
    ahead: Number(head.match(/ahead (\d+)/)?.[1] ?? 0),
    behind: Number(head.match(/behind (\d+)/)?.[1] ?? 0),
    hasUpstream: head.includes('...'),
    lastCommit: commits[0] ?? null,
    recentCommits: commits,
    todos: readTodos(repo),
  };
}

/** Map with a concurrency limit, so dozens of repos don't spawn hundreds of gits at once. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export async function listRepos(roots: string[]): Promise<Repo[]> {
  return mapLimit(findRepos(roots), 6, inspectRepo);
}
