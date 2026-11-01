import { useEffect, useState } from 'react';
import type { SystemUsage } from '@shared/types';
import type { Actions, Data } from '../App';
import { repoColor, samePath } from '../util';

/** Amber when busy, red when close to the limit. */
const hot = (pct: number) => (pct >= 90 ? 'var(--danger)' : pct >= 70 ? 'var(--warn)' : undefined);

/** Editor-style status bar: the repo you're in, local AI and PRs, always visible. */
export function StatusBar({ data, actions, loading }: { data: Data; actions: Actions; loading: boolean }) {
  const [model, setModel] = useState<{ running: boolean; name: string | null } | null>(null);

  useEffect(() => {
    const check = () =>
      Promise.all([window.cockpit.ollamaStatus(), window.cockpit.getSettings()]).then(([s, cfg]) =>
        setModel({ running: s.running, name: s.running ? (cfg.localModel ?? s.models[0]?.name ?? null) : null })
      );
    check();
    const t = setInterval(check, 60_000);
    return () => clearInterval(t);
  }, []);

  const [load, setLoad] = useState<SystemUsage | null>(null);
  useEffect(() => {
    // Only sample while the window is visible; nothing runs when it's hidden in the tray.
    const sample = () => !document.hidden && window.cockpit.systemUsage().then(setLoad).catch(() => undefined);
    sample();
    const t = setInterval(sample, 3000);
    return () => clearInterval(t);
  }, []);

  // "Current" repo = the one your latest Claude session worked in.
  const latest = data.sessions?.find((s) => s.repoPath);
  const repo = latest ? data.repos?.find((r) => samePath(r.path, latest.repoPath)) : undefined;
  const reviews = data.prs?.reviewRequested.length ?? 0;
  const mine = data.prs?.mine.length ?? 0;

  return (
    <footer className="statusbar">
      <span style={{ color: 'var(--accent)' }}>◢◣ DEVCOCKPIT</span>
      {repo && (
        <button onClick={() => actions.go('workspace', repo.path)} title="Open in workspace">
          <span className="led" style={{ background: repoColor(repo.name), marginRight: 6 }} />
          {repo.name} · ⎇ {repo.branch}
        </button>
      )}
      {repo && repo.uncommitted.length > 0 && <span style={{ color: 'var(--warn)' }}>● {repo.uncommitted.length} changed</span>}
      {repo && (
        <span>
          ↑{repo.ahead} ↓{repo.behind}
        </span>
      )}
      {loading && <span style={{ color: 'var(--muted)' }}>syncing…</span>}
      <span style={{ flex: 1 }} />
      {load && (
        <span className="load" title={load.gpu ? load.gpu.name : 'GPU usage needs an NVIDIA card (nvidia-smi)'}>
          <span>
            CPU <b style={{ color: hot(load.cpuPct) }}>{load.cpuPct}%</b>
          </span>
          <span>
            RAM <b style={{ color: hot((load.ramUsedGB / load.ramTotalGB) * 100) }}>{load.ramUsedGB.toFixed(1)}</b>/{Math.round(load.ramTotalGB)}G
          </span>
          {load.gpu && (
            <>
              <span>
                GPU <b style={{ color: hot(load.gpu.pct) }}>{load.gpu.pct}%</b>
              </span>
              <span>
                VRAM <b style={{ color: hot((load.gpu.vramUsedGB / load.gpu.vramTotalGB) * 100) }}>{load.gpu.vramUsedGB.toFixed(1)}</b>/{Math.round(load.gpu.vramTotalGB)}G
              </span>
            </>
          )}
        </span>
      )}
      <button onClick={() => actions.go('ai')} title="Local AI">
        <span className="led" style={{ background: model?.running ? 'var(--ok)' : '#4b5a68', marginRight: 6 }} />
        {model?.running ? model.name ?? 'no model' : 'local AI off'}
      </button>
      <button onClick={() => actions.go('prs')}>
        {mine} PRs · <span style={{ color: reviews ? 'var(--warn)' : 'inherit' }}>{reviews} reviews</span>
      </button>
      <button onClick={actions.palette} title="Command palette">
        <span className="kbd">Ctrl+K</span>
      </button>
      <button onClick={() => actions.focus()} title="Focus mode">
        <span className="kbd">Ctrl+.</span>
      </button>
    </footer>
  );
}
