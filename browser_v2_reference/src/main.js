import './styles.css';
import { analyzeVideoWithGemini } from './lib/gemini.js';
import { buildVoiceover } from './lib/tts.js';
import { renderRecap, terminateFfmpeg, getRenderLogs } from './lib/render.js';

const app = document.querySelector('#app');

const steps = [
  { id: 0, en: 'Upload & Recap', mm: 'တင်ပြီး အလိုအလျောက်လုပ်' },
  { id: 3, en: 'Adjust & Filter', mm: 'ပြင်ဆင်' },
  { id: 4, en: 'Render', mm: 'ထုတ်ယူ' }
];

const sampleSegments = [
  { start: 0, end: 4.8, original: 'In the middle of the city stands a door nobody has opened for years.', text: 'မြို့ရဲ့အလယ်မှာ နှစ်ပေါင်းများစွာ မဖွင့်ဖြစ်သေးတဲ့ တံခါးတစ်ချပ် ရှိနေပါတယ်။' },
  { start: 4.8, end: 10.2, original: 'Behind that door hides a secret that not everyone knows.', text: 'အဲဒီတံခါးရဲ့နောက်ကွယ်မှာတော့ လူတိုင်းမသိတဲ့ လျှို့ဝှက်ချက်တစ်ခု ရှိနေခဲ့တယ်။' },
  { start: 10.2, end: 16.7, original: 'He went in alone to find the truth.', text: 'သူက အမှန်တရားကို ရှာဖို့ တစ်ယောက်တည်း ဝင်သွားလိုက်ပါတယ်။' }
];

const sampleRecap = 'မြို့အလယ်က ပိတ်ထားတဲ့ တံခါးဟောင်းတစ်ချပ်နောက်မှာ လူတိုင်းမသိတဲ့ လျှို့ဝှက်ချက်တစ်ခု ရှိနေပါတယ်။ အမှန်တရားကို သိချင်တဲ့သူက အရဲစွန့်ပြီး အဲဒီတံခါးကို ဖွင့်လိုက်တဲ့အချိန်မှာတော့ အရာအားလုံးက မျှော်လင့်ထားတာထက် ပိုပြီး အန္တရာယ်များနေခဲ့ပါတယ်။';

const state = {
  step: 0,
  scriptTab: 'recap',
  captionsOn: true,
  resolution: '720p',
  renderEngine: 'ffmpeg',
  apiKey: sessionStorage.getItem('sigyi-gemini-key') || '',
  file: null,
  videoUrl: '',
  demo: false,
  metadata: null,
  segments: [],
  timeline: [],
  analysisStatus: 'idle',
  analysisProgress: 0,
  analysisStage: '',
  analysisAbort: null,
  analysisError: '',
  voice: 'Nilar Neural',
  voiceSpeed: 1.25,
  voiceStatus: 'idle',
  voiceAudioUrl: '',
  voiceBlob: null,
  voiceProgress: '',
  voiceError: '',
  renderStatus: 'idle',
  renderProgress: 0,
  renderStage: '',
  renderError: '',
  outputUrl: '',
  logoFile: null,
  logoUrl: '',
  logoPosition: 'top-right',
  toast: '',
  modal: '',
  style: {
    topBlur: 8,
    bottomBlur: 10,
    subtitleBlur: 14,
    subY: 66,
    captionY: 73,
    blurStrength: 24,
    flip: false,
    zoom: 1.02,
    fitMode: 'fit',
    subtitleFontSize: 20,
    brightness: 2,
    contrast: 5,
    saturation: 7,
    crop: 'center',
    subtitleColor: '#ffdf3d',
    subtitleBg: '#111111',
    frameColor: '#d6ef47',
    frameWidth: 0,
    filter: 'cinematic'
  }
};

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatTime(seconds = 0) {
  const safe = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60).toString().padStart(2, '0');
  return `${minutes}:${secs}`;
}

function fileSize(bytes = 0) {
  if (!bytes) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit ? 1 : 0)} ${units[unit]}`;
}

function sourceName() {
  if (state.demo) return 'mystery-door-demo.mp4';
  return state.file?.name || 'မရွေးရသေးပါ';
}

function recapText() {
  return state.segments.map((s) => s.text.trim()).filter(Boolean).join(' ');
}

function invalidateVoice() {
  state.voiceToken = (state.voiceToken || 0) + 1;
  state.voiceAbort?.abort();
  if (state.voiceAudioUrl) URL.revokeObjectURL(state.voiceAudioUrl);
  state.voiceAudioUrl = '';
  state.voiceBlob = null;
  state.timeline = [];
  state.voiceError = '';
  state.voiceStatus = 'idle';
}

function setText(selector, value) {
  const el = document.querySelector(selector);
  if (el) el.textContent = value;
}

function render() {
  app.innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand-lockup">
          <div class="brand-mark"><span></span><span></span><span></span></div>
          <div>
            <div class="brand-name">SI GYI</div>
            <div class="brand-sub">RECAP STUDIO</div>
          </div>
        </div>

        <div class="workspace-label">WORKSPACE</div>
        <nav class="side-nav">
          <button class="nav-item active" type="button"><span class="nav-icon">✦</span><span>Recap Studio</span><span class="nav-count">01</span></button>
          <button class="nav-item" type="button"><span class="nav-icon">◫</span><span>My projects</span><span class="nav-count muted">0</span></button>
          <button class="nav-item" type="button"><span class="nav-icon">⌁</span><span>Quick guide</span></button>
        </nav>

        <div class="workspace-label lower-label">PREFERENCES</div>
        <nav class="side-nav">
          <button class="nav-item" type="button" data-action="open-key"><span class="nav-icon">⌘</span><span>Gemini API key</span><span class="key-dot ${state.apiKey ? 'ready' : ''}"></span></button>
          <button class="nav-item" type="button"><span class="nav-icon">◌</span><span>Settings</span></button>
        </nav>

        <div class="sidebar-bottom">
          <div class="local-card">
            <div class="local-orbit"><span></span></div>
            <div>
              <strong>Local mode</strong>
              <p>သင့်ဖုန်းထဲမှာပဲ<br />ပြင်ဆင်ပြီး render လုပ်မယ်</p>
            </div>
          </div>
          <div class="profile-chip"><div class="profile-avatar">SG</div><div><strong>Si Gyi creator</strong><small>Free workspace</small></div><span>•••</span></div>
        </div>
      </aside>

      <main class="main-content">
        <header class="topbar">
          <div class="mobile-brand"><div class="brand-mark small"><span></span><span></span><span></span></div><span>SI GYI</span></div>
          <div class="breadcrumb"><span>Studio</span><b>/</b><strong>${steps.find((item) => item.id === state.step)?.en || 'Studio'}</strong></div>
          <div class="top-actions">
            <div class="privacy-chip"><span class="status-dot"></span> Browser-only processing</div>
            <button class="icon-button" type="button" data-action="open-key" aria-label="Gemini API key">⌘</button>
            <button class="avatar-button" type="button">SG</button>
          </div>
        </header>

        <div class="content-wrap">
          <section class="page-heading">
            <div>
              <div class="eyebrow"><span class="eyebrow-line"></span> BURMESE VIDEO WORKFLOW <span class="beta-pill">BETA</span></div>
              <h1>One click.<br /><em>One Burmese recap.</em></h1>
              <p>ဗီဒီယိုတင်ပြီး Generate Recap တစ်ချက်နှိပ်ပါ။ Script၊ မြန်မာအသံနဲ့ စာတန်းကို အလိုအလျောက် ပြင်ဆင်ပေးမယ်။</p>
            </div>
            <div class="heading-actions">
              <button class="text-button" type="button" data-action="open-key"><span class="key-symbol">⌘</span>${state.apiKey ? 'Key connected' : 'Connect Gemini key'}</button>
              <button class="outline-button" type="button" data-action="load-demo"><span>◉</span> Try a sample</button>
            </div>
          </section>

          <div class="flow-tabs">
            ${steps.map((step) => `
              <button class="flow-tab ${state.step === step.id ? 'active' : ''} ${state.step > step.id ? 'done' : ''}" type="button" data-step="${step.id}">
                <span class="tab-number">${state.step > step.id ? '✓' : `0${step.id + 1}`}</span>
                <span><strong>${step.en}</strong><small>${step.mm}</small></span>
              </button>
            `).join('')}
          </div>

          <div class="workspace-grid">
            <section class="stage-panel">
              ${stageMarkup()}
            </section>
            <aside class="right-rail">
              ${railMarkup()}
            </aside>
          </div>
        </div>
      </main>

      <nav class="mobile-nav"><button class="active">✦<span>Studio</span></button><button>◫<span>Projects</span></button><button data-action="open-key">⌘<span>API Key</span></button><button>◌<span>Settings</span></button></nav>
      ${modalMarkup()}
    </div>
  `;
  bindEvents();
}

function stageMarkup() {
  if (state.step === 0) return sourceStage();
  if (state.step === 3) return styleStage();
  return renderStage();
}

