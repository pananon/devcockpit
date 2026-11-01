import { useCallback, useEffect, useState } from 'react';
import type { PrBuckets, Repo, SessionSummary, TerminalSpec } from '@shared/types';
import { MicButton } from './components/MicButton';
import { TerminalDock, type TermTab } from './components/TerminalDock';
import { onExit } from './termBus';
import { insertIntoField, useVoice } from './useVoice';
import { baseName } from './util';
import { Today } from './views/Today';
import { Repos } from './views/Repos';
import { Sessions } from './views/Sessions';
import { Prs } from './views/Prs';
import { SettingsView } from './views/Settings';
import { LocalAI } from './views/LocalAI';
import { Routines } from './views/Routines';

export type View = 'today' | 'repos' | 'sessions' | 'prs' | 'routines' | 'ai' | 'settings';

export interface Data {
  repos: Repo[] | null;
  sessions: SessionSummary[] | null;
  prs: PrBuckets | null;
}

export interface Actions {
  openClaude: (cwd: string, opts?: { resumeId?: string; title?: string }) => void;
  openShell: (cwd: string) => void;
  installOllama: () => void;
  openExternal: (url: string) => void;
  go: (view: View, focus?: string) => void;
  refresh: () => void;
}

const NAV: { view: View; label: string; key: string }[] = [
  { view: 'today', label: 'Today', key: '1' },
  { view: 'repos', label: 'Repos', key: '2' },
  { view: 'sessions', label: 'Sessions', key: '3' },
  { view: 'prs', label: 'Pull requests', key: '4' },
  { view: 'routines', label: 'Routines', key: '5' },
  { view: 'ai', label: 'Local AI', key: '6' },
  { view: 'settings', label: 'Settings', key: '7' },
];

export function App() {
  const [view, setView] = useState<View>('today');
  const [focus, setFocus] = useState<string | undefined>();
  const [data, setData] = useState<Data>({ repos: null, sessions: null, prs: null });
  const [loading, setLoading] = useState(false);
  const [tabs, setTabs] = useState<TermTab[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [dockOpen, setDockOpen] = useState(false);
  const [dockHeight, setDockHeight] = useState(Math.round(window.innerHeight * 0.45));
  const [hotkey, setHotkey] = useState<string | null>(null);
  const [fallbackText, setFallbackText] = useState<string | null>(null);

  // Dictated text goes to the focused text field, else the active terminal (no Enter is sent).
  const voice = useVoice((text, field) => {
    if (insertIntoField(text, field ?? undefined)) return;
    if (activeTab) {
      setDockOpen(true);
      window.cockpit.termWrite(activeTab, text);
      return;
    }
    setFallbackText(text);
  });

  useEffect(() => {
    window.cockpit.getSettings().then((s) => setHotkey(s.voiceHotkey));
    // Notifications and the tray menu can open a specific view.
    return window.cockpit.onNavigate((v) => NAV.some((n) => n.view === v) && setView(v as View));
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    const c = window.cockpit;
    // Load independently so a slow source (GitHub) doesn't block the others.
    await Promise.all([
      c.listRepos().then((repos) => setData((d) => ({ ...d, repos }))),
      c.listSessions().then((sessions) => setData((d) => ({ ...d, sessions }))),
      c.listPrs().then((prs) => setData((d) => ({ ...d, prs }))),
    ]).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(
    () => onExit((id) => setTabs((ts) => ts.map((t) => (t.id === id ? { ...t, exited: true, title: `${t.title} (ended)` } : t)))),
    []
  );

  const openTerminal = useCallback(async (spec: TerminalSpec, title: string) => {
    const id = await window.cockpit.termCreate(spec);
    setTabs((ts) => [...ts, { id, title }]);
    setActiveTab(id);
    setDockOpen(true);
  }, []);

  const actions: Actions = {
    openClaude: (cwd, opts) =>
      openTerminal({ cwd, program: 'claude', resumeId: opts?.resumeId }, opts?.title ?? `claude · ${baseName(cwd)}`),
    openShell: (cwd) => openTerminal({ cwd, program: 'shell' }, `shell · ${baseName(cwd)}`),
    installOllama: () => openTerminal({ cwd: '', program: 'ollama-install' }, 'Install Ollama'),
    openExternal: (url) => void window.cockpit.openExternal(url),
    go: (v, f) => {
      setView(v);
      setFocus(f);
    },
    refresh,
  };

  const closeTab = (id: string) => {
    window.cockpit.termKill(id);
    setTabs((ts) => {
      const rest = ts.filter((t) => t.id !== id);
      if (activeTab === id) setActiveTab(rest[rest.length - 1]?.id ?? null);
      if (!rest.length) setDockOpen(false);
      return rest;
    });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === '`') {
        e.preventDefault();
        if (tabs.length) setDockOpen((o) => !o);
        else actions.openClaude(data.repos?.[0]?.path ?? '');
      }
      if (e.altKey && !e.ctrlKey) {
        const nav = NAV.find((n) => n.key === e.key);
        if (nav) actions.go(nav.view);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const reviewCount = data.prs?.reviewRequested.length ?? 0;

  return (
    <div className="shell">
      <nav className="rail">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            ◢◣
          </span>
          <span>DevCockpit</span>
        </div>
        {NAV.map((n) => (
          <button key={n.view} className={`nav-item ${view === n.view ? 'active' : ''}`} onClick={() => actions.go(n.view)} title={`Alt+${n.key}`}>
            {n.label}
            {n.view === 'prs' && reviewCount > 0 && <span className="badge">{reviewCount}</span>}
          </button>
        ))}
        <div className="spacer" />
        <MicButton state={voice.state} onPress={voice.press} onRelease={voice.release} hotkey={hotkey} />
        <button className="nav-item" onClick={refresh} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
        <button className="nav-item" onClick={() => (tabs.length ? setDockOpen((o) => !o) : actions.openClaude(data.repos?.[0]?.path ?? ''))}>
          Terminal <kbd>Ctrl+`</kbd>
        </button>
      </nav>

      <div className="stage">
        <main className="content">
          {view === 'today' && <Today data={data} actions={actions} />}
          {view === 'repos' && <Repos data={data} actions={actions} focus={focus} />}
          {view === 'sessions' && <Sessions data={data} actions={actions} focus={focus} />}
          {view === 'prs' && <Prs data={data} actions={actions} />}
          {view === 'routines' && <Routines data={data} />}
          {view === 'ai' && <LocalAI actions={actions} />}
          {view === 'settings' && <SettingsView actions={actions} onHotkey={setHotkey} />}
        </main>
        {tabs.length > 0 && (
          <TerminalDock
            tabs={tabs}
            open={dockOpen}
            active={activeTab}
            height={dockHeight}
            onHeight={setDockHeight}
            onSelect={setActiveTab}
            onClose={closeTab}
            onNew={() => actions.openClaude(data.repos?.[0]?.path ?? '')}
            onHide={() => setDockOpen(false)}
          />
        )}
      </div>
      {(voice.notice || fallbackText) && (
        <div className="toast" role="status">
          {voice.notice ?? (
            <>
              <div className="muted small">No text box or terminal was active, so here is what you said:</div>
              <div className="toast-text">{fallbackText}</div>
            </>
          )}
          <button className="icon-btn" aria-label="Dismiss" onClick={() => setFallbackText(null)}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}
