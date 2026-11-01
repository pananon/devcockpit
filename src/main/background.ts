// Opt-in background mode: a tray icon, start at login (hidden), and closing the
// window hides it instead of quitting, so routines keep running.
import { app, BrowserWindow, Menu, nativeImage, Notification, Tray } from 'electron';
import path from 'node:path';

let tray: Tray | null = null;
let quitting = false;
let win: BrowserWindow | null = null;

const resource = (name: string) => path.join(app.getAppPath(), 'resources', name);

export const isQuitting = () => quitting;
export const markQuitting = () => (quitting = true);
export const startedHidden = () => process.argv.includes('--hidden');

export function showWindow(view?: string) {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (view) win.webContents.send('nav', view);
}

export function applyBackgroundMode(mainWin: BrowserWindow, on: boolean) {
  win = mainWin;
  // In development the login item must point Electron at the app folder too.
  const args = app.isPackaged ? ['--hidden'] : [app.getAppPath(), '--hidden'];
  app.setLoginItemSettings({ openAtLogin: on, args: on ? args : [] });

  if (on && !tray) {
    tray = new Tray(nativeImage.createFromPath(resource('tray.png')));
    tray.setToolTip('DevCockpit');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open DevCockpit', click: () => showWindow() },
        { label: 'Routines', click: () => showWindow('routines') },
        { type: 'separator' },
        {
          label: 'Quit DevCockpit',
          click: () => {
            quitting = true;
            app.quit();
          },
        },
      ])
    );
    tray.on('click', () => showWindow());
  } else if (!on && tray) {
    tray.destroy();
    tray = null;
  }
}

export function notify(title: string, body: string, view?: string) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body: body.slice(0, 180), icon: resource('icon.png') });
  n.on('click', () => showWindow(view));
  n.show();
}
