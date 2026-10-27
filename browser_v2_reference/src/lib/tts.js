// Edge TTS implementation follows the working Telegram bot: synthesize each
// short Burmese segment, apply FFmpeg atempo/loudnorm, then join the WAVs.
const SAMPLE_RATE = 24000;
const audioCache = new Map();

async function synthesizeOnce(text, voice, rate, signal, leadIn) {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), 90000);
  const onAbort = () => timeout.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice, rate, leadIn }),
      signal: timeout.signal
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      throw new Error(payload.error || `Edge TTS endpoint returned ${res.status}`);
    }
    const audio = await res.arrayBuffer();
    if (audio.byteLength < 1000) throw new Error('TTS က အသံဖိုင်အလွတ်နီးပါး ပြန်ပေးပါတယ်။');
    return audio;
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error.name === 'AbortError') throw new Error('Edge TTS ကြာလွန်းလို့ ရပ်လိုက်ပါတယ် (90s)');
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

async function synthesize(text, voice, rate, signal, leadIn) {
  const key = `${voice}|${rate}|${leadIn ? 1 : 0}|${text}`;
  if (audioCache.has(key)) return audioCache.get(key).slice(0);
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const audio = await synthesizeOnce(text, voice, rate, signal, leadIn);
      audioCache.set(key, audio.slice(0));
      if (audioCache.size > 120) audioCache.delete(audioCache.keys().next().value);
      return audio;
    } catch (error) {
      if (signal?.aborted) throw error;
      lastError = error;
      if (attempt < 1) await new Promise((resolve) => setTimeout(resolve, 900));
    }
  }
  throw lastError;
}

function decode(arrayBuffer) {
  const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!Ctx) throw new Error('ဒီ browser မှာ OfflineAudioContext မရပါ။ Chrome နဲ့ ပြန်စမ်းပါ။');
  const ctx = new Ctx(1, 1, SAMPLE_RATE);
  return new Promise((resolve, reject) => {
    const copy = arrayBuffer.slice(0);
    const result = ctx.decodeAudioData(copy, resolve, reject);
    if (result?.then) result.then(resolve, reject);
  });
}

function encodeWav(samples) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (offset, text) => { for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i)); };
  write(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); write(8, 'WAVE'); write(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true); view.setUint32(28, SAMPLE_RATE * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  write(36, 'data'); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

async function runPool(items, limit, worker) {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}

export async function buildVoiceover({ segments, voice, rate = 1.25, signal, onProgress }) {
  const valid = segments.map((segment, index) => ({
    index, text: String(segment.text || '').trim(),
  })).filter((segment) => segment.text);
  if (!valid.length) throw new Error('Voiceover လုပ်ဖို့ မြန်မာ script မရှိပါ။');

  const audios = new Array(segments.length);
  let done = 0;
  // Bot-style: one audio file per short segment, synthesized three at a time
  // to reduce wait while preserving final segment order.
  await runPool(valid, 3, async (item) => {
    onProgress?.(done, valid.length, item.index, 'starting');
    const raw = await synthesize(item.text, voice, rate, signal, item.index === valid[0].index);
    audios[item.index] = await decode(raw);
    done += 1;
    onProgress?.(done, valid.length, item.index, 'done');
  });

  const timeline = segments.map(() => ({ start: 0, end: 0, skip: true }));
  let cursor = 0;
  const chunks = [];
  // Keep original order even though two requests can finish concurrently.
  for (const item of valid) {
    const audio = audios[item.index];
    if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) {
      throw new Error(`အသံ segment ${item.index + 1} ကို decode မလုပ်နိုင်ပါ။`);
    }
    const start = cursor;
    const end = start + audio.duration;
    timeline[item.index] = { start: Number(start.toFixed(3)), end: Number(end.toFixed(3)) };
    chunks.push({ audio, start });
    cursor = end;
  }

  const total = Math.max(1, Math.ceil((cursor + 0.02) * SAMPLE_RATE));
  const mix = new Float32Array(total);
  for (const { audio, start } of chunks) {
    const data = audio.getChannelData(0);
    const offset = Math.round(start * SAMPLE_RATE);
    for (let i = 0; i < data.length && offset + i < total; i += 1) mix[offset + i] += data[i];
  }
  return { wavBlob: encodeWav(mix), timeline, duration: total / SAMPLE_RATE };
}
