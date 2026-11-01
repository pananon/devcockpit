// What each routine action actually does.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import type { Brief, Routine } from '@shared/types';
import { buildBrief } from './brief';
import { getSettings } from './config';
import { childEnv } from './exec';
import { status as ollamaStatus } from './ollama';
import type { Runner } from './routines';
import { runTask } from './tasks';

const CLAUDE_TIMEOUT_MS = 15 * 60_000;
/** Claude Code routines can look but not touch: no edits, no shell. */
const READ_ONLY_TOOLS = 'Read,Grep,Glob';

function briefMarkdown(b: Brief): string {
  const focus = b.focus.length ? b.focus.map((f, i) => `${i + 1}. ${f.action} (${f.ref.label})`).join('\n') : 'Nothing pending.';
  const recent = b.recent.map((r) => `- **${r.repo}**: ${r.titles.join(' · ')}`).join('\n');
  return `### Focus today\n${focus}\n\n### Last 3 days\n${recent || 'No sessions.'}\n\n_Priorities by ${b.usedModel ? b.model : 'rules (no local model)'}_`;
}

async function askLocal(prompt: string, onProgress: (t: string) => void): Promise<string> {
  if (!getSettings().localAi) throw new Error('Skipped: local AI is off. Turn it on from the status bar or Settings to run this routine.');
  const status = await ollamaStatus();
  const model = getSettings().localModel ?? status.models[0]?.name;
  if (!status.running || !model) throw new Error('Ollama is not running or has no model. Set it up in the Local AI tab.');
  let out = '';
  await runTask(`routine-${Date.now()}`, model, { kind: 'ask', prompt }, (t) => onProgress((out += t)), () => {});
  return out;
}

/** Runs Claude Code headless. The prompt travels in an env var, never through a shell parser. */
function runClaude(prompt: string, cwd: string, onProgress: (t: string) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(cwd)) return reject(new Error(`Folder not found: ${cwd}`));
    const env = childEnv({ DEVCOCKPIT_PROMPT: prompt });
    const args = ['--output-format', 'text', '--allowedTools', READ_ONLY_TOOLS];
    const child =
      process.platform === 'win32'
        ? spawn(
            'powershell.exe',
            [
              '-NoProfile',
              '-NonInteractive',
              '-Command',
              `$c = Get-Command claude -CommandType Application -ErrorAction Stop | Select-Object -First 1; & $c.Source -p $env:DEVCOCKPIT_PROMPT ${args.join(' ')}`,
            ],
            { cwd, env, windowsHide: true }
          )
        : spawn('claude', ['-p', prompt, ...args], { cwd, env });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill(), CLAUDE_TIMEOUT_MS);
    child.stdout.on('data', (d) => onProgress((out += d.toString())));
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out.trim());
      else reject(new Error(err.trim().slice(0, 500) || `Claude Code exited with code ${code}`));
    });
  });
}

export function makeRunner(): Runner {
  return async (routine: Routine, onProgress) => {
    const a = routine.action;
    switch (a.type) {
      case 'brief':
        return briefMarkdown(await buildBrief());
      case 'ask':
        return askLocal(a.prompt, onProgress);
      case 'claude':
        return runClaude(a.prompt, a.cwd, onProgress);
    }
  };
}
