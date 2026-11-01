// Microphone capture for voice input. Audio stays in memory and goes only to
// the local Whisper model in the main process.
const MAX_MS = 5 * 60 * 1000;
/** silence after speech that ends a hands-free recording */
const PAUSE_MS = 1500;
/** give up if nothing is said at all */
const NO_SPEECH_MS = 10000;

let current: { stream: MediaStream; recorder: MediaRecorder; chunks: Blob[]; timer: number; vad: Vad } | null = null;

/**
 * Energy-based pause detection: learn the room's noise floor for 0.4 s, wait for speech,
 * then fire "voice-timeout" after a pause. Starts disarmed; enableAutoStop() arms it.
 */
class Vad {
  private ctx = new AudioContext();
  private analyser = this.ctx.createAnalyser();
  private buf = new Float32Array(2048);
  private interval: number;
  private armed = false;
  private noise = 0;
  private spoke = false;
  private lastVoice = Date.now();
  private readonly started = Date.now();

  constructor(stream: MediaStream) {
    this.analyser.fftSize = 2048;
    this.ctx.createMediaStreamSource(stream).connect(this.analyser);
    this.interval = window.setInterval(() => this.tick(), 100);
  }

  arm() {
    this.armed = true;
    this.lastVoice = Date.now();
  }

  private tick() {
    this.analyser.getFloatTimeDomainData(this.buf);
    let sum = 0;
    for (const v of this.buf) sum += v * v;
    const rms = Math.sqrt(sum / this.buf.length);
    const now = Date.now();
    if (now - this.started < 400) {
      this.noise = Math.max(this.noise, rms);
      return;
    }
    if (rms > Math.max(0.015, this.noise * 2.5)) {
      this.spoke = true;
      this.lastVoice = now;
    }
    if (!this.armed) return;
    if ((this.spoke && now - this.lastVoice > PAUSE_MS) || (!this.spoke && now - this.started > NO_SPEECH_MS)) {
      this.armed = false;
      window.dispatchEvent(new Event('voice-timeout'));
    }
  }

  dispose() {
    clearInterval(this.interval);
    void this.ctx.close();
  }
}

/** Hands-free mode: stop by itself when the speaker pauses. */
export const enableAutoStop = () => current?.vad.arm();

export const isRecording = () => current !== null;

export async function startRecording(fromHotkey: boolean, autoStop: boolean): Promise<void> {
  if (current) return;
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.start();
  // Safety stop so a forgotten recording can't run forever.
  const timer = window.setTimeout(() => window.dispatchEvent(new Event('voice-timeout')), MAX_MS);
  const vad = new Vad(stream);
  if (autoStop) vad.arm();
  current = { stream, recorder, chunks, timer, vad };
  window.cockpit.voiceRecording(true, fromHotkey);
}

/** Stops recording and returns 16 kHz mono samples, the format Whisper expects. */
async function stopCapture(): Promise<Float32Array | null> {
  const rec = current;
  if (!rec) return null;
  current = null;
  clearTimeout(rec.timer);
  rec.vad.dispose();
  await new Promise<void>((resolve) => {
    rec.recorder.onstop = () => resolve();
    rec.recorder.stop();
  });
  rec.stream.getTracks().forEach((t) => t.stop());
  if (!rec.chunks.length) return null;
  const ctx = new AudioContext({ sampleRate: 16000 });
  try {
    const decoded = await ctx.decodeAudioData(await new Blob(rec.chunks).arrayBuffer());
    return decoded.getChannelData(0);
  } finally {
    ctx.close();
  }
}

export async function stopAndTranscribe(): Promise<{ text: string; pasted: boolean }> {
  const audio = await stopCapture().catch(() => null);
  if (!audio) {
    // Nothing to transcribe: tell the main process we're idle again. Otherwise it moves
    // straight from "listening" to "transcribing" when the audio arrives.
    window.cockpit.voiceRecording(false, false);
    return { text: '', pasted: false };
  }
  return window.cockpit.voiceTranscribe(audio);
}
