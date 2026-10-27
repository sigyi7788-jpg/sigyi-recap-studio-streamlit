// Gemini: video -> accurate timed transcript + Burmese recap (one request)
const BASE = 'https://generativelanguage.googleapis.com';
export const MODELS = ['gemini-3.5-flash', 'gemini-3.8-flash', 'gemini-2.5-flash'];
const INLINE_LIMIT = 18 * 1024 * 1024; // small videos: send inline (no upload / poll / delete = faster)

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Cancelled', 'AbortError')); }, { once: true });
});

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('Video ဖိုင်ကို ဖတ်မရပါ။'));
    reader.readAsDataURL(file);
  });
}

function friendly(status, message = '') {
  if (status === 400 && /api key/i.test(message)) return 'Gemini API key မမှန်ပါ။ Key ကို ပြန်စစ်ပြီး ထပ်ထည့်ပါ။';
  if (status === 401 || status === 403) return `Gemini က key ကို ခွင့်မပြုပါ (${status}) — ${message}`;
  if (status === 429) return 'Gemini free quota ပြည့်နေပါတယ် (429)။ ခဏစောင့်ပြီး ပြန်စမ်းပါ။';
  if (status === 503 || status === 500) return 'Gemini server busy ဖြစ်နေပါတယ်။ ခဏနားပြီး ပြန်စမ်းပါ။';
  return message || `HTTP ${status}`;
}

export async function uploadGeminiFile(file, apiKey, onProgress, signal) {
  const mime = file.type || 'video/mp4';
  const start = await fetch(`${BASE}/upload/v1beta/files?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(file.size),
      'X-Goog-Upload-Header-Content-Type': mime,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ file: { display_name: file.name || 'video' } }),
    signal
  });
  if (!start.ok) {
    const detail = await start.json().catch(() => ({}));
    throw new Error(friendly(start.status, detail?.error?.message));
  }
  const uploadUrl = start.headers.get('x-goog-upload-url');
  if (!uploadUrl) throw new Error('Gemini Files API က upload URL မပြန်ပါ။ Key permission စစ်ပါ။');
  const uploaded = await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', uploadUrl);
    xhr.setRequestHeader('X-Goog-Upload-Offset', '0');
    xhr.setRequestHeader('X-Goog-Upload-Command', 'upload, finalize');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText).file); } catch { reject(new Error('Gemini upload response ဖတ်မရပါ။')); }
      } else reject(new Error(`Gemini upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error('Upload network error — Wi-Fi ပြောင်းပြီး ပြန်စမ်းပါ။'));
    xhr.onabort = () => reject(new DOMException('Cancelled', 'AbortError'));
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(file);
  });
  if (!uploaded?.name) throw new Error('Gemini Files API က file reference မပြန်ပါ။');
  for (let i = 0; i < 120; i += 1) {
    const res = await fetch(`${BASE}/v1beta/${uploaded.name}?key=${encodeURIComponent(apiKey)}`, { signal });
    const payload = await res.json().catch(() => ({}));
    const current = payload.file || payload;
    if (current.state === 'ACTIVE') return current;
    if (current.state === 'FAILED') throw new Error('Gemini က video ကို process မလုပ်နိုင်ပါ။ MP4 (H.264) နဲ့ ပြန်စမ်းပါ။');
    await sleep(1500, signal);
  }
  throw new Error('Gemini video processing ကြာလွန်းနေပါတယ်။ Video ပိုတိုတာနဲ့ ပြန်စမ်းပါ။');
}

export async function deleteGeminiFile(name, apiKey) {
  try { await fetch(`${BASE}/v1beta/${name}?key=${encodeURIComponent(apiKey)}`, { method: 'DELETE' }); } catch { /* best effort */ }
}

function encodeWav16k(samples) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (o, t) => { for (let i = 0; i < t.length; i += 1) view.setUint8(o + i, t.charCodeAt(i)); };
  write(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); write(8, 'WAVE'); write(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  write(36, 'data'); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i += 1) { const s = Math.max(-1, Math.min(1, samples[i])); view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
  return new Blob([buffer], { type: 'audio/wav' });
}

// Only the SPEECH matters -> send a tiny 16 kHz mono WAV instead of the whole video (way faster)
async function extractAudio(file) {
  const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const ctx = new Ctx(1, 1, 16000);
  const data = await file.arrayBuffer();
  const audio = await new Promise((resolve, reject) => { const p = ctx.decodeAudioData(data, resolve, reject); if (p?.then) p.then(resolve, reject); });
  return new File([encodeWav16k(audio.getChannelData(0))], 'audio.wav', { type: 'audio/wav' });
}

function buildPrompt(duration) {
  const length = duration ? ` The video is about ${Math.round(duration)} seconds long.` : '';
  return `You are a professional video transcriber and Burmese translator.${length}
Listen to the WHOLE video and return ONLY JSON in exactly this shape:
{"language":"spoken language","segments":[{"start":0.0,"end":3.2,"original":"words exactly as spoken","burmese":"Burmese narration"}]}
Rules:
- Transcribe EVERY spoken sentence exactly as spoken. Never summarize, skip, or invent. Keep names as spoken.
- start/end are decimal SECONDS from the very start of the video (e.g. 83.5, not "1:23"), accurate to 0.1s.
- One segment = one short sentence or phrase of about 2 to 5 seconds. Keep each Burmese segment concise enough for a neat subtitle of at most two short lines. Split long sentences into multiple consecutive segments. Segments are in order and never overlap.
- "burmese" = natural spoken Burmese (Myanmar Unicode, never Zawgyi) translation of that segment, written to be read aloud as voiceover: same meaning, nothing added, concise and natural. Avoid long paragraphs; prefer short readable phrases. If the original is already Burmese, only polish it lightly.
- If there is no speech at all, write short Burmese narration segments describing what happens on screen and set "original" to "".`;
}