function sourceStage() {
  const ready = Boolean(state.file || state.demo);
  return `
    <div class="stage-header">
      <div><div class="stage-kicker">STEP 01 / SOURCE</div><h2>Start with a scene.</h2><p>ဗီဒီယိုဖိုင်ကို ရွေးပြီး AI recap workflow ကို စတင်ပါ။</p></div>
      <div class="stage-badge"><span class="badge-dot"></span> ${ready ? 'Ready to analyze' : 'Waiting for video'}</div>
    </div>
    ${ready ? `
      <div class="source-ready">
        <div class="video-shell source-video-shell">
          ${state.demo ? `<div class="demo-frame"><div class="demo-glow"></div><div class="demo-door">◈</div><span>DEMO SCENE</span></div>` : `<video id="source-video" src="${state.videoUrl}" controls playsinline></video>`}
          <div class="video-corner-tag">${state.demo ? 'SAMPLE' : 'SOURCE'} · ${state.metadata?.type?.split('/')[1]?.toUpperCase() || 'MP4'}</div>
        </div>
        <div class="source-details">
          <div class="file-title"><div class="file-icon">▣</div><div><strong>${escapeHtml(sourceName())}</strong><span>${state.demo ? 'Built-in sample scene' : `${fileSize(state.metadata?.size)} · ${state.metadata?.type || 'video file'}`}</span></div><button class="mini-icon" type="button" data-action="reset" aria-label="Remove video">×</button></div>
          <div class="ready-callout"><span>✓</span><div><strong>Ready for Gemini upload</strong><p>Generate Recap နှိပ်တဲ့အခါ Gemini က video ကိုဖတ်ပြီး Burmese recap script နဲ့ အသံကို အလိုအလျောက် ထုတ်ပေးပါမယ်။ (ကြီးတဲ့ video ဆိုရင် upload လုပ်ပြီး ပြီးတာနဲ့ auto-delete)</p></div></div>
          <div class="upload-preflight">
            <div class="control-heading"><span>PREPARE VOICE & STYLE WHILE ANALYZING</span><span class="control-sub">မူလ Render ကို မထိခိုက်စေပါ</span></div>
            <div class="upload-preflight-grid">
              <div class="upload-preflight-voice"><span class="mini-label">EDGE TTS VOICE</span><div class="voice-option-list compact-voice-list">${[{name:'Nilar Neural',meta:'မြန်မာ အမျိုးသမီးအသံ',avatar:'N'},{name:'Thiha Neural',meta:'မြန်မာ အမျိုးသားအသံ',avatar:'T'}].map((v)=>`<button class="voice-option ${state.voice===v.name?'active':''}" type="button" data-voice="${v.name}"><span class="voice-avatar">${v.avatar}</span><span><strong>${v.name}</strong><small>${v.meta}</small></span><span class="voice-radio">${state.voice===v.name?'✓':''}</span></button>`).join('')}</div>
                <label class="range-control"><span>Voice speed</span><input type="range" min="0.8" max="1.5" step="0.05" value="${state.voiceSpeed}" data-voice-speed aria-label="Voice speed" /><output>${state.voiceSpeed.toFixed(2)}×</output></label>
              </div>
              <div class="upload-preflight-style"><span class="mini-label">QUICK STYLE + LIVE PREVIEW</span>
                <label class="range-control"><span>Style</span><select data-style-filter><option value="natural" ${state.style.filter==='natural'?'selected':''}>Natural</option><option value="cinematic" ${state.style.filter==='cinematic'?'selected':''}>Soft cinematic</option><option value="vivid" ${state.style.filter==='vivid'?'selected':''}>Vivid</option><option value="mono" ${state.style.filter==='mono'?'selected':''}>Black & white</option></select></label>
                <label class="range-control"><span>Original subtitle blur</span><input type="range" data-style="subtitleBlur" min="0" max="25" step="1" value="${state.style.subtitleBlur}" /><output data-suffix="%">${state.style.subtitleBlur}%</output></label>
                <label class="range-control"><span>Myanmar caption position</span><input type="range" data-style="captionY" min="40" max="95" step="1" value="${state.style.captionY}" /><output data-suffix="%">${state.style.captionY}%</output></label>
                <label class="range-control"><span>Video frame</span><select data-fit-mode><option value="fit" ${state.style.fitMode==='fit'?'selected':''}>Fit phone frame</option><option value="fill" ${state.style.fitMode==='fill'?'selected':''}>Fill / crop</option></select></label>
              </div>
            </div>
            <div class="editor-canvas source-style-canvas"><div class="blur-band top"></div>${state.demo ? `<div class="demo-frame editor-demo"><div class="demo-glow"></div><div class="demo-door">◈</div><span>DEMO SCENE</span></div>` : `<video class="editor-video" src="${state.videoUrl}" muted playsinline></video>`}<div class="subtitle-blur"></div><div class="subtitle-preview">${escapeHtml(previewCaption())}</div><div class="blur-band bottom"></div></div>
          </div>
          <div class="source-stats"><div><span>FORMAT</span><strong>${state.metadata?.type?.split('/')[1]?.toUpperCase() || 'MP4'}</strong></div><div><span>SIZE</span><strong>${state.demo ? '24.8 MB' : fileSize(state.metadata?.size)}</strong></div><div><span>LIMIT</span><strong>≤ 10 min</strong></div></div>
          <button class="primary-button wide ${state.analysisStatus === 'working' ? 'is-loading' : ''}" type="button" data-action="analyze" ${state.analysisStatus === 'working' ? 'disabled aria-busy="true"' : ''}><span class="button-spark">${state.analysisStatus === 'working' ? '◌' : '✦'}</span> ${state.analysisStatus === 'working' ? 'Recap + အသံ ထုတ်နေပါတယ်…' : 'Generate Recap'} <span class="button-arrow">→</span></button>
          ${state.analysisStatus === 'working' ? analysisProgressMarkup() : ''}
          ${state.analysisError ? `<div class="inline-error">${escapeHtml(state.analysisError)}</div>` : ''}
        </div>
      </div>
      <div class="privacy-note"><span>◉</span><span><strong>Temporary processing.</strong> Gemini Files API သို့ temporary upload လုပ်ပြီး transcript/recap ပြီးတာနဲ့ file ကို auto-delete လုပ်ပါမယ်။ Si Gyi server မှာ မသိမ်းပါ။</span></div>
    ` : `
      <div class="dropzone" id="dropzone">
        <input id="video-input" type="file" accept="video/*" hidden />
        <div class="upload-orbit"><div class="upload-arrow">↑</div></div>
        <h3>Drop your video here</h3>
        <p>သို့မဟုတ် ဖုန်းထဲက video file ကို ရွေးပါ</p>
        <button class="primary-button" type="button" data-action="pick-video">Choose video <span class="button-arrow">→</span></button>
        <div class="drop-meta"><span>MP4</span><span>MOV</span><span>WEBM</span><i></i><span>အများဆုံး 10 မိနစ်အကြံပြု</span></div>
      </div>
      <div class="link-ingest-card"><div><span class="link-icon">↗</span><div><strong>Use a direct video URL</strong><small>YouTube/TikTok/Rednote page link မဟုတ်ဘဲ CORS ခွင့်ပြုထားတဲ့ .mp4/.webm URL ဖြစ်ရပါမယ်။</small></div></div><div class="link-ingest-row"><input id="source-link" type="url" placeholder="https://cdn.example.com/video.mp4" /><button class="outline-button" type="button" data-action="load-link">Use link</button></div></div>
      <div class="source-feature-row"><div><span class="feature-icon">◈</span><strong>AI transcript</strong><small>အသံကို စာသားအဖြစ် ဖတ်မယ်</small></div><div><span class="feature-icon">≈</span><strong>Burmese recap</strong><small>နားထောင်ရလွယ်အောင် ပြန်ရေးမယ်</small></div><div><span class="feature-icon">⌁</span><strong>Local render</strong><small>ဖိုင်ကို browser ထဲမှာပဲထားမယ်</small></div></div>
    `}
    <div class="tip-banner"><span class="tip-icon">i</span><span><strong>Phone tip</strong> ဖုန်း browser memory သက်သာအောင် 10 မိနစ်အောက် video ကို သုံးပါ။ Chrome / Safari အသစ်ကို အကြံပြုပါတယ်။</span></div>
  `;
}

function analysisProgressMarkup() {
  return `<div class="analysis-progress-card"><div class="analysis-progress-head"><div><strong>Gemini is working</strong><span id="analysis-stage">${escapeHtml(state.analysisStage || 'Analysis စတင်နေပါတယ်…')}</span></div><b id="analysis-pct">${Math.round(state.analysisProgress)}%</b></div><div class="analysis-progress-track"><i id="analysis-bar" style="width:${state.analysisProgress}%"></i><span class="progress-glow"></span></div><div class="analysis-progress-foot"><span><i class="live-dot"></i> Request active · ခဏစောင့်ပါ</span><button class="text-button danger" type="button" data-action="cancel-analysis">Cancel</button></div></div>`;
}

function setAnalysisUI(stage, pct) {
  if (stage) state.analysisStage = stage;
  if (pct != null) state.analysisProgress = pct;
  setText('#analysis-stage', state.analysisStage);
  setText('#analysis-pct', `${Math.round(state.analysisProgress)}%`);
  const bar = document.querySelector('#analysis-bar');
  if (bar) bar.style.width = `${state.analysisProgress}%`;
}

