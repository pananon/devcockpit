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
