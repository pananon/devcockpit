import { useEffect, useState } from 'react';
import type { VoiceState } from '@shared/types';

/** The always-on-top "Listening…" indicator shown while dictating into any app. */
export function Pill() {
  const [state, setState] = useState<VoiceState>({ phase: 'idle', message: '' });
  useEffect(() => window.cockpit.onVoiceState(setState), []);
  return (
    <div className={`pill ${state.phase}`}>
      <span className="pill-dot" />
      <span className="pill-text">{state.message || 'Ready'}</span>
    </div>
  );
}