function scriptStage() {
  const hasData = state.segments.length > 0;
  const rows = state.segments;
  const recapRows = rows.map((segment, index) => `<div class="transcript-row seg-row"><div class="segment-time"><input class="time-input" type="number" min="0" step="0.1" value="${segment.start}" data-seg-time="${index}:start" aria-label="Start seconds" /><input class="time-input" type="number" min="0" step="0.1" value="${segment.end}" data-seg-time="${index}:end" aria-label="End seconds" /></div><textarea data-seg-text="${index}" placeholder="မြန်မာ စာသား">${escapeHtml(segment.text)}</textarea><button class="segment-play" type="button" data-seg-del="${index}" aria-label="Delete line">×</button></div>`).join('');
  const originalRows = rows.map((segment, index) => `<div class="transcript-row"><div class="segment-time">${formatTime(segment.start)}<span>—</span>${formatTime(segment.end)}</div><textarea data-seg-orig="${index}" placeholder="မူရင်းစကား">${escapeHtml(segment.original || '')}</textarea><span></span></div>`).join('');
  return `
    <div class="stage-header compact"><div><div class="stage-kicker">STEP 02 / SCRIPT</div><h2>Find the story inside.</h2><p>Gemini က ဖတ်ထားတဲ့ transcript နဲ့ မြန်မာ recap ကို စစ်ပြီး ပြင်နိုင်ပါတယ်။</p></div><div class="stage-badge success"><span class="badge-dot"></span> ${hasData ? `${rows.length} lines ready` : 'Awaiting analysis'}</div></div>
    <div class="script-layout">
      <div class="script-preview-col">
        <div class="mini-label">SOURCE PREVIEW</div>
        <div class="video-shell script-video-shell">${state.demo ? `<div class="demo-frame"><div class="demo-glow"></div><div class="demo-door">◈</div><span>DEMO SCENE</span></div>` : state.videoUrl ? `<video src="${state.videoUrl}" controls playsinline></video>` : `<div class="empty-preview"><span>▣</span><small>ဗီဒီယို preview မရှိသေးပါ</small></div>`}<div class="video-corner-tag">${state.metadata?.duration ? formatTime(state.metadata.duration) : '0:00'}</div></div>
        <div class="script-note"><span>✦</span> အချိန်တွေက video ထဲက စကားပြောတဲ့ နေရာနဲ့ ချိတ်ထားပါတယ်။ Voice ထုတ်ပြီးရင် subtitle timing ကို voiceover နဲ့ အတိအကျ ပြန်ညှိပေးပါမယ်။</div>
      </div>
      <div class="script-editor-col">
        <div class="editor-tabs"><button class="${state.scriptTab === 'recap' ? 'active' : ''}" type="button" data-script-tab="recap"><span>✦</span> Burmese recap <em>${rows.length} lines</em></button><button class="${state.scriptTab === 'transcript' ? 'active' : ''}" type="button" data-script-tab="transcript"><span>≋</span> Original transcript <em>${rows.length} lines</em></button></div>
        <div class="transcript-list">${hasData ? (state.scriptTab === 'recap' ? recapRows : originalRows) : '<div class="empty-preview"><small>Source step မှာ Analyze with Gemini နှိပ်ပါ</small></div>'}</div>
        <div class="editor-footer"><span><b>${recapText().length}</b> characters · Burmese Unicode</span><span><button class="tiny-action" type="button" data-action="add-segment">＋ Add line</button> <button class="tiny-action" type="button" data-action="regenerate">↻ Re-analyze</button></span></div>
      </div>
    </div>
    <div class="stage-footer"><button class="secondary-button" type="button" data-step="0">← Back</button><button class="primary-button" type="button" data-step="2">Continue to voice <span class="button-arrow">→</span></button></div>
  `;
}

function voiceStage() {
  const voiceOptions = [
    { name: 'Nilar Neural', meta: 'my-MM · Edge TTS · Clear, gentle', avatar: 'N' },
    { name: 'Thiha Neural', meta: 'my-MM · Edge TTS · Warm, grounded', avatar: 'T' }
  ];
  return `
    <div class="stage-header compact"><div><div class="stage-kicker">STEP 03 / VOICE</div><h2>Give it a voice.</h2><p>Edge TTS MP3 ကို generate လုပ်ပြီး final render ထဲမှာ voiceover အဖြစ် mux လုပ်မယ်။</p></div><div class="stage-badge ${state.voiceStatus === 'ready' || state.voiceStatus === 'previewed' ? 'success' : ''}"><span class="badge-dot"></span> ${state.voiceStatus === 'generating' ? 'Generating audio' : state.voiceStatus === 'ready' ? 'Audio ready' : state.voiceStatus === 'previewed' ? 'Preview played' : 'Voice ready'}</div></div>
    <div class="voice-layout">
      <div class="voice-main-card">
        <div class="voice-card-top"><div><div class="mini-label">EDGE TTS AUDIO</div><h3>${state.voice}</h3><span class="voice-meta">my-MM · MP3 voiceover · ${state.voiceSpeed.toFixed(2)}×</span></div><div class="voice-face">◌</div></div>
        <div class="waveform">${Array.from({ length: 52 }, (_, index) => `<i style="height:${18 + ((index * 17) % 48)}%"></i>`).join('')}</div>
        <div class="audio-controls"><button class="play-button" type="button" data-action="speak" ${state.voiceStatus === 'generating' ? 'disabled' : ''}>${state.voiceStatus === 'previewing' ? '■' : '▶'}</button><div class="audio-progress"><div class="progress-fill" style="width:${state.voiceProgressPct || (state.voiceAudioUrl ? 100 : 0)}%"></div></div><span id="voice-label">${state.voiceStatus === 'generating' ? `Generating… ${state.voiceProgressPct || 0}% · ${state.voiceProgress}` : state.voiceAudioUrl ? `Voice ready · ${state.timeline.length} lines` : 'Tap to generate'}</span></div>${state.voiceStatus === 'generating' ? `<div class="voice-progress-track"><i id="voice-progress-bar" style="width:${state.voiceProgressPct || 0}%"></i></div>` : ''}${state.voiceAudioUrl ? `<audio id="voice-audio" src="${escapeHtml(state.voiceAudioUrl)}" controls preload="metadata"></audio>` : ''}
        <div class="voice-script"><span class="quote-mark">“</span><p>${escapeHtml(recapText() || sampleRecap)}</p></div>
        <div class="browser-voice-note"><span>◎</span><div><strong>Final voiceover enabled</strong><p>စာကြောင်းတစ်ကြောင်းချင်း Edge TTS နဲ့ အသံသွင်းပြီး scene အချိန်အတိုင်း ချိန်ညှိပါမယ်။ မူရင်း video audio ကို mute လုပ်ပါမယ်။</p></div></div>
        ${state.voiceError ? `<div class="inline-error">${escapeHtml(state.voiceError)}</div>` : ''}
      </div>
      <div class="voice-picker"><div class="mini-label">CHOOSE A VOICE</div><div class="voice-option-list">${voiceOptions.map((voice) => `<button class="voice-option ${state.voice === voice.name ? 'active' : ''}" type="button" data-voice="${voice.name}"><span class="voice-avatar">${voice.avatar}</span><span><strong>${voice.name}</strong><small>${voice.meta}</small></span><span class="voice-radio">${state.voice === voice.name ? '✓' : ''}</span></button>`).join('')}</div><div class="voice-settings"><div><span>Speed</span><strong>${state.voiceSpeed.toFixed(2)}×</strong></div><input type="range" min="0.8" max="1.5" step="0.05" value="${state.voiceSpeed}" data-voice-speed aria-label="Voice speed" /></div><button class="outline-button wide" type="button" data-action="retry-voice">↻ Refresh voice availability</button></div>
    </div>
    <div class="stage-footer"><button class="secondary-button" type="button" data-step="1">← Back</button><button class="primary-button" type="button" data-step="3">Continue to style <span class="button-arrow">→</span></button></div>
  `;
}

function previewFilter() {
  const preset = state.style.filter === 'vivid' ? 'saturate(1.16) contrast(1.05)' : state.style.filter === 'cinematic' ? 'saturate(0.94) contrast(1.04)' : state.style.filter === 'mono' ? 'grayscale(1) contrast(1.04)' : 'none';
  return `brightness(${100 + state.style.brightness / 2}%) contrast(${100 + state.style.contrast}%) saturate(${100 + state.style.saturation}%) ${preset}`;
}

function previewCaption() {
  const first = state.segments.find((s) => s.text.trim());
  return first ? first.text.trim() : 'မြန်မာ subtitle ဒီနေရာမှာ ပေါ်မယ်';
}

