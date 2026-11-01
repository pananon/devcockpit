import { useEffect, useState } from 'react';
import type { VoiceState } from '@shared/types';
import type { Actions, Data } from '../App';
import { repoColor, samePath } from '../util';

/** Editor-style status bar: the repo you're in, local AI, voice and PRs, always visible. */
export function StatusBar({ data, actions, voicePhase, loading }: { data: Data; actions: Actions; voicePhase: VoiceState['phase']; loading: boolean }) {
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
      <button onClick={() => actions.go('ai')} title="Local AI">
        <span className="led" style={{ background: model?.running ? 'var(--ok)' : '#4b5a68', marginRight: 6 }} />
        {model?.running ? model.name ?? 'no model' : 'local AI off'}
      </button>
      <span>
        <span className="led" style={{ background: voicePhase === 'listening' ? 'var(--accent)' : voicePhase === 'error' ? 'var(--danger)' : 'var(--ok)', marginRight: 6 }} />
        {voicePhase === 'listening' ? 'listening' : voicePhase === 'working' ? 'transcribing' : 'voice'}
      </span>
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
