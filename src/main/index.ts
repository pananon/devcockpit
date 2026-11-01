import { app, BrowserWindow, dialog, ipcMain, shell, session, type IpcMainInvokeEvent } from 'electron';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { AiTask, RoutineAction, RoutineInput, RoutineRun, RoutineSchedule, Settings, TerminalSpec } from '@shared/types';
import { applyBackgroundMode, isQuitting, markQuitting, notify, showWindow, startedHidden } from './background';
import { getSettings, saveSettings } from './config';
import { APP_ORIGIN, registerAppScheme, serveAppProtocol } from './appProtocol';
import { buildBrief } from './brief';
import { demoHandlers } from './demo';
import { buildReport, isValidTag } from './models';
import * as ollama from './ollama';
import { startOllama, stopOurOllama } from './ollamaInstall';
import { listPrs } from './prs';
import { createTerminal, killAll, killTerminal, resizeTerminal, writeTerminal } from './pty';
import { findRepos, listRepos } from './repos';
import { makeRunner } from './routineRunner';
import { deleteRoutine, listRoutines, listRuns, runRoutine, saveRoutine, startScheduler, stopScheduler } from './routines';
import { getTranscript, listSessions, searchSessions, sessionTitles, trashSessions } from './sessions';
import { scanSystem, systemUsage } from './system';
import { runTask } from './tasks';
import { addTodo, completeTodo } from './todos';

// Security baseline: every renderer is sandboxed, isolated, and has no Node access.
app.enableSandbox();

// Windows groups taskbar buttons and picks their icon by this ID; it must match the
// shortcut's ID, or the taskbar falls back to Electron's own icon.
export const APP_USER_MODEL_ID = 'com.pananon.devcockpit';
if (process.platform === 'win32') app.setAppUserModelId(APP_USER_MODEL_ID);

const DEV_URL = process.env.ELECTRON_RENDERER_URL;
const RENDERER_DIR = path.join(__dirname, '../renderer');
let win: BrowserWindow | null = null;

// Demo mode keeps its own data folder (and single-instance lock), so it can run
// next to the real app and never reads or writes the real settings.
const DEMO = process.argv.includes('--demo');
if (DEMO) app.setPath('userData', path.join(app.getPath('temp'), 'DevCockpit-demo'));
const demo = DEMO ? demoHandlers((channel, ...args) => win?.webContents.send(channel, ...args)) : null;

registerAppScheme();

