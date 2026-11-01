import type { Actions, Data } from '../App';
import { ago, baseName, samePath } from '../util';

export function Today({ data, actions }: { data: Data; actions: Actions }) {
  const { repos, sessions, prs } = data;
  const recent = (sessions ?? []).slice(0, 6);
  const dirty = (repos ?? []).filter((r) => r.uncommitted.length || r.ahead || r.behind);
  const todos = (repos ?? []).flatMap((r) => r.todos.map((t) => ({ ...t, repo: r }))).slice(0, 8);
  const reviews = prs?.reviewRequested ?? [];
  const myPrs = prs?.mine ?? [];

  // "Start here": the latest session, preferring one whose repo still has unfinished work.
  const startHere =
    recent.find((s) => dirty.some((r) => samePath(r.path, s.repoPath))) ?? recent[0] ?? null;
  const startRepo = startHere && repos?.find((r) => samePath(r.path, startHere.repoPath));

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{greeting}</h1>
          <p className="muted">{new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        </div>
      </header>

      <div className="stats">
        <Stat label="Repos with changes" value={repos ? dirty.length : '…'} onClick={() => actions.go('repos')} />
        <Stat label="Unpushed commits" value={repos ? repos.reduce((n, r) => n + r.ahead, 0) : '…'} onClick={() => actions.go('repos')} />
        <Stat label="Your open PRs" value={prs ? myPrs.length : '…'} onClick={() => actions.go('prs')} />
        <Stat label="Reviews waiting" value={prs ? reviews.length : '…'} tone={reviews.length ? 'warn' : undefined} onClick={() => actions.go('prs')} />
      </div>

      {startHere && (
        <section className="card hero">
          <div className="eyebrow">Start here</div>
          <h2>{startHere.title}</h2>
          <p className="muted">
            {startHere.repoPath ? baseName(startHere.repoPath) : baseName(startHere.cwd)}
            {startHere.gitBranch && <> · {startHere.gitBranch}</>} · {ago(startHere.updatedAt)}
            {startRepo && startRepo.uncommitted.length > 0 && <> · {startRepo.uncommitted.length} uncommitted files</>}
          </p>
          {startHere.lastPrompt && <p className="quote">“{startHere.lastPrompt}”</p>}
          <div className="row">
            <button className="btn primary" onClick={() => actions.openClaude(startHere.repoPath ?? startHere.cwd, { resumeId: startHere.id, title: startHere.title })}>
              Resume session
            </button>
            <button className="btn" onClick={() => actions.go('sessions', startHere.id)}>
              Read transcript
            </button>
          </div>
        </section>
      )}

      <div className="grid2">
        <section className="card">
          <h3>Pick up where you left off</h3>
          {sessions === null && <p className="muted">Reading sessions…</p>}
          {sessions?.length === 0 && <p className="muted">No Claude Code sessions found yet.</p>}
          <ul className="list">
            {recent.map((s) => (
              <li key={s.id} className="list-row" onClick={() => actions.go('sessions', s.id)}>
                <div className="grow">
                  <div className="title">{s.title}</div>
                  <div className="muted small">
                    {s.repoPath ? baseName(s.repoPath) : baseName(s.cwd)} · {ago(s.updatedAt)}
                  </div>
                </div>
                <button
                  className="btn small"
                  onClick={(e) => {
                    e.stopPropagation();
                    actions.openClaude(s.repoPath ?? s.cwd, { resumeId: s.id, title: s.title });
                  }}
                >
                  Resume
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="card">
          <h3>Needs attention</h3>
          {repos === null && <p className="muted">Scanning repos…</p>}
          {repos && dirty.length === 0 && <p className="muted">Every repo is clean and pushed.</p>}
          <ul className="list">
            {dirty.slice(0, 8).map((r) => (
              <li key={r.path} className="list-row" onClick={() => actions.go('repos', r.path)}>
                <div className="grow">
                  <div className="title">{r.name}</div>
                  <div className="muted small">{r.branch}</div>
                </div>
                <div className="chips">
                  {r.uncommitted.length > 0 && <span className="chip warn">{r.uncommitted.length} changed</span>}
                  {r.ahead > 0 && <span className="chip info">↑{r.ahead}</span>}
                  {r.behind > 0 && <span className="chip">↓{r.behind}</span>}
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="card">
          <h3>Reviews waiting on you</h3>
          {prs === null && <p className="muted">Asking GitHub…</p>}
          {prs?.error && <p className="muted">{prs.error}</p>}
          {prs && !prs.error && reviews.length === 0 && <p className="muted">Nothing to review.</p>}
          <ul className="list">
            {reviews.slice(0, 6).map((p) => (
              <li key={p.url} className="list-row" onClick={() => actions.openExternal(p.url)}>
                <div className="grow">
                  <div className="title">{p.title}</div>
                  <div className="muted small">
                    {p.repo} #{p.number} · {p.author} · {ago(p.updatedAt)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="card">
          <h3>Open to-dos</h3>
          {repos && todos.length === 0 && <p className="muted">No unchecked items in TODO.md, actions.md or ROADMAP.md files.</p>}
          <ul className="list">
            {todos.map((t, i) => (
              <li key={i} className="list-row" onClick={() => actions.go('repos', t.repo.path)}>
                <div className="grow">
                  <div className="title">{t.text}</div>
                  <div className="muted small">
                    {t.repo.name} · {t.file}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value, tone, onClick }: { label: string; value: number | string; tone?: 'warn'; onClick: () => void }) {
  return (
    <button className={`stat ${tone ?? ''}`} onClick={onClick}>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </button>
  );
}
