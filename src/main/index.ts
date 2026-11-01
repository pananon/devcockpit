import { app, BrowserWindow, dialog, ipcMain, shell, session, type IpcMainInvokeEvent } from 'electron';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { AiTask, Settings, TerminalSpec, VoiceModel } from '@shared/types';
import { getSettings, saveSettings } from './config';
import { buildReport, isValidTag } from './models';
import * as ollama from './ollama';
import { listPrs } from './prs';
import { createTerminal, killAll, killTerminal, resizeTerminal, writeTerminal } from './pty';
import { findRepos, listRepos } from './repos';
import { getTranscript, listSessions, searchSessions } from './sessions';
import { scanSystem } from './system';
import { runTask } from './tasks';
import { applyHotkey, disposeVoice, handleAudio, initVoice, reportRecording } from './voiceControl';

// Security baseline: every renderer is sandboxed, isolated, and has no Node access.
app.enableSandbox();

const DEV_URL = process.env.ELECTRON_RENDERER_URL;
const RENDERER_FILE = path.join(__dirname, '../renderer/index.html');
let win: BrowserWindow | null = null;

const WEB_PREFERENCES: Electron.WebPreferences = {
  preload: path.join(__dirname, '../preload/index.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true,
  webviewTag: false,
  spellcheck: false,
};

const loadPage = (w: BrowserWindow, hash?: string) => {
  if (DEV_URL) w.loadURL(hash ? `${DEV_URL}#${hash}` : DEV_URL);
  else w.loadFile(RENDERER_FILE, hash ? { hash } : undefined);
};

/** Only our own bundled page (or the local dev server) may call the backend. */
function isTrustedSender(e: IpcMainInvokeEvent | Electron.IpcMainEvent): boolean {
  const url = e.senderFrame?.url ?? '';
  if (DEV_URL) return url.startsWith(DEV_URL);
  try {
    return path.normalize(new URL(url).pathname.replace(/^\/([A-Za-z]:)/, '$1')) === path.normalize(RENDERER_FILE);
  } catch {
    return false;
  }
}

function handle(channel: string, fn: (...args: any[]) => unknown) {
  ipcMain.handle(channel, (e, ...args) => {
    if (!isTrustedSender(e)) throw new Error('Untrusted sender');
    return fn(...args);
  });
}

function on(channel: string, fn: (...args: any[]) => void) {
  ipcMain.on(channel, (e, ...args) => {
    if (isTrustedSender(e)) fn(...args);
  });
}

const str = (v: unknown, max = 4096): string => {
  if (typeof v !== 'string' || v.length > max) throw new Error('Invalid argument');
  return v;
};

function registerIpc() {
  handle('settings:get', () => getSettings());
  handle('settings:setRoots', (roots: unknown): Settings => {
    if (!Array.isArray(roots)) throw new Error('Invalid argument');
    const clean = [...new Set(roots.map((r) => str(r)).filter((r) => fs.existsSync(r) && fs.statSync(r).isDirectory()))];
    return saveSettings({ ...getSettings(), projectRoots: clean });
  });
  handle('dialog:pickFolder', async () => {
    const res = await dialog.showOpenDialog(win!, { properties: ['openDirectory'] });
    return res.canceled ? null : res.filePaths[0];
  });
  handle('repos:list', () => listRepos(getSettings().projectRoots));
  handle('sessions:list', () => listSessions(findRepos(getSettings().projectRoots)));
  handle('sessions:transcript', (id: unknown) => getTranscript(str(id, 64)));
  handle('sessions:search', (q: unknown) => searchSessions(str(q, 200)));
  handle('prs:list', () => listPrs(true));
  handle('shell:openExternal', async (url: unknown) => {
    const u = new URL(str(url));
    if (u.protocol !== 'https:') throw new Error('Only https links can be opened');
    await shell.openExternal(u.toString());
  });

  // Local AI (Ollama)
  const tag = (v: unknown) => {
    const t = str(v, 128);
    if (!isValidTag(t)) throw new Error('Invalid model name');
    return t;
  };
  handle('settings:setLocalModel', (t: unknown) => saveSettings({ ...getSettings(), localModel: t == null ? null : tag(t) }));
  handle('ai:scan', async () => buildReport(await scanSystem()));
  handle('ai:status', () => ollama.status());
  handle('ai:pull', (t: unknown) => {
    const model = tag(t);
    const send = (p: object) => win?.webContents.send('ai:pull-progress', { tag: model, status: '', ...p });
    ollama
      .pull(model, (p) => send(p))
      .then(() => send({ status: 'success', done: true }))
      .catch((e) => send({ status: 'error', done: true, error: e?.name === 'AbortError' ? 'Cancelled' : String(e?.message ?? e) }));
  });
  on('ai:cancelPull', (t: unknown) => ollama.cancelPull(tag(t)));
  handle('ai:remove', (t: unknown) => ollama.remove(tag(t)));
  handle('ai:run', async (task: AiTask) => {
    const clean: AiTask =
      task?.kind === 'summarize'
        ? { kind: 'summarize', sessionId: str(task.sessionId, 64) }
        : task?.kind === 'brief'
          ? { kind: 'brief' }
          : { kind: 'ask', prompt: str((task as { prompt?: unknown })?.prompt, 20000) };
    const taskId = randomUUID();
    const send = (e: object) => win?.webContents.send('ai:event', { taskId, ...e });
    const status = await ollama.status();
    const model = getSettings().localModel ?? status.models[0]?.name ?? null;
    if (!status.running) setImmediate(() => send({ done: true, error: "Ollama isn't running. Open the Local AI tab to set it up." }));
    else if (!model) setImmediate(() => send({ done: true, error: 'No local model yet. Download one in the Local AI tab.' }));
    else
      runTask(taskId, model, clean, (text) => send({ text }))
        .then(() => send({ done: true }))
        .catch((e) => send({ done: true, error: e?.name === 'AbortError' ? 'Stopped' : String(e?.message ?? e) }));
    return taskId;
  });
  on('ai:cancel', (id: unknown) => ollama.cancelChat(str(id, 64)));

  // Voice
  const VOICE_MODELS: VoiceModel[] = ['base', 'small', 'turbo'];
  handle('settings:setVoice', (v: { voiceModel?: unknown; voiceLanguage?: unknown; voiceHotkey?: unknown }) => {
    const cur = getSettings();
    const next: Settings = {
      ...cur,
      voiceModel: VOICE_MODELS.includes(v?.voiceModel as VoiceModel) ? (v.voiceModel as VoiceModel) : cur.voiceModel,
      voiceLanguage: v?.voiceLanguage !== undefined ? str(v.voiceLanguage, 32) : cur.voiceLanguage,
      voiceHotkey: v?.voiceHotkey === null ? null : v?.voiceHotkey !== undefined ? str(v.voiceHotkey, 64) : cur.voiceHotkey,
    };
    saveSettings(next);
    const active = applyHotkey();
    return { ...next, voiceHotkeyActive: active != null };
  });
  on('voice:recording', (recording: unknown, fromHotkey: unknown) => reportRecording(recording === true, fromHotkey === true));
  handle('voice:transcribe', (audio: unknown) => {
    // 16 kHz mono, at most 5 minutes
    if (!(audio instanceof Float32Array) || audio.length > 16000 * 300) throw new Error('Invalid audio');
    return handleAudio(audio);
  });

  handle('term:create', (spec: TerminalSpec) => {
    const clean: TerminalSpec = {
      cwd: str(spec?.cwd ?? ''),
      program: spec?.program === 'shell' ? 'shell' : 'claude',
      resumeId: spec?.resumeId ? str(spec.resumeId, 64) : undefined,
    };
    return createTerminal(
      clean,
      (id, data) => win?.webContents.send('term:data', id, data),
      (id, code) => win?.webContents.send('term:exit', id, code)
    );
  });
  on('term:write', (id: unknown, data: unknown) => writeTerminal(str(id, 64), str(data, 1_000_000)));
  on('term:resize', (id: unknown, cols: unknown, rows: unknown) => resizeTerminal(str(id, 64), Number(cols), Number(rows)));
  on('term:kill', (id: unknown) => killTerminal(str(id, 64)));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#0b0f14',
    title: 'DevCockpit',
    autoHideMenuBar: true,
    show: false,
    webPreferences: WEB_PREFERENCES,
  });
  win.once('ready-to-show', () => win?.show());
  loadPage(win);
  // The hidden voice pill is also a window, so quit explicitly when the main window closes.
  win.on('closed', () => app.quit());
  initVoice(win, (pill) => loadPage(pill, 'pill'), WEB_PREFERENCES);
}

