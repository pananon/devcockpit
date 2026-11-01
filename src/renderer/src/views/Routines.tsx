import { useEffect, useState } from 'react';
import type { Routine, RoutineAction, RoutineInput, RoutineRun, RoutineSchedule } from '@shared/types';
import type { Data } from '../App';
import { Markdown } from '../components/Markdown';
import { ago, baseName } from '../util';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAYS = [1, 2, 3, 4, 5];

const ACTION_LABEL: Record<RoutineAction['type'], string> = {
  brief: 'Daily brief',
  ask: 'Ask the local model',
  claude: 'Claude Code task (uses Claude tokens)',
  email: 'Email triage and drafts',
};

const TEMPLATES: { label: string; routine: RoutineInput }[] = [
  {
    label: 'Weekday morning brief at 9:00',
    routine: { name: 'Morning brief', enabled: true, notify: true, schedule: { kind: 'daily', time: '09:00', days: WEEKDAYS }, action: { type: 'brief' } },
  },
  {
    label: 'End-of-day wrap-up at 18:30',
    routine: {
      name: 'End-of-day wrap-up',
      enabled: true,
      notify: true,
      schedule: { kind: 'daily', time: '18:30', days: WEEKDAYS },
      action: { type: 'ask', prompt: 'What did I work on today, what is still uncommitted or unpushed, and what should I pick up first tomorrow?' },
    },
  },
  {
    label: 'Email triage every 2 hours',
    routine: { name: 'Email triage', enabled: true, notify: true, schedule: { kind: 'interval', hours: 2 }, action: { type: 'email' } },
  },
];

function describe(s: RoutineSchedule) {
  if (s.kind === 'interval') return `Every ${s.hours} hour${s.hours === 1 ? '' : 's'}`;
  const days = s.days.length === 7 || !s.days.length ? 'Every day' : s.days.join() === WEEKDAYS.join() ? 'Weekdays' : s.days.map((d) => DAYS[d]).join(', ');
  return `${days} at ${s.time}`;
}

const until = (iso: string | null) => {
  if (!iso) return 'paused';
  const m = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  if (m <= 0) return 'due now';
  if (m < 60) return `in ${m} min`;
  if (m < 1440) return `in ${Math.round(m / 60)} h`;
  return new Date(iso).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
};

