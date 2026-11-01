import { useEffect, useMemo, useState } from 'react';
import type { SessionSearchHit, SessionSummary, TranscriptItem } from '@shared/types';
import type { Actions, Data } from '../App';
import { AiOutput } from '../components/AiOutput';
import { Markdown } from '../components/Markdown';
import { useAi } from '../useAi';
import { ago, baseName, plural } from '../util';

const PAGE = 300;

export function Sessions({ data, actions, focus }: { data: Data; actions: Actions; focus?: string }) {
  const [selected, setSelected] = useState<string | null>(focus ?? null);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SessionSearchHit[] | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (focus) setSelected(focus);
  }, [focus]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setHits(null);
      return;
    }
    const t = setTimeout(() => window.cockpit.searchSessions(query).then(setHits), 180);
    return () => clearTimeout(t);
  }, [query]);

  const sessions = data.sessions ?? [];
  const groups = useMemo(() => {
    const allowed = hits ? new Set(hits.map((h) => h.id)) : null;
    const map = new Map<string, SessionSummary[]>();
    for (const s of sessions) {
      if (allowed && !allowed.has(s.id)) continue;
      const key = s.repoPath ? baseName(s.repoPath) : 'Other folders';
      map.set(key, [...(map.get(key) ?? []), s]);
    }
    // Groups ordered by most recent activity.
    return [...map.entries()].sort((a, b) => b[1][0].updatedAt.localeCompare(a[1][0].updatedAt));
  }, [sessions, hits]);

  const snippet = (id: string) => hits?.find((h) => h.id === id)?.snippet;
  const session = sessions.find((s) => s.id === selected) ?? null;

  const toggle = (g: string) =>
    setCollapsed((c) => {
      const n = new Set(c);
      if (n.has(g)) n.delete(g);
      else n.add(g);
      return n;
    });

  return (
    <div className="split">
      <aside className="split-list">
        <div className="toolbar">
          <input className="input" placeholder="Search all sessions" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
        </div>
        {data.sessions === null && <p className="muted pad">Indexing sessions (the first run reads every transcript once)…</p>}
        {hits && hits.length === 0 && <p className="muted pad">No sessions mention “{query}”.</p>}
        {groups.map(([group, list]) => (
          <div key={group} className="group">
            <button className="group-head" onClick={() => toggle(group)}>
              <span>{collapsed.has(group) ? '▸' : '▾'}</span>
              <span className="grow">{group}</span>
              <span className="muted small">{list.length}</span>
            </button>
            {!collapsed.has(group) && (
              <ul className="list">
                {list.map((s) => (
                  <li key={s.id} className={`list-row ${s.id === selected ? 'selected' : ''}`} onClick={() => setSelected(s.id)}>
                    <div className="grow">
                      <div className="title">{s.title}</div>
                      <div className="muted small">{snippet(s.id) ?? `${ago(s.updatedAt)} · ${plural(s.userTurns, 'prompt')}`}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </aside>
      <section className="split-detail">
        {session ? <SessionDetail session={session} actions={actions} /> : <p className="muted pad">Pick a session to read it.</p>}
      </section>
    </div>
  );
}

function SessionDetail({ session, actions }: { session: SessionSummary; actions: Actions }) {
  const [items, setItems] = useState<TranscriptItem[] | null>(null);
  const [shown, setShown] = useState(PAGE);
  const [showTools, setShowTools] = useState(false);
  const summary = useAi();

  useEffect(() => {
    setItems(null);
    setShown(PAGE);
    summary.reset();
    window.cockpit.getTranscript(session.id).then(setItems);
  }, [session.id]);

  const visible = (items ?? []).filter((i) => showTools || i.kind !== 'tool');
  const start = Math.max(0, visible.length - shown);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{session.title}</h1>
          <p className="muted small">
            {session.repoPath ? baseName(session.repoPath) : session.cwd}
            {session.gitBranch && <> · {session.gitBranch}</>} · started {ago(session.startedAt)} · last active {ago(session.updatedAt)} · {plural(session.userTurns, 'prompt')}
            {session.costUSD != null && <> · ${session.costUSD.toFixed(2)}</>}
          </p>
        </div>
        <div className="row">
          <button className="btn primary" onClick={() => actions.openClaude(session.repoPath ?? session.cwd, { resumeId: session.id, title: session.title })}>
            Resume
          </button>
          <button className="btn" onClick={() => (summary.running ? summary.stop() : summary.start({ kind: 'summarize', sessionId: session.id }))}>
            {summary.running ? 'Stop' : 'Summarise locally'}
          </button>
          <label className="check">
            <input type="checkbox" checked={showTools} onChange={(e) => setShowTools(e.target.checked)} /> Tool calls
          </label>
        </div>
      </header>

      {(summary.text || summary.running || summary.error) && (
        <section className="card">
          <h3>
            Summary <span className="muted">· local model</span>
          </h3>
          <AiOutput {...summary} />
        </section>
      )}
      {items === null && <p className="muted">Loading transcript…</p>}
      {start > 0 && (
        <button className="btn small" onClick={() => setShown((n) => n + PAGE)}>
          Show {Math.min(PAGE, start)} earlier messages
        </button>
      )}
      <div className="transcript">
        {visible.slice(start).map((item, i) =>
          item.kind === 'tool' ? (
            <div key={i} className="msg tool">
              <span className="mono">{item.name}</span> <span className="muted">{item.detail}</span>
            </div>
          ) : (
            // Markdown is rendered as React elements, never as HTML: transcripts contain untrusted content.
            <div key={i} className={`msg ${item.kind}`}>
              <div className="msg-who">{item.kind === 'user' ? 'You' : 'Claude'}</div>
              {item.kind === 'assistant' ? <Markdown text={item.text} /> : <div className="msg-text">{item.text}</div>}
            </div>
          )
        )}
      </div>
    </div>
  );
}
