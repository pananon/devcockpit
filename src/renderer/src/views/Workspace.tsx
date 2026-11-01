import { useEffect, useMemo, useState } from 'react';
import type { Repo } from '@shared/types';
import type { Actions, Data } from '../App';
import { AiOutput } from '../components/AiOutput';
import { useAi } from '../useAi';
import { ago, baseName, plural, repoColor, samePath, tint } from '../util';

type Section = 'overview' | 'changes' | 'sessions' | 'prs' | 'todos';
const SECTION_LABEL: Record<Section, string> = { overview: 'Overview', changes: 'Changes', sessions: 'Sessions', prs: 'Pull requests', todos: 'To-dos' };

const statusColor = (line: string) => (line.startsWith('??') || line[0] === 'A' ? 'var(--ok)' : line.includes('D') ? 'var(--danger)' : 'var(--warn)');

/** Everything under its repo: one tree, with the detail and a cross-repo activity feed beside it. */
export function Workspace({ data, actions, focus }: { data: Data; actions: Actions; focus?: string }) {
  const repos = data.repos ?? [];
  const sessions = data.sessions ?? [];
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<{ path: string; section: Section } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showQuiet, setShowQuiet] = useState(false);

  const lastSession = (r: Repo) => sessions.find((s) => samePath(s.repoPath, r.path));
  const touched = (r: Repo) => lastSession(r)?.updatedAt ?? r.lastCommit?.date ?? '';
  const isActive = (r: Repo) => r.uncommitted.length > 0 || r.ahead > 0 || r.todos.length > 0 || Date.now() - new Date(touched(r) || 0).getTime() < 14 * 86400_000;

  const sorted = useMemo(() => [...repos].sort((a, b) => touched(b).localeCompare(touched(a))), [repos, sessions]);
  const q = filter.trim().toLowerCase();
  const visible = sorted.filter((r) => !q || r.name.toLowerCase().includes(q));
  const active = visible.filter((r) => q || isActive(r));
  const quiet = q ? [] : visible.filter((r) => !isActive(r));

  // Initial selection: the focus from navigation, else the most recently touched repo.
  useEffect(() => {
    if (!repos.length) return;
    const target = (focus && repos.find((r) => samePath(r.path, focus))) || (!selected && sorted[0]);
    if (target) {
      setSelected({ path: target.path, section: 'overview' });
      setExpanded((e) => new Set(e).add(target.path));
    }
  }, [focus, repos.length]);

  const repo = repos.find((r) => samePath(r.path, selected?.path)) ?? null;
  const select = (path: string, section: Section) => {
    setSelected({ path, section });
    setExpanded((e) => new Set(e).add(path));
  };
  const toggle = (path: string) =>
    setExpanded((e) => {
      const n = new Set(e);
      if (n.has(path)) n.delete(path);
      else n.add(path);
      return n;
    });

  const prsFor = (r: Repo) => (r.github && data.prs ? [...data.prs.mine, ...data.prs.reviewRequested].filter((p) => p.repo.toLowerCase() === r.github!.toLowerCase()) : []);

  const repoNode = (r: Repo) => {
    const c = repoColor(r.name);
    const open = expanded.has(r.path);
    const nSessions = sessions.filter((s) => samePath(s.repoPath, r.path)).length;
    const child = (section: Section, count?: number, warn?: boolean) => (
      <button key={section} className={`node ${selected?.path === r.path && selected.section === section ? 'on' : ''}`} style={{ paddingLeft: 36 }} onClick={() => select(r.path, section)}>
        {SECTION_LABEL[section]}
        {count !== undefined && (
          <span className="count" style={{ color: warn && count ? 'var(--warn)' : undefined }}>
            {count}
          </span>
        )}
      </button>
    );
    return (
      <div key={r.path}>
        <button
          className={`node ${selected?.path === r.path && !open ? 'on' : ''}`}
          onClick={() => {
            toggle(r.path);
            if (!open) select(r.path, 'overview');
          }}
        >
          <span className="twist">{open ? '▾' : '▸'}</span>
          <span className="led" style={{ background: c }} />
          <strong style={{ fontWeight: 600 }}>{r.name}</strong>
          <span className="count" style={{ color: r.uncommitted.length ? 'var(--warn)' : r.ahead ? 'var(--info)' : 'var(--ok)' }}>
            {r.uncommitted.length ? `●${r.uncommitted.length}` : r.ahead ? `↑${r.ahead}` : 'clean'}
          </span>
        </button>
        {open && (
          <div>
            {child('overview')}
            {child('changes', r.uncommitted.length, true)}
            {child('sessions', nSessions)}
            {child('prs', prsFor(r).length)}
            {child('todos', r.todos.length)}
          </div>
        )}
      </div>
    );
  };

  // Cross-repo activity: sessions, commits and merges, newest first.
  const activity = useMemo(() => {
    const ev: { at: string; text: string; repo: string; go: () => void }[] = [];
    for (const s of sessions.slice(0, 20)) {
      const name = s.repoPath ? baseName(s.repoPath) : 'no repo';
      ev.push({ at: s.updatedAt, text: `Session · ${s.title}`, repo: name, go: () => actions.go('sessions', s.id) });
    }
    for (const r of repos) for (const c of r.recentCommits.slice(0, 3)) ev.push({ at: c.date, text: `Commit · ${c.subject}`, repo: r.name, go: () => select(r.path, 'overview') });
    for (const p of data.prs?.recentlyMerged ?? []) ev.push({ at: p.updatedAt, text: `Merged · #${p.number} ${p.title}`, repo: p.repo.split('/')[1], go: () => actions.openExternal(p.url) });
    for (const r of repos) if (r.uncommitted.length) ev.push({ at: touched(r), text: `${r.uncommitted.length} files changed, not committed`, repo: r.name, go: () => select(r.path, 'changes') });
    return ev.filter((e) => e.at).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 25);
  }, [repos, sessions, data.prs]);

  return (
    <div className="ws">
      <aside className="ws-tree" aria-label="Workspace explorer">
        <div className="row" style={{ justifyContent: 'space-between', padding: '4px 12px 10px' }}>
          <span className="label">Workspace</span>
          <span className="mono small muted">{repos.length}</span>
        </div>
        <div style={{ padding: '0 12px 10px' }}>
          <input className="input" aria-label="Filter repos" placeholder="Filter (type to jump)…" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ fontFamily: 'var(--mono)', fontSize: 12.5 }} />
        </div>
        {data.repos === null && <p className="muted pad">Scanning repos…</p>}
        {data.repos?.length === 0 && (
          <p className="muted pad">
            No repos found. Add your project folders in <a onClick={() => actions.go('settings')}>Settings</a>.
          </p>
        )}
        {active.map(repoNode)}
        {quiet.length > 0 && (
          <>
            <button className="node" onClick={() => setShowQuiet((v) => !v)}>
              <span className="twist">{showQuiet ? '▾' : '▸'}</span>
              <span className="muted">{quiet.length} quiet repos</span>
            </button>
            {showQuiet && quiet.map(repoNode)}
          </>
        )}
      </aside>

      <section className="ws-main">{repo ? <Detail repo={repo} section={selected!.section} data={data} actions={actions} prs={prsFor(repo)} onSection={(s) => select(repo.path, s)} /> : <p className="muted pad">Pick a repo.</p>}</section>

      <aside className="ws-activity" aria-label="Activity across repos">
        <div className="label" style={{ marginBottom: 12 }}>
          Activity · all repos
        </div>
        <div className="activity">
          {activity.map((e, i) => {
            const c = repoColor(e.repo);
            return (
              <button key={i} className="timeline-item" style={{ position: 'relative' }} onClick={e.go}>
                <span className="led" style={{ background: c }} />
                <div style={{ fontSize: 13 }}>{e.text}</div>
                <div className="mono small" style={{ color: c }}>
                  {e.repo} · {ago(e.at)}
                </div>
              </button>
            );
          })}
        </div>
      </aside>
    </div>
  );
}

