import { useEffect, useState } from 'react';
import type { Settings, VoiceModel } from '@shared/types';
import type { Actions } from '../App';

const VOICE_MODELS: { id: VoiceModel; label: string }[] = [
  { id: 'base', label: 'Fast (Whisper base, ~80 MB)' },
  { id: 'small', label: 'Balanced (Whisper small, ~250 MB)' },
  { id: 'turbo', label: 'Most accurate (Whisper large-v3 turbo, ~600 MB)' },
];
const LANGUAGES = ['english', 'hindi', 'auto', 'spanish', 'french', 'german', 'portuguese', 'japanese', 'chinese'];
const DEFAULT_HOTKEY = 'CommandOrControl+Shift+Space';

export function SettingsView({ actions, onHotkey }: { actions: Actions; onHotkey: (h: string | null) => void }) {
  const [roots, setRoots] = useState<string[] | null>(null);
  const [voice, setVoice] = useState<Pick<Settings, 'voiceModel' | 'voiceLanguage' | 'voiceHotkey'> | null>(null);
  const [hotkeyOk, setHotkeyOk] = useState(true);

  useEffect(() => {
    window.cockpit.getSettings().then((s) => {
      setRoots(s.projectRoots);
      setVoice({ voiceModel: s.voiceModel, voiceLanguage: s.voiceLanguage, voiceHotkey: s.voiceHotkey });
    });
  }, []);

  const saveVoice = async (patch: Partial<Pick<Settings, 'voiceModel' | 'voiceLanguage' | 'voiceHotkey'>>) => {
    const s = await window.cockpit.setVoiceSettings(patch);
    setVoice({ voiceModel: s.voiceModel, voiceLanguage: s.voiceLanguage, voiceHotkey: s.voiceHotkey });
    setHotkeyOk(s.voiceHotkey == null || s.voiceHotkeyActive);
    onHotkey(s.voiceHotkeyActive ? s.voiceHotkey : null);
  };

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
      {voice && (
        <section className="card">
          <h3>Voice</h3>
          <label className="check big">
            <input type="checkbox" checked={voice.voiceHotkey != null} onChange={(e) => saveVoice({ voiceHotkey: e.target.checked ? DEFAULT_HOTKEY : null })} />
            Dictate into any app with a global shortcut
          </label>
          {voice.voiceHotkey != null && (
            <div className="field">
              <span className="muted small">Shortcut (press once to start, again to paste)</span>
              <input
                className="input mono"
                defaultValue={voice.voiceHotkey}
                onBlur={(e) => e.target.value.trim() && e.target.value !== voice.voiceHotkey && saveVoice({ voiceHotkey: e.target.value.trim() })}
              />
              {!hotkeyOk && <span className="warn-text small">That shortcut is taken by another app or isn't valid. Try another, e.g. Alt+Shift+D.</span>}
            </div>
          )}
          <div className="field">
            <span className="muted small">Speech model (runs on your machine, downloaded on first use)</span>
            <select className="input" value={voice.voiceModel} onChange={(e) => saveVoice({ voiceModel: e.target.value as VoiceModel })}>
              {VOICE_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <span className="muted small">Language</span>
            <select className="input" value={voice.voiceLanguage} onChange={(e) => saveVoice({ voiceLanguage: e.target.value })}>
              {LANGUAGES.map((l) => (
                <option key={l} value={l}>
                  {l === 'auto' ? 'Detect automatically' : l[0].toUpperCase() + l.slice(1)}
                </option>
              ))}
            </select>
          </div>
          <p className="muted small">Audio is transcribed locally and never saved or uploaded.</p>
        </section>
      )}

      <section className="card">
        <h3>Privacy</h3>
        <p className="muted">
          Everything stays on this computer. DevCockpit reads your Claude Code transcripts and git repos locally, talks to GitHub only through
          your own <span className="mono">gh</span> login, stores no tokens, and sends no telemetry.
        </p>
      </section>
    </div>
  );
}
