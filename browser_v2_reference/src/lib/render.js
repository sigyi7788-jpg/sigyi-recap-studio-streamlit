// ffmpeg.wasm render: crop 9:16 / zoom / flip / adjust / REAL blur bands / Burmese PNG captions / voiceover
import { renderSubtitlePng, layoutPages, ensureBurmeseFont } from './subtitles.js';
import coreURL from '@ffmpeg/core?url';
import wasmURL from '@ffmpeg/core/wasm?url';

// Portrait export presets. 1080p is available for short clips on capable phones.
const RESOLUTIONS = { '360p': [360, 640], '720p': [720, 1280], '1080p': [1080, 1920] };
const dimensions = (resolution) => RESOLUTIONS[resolution] || RESOLUTIONS['720p'];

let ffmpeg = null;
let logs = [];
let activeRenderEngine = 'ffmpeg';

export function getRenderLogs() { return logs.slice(-60); }

export function terminateFfmpeg() {
  try { ffmpeg?.terminate(); } catch { /* already stopped */ }
  ffmpeg = null;
  if (activeRenderEngine === 'webcodecs') import('./webcodecs-render.js').then((m) => m.cancelWebCodecsRender()).catch(() => {});
}

async function getFfmpeg() {
  if (ffmpeg) return ffmpeg;
  const { FFmpeg } = await import('@ffmpeg/ffmpeg');
  const { toBlobURL } = await import('@ffmpeg/util');
  const instance = new FFmpeg();
  instance.on('log', ({ message }) => { logs.push(message); if (logs.length > 60) logs.shift(); });
  try {
    // Load from the locally installed npm package, not a remote CDN.
    await instance.load({
      coreURL: await toBlobURL(coreURL, 'text/javascript'),
      wasmURL: await toBlobURL(wasmURL, 'application/wasm')
    });
    ffmpeg = instance;
    return instance;
  } catch (error) {
    try { instance.terminate(); } catch { /* ignore */ }
    throw new Error(`FFmpeg WASM စတင်မရပါ။ Local core ဖိုင်ကို စစ်ပါ။ ${error?.message || error}`);
  }
}

const even = (n) => Math.max(0, Math.round(n / 2) * 2);
const hex = (value) => `0x${String(value || '#ffffff').replace('#', '')}`;
const clampPct = (v, max) => Math.max(0, Math.min(max, Number(v) || 0));

