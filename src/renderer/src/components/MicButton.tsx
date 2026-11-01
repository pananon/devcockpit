import { useRef } from 'react';
import type { VoiceState } from '@shared/types';

interface Props {
  state: VoiceState;
  onPress: () => void;
  onRelease: (heldMs: number) => void;
  hotkey: string | null;
}

/** Hold to talk (release to transcribe), or click to start hands-free. */
export function MicButton({ state, onPress, onRelease, hotkey }: Props) {
  // Event timestamps, not Date.now(): opening the mic can block the UI thread, and a
  // quick click handled late must not look like a long hold.
  const downAt = useRef(0);
  const up = (e: React.PointerEvent) => {
    if (!downAt.current) return;
    const held = e.timeStamp - downAt.current;
    downAt.current = 0;
    onRelease(held);
  };
  const label = state.phase === 'listening' ? 'Stop and transcribe' : state.phase === 'working' ? state.message : 'Dictate (hold to talk, or click)';
  return (
    <button
      className={`mic ${state.phase}`}
      onPointerDown={(e) => {
        e.preventDefault(); // keep focus in the field we're dictating into
        if (state.phase === 'working') return;
        downAt.current = e.timeStamp;
        onPress();
      }}
      onPointerUp={up}
      onPointerLeave={up}
      onPointerCancel={() => (downAt.current = 0)}
      disabled={state.phase === 'working'}
      title={hotkey ? `${label}. ${hotkey.replace('CommandOrControl', 'Ctrl')} works in any app.` : label}
      aria-label={label}
    >
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
        <path fill="currentColor" d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-2.08A7 7 0 0 0 19 12h-2Z" />
      </svg>
      <span>{state.phase === 'listening' ? 'Listening…' : state.phase === 'working' ? 'Transcribing…' : 'Dictate'}</span>
    </button>
  );
}