// No in-app navigation, no new windows, no <webview>. External links go to the system browser.
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-navigate', (e, url) => {
    if (!(DEV_URL && url.startsWith(DEV_URL))) e.preventDefault();
  });
  contents.on('will-attach-webview', (e) => e.preventDefault());
  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win?.isMinimized()) win.restore();
    win?.focus();
  });

  app.whenReady().then(() => {
    // Deny every browser permission except the microphone (audio only, our own page only) for voice input.
    const ownPage = (url: string) => (DEV_URL ? url.startsWith(DEV_URL) : url.startsWith('file://'));
    session.defaultSession.setPermissionRequestHandler((wc, permission, cb, details) => {
      const media = details as Electron.MediaAccessPermissionRequest;
      const audioOnly = permission === 'media' && (media.mediaTypes ?? []).every((t) => t === 'audio');
      cb(audioOnly && ownPage(wc.getURL()));
    });
    session.defaultSession.setPermissionCheckHandler((wc, permission, origin, details) =>
      permission === 'media' && (details as { mediaType?: string }).mediaType === 'audio' && ownPage(wc?.getURL() ?? origin)
    );
    registerIpc();
    createWindow();
  });

  app.on('will-quit', disposeVoice);
  app.on('window-all-closed', () => {
    killAll();
    app.quit();
  });
}
