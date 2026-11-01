import { useEffect, useMemo } from 'react';
import type { Repo } from '@shared/types';
import type { Actions, Data } from '../App';
import { useAi } from '../useAi';
import { ago, repoColor, samePath, tint } from '../util';
import { AiOutput } from './AiOutput';

interface Props {
  data: Data;
  actions: Actions;
  /** null = pick the most important repo */
  repoPath: string | null;
  onSwitch: (repoPath: string) => void;
  onClose: () => void;
}

const active = (r: Repo) => r.uncommitted.length > 0 || r.ahead > 0 || r.todos.length > 0;

/** One repo, one next step. Everything else waits in the queue. */
export function FocusMode({ data, actions, repoPath, onSwitch, onClose }: Props) {
  const repos = data.repos ?? [];
  const sessions = data.sessions ?? [];
  const summary = useAi();

  // Order: the brief's priorities, then repos with the most recent sessions, then other unfinished work.
  const ordered = useMemo(() => {
    const out: Repo[] = [];
    const add = (r: Repo | undefined) => r && !out.includes(r) && out.push(r);
    for (const f of data.brief?.focus ?? []) {
      if (f.ref.kind === 'repo') add(repos.find((r) => samePath(r.path, f.ref.id)));
      if (f.ref.kind === 'session') add(repos.find((r) => samePath(r.path, sessions.find((s) => s.id === f.ref.id)?.repoPath)));
      if (f.ref.kind === 'pr') add(repos.find((r) => r.github && f.ref.label.startsWith(r.github)));
    }
    for (const s of sessions) if (s.repoPath) add(repos.find((r) => samePath(r.path, s.repoPath) && active(r)));
    repos.filter(active).forEach(add);
    return out;
  }, [data.brief, repos, sessions]);

  const repo = (repoPath ? repos.find((r) => samePath(r.path, repoPath)) : undefined) ?? ordered[0];
  const queue = ordered.filter((r) => r !== repo).slice(0, 3);
  const last = repo ? sessions.find((s) => samePath(s.repoPath, repo.path)) : undefined;
  const repoSessions = repo ? sessions.filter((s) => samePath(s.repoPath, repo.path)) : [];
  const prs = repo?.github ? [...(data.prs?.mine ?? []), ...(data.prs?.reviewRequested ?? [])].filter((p) => p.repo.toLowerCase() === repo.github!.toLowerCase()) : [];
  const c = repoColor(repo?.name);

  const briefItem = data.brief?.focus.find(
    (f) =>
      (f.ref.kind === 'repo' && samePath(f.ref.id, repo?.path)) ||
      (f.ref.kind === 'session' && samePath(sessions.find((s) => s.id === f.ref.id)?.repoPath, repo?.path)) ||
      (f.ref.kind === 'pr' && !!repo?.github && f.ref.label.startsWith(repo.github))
  );
  const nextStep = briefItem?.action ??
    (last ? `Continue “${last.title}”` : repo?.uncommitted.length ? `Review and commit ${repo.uncommitted.length} changed files` : repo?.todos[0]?.text ?? 'Nothing pending here');

  const resume = () => repo && (last ? actions.openClaude(repo.path, { resumeId: last.id, title: last.title }) : actions.openClaude(repo.path));

  useEffect(() => {
    summary.reset();
  }, [repo?.path]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA'].includes(t.tagName) || t.classList.contains('xterm-helper-textarea') || e.ctrlKey || e.altKey) return;
      const n = Number(e.key);
      if (n >= 1 && n <= queue.length) onSwitch(queue[n - 1].path);
      if (e.key === 'Enter' && t.tagName !== 'BUTTON') {
        resume();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!repo) {
    return (
      <div className="focus" role="dialog" aria-label="Focus mode">
        <div className="card" style={{ maxWidth: 560, margin: '80px auto' }}>
          <h1 style={{ marginTop: 0 }}>Nothing to focus on</h1>
          <p className="muted">Every repo is committed and pushed, and there are no open to-dos. Enjoy it.</p>
          <button className="btn" onClick={onClose}>
            Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="focus" role="dialog" aria-label={`Focus mode: ${repo.name}`}>
      <main style={{ flex: '999 1 640px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="eyebrow" style={{ color: c }}>
            Focus · one thing at a time
          </span>
          <span className="small muted">
            Everything else is waiting · <span className="kbd">Esc</span> to leave{' '}
            <button className="btn small" onClick={onClose} style={{ marginLeft: 8 }}>
              Exit focus
            </button>
          </span>
        </div>

        <section className="focus-card" style={{ borderColor: tint(c, 0.5), boxShadow: `0 0 50px ${tint(c, 0.12)}` }}>
          <div className="row">
            <span className="led" style={{ background: c, width: 10, height: 10 }} />
            <span className="mono" style={{ color: c }}>
              {repo.name} · ⎇ {repo.branch}
            </span>
            {last && <span className="mono small muted">last active {ago(last.updatedAt)}</span>}
          </div>
          <h1 style={{ margin: 0, fontSize: 36, lineHeight: 1.15, maxWidth: 860 }}>{nextStep}</h1>
          {last?.lastPrompt && (
            <p style={{ margin: 0, fontSize: 15.5, lineHeight: 1.6, color: '#b9d3e3', maxWidth: 780 }}>
              Your last request in “{last.title}”: <em>“{last.lastPrompt}”</em>
            </p>
          )}
          <div className="row">
            <button
              className="btn primary"
              style={{ minHeight: 48, padding: '12px 20px', background: c, borderColor: c }}
              onClick={() => {
                resume();
                onClose();
              }}
            >
              {last ? 'Resume session' : 'Start a Claude session'} <span className="kbd" style={{ marginLeft: 8, color: 'inherit', background: 'transparent' }}>↵</span>
            </button>
            <button
              className="btn"
              onClick={() => {
                actions.openShell(repo.path);
                onClose();
              }}
            >
              Open shell
            </button>
            {last && (
              <button className="btn" onClick={() => (summary.running ? summary.stop() : summary.start({ kind: 'summarize', sessionId: last.id }))}>
                {summary.running ? 'Stop' : 'Where did I leave off?'}
              </button>
            )}
          </div>
          <AiOutput {...summary} />
        </section>

        <div className="grid2">
          <section className="card">
            <h3>To-dos{repo.todos[0] ? ` · ${repo.todos[0].file}` : ''}</h3>
            {repo.todos.length === 0 && <p className="muted small">No unchecked items in TODO.md, actions.md or ROADMAP.md.</p>}
            <ul className="todo">
              {repo.todos.slice(0, 10).map((t, i) => (
                <li key={i} style={{ display: 'flex', gap: 10 }}>
                  <span aria-hidden style={{ width: 14, height: 14, border: `1px solid ${tint(c, 0.7)}`, flexShrink: 0, marginTop: 4 }} />
                  {t.text}
                </li>
              ))}
            </ul>
          </section>
          <section className="card">
            <h3>Context</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div>
                <span className="mono" style={{ color: repo.uncommitted.length ? 'var(--warn)' : 'var(--ok)' }}>
                  {repo.uncommitted.length ? `${repo.uncommitted.length} uncommitted` : 'clean'}
                </span>
                {repo.uncommitted.length > 0 && <span className="muted small"> · {repo.uncommitted.slice(0, 4).map((f) => f.slice(3)).join(', ')}</span>}
              </div>
              {repo.ahead > 0 && <div className="mono" style={{ color: 'var(--info)' }}>↑{repo.ahead} not pushed</div>}
              {prs.map((p) => (
                <div key={p.url}>
                  <a onClick={() => actions.openExternal(p.url)}>
                    PR #{p.number} {p.title}
                  </a>
                </div>
              ))}
              <div className="mono small muted">
                {repoSessions.length} Claude sessions{last ? ` · latest “${last.title}”` : ''}
              </div>
            </div>
          </section>
        </div>
      </main>

      <aside aria-label="Up next" style={{ flex: '1 1 280px', maxWidth: 340, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span className="eyebrow" style={{ color: 'var(--muted)' }}>
          Up next · press a number to switch
        </span>
        {queue.map((r, i) => (
          <button key={r.path} className="focus-queue" onClick={() => onSwitch(r.path)}>
            <span className="kbd">{i + 1}</span>
            <span className="led" style={{ background: repoColor(r.name) }} />
            <span className="grow">
              <span style={{ display: 'block', fontWeight: 500 }}>{r.name}</span>
              <span className="mono small" style={{ color: r.uncommitted.length ? 'var(--warn)' : 'var(--muted)' }}>
                {r.uncommitted.length ? `${r.uncommitted.length} changed` : r.ahead ? `↑${r.ahead} unpushed` : `${r.todos.length} to-dos`} · ⎇ {r.branch}
              </span>
            </span>
          </button>
        ))}
        {queue.length === 0 && <p className="muted small">Nothing else is waiting.</p>}
      </aside>
    </div>
  );
}
