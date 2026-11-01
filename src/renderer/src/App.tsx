import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Brief, PrBuckets, Repo, SessionSummary, TerminalSpec } from '@shared/types';
import { FocusMode } from './components/FocusMode';
import { Icon } from './components/Icons';
import { Palette } from './components/Palette';
import { StatusBar } from './components/StatusBar';
import { TerminalDock, type TermTab } from './components/TerminalDock';
import { TitleBar } from './components/TitleBar';
import { onExit } from './termBus';
import { baseName, registerRepos, samePath } from './util';
import { Today } from './views/Today';
import { Workspace } from './views/Workspace';
import { Sessions } from './views/Sessions';
import { Prs } from './views/Prs';
import { Flow } from './views/Flow';
import { Insights } from './views/Insights';
import { SettingsView } from './views/Settings';
import { LocalAI } from './views/LocalAI';
import { Routines } from './views/Routines';

export type View = 'today' | 'workspace' | 'sessions' | 'prs' | 'flow' | 'insights' | 'routines' | 'ai' | 'settings';

export interface Data {
  repos: Repo[] | null;
  sessions: SessionSummary[] | null;
  prs: PrBuckets | null;
  brief: Brief | null;
}

export interface Actions {
  openClaude: (cwd: string, opts?: { resumeId?: string; title?: string }) => void;
  openShell: (cwd: string) => void;
  installOllama: () => void;
  openExternal: (url: string) => void;
  go: (view: View, focus?: string) => void;
  refresh: () => void;
  /** open focus mode, optionally on a specific repo path */
  focus: (repoPath?: string) => void;
  /** ask the local model from the Today command bar */
  ask: (question: string) => void;
  palette: () => void;
}

export const NAV: { view: View; label: string; key: string; icon: () => React.JSX.Element }[] = [
  { view: 'today', label: 'Today', key: 't', icon: Icon.today },
  { view: 'workspace', label: 'Workspace', key: 'w', icon: Icon.workspace },
  { view: 'sessions', label: 'Sessions', key: 's', icon: Icon.sessions },
  { view: 'prs', label: 'Pull requests', key: 'p', icon: Icon.prs },
  { view: 'flow', label: 'Flow board', key: 'f', icon: Icon.flow },
  { view: 'insights', label: 'Insights', key: 'i', icon: Icon.insights },
  { view: 'routines', label: 'Routines', key: 'o', icon: Icon.routines },
  { view: 'ai', label: 'Local AI', key: 'a', icon: Icon.ai },
];

/** True when keystrokes belong to a text field or the terminal, not to shortcuts. */
const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.classList.contains('xterm-helper-textarea'));