export function buildGraph(style, subs, hasVoice, firstSubInput, resolution = '720p', targetDuration = 10, segments = [], timeline = [], sourceDuration = targetDuration, logoInputIndex = -1, logoPosition = 'top-right') {
  const [W, H] = dimensions(resolution);
  const outputFps = resolution === '360p' ? 18 : resolution === '720p' ? 20 : 24;
  const zoom = Math.max(1, Math.min(1.12, Number(style.zoom) || 1));
  const cropX = style.crop === 'left' ? '0' : style.crop === 'right' ? 'iw-ow' : '(iw-ow)/2';
  const b = Number(style.brightness) || 0; const c = Number(style.contrast) || 0; const s = Number(style.saturation) || 0;
  const preset = style.filter || 'cinematic';
  const presetContrast = preset === 'cinematic' ? 1.035 : preset === 'vivid' ? 1.05 : preset === 'mono' ? 1.04 : 1;
  const presetSat = preset === 'cinematic' ? 0.96 : preset === 'vivid' ? 1.16 : preset === 'mono' ? 0 : 1;
  const visualChain = () => {
    const chain = [];
    if (style.fitMode === 'fit') {
      // Keep the complete original frame visible inside the 9:16 phone canvas.
      chain.push(`scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=bilinear`, `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black`);
    } else {
      chain.push(`crop=w='min(iw,ih*9/16)':h='min(ih,iw*16/9)':x='${cropX}':y='(ih-oh)/2'`, `scale=${W}:${H}:flags=bilinear`);
    }
    if (zoom > 1.001) chain.push(`crop=w='iw/${zoom}':h='ih/${zoom}':x='(iw-ow)/2':y='(ih-oh)/2'`, `scale=${W}:${H}:flags=bilinear`);
    if (style.flip) chain.push('hflip');
    chain.push(`fps=${outputFps}`, 'setsar=1');
    chain.push(`eq=brightness=${(b / 200).toFixed(3)}:contrast=${(presetContrast * (1 + c / 100)).toFixed(3)}:saturation=${(presetSat * (1 + s / 100)).toFixed(3)}`);
    return chain.join(',');
  };

  let graph = '';
  let cur = 'v0';
  // Cut the original video into source-timed scenes, then fit each scene to
  // its corresponding narration segment duration. This keeps visuals aligned
  // with the spoken line instead of playing the full source at its old timing.
  const scenes = segments.map((seg, i) => {
    const t = timeline?.[i];
    if (!t || t.skip || !String(seg.text || '').trim()) return null;
    let start = Math.max(0, Math.min(Number(sourceDuration) || 0, Number(seg.start) || 0));
    let end = Math.max(start, Math.min(Number(sourceDuration) || 0, Number(seg.end) || 0));
    const voiceStart = Math.max(0, Number(t.start) || 0);
    const voiceEnd = Math.max(voiceStart, Number(t.end) || 0);
    const outDuration = voiceEnd - voiceStart;
    if (end - start < 0.15 || outDuration < 0.08) return null;
    return { start, end, outDuration, ratio: outDuration / (end - start) };
  }).filter(Boolean);

  if (scenes.length) {
    if (scenes.length > 1) graph += `[0:v]split=${scenes.length}${scenes.map((_, i) => `[raw${i}]`).join('')};`;
    scenes.forEach((scene, i) => {
      const input = scenes.length > 1 ? `[raw${i}]` : '[0:v]';
      graph += `${input}trim=start=${scene.start.toFixed(3)}:end=${scene.end.toFixed(3)},setpts=PTS-STARTPTS,setpts=PTS*${scene.ratio.toFixed(6)},${visualChain()}[scene${i}];`;
    });
    graph += scenes.map((_, i) => `[scene${i}]`).join('') + `concat=n=${scenes.length}:v=1:a=0[v0];`;
  } else {
    graph += `[0:v]${visualChain()}[v0];`;
  }

  const sigma = Math.max(3, (Number(style.blurStrength) || 24) * 0.8);
  const bands = [];
  const top = even(H * clampPct(style.topBlur, 30) / 100);
  if (top >= 8) bands.push({ y: 0, h: top });
  const bottom = even(H * clampPct(style.bottomBlur, 30) / 100);
  if (bottom >= 8) bands.push({ y: H - bottom, h: bottom });
  const subH = even(H * clampPct(style.subtitleBlur, 25) / 100);
  const subY = Math.min(even(H * clampPct(style.subY, 95) / 100), H - subH);
  if (subH >= 8) bands.push({ y: subY, h: subH });
  bands.forEach((band, i) => {
    graph += `[${cur}]split[m${i}][s${i}];[s${i}]crop=${W}:${band.h}:0:${band.y},gblur=sigma=${Math.min(sigma, 12).toFixed(1)}:steps=1[b${i}];[m${i}][b${i}]overlay=0:${band.y}[o${i}];`;
    cur = `o${i}`;
  });
  if (Number(style.frameWidth) > 0) {
    graph += `[${cur}]drawbox=x=0:y=0:w=iw:h=ih:color=${hex(style.frameColor)}@1:t=${Math.round(style.frameWidth)}[fr];`;
    cur = 'fr';
  }
  // Timed Burmese subtitle sprite overlays stay on the same narration clock.
  subs.forEach((group, k) => {
    const cropY = group.items.map((sub, i) => `if(between(t,${sub.start.toFixed(2)},${sub.end.toFixed(2)}),${i * group.height},`).join('') + '0' + ')'.repeat(group.items.length);
    const active = group.items.map((sub) => `between(t,${sub.start.toFixed(2)},${sub.end.toFixed(2)})`).join('+');
    const overlayY = group.items.map((sub) => `if(between(t,${sub.start.toFixed(2)},${sub.end.toFixed(2)}),${sub.y},`).join('') + '0' + ')'.repeat(group.items.length);
    graph += `[${firstSubInput + k}:v]format=rgba,loop=loop=-1:size=1:start=0,trim=duration=${targetDuration.toFixed(3)},setpts=N/(${outputFps}*TB),format=yuva420p,crop=${W}:${group.height}:0:'${cropY}'[sub${k}];[${cur}][sub${k}]overlay=0:'${overlayY}':enable='${active}':shortest=1:eof_action=pass:repeatlast=0[c${k}];`;
    cur = `c${k}`;
  });
  if (logoInputIndex >= 0) {
    const logoW = Math.max(48, Math.round(W * 0.18));
    const margin = Math.max(8, Math.round(W * 0.035));
    const positions = {
      'top-left': `${margin}:${margin}`,
      'top-right': `W-w-${margin}:${margin}`,
      'bottom-left': `${margin}:H-h-${margin}`,
      'bottom-right': `W-w-${margin}:H-h-${margin}`
    };
    const xy = positions[logoPosition] || positions['top-right'];
    graph += `[${logoInputIndex}:v]format=rgba,scale=${logoW}:-1[logo];[${cur}][logo]overlay=${xy}:eof_action=pass:repeatlast=0:enable='between(t,0,${targetDuration.toFixed(3)})'[withlogo];`;
    cur = 'withlogo';
  }
  graph += `[${cur}]format=yuv420p[vout]`;
  if (hasVoice) graph += `;[1:a]aresample=async=1:first_pts=0,apad,atrim=duration=${targetDuration.toFixed(3)},asetpts=PTS-STARTPTS[aout]`;
  return graph;
}

