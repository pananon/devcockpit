import type { WebContents } from 'electron';

/**
 * The clipboard is only touched right after the person really copied or pasted.
 * Main sees keyboard and mouse input before the page does, so page code can't fake these.
 */
export type Gesture = 'copy' | 'paste';

const WINDOW_MS = 1000;
const last: Record<Gesture, number> = { copy: 0, paste: 0 };
let source: WebContents | null = null;

export function trackGestures(contents: WebContents): void {
  source = contents;
  contents.on('before-input-event', (_e, input) => {
    if (input.type !== 'keyDown' || !(input.control || input.meta) || input.alt) return;
    const key = input.key.toLowerCase();
    if (key === 'v') last.paste = Date.now();
    if (key === 'c') last.copy = Date.now();
  });
  contents.on('before-mouse-event', (_e, mouse) => {
    // Releasing the left button ends a selection (copy); the right button copies or pastes.
    if (mouse.type === 'mouseUp' && mouse.button === 'left') last.copy = Date.now();
    if ((mouse.type === 'mouseDown' && mouse.button === 'right') || mouse.type === 'contextMenu')
      last.copy = last.paste = Date.now();
  });
}

/** True only for the tracked window, while focused, within a second of a matching gesture. */
export function recentGesture(kind: Gesture, sender: WebContents): boolean {
  return sender === source && sender.isFocused() && Date.now() - last[kind] < WINDOW_MS;
}
