import { useEffect, useState } from 'react';
import type { Brief, BriefRef } from '@shared/types';
import type { Actions } from '../App';

// Kept across view switches so returning to Today doesn't rebuild it.
let cached: Brief | null = null;

export function BriefCard({ actions }: { actions: Actions }) {
  const [brief, setBrief] = useState<Brief | null>(cached);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const build = async () => {
    setLoading(true);
    setError(null);
    try {
      cached = await window.cockpit.buildBrief();
      setBrief(cached);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!cached) build();
  }, []);

  const open = (ref: BriefRef) => {
    if (ref.kind === 'pr') actions.openExternal(ref.id);
    else if (ref.kind === 'session') actions.go('sessions', ref.id);
    else actions.go('repos', ref.id);
  };

  return (
    <section className="card brief">
      <div className="row">
        <h3 className="grow" style={{ margin: 0 }}>
          Your brief{' '}
          <span className="muted">
            · {brief?.usedModel ? `priorities by ${brief.model} (local)` : 'priorities by rules (no local model)'}
          </span>
        </h3>
        <button className="btn small" onClick={build} disabled={loading}>
          {loading ? 'Building…' : 'Refresh'}
        </button>
      </div>

      {error && <p className="warn-text">{error}</p>}
      {!brief && loading && <p className="muted">Reading your repos, sessions and PRs…</p>}

      {brief && (
        <div className="brief-body">
          <div>
            <div className="eyebrow">Focus today</div>
            {brief.focus.length === 0 && <p className="muted">Nothing pending. Everything is committed, pushed and reviewed.</p>}
            <ol className="focus">
              {brief.focus.map((f, i) => (
                <li key={i} title={f.fact}>
                  <span className="grow">{f.action}</span>
                  <button className="chip link" onClick={() => open(f.ref)}>
                    {f.ref.label} →
                  </button>
                </li>
              ))}
            </ol>
          </div>
          {brief.recent.length > 0 && (
            <div>
              <div className="eyebrow">Last 3 days</div>
              <ul className="recent">
                {brief.recent.map((r) => (
                  <li key={r.repo}>
                    <span className="mono">{r.repo}</span> <span className="muted">· {r.titles.join(' · ')}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
