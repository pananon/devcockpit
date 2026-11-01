import { useCallback, useEffect, useRef, useState } from 'react';
import type { VoiceState } from '@shared/types';
import { enableAutoStop, isRecording, startRecording, stopAndTranscribe } from './recorder';

/**
 * Voice input inside DevCockpit. `insert` decides where text lands (focused
 * input, or the active terminal). Hotkey sessions started while another app is
 * in front are pasted there by the main process instead.
 */
export function useVoice(insert: (text: string, field: TextField | null) => void) {
  const [state, setState] = useState<VoiceState>({ phase: 'idle', message: '' });
  const [notice, setNotice] = useState<string | null>(null);
  const insertRef = useRef(insert);
  insertRef.current = insert;
  // The field focused when dictation started: text goes there even if focus moved meanwhile.
  const fieldRef = useRef<TextField | null>(null);
  // Opening the mic takes a moment; a quick click can be released before it's open.
  const startingRef = useRef<Promise<void> | null>(null);

  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice((n) => (n === msg ? null : n)), 4000);
  };

  const finish = useCallback(async () => {
    try {
      const { text, pasted } = await stopAndTranscribe();
      if (text && !pasted) insertRef.current(text, fieldRef.current?.isConnected ? fieldRef.current : null);
      fieldRef.current = null;
      if (!text) flash("Didn't catch anything. Try again a little closer to the mic.");
    } catch (e) {
      flash(String((e as Error)?.message ?? e));
    }
  }, []);

  /** autoStop: undefined = use the setting; false = the caller decides (press-and-hold). */
  const begin = useCallback(async (fromHotkey: boolean, autoStop?: boolean) => {
    fieldRef.current = focusedField();
    try {
      const auto = autoStop ?? (await window.cockpit.getSettings()).voiceAutoStop;
      await startRecording(fromHotkey, auto);
    } catch {
      flash('Microphone unavailable. Check Windows Settings > Privacy > Microphone.');
    }
  }, []);

  const toggle = useCallback(() => (isRecording() ? finish() : begin(false)), [begin, finish]);

  // Mic button: press and hold to talk, or click to start hands-free.
  const press = useCallback(() => {
    if (isRecording()) return finish();
    startingRef.current = begin(false, false).finally(() => (startingRef.current = null));
  }, [begin, finish]);
  const release = useCallback(
    async (heldMs: number) => {
      if (startingRef.current) await startingRef.current;
      if (!isRecording()) return;
      if (heldMs > 500) finish();
      else if ((await window.cockpit.getSettings()).voiceAutoStop) enableAutoStop();
    },
    [finish]
  );

  useEffect(() => {
    const offState = window.cockpit.onVoiceState(setState);
    const offCmd = window.cockpit.onVoiceCommand((cmd) => (cmd === 'start' ? begin(true) : finish()));
    const onTimeout = () => finish();
    window.addEventListener('voice-timeout', onTimeout);
    return () => {
      offState();
      offCmd();
      window.removeEventListener('voice-timeout', onTimeout);
    };
  }, [begin, finish]);

  return { state, notice, toggle, press, release };
}

export type TextField = HTMLInputElement | HTMLTextAreaElement;

/** The focused text input, ignoring the terminal's hidden textarea. */
function focusedField(): TextField | null {
  const el = document.activeElement;
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return null;
  if (el.classList.contains('xterm-helper-textarea') || el.readOnly || el.disabled) return null;
  return el;
}

/** Inserts text at the caret of the given field (or the focused one). Returns false if there is none. */
export function insertIntoField(text: string, field: TextField | null = focusedField()): boolean {
  const el = field;
  if (!el) return false;
  el.focus();
  const start = el.selectionStart ?? el.value.length;
  el.setRangeText(text, start, el.selectionEnd ?? start, 'end');
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}