function Detail({ repo, section, data, actions, prs, onSection }: { repo: Repo; section: Section; data: Data; actions: Actions; prs: NonNullable<Data['prs']>['mine']; onSection: (s: Section) => void }) {
  const c = repoColor(repo.name);
  const sessions = (data.sessions ?? []).filter((s) => samePath(s.repoPath, repo.path));
  const last = sessions[0];
  const merged = repo.github && data.prs ? data.prs.recentlyMerged.filter((p) => p.repo.toLowerCase() === repo.github!.toLowerCase()) : [];
  const summary = useAi();

  useEffect(() => summary.reset(), [repo.path]);

  const changes = (limit?: number) => (
    <>
      {repo.uncommitted.length === 0 && <p className="muted small">Working tree clean.</p>}
      {repo.uncommitted.slice(0, limit).map((l) => (
        <div key={l} className="mono small" style={{ display: 'flex', gap: 10, padding: '2px 0' }}>
          <span style={{ color: statusColor(l), width: 18 }}>{l.slice(0, 2).trim() || 'M'}</span>
          <span className="title">{l.slice(3)}</span>
        </div>
      ))}
      {limit && repo.uncommitted.length > limit && (
        <a className="small" onClick={() => onSection('changes')}>
          + {repo.uncommitted.length - limit} more
        </a>
      )}
    </>
  );

  return (
    <div className="page" style={{ maxWidth: 'none' }}>
      <nav className="crumbs" aria-label="Breadcrumb">
        workspace › <span style={{ color: c }}>{repo.name}</span> › ⎇ {repo.branch} › {SECTION_LABEL[section].toLowerCase()}
      </nav>
      <header className="page-head">
        <div>
          <h1 style={{ margin: 0 }}>
            <span className="led" style={{ background: c, width: 12, height: 12, marginRight: 10, boxShadow: `0 0 12px ${c}` }} />
            {repo.name}
          </h1>
          <div className="mono small muted" style={{ marginTop: 4 }}>
            {repo.github ?? repo.path} · {repo.lastCommit ? `last commit ${ago(repo.lastCommit.date)}` : 'no commits yet'}
            {repo.ahead > 0 && <span style={{ color: 'var(--info)' }}> · ↑{repo.ahead} to push</span>}
            {repo.behind > 0 && <span> · ↓{repo.behind} to pull</span>}
          </div>
        </div>
        <div className="row">
          <button className="btn" onClick={() => actions.openShell(repo.path)}>
            Shell
          </button>
          <button className="btn" onClick={() => actions.openClaude(repo.path)}>
            New session
          </button>
          <button className="btn" onClick={() => actions.focus(repo.path)}>
            Focus
          </button>
          {last && (
            <button className="btn primary" onClick={() => actions.openClaude(repo.path, { resumeId: last.id, title: last.title })}>
              Resume last session
            </button>
          )}
          {repo.github && (
            <button className="btn" onClick={() => actions.openExternal(`https://github.com/${repo.github}`)}>
              GitHub
            </button>
          )}
        </div>
      </header>

      {section === 'overview' && (
        <div className="grid2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
          <section className="card">
            <h3 style={{ color: repo.uncommitted.length ? 'var(--warn)' : 'var(--ok)' }}>Changes · {repo.uncommitted.length}</h3>
            {changes(8)}
          </section>
          <section className="card">
            <h3>Where you left off</h3>
            {!last && <p className="muted small">No Claude sessions in this repo yet.</p>}
            {last && (
              <>
                <div style={{ fontWeight: 500 }}>{last.title}</div>
                <div className="mono small muted" style={{ margin: '4px 0 8px' }}>
                  {ago(last.updatedAt)} · {plural(last.userTurns, 'prompt')}{last.costUSD != null ? ` · $${last.costUSD.toFixed(2)}` : ''}
                </div>
                {last.lastPrompt && <p className="small" style={{ color: '#b9d3e3' }}>Last request: “{last.lastPrompt}”</p>}
                {data.localAi && <button className="btn small" onClick={() => (summary.running ? summary.stop() : summary.start({ kind: 'summarize', sessionId: last.id }))}>
                  {summary.running ? 'Stop' : 'Summarise locally'}
                </button>}
                <AiOutput {...summary} />
              </>
            )}
          </section>
          <section className="card">
            <h3>Pull requests · {prs.length}</h3>
            {prs.length === 0 && <p className="muted small">No open PRs.</p>}
            {prs.map((p) => (
              <div key={p.url} className="list-row" onClick={() => actions.openExternal(p.url)}>
                <span className="grow title">
                  #{p.number} {p.title}
                </span>
                {p.isDraft && <span className="chip">draft</span>}
              </div>
            ))}
          </section>
          <section className="card">
            <h3>Recent commits</h3>
            {repo.recentCommits.slice(0, 6).map((cm) => (
              <div key={cm.hash} className="row" style={{ flexWrap: 'nowrap', padding: '3px 0' }}>
                <span className="mono small muted">{cm.hash}</span>
                <span className="grow title small">{cm.subject}</span>
                <span className="mono small muted">{ago(cm.date)}</span>
              </div>
            ))}
          </section>
          {repo.todos.length > 0 && (
            <section className="card">
              <h3>To-dos · {repo.todos.length}</h3>
              <ul className="todo">
                {repo.todos.slice(0, 6).map((t, i) => (
                  <li key={i}>☐ {t.text}</li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {section === 'changes' && <section className="card">{changes()}</section>}

      {section === 'sessions' && (
        <section className="card">
          {sessions.length === 0 && <p className="muted small">No sessions yet.</p>}
          <ul className="list">
            {sessions.map((s) => (
              <li key={s.id} className="list-row" onClick={() => actions.go('sessions', s.id)}>
                <span className="led" style={{ background: c }} />
                <div className="grow">
                  <div className="title">{s.title}</div>
                  <div className="mono small muted">
                    {ago(s.updatedAt)} · {plural(s.userTurns, 'prompt')}{s.gitBranch ? ` · ${s.gitBranch}` : ''}
                    {s.costUSD != null ? ` · $${s.costUSD.toFixed(2)}` : ''}
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
      )}

      {section === 'prs' && (
        <div className="grid2">
          <section className="card">
            <h3>Open</h3>
            {prs.length === 0 && <p className="muted small">None.</p>}
            {prs.map((p) => (
              <div key={p.url} className="list-row" onClick={() => actions.openExternal(p.url)}>
                <span className="grow title">
                  #{p.number} {p.title}
                </span>
                <span className="mono small muted">{ago(p.updatedAt)}</span>
              </div>
            ))}
          </section>
          <section className="card">
            <h3>Recently merged</h3>
            {merged.length === 0 && <p className="muted small">None.</p>}
            {merged.map((p) => (
              <div key={p.url} className="list-row" onClick={() => actions.openExternal(p.url)}>
                <span className="grow title">
                  #{p.number} {p.title}
                </span>
                <span className="mono small muted">{ago(p.updatedAt)}</span>
              </div>
            ))}
          </section>
        </div>
      )}

      {section === 'todos' && (
        <section className="card" style={{ borderColor: tint(c, 0.3) }}>
          {repo.todos.length === 0 && <p className="muted small">No unchecked items in TODO.md, actions.md or ROADMAP.md.</p>}
          <ul className="todo">
            {repo.todos.map((t, i) => (
              <li key={i}>
                ☐ {t.text} <span className="muted small">({t.file})</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