// update the live preview WITHOUT re-rendering the whole app (keeps slider drags smooth)
function applyPreview() {
  const st = state.style;
  const canvas = document.querySelector('.editor-canvas');
  if (!canvas) return;
  canvas.style.border = st.frameWidth ? `${st.frameWidth}px solid ${st.frameColor}` : 'none';
  const blur = `blur(${Math.max(2, st.blurStrength * 0.45)}px)`;
  const band = (el, css) => { if (!el) return; Object.assign(el.style, css, { background: 'transparent', backdropFilter: blur, webkitBackdropFilter: blur }); };
  band(canvas.querySelector('.blur-band.top'), { height: `${st.topBlur}%`, display: st.topBlur > 0 ? 'block' : 'none', opacity: 1 });
  band(canvas.querySelector('.blur-band.bottom'), { height: `${st.bottomBlur}%`, display: st.bottomBlur > 0 ? 'block' : 'none', opacity: 1 });
  band(canvas.querySelector('.subtitle-blur'), { height: `${st.subtitleBlur}%`, top: `${st.subY}%`, bottom: 'auto', display: st.subtitleBlur > 0 ? 'block' : 'none', opacity: 1 });
  const media = canvas.querySelector('.editor-video, .editor-demo');
  if (media) {
    media.style.filter = previewFilter();
    media.style.transform = `scale(${st.zoom}) ${st.flip ? 'scaleX(-1)' : ''}`;
    media.style.objectFit = st.fitMode === 'fit' ? 'contain' : 'cover';
    media.style.background = '#080a0b';
    media.style.objectPosition = st.crop === 'left' ? '0% 50%' : st.crop === 'right' ? '100% 50%' : '50% 50%';
  }
  const cap = canvas.querySelector('.subtitle-preview');
  if (cap) {
    cap.style.top = `${Number(st.captionY ?? (st.subY + st.subtitleBlur / 2))}%`;
    cap.style.bottom = 'auto';
    cap.style.transform = 'translateY(-50%)';
    cap.style.display = state.captionsOn ? 'block' : 'none';
    cap.style.color = st.subtitleColor;
    cap.style.background = `${st.subtitleBg}c7`;
    cap.style.textShadow = '-1px -1px 0 #111, 1px -1px 0 #111, -1px 1px 0 #111, 1px 1px 0 #111';
    cap.style.fontSize = `${12 * (Number(st.subtitleFontSize || 20) / 20)}px`;
    cap.style.padding = '3px 9px';
    cap.style.borderRadius = '6px';
    cap.style.width = 'auto';
    cap.style.maxWidth = '88%';
    cap.style.left = '50%';
    cap.style.marginLeft = '0';
    cap.style.transform = 'translate(-50%, -50%)';
  }
}

function styleStage() {
  return `
    <div class="stage-header compact"><div><div class="stage-kicker">STEP 02 / ADJUST & FILTER</div><h2>Make it yours.</h2><p>Recap script နဲ့ အသံကို အလိုအလျောက် ထုတ်ပြီးပါပြီ။ လိုချင်ရင် crop, filter, adjust ကို အနည်းငယ်ပြင်ပြီး Render နှိပ်ပါ။</p></div><div class="stage-badge ${state.voiceStatus === 'ready' ? 'success' : ''}"><span class="badge-dot"></span> ${state.voiceStatus === 'generating' ? 'Voice generating' : state.voiceStatus === 'error' ? 'Voice error' : 'Live preview'}</div></div>
    ${state.voiceStatus === 'generating' ? `<div class="auto-voice-progress"><div class="progress-head"><span>Script + Thiha/Nilar အသံကို အလိုအလျောက် ပြင်ဆင်နေပါတယ်…</span><strong id="voice-pct">${state.voiceProgressPct || 0}%</strong></div><div class="big-progress"><i id="voice-progress-bar" style="width:${state.voiceProgressPct || 0}%"></i></div><small id="voice-label">${escapeHtml(state.voiceProgress || 'စတင်နေပါတယ်')}</small></div>` : ''}
    ${state.voiceStatus === 'error' ? `<div class="inline-error large">${escapeHtml(state.voiceError)} <button class="outline-button" type="button" data-action="retry-voice">အသံပြန်ထုတ်ရန်</button></div>` : ''}
    <div class="control-section voice-choice-section"><div class="control-heading"><span>VOICEOVER</span><span class="control-sub">Bot နဲ့တူတဲ့ Edge TTS</span></div><div class="voice-picker"><div class="voice-option-list">${[{ name: 'Nilar Neural', meta: 'မြန်မာ အမျိုးသမီးအသံ', avatar: 'N' }, { name: 'Thiha Neural', meta: 'မြန်မာ အမျိုးသားအသံ', avatar: 'T' }].map((voice) => `<button class="voice-option ${state.voice === voice.name ? 'active' : ''}" type="button" data-voice="${voice.name}"><span class="voice-avatar">${voice.avatar}</span><span><strong>${voice.name}</strong><small>${voice.meta}</small></span><span class="voice-radio">${state.voice === voice.name ? '✓' : ''}</span></button>`).join('')}</div><div class="voice-settings"><div><span>အသံအမြန်နှုန်း</span><strong>${state.voiceSpeed.toFixed(2)}×</strong></div><input type="range" min="0.8" max="1.5" step="0.05" value="${state.voiceSpeed}" data-voice-speed aria-label="Voice speed" /></div><button class="outline-button wide" type="button" data-action="retry-voice">↻ ရွေးထားတဲ့အသံကို ပြန်ထုတ်ရန်</button></div></div><div class="style-layout">
      <div class="editor-canvas-wrap"><div class="canvas-toolbar"><span class="mini-label">9:16 SHORT-FORM PREVIEW</span><div><button class="canvas-icon ${state.style.flip ? 'active' : ''}" type="button" data-action="flip" title="Flip horizontally">⇆</button><button class="canvas-icon" type="button" data-action="fit" title="Reset fit">⛶</button></div></div><div class="editor-canvas"><div class="blur-band top"></div>${state.demo ? `<div class="demo-frame editor-demo"><div class="demo-glow"></div><div class="demo-door">◈</div><span>DEMO SCENE</span></div>` : state.videoUrl ? `<video class="editor-video" src="${state.videoUrl}" controls playsinline muted></video>` : `<div class="empty-preview"><span>▣</span><small>Source step မှာ video ရွေးပါ</small></div>`}<div class="subtitle-blur"></div><div class="subtitle-preview">${escapeHtml(previewCaption())}</div><div class="blur-band bottom"></div></div><div class="canvas-footer"><span><i class="green-dot"></i> Preview synced with render</span><span>${state.resolution === '360p' ? '18 FPS' : state.resolution === '720p' ? '20 FPS · Fast' : '24 FPS'} · ${state.resolution === '1080p' ? '1080×1920' : state.resolution === '720p' ? '720×1280' : '360×640'} · ${formatTime(state.metadata?.duration || 16)}</span></div></div>
      <div class="controls-panel"><div class="control-section"><div class="control-heading"><span>BLUR LAYERS</span><button class="reset-link" type="button" data-action="reset-blur">Reset</button></div>${rangeControl('Top blur height', 'topBlur', state.style.topBlur, 0, 30, '%')} ${rangeControl('Bottom blur height', 'bottomBlur', state.style.bottomBlur, 0, 30, '%')} ${rangeControl('Subtitle area height', 'subtitleBlur', state.style.subtitleBlur, 0, 25, '%')} ${rangeControl('Original subtitle blur position', 'subY', state.style.subY, 40, 92, '%')} ${rangeControl('Myanmar caption exact position', 'captionY', state.style.captionY, 40, 95, '%')} ${rangeControl('Subtitle text size', 'subtitleFontSize', state.style.subtitleFontSize, 14, 28, ' px')} ${rangeControl('Blur strength', 'blurStrength', state.style.blurStrength, 4, 40, '')}</div><div class="control-section"><div class="control-heading"><span>FILTER</span><span class="control-sub">Subtle look</span></div><label class="range-control"><span>Color preset</span><select data-style-filter><option value="natural" ${state.style.filter === 'natural' ? 'selected' : ''}>Natural</option><option value="cinematic" ${state.style.filter === 'cinematic' ? 'selected' : ''}>Soft cinematic</option><option value="vivid" ${state.style.filter === 'vivid' ? 'selected' : ''}>Vivid</option><option value="mono" ${state.style.filter === 'mono' ? 'selected' : ''}>Black & white</option></select></label><label class="range-control"><span>Video framing</span><select data-fit-mode><option value="fit" ${state.style.fitMode === 'fit' ? 'selected' : ''}>Fit phone frame (show full video)</option><option value="fill" ${state.style.fitMode === 'fill' ? 'selected' : ''}>Fill frame (crop edges)</option></select></label>${rangeControl('Small zoom', 'zoom', state.style.zoom, 1, 1.12, '×', 0.01)} ${rangeControl('Brightness', 'brightness', state.style.brightness, -20, 20, '%')} ${rangeControl('Contrast', 'contrast', state.style.contrast, -20, 20, '%')} ${rangeControl('Saturation', 'saturation', state.style.saturation, -20, 20, '%')}</div><div class="control-section crop-section"><div class="control-heading"><span>CROP FRAMING</span><span class="control-sub">9:16 focus</span></div><div class="crop-buttons"><button class="crop-button ${state.style.crop === 'left' ? 'active' : ''}" type="button" data-crop="left">Left</button><button class="crop-button ${state.style.crop === 'center' ? 'active' : ''}" type="button" data-crop="center">Center</button><button class="crop-button ${state.style.crop === 'right' ? 'active' : ''}" type="button" data-crop="right">Right</button></div></div><div class="control-section resolution-section"><div class="control-heading"><span>EXPORT QUALITY</span><span class="control-sub">MP4 resolution</span></div><label class="range-control"><span>Output resolution</span><select data-resolution><option value="360p" ${state.resolution === '360p' ? 'selected' : ''}>360p · Fastest</option><option value="720p" ${state.resolution === '720p' ? 'selected' : ''}>720p · Recommended</option><option value="1080p" ${state.resolution === '1080p' ? 'selected' : ''}>1080p · High quality</option></select></label><small class="resolution-note">720p ကို ပုံမှန်သုံးပါ။ 1080p က ပိုကြာပြီး memory ပိုသုံးနိုင်ပါတယ်။</small></div><div class="caption-toggle"><div><span class="caption-icon">Aa</span><div><strong>Burn Burmese captions</strong><small>Voiceover timing အတိုင်း render ထဲထည့်မယ်</small></div></div><button class="toggle ${state.captionsOn ? 'on' : 'off'}" type="button" data-action="toggle-captions"><span></span></button></div><div class="control-section color-section"><div class="control-heading"><span>CAPTION & FRAME</span><span class="control-sub">Customize</span></div><div class="color-grid"><label>Text color<input type="color" data-style-color="subtitleColor" value="${state.style.subtitleColor}" /></label><label>Caption box<input type="color" data-style-color="subtitleBg" value="${state.style.subtitleBg}" /></label><label>Frame color<input type="color" data-style-color="frameColor" value="${state.style.frameColor}" /></label></div>${rangeControl('Frame width', 'frameWidth', state.style.frameWidth, 0, 18, 'px')}</div><div class="control-section logo-section"><div class="control-heading"><span>BRAND LOGO</span><span class="control-sub">Optional PNG / JPG / WebP</span></div><input id="logo-input" type="file" accept="image/png,image/jpeg,image/webp,image/*" hidden /><div class="logo-picker-row">${state.logoUrl ? `<img class="logo-thumb" src="${state.logoUrl}" alt="Selected logo" />` : `<span class="logo-thumb-placeholder">LOGO</span>`}<div class="logo-picker-copy"><strong>${state.logoFile ? escapeHtml(state.logoFile.name) : 'Logo မရွေးရသေးပါ'}</strong><small>Render video ပေါ်မှာ logo ထည့်နိုင်ပါတယ်။</small></div><button class="outline-button" type="button" data-action="pick-logo">${state.logoFile ? 'Change' : 'Choose logo'}</button>${state.logoFile ? '<button class="text-button danger" type="button" data-action="remove-logo">×</button>' : ''}</div><label class="range-control"><span>Logo position</span><select data-logo-position><option value="top-right" ${state.logoPosition === 'top-right' ? 'selected' : ''}>Top right</option><option value="top-left" ${state.logoPosition === 'top-left' ? 'selected' : ''}>Top left</option><option value="bottom-right" ${state.logoPosition === 'bottom-right' ? 'selected' : ''}>Bottom right</option><option value="bottom-left" ${state.logoPosition === 'bottom-left' ? 'selected' : ''}>Bottom left</option></select></label></div></div>
    </div>
    <div class="stage-footer"><button class="secondary-button" type="button" data-step="0">← Change video</button><button class="primary-button render-button" type="button" data-action="render" ${state.voiceStatus === 'generating' ? 'disabled' : ''}><span class="button-spark">✦</span> Render MP4 <span class="button-arrow">→</span></button></div>
  `;
}