export function subtitleY(style, boxHeight, resolution = '720p') {
  const [W, H] = dimensions(resolution);
  const centerPct = Number.isFinite(Number(style.captionY)) ? clampPct(style.captionY, 95) : (clampPct(style.subY, 95) + clampPct(style.subtitleBlur, 25) / 2);
  const center = H * centerPct / 100;
  return Math.max(0, Math.min(H - boxHeight, even(center - boxHeight / 2)));
}

async function getVideoDuration(file) {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'metadata';
  video.muted = true;
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Video အရှည်ကို browser က မဖတ်နိုင်ပါ။ Video ဖိုင်ကို ပြန်ရွေးပါ။')), 15000);
      video.onloadedmetadata = () => {
        clearTimeout(timer);
        const duration = Number(video.duration);
        if (Number.isFinite(duration) && duration > 0) resolve(duration);
        else reject(new Error('Video duration မမှန်ပါ။'));
      };
      video.onerror = () => { clearTimeout(timer); reject(new Error('Video metadata ဖတ်မရပါ။ ဖိုင် format ကို စစ်ပါ။')); };
      video.src = url;
    });
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

export async function renderRecap({ file, segments, timeline, voiceBlob, style, captionsOn, resolution = '720p', logoFile = null, logoPosition = 'top-right', engine = 'ffmpeg', onStage, onProgress }) {
  if (engine === 'webcodecs') {
    activeRenderEngine = 'webcodecs';
    try {
      const { renderWebCodecsRecap } = await import('./webcodecs-render.js');
      return await renderWebCodecsRecap({ file, segments, timeline, voiceBlob, style, captionsOn, resolution, logoFile, logoPosition, onStage, onProgress });
    } finally { activeRenderEngine = 'ffmpeg'; }
  }
  activeRenderEngine = 'ffmpeg';
  const [W, H] = dimensions(resolution);
  const sourceDuration = await getVideoDuration(file);
  const narrationDuration = Math.max(0, ...(timeline || []).filter((t) => t && !t.skip).map((t) => Number(t.end) || 0));
  const targetDuration = narrationDuration > 0 ? narrationDuration : sourceDuration;
  const { fetchFile } = await import('@ffmpeg/util');
  logs = [];
  const files = ['input.mp4', 'voice.wav', 'output.mp4'];
  let logoPngBytes = null;
  if (logoFile) {
    onStage('Logo ကို render အတွက် ပြင်ဆင်နေပါတယ်…');
    const bitmap = await createImageBitmap(logoFile);
    const maxWidth = 512;
    const scale = Math.min(1, maxWidth / bitmap.width);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const png = await new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Logo PNG မဖန်တီးနိုင်ပါ။')), 'image/png'));
    logoPngBytes = new Uint8Array(await png.arrayBuffer());
  }

  // 1) subtitle PNGs (browser draws Burmese correctly)
  const subs = [];
  if (captionsOn) {
    onStage('Burmese subtitle တွေ ပြင်နေပါတယ်…'); onProgress(5);
    await ensureBurmeseFont();
    const captionFontSize = Math.round(Math.max(14, Math.min(28, Number(style.subtitleFontSize) || 20)) * (W / 360));
    for (let i = 0; i < segments.length && subs.length < 220; i += 1) {
      const text = segments[i].text.trim();
      if (!text) continue;
      const t = timeline?.[i] && !timeline[i].skip ? timeline[i] : segments[i];
      const start = Math.max(0, t.start);
      const end = Math.max(t.end + 0.1, start + 0.4);
      const pages = layoutPages(text, { width: W, fontSize: captionFontSize });
      const weights = pages.map((p) => p.join('').length || 1);
      const total = weights.reduce((a, b) => a + b, 0);
      let cursor = start;
      for (let p = 0; p < pages.length; p += 1) {
        const span = ((end - start) * weights[p]) / total;
        const png = await renderSubtitlePng(pages[p], { width: W, fontSize: captionFontSize, color: style.subtitleColor, bg: style.subtitleBg });
        subs.push({ png, y: subtitleY(style, png.height, resolution), start: cursor, end: p === pages.length - 1 ? end : cursor + span });
        cursor += span;
      }
    }
  }

  // Pack caption PNGs into a few sprite sheets. Hundreds of individual FFmpeg
  // overlay inputs can stall mobile WASM encodes around 80–90%.
  const spriteGroups = [];
  const spriteBytes = [];
  if (subs.length) {
    onStage('Subtitle overlay တွေကို အုပ်စုဖွဲ့နေပါတယ်…'); onProgress(7);
    const maxSheetHeight = 8192;
    let group = [];
    let capHeight = 0;
    const flushGroup = async () => {
      if (!group.length) return;
      const height = even(capHeight);
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = height * group.length;
      const ctx = canvas.getContext('2d');
      for (let i = 0; i < group.length; i += 1) {
        const img = await createImageBitmap(new Blob([group[i].png.data], { type: 'image/png' }));
        ctx.drawImage(img, 0, i * height, W, group[i].png.height);
        img.close?.();
      }
      const blob = await new Promise((resolve, reject) => canvas.toBlob((b) => b ? resolve(b) : reject(new Error('Subtitle sprite sheet မဖန်တီးနိုင်ပါ။')), 'image/png'));
      const name = `captions${spriteGroups.length}.png`;
      spriteGroups.push({ name, height, items: group });
      spriteBytes.push(new Uint8Array(await blob.arrayBuffer()));
      group = [];
      capHeight = 0;
    };
    for (const sub of subs) {
      const nextHeight = Math.max(capHeight, sub.png.height);
      if (group.length && nextHeight * (group.length + 1) > maxSheetHeight) await flushGroup();
      group.push(sub);
      capHeight = Math.max(capHeight, sub.png.height);
    }
    await flushGroup();
  }

  // 2) engine
  onStage('Render engine ကို ဖွင့်နေပါတယ်… (ပထမအကြိမ် ခဏကြာနိုင်)'); onProgress(10);
  const ff = await getFfmpeg();
  let lastProgress = 0;
  const onFfProgress = ({ progress }) => {
    if (!Number.isFinite(Number(progress))) return;
    progress = Math.max(0, Math.min(1, Number(progress)));
    lastProgress = progress;
    // Keep encoding below 97%; reserve 97–100% for output readback and cleanup.
    onProgress(18 + progress * 77);
    onStage(`FFmpeg encode လုပ်နေပါတယ်… ${Math.round(progress * 100)}%`);
  };
  ff.on('progress', onFfProgress);

  try {
    onStage('Video ကို memory ထဲ ထည့်နေပါတယ်…'); onProgress(14);
    await ff.writeFile('input.mp4', await fetchFile(file));
    const hasVoice = Boolean(voiceBlob);
    if (hasVoice) await ff.writeFile('voice.wav', new Uint8Array(await voiceBlob.arrayBuffer()));
    spriteGroups.forEach((group, i) => { files.push(group.name); });
    for (let i = 0; i < spriteGroups.length; i += 1) await ff.writeFile(spriteGroups[i].name, spriteBytes[i]);

    const firstSubInput = hasVoice ? 2 : 1;
    const logoInputIndex = logoPngBytes ? firstSubInput + spriteGroups.length : -1;
    if (logoPngBytes) { files.push('logo.png'); await ff.writeFile('logo.png', logoPngBytes); }
    const graph = buildGraph(style, spriteGroups, hasVoice, firstSubInput, resolution, targetDuration, segments, timeline, sourceDuration, logoInputIndex, logoPosition);
    const args = ['-i', 'input.mp4'];
    if (hasVoice) args.push('-i', 'voice.wav');
    // Read each sprite PNG once; the filter graph loops the decoded frame finitely.
    const outputFps = resolution === '360p' ? 18 : resolution === '720p' ? 20 : 24;
    spriteGroups.forEach((group) => args.push('-framerate', String(outputFps), '-i', group.name));
    if (logoPngBytes) args.push('-loop', '1', '-framerate', String(outputFps), '-i', 'logo.png');
    args.push('-filter_complex', graph, '-map', '[vout]');
    if (hasVoice) args.push('-map', '[aout]', '-c:a', 'aac', '-b:a', '128k');
    else args.push('-map', '0:a?', '-c:a', 'aac', '-b:a', '128k');
    // One thread and ultrafast keep CPU/memory pressure lower in FFmpeg WASM.
    // Higher resolutions are supported, but 1080p requires substantially more memory.
    const crf = resolution === '1080p' ? '27' : resolution === '720p' ? '28' : '34';
    // Hard duration cap guarantees the render cannot continue beyond the source clip.
    args.push('-t', targetDuration.toFixed(3), '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', crf, '-threads', '1', '-pix_fmt', 'yuv420p', 'output.mp4');

    onStage('Render စတင်နေပါတယ်…'); onProgress(18);
    const code = await ff.exec(args, 900000);
    if (code !== 0) {
      const tail = logs.filter(Boolean).slice(-6).join(' | ');
      throw new Error(`ffmpeg error (code ${code}). ${tail || 'FFmpeg filter graph/phone memory ကို စစ်ပါ။'}`);
    }
    // Encoding can finish while reading the output back into JS memory stalls.
    // Delete large inputs first to reduce peak memory on Android browsers.
    onStage('Encode 100% ပြီးပါပြီ။ Input/Subtitle cache တွေ ရှင်းနေပါတယ်…'); onProgress(96);
    // Explicitly clear every input and subtitle sprite from the WASM virtual FS.
    for (const entry of await ff.listDir('/').catch(() => [])) {
      if (entry.name !== '.' && entry.name !== '..' && entry.name !== 'output.mp4' && !entry.isDir) {
        try { await ff.deleteFile(entry.name); } catch { /* continue clearing remaining files */ }
      }
    }
    for (const name of files) {
      if (name !== 'output.mp4') { try { await ff.deleteFile(name); } catch { /* already absent */ } }
    }
    onStage('MP4 ဖိုင်ကို memory ထဲ ဖတ်နေပါတယ်…'); onProgress(97);
    let readTimer;
    let data;
    try {
      data = await Promise.race([
        ff.readFile('output.mp4'),
        new Promise((_, reject) => { readTimer = setTimeout(() => reject(new Error('MP4 encode ပြီးပါပြီ၊ ဒါပေမဲ့ output ကို memory ထဲဖတ်တာ 90 စက္ကန့်ကျော်နေပါတယ်။ Error details ကို ပို့ပါ။')), 90000); })
      ]);
    } finally { clearTimeout(readTimer); }
    if (!data?.length) throw new Error('Output video အလွတ်ဖြစ်နေပါတယ်။ FFmpeg encode ပြီးပေမဲ့ MP4 ထဲမှာ data မရှိပါ။');
    onStage(`MP4 ဖိုင်ဖတ်ပြီးပါပြီ (${(data.byteLength / 1024 / 1024).toFixed(1)} MB)။ Download ပြင်ဆင်နေပါတယ်…`); onProgress(99);
    const blob = new Blob([data], { type: 'video/mp4' });
    onStage('Video ဖိုင် အဆင်သင့်ဖြစ်ပါပြီ။'); onProgress(100);
    return blob;
  } finally {
    ff.off?.('progress', onFfProgress);
    // Release the entire FFmpeg WASM instance after each video so memory from a
    // previous render cannot accumulate across consecutive exports.
    for (const entry of await ff.listDir('/').catch(() => [])) {
      if (entry.name !== '.' && entry.name !== '..' && !entry.isDir) {
        try { await ff.deleteFile(entry.name); } catch { /* continue cleanup */ }
      }
    }
    terminateFfmpeg();
    void lastProgress;
  }
}
