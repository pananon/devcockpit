import { useEffect, useState } from 'react';
import type { Actions, Data } from '../App';
import { LOCAL_AI_FEATURES } from './LocalAI';

export function SettingsView({ data, actions }: { data: Data; actions: Actions }) {
  const [roots, setRoots] = useState<string[] | null>(null);
  const [saveTodos, setSaveTodos] = useState(true);

  useEffect(() => {
    window.cockpit.getSettings().then((s) => {
      setRoots(s.projectRoots);
      setSaveTodos(s.saveTodos);
    });
  }, []);

  const save = async (next: string[]) => {
    const s = await window.cockpit.setProjectRoots(next);
    setRoots(s.projectRoots);
    actions.refresh();
  };

  const add = async () => {
    const dir = await window.cockpit.pickFolder();
    if (dir && roots && !roots.includes(dir)) save([...roots, dir]);
  };

  return (
    <div className="page narrow">
      <header className="page-head">
        <div>
          <h1>Settings</h1>
        </div>
      </header>
      <section className="card">
        <h3>Project folders</h3>
        <p className="muted">DevCockpit looks for git repos in these folders and up to two levels inside them.</p>
        <ul className="list">
          {roots?.map((r) => (
            <li key={r} className="list-row static">
              <span className="grow mono">{r}</span>
              <button className="btn small" onClick={() => save(roots.filter((x) => x !== r))}>
                Remove
              </button>
            </li>
          ))}
        </ul>
        <button className="btn" onClick={add}>
          Add folder…
        </button>
      </section>

      <section className="card">
        <h3>Local AI</h3>
        <label className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start', cursor: 'pointer' }}>
          <input type="checkbox" checked={data.localAi} onChange={(e) => actions.setLocalAi(e.target.checked)} style={{ marginTop: 3 }} />
          <span>
            Use a local model (Ollama)
            <span className="muted small" style={{ display: 'block', marginTop: 4 }}>
              Turning it off unloads the model and frees its GPU memory right away. Also on the status bar. It powers:{' '}
              {LOCAL_AI_FEATURES.map(([name]) => name).join(', ')}.
            </span>
          </span>
        </label>
      </section>

      <section className="card">
        <h3>Claude sessions</h3>
        <label className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={saveTodos}
            onChange={async (e) => setSaveTodos((await window.cockpit.setSaveTodos(e.target.checked)).saveTodos)}
            style={{ marginTop: 3 }}
          />
          <span>
            Save todos from Claude sessions
            <span className="muted small" style={{ display: 'block', marginTop: 4 }}>
              In sessions opened from DevCockpit, say “add that to my todos” or “save this for later” and Claude adds a line to the repo's TODO.md, dated
              today. It shows up in the Todos tab, where Continue picks it up in a new session. Applies to sessions you open after changing this.
            </span>
          </span>
        </label>
      </section>

      <section className="card">
        <h3>Privacy</h3>
        <p className="muted">
          Everything stays on this computer. DevCockpit reads your Claude Code transcripts and git repos locally, talks to GitHub only through
          your own <span className="mono">gh</span> login, stores no credentials, and sends no telemetry.
        </p>
      </section>
    </div>
  );
}
