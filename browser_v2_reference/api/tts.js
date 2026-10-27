import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const VOICES = {
  'Nilar Neural': 'my-MM-NilarNeural',
  'Thiha Neural': 'my-MM-ThihaNeural'
};

export const config = { maxDuration: 60 };

function runProcess(command, args, options = {}, timeoutMs = 90000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'], ...options });
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => { if (!settled) { child.kill('SIGKILL'); settled = true; reject(new Error(`${command} အချိန်ကုန်သွားပါတယ် (${Math.round(timeoutMs / 1000)}s timeout)`)); } }, timeoutMs);
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); if (stderr.length > 12000) stderr = stderr.slice(-12000); });
    child.on('error', (error) => { if (settled) return; settled = true; clearTimeout(timer); reject(error); });
    child.on('close', (code) => { if (settled) return; settled = true; clearTimeout(timer); code === 0 ? resolve() : reject(new Error(stderr.trim() || `${command} exited with code ${code}`)); });
  });
}

function runPythonEdgeTts(text, voice, mp3Path, timeoutMs = 75000) {
  // Edge TTS only: deliberately no gTTS fallback so every segment keeps the same voice.
  const script = `import asyncio, sys, os\ntext=sys.stdin.read()\nvoice=sys.argv[1]\nout=sys.argv[2]\nimport edge_tts\nasync def edge():\n await edge_tts.Communicate(text, voice=voice, rate='+0%').save(out)\nasyncio.run(edge())\nif not os.path.exists(out) or os.path.getsize(out)<500: raise RuntimeError('Edge TTS returned empty audio')\nprint('TTS_ENGINE=Edge TTS', file=sys.stderr)\n`;
  return new Promise((resolve, reject) => {
    const child = spawn('python', ['-c', script, voice, mp3Path], { stdio: ['pipe', 'ignore', 'pipe'] });
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => { if (!settled) { child.kill('SIGKILL'); settled = true; reject(new Error(`Edge TTS အချိန်ကုန်သွားပါတယ် (${Math.round(timeoutMs / 1000)}s timeout)`)); } }, timeoutMs);
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); if (stderr.length > 12000) stderr = stderr.slice(-12000); });
    child.on('error', (error) => { if (settled) return; settled = true; clearTimeout(timer); reject(error); });
    child.on('close', (code) => {
      if (settled) return; settled = true; clearTimeout(timer);
      if (code === 0) { console.log(`[TTS] Python completed: ${stderr.trim().split('\n').slice(-1)[0] || 'Edge TTS audio generated'}`); resolve(); }
      else reject(new Error(stderr.trim() || `Python Edge TTS exited with code ${code}`));
    });
    child.stdin.end(text, 'utf8');
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  let folder;
  try {
    const { text, voice = 'Nilar Neural', rate = 1.25, leadIn = false } = req.body || {};
    const cleanText = String(text || '').trim();
    const voiceName = VOICES[voice];
    if (!cleanText) return res.status(400).json({ error: 'Text is required.' });
    if (cleanText.length > 1200) return res.status(413).json({ error: 'စာပိုဒ်ရှည်လွန်းပါတယ်။ Subtitle စာကြောင်းတိုတိုနဲ့ ပြန်စမ်းပါ။' });
    if (!voiceName) return res.status(400).json({ error: 'Thiha Neural သို့မဟုတ် Nilar Neural ကို ရွေးပါ။' });

    const speed = Math.max(0.8, Math.min(1.5, Number(rate) || 1.25));
    console.log(`[TTS] request start | voice=${voiceName} | chars=${cleanText.length} | rate=${speed}`);
    folder = await mkdtemp(join(tmpdir(), 'sigyi-tts-'));
    const mp3Path = join(folder, 'voice.mp3');
    const wavPath = join(folder, 'voice.wav');
    await runPythonEdgeTts(cleanText, voiceName, mp3Path);
    const mp3Info = await stat(mp3Path).catch(() => null);
    if (!mp3Info || mp3Info.size < 500) throw new Error('Edge TTS က MP3 အသံမထုတ်ပေးပါ။ Internet သို့မဟုတ် edge-tts ကို စစ်ပါ။');

    // Same processing as bot.py: atempo, high-pass, loudness normalization,
    // 24 kHz mono PCM. The first narration segment gets a 140 ms lead-in.
    const filters = [`atempo=${speed}`, 'highpass=f=70', 'loudnorm=I=-16:TP=-1.5:LRA=11', 'aresample=24000', 'asetpts=PTS-STARTPTS'];
    if (leadIn) filters.push('adelay=140');
    await runProcess('ffmpeg', ['-y', '-loglevel', 'error', '-i', mp3Path, '-af', filters.join(','), '-vn', '-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le', wavPath]);
    const audio = await readFile(wavPath);
    if (audio.length < 1000) throw new Error('FFmpeg က အသံဖိုင်ကို အလွတ်ထုတ်ပေးပါတယ်။');
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Length', String(audio.length));
    console.log(`[TTS] success | voice=${voiceName} | bytes=${audio.length}`);
    return res.status(200).send(audio);
  } catch (error) {
    console.error('[TTS] FAILED:', error?.stack || error);
    return res.status(502).json({ error: `အသံထုတ်မရပါ: ${error?.message || 'Python Edge TTS failed.'}` });
  } finally {
    if (folder) await rm(folder, { recursive: true, force: true }).catch(() => {});
  }
}
