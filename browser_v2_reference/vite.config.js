import { defineConfig } from 'vite';
import ttsHandler from './api/tts.js';

async function handleTts(req, res, next) {
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); return res.end(); }
  if (req.method !== 'POST') return next();
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  let body = {};
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { body = {}; }
  const response = {
    setHeader: (name, value) => res.setHeader(name, value),
    status(code) { res.statusCode = code; return this; },
    json(payload) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(payload)); },
    send(payload) { res.end(payload); },
    end() { res.end(); }
  };
  await ttsHandler({ method: req.method, body }, response);
}


function renderLogMiddleware(req, res, next) {
  if (req.method !== 'POST') return next();
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    let data = {};
    try { data = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { data = { error: 'Could not parse browser diagnostic JSON' }; }
    if (data.type === 'progress') {
      console.log(`[SIGYI FFMPEG-WASM] ${data.progress ?? '?'}% | ${data.stage || 'render'} | ${data.resolution || ''} | ${data.time || ''}`);
    } else {
      console.error('\n========== SIGYI BROWSER RENDER ERROR ==========');
      console.error(JSON.stringify(data, null, 2));
      console.error('========== END SIGYI RENDER ERROR ==============\n');
    }
    res.statusCode = 204;
    res.end();
  });
}

// dev AND `vite preview` both serve /api/tts (preview previously had no endpoint)
const ttsPlugin = {
  name: 'sigyi-tts-api',
  configureServer(server) { server.middlewares.use('/api/tts', handleTts); server.middlewares.use('/api/render-log', renderLogMiddleware); },
  configurePreviewServer(server) { server.middlewares.use('/api/tts', handleTts); server.middlewares.use('/api/render-log', renderLogMiddleware); }
};

export default defineConfig({
  plugins: [ttsPlugin],
  // ffmpeg.wasm single-thread core needs NO SharedArrayBuffer, so no COOP/COEP headers
  optimizeDeps: { exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util', '@ffmpeg/core'] },
  worker: { format: 'es' }
});
