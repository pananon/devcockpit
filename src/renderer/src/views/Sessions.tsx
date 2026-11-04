import { useEffect, useMemo, useState } from 'react';
import type { SessionSearchHit, SessionSummary, TranscriptItem } from '@shared/types';
import type { Actions, Data } from '../App';
import { AiOutput } from '../components/AiOutput';
import { Markdown } from '../components/Markdown';
import { COST_LABEL, costHint } from '../insights';
import { useAi } from '../useAi';
import { ago, baseName, plural } from '../util';

const PAGE = 300;

export function Sessions({ data, actions, focus }: { data: Data; actions: Actions; focus?: string }) {
  const [selected, setSelected] = useState<string | null>(focus ?? null);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SessionSearchHit[] | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // Select mode: tick sessions, then delete them together.
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());

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

  const pick = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const stopPicking = () => {
    setPicking(false);
    setPicked(new Set());
  };
  const remove = async (ids: string[]) => {
    const n = await window.cockpit.deleteSessions(ids);
    if (!n) return;
    if (selected && ids.includes(selected)) setSelected(null);
    stopPicking();
    actions.refresh();
  };
  const OLD_DAYS = 30;
  const old = sessions.filter((s) => Date.now() - new Date(s.updatedAt).getTime() > OLD_DAYS * 86400_000);

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
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <input className="input grow" placeholder="Search all sessions" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
            <button className={`btn small ${picking ? 'primary' : ''}`} onClick={() => (picking ? stopPicking() : setPicking(true))} title="Select sessions to delete">
              {picking ? 'Done' : 'Select'}
            </button>
          </div>
          {picking && (
            <div className="row small" style={{ marginTop: 10, justifyContent: 'space-between' }}>
              <span className="muted">{picked.size} selected</span>
              <span className="row">
                {old.length > 0 && (
                  <button className="btn small" onClick={() => setPicked(new Set(old.map((s) => s.id)))} title={`Sessions with no activity for ${OLD_DAYS} days`}>
                    Older than {OLD_DAYS}d ({old.length})
                  </button>
                )}
                <button className="btn small danger" disabled={!picked.size} onClick={() => remove([...picked])}>
                  Delete {picked.size || ''}
                </button>
              </span>
            </div>
          )}
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
                  <li key={s.id} className={`list-row ${s.id === selected ? 'selected' : ''}`} onClick={() => (picking ? pick(s.id) : setSelected(s.id))}>
                    {picking && <input type="checkbox" checked={picked.has(s.id)} readOnly aria-label={`Select ${s.title}`} style={{ marginRight: 10 }} />}
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
        {session ? <SessionDetail session={session} actions={actions} onDelete={() => remove([session.id])} localAi={data.localAi} costTitle={costHint(data.billing, data.planPrice)} /> : <p className="muted pad">Pick a session to read it.</p>}
      </section>
    </div>
  );
}

function SessionDetail({ session, actions, onDelete, localAi, costTitle }: { session: SessionSummary; actions: Actions; onDelete: () => void; localAi: boolean; costTitle: string }) {
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
            {session.costUSD != null && (
              <>
                {' · '}
                <span title={costTitle}>
                  ${session.costUSD.toFixed(2)} {COST_LABEL}
                </span>
              </>
            )}
          </p>
        </div>
        <div className="row">
          <button className="btn primary" onClick={() => actions.openClaude(session.repoPath ?? session.cwd, { resumeId: session.id, title: session.title })}>
            Resume
          </button>
          {localAi && <button className="btn" onClick={() => (summary.running ? summary.stop() : summary.start({ kind: 'summarize', sessionId: session.id }))}>
            {summary.running ? 'Stop' : 'Summarise locally'}
          </button>}
          <button className="btn danger" onClick={onDelete} title="Move this session's transcript to the Recycle Bin">
            Delete
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
