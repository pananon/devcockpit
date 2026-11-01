import { useCallback, useEffect, useRef, useState } from 'react';
import type { AiEvent, AiTask } from '@shared/types';

const listeners = new Map<string, (e: AiEvent) => void>();
// Events that beat their listener (the task id arrives after the task starts) wait here.
const early = new Map<string, AiEvent[]>();
window.cockpit.onAiEvent((e) => {
  const l = listeners.get(e.taskId);
  if (l) l(e);
  else early.set(e.taskId, [...(early.get(e.taskId) ?? []), e]);
});

/** Runs a local-model task and streams its text. */
export function useAi() {
  const [text, setText] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const taskRef = useRef<string | null>(null);

  const stop = useCallback(() => {
    if (taskRef.current) window.cockpit.cancelAi(taskRef.current);
  }, []);

  const start = useCallback(async (task: AiTask) => {
    if (taskRef.current) window.cockpit.cancelAi(taskRef.current);
    setText('');
    setError(null);
    setRunning(true);
    const id = await window.cockpit.runAi(task);
    taskRef.current = id;
    listeners.set(id, (e) => {
      if (e.text) setText((t) => t + e.text);
      if (e.done) {
        if (e.error) setError(e.error);
        setRunning(false);
        listeners.delete(id);
        if (taskRef.current === id) taskRef.current = null;
      }
    });
    for (const e of early.get(id) ?? []) listeners.get(id)?.(e);
    early.delete(id);
  }, []);

  const reset = useCallback(() => {
    stop();
    setText('');
    setError(null);
  }, [stop]);

  useEffect(() => () => stop(), [stop]);

  return { text, running, error, start, stop, reset };
}
