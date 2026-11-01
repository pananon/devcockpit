// Routes terminal output to the right xterm instance. Output that arrives
// before a tab's view is mounted is buffered and replayed on attach.
type Sink = (data: string) => void;

const sinks = new Map<string, Sink>();
const pending = new Map<string, string[]>();
const exitListeners = new Set<(id: string, code: number) => void>();

window.cockpit.onTermData((id, data) => {
  const sink = sinks.get(id);
  if (sink) sink(data);
  else pending.set(id, [...(pending.get(id) ?? []), data]);
});

window.cockpit.onTermExit((id, code) => exitListeners.forEach((l) => l(id, code)));

export function attach(id: string, sink: Sink): () => void {
  sinks.set(id, sink);
  for (const chunk of pending.get(id) ?? []) sink(chunk);
  pending.delete(id);
  return () => sinks.delete(id);
}

export function onExit(cb: (id: string, code: number) => void): () => void {
  exitListeners.add(cb);
  return () => exitListeners.delete(cb);
}
