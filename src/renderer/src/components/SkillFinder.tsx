import { useEffect, useState } from 'react';
import type { LibrarySkill, SkillSearchResult } from '@shared/types';
import type { FinderState } from '../views/Skills';
import { ago } from '../util';
import { errText, Files, Findings, Header, useReview } from './SkillParts';

const stars = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
const EXAMPLES = ['build an award-quality marketing website', 'turn a product demo into a launch video', 'write release notes from merged PRs', 'test a web app end to end'];

function Badges({ r }: { r: SkillSearchResult }) {
  const danger = r.findings.some((f) => f.level === 'danger');
  const warn = r.findings.some((f) => f.level === 'warn');
  return (
    <span className="row" style={{ gap: 6 }}>
      {r.official && <span className="chip ok" title="Published by Anthropic">Official</span>}
      <span className="chip" title="GitHub stars">★ {stars(r.stars)}</span>
      <span className={`chip ${r.license ? '' : 'warn'}`} title={r.license ? 'Licence' : 'No licence: you may not be allowed to reuse it'}>
        {r.license ?? 'No licence'}
      </span>
      {r.pushedAt && <span className="chip" title="Last push to the repo">updated {ago(r.pushedAt)}</span>}
      {r.archived && <span className="chip warn" title="The owner no longer maintains this repo">Archived</span>}
      {r.fork && <span className="chip warn" title="A copy of another repo">Fork</span>}
      {danger ? (
        <span className="chip warn" style={{ color: 'var(--danger)' }}>Risk flagged</span>
      ) : warn ? (
        <span className="chip warn">Check before use</span>
      ) : null}
      {r.inLibrary && <span className="chip info">In your library</span>}
    </span>
  );
}

/** Search box, safety notes and verified results. */
export function FinderPanel({
  state,
  setState,
  onSearch,
  onOpen,
}: {
  state: FinderState;
  setState: (fn: (s: FinderState) => FinderState) => void;
  onSearch: () => void;
  onOpen: (id: string) => void;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!state.running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [state.running]);
  const set = (patch: Partial<FinderState>) => setState((s) => ({ ...s, ...patch }));
  const r = state.result;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Find skills online</h1>
          <p className="muted">
            Say what you want done. Claude searches GitHub for matching skills, then DevCockpit checks every result itself before you see it.
          </p>
        </div>
      </header>

      <section className="card">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSearch();
          }}
        >
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <input
              className="input grow"
              value={state.query}
              maxLength={300}
              onChange={(e) => set({ query: e.target.value })}
              placeholder="e.g. turn a product demo into a 30-second launch video"
              aria-label="What should the skill do?"
              autoFocus
            />
            {state.running ? (
              <button type="button" className="btn" onClick={() => window.cockpit.cancelSkillSearch()}>
                Stop
              </button>
            ) : (
              <button className="btn primary" disabled={state.query.trim().length < 3}>
                Search
              </button>
            )}
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <label className="check" title="Claude searches the web and reads candidates on GitHub. Best results; takes a minute or two.">
              <input type="radio" name="skill-mode" checked={state.mode === 'claude'} onChange={() => set({ mode: 'claude' })} disabled={state.running} /> Search with Claude
              <span className="muted small">· best results, about 2 minutes, uses your Claude plan (roughly $0.30–$0.80 API-equivalent)</span>
            </label>
            <label className="check" title="GitHub code search for SKILL.md files. Quick, no AI.">
              <input type="radio" name="skill-mode" checked={state.mode === 'github'} onChange={() => set({ mode: 'github' })} disabled={state.running} /> GitHub only
              <span className="muted small">· quick, no AI</span>
            </label>
          </div>
          {!state.query && (
            <div className="row" style={{ marginTop: 10 }}>
              {EXAMPLES.map((x) => (
                <button key={x} type="button" className="chip" onClick={() => set({ query: x })}>
                  {x}
                </button>
              ))}
            </div>
          )}
        </form>
        {state.running && (
          <p className="muted small" style={{ marginBottom: 0 }}>
            {state.mode === 'claude' ? 'Claude is searching GitHub' : 'Searching GitHub'} · {clock(now - state.startedAt)}
            {state.mode === 'claude' && '. This usually takes one to three minutes. You can keep using DevCockpit meanwhile.'}
          </p>
        )}
        {state.error && (
          <p className="small" style={{ color: 'var(--danger)', marginBottom: 0 }}>
            {state.error}
          </p>
        )}
      </section>

      {r && (
        <>
          <div className="label" style={{ margin: '4px 0 10px' }}>
            {r.results.length ? `${r.results.length} verified skill${r.results.length === 1 ? '' : 's'}, safest first` : 'No verified skills found'}
            {r.dropped > 0 && ` · ${r.dropped} suggestion${r.dropped === 1 ? '' : 's'} dropped (not on GitHub, missing, or no SKILL.md)`}
            {r.costUSD != null && ` · search cost $${r.costUSD.toFixed(2)} API-equivalent`}
          </div>
          {!r.results.length && <p className="muted">Try describing the task differently{r.mode === 'github' ? ', or search with Claude' : ''}.</p>}
          {r.results.map((x) => (
            <section key={x.id} className="card" style={{ marginBottom: 12 }}>
              <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0 }}>
                  <h3 style={{ margin: 0 }}>{x.name}</h3>
                  <div className="mono small muted">
                    {x.repo}
                    {x.path && `/${x.path}`} @ {x.sha.slice(0, 7)}
                  </div>
                </div>
                <div className="row" style={{ flexShrink: 0 }}>
                  <button className="btn small" onClick={() => window.cockpit.openExternal(x.url)} title="Open the pinned commit on GitHub">
                    GitHub ↗
                  </button>
                  <button className="btn small primary" onClick={() => onOpen(x.id)}>
                    Review →
                  </button>
                </div>
              </div>
              <div style={{ margin: '8px 0' }}>
                <Badges r={x} />
              </div>
              {x.description && <p className="small" style={{ margin: '6px 0' }}>{x.description}</p>}
              {x.why && (
                <p className="muted small" style={{ margin: '6px 0' }} title="Written by Claude after reading web pages. A hint, not a check.">
                  Claude: {x.why}
                </p>
              )}
              {x.concerns && (
                <p className="small" style={{ margin: '6px 0', color: 'var(--warn)' }}>
                  Check: {x.concerns}
                </p>
              )}
            </section>
          ))}
        </>
      )}

      <section className="card">
        <h3>How results are kept safe</h3>
        <ul className="small muted" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
          <li>Claude can only search the web and open GitHub pages. It can't read your files, run commands or use your other tools, and it's told to ignore instructions written on web pages.</li>
          <li>Claude only suggests. DevCockpit then checks each suggestion on GitHub with your gh login, and drops anything that doesn't exist, isn't on GitHub, is private or has no SKILL.md.</li>
          <li>Each skill is pinned to a commit, so what you review is exactly what gets saved, even if the repo changes later.</li>
          <li>Official Anthropic skills come first, and skills with flagged risks go last. Stars and licences help, but anyone can publish a skill: read it before you save it.</li>
          <li>Nothing touches your disk until you review the files and confirm. Installing is a separate step.</li>
        </ul>
      </section>
    </div>
  );
}

