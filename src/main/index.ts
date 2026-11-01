import { app, BrowserWindow, dialog, ipcMain, shell, session, type IpcMainInvokeEvent } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { Settings, TerminalSpec } from '@shared/types';
import { getSettings, saveSettings } from './config';
import { listPrs } from './prs';
import { createTerminal, killAll, killTerminal, resizeTerminal, writeTerminal } from './pty';
import { findRepos, listRepos } from './repos';
import { getTranscript, listSessions, searchSessions } from './sessions';

// Security baseline: every renderer is sandboxed, isolated, and has no Node access.
app.enableSandbox();

const DEV_URL = process.env.ELECTRON_RENDERER_URL;
const RENDERER_FILE = path.join(__dirname, '../renderer/index.html');
let win: BrowserWindow | null = null;

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
  handle('prs:list', () => listPrs());
  handle('shell:openExternal', async (url: unknown) => {
    const u = new URL(str(url));
    if (u.protocol !== 'https:') throw new Error('Only https links can be opened');
    await shell.openExternal(u.toString());
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
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      spellcheck: false,
    },
  });
  win.once('ready-to-show', () => win?.show());
  if (DEV_URL) win.loadURL(DEV_URL);
  else win.loadFile(RENDERER_FILE);
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
    // Deny every browser permission (camera, location, notifications...) until a feature needs one.
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, cb) => cb(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    registerIpc();
    createWindow();
  });

  app.on('window-all-closed', () => {
    killAll();
    app.quit();
  });
}
