// Voice session state: the global hotkey, the floating "Listening" pill, and
// where the transcribed text goes (into DevCockpit, or pasted into the front app).
import { BrowserWindow, globalShortcut, screen } from 'electron';
import path from 'node:path';
import type { VoiceState } from '@shared/types';
import { getSettings } from './config';
import { pasteIntoForeground } from './paste';
import { findRepos } from './repos';
import { transcribe } from './voice';
import { correctVocabulary } from './vocabulary';

let main: BrowserWindow | null = null;
let pill: BrowserWindow | null = null;
let state: VoiceState = { phase: 'idle', message: '' };
/** where text goes for the current recording */
let target: 'app' | 'foreground' = 'app';
let registered: string | null = null;

function broadcast() {
  main?.webContents.send('voice:state', state);
  pill?.webContents.send('voice:state', state);
}

function setState(next: VoiceState) {
  state = next;
  broadcast();
  if (state.phase === 'idle') pill?.hide();
  else if (pill && !pill.isVisible()) {
    const area = screen.getPrimaryDisplay().workArea;
    const [w, h] = pill.getSize();
    pill.setPosition(Math.round(area.x + (area.width - w) / 2), area.y + area.height - h - 24);
    pill.showInactive(); // never steal focus from the app the user is dictating into
  }
}

export function initVoice(mainWin: BrowserWindow, loadPill: (w: BrowserWindow) => void, webPreferences: Electron.WebPreferences) {
  main = mainWin;
  pill = new BrowserWindow({
    width: 360,
    height: 56,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences,
  });
  pill.setAlwaysOnTop(true, 'screen-saver');
  pill.setIgnoreMouseEvents(true);
  loadPill(pill);
  applyHotkey();
}

/** Registers (or clears) the global push-to-talk shortcut from settings. */
export function applyHotkey(): string | null {
  if (registered) globalShortcut.unregister(registered);
  registered = null;
  const { voiceHotkey } = getSettings();
  if (!voiceHotkey) return null;
  try {
    if (globalShortcut.register(voiceHotkey, onHotkey)) registered = voiceHotkey;
  } catch {
    // invalid accelerator string
  }
  return registered;
}

function onHotkey() {
  if (state.phase === 'idle') {
    target = main?.isFocused() ? 'app' : 'foreground';
    main?.webContents.send('voice:command', 'start');
  } else if (state.phase === 'listening') {
    main?.webContents.send('voice:command', 'stop');
  }
}

/** The renderer reports when it actually starts or stops capturing audio. */
export function reportRecording(recording: boolean, fromHotkey: boolean) {
  if (recording) {
    if (!fromHotkey) target = 'app';
    setState({ phase: 'listening', message: registered ? `Listening… ${pretty(registered)} to finish` : 'Listening…' });
  } else if (state.phase === 'listening') {
    setState({ phase: 'idle', message: '' });
  }
}

export async function handleAudio(audio: Float32Array): Promise<{ text: string; pasted: boolean }> {
  const s = getSettings();
  try {
    setState({ phase: 'working', message: 'Transcribing…' });
    const raw = await transcribe(audio, s.voiceModel, s.voiceLanguage, (message) => setState({ phase: 'working', message }));
    const vocabulary = [...findRepos(s.projectRoots).map((r) => path.basename(r)), ...s.voiceVocabulary];
    const text = correctVocabulary(raw, vocabulary);
    let pasted = false;
    if (text && target === 'foreground') pasted = await pasteIntoForeground(text);
    setState({ phase: 'idle', message: '' });
    return { text, pasted };
  } catch (e) {
    setState({ phase: 'error', message: `Voice failed: ${String((e as Error)?.message ?? e).slice(0, 120)}` });
    setTimeout(() => state.phase === 'error' && setState({ phase: 'idle', message: '' }), 4000);
    throw e;
  }
}

export const currentTarget = () => target;
export const disposeVoice = () => globalShortcut.unregisterAll();
const pretty = (accel: string) => accel.replace('CommandOrControl', process.platform === 'darwin' ? 'Cmd' : 'Ctrl');
