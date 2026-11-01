// Microphone capture for voice input. Audio stays in memory and goes only to
// the local Whisper model in the main process.
const MAX_MS = 5 * 60 * 1000;

let current: { stream: MediaStream; recorder: MediaRecorder; chunks: Blob[]; timer: number } | null = null;

export const isRecording = () => current !== null;

export async function startRecording(fromHotkey: boolean): Promise<void> {
  if (current) return;
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.start();
  // Safety stop so a forgotten recording can't run forever.
  const timer = window.setTimeout(() => window.dispatchEvent(new Event('voice-timeout')), MAX_MS);
  current = { stream, recorder, chunks, timer };
  window.cockpit.voiceRecording(true, fromHotkey);
}

/** Stops recording and returns 16 kHz mono samples, the format Whisper expects. */
async function stopCapture(): Promise<Float32Array | null> {
  const rec = current;
  if (!rec) return null;
  current = null;
  clearTimeout(rec.timer);
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
