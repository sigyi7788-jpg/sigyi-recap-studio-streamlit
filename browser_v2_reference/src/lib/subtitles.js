// Burmese subtitles are drawn by the browser (correct Myanmar shaping) and overlaid as PNG.
const FONT = '"Noto Sans Myanmar","Padauk","Myanmar Text","Myanmar Sangam MN",sans-serif';

export async function ensureBurmeseFont() {
  try {
    await Promise.all([document.fonts.load(`700 38px ${FONT}`, 'မြန်မာ'), document.fonts.load(`500 38px ${FONT}`, 'မြန်မာ')]);
  } catch { /* system font fallback */ }
}

function graphemes(text) {
  if (window.Intl?.Segmenter) return Array.from(new Intl.Segmenter('my', { granularity: 'grapheme' }).segment(text), (s) => s.segment);
  return Array.from(text);
}

function words(text) {
  if (window.Intl?.Segmenter) {
    const parts = Array.from(new Intl.Segmenter('my', { granularity: 'word' }).segment(text), (s) => s.segment);
    if (parts.length > 1) return parts;
  }
  return text.split(/(\s+)/).filter(Boolean);
}

function wrap(ctx, text, maxWidth) {
  const clusters = graphemes(String(text || '').replace(/\s+/g, ' ').trim());
  const lines = [];
  let line = '';
  for (const cluster of clusters) {
    const candidate = line + cluster;
    if (ctx.measureText(candidate).width <= maxWidth || !line) {
      line = candidate;
      continue;
    }
    // Prefer breaking at the last space, but Burmese without spaces still wraps by grapheme.
    const lastSpace = line.lastIndexOf(' ');
    if (lastSpace > 0) {
      lines.push(line.slice(0, lastSpace).trim());
      line = line.slice(lastSpace + 1) + cluster;
    } else {
      lines.push(line.trim());
      line = cluster.trimStart();
    }
  }
  if (line.trim()) lines.push(line.trim());
  return lines;
}

// Split text into caption pages of at most 2 lines each
export function layoutPages(text, { width = 720, fontSize = 36 } = {}) {
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = `700 ${fontSize}px ${FONT}`;
  const lines = wrap(probe, text, width * 0.88);
  const pages = [];
  for (let i = 0; i < lines.length; i += 2) pages.push(lines.slice(i, i + 2));
  return pages.length ? pages : [[text]];
}

export async function renderSubtitlePng(lines, { width = 720, fontSize = 36, color = '#ffffff', bg = '#111111' } = {}) {
  const canvas = document.createElement('canvas');
  const probe = canvas.getContext('2d');
  probe.font = `700 ${fontSize}px ${FONT}`;
  const lineHeight = Math.round(fontSize * 1.75);
  const padX = 22;
  const padY = 14;
  const textWidth = Math.max(...lines.map((l) => probe.measureText(l).width));
  const boxW = Math.min(width, Math.ceil(textWidth + padX * 2));
  const boxH = lines.length * lineHeight + padY * 2;
  canvas.width = width;
  canvas.height = boxH;
  const ctx = canvas.getContext('2d');
  ctx.font = `700 ${fontSize}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const x = (width - boxW) / 2;
  ctx.fillStyle = bg;
  ctx.globalAlpha = 0.78;
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(x, 0, boxW, boxH, 14) : ctx.rect(x, 0, boxW, boxH);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.lineJoin = 'round';
  ctx.lineWidth = 4;
  ctx.strokeStyle = bg;
  ctx.fillStyle = color;
  lines.forEach((line, i) => {
    const y = padY + lineHeight * i + lineHeight / 2;
    ctx.strokeText(line, width / 2, y);
    ctx.fillText(line, width / 2, y);
  });
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  return { data: new Uint8Array(await blob.arrayBuffer()), height: boxH };
}
