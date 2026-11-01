import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import * as pty from 'node-pty';
import type { TerminalSpec } from '@shared/types';
import { getSettings } from './config';
import { childEnv } from './exec';
import { installScript } from './ollamaInstall';

const terms = new Map<string, pty.IPty>();

function shell(): { file: string; args: string[] } {
  if (process.platform === 'win32') return { file: 'powershell.exe', args: ['-NoLogo'] };
  return { file: process.env.SHELL || '/bin/bash', args: ['-l'] };
}

/**
 * Added to Claude sessions opened here (Settings > Claude sessions), so "add that to my
 * todos" lands in TODO.md, where the Todos tab picks it up. No double quotes: Windows
 * PowerShell 5.1 mangles them when passing arguments to programs.
 */
const TODO_INSTRUCTIONS = [
  'DevCockpit todo list: when the user asks you to add something to their todos, note it for later, or save it to continue later,',
  'append one line to TODO.md in the root of the current git repository (create it with a # TODO heading if it does not exist):',
  '- [ ] <description> <!-- YYYY-MM-DD -->, using the current date.',
  'Write the description so it still makes sense days later on its own: name the feature, file or bug, and the next step.',
  'Only add what the user asked for, then carry on. When the user says a todo is done, change its [ ] to [x].',
].join(' ');

/**
 * Claude Code runs inside the user's shell (so PATH, profiles and .cmd shims
 * behave exactly as in their own terminal). The session id is validated as a
 * UUID before it is ever placed on a command line.
 */
function command(spec: TerminalSpec): { file: string; args: string[] } {
  const sh = shell();
  if (spec.program === 'shell') return sh;
  if (spec.program === 'ollama-install') {
    // The script is fixed in the main process; the renderer can only ask for it by name.
    if (process.platform === 'win32') return { file: sh.file, args: [...sh.args, '-NoExit', '-Command', installScript()] };
    return { file: sh.file, args: [...sh.args, '-c', `${installScript()}\nexec ${sh.file}`] };
  }
  const resume = spec.resumeId && /^[0-9a-f-]{36}$/i.test(spec.resumeId) ? ` --resume ${spec.resumeId}` : '';
  // The instructions and first message travel in environment variables (see createTerminal),
  // so their text is never parsed by the shell.
  const win = process.platform === 'win32';
  const extra =
    (getSettings().saveTodos ? (win ? ' --append-system-prompt $env:DEVCOCKPIT_SYSTEM' : ' --append-system-prompt "$DEVCOCKPIT_SYSTEM"') : '') +
    (spec.prompt ? (win ? ' $env:DEVCOCKPIT_PROMPT' : ' "$DEVCOCKPIT_PROMPT"') : '');
  if (win) {
    // Run claude.exe / claude.cmd directly: npm's claude.ps1 shim is blocked under the
    // default execution policy, and we don't want to weaken that policy.
    const launch = `$c = Get-Command claude -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1; if ($c) { & $c.Source${resume}${extra} } else { Write-Host 'Claude Code not found on PATH. Install it from https://claude.com/claude-code' -ForegroundColor Yellow }`;
    return { file: sh.file, args: [...sh.args, '-NoExit', '-Command', launch] };
  }
  return { file: sh.file, args: [...sh.args, '-c', `claude${resume}${extra}; exec ${sh.file}`] };
}

export function createTerminal(
  spec: TerminalSpec,
  onData: (id: string, data: string) => void,
  onExit: (id: string, code: number) => void
): string {
  const id = randomUUID();
  const cwd = spec.cwd && fs.existsSync(spec.cwd) ? spec.cwd : os.homedir();
  const { file, args } = command(spec);
  const p = pty.spawn(file, args, {
    name: 'xterm-256color',
    cols: 100,
    rows: 30,
    cwd,
    env: childEnv({
      TERM_PROGRAM: 'DevCockpit',
      DEVCOCKPIT_SYSTEM: TODO_INSTRUCTIONS,
      // Double quotes become single ones for the same PowerShell 5.1 reason.
      ...(spec.prompt ? { DEVCOCKPIT_PROMPT: spec.prompt.replace(/\s+/g, ' ').replace(/"/g, "'") } : {}),
    }),
  });
  p.onData((d) => onData(id, d));
  p.onExit(({ exitCode }) => {
    terms.delete(id);
    onExit(id, exitCode);
  });
  terms.set(id, p);
  return id;
}

export const writeTerminal = (id: string, data: string) => terms.get(id)?.write(data);

export function resizeTerminal(id: string, cols: number, rows: number) {
  if (cols > 0 && rows > 0 && cols < 1000 && rows < 1000) terms.get(id)?.resize(Math.floor(cols), Math.floor(rows));
}

export function killTerminal(id: string) {
  terms.get(id)?.kill();
  terms.delete(id);
}

export function killAll() {
  for (const id of [...terms.keys()]) killTerminal(id);
}
