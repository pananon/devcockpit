// Adds and ticks off todos in a repo's TODO.md. Only repos DevCockpit found in the
// user's project folders, and only the todo files it reads, are ever written.
import fs from 'node:fs';
import path from 'node:path';
import type { Todo } from '@shared/types';
import { getSettings } from './config';
import { findRepos, parseTodoLine, todoFiles } from './repos';

function knownRepo(repoPath: string): string {
  const repo = findRepos(getSettings().projectRoots).find((r) => r === repoPath);
  if (!repo) throw new Error('Not one of your repos');
  return repo;
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** One line of plain text: no line breaks, and no comment markers that would hide the date. */
const clean = (text: string) => text.replace(/<!--|-->/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500);

export function addTodo(repoPath: string, text: string) {
  const repo = knownRepo(repoPath);
  const item = clean(text);
  if (!item) throw new Error('Empty todo');
  const name = todoFiles(repo).find((n) => n.toLowerCase() === 'todo.md');
  const file = path.join(repo, name ?? 'TODO.md');
  const line = `- [ ] ${item} <!-- ${today()} -->`;
  if (!name) return fs.writeFileSync(file, `# TODO\n\n${line}\n`);
  const current = fs.readFileSync(file, 'utf8');
  const eol = current.includes('\r\n') ? '\r\n' : '\n';
  fs.writeFileSync(file, `${current}${current && !current.endsWith('\n') ? eol : ''}${line}${eol}`);
}

/** Ticks "- [ ]" to "- [x]", but only if that line still holds the same todo. */
export function completeTodo(repoPath: string, todo: Todo) {
  const repo = knownRepo(repoPath);
  const name = todoFiles(repo).find((n) => n === todo?.file);
  if (!name) throw new Error('Unknown todo file');
  const file = path.join(repo, name);
  const current = fs.readFileSync(file, 'utf8');
  const lines = current.split(/\r?\n/);
  const i = Number(todo.line);
  if (!Number.isInteger(i) || parseTodoLine(lines[i] ?? '')?.text !== todo.text) throw new Error('The file changed. Refresh and try again.');
  lines[i] = lines[i].replace('[ ]', '[x]');
  fs.writeFileSync(file, lines.join(current.includes('\r\n') ? '\r\n' : '\n'));
}
