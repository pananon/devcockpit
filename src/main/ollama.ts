// Talks to a local Ollama server. Only loopback hosts are allowed, so prompts
// (which contain your transcripts) never leave the machine through this path.
import type { OllamaStatus } from '@shared/types';
import { tryRun } from './exec';
import { isInstalledOnDisk } from './ollamaInstall';

function base(): string {
  const raw = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
  const url = new URL(raw.includes('://') ? raw : `http://${raw}`);
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)) return 'http://127.0.0.1:11434';
  return url.origin;
}

export async function status(): Promise<OllamaStatus> {
  try {
    const v = await fetch(`${base()}/api/version`, { signal: AbortSignal.timeout(2000) });
    const { version } = (await v.json()) as { version: string };
    const t = await fetch(`${base()}/api/tags`, { signal: AbortSignal.timeout(4000) });
    const { models } = (await t.json()) as { models: { name: string; size: number; modified_at: string }[] };
    return {
      installed: true,
      running: true,
      version,
      models: models.map((m) => ({ name: m.name, sizeGB: Math.round((m.size / 1024 ** 3) * 10) / 10, modifiedAt: m.modified_at })),
    };
  } catch {
    // Not reachable: is it installed but stopped, or not installed?
    const installed = isInstalledOnDisk() || (await tryRun('ollama', ['--version'], undefined, 5000)) != null;
    return { installed, running: false, version: null, models: [] };
  }
}

/** Reads an NDJSON stream line by line. */
async function* ndjson(res: Response): AsyncGenerator<any> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) yield JSON.parse(line);
    }
  }
  if (buf.trim()) yield JSON.parse(buf);
}

const pulls = new Map<string, AbortController>();

export async function pull(tag: string, onProgress: (p: { status: string; completed?: number; total?: number }) => void): Promise<void> {
  if (pulls.has(tag)) return;
  const ctl = new AbortController();
  pulls.set(tag, ctl);
  try {
    const res = await fetch(`${base()}/api/pull`, { method: 'POST', body: JSON.stringify({ model: tag, stream: true }), signal: ctl.signal });
    if (!res.ok) throw new Error(`Ollama returned ${res.status}`);
    for await (const msg of ndjson(res)) {
      if (msg.error) throw new Error(msg.error);
      onProgress({ status: msg.status ?? '', completed: msg.completed, total: msg.total });
    }
  } finally {
    pulls.delete(tag);
  }
}

export const cancelPull = (tag: string) => pulls.get(tag)?.abort();

export async function remove(tag: string): Promise<void> {
  const res = await fetch(`${base()}/api/delete`, { method: 'DELETE', body: JSON.stringify({ model: tag }) });
  if (!res.ok) throw new Error(`Ollama returned ${res.status}`);
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

const chats = new Map<string, AbortController>();

/** Streams a chat completion. Thinking output is skipped; only the answer is streamed. */
export async function chat(
  taskId: string,
  model: string,
  messages: ChatMessage[],
  onText: (t: string) => void,
  options: Record<string, number> = {}
): Promise<void> {
  const ctl = new AbortController();
  chats.set(taskId, ctl);
  const request = (think: boolean) =>
    fetch(`${base()}/api/chat`, {
      method: 'POST',
      body: JSON.stringify({ model, messages, stream: true, ...(think ? { think: false } : {}), options: { num_ctx: 8192, temperature: 0.3, ...options } }),
      signal: ctl.signal,
    });
  try {
    // Ask thinking models to skip their reasoning; models without that switch reject the flag.
    let res = await request(true);
    if (res.status === 400 && /think/i.test(await res.clone().text())) res = await request(false);
    if (!res.ok) throw new Error(res.status === 404 ? `Model "${model}" isn't downloaded yet.` : `Ollama returned ${res.status}`);
    for await (const msg of ndjson(res)) {
      if (msg.error) throw new Error(msg.error);
      const text = msg.message?.content;
      if (text) onText(text);
    }
  } finally {
    chats.delete(taskId);
  }
}

export const cancelChat = (taskId: string) => chats.get(taskId)?.abort();

/** Stops every running chat and frees the GPU/RAM held by loaded models (keep_alive 0 unloads now). */
export async function unloadAll(): Promise<void> {
  for (const c of chats.values()) c.abort();
  try {
    const res = await fetch(`${base()}/api/ps`, { signal: AbortSignal.timeout(3000) });
    const { models } = (await res.json()) as { models?: { name: string }[] };
    await Promise.all(
      (models ?? []).map((m) =>
        fetch(`${base()}/api/generate`, { method: 'POST', body: JSON.stringify({ model: m.name, keep_alive: 0 }), signal: AbortSignal.timeout(10000) }).catch(() => undefined)
      )
    );
  } catch {
    // not running: nothing loaded
  }
}
