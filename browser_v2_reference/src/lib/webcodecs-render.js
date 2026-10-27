import { Output, Mp4OutputFormat, BufferTarget, CanvasSource, AudioBufferSource, Quality } from 'mediabunny';
import { layoutPages, renderSubtitlePng, ensureBurmeseFont } from './subtitles.js';

let cancelled = false;
export function cancelWebCodecsRender() { cancelled = true; }
const dims = { '360p': [360, 640], '720p': [720, 1280], '1080p': [1080, 1920] };
const even = (v) => Math.max(2, Math.round(v / 2) * 2);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v) || 0));

function waitEvent(target, success, fail, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => done(new Error('Video load/seek timeout ဖြစ်နေပါတယ်။')), timeout);
    const done = (error) => {
      clearTimeout(timer); target.removeEventListener(success, ok); if (fail) target.removeEventListener(fail, bad);
      error ? reject(error) : resolve();
    };
    const ok = () => done(); const bad = () => done(new Error('Browser က source video ကို decode မလုပ်နိုင်ပါ။'));
    target.addEventListener(success, ok, { once: true }); if (fail) target.addEventListener(fail, bad, { once: true });
  });
}
async function seek(video, time) {
  const safe = Math.max(0, Math.min(Math.max(0, video.duration - 0.04), time));
  if (Math.abs(video.currentTime - safe) < 0.025 && video.readyState >= 2) return;
  const ready = waitEvent(video, 'seeked', 'error');
  video.currentTime = safe;
  await ready;
}
function raf() { return new Promise((resolve) => requestAnimationFrame(() => resolve())); }
function makeCaptionStyle(style, W, H, imageHeight) {
  const bandH = even(H * clamp(style.subtitleBlur, 0, 25) / 100);
  const bandY = Math.min(even(H * clamp(style.subY, 0, 100) / 100), H - bandH);
  const center = H * (Number.isFinite(Number(style.captionY)) ? clamp(style.captionY, 0, 100) : (clamp(style.subY, 0, 100) + clamp(style.subtitleBlur, 0, 25) / 2)) / 100;
  return Math.max(0, Math.min(H - imageHeight, even(center - imageHeight / 2)));
}
function filterString(style) {
  const preset = style.filter || 'cinematic';
  const b = 100 + (Number(style.brightness) || 0) / 2;
  const c = (preset === 'cinematic' ? 103.5 : preset === 'vivid' ? 105 : 100) * (1 + (Number(style.contrast) || 0) / 100);
  const s = (preset === 'mono' ? 0 : (preset === 'vivid' ? 116 : preset === 'cinematic' ? 96 : 100)) * (1 + (Number(style.saturation) || 0) / 100);
  return `brightness(${Math.max(0, b)}%) contrast(${Math.max(0, c)}%) saturate(${Math.max(0, s)}%)` + (preset === 'mono' ? ' grayscale(1)' : '');
}