function rangeControl(label, key, value, min, max, suffix, step = 1) {
  const display = key === 'zoom' ? Number(value).toFixed(2) : Math.round(value);
  return `<label class="range-control"><span>${label}</span><input type="range" data-style="${key}" min="${min}" max="${max}" step="${step}" value="${value}" /><output data-suffix="${suffix}">${display}${suffix}</output></label>`;
}

function renderStage() {
  const isRendering = state.renderStatus === 'working';
  const complete = state.renderStatus === 'complete';
  return `
    <div class="stage-header compact"><div><div class="stage-kicker">STEP 05 / RENDER</div><h2>${complete ? 'Your recap is ready.' : 'Ready for the final cut?'}</h2><p>${complete ? 'Download လုပ်ပြီး သင့် channel မှာ share လုပ်နိုင်ပါပြီ။' : 'ဖုန်း browser ထဲမှာပဲ scene, voice နဲ့ Burmese captions ကို ပေါင်းစပ်မယ်။'}</p></div><div class="stage-badge ${complete ? 'success' : ''}"><span class="badge-dot"></span> ${complete ? 'Export complete' : isRendering ? 'Rendering locally' : 'Review ready'}</div></div>
    ${complete ? `<div class="result-layout"><div class="result-video-shell video-shell">${state.outputUrl ? `<video src="${state.outputUrl}" controls playsinline></video>` : `<div class="render-placeholder"><span>✓</span></div>`}<div class="video-corner-tag">FINAL · MP4</div></div><div class="result-details"><div class="result-kicker">FINAL RECAP</div><h3>${escapeHtml(sourceName().replace(/\.[^/.]+$/, ''))}</h3><p>မြန်မာ recap · Scene-synced voiceover · Burmese captions${state.logoFile ? ' · Logo overlay' : ''}</p><div class="preview-before-download">▶ Download မလုပ်ခင် ဒီနေရာက video preview ကို အရင်ကြည့်ပါ။</div><div class="result-meta"><span><b>9:16</b> format</span><span><b>${state.resolution}</b> export</span><span><b>MP4</b> export</span></div><a class="primary-button wide download-button" href="${state.outputUrl || '#'}" download="sigyi-recap.mp4" data-action="download"><span>↓</span> Preview ပြီး Download MP4 <span class="button-arrow">→</span></a><button class="outline-button wide" type="button" data-action="reset">＋ Start another recap</button></div></div>` : `<div class="render-review"><div class="review-card"><div class="review-icon">✦</div><div><strong>One local render</strong><p>Video/audio ကို ဒီ device ထဲမှာပဲ ထိန်းထားပြီး transcript text ပဲ recap အတွက် အသုံးပြုမယ်။</p></div><span class="review-check">✓</span></div><div class="review-list"><div><span class="review-thumb">▣</span><span><strong>Source video</strong><small>${escapeHtml(sourceName())}</small></span><b>✓</b></div><div><span class="review-thumb purple">✦</span><span><strong>Burmese voice preview</strong><small>${state.voice} · ${state.voiceAudioUrl ? 'Edge TTS voiceover ready' : 'Render လုပ်တဲ့အခါ အလိုအလျောက် ထုတ်ပေးမယ်'}</small></span><b class="${state.voiceAudioUrl ? '' : 'muted-check'}">${state.voiceAudioUrl ? '✓' : '○'}</b></div><div><span class="review-thumb coral">Aa</span><span><strong>Unicode subtitles</strong><small>${state.segments.length} timed lines · ${state.captionsOn ? 'burn-in' : 'off'}</small></span><b>✓</b></div><div><span class="review-thumb blue">◌</span><span><strong>Visual treatment</strong><small>Blur, crop, adjust${state.style.flip ? ', flip' : ''}</small></span><b>✓</b></div></div>${isRendering ? `<div class="render-progress-card"><div class="progress-head"><span id="render-stage">${escapeHtml(state.renderStage || 'Rendering with ffmpeg.wasm')}</span><strong id="render-pct">${Math.round(state.renderProgress)}%</strong></div><div class="big-progress"><i id="render-bar" style="width:${state.renderProgress}%"></i></div><p>ဖုန်းကို lock မလုပ်ပါနဲ့။ 97–99% မှာ input memory ရှင်းပြီး MP4 ကို Download အတွက် ဖတ်နေပါတယ်။ ကြာလွန်းရင် Termux မှာ error details ပေါ်လာပါမယ်။</p><button class="text-button danger" type="button" data-action="cancel-render">Cancel render</button></div>` : `<label class="range-control render-engine-choice"><span>Render Engine</span><select data-render-engine><option value="ffmpeg" ${state.renderEngine === 'ffmpeg' ? 'selected' : ''}>FFmpeg · အတည်ပြုပြီးသား (အကြံပြု)</option><option value="webcodecs" ${state.renderEngine === 'webcodecs' ? 'selected' : ''}>WebCodecs + Mediabunny · စမ်းသပ်ရန်</option></select></label><div class="render-warning"><span>i</span><span>${state.renderEngine === 'webcodecs' ? 'စမ်းသပ်ဆဲ Engine ဖြစ်ပါတယ်။ ပထမဆုံး 15–30 စက္ကန့် clip နဲ့ စမ်းပါ။ မအောင်မြင်ရင် FFmpeg ကို ပြန်ရွေးနိုင်ပါတယ်။' : 'လက်ရှိအလုပ်လုပ်နေတဲ့ FFmpeg Engine ကို အသုံးပြုပါမယ်။ WebCodecs ကို သီးခြားစမ်းချင်ရင် အပေါ်က Render Engine ကို ပြောင်းပါ။'}</span></div><button class="primary-button render-button" type="button" data-action="render"><span class="button-spark">✦</span> Render my recap <span class="button-arrow">→</span></button>`}</div>`}
    ${state.renderError ? `<div class="inline-error large">${escapeHtml(state.renderError)}</div>` : ''}
    <div class="stage-footer"><button class="secondary-button" type="button" data-step="3">← Back to style</button>${complete ? '<span class="saved-label">✓ Saved in this browser session</span>' : '<span class="footer-hint">Local-only · No account required</span>'}</div>
  `;
}

