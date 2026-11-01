import { useEffect, useMemo, useState } from 'react';
import type { Repo } from '@shared/types';
import type { Actions, Data } from '../App';
import { ago, samePath } from '../util';

type Filter = 'all' | 'changes' | 'todos';

export function Repos({ data, actions, focus }: { data: Data; actions: Actions; focus?: string }) {
  const [selected, setSelected] = useState<string | null>(focus ?? null);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (focus) setSelected(focus);
  }, [focus]);

  const repos = useMemo(() => {
    const q = query.toLowerCase();
    return (data.repos ?? [])
      .filter((r) => !q || r.name.toLowerCase().includes(q))
      .filter((r) => filter === 'all' || (filter === 'changes' ? r.uncommitted.length || r.ahead : r.todos.length))
      .sort((a, b) => (b.lastCommit?.date ?? '').localeCompare(a.lastCommit?.date ?? ''));
  }, [data.repos, filter, query]);

  const repo = data.repos?.find((r) => samePath(r.path, selected)) ?? repos[0] ?? null;

  return (
    <div className="split">
      <aside className="split-list">
        <div className="toolbar">
          <input className="input" placeholder="Filter repos" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="seg">
          {(['all', 'changes', 'todos'] as Filter[]).map((f) => (
            <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
              {f === 'all' ? 'All' : f === 'changes' ? 'Changes' : 'To-dos'}
            </button>
          ))}
        </div>
        {data.repos === null && <p className="muted pad">Scanning…</p>}
        {data.repos?.length === 0 && (
          <p className="muted pad">
            No repos found. Add your project folders in <a onClick={() => actions.go('settings')}>Settings</a>.
          </p>
        )}
        <ul className="list">
          {repos.map((r) => (
            <li key={r.path} className={`list-row ${repo?.path === r.path ? 'selected' : ''}`} onClick={() => setSelected(r.path)}>
              <div className="grow">
                <div className="title">{r.name}</div>
                <div className="muted small">
                  {r.branch} · {ago(r.lastCommit?.date)}
                </div>
              </div>
              <div className="chips">
                {r.uncommitted.length > 0 && <span className="chip warn">{r.uncommitted.length}</span>}
                {r.ahead > 0 && <span className="chip info">↑{r.ahead}</span>}
              </div>
            </li>
          ))}
        </ul>
      </aside>
      <section className="split-detail">{repo ? <RepoDetail repo={repo} data={data} actions={actions} /> : null}</section>
    </div>
  );
}

function RepoDetail({ repo, data, actions }: { repo: Repo; data: Data; actions: Actions }) {
  const sessions = (data.sessions ?? []).filter((s) => samePath(s.repoPath, repo.path));
  const prs = data.prs && repo.github ? [...data.prs.mine, ...data.prs.reviewRequested].filter((p) => p.repo.toLowerCase() === repo.github!.toLowerCase()) : [];
  const merged = data.prs && repo.github ? data.prs.recentlyMerged.filter((p) => p.repo.toLowerCase() === repo.github!.toLowerCase()) : [];

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{repo.name}</h1>
          <p className="muted mono small">{repo.path}</p>
        </div>
        <div className="row">
          <button className="btn primary" onClick={() => actions.openClaude(repo.path)}>
            New Claude session
          </button>
          <button className="btn" onClick={() => actions.openShell(repo.path)}>
            Shell
          </button>
          {repo.github && (
            <button className="btn" onClick={() => actions.openExternal(`https://github.com/${repo.github}`)}>
              GitHub
            </button>
          )}
        </div>
      </header>

      <div className="chips big">
        <span className="chip">⎇ {repo.branch}</span>
        {!repo.hasUpstream && repo.remoteUrl && <span className="chip warn">no upstream</span>}
        {!repo.remoteUrl && <span className="chip">local only</span>}
        {repo.ahead > 0 && <span className="chip info">{repo.ahead} to push</span>}
        {repo.behind > 0 && <span className="chip">{repo.behind} to pull</span>}
        {repo.uncommitted.length === 0 && repo.ahead === 0 && <span className="chip ok">clean</span>}
      </div>

      <div className="grid2">
        <section className="card">
          <h3>Pending</h3>
          {repo.uncommitted.length === 0 && repo.todos.length === 0 && prs.length === 0 && <p className="muted">Nothing pending.</p>}
          {repo.uncommitted.length > 0 && (
            <>
              <div className="eyebrow">Uncommitted ({repo.uncommitted.length})</div>
              <pre className="files">{repo.uncommitted.slice(0, 30).join('\n')}</pre>
            </>
          )}
          {prs.length > 0 && (
            <>
              <div className="eyebrow">Open pull requests</div>
              <ul className="list">
                {prs.map((p) => (
                  <li key={p.url} className="list-row" onClick={() => actions.openExternal(p.url)}>
                    <div className="grow title">
                      #{p.number} {p.title}
                    </div>
                    {p.isDraft && <span className="chip">draft</span>}
                  </li>
                ))}
              </ul>
            </>
          )}
          {repo.todos.length > 0 && (
            <>
              <div className="eyebrow">To-dos</div>
              <ul className="todo">
                {repo.todos.map((t, i) => (
                  <li key={i}>
                    ☐ {t.text} <span className="muted small">({t.file})</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section className="card">
          <h3>Done recently</h3>
          {merged.length > 0 && (
            <>
              <div className="eyebrow">Merged pull requests</div>
              <ul className="list">
                {merged.map((p) => (
                  <li key={p.url} className="list-row" onClick={() => actions.openExternal(p.url)}>
                    <div className="grow title">
                      #{p.number} {p.title}
                    </div>
                    <span className="muted small">{ago(p.updatedAt)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="eyebrow">Commits</div>
          <ul className="list">
            {repo.recentCommits.map((c) => (
              <li key={c.hash} className="list-row static">
                <span className="mono small muted">{c.hash}</span>
                <div className="grow">{c.subject}</div>
                <span className="muted small">{ago(c.date)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="card">
        <h3>Claude Code sessions ({sessions.length})</h3>
        {sessions.length === 0 && <p className="muted">No sessions in this repo yet.</p>}
        <ul className="list">
          {sessions.slice(0, 15).map((s) => (
            <li key={s.id} className="list-row" onClick={() => actions.go('sessions', s.id)}>
              <div className="grow">
                <div className="title">{s.title}</div>
                <div className="muted small">
                  {ago(s.updatedAt)} · {s.userTurns} prompts{s.gitBranch && <> · {s.gitBranch}</>}
                </div>
              </div>
              <button
                className="btn small"
                onClick={(e) => {
                  e.stopPropagation();
                  actions.openClaude(repo.path, { resumeId: s.id, title: s.title });
                }}
              >
                Resume
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
