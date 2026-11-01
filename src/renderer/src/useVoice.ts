import { useCallback, useEffect, useRef, useState } from 'react';
import type { VoiceState } from '@shared/types';
import { isRecording, startRecording, stopAndTranscribe } from './recorder';

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

  const begin = useCallback(async (fromHotkey: boolean) => {
    fieldRef.current = focusedField();
    try {
      await startRecording(fromHotkey);
    } catch {
      flash('Microphone unavailable. Check Windows Settings > Privacy > Microphone.');
    }
  }, []);

  const toggle = useCallback(() => (isRecording() ? finish() : begin(false)), [begin, finish]);

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

  return { state, notice, toggle };
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