function railMarkup() {
  return `
    <div class="rail-card workflow-card"><div class="rail-heading"><span>YOUR WORKFLOW</span><span class="rail-percent">${Math.round(state.step === 0 ? 0 : state.step === 3 ? 50 : 100)}%</span></div><div class="workflow-list">${steps.map((step) => `<button type="button" class="workflow-row ${state.step === step.id ? 'current' : ''} ${state.step > step.id ? 'complete' : ''}" data-step="${step.id}"><span class="workflow-bullet">${state.step > step.id ? '✓' : `0${step.id + 1}`}</span><span><strong>${step.en}</strong><small>${step.id === 0 ? 'Upload + auto recap & voice' : step.id === 3 ? 'Filter, crop & adjust' : 'Render MP4 locally'}</small></span><i>${state.step > step.id ? 'done' : state.step === step.id ? 'now' : ''}</i></button>`).join('')}</div></div>
    <div class="rail-card key-card"><div class="key-card-top"><div class="key-orb">⌘</div><div><strong>${state.apiKey ? 'Gemini connected' : 'Bring your own key'}</strong><small>${state.apiKey ? 'Ready for video analysis' : 'Free API-first workflow'}</small></div></div><p>ကိုယ့် API key ကို ကိုယ်တိုင်သုံးပါ။ Key ကို ဒီ session ထဲမှာပဲ ထိန်းထားပါတယ်။</p><button class="rail-link" type="button" data-action="open-key">${state.apiKey ? 'Manage key' : 'Add Gemini key'} <span>→</span></button></div>
    <div class="rail-card support-card"><span class="support-mark">◎</span><div><strong>Need a quick start?</strong><p>Sample scene နဲ့ flow အပြည့်ကို စမ်းကြည့်ပါ။</p><button class="rail-link" type="button" data-action="load-demo">Open sample <span>→</span></button></div></div>
  `;
}

function modalMarkup() {
  if (state.modal !== 'key') return '';
  return `<div class="modal-backdrop" data-action="close-modal"><div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="key-title" onclick="event.stopPropagation()"><button class="modal-close" type="button" data-action="close-modal">×</button><div class="modal-orb">⌘</div><div class="eyebrow">PRIVATE CONNECTION</div><h2 id="key-title">Connect your Gemini key.</h2><p>Key ကို browser session ထဲမှာပဲ သိမ်းထားပြီး Si Gyi server သို့ မပို့ပါ။ Gemini ရဲ့ billing / quota ကို သင့် key အတိုင်း သုံးမှာပါ။</p><label class="key-input-label">GEMINI API KEY<input id="api-key-input" type="password" value="${escapeHtml(state.apiKey)}" placeholder="AIza… or AQ.…" autocomplete="off" /></label><a class="helper-link" href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer">Google AI Studio မှ AIza… သို့မဟုတ် AQ.… key ရယူရန် ↗</a><div class="modal-actions"><button class="secondary-button" type="button" data-action="close-modal">Not now</button><button class="primary-button" type="button" data-action="save-key">Save key <span class="button-arrow">→</span></button></div><div class="modal-footnote"><span>◉</span> Privacy note: Tab ပိတ်သွားရင် key ကို အလိုအလျောက် ဖျက်ပေးပါတယ်။</div></div></div>`;
}

