// Routines: scheduled jobs that run while DevCockpit is open (or in the tray).
// Stored as JSON in the app's data folder; each run's output is kept for review.
import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Routine, RoutineRun, RoutineSchedule } from '@shared/types';

const MAX_RUNS = 200;
const routinesFile = () => path.join(app.getPath('userData'), 'routines.json');
const runsFile = () => path.join(app.getPath('userData'), 'routine-runs.json');

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function writeJson(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file); // atomic replace, so a crash never leaves half a file
}

export const listRoutines = (): Routine[] => readJson<Routine[]>(routinesFile(), []);
export const listRuns = (): RoutineRun[] => readJson<RoutineRun[]>(runsFile(), []);

/** Next time a schedule fires after `from`. */
export function nextRun(s: RoutineSchedule, from = new Date()): Date {
  if (s.kind === 'interval') return new Date(from.getTime() + Math.max(0.25, s.hours) * 3600_000);
  const [h, m] = s.time.split(':').map(Number);
  const days = s.days.length ? s.days : [0, 1, 2, 3, 4, 5, 6];
  for (let add = 0; add <= 7; add++) {
    const d = new Date(from);
    d.setDate(d.getDate() + add);
    d.setHours(h, m, 0, 0);
    if (d > from && days.includes(d.getDay())) return d;
  }
  return new Date(from.getTime() + 86400_000);
}

export function saveRoutine(input: Omit<Routine, 'id' | 'nextRunAt' | 'lastRunAt'> & { id?: string }): Routine {
  const all = listRoutines();
  const existing = input.id ? all.find((r) => r.id === input.id) : undefined;
  const routine: Routine = {
    ...input,
    id: existing?.id ?? randomUUID(),
    lastRunAt: existing?.lastRunAt ?? null,
    nextRunAt: input.enabled ? nextRun(input.schedule).toISOString() : null,
  };
  writeJson(routinesFile(), existing ? all.map((r) => (r.id === routine.id ? routine : r)) : [...all, routine]);
  return routine;
}

export function deleteRoutine(id: string) {
  writeJson(routinesFile(), listRoutines().filter((r) => r.id !== id));
}

function updateRoutine(id: string, patch: Partial<Routine>) {
  writeJson(routinesFile(), listRoutines().map((r) => (r.id === id ? { ...r, ...patch } : r)));
}

function recordRun(run: RoutineRun) {
  const runs = listRuns().filter((r) => r.id !== run.id);
  writeJson(runsFile(), [run, ...runs].slice(0, MAX_RUNS));
}

export type Runner = (routine: Routine, onProgress: (text: string) => void) => Promise<string>;

const running = new Set<string>();

export async function runRoutine(routine: Routine, runner: Runner, onChange: (run: RoutineRun) => void): Promise<RoutineRun> {
  const run: RoutineRun = { id: randomUUID(), routineId: routine.id, routineName: routine.name, startedAt: new Date().toISOString(), finishedAt: null, status: 'running', output: '' };
  if (running.has(routine.id)) return { ...run, status: 'error', output: 'Already running.' };
  running.add(routine.id);
  recordRun(run);
  onChange(run);
  try {
    run.output = await runner(routine, (text) => {
      run.output = text;
      onChange(run);
    });
    run.status = 'ok';
  } catch (e) {
    run.status = 'error';
    run.output = `${run.output ? `${run.output}\n\n` : ''}Failed: ${String((e as Error)?.message ?? e)}`;
  } finally {
    running.delete(routine.id);
    run.finishedAt = new Date().toISOString();
    recordRun(run);
    updateRoutine(routine.id, { lastRunAt: run.startedAt, nextRunAt: routine.enabled ? nextRun(routine.schedule).toISOString() : null });
    onChange(run);
  }
  return run;
}

let timer: NodeJS.Timeout | null = null;

/**
 * Checks every 30 s for due routines. A run missed while the app was closed is
 * caught up once at startup if it was due within the last 12 hours.
 */
export function startScheduler(runner: Runner, onChange: (run: RoutineRun) => void) {
  const tick = (startup: boolean) => {
    const now = Date.now();
    for (const r of listRoutines()) {
      if (!r.enabled || !r.nextRunAt) continue;
      const due = new Date(r.nextRunAt).getTime();
      if (due > now) continue;
      if (startup && now - due > 12 * 3600_000) {
        updateRoutine(r.id, { nextRunAt: nextRun(r.schedule).toISOString() }); // too stale: skip to the next slot
        continue;
      }
      void runRoutine(r, runner, onChange);
    }
  };
  tick(true);
  timer = setInterval(() => tick(false), 30_000);
}

export const stopScheduler = () => timer && clearInterval(timer);