export async function renderWebCodecsRecap({ file, segments = [], timeline = [], voiceBlob, style = {}, captionsOn = true, resolution = '720p', logoFile = null, logoPosition = 'top-right', onStage = () => {}, onProgress = () => {} }) {
  cancelled = false;
  if (!('VideoEncoder' in window) || !('AudioEncoder' in window)) throw new Error('ဒီ Browser မှာ WebCodecs Video/Audio Encoder မပံ့ပိုးပါ။ Render Engine ကို “FFmpeg (အတည်ငြာ)” ပြန်ရွေးပါ။');
  const [W, H] = dims[resolution] || dims['720p'];
  const fps = resolution === '360p' ? 18 : resolution === '720p' ? 20 : 24;
  const frameDuration = 1 / fps;
  const videoUrl = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true; video.playsInline = true; video.preload = 'auto'; video.src = videoUrl;
  video.style.position = 'fixed'; video.style.left = '-10000px'; video.style.width = '16px'; video.style.height = '16px';
  document.body.appendChild(video);
  let audioContext;
  let output;
  let logo = null;
  const subtitleImages = [];
  try {
    onStage('WebCodecs စစ်ဆေးနေပါတယ်…'); onProgress(3);
    const metadataReady = waitEvent(video, 'loadedmetadata', 'error'); video.load(); await metadataReady;
    const sourceDuration = Number(video.duration) || 0;
    if (!sourceDuration) throw new Error('Source video duration မဖတ်နိုင်ပါ။');
    const narrationDuration = Math.max(0, ...timeline.filter((t) => t && !t.skip).map((t) => Number(t.end) || 0));
    const targetDuration = narrationDuration > 0 ? narrationDuration : sourceDuration;
    const activeScenes = segments.map((seg, i) => {
      const t = timeline[i];
      if (!t || t.skip || !String(seg.text || '').trim()) return null;
      const sourceStart = clamp(seg.start, 0, sourceDuration);
      const sourceEnd = clamp(seg.end, sourceStart, sourceDuration);
      const outStart = Math.max(0, Number(t.start) || 0);
      const outEnd = Math.max(outStart, Number(t.end) || 0);
      if (sourceEnd - sourceStart < 0.12 || outEnd - outStart < 0.08) return null;
      return { sourceStart, sourceEnd, outStart, outEnd, sourceSpan: sourceEnd - sourceStart, outSpan: outEnd - outStart };
    }).filter(Boolean).sort((a, b) => a.outStart - b.outStart);
    if (!activeScenes.length) activeScenes.push({ sourceStart: 0, sourceEnd: Math.min(sourceDuration, targetDuration), outStart: 0, outEnd: targetDuration, sourceSpan: Math.min(sourceDuration, targetDuration), outSpan: targetDuration });

    const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    const sourceCanvas = document.createElement('canvas'); sourceCanvas.width = W; sourceCanvas.height = H;
    const sctx = sourceCanvas.getContext('2d', { alpha: false, desynchronized: true });
    if (!ctx || !sctx) throw new Error('Canvas memory မရနိုင်ပါ။ 360p ကို စမ်းပါ။');

    if (captionsOn) {
      onStage('မြန်မာစာတန်း PNG တွေ ပြင်နေပါတယ်…');
      await ensureBurmeseFont();
      const fontSize = Math.round(clamp(style.subtitleFontSize, 14, 28) * (W / 360));
      for (let i = 0; i < segments.length && subtitleImages.length < 220; i++) {
        const text = String(segments[i].text || '').trim(); if (!text) continue;
        const t = timeline[i] && !timeline[i].skip ? timeline[i] : segments[i];
        const start = Math.max(0, Number(t.start) || 0); const end = Math.max(start + 0.25, Number(t.end) || start + 1);
        const pages = layoutPages(text, { width: W, fontSize });
        const weights = pages.map((p) => p.join('').length || 1); const total = weights.reduce((a, b) => a + b, 0);
        let cursor = start;
        for (let p = 0; p < pages.length; p++) {
          const span = (end - start) * weights[p] / total;
          const png = await renderSubtitlePng(pages[p], { width: W, fontSize, color: style.subtitleColor || '#ffdf3d', bg: style.subtitleBg || '#111111' });
          const bitmap = await createImageBitmap(new Blob([png.data], { type: 'image/png' }));
          subtitleImages.push({ bitmap, y: makeCaptionStyle(style, W, H, png.height), start: cursor, end: p === pages.length - 1 ? end : cursor + span });
          cursor += span;
        }
      }
    }
    if (logoFile) { try { logo = await createImageBitmap(logoFile); } catch { throw new Error('Logo image ကို ဖွင့်မရပါ။ PNG/JPG/WebP ပြန်ရွေးပါ။'); } }

    const bitrate = resolution === '1080p' ? 4_500_000 : resolution === '720p' ? 2_500_000 : 650_000;
    const target = new BufferTarget();
    output = new Output({ format: new Mp4OutputFormat(), target });
    const videoSource = new CanvasSource(canvas, { codec: 'avc', quality: new Quality({ bitrate }), hardwareAcceleration: 'prefer-hardware', latencyMode: 'realtime', keyFrameInterval: 2 });
    output.addVideoTrack(videoSource);
    let audioSource = null; let audioBuffer = null;
    if (voiceBlob) {
      onStage('Edge TTS အသံကို MP4 အတွက် ပြင်နေပါတယ်…');
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const raw = await voiceBlob.arrayBuffer();
      audioBuffer = await audioContext.decodeAudioData(raw.slice(0));
      if (Math.abs(audioBuffer.duration - targetDuration) > 0.02) {
        const length = Math.max(1, Math.floor(targetDuration * audioBuffer.sampleRate));
        const aligned = audioContext.createBuffer(audioBuffer.numberOfChannels, length, audioBuffer.sampleRate);
        const copyLength = Math.min(length, audioBuffer.length);
        for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) aligned.copyToChannel(audioBuffer.getChannelData(ch).subarray(0, copyLength), ch);
        audioBuffer = aligned;
      }
      audioSource = new AudioBufferSource({ codec: 'aac', quality: new Quality({ bitrate: 128_000 }) });
      output.addAudioTrack(audioSource);
    }
    await output.start();

    const drawFrame = (time) => {
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
      sctx.save(); sctx.clearRect(0, 0, W, H); sctx.fillStyle = '#000'; sctx.fillRect(0, 0, W, H);
      sctx.filter = filterString(style);
      const vw = video.videoWidth || W; const vh = video.videoHeight || H;
      let dw, dh, dx, dy;
      if (style.fitMode === 'fit') { const scale = Math.min(W / vw, H / vh); dw = vw * scale; dh = vh * scale; dx = (W - dw) / 2; dy = (H - dh) / 2; }
      else { const scale = Math.max(W / vw, H / vh); dw = vw * scale; dh = vh * scale; dx = style.crop === 'left' ? 0 : style.crop === 'right' ? W - dw : (W - dw) / 2; dy = (H - dh) / 2; }
      const zoom = clamp(style.zoom, 1, 1.12);
      sctx.translate(W / 2, H / 2); sctx.scale(zoom * (style.flip ? -1 : 1), zoom); sctx.translate(-W / 2, -H / 2);
      sctx.drawImage(video, dx, dy, dw, dh); sctx.restore();
      ctx.drawImage(sourceCanvas, 0, 0);
      // Preserve the configured blur zones with a low-cost canvas blur pass.
      const blur = Math.max(0, Number(style.blurStrength) || 0);
      const drawBlurBand = (y, h) => { if (h < 8 || blur < 1) return; ctx.save(); ctx.beginPath(); ctx.rect(0, y, W, h); ctx.clip(); ctx.filter = `blur(${Math.min(8, blur * W / 360 * 0.12)}px)`; ctx.drawImage(sourceCanvas, -2, -2, W + 4, H + 4); ctx.restore(); ctx.filter = 'none'; };
      drawBlurBand(0, H * clamp(style.topBlur, 0, 30) / 100);
      drawBlurBand(H * (1 - clamp(style.bottomBlur, 0, 30) / 100), H * clamp(style.bottomBlur, 0, 30) / 100);
      const subH = H * clamp(style.subtitleBlur, 0, 25) / 100; drawBlurBand(H * clamp(style.subY, 0, 100) / 100, subH);
      if (Number(style.frameWidth) > 0) { ctx.strokeStyle = style.frameColor || '#d6ef47'; ctx.lineWidth = Number(style.frameWidth) * W / 360; ctx.strokeRect(0, 0, W, H); }
      for (const sub of subtitleImages) if (time >= sub.start && time < sub.end) ctx.drawImage(sub.bitmap, 0, sub.y, W, sub.bitmap.height);
      if (logo) {
        const lw = Math.max(36, W * 0.18); const lh = lw * logo.height / logo.width; const margin = Math.max(8, W * 0.035);
        const x = logoPosition.includes('left') ? margin : W - lw - margin; const y = logoPosition.includes('top') ? margin : H - lh - margin;
        ctx.drawImage(logo, x, y, lw, lh);
      }
    };

    const waitFrame = () => new Promise((resolve) => setTimeout(resolve, Math.ceil(frameDuration * 1000)));
    let frameIndex = 0; let lastSceneEnd = 0;
    const holdFrame = async (until) => {
      while (frameIndex / fps < until - 0.0001) {
        if (cancelled) throw new Error('Render ကို user က ရပ်လိုက်ပါတယ်။');
        const t = frameIndex / fps; drawFrame(t); video.pause();
        await videoSource.add(t, frameDuration); frameIndex++;
        if (frameIndex % fps === 0) { onProgress(Math.min(94, 10 + (frameIndex / fps / targetDuration) * 82)); onStage(`WebCodecs encode လုပ်နေပါတယ်… ${Math.min(94, Math.round(10 + frameIndex / fps / targetDuration * 82))}%`); }
        await waitFrame();
      }
    };

    onStage('WebCodecs + Hardware Encoder စတင်နေပါတယ်…'); onProgress(10);
    for (const scene of activeScenes) {
      if (cancelled) throw new Error('Render ကို user က ရပ်လိုက်ပါတယ်။');
      if (scene.outStart > lastSceneEnd + 0.01) await holdFrame(scene.outStart);
      await seek(video, scene.sourceStart);
      video.playbackRate = clamp(scene.sourceSpan / scene.outSpan, 0.25, 8);
      await video.play().catch(() => {});
      const endFrame = Math.min(Math.ceil(scene.outEnd * fps), Math.ceil(targetDuration * fps));
      while (frameIndex < endFrame) {
        if (cancelled) throw new Error('Render ကို user က ရပ်လိုက်ပါတယ်။');
        await waitFrame();
        const t = frameIndex / fps;
        // Pause before awaiting encoder backpressure so the captured source time doesn't drift.
        video.pause(); drawFrame(t);
        await videoSource.add(t, frameDuration); frameIndex++;
        if (frameIndex % fps === 0 || frameIndex === endFrame) {
          const pct = Math.min(94, 10 + (frameIndex / fps / targetDuration) * 82);
          onProgress(pct); onStage(`WebCodecs encode လုပ်နေပါတယ်… ${Math.round(pct)}%`);
        }
        if (frameIndex < endFrame) await video.play().catch(() => {});
      }
      video.pause(); lastSceneEnd = scene.outEnd;
    }
    await holdFrame(targetDuration);
    video.pause();
    onStage('MP4 ကို အပြီးသတ်နေပါတယ်…'); onProgress(96);
    videoSource.close();
    if (audioSource && audioBuffer) await audioSource.add(audioBuffer);
    audioSource?.close();
    await output.finalize();
    const buffer = target.buffer;
    if (!buffer || buffer.byteLength < 1024) throw new Error('WebCodecs က MP4 အလွတ်ကို ပြန်ပေးခဲ့ပါတယ်။ FFmpeg engine ကို ပြန်ရွေးပါ။');
    onProgress(100); onStage(`WebCodecs MP4 ပြီးပါပြီ (${(buffer.byteLength / 1048576).toFixed(1)} MB)`);
    return new Blob([buffer], { type: 'video/mp4' });
  } catch (error) {
    try { output?.cancel?.(); } catch {}
    throw error;
  } finally {
    video.pause(); video.removeAttribute('src'); video.load(); video.remove(); URL.revokeObjectURL(videoUrl);
    for (const item of subtitleImages) { try { item.bitmap.close(); } catch {} }
    try { logo?.close?.(); } catch {}
    try { await audioContext?.close(); } catch {}
  }
}