function bindEvents() {
  document.querySelectorAll('[data-step]').forEach((button) => button.addEventListener('click', () => {
    const nextStep = Number(button.dataset.step);
    if (nextStep > 0 && !state.file && !state.demo) {
      setToast('အရင်ဆုံး video file တစ်ခု ရွေးပါ။');
      return;
    }
    state.step = nextStep;
    render();
    if (nextStep === 2 && state.segments.length && !state.voiceBlob && state.voiceStatus !== 'generating') synthesizeVoiceover();
  }));

  document.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', () => handleAction(button.dataset.action)));
  document.querySelectorAll('[data-voice]').forEach((button) => button.addEventListener('click', () => { if (state.voice === button.dataset.voice && state.voiceStatus === 'ready') return; const hasScript = state.segments.some((s) => String(s.text || '').trim()); invalidateVoice(); state.voice = button.dataset.voice; render(); if (hasScript) void synthesizeVoiceover(); }));
  document.querySelectorAll('[data-voice-speed]').forEach((input) => {
    input.addEventListener('input', () => { const label = input.parentElement.querySelector('strong'); if (label) label.textContent = `${Number(input.value).toFixed(2)}×`; });
    input.addEventListener('change', () => { const hasScript = state.segments.some((s) => String(s.text || '').trim()); invalidateVoice(); state.voiceSpeed = Number(input.value); render(); if (hasScript) void synthesizeVoiceover(); });
  });
  document.querySelectorAll('[data-script-tab]').forEach((button) => button.addEventListener('click', () => { state.scriptTab = button.dataset.scriptTab; render(); }));
  document.querySelectorAll('[data-crop]').forEach((button) => button.addEventListener('click', () => { state.style.crop = button.dataset.crop; render(); }));

  document.querySelectorAll('[data-style]').forEach((input) => input.addEventListener('input', () => {
    const key = input.dataset.style;
    state.style[key] = Number(input.value);
    const out = input.parentElement.querySelector('output');
    if (out) out.textContent = `${key === 'zoom' ? Number(input.value).toFixed(2) : Math.round(input.value)}${out.dataset.suffix || ''}`;
    applyPreview();
  }));
  document.querySelectorAll('[data-style-color]').forEach((input) => input.addEventListener('input', () => { state.style[input.dataset.styleColor] = input.value; applyPreview(); }));
  document.querySelectorAll('[data-style-filter]').forEach((input) => input.addEventListener('change', () => { state.style.filter = input.value; applyPreview(); }));
  document.querySelectorAll('[data-fit-mode]').forEach((input) => input.addEventListener('change', () => { state.style.fitMode = input.value; applyPreview(); }));
  document.querySelectorAll('[data-resolution]').forEach((input) => input.addEventListener('change', () => { state.resolution = input.value; setToast(`${state.resolution} resolution ကို ရွေးထားပါတယ်။`); }));
  document.querySelectorAll('[data-render-engine]').forEach((input) => input.addEventListener('change', () => { state.renderEngine = input.value; render(); setToast(state.renderEngine === 'webcodecs' ? 'WebCodecs စမ်းသပ် Engine ကို ရွေးထားပါတယ်။' : 'အတည်ပြုပြီးသား FFmpeg Engine ကို ရွေးထားပါတယ်။'); }));

  document.querySelectorAll('[data-seg-text]').forEach((input) => input.addEventListener('input', () => { state.segments[Number(input.dataset.segText)].text = input.value; invalidateVoice(); }));
  document.querySelectorAll('[data-seg-orig]').forEach((input) => input.addEventListener('input', () => { state.segments[Number(input.dataset.segOrig)].original = input.value; }));
  document.querySelectorAll('[data-seg-time]').forEach((input) => input.addEventListener('change', () => {
    const [index, field] = input.dataset.segTime.split(':');
    const value = Math.max(0, Number(input.value) || 0);
    const segment = state.segments[Number(index)];
    segment[field] = value;
    if (segment.end <= segment.start) segment.end = Number((segment.start + 1).toFixed(2));
    invalidateVoice();
    render();
  }));
  document.querySelectorAll('[data-seg-del]').forEach((button) => button.addEventListener('click', () => { state.segments.splice(Number(button.dataset.segDel), 1); invalidateVoice(); render(); }));

  const input = document.querySelector('#video-input');
  if (input) input.addEventListener('change', (event) => loadVideo(event.target.files?.[0]));
  const logoInput = document.querySelector('#logo-input');
  if (logoInput) logoInput.addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return setToast('Logo အတွက် image ဖိုင် ရွေးပေးပါ။');
    if (state.logoUrl) URL.revokeObjectURL(state.logoUrl);
    state.logoFile = file;
    state.logoUrl = URL.createObjectURL(file);
    render();
    setToast('Logo ကို Render ထဲမှာ ထည့်ဖို့ ရွေးပြီးပါပြီ။');
  });
  document.querySelectorAll('[data-logo-position]').forEach((input) => input.addEventListener('change', () => { state.logoPosition = input.value; }));
  const dropzone = document.querySelector('#dropzone');
  if (dropzone) {
    dropzone.addEventListener('dragover', (event) => { event.preventDefault(); dropzone.classList.add('dragging'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragging'));
    dropzone.addEventListener('drop', (event) => { event.preventDefault(); dropzone.classList.remove('dragging'); loadVideo(event.dataTransfer.files?.[0]); });
  }
  if (state.step === 3 || (state.step === 0 && document.querySelector('.source-style-canvas'))) applyPreview();
}

async function handleAction(action) {
  if (action === 'pick-video') return document.querySelector('#video-input')?.click();
  if (action === 'pick-logo') return document.querySelector('#logo-input')?.click();
  if (action === 'remove-logo') { if (state.logoUrl) URL.revokeObjectURL(state.logoUrl); state.logoFile = null; state.logoUrl = ''; return render(); }
  if (action === 'open-key') { state.modal = 'key'; return render(); }
  if (action === 'close-modal') { state.modal = ''; return render(); }
  if (action === 'save-key') {
    const value = document.querySelector('#api-key-input')?.value.trim() || '';
    if (value && !/^(AIza[A-Za-z0-9_-]{20,}|AQ\.[A-Za-z0-9._-]{10,})/.test(value)) {
      state.toast = 'Gemini key က AIza… သို့မဟုတ် AQ.… နဲ့ စရပါမယ်။';
      return render();
    }
    state.apiKey = value;
    if (value) sessionStorage.setItem('sigyi-gemini-key', value); else sessionStorage.removeItem('sigyi-gemini-key');
    state.modal = '';
    setToast(value ? 'Gemini API key ကို ဒီ session ထဲမှာ ချိတ်ပြီးပါပြီ။' : 'API key ကို ဖျက်ပြီးပါပြီ။');
    return;
  }
  if (action === 'load-demo') return loadDemo();
  if (action === 'reset') return resetStudio();
  if (action === 'analyze') return analyzeVideo();
  if (action === 'cancel-analysis') return cancelAnalysis();
  if (action === 'load-link') return loadVideoFromLink();
  if (action === 'speak') return speakRecap();
  if (action === 'retry-voice') { invalidateVoice(); return synthesizeVoiceover(); }
  if (action === 'flip') { state.style.flip = !state.style.flip; return render(); }
  if (action === 'fit') { state.style.zoom = 1; state.style.flip = false; return render(); }
  if (action === 'reset-blur') { Object.assign(state.style, { topBlur: 8, bottomBlur: 10, subtitleBlur: 14, subY: 66, captionY: 73, blurStrength: 24 }); return render(); }
  if (action === 'toggle-captions') { state.captionsOn = !state.captionsOn; render(); return setToast(state.captionsOn ? 'Burmese Unicode captions ကို render ထဲမှာ ထည့်ထားပါတယ်။' : 'Captions ကို ခဏပိတ်ထားပါတယ်။'); }
  if (action === 'regenerate') return analyzeVideo();
  if (action === 'add-segment') { const last = state.segments[state.segments.length - 1]; const start = last ? last.end : 0; state.segments.push({ start, end: Number((start + 3).toFixed(2)), original: '', text: '' }); invalidateVoice(); return render(); }
  if (action === 'render') { state.step = 4; return renderVideo(); }
  if (action === 'cancel-render') return cancelRender();
}

function loadVideo(file) {
  if (!file) return;
  if (!file.type.startsWith('video/')) return setToast('Video file ပဲ ရွေးပေးပါ။');
  if (state.videoUrl) URL.revokeObjectURL(state.videoUrl);
  if (state.voiceAudioUrl) URL.revokeObjectURL(state.voiceAudioUrl);
  state.file = file;
  state.demo = false;
  state.videoUrl = URL.createObjectURL(file);
  state.metadata = { name: file.name, size: file.size, type: file.type, duration: 0 };
  state.step = 0;
  state.segments = [];
  state.analysisStatus = 'idle';
  state.analysisProgress = 0;
  state.analysisStage = '';
  state.analysisError = '';
  state.voiceAudioUrl = '';
  invalidateVoice();
  render();
  const video = document.querySelector('#source-video');
  if (video) video.addEventListener('loadedmetadata', () => { state.metadata.duration = video.duration; }, { once: true });
}

function loadDemo() {
  if (state.videoUrl) URL.revokeObjectURL(state.videoUrl);
  if (state.voiceAudioUrl) URL.revokeObjectURL(state.voiceAudioUrl);
  state.file = null;
  state.videoUrl = '';
  state.demo = true;
  state.metadata = { name: 'mystery-door-demo.mp4', size: 24800000, type: 'video/mp4', duration: 16.7 };
  state.segments = sampleSegments.map((s) => ({ ...s }));
  state.analysisStatus = 'complete';
  state.analysisProgress = 100;
  state.analysisStage = 'Sample script ready';
  state.voiceAudioUrl = '';
  invalidateVoice();
  state.step = 0;
  setToast('Sample scene ကို ဖွင့်ပြီးပါပြီ။ Flow အပြည့် စမ်းကြည့်နိုင်ပါတယ်။');
}

async function loadVideoFromLink() {
  const input = document.querySelector('#source-link');
  const rawUrl = input?.value.trim() || '';
  if (!rawUrl) return setToast('Direct video URL တစ်ခု ထည့်ပါ။');
  let url;
  try { url = new URL(rawUrl); } catch { return setToast('URL ပုံစံ မမှန်ပါ။'); }
  if (!['http:', 'https:'].includes(url.protocol)) return setToast('http/https URL ပဲ အသုံးပြုပါ။');
  try {
    setToast('Direct video URL ကို download လုပ်နေပါတယ်…');
    const response = await fetch(url.href, { mode: 'cors' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    if (!blob.type.startsWith('video/')) throw new Error('ဒီ URL က video file မဟုတ်ပါ။');
    const name = url.pathname.split('/').pop() || 'linked-video.mp4';
    loadVideo(new File([blob], name, { type: blob.type }));
  } catch (error) {
    setToast(`Link ကို browser က မဖတ်နိုင်ပါ။ Direct CORS video URL သုံးပါ (${error.message || 'CORS error'}).`);
  }
}

async function analyzeVideo() {
  if (state.demo) {
    state.segments = sampleSegments.map((s) => ({ ...s }));
    invalidateVoice();
    state.analysisStatus = 'complete';
    state.step = 3;
    render();
    synthesizeVoiceover();
    return;
  }
  if (!state.file) return setToast('Video file မရှိသေးပါ။');
  if (!state.apiKey) { state.modal = 'key'; return render(); }
  state.step = 0;
  state.analysisStatus = 'working';
  state.analysisProgress = 5;
  state.analysisStage = 'Video ကို ဖတ်ဖို့ ပြင်ဆင်နေပါတယ်…';
  state.analysisError = '';
  render();
  const controller = new AbortController();
  state.analysisAbort = controller;
  const timeout = window.setTimeout(() => controller.abort(), 15 * 60 * 1000);
  try {
    const segments = await analyzeVideoWithGemini({
      file: state.file,
      apiKey: state.apiKey,
      duration: state.metadata?.duration || 0,
      signal: controller.signal,
      onStage: (stage) => setAnalysisUI(stage),
      onProgress: (pct) => setAnalysisUI(null, pct)
    });
    state.segments = segments;
    invalidateVoice();
    state.analysisProgress = 100;
    state.analysisStatus = 'complete';
    state.step = 3;
    render();
    await synthesizeVoiceover();
  } catch (error) {
    if (state.analysisStatus === 'cancelled') return;
    state.analysisStatus = 'error';
    state.analysisError = error.name === 'AbortError' ? 'Gemini response ကြာလွန်းလို့ ရပ်လိုက်ပါတယ်။ Video ပိုတိုတာနဲ့ ပြန်စမ်းပါ။' : (error.message || 'Gemini analysis မအောင်မြင်ပါ။');
    render();
  } finally {
    window.clearTimeout(timeout);
    state.analysisAbort = null;
  }
}

function cancelAnalysis() {
  state.analysisStatus = 'cancelled';
  state.analysisProgress = 0;
  state.analysisStage = '';
  state.analysisAbort?.abort();
  state.analysisAbort = null;
  state.analysisError = 'Analysis ကို ရပ်လိုက်ပါပြီ။ Video သေးသေးနဲ့ ပြန်စနိုင်ပါတယ်။';
  render();
}

async function synthesizeVoiceover() {
  if (!state.segments.some((s) => s.text.trim())) { setToast('TTS အတွက် script မရှိသေးပါ။'); return false; }
  invalidateVoice();
  const token = state.voiceToken;
  state.voiceStatus = 'generating';
  state.voiceProgress = 'စတင်နေပါတယ်';
  state.voiceProgressPct = 0;
  if (state.step === 3 || state.step === 4) render();
  const controller = new AbortController();
  state.voiceAbort = controller;
  try {
    const result = await buildVoiceover({
      segments: state.segments,
      voice: state.voice,
      rate: state.voiceSpeed || 1.25,
      signal: controller.signal,
      onProgress: (done, total, index, phase = 'done') => { const basePct = Math.round((done / Math.max(1, total)) * 100); state.voiceProgressPct = phase === 'starting' && done < total ? Math.max(basePct, Math.min(99, Math.round(((done + 0.35) / Math.max(1, total)) * 100))) : basePct; state.voiceProgress = phase === 'starting' ? `အပိုင်း ${index + 1}/${total} အသံထုတ်နေပါတယ်…` : `${done}/${total} ပြီးပါပြီ`; setText('#voice-label', `Generating… ${state.voiceProgressPct}% · ${state.voiceProgress}`); const voicePct = document.querySelector('#voice-pct'); if (voicePct) voicePct.textContent = `${state.voiceProgressPct}%`; const fill = document.querySelector('.audio-controls .progress-fill'); if (fill) fill.style.width = `${state.voiceProgressPct}%`; const bar = document.querySelector('#voice-progress-bar'); if (bar) bar.style.width = `${state.voiceProgressPct}%`; if (state.renderStatus === 'working') setRenderUI(`TTS အသံထုတ်နေပါတယ်… ${state.voiceProgressPct}% (${state.voiceProgress})`, Math.max(3, Math.min(15, 3 + state.voiceProgressPct * 0.12))); }
    });
    if (token !== state.voiceToken) return false; // script was edited meanwhile
    state.voiceBlob = result.wavBlob;
    state.voiceAudioUrl = URL.createObjectURL(result.wavBlob);
    state.timeline = result.timeline;
    state.voiceStatus = 'ready';
    state.voiceProgressPct = 100;
    if (state.step === 3 || state.step === 4) render();
    return true;
  } catch (error) {
    if (token !== state.voiceToken) return false;
    state.voiceStatus = 'error';
    state.voiceError = `Edge TTS မရပါ — ${error.message || 'API endpoint ကို စစ်ပါ။'}`;
    if (state.step === 3 || state.step === 4) render();
    return false;
  }
}

function speakRecap() {
  const audio = document.querySelector('#voice-audio');
  if (audio) {
    if (audio.paused) {
      audio.onplay = () => { state.voiceStatus = 'previewing'; render(); };
      audio.onended = () => { state.voiceStatus = 'previewed'; render(); };
      audio.onpause = () => { if (!audio.ended) { state.voiceStatus = 'ready'; render(); } };
      audio.play().catch((error) => { state.voiceError = `Audio play မအောင်မြင်ပါ — ${error.message || 'Play ကို ထပ်နှိပ်ပါ။'}`; render(); });
    } else audio.pause();
    return;
  }
  return synthesizeVoiceover();
}

let lastTermuxRenderLog = { stage: '', pct: -1, at: 0 };
function sendTermuxRenderLog(stage, pct, extra = {}) {
  const now = Date.now();
  const rounded = pct == null ? null : Math.round(pct);
  if (stage === lastTermuxRenderLog.stage && (rounded == null || rounded < lastTermuxRenderLog.pct + 3) && now - lastTermuxRenderLog.at < 5000) return;
  lastTermuxRenderLog = { stage: stage || lastTermuxRenderLog.stage, pct: rounded ?? lastTermuxRenderLog.pct, at: now };
  fetch('/api/render-log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'progress', stage: stage || state.renderStage, progress: rounded ?? Math.round(state.renderProgress), resolution: state.resolution, time: new Date().toISOString(), ...extra }) }).catch(() => {});
}

function setRenderUI(stage, pct) {
  if (stage) state.renderStage = stage;
  if (pct != null) state.renderProgress = Math.max(state.renderProgress, pct);
  setText('#render-stage', state.renderStage);
  setText('#render-pct', `${Math.round(state.renderProgress)}%`);
  const bar = document.querySelector('#render-bar');
  if (bar) bar.style.width = `${state.renderProgress}%`;
  if (state.renderStatus === 'working') sendTermuxRenderLog(stage, pct);
}

async function renderVideo() {
  if (!state.file) {
    state.renderError = 'Demo scene ကို download မလုပ်နိုင်သေးပါ။ ကိုယ့် video file တစ်ခု upload လုပ်ပြီး render လုပ်ပါ။';
    return render();
  }
  if (state.file.size > 250 * 1024 * 1024) setToast('Video ကြီးလွန်းရင် memory မလောက်နိုင်ပါ။ 1080p အတွက် အတို clip နဲ့ စမ်းပါ။');
  if (state.resolution === '1080p' && (state.metadata?.duration || 0) > 90) setToast('1080p clip ကြာချိန် 90 စက္ကန့်ကျော်ပါတယ်။ 92% မှာကြာနိုင်လို့ 720p ကို အကြံပြုပါတယ်။');
  state.renderStatus = 'working';
  lastTermuxRenderLog = { stage: '', pct: -1, at: 0 };
  state.renderProgress = 2;
  state.renderStage = 'ပြင်ဆင်နေပါတယ်…';
  state.renderError = '';
  if (state.outputUrl) { URL.revokeObjectURL(state.outputUrl); state.outputUrl = ''; }
  render();
  try {
    if (state.segments.some((s) => s.text.trim()) && !state.voiceBlob) {
      setRenderUI('Burmese voiceover ထုတ်နေပါတယ်… 0%', 3);
      const ok = await synthesizeVoiceover();
      if (state.renderStatus === 'cancelled') return;
      if (!ok || !state.voiceBlob) throw new Error(state.voiceError || 'Voiceover မရပါ။ Render မလုပ်ခင် TTS အသံကို အရင်ထုတ်ပေးပါ။');
    }
    if (state.segments.some((s) => s.text.trim()) && !state.timeline.length) {
      throw new Error('TTS timing မရှိပါ။ Voice အဆင့်ကို ပြန်သွားပြီး အသံကို ထပ်ထုတ်ပါ။');
    }
    setRenderUI('TTS အသံနဲ့ subtitle timing ကို ချိတ်ဆက်နေပါတယ်…', 16);
    const blob = await renderRecap({
      file: state.file,
      segments: state.segments,
      timeline: state.timeline,
      voiceBlob: state.voiceBlob,
      style: state.style,
      captionsOn: state.captionsOn,
      resolution: state.resolution,
      logoFile: state.logoFile,
      logoPosition: state.logoPosition,
      engine: state.renderEngine,
      onStage: (stage) => setRenderUI(stage),
      onProgress: (pct) => setRenderUI(null, pct)
    });
    if (state.renderStatus === 'cancelled') return;
    state.outputUrl = URL.createObjectURL(blob);
    state.renderProgress = 100;
    state.renderStatus = 'complete';
    state.renderStage = 'ပြီးပါပြီ — video ready';
    render();
  } catch (error) {
    if (state.renderStatus === 'cancelled') return;
    state.renderStatus = 'error';
    const detail = error?.message || String(error) || 'Unknown render error';
    state.renderError = `${detail}\n\nဒီအမှားစာသားကို Copy လုပ်ပြီး ပို့ပေးပါ။`;
    state.renderDiagnostic = { at: new Date().toISOString(), stage: state.renderStage, progress: state.renderProgress, error: detail, userAgent: navigator.userAgent, ffmpegLogs: getRenderLogs() };
    console.error('[SiGyi Render Diagnostic]', state.renderDiagnostic, error);
    // Browser-side FFmpeg errors do not naturally appear in Termux's Vite log.
    // Forward a compact diagnostic record to the local dev server for easy sharing.
    try { await fetch('/api/render-log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state.renderDiagnostic) }); } catch (logError) { console.warn('Could not forward render diagnostic to Termux:', logError); }
    terminateFfmpeg();
    render();
  }
}

function cancelRender() {
  terminateFfmpeg();
  state.voiceAbort?.abort();
  state.renderStatus = 'cancelled';
  state.renderProgress = 0;
  state.renderStage = '';
  state.renderError = 'Render ကို ရပ်လိုက်ပါပြီ။ ပြန်စရန် Render button ကို နှိပ်ပါ။';
  render();
}

function resetStudio() {
  if (state.videoUrl) URL.revokeObjectURL(state.videoUrl);
  if (state.logoUrl) URL.revokeObjectURL(state.logoUrl);
  if (state.outputUrl) URL.revokeObjectURL(state.outputUrl);
  if (state.voiceAudioUrl) URL.revokeObjectURL(state.voiceAudioUrl);
  state.step = 0;
  state.file = null;
  state.videoUrl = '';
  state.demo = false;
  state.metadata = null;
  state.segments = [];
  state.analysisStatus = 'idle';
  state.analysisProgress = 0;
  state.analysisStage = '';
  state.analysisError = '';
  state.voiceSpeed = 1.25;
  state.renderStatus = 'idle';
  state.renderProgress = 0;
  state.renderStage = '';
  state.renderError = '';
  state.outputUrl = '';
  state.logoFile = null;
  state.logoUrl = '';
  state.logoPosition = 'top-right';
  invalidateVoice();
  state.captionsOn = true;
  state.style = { topBlur: 8, bottomBlur: 10, subtitleBlur: 14, subY: 66, captionY: 73, blurStrength: 24, flip: false, zoom: 1.02, fitMode: 'fit', subtitleFontSize: 20, brightness: 2, contrast: 5, saturation: 7, crop: 'center', subtitleColor: '#ffdf3d', subtitleBg: '#111111', frameColor: '#d6ef47', frameWidth: 0, filter: 'cinematic' };
  render();
}

function setToast(message) {
  let root = document.querySelector('#toast-root');
  if (!root) { root = document.createElement('div'); root.id = 'toast-root'; document.body.appendChild(root); }
  root.innerHTML = `<div class="toast">${escapeHtml(message)}</div>`;
  window.clearTimeout(window.__sigyiToast);
  window.__sigyiToast = window.setTimeout(() => { root.innerHTML = ''; }, 3600);
}

render();