export function Routines({ data }: { data: Data }) {
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [runs, setRuns] = useState<RoutineRun[]>([]);
  const [editing, setEditing] = useState<RoutineInput | null>(null);
  const [openRun, setOpenRun] = useState<string | null>(null);
  const [background, setBackground] = useState(false);

  const reload = async () => {
    setRoutines(await window.cockpit.listRoutines());
    setRuns(await window.cockpit.listRoutineRuns());
  };

  useEffect(() => {
    reload();
    window.cockpit.getSettings().then((s) => setBackground(s.backgroundMode));
    return window.cockpit.onRoutineRun((run) => {
      setRuns((all) => [run, ...all.filter((r) => r.id !== run.id)]);
      if (run.status !== 'running') window.cockpit.listRoutines().then(setRoutines);
    });
  }, []);

  const save = async (r: RoutineInput) => {
    await window.cockpit.saveRoutine(r);
    setEditing(null);
    reload();
  };

  const toggleBackground = async (on: boolean) => setBackground((await window.cockpit.setBackgroundMode(on)).backgroundMode);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Routines</h1>
          <p className="muted">Jobs that run on a schedule: your brief, questions to the local model, Claude Code tasks, email triage.</p>
        </div>
        <button className="btn primary" onClick={() => setEditing({ name: '', enabled: true, notify: true, schedule: { kind: 'daily', time: '09:00', days: WEEKDAYS }, action: { type: 'brief' } })}>
          New routine
        </button>
      </header>

      <section className="card">
        <label className="check big">
          <input type="checkbox" checked={background} onChange={(e) => toggleBackground(e.target.checked)} />
          Keep running in the tray and start at login, so routines run with the window closed
        </label>
        <p className="muted small">
          {background
            ? 'On: closing the window hides DevCockpit to the tray. Quit from the tray icon.'
            : 'Off: routines only run while DevCockpit is open.'}
        </p>
      </section>

      {editing && <Editor initial={editing} repos={(data.repos ?? []).map((r) => r.path)} onSave={save} onCancel={() => setEditing(null)} />}

      {routines.length === 0 && !editing && (
        <section className="card">
          <h3>Start with a template</h3>
          <div className="row">
            {TEMPLATES.map((t) => (
              <button key={t.label} className="btn" onClick={() => save(t.routine)}>
                + {t.label}
              </button>
            ))}
          </div>
        </section>
      )}

      {routines.length > 0 && (
        <section className="card">
          <h3>Your routines</h3>
          <ul className="list">
            {routines.map((r) => {
              const last = runs.find((x) => x.routineId === r.id);
              return (
                <li key={r.id} className="list-row static routine-row">
                  <label className="switch" title={r.enabled ? 'On' : 'Paused'}>
                    <input type="checkbox" checked={r.enabled} onChange={(e) => save({ ...r, enabled: e.target.checked })} />
                    <span />
                  </label>
                  <div className="grow">
                    <div className="title">{r.name}</div>
                    <div className="muted small">
                      {ACTION_LABEL[r.action.type]} · {describe(r.schedule)} · next {until(r.nextRunAt)}
                      {last && (
                        <>
                          {' '}
                          · last <span className={last.status === 'error' ? 'warn-text' : ''}>{last.status === 'running' ? 'running…' : `${last.status === 'ok' ? 'ok' : 'failed'} ${ago(last.startedAt)}`}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <button className="btn small" onClick={() => window.cockpit.runRoutineNow(r.id)} disabled={last?.status === 'running'}>
                    Run now
                  </button>
                  <button className="btn small" onClick={() => setEditing(r)}>
                    Edit
                  </button>
                  <button className="btn small" onClick={async () => (await window.cockpit.deleteRoutine(r.id), reload())}>
                    Delete
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {runs.length > 0 && (
        <section className="card">
          <h3>Recent runs</h3>
          <ul className="list">
            {runs.slice(0, 30).map((run) => (
              <li key={run.id}>
                <div className="list-row" onClick={() => setOpenRun(openRun === run.id ? null : run.id)}>
                  <span className={`chip ${run.status === 'ok' ? 'ok' : run.status === 'error' ? 'warn' : 'info'}`}>{run.status}</span>
                  <div className="grow title">{run.routineName}</div>
                  <span className="muted small">{ago(run.startedAt)}</span>
                </div>
                {(openRun === run.id || run.status === 'running') && run.output && (
                  <div className="ai-output run-output">
                    <Markdown text={run.output} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Editor({ initial, repos, onSave, onCancel }: { initial: RoutineInput; repos: string[]; onSave: (r: RoutineInput) => void; onCancel: () => void }) {
  const [r, setR] = useState<RoutineInput>(initial);
  const a = r.action;
  const s = r.schedule;
  const setAction = (type: RoutineAction['type']) =>
    setR({
      ...r,
      action: type === 'ask' ? { type, prompt: '' } : type === 'claude' ? { type, prompt: '', cwd: repos[0] ?? '' } : { type },
      name: r.name || ACTION_LABEL[type].replace(/ \(.*\)/, ''),
    });
  const valid = r.name.trim() && (a.type !== 'ask' || a.prompt.trim()) && (a.type !== 'claude' || (a.prompt.trim() && a.cwd));

  return (
    <section className="card">
      <h3>{initial.id ? 'Edit routine' : 'New routine'}</h3>
      <div className="form-grid">
        <label className="field">
          <span className="muted small">Name</span>
          <input className="input" value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} />
        </label>
        <label className="field">
          <span className="muted small">What it does</span>
          <select className="input" value={a.type} onChange={(e) => setAction(e.target.value as RoutineAction['type'])}>
            {Object.entries(ACTION_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </div>

      {a.type === 'ask' && (
        <label className="field">
          <span className="muted small">Question for the local model (it sees your repos, sessions and PRs)</span>
          <textarea className="input" rows={3} value={a.prompt} onChange={(e) => setR({ ...r, action: { ...a, prompt: e.target.value } })} />
        </label>
      )}
      {a.type === 'claude' && (
        <>
          <label className="field">
            <span className="muted small">Repo</span>
            <select className="input" value={a.cwd} onChange={(e) => setR({ ...r, action: { ...a, cwd: e.target.value } })}>
              {repos.map((p) => (
                <option key={p} value={p}>
                  {baseName(p)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="muted small">Prompt for Claude Code. Runs read-only (it can read and search files, but not edit or run commands) and uses your Claude tokens.</span>
            <textarea className="input" rows={3} value={a.prompt} onChange={(e) => setR({ ...r, action: { ...a, prompt: e.target.value } })} />
          </label>
        </>
      )}

      <div className="form-grid">
        <label className="field">
          <span className="muted small">When</span>
          <select
            className="input"
            value={s.kind}
            onChange={(e) => setR({ ...r, schedule: e.target.value === 'interval' ? { kind: 'interval', hours: 2 } : { kind: 'daily', time: '09:00', days: WEEKDAYS } })}
          >
            <option value="daily">At a time of day</option>
            <option value="interval">Every few hours</option>
          </select>
        </label>
        {s.kind === 'daily' ? (
          <label className="field">
            <span className="muted small">Time</span>
            <input className="input" type="time" value={s.time} onChange={(e) => setR({ ...r, schedule: { ...s, time: e.target.value } })} />
          </label>
        ) : (
          <label className="field">
            <span className="muted small">Every (hours)</span>
            <input className="input" type="number" min={0.25} step={0.25} value={s.hours} onChange={(e) => setR({ ...r, schedule: { ...s, hours: Number(e.target.value) } })} />
          </label>
        )}
      </div>
      {s.kind === 'daily' && (
        <div className="row days">
          {DAYS.map((d, i) => (
            <label key={d} className={`day ${s.days.includes(i) ? 'on' : ''}`}>
              <input
                type="checkbox"
                checked={s.days.includes(i)}
                onChange={(e) => setR({ ...r, schedule: { ...s, days: e.target.checked ? [...s.days, i].sort() : s.days.filter((x) => x !== i) } })}
              />
              {d}
            </label>
          ))}
        </div>
      )}
      <label className="check big">
        <input type="checkbox" checked={r.notify} onChange={(e) => setR({ ...r, notify: e.target.checked })} /> Show a notification when it finishes
      </label>
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn primary" disabled={!valid} onClick={() => onSave(r)}>
          Save
        </button>
        <button className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </section>
  );
}
