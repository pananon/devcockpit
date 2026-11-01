// Types dictated text into whatever app is in front, via the clipboard.
// It only ever sends one paste keystroke, and the user's clipboard is restored.
import { clipboard } from 'electron';
import { tryRun } from './exec';

function sendPasteKeystroke(): Promise<string | null> {
  if (process.platform === 'win32') {
    return tryRun('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^v')"], undefined, 5000);
  }
  if (process.platform === 'darwin') {
    // Needs the Accessibility permission for DevCockpit (System Settings > Privacy & Security).
    return tryRun('osascript', ['-e', 'tell application "System Events" to keystroke "v" using command down'], undefined, 5000);
  }
  return tryRun('xdotool', ['key', '--clearmodifiers', 'ctrl+v'], undefined, 5000);
}

/** Pastes text into the focused app. Returns false if the keystroke couldn't be sent (text stays on the clipboard). */
export async function pasteIntoForeground(text: string): Promise<boolean> {
  const previous = await clipboard.readText();
  await clipboard.writeText(text);
  const ok = (await sendPasteKeystroke()) != null;
  if (ok) setTimeout(() => void clipboard.writeText(previous), 600);
  return ok;
}