export function App() {
  const [view, setView] = useState<View>('today');
  const [focus, setFocus] = useState<string | undefined>();
  const [data, setData] = useState<Data>({ repos: null, sessions: null, prs: null, brief: null });
  const [loading, setLoading] = useState(false);
  const [tabs, setTabs] = useState<TermTab[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [dockOpen, setDockOpen] = useState(false);
  const [dockHeight, setDockHeight] = useState(Math.round(window.innerHeight * 0.42));
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [focusRepo, setFocusRepo] = useState<string | null | undefined>(undefined); // undefined = closed
  const [pendingAsk, setPendingAsk] = useState<string | null>(null);
  const gPressed = useRef(0);
  const [, setPalette] = useState(0);

  useEffect(() => {
    // Notifications and the tray menu can open a specific view.
    return window.cockpit.onNavigate((v) => (NAV.some((n) => n.view === v) || v === 'settings') && setView(v as View));
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    const c = window.cockpit;
    // Load independently so a slow source (GitHub, the local model) doesn't block the others.
    await Promise.all([
      c.listRepos().then((repos) => setData((d) => ({ ...d, repos }))),
      c.listSessions().then((sessions) => setData((d) => ({ ...d, sessions }))),
      c.listPrs().then((prs) => setData((d) => ({ ...d, prs }))),
      c.buildBrief().then((brief) => setData((d) => ({ ...d, brief }))).catch(() => undefined),
    ]).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Hand out repo colours once both lists are in: repos with the latest sessions get first pick.
  useEffect(() => {
    if (!data.repos || !data.sessions) return;
    const recent = data.sessions.map((s) => data.repos!.find((r) => samePath(r.path, s.repoPath))?.name).filter((n): n is string => !!n);
    registerRepos([...new Set([...recent, ...data.repos.map((r) => r.name)])]);
    setPalette((n) => n + 1); // repaint with the assigned colours
  }, [data.repos, data.sessions]);

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
      setFocusRepo(undefined);
    },
    refresh,
    focus: (repoPath) => setFocusRepo(repoPath ?? null),
    ask: (q) => {
      setView('today');
      setPendingAsk(q);
    },
    palette: () => setPaletteOpen(true),
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

  /**
   * Where new terminals open: the repo selected in Workspace, else the repo of your
   * latest Claude session, else the most recently committed repo.
   */
  const currentRepoPath = (): string => {
    if (view === 'workspace' && focus && data.repos?.some((r) => samePath(r.path, focus))) return focus;
    const fromSession = data.sessions?.find((s) => s.repoPath && data.repos?.some((r) => samePath(r.path, s.repoPath)))?.repoPath;
    if (fromSession) return fromSession;
    return [...(data.repos ?? [])].sort((a, b) => (b.lastCommit?.date ?? '').localeCompare(a.lastCommit?.date ?? ''))[0]?.path ?? '';
  };

  const toggleTerminal = () => (tabs.length ? setDockOpen((o) => !o) : actions.openClaude(currentRepoPath()));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      if (mod && e.key === '.') {
        e.preventDefault();
        setFocusRepo((f) => (f === undefined ? null : undefined));
        return;
      }
      if (mod && e.key === '`') {
        e.preventDefault();
        toggleTerminal();
        return;
      }
      if (e.key === 'Escape') {
        if (paletteOpen) setPaletteOpen(false);
        else if (focusRepo !== undefined) setFocusRepo(undefined);
        return;
      }
      if (mod || e.altKey || typing(e.target) || paletteOpen) return;
      // "g" then a letter jumps to a view, like GitHub and Gmail.
      if (e.key === 'g') {
        gPressed.current = Date.now();
        return;
      }
      if (Date.now() - gPressed.current < 1200) {
        gPressed.current = 0;
        const nav = NAV.find((n) => n.key === e.key);
        if (nav) actions.go(nav.view);
        else if (e.key === ',') actions.go('settings');
        return;
      }
      if (e.key === '/') {
        e.preventDefault();
        actions.go('sessions');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const reviewCount = data.prs?.reviewRequested.length ?? 0;

  return (
    <div className="shell">
      <TitleBar
        section={focusRepo !== undefined ? 'Focus' : view === 'settings' ? 'Settings' : (NAV.find((n) => n.view === view)?.label ?? '')}
        onSearch={() => setPaletteOpen(true)}
      />
      <div className="shell-main">
        <nav className="rail" aria-label="Main">
          {NAV.map((n) => (
            <button
              key={n.view}
              className={`rail-btn ${view === n.view && focusRepo === undefined ? 'on' : ''}`}
              onClick={() => actions.go(n.view)}
              title={`${n.label}  (g ${n.key})`}
              aria-label={n.label}
            >
              <n.icon />
              {n.view === 'prs' && reviewCount > 0 && <span className="badge">{reviewCount}</span>}
            </button>
          ))}
          <button className={`rail-btn ${focusRepo !== undefined ? 'on' : ''}`} onClick={() => actions.focus()} title="Focus mode  (Ctrl+.)" aria-label="Focus mode">
            <Icon.focus />
          </button>
          <div className="spacer" />
          <button className="rail-btn" onClick={() => setPaletteOpen(true)} title="Command palette  (Ctrl+K)" aria-label="Command palette">
            <Icon.search />
          </button>
          <button className="rail-btn" onClick={toggleTerminal} title="Terminal  (Ctrl+`)" aria-label="Terminal">
            <Icon.terminal />
          </button>
          <button className={`rail-btn ${view === 'settings' ? 'on' : ''}`} onClick={() => actions.go('settings')} title="Settings  (g ,)" aria-label="Settings">
            <Icon.settings />
          </button>
        </nav>

        <div className="stage">
          <main className="content">
            {view === 'today' && <Today data={data} actions={actions} pendingAsk={pendingAsk} onAskConsumed={() => setPendingAsk(null)} loading={loading} />}
            {view === 'workspace' && <Workspace data={data} actions={actions} focus={focus} />}
            {view === 'sessions' && <Sessions data={data} actions={actions} focus={focus} />}
            {view === 'prs' && <Prs data={data} actions={actions} />}
            {view === 'flow' && <Flow data={data} actions={actions} />}
            {view === 'insights' && <Insights data={data} actions={actions} />}
            {view === 'routines' && <Routines data={data} />}
            {view === 'ai' && <LocalAI actions={actions} />}
            {view === 'settings' && <SettingsView actions={actions} />}
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
              onNew={() => actions.openClaude(currentRepoPath())}
              onHide={() => setDockOpen(false)}
            />
          )}
        </div>
      </div>

      <StatusBar data={data} actions={actions} loading={loading} />

      {focusRepo !== undefined && <FocusMode data={data} actions={actions} repoPath={focusRepo} onSwitch={(p) => setFocusRepo(p)} onClose={() => setFocusRepo(undefined)} />}
      {paletteOpen && <Palette data={data} actions={actions} onClose={() => setPaletteOpen(false)} />}
    </div>
  );
}
