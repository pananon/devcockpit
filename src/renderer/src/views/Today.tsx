import { useEffect, useState } from 'react';
import type { Brief, BriefRef, Routine } from '@shared/types';
import type { Actions, Data } from '../App';
import { AiOutput } from '../components/AiOutput';
import { useAi } from '../useAi';
import { ago, baseName, repoColor, samePath, tint } from '../util';

interface Props {
  data: Data;
  actions: Actions;
  pendingAsk: string | null;
  onAskConsumed: () => void;
  loading: boolean;
}

const RING = 2 * Math.PI * 84;

/** Mission control: the home screen. */
export function Today({ data, actions, pendingAsk, onAskConsumed, loading }: Props) {
  const { repos, sessions, prs } = data;
  const [brief, setBrief] = useState<Brief | null>(data.brief);
  const [rebuilding, setRebuilding] = useState(false);
  const [nextRoutine, setNextRoutine] = useState<Routine | null>(null);
  const [question, setQuestion] = useState('');
  const ai = useAi();

  useEffect(() => setBrief(data.brief), [data.brief]);
  useEffect(() => {
    window.cockpit.listRoutines().then((rs) => setNextRoutine(rs.filter((r) => r.enabled && r.nextRunAt).sort((a, b) => a.nextRunAt!.localeCompare(b.nextRunAt!))[0] ?? null));
  }, []);
  useEffect(() => {
    if (!pendingAsk) return;
    setQuestion(pendingAsk);
    ai.start({ kind: 'ask', prompt: pendingAsk });
    onAskConsumed();
  }, [pendingAsk]);

  const inMotion = (repos ?? []).filter((r) => r.uncommitted.length || r.ahead);
  const total = repos?.length ?? 0;
  const unpushed = (repos ?? []).reduce((n, r) => n + r.ahead, 0);
  const reviews = prs?.reviewRequested ?? [];
  const mine = prs?.mine ?? [];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  // Repos with pending work, most recently active first (by their latest session or commit).
  const lastTouch = (path: string) =>
    sessions?.find((s) => samePath(s.repoPath, path))?.updatedAt ?? repos?.find((r) => r.path === path)?.lastCommit?.date ?? '';
  const matrix = [...inMotion].sort((a, b) => lastTouch(b.path).localeCompare(lastTouch(a.path))).slice(0, 6);

  const engage = (ref: BriefRef) => {
    if (ref.kind === 'pr') return actions.openExternal(ref.id);
    if (ref.kind === 'session') {
      const s = sessions?.find((x) => x.id === ref.id);
      if (s) return actions.openClaude(s.repoPath ?? s.cwd, { resumeId: s.id, title: s.title });
    }
    actions.focus(ref.kind === 'repo' ? ref.id : undefined);
  };
  const refColor = (ref: BriefRef) => repoColor(ref.kind === 'pr' ? ref.label.split('#')[0].split('/')[1] : ref.label);

  const rebuild = async () => {
    setRebuilding(true);
    try {
      setBrief(await window.cockpit.buildBrief());
    } finally {
      setRebuilding(false);
    }
  };

  return (
    <div className="page" style={{ maxWidth: 'none', minHeight: '100%' }}>
      <header className="page-head" style={{ borderBottom: '1px solid var(--line)', paddingBottom: 12 }}>
        <div className="row" style={{ alignItems: 'baseline', gap: 14 }}>
          <h1 style={{ margin: 0, textTransform: 'uppercase', fontSize: 22 }}>{greeting}</h1>
          <span className="mono small muted">
            {new Date().toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase()}
          </span>
        </div>
        <div className="row">
          <button className="btn small" onClick={actions.palette}>
            Jump to… <span className="kbd" style={{ marginLeft: 6 }}>Ctrl+K</span>
          </button>
          <button className="btn small" onClick={() => actions.focus()}>
            Focus <span className="kbd" style={{ marginLeft: 6 }}>Ctrl+.</span>
          </button>
          <button className="btn small" onClick={actions.refresh} disabled={loading}>
            {loading ? 'Syncing…' : 'Refresh'}
          </button>
        </div>
      </header>

      <section className="mc-grid">
        <div className="panel core" style={{ padding: '18px 20px' }}>
          <div className="row" style={{ alignSelf: 'stretch', justifyContent: 'space-between' }}>
            <span className="label">01 · Systems core</span>
            <span className="label" style={{ color: inMotion.length ? 'var(--warn)' : 'var(--ok)' }}>
              {inMotion.length ? 'work in flight' : 'all clear'}
            </span>
          </div>
          <div className="core-ring">
            <svg className="spin" width="220" height="220" viewBox="0 0 220 220" aria-hidden="true">
              <circle cx="110" cy="110" r="104" fill="none" stroke="rgba(56,200,255,.25)" strokeWidth="1" strokeDasharray="2 6" />
            </svg>
            <svg className="spin-rev" width="220" height="220" viewBox="0 0 220 220" aria-hidden="true">
              <circle cx="110" cy="110" r="94" fill="none" stroke="rgba(56,200,255,.16)" strokeWidth="9" strokeDasharray="38 14" />
            </svg>
            <svg width="220" height="220" viewBox="0 0 220 220" role="img" aria-label={`${inMotion.length} of ${total} repos have pending work`} style={{ transform: 'rotate(-90deg)' }}>
              <circle cx="110" cy="110" r="84" fill="none" stroke="rgba(56,200,255,.12)" strokeWidth="11" />
              <circle cx="110" cy="110" r="84" fill="none" stroke="var(--accent)" strokeWidth="11" strokeDasharray={`${total ? (inMotion.length / total) * RING : 0} ${RING}`} />
            </svg>
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <span className="mono" style={{ fontSize: 42, fontWeight: 600, color: 'var(--bright)', lineHeight: 1 }}>
                {repos ? inMotion.length : '…'}
                <span style={{ color: 'var(--muted)', fontSize: 21 }}>/{total || '…'}</span>
              </span>
              <span className="label">repos in motion</span>
            </div>
          </div>
          <div className="core-stats">
            <button style={{ borderColor: 'rgba(245,165,36,.5)' }} onClick={() => actions.go('flow')}>
              <div className="big-num" style={{ color: 'var(--warn)' }}>{repos ? unpushed : '…'}</div>
              <div className="label" style={{ fontSize: 10 }}>unpushed</div>
            </button>
            <button style={{ borderColor: 'rgba(56,200,255,.5)' }} onClick={() => actions.go('prs')}>
              <div className="big-num" style={{ color: 'var(--info)' }}>{prs ? mine.length : '…'}</div>
              <div className="label" style={{ fontSize: 10 }}>open PRs</div>
            </button>
            <button style={{ borderColor: 'rgba(62,224,160,.5)' }} onClick={() => actions.go('prs')}>
              <div className="big-num" style={{ color: reviews.length ? 'var(--warn)' : 'var(--ok)' }}>{prs ? reviews.length : '…'}</div>
              <div className="label" style={{ fontSize: 10 }}>reviews due</div>
            </button>
          </div>
        </div>

        <div className="panel mc-wide" style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="label">02 · Mission brief</span>
            <span className="row">
              <span className="label" style={{ color: 'var(--muted)' }}>
                {brief ? (brief.usedModel ? `priorities by ${brief.model} · local · facts verified` : 'priorities by rules · start Ollama for smarter picks') : ''}
              </span>
              <button className="btn small" onClick={rebuild} disabled={rebuilding}>
                {rebuilding ? 'Thinking…' : 'Re-plan'}
              </button>
            </span>
          </div>
          {!brief && <p className="muted">Reading your repos, sessions and PRs…</p>}
          {brief?.focus.length === 0 && <p className="muted">Nothing pending. Everything is committed, pushed and reviewed.</p>}
          {brief?.focus.map((f, i) => {
            const c = refColor(f.ref);
            return (
              <div key={i} className="objective" style={{ borderColor: tint(c, 0.25), background: tint(c, 0.04) }} title={f.fact}>
                <span className="objective-num" style={{ color: c }}>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div className="grow">
                  <div style={{ fontSize: 16, fontWeight: 500 }}>{f.action}</div>
                  <div className="mono small muted" style={{ marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {f.fact}
                  </div>
                </div>
                <span className="chip" style={{ borderColor: tint(c, 0.55), color: c }}>
                  <span className="led" style={{ background: c, marginRight: 6 }} />
                  {f.ref.label}
                </span>
                <button className="btn" onClick={() => engage(f.ref)}>
                  Engage
                </button>
              </div>
            );
          })}
        </div>
      </section>

      <section className="mc-grid">
        <div className="panel" style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="label">03 · Session timeline</span>
            <a className="label" style={{ color: 'var(--info)' }} onClick={() => actions.go('sessions')}>
              open archive →
            </a>
          </div>
          {sessions === null && <p className="muted small">Indexing sessions…</p>}
          <div className="timeline">
            {(sessions ?? []).slice(0, 5).map((s, i) => {
              const repo = s.repoPath ? baseName(s.repoPath) : null;
              const live = Date.now() - new Date(s.updatedAt).getTime() < 15 * 60_000;
              const c = repoColor(repo);
              return (
                <button key={s.id} className="timeline-item" onClick={() => actions.go('sessions', s.id)}>
                  <span className="led" style={{ background: c, boxShadow: live ? `0 0 10px ${c}` : 'none', width: i === 0 ? 9 : 7, height: i === 0 ? 9 : 7 }} />
                  <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
                    <span className="title" style={{ fontWeight: 500 }}>
                      {s.title}
                    </span>
                    <span className="mono small muted">{live ? 'live' : ago(s.updatedAt)}</span>
                  </div>
                  <div className="mono small" style={{ color: repo ? c : 'var(--muted)' }}>
                    {repo ?? 'no repo'} · {s.userTurns} prompts
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="panel" style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="label">04 · Repo matrix</span>
            <a className="label" style={{ color: 'var(--info)' }} onClick={() => actions.go('workspace')}>
              {total} tracked →
            </a>
          </div>
          {repos && matrix.length === 0 && <p className="muted small">Every repo is clean and pushed.</p>}
          <div className="tiles">
            {matrix.map((r) => {
              const c = repoColor(r.name);
              return (
                <button key={r.path} className="tile" style={{ background: tint(c, 0.05), borderColor: tint(c, 0.3) }} onClick={() => actions.go('workspace', r.path)}>
                  <div className="row" style={{ gap: 7, flexWrap: 'nowrap' }}>
                    <span className="led" style={{ background: c }} />
                    <span className="mono title" style={{ fontSize: 12.5 }}>
                      {r.name}
                    </span>
                  </div>
                  <div className="mono title" style={{ fontSize: 11, color: r.uncommitted.length ? 'var(--warn)' : 'var(--info)', marginTop: 4 }}>
                    {r.uncommitted.length ? `${r.uncommitted.length} changed` : `↑${r.ahead}`} · {r.branch}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="panel" style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="label">05 · Comms · pull requests</span>
            <a className="label" style={{ color: 'var(--info)' }} onClick={() => actions.go('prs')}>
              {prs ? `${mine.length} open →` : ''}
            </a>
          </div>
          {prs?.error && <p className="muted small">{prs.error}</p>}
          {prs && !prs.error && reviews.length + mine.length === 0 && <p className="muted small">No open pull requests.</p>}
          {[...reviews.map((p) => ({ p, review: true })), ...mine.map((p) => ({ p, review: false }))].slice(0, 4).map(({ p, review }) => {
            const c = repoColor(p.repo.split('/')[1]);
            return (
              <button key={p.url} className="timeline-item" style={{ display: 'flex', gap: 10, paddingBottom: 8, borderBottom: '1px dashed rgba(56,200,255,.15)' }} onClick={() => actions.openExternal(p.url)}>
                <span className="led" style={{ position: 'static', background: review ? 'var(--warn)' : c, marginTop: 7 }} />
                <div className="grow">
                  <div className="title" style={{ fontWeight: 500 }}>
                    {p.title}
                  </div>
                  <div className="mono small muted">
                    {p.repo.split('/')[1]} #{p.number} · {review ? 'review requested' : p.isDraft ? 'draft' : `updated ${ago(p.updatedAt)}`}
                  </div>
                </div>
              </button>
            );
          })}
          <div className="row" style={{ marginTop: 'auto', borderTop: '1px solid var(--line)', paddingTop: 12, justifyContent: 'space-between' }}>
            <span className="label">06 · Routines</span>
            <a className="mono small" onClick={() => actions.go('routines')}>
              {nextRoutine ? `${nextRoutine.name} · ${new Date(nextRoutine.nextRunAt!).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}` : 'none scheduled →'}
            </a>
          </div>
        </div>
      </section>

      {(ai.text || ai.running || ai.error) && (
        <div className="panel" style={{ padding: '14px 18px' }}>
          <span className="label">Answer · local model</span>
          <AiOutput {...ai} />
        </div>
      )}

      <form
        className="cmdbar"
        style={{ marginTop: 'auto' }}
        onSubmit={(e) => {
          e.preventDefault();
          if (question.trim()) ai.start({ kind: 'ask', prompt: question.trim() });
        }}
      >
        <span className="mono" style={{ color: 'var(--accent)', fontSize: 18, paddingLeft: 6 }}>
          &gt;
        </span>
        <input aria-label="Ask DevCockpit" placeholder="Ask DevCockpit… “What’s pending on tatvafit?”" value={question} onChange={(e) => setQuestion(e.target.value)} />
        <span className="mono small muted">local model · no Claude tokens</span>
        {ai.running ? (
          <button type="button" className="btn" onClick={ai.stop}>
            Stop
          </button>
        ) : (
          <button className="btn primary" disabled={!question.trim()}>
            Transmit
          </button>
        )}
      </form>
    </div>
  );
}