/** One result: download at the pinned commit (in memory), review, save. */
export function OnlineDetail({
  result,
  onBack,
  onSaved,
  onError,
}: {
  result: SkillSearchResult;
  onBack: () => void;
  onSaved: (s: LibrarySkill) => void;
  onError: (e: string | null) => void;
}) {
  const { review, err, file, setFile } = useReview(() => window.cockpit.reviewOnlineSkill(result.id), [result.id]);
  const [busy, setBusy] = useState(false);
  const danger = review?.findings.filter((f) => f.level === 'danger').length ?? 0;

  const save = async () => {
    if (!review) return;
    onError(null);
    setBusy(true);
    try {
      const s = await window.cockpit.saveOnlineSkill(result.id, review.hash);
      if (s) onSaved(s);
    } catch (e) {
      onError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="row" style={{ marginBottom: 12 }}>
        <button className="btn small" onClick={onBack}>
          ← Results
        </button>
      </div>
      <Header title={result.name} review={review} sub={`commit ${result.sha.slice(0, 7)}`} />
      <div style={{ marginBottom: 12 }}>
        <Badges r={result} />
      </div>
      {result.concerns && (
        <section className="card warn-card">
          <p className="small" style={{ margin: 0 }}>
            Claude noted: {result.concerns}
          </p>
        </section>
      )}
      {err && <p style={{ color: 'var(--danger)' }}>{err}</p>}
      {!review && !err && <p className="muted">Downloading the skill at commit {result.sha.slice(0, 7)} for review. Nothing is written to disk…</p>}
      {review && (
        <>
          <section className="card">
            <h3>Review</h3>
            <Findings findings={review.findings} onPick={setFile} />
            <div className="row" style={{ marginTop: 14 }}>
              <button className="btn primary" disabled={busy} onClick={save}>
                {danger ? 'Save anyway…' : result.inLibrary ? 'Replace in library…' : 'Save to library…'}
              </button>
              <button className="btn" onClick={() => window.cockpit.openExternal(result.url)}>
                Open on GitHub ↗
              </button>
            </div>
          </section>
          <Files review={review} file={file} onFile={setFile} />
        </>
      )}
    </div>
  );
}
