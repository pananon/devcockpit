import { execFile } from 'node:child_process';

/** Run a program without a shell, so arguments are never interpreted. */
export function run(cmd: string, args: string[], cwd?: string, timeout = 15000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, timeout, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout.toString());
    });
  });
}

/** Like run(), but resolves to null instead of throwing. */
export async function tryRun(cmd: string, args: string[], cwd?: string, timeout?: number): Promise<string | null> {
  try {
    return await run(cmd, args, cwd, timeout);
  } catch {
    return null;
  }
}

/**
 * Environment for terminals and routines. Drops the parent Claude Code session's
 * variables (session id, messaging token, child-session marker) in case DevCockpit
 * was itself started from a Claude terminal: leaking them would hand a token to child
 * processes and make each new Claude session think it's a sub-session that
 * doesn't save transcripts.
 */
export function childEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined || /^claude/i.test(k)) continue;
    env[k] = v;
  }
  return { ...env, ...extra };
}
