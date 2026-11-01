import type { VoiceState } from '@shared/types';

export function MicButton({ state, onToggle, hotkey }: { state: VoiceState; onToggle: () => void; hotkey: string | null }) {
  const label = state.phase === 'listening' ? 'Stop and transcribe' : state.phase === 'working' ? state.message : 'Dictate';
  return (
    <button
      className={`mic ${state.phase}`}
      onMouseDown={(e) => e.preventDefault() /* keep focus in the field we're dictating into */}
      onClick={onToggle}
      disabled={state.phase === 'working'}
      title={hotkey ? `${label} (${hotkey.replace('CommandOrControl', 'Ctrl')} works in any app)` : label}
      aria-label={label}
    >
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
        <path fill="currentColor" d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-2.08A7 7 0 0 0 19 12h-2Z" />
      </svg>
      <span>{state.phase === 'listening' ? 'Listening…' : state.phase === 'working' ? 'Transcribing…' : 'Dictate'}</span>
    </button>
  );
}
