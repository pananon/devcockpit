// Local speech-to-text with Whisper (transformers.js + ONNX Runtime).
// Audio never leaves the machine; only the model weights are downloaded once.
import { app } from 'electron';
import path from 'node:path';
import type { VoiceModel } from '@shared/types';

const MODELS: Record<VoiceModel, { id: string; dtype: string }> = {
  base: { id: 'onnx-community/whisper-base', dtype: 'q8' },
  small: { id: 'onnx-community/whisper-small', dtype: 'q8' },
  turbo: { id: 'onnx-community/whisper-large-v3-turbo', dtype: 'q4' },
};

type Transcriber = (audio: Float32Array, opts: object) => Promise<{ text: string } | { text: string }[]>;

interface Loaded {
  key: string;
  run: Transcriber;
  device: string;
}

let loaded: Loaded | null = null;
let loading: Promise<Loaded> | null = null;

async function load(model: VoiceModel, onStatus: (s: string) => void): Promise<Loaded> {
  const key = model;
  if (loaded?.key === key) return loaded;
  if (loading) return loading;
  loading = (async () => {
    const { pipeline, env } = await import('@huggingface/transformers');
    env.cacheDir = path.join(app.getPath('userData'), 'models');
    env.allowLocalModels = false;
    const { id, dtype } = MODELS[model];
    onStatus('Loading speech model (first time downloads it)…');
    // GPU first (DirectML on Windows), CPU as the fallback.
    const devices = process.platform === 'win32' ? ['dml', 'cpu'] : ['cpu'];
    let lastErr: unknown;
    for (const device of devices) {
      try {
        const run = (await pipeline('automatic-speech-recognition', id, { device: device as 'cpu', dtype: dtype as 'q8' })) as unknown as Transcriber;
        loaded = { key, run, device };
        return loaded as Loaded;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr;
  })().finally(() => (loading = null));
  return loading;
}

export async function transcribe(audio: Float32Array, model: VoiceModel, language: string, onStatus: (s: string) => void): Promise<string> {
  if (audio.length < 16000 * 0.3) return ''; // under 0.3 s: nothing said
  const t = await load(model, onStatus);
  onStatus('Transcribing…');
  const seconds = audio.length / 16000;
  const out = await t.run(audio, {
    language: language === 'auto' ? undefined : language,
    task: 'transcribe',
    // Chunking only for long recordings; on short clips it invites repetition loops.
    ...(seconds > 30 ? { chunk_length_s: 30, stride_length_s: 5 } : {}),
    // People say ~3 tokens/second; cap output so a stuck decoder can't run on.
    max_new_tokens: Math.min(440, Math.ceil(Math.min(seconds, 30) * 7) + 16),
  });
  const text = collapseRepeats((Array.isArray(out) ? out.map((o) => o.text).join(' ') : out.text).trim());
  // Whisper's stock hallucinations on silence.
  return /^(\[.*\]|\(.*\)|you\.?|thank you\.?|thanks for watching!?)$/i.test(text) ? '' : text;
}

/** Removes Whisper's repetition loops: the same phrase three or more times in a row is kept once. */
export function collapseRepeats(text: string): string {
  return text.replace(/(\b.{12,}?)(?:\s*\1){2,}/gs, '$1').trim();
}

export const voiceDevice = () => loaded?.device ?? null;