const WEB_PREFERENCES: Electron.WebPreferences = {
  preload: path.join(__dirname, '../preload/index.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true,
  webviewTag: false,
  spellcheck: false,
};

const loadPage = (w: BrowserWindow) => w.loadURL(DEV_URL ?? `${APP_ORIGIN}/index.html`);

/** Only our own bundled page (or the local dev server) may call the backend. */
function isTrustedSender(e: IpcMainInvokeEvent | Electron.IpcMainEvent): boolean {
  const url = e.senderFrame?.url ?? '';
  return DEV_URL ? url.startsWith(DEV_URL) : url.startsWith(`${APP_ORIGIN}/`);
}

/** In demo mode a channel without a fake answer refuses, so real data can never leak in. */
const impl = (channel: string, fn: (...args: any[]) => unknown) =>
  demo
    ? (demo[channel] ??
      (() => {
        throw new Error('Not available in demo mode');
      }))
    : fn;

function handle(channel: string, fn: (...args: any[]) => unknown) {
  const run = impl(channel, fn);
  ipcMain.handle(channel, (e, ...args) => {
    if (!isTrustedSender(e)) throw new Error('Untrusted sender');
    return run(...args);
  });
}

function on(channel: string, fn: (...args: any[]) => void) {
  const run = impl(channel, fn);
  ipcMain.on(channel, (e, ...args) => {
    if (isTrustedSender(e)) run(...args);
  });
}

const str = (v: unknown, max = 4096): string => {
  if (typeof v !== 'string' || v.length > max) throw new Error('Invalid argument');
  return v;
};

/** Turns Ollama's raw network errors into something a person can act on. */
function friendlyPullError(msg: string): string {
  if (/dial tcp \[[0-9a-f:]+\]/i.test(msg))
    return "Download failed: your network's IPv6 connection isn't working, and Ollama doesn't fall back to IPv4. Turning off IPv6 on your network adapter (or fixing it on your router) solves this. Then press Download again; it resumes where it stopped.";
  if (/max retries exceeded|connectex|timeout|no such host/i.test(msg))
    return 'Download failed: couldn\'t reach Ollama\'s download server. Check your internet connection or VPN, then press Download again; it resumes where it stopped.';
  return msg.length > 300 ? `${msg.slice(0, 300)}…` : msg;
}

/** Routines run the same way whether scheduled or started by hand. */
const runner = makeRunner();

function onRoutineChange(run: RoutineRun) {
  win?.webContents.send('routines:run', run);
  if (run.status === 'running') return;
  const routine = listRoutines().find((r) => r.id === run.routineId);
  if (routine?.notify) notify(`${run.routineName} ${run.status === 'ok' ? 'finished' : 'failed'}`, run.output.replace(/[#*_`>]/g, '').trim() || '(no output)', 'routines');
}

function cleanRoutine(r: RoutineInput): RoutineInput {
  const s = r?.schedule as RoutineSchedule;
  const schedule: RoutineSchedule =
    s?.kind === 'interval'
      ? { kind: 'interval', hours: Math.min(168, Math.max(0.25, Number(s.hours) || 1)) }
      : {
          kind: 'daily',
          time: /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s?.time)) ? String(s.time) : '09:00',
          days: Array.isArray(s?.days) ? [...new Set(s.days.map(Number).filter((d) => d >= 0 && d <= 6))] : [1, 2, 3, 4, 5],
        };
  const a = r?.action as RoutineAction;
  const action: RoutineAction =
    a?.type === 'ask'
      ? { type: 'ask', prompt: str(a.prompt, 4000) }
      : a?.type === 'claude'
        ? { type: 'claude', prompt: str(a.prompt, 8000), cwd: str(a.cwd) }
        : { type: 'brief' };
  return { id: r?.id ? str(r.id, 64) : undefined, name: str(r?.name || 'Routine', 80), enabled: r?.enabled !== false, notify: r?.notify !== false, schedule, action };
}

function registerIpc() {
  handle('routines:list', () => listRoutines());
  handle('routines:save', (r: RoutineInput) => saveRoutine(cleanRoutine(r)));
  handle('routines:delete', (id: unknown) => deleteRoutine(str(id, 64)));
  handle('routines:runNow', (id: unknown) => {
    const routine = listRoutines().find((r) => r.id === str(id, 64));
    if (routine) void runRoutine(routine, runner, onRoutineChange);
  });
  handle('routines:runs', () => listRuns());
  handle('settings:setBackground', (on: unknown) => {
    const next = saveSettings({ ...getSettings(), backgroundMode: on === true });
    if (win) applyBackgroundMode(win, next.backgroundMode);
    return next;
  });

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
  handle('sessions:delete', async (ids: unknown) => {
    if (!Array.isArray(ids) || !ids.length || ids.length > 500) throw new Error('Invalid argument');
    const clean = ids.map((id) => str(id, 64));
    const titles = sessionTitles(clean);
    if (!titles.length) return 0;
    const { response } = await dialog.showMessageBox(win!, {
      type: 'warning',
      buttons: ['Move to Recycle Bin', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: 'Delete sessions',
      message: titles.length === 1 ? `Delete “${titles[0]}”?` : `Delete ${titles.length} sessions?`,
      detail: `${titles.length > 1 ? `${titles.slice(0, 5).join('\n')}${titles.length > 5 ? `\n…and ${titles.length - 5} more` : ''}\n\n` : ''}The transcripts move to the ${process.platform === 'win32' ? 'Recycle Bin' : 'Trash'}, so you can restore them. Close any terminal that's still running one of these sessions first.`,
    });
    return response === 0 ? trashSessions(clean, (p) => shell.trashItem(p)) : 0;
  });
  handle('todos:add', (repoPath: unknown, text: unknown) => addTodo(str(repoPath), str(text, 2000)));
  handle('todos:complete', (repoPath: unknown, todo: any) =>
    completeTodo(str(repoPath), { file: str(todo?.file, 64), text: str(todo?.text, 2000), line: Number(todo?.line), addedAt: null })
  );
  handle('settings:setLocalAi', async (on: unknown) => {
    const next = saveSettings({ ...getSettings(), localAi: on === true });
    if (next.localAi) {
      if (!(await ollama.status()).running) startOllama();
    } else {
      await ollama.unloadAll();
      stopOurOllama();
    }
    return next;
  });
  handle('settings:setSaveTodos', (on: unknown) => saveSettings({ ...getSettings(), saveTodos: on === true }));
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
  handle('system:usage', () => systemUsage());
  handle('ai:status', () => ollama.status());
  handle('ai:start', () => startOllama());
  handle('ai:pull', (t: unknown) => {
    const model = tag(t);
    const send = (p: object) => win?.webContents.send('ai:pull-progress', { tag: model, status: '', ...p });
    ollama
      .pull(model, (p) => send(p))
      .then(() => send({ status: 'success', done: true }))
      .catch((e) => send({ status: 'error', done: true, error: e?.name === 'AbortError' ? 'Cancelled' : friendlyPullError(String(e?.message ?? e)) }));
  });
  on('ai:cancelPull', (t: unknown) => ollama.cancelPull(tag(t)));
  handle('ai:remove', (t: unknown) => ollama.remove(tag(t)));
  handle('ai:run', async (task: AiTask) => {
    const clean: AiTask =
      task?.kind === 'summarize'
        ? { kind: 'summarize', sessionId: str(task.sessionId, 64) }
        : { kind: 'ask', prompt: str((task as { prompt?: unknown })?.prompt, 20000) };
    const taskId = randomUUID();
    const send = (e: object) => win?.webContents.send('ai:event', { taskId, ...e });
    const status = getSettings().localAi ? await ollama.status() : null;
    const model = getSettings().localModel ?? status?.models[0]?.name ?? null;
    if (!status) setImmediate(() => send({ done: true, error: 'Local AI is off. Turn it on from the status bar or Settings.' }));
    else if (!status.running) setImmediate(() => send({ done: true, error: "Ollama isn't running. Open the Local AI tab to set it up." }));
    else if (!model) setImmediate(() => send({ done: true, error: 'No local model yet. Download one in the Local AI tab.' }));
    else
      runTask(
        taskId,
        model,
        clean,
        (text) => send({ text }),
        (context) => send({ context })
      )
        .then(() => send({ done: true }))
        .catch((e) => send({ done: true, error: e?.name === 'AbortError' ? 'Stopped' : String(e?.message ?? e) }));
    return taskId;
  });
  handle('ai:brief', () => buildBrief());
  on('ai:cancel', (id: unknown) => ollama.cancelChat(str(id, 64)));

  handle('term:create', (spec: TerminalSpec) => {
    const clean: TerminalSpec = {
      cwd: str(spec?.cwd ?? ''),
      program: spec?.program === 'shell' || spec?.program === 'ollama-install' ? spec.program : 'claude',
      resumeId: spec?.resumeId ? str(spec.resumeId, 64) : undefined,
      prompt: spec?.prompt ? str(spec.prompt, 2000) : undefined,
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
    backgroundColor: '#04070c',
    title: 'DevCockpit',
    icon: path.join(app.getAppPath(), 'resources', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    autoHideMenuBar: true,
    // Our own HUD title bar; the OS keeps drawing the real window buttons, recoloured to match.
    titleBarStyle: 'hidden',
    ...(process.platform === 'darwin' ? {} : { titleBarOverlay: { color: '#04070c', symbolColor: '#8fb3cc', height: 34 } }),
    show: false,
    webPreferences: WEB_PREFERENCES,
  });
  // Started at login in background mode: stay in the tray until opened.
  win.once('ready-to-show', () => !(startedHidden() && getSettings().backgroundMode) && win?.show());
  loadPage(win);
  win.on('close', (e) => {
    if (getSettings().backgroundMode && !isQuitting()) {
      e.preventDefault();
      win?.hide();
    }
  });
  win.on('closed', () => app.quit());
  applyBackgroundMode(win, getSettings().backgroundMode);
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
  app.on('second-instance', () => showWindow());

  app.whenReady().then(() => {
    // Deny every browser permission: camera, microphone, location, notifications, clipboard.
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, cb) => cb(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    if (!DEV_URL) serveAppProtocol(RENDERER_DIR);
    registerIpc();
    createWindow();
    if (!DEMO) startScheduler(runner, onRoutineChange);
  });

  app.on('before-quit', () => {
    markQuitting();
    stopScheduler();
  });

  app.on('window-all-closed', () => {
    killAll();
    app.quit();
  });
}