async function generateJson(parts, apiKey, signal, onStage) {
  let lastStatus = 0;
  let lastMessage = '';
  for (const model of MODELS) {
    const thinking = model.startsWith('gemini-2.5') ? { thinkingBudget: 0 } : { thinkingLevel: 'minimal' };
    const variants = [
      { temperature: 0.2, responseMimeType: 'application/json', thinkingConfig: thinking },
      { temperature: 0.2, responseMimeType: 'application/json' }
    ];
    variantLoop: for (const generationConfig of variants) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        onStage?.(`${model} က transcript + Burmese recap ရေးနေပါတယ်…${attempt ? ` (retry ${attempt})` : ''}`);
        const res = await fetch(`${BASE}/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal,
          body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig })
        });
        const payload = await res.json().catch(() => ({}));
        if (res.ok) {
          const text = payload.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('').trim();
          if (text) return text;
          lastStatus = 0;
          lastMessage = payload.promptFeedback?.blockReason ? `Gemini က content ကို block လုပ်ထားပါတယ် (${payload.promptFeedback.blockReason})` : 'Gemini က အဖြေအလွတ် ပြန်ပါတယ်။';
          break variantLoop;
        }
        lastStatus = res.status;
        lastMessage = payload?.error?.message || '';
        if (res.status === 401 || res.status === 403 || (res.status === 400 && /api key/i.test(lastMessage))) throw new Error(friendly(res.status, lastMessage));
        if (res.status === 404) break variantLoop; // model not available for this key -> next model
        if (res.status === 400) continue variantLoop; // config not supported -> next variant
        if ([429, 500, 502, 503, 504].includes(res.status)) { await sleep(2000 * (attempt + 1), signal); continue; }
        break variantLoop;
      }
    }
  }
  throw new Error(`Gemini transcript မရပါ — ${friendly(lastStatus, lastMessage)}`);
}

function toSeconds(value) {
  if (typeof value === 'number') return value;
  const text = String(value ?? '').trim().replace(/s$/i, '');
  if (!text) return NaN;
  if (text.includes(':')) return text.split(':').map(Number).reduce((total, part) => total * 60 + part, 0);
  return Number(text);
}

export function parseSegments(raw, duration = 0) {
  let text = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
  const first = text.search(/[\[{]/);
  const last = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
  if (first >= 0 && last > first) text = text.slice(first, last + 1);
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('Gemini အဖြေကို JSON အဖြစ် ဖတ်မရပါ။ ပြန်စမ်းပါ။'); }
  const list = Array.isArray(data) ? data : data.segments || data.transcriptSegments || [];
  let segments = list.map((item) => ({
    start: toSeconds(item.start),
    end: toSeconds(item.end),
    original: String(item.original ?? item.transcript ?? '').trim(),
    text: String(item.burmese ?? item.text ?? '').trim()
  })).filter((item) => item.text);
  if (!segments.length) throw new Error('Gemini က transcript မထုတ်ပေးပါ။ အသံပါတဲ့ video နဲ့ ပြန်စမ်းပါ။');
  segments.sort((a, b) => (a.start || 0) - (b.start || 0));
  segments = segments.map((s, i) => {
    let start = Number.isFinite(s.start) ? s.start : (i ? segments[i - 1].end || 0 : 0);
    if (duration) start = Math.min(start, Math.max(0, duration - 0.5));
    let end = Number.isFinite(s.end) && s.end > start ? s.end : start + 2.5;
    const next = segments[i + 1];
    if (next && Number.isFinite(next.start) && next.start > start + 0.3) end = Math.min(end, next.start);
    if (duration) end = Math.min(end, duration);
    return { ...s, start: Number(start.toFixed(2)), end: Number(Math.max(end, start + 0.3).toFixed(2)) };
  });
  return segments;
}

export async function analyzeVideoWithGemini({ file: sourceFile, apiKey, duration, signal, onStage, onProgress }) {
  let file = sourceFile;
  onStage?.('Video ထဲက အသံကို ဖြတ်ယူနေပါတယ်…');
  try { file = await extractAudio(sourceFile); } catch { file = sourceFile; /* decode not supported -> send video */ }
  const mime = file.type || 'video/mp4';
  let uploaded = null;
  try {
    let mediaPart;
    if (file.size <= INLINE_LIMIT) {
      onStage?.('Video ကို Gemini သို့ ပို့ဖို့ ပြင်နေပါတယ်…');
      onProgress?.(20);
      mediaPart = { inlineData: { mimeType: mime, data: await fileToBase64(file) } };
    } else {
      onStage?.('Video ကို Gemini Files API သို့ upload လုပ်နေပါတယ်…');
      uploaded = await uploadGeminiFile(file, apiKey, (ratio) => {
        onProgress?.(10 + ratio * 45);
        onStage?.(`Video upload ${Math.round(ratio * 100)}%`);
      }, signal);
      mediaPart = { fileData: { mimeType: uploaded.mimeType || mime, fileUri: uploaded.uri } };
    }
    onProgress?.(60);
    const raw = await generateJson([mediaPart, { text: buildPrompt(duration) }], apiKey, signal, onStage);
    onProgress?.(95);
    return parseSegments(raw, duration);
  } finally {
    if (uploaded?.name) deleteGeminiFile(uploaded.name, apiKey);
  }
}
