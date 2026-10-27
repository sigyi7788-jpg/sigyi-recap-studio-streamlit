# Si Gyi Recap Studio — Complete Source Package

ဒီ folder/zip ထဲမှာ Si Gyi Recap Studio website ရဲ့ source code, Edge TTS server endpoint, FFmpeg browser render flow, Vercel configuration, package lock, route manifest, research notes, TODO နှင့် legacy `bot.py` ပါဝင်ပါတယ်။

## 1. Requirements

- Node.js 18+ (Node.js 20+ recommended)
- npm (ပါဝင်ပြီးသား Node.js)
- Termux မှာ Python Edge TTS နဲ့ FFmpeg
- Google AI Studio Gemini API key (`AIza...` သို့မဟုတ် `AQ....`)
- Modern Chrome/Edge/Safari browser

## 2. Install and run locally

```bash
npm install
npm run dev
```

Browser မှာ `http://localhost:3000` ကိုဖွင့်ပါ။

Vite preview/dev server ထဲမှာ `/api/tts` Edge TTS endpoint ပါပြီးသားဖြစ်ပါတယ်။

## 3. Gemini API key

1. Google AI Studio မှ API key ရယူပါ။
2. Website ရဲ့ `Connect Gemini key` ကိုနှိပ်ပါ။
3. Key ကို browser `sessionStorage` ထဲမှာပဲ ထားပါတယ်။
4. Si Gyi server မှာ Gemini key ကို သိမ်းမထားပါ။

Gemini flow က video ကို Gemini Files API သို့ temporary upload လုပ်ပြီး `gemini-3.8-flash` (မရရင် 3.5-flash → 2.5-flash သို့ အလိုအလျောက်ပြောင်း) ဖြင့် transcript + Burmese recap ကို timestamp နဲ့တကွ တစ်ခါတည်း လုပ်ပါတယ်။ 18MB အောက် video ကို upload မလိုဘဲ တိုက်ရိုက်ပို့ပါတယ်။ Request ပြီးတာနဲ့ temporary Gemini file ကို auto-delete လုပ်ပါတယ်။

## 4. Vercel deploy

### Option A — Vercel Dashboard

1. Project folder ကို GitHub repository သို့ push လုပ်ပါ။
2. Vercel Dashboard → **Add New Project** → repository ကို import လုပ်ပါ။
3. Framework preset ကို **Vite** ရွေးပါ။
4. Build command: `npm run build`
5. Output directory: `dist`
6. Install command: `npm install`
7. Deploy လုပ်ပါ။

`api/tts.js` ရှိတဲ့အတွက် Vercel က `/api/tts` ကို serverless function အဖြစ် detect လုပ်ပါမယ်။ `vercel.json` ထဲမှာ FFmpeg browser isolation headers နှင့် TTS function timeout ပါပြီးသားဖြစ်ပါတယ်။

### Option B — Vercel CLI

```bash
npm install
npm run build
npx vercel
npx vercel --prod
```

## 5. Edge TTS

Server endpoint: `api/tts.js`

Supported voices:

- `Nilar Neural` → `my-MM-NilarNeural`
- `Thiha Neural` → `my-MM-ThihaNeural`

Burmese script ရလာတာနဲ့ `/api/tts` က Python `edge_tts.Communicate` ကို bot.py ပုံစံအတိုင်း ခေါ်ပါတယ်။ ပြီးရင် FFmpeg `atempo`, high-pass, loudness normalization သုံးပြီး 24 kHz mono WAV ပြန်ပေးပါတယ်။ Thiha/Nilar ကို Adjust & Filter ထဲမှာ ရွေးနိုင်ပြီး အသံတစ်ပိုင်းစီပြီးတိုင်း progress တက်ပါမယ်။

Local endpoint test:

```bash
curl -X POST http://localhost:3000/api/tts \
  -H 'Content-Type: application/json' \
  --data '{"text":"မင်္ဂလာပါ","voice":"Nilar Neural","rate":1.25}' \
  --output test-voice.wav
```

## 6. Website workflow

1. Gemini API key ထည့်ပါ။
2. Video file upload လုပ်ပါ သို့မဟုတ် CORS ခွင့်ပြုထားတဲ့ direct `.mp4` / `.webm` URL ထည့်ပါ။
3. **Generate Recap** တစ်ချက်နှိပ်ပါ။
4. Gemini က Burmese recap script ထုတ်ပြီး Thiha/Nilar Edge TTS အသံကို အလိုအလျောက် ထုတ်ပေးပါမယ်။ Script editor နဲ့ Voice step ကို ကိုယ်တိုင်ဖြတ်သန်းစရာမလိုပါ။
5. Adjust & Filter မှာ crop, flip, blur, subtle color preset, brightness/contrast/saturation နဲ့ subtitle style ကို ချိန်နိုင်ပါတယ်။
6. **Render MP4** နှိပ်ပါ။ မူရင်း scene တစ်ခုချင်းကို narration segment အချိန်နဲ့ ညှိပြီး original audio ကို mute လုပ်ကာ generated voiceover + Burmese subtitles ပါတဲ့ MP4 ကို browser ထဲမှာ render လုပ်ပါမယ်။ Logo ကိုလည်း optional အနေနဲ့ ထည့်နိုင်ပါတယ်။
7. ပြီးရင် download လုပ်ပါ။

## 7. Social links

TikTok/YouTube/Rednote **page URL** တွေကို browser-only နဲ့ download မလုပ်နိုင်ပါ။ CORS ခွင့်ပြုထားတဲ့ direct media URL (`.mp4` / `.webm`) တွေကိုသာ link box မှာ သုံးနိုင်ပါတယ်။ Social page URL downloader တစ်ခုထည့်ရန် platform-approved API သို့မဟုတ် authorized media backend လိုအပ်ပါတယ်။

## 8. Important files

- `src/main.js` — complete studio workflow, Gemini, TTS, FFmpeg render
- `src/styles.css` — full UI styles and responsive layout
- `api/tts.js` — Vercel/Node Edge TTS endpoint
- `vite.config.js` — local preview `/api/tts` middleware and COOP/COEP headers
- `vercel.json` — Vercel headers and function configuration
- `package.json` / `pnpm-lock.yaml` — exact dependencies
- `public/manus-routes.json` — WebDev route manifest
- `app.config.ts` — project metadata
- `RESEARCH.md` — implementation research notes
- `TODO.md` — project acceptance/outcome list
- `legacy/bot.py` — original uploaded bot file kept for reference

## 9. Privacy and limits

Gemini API usage is charged/limited according to the user's Gemini key and quota. Video is uploaded temporarily to Gemini for analysis and deleted after processing. Edge TTS uses Microsoft's online Edge Read Aloud service through the server endpoint. Do not upload content you do not own or have permission to process.

## Important accuracy and free-tier notes

- The interface has a glassmorphism visual treatment; it does not make third-party APIs free or unlimited.
- Gemini API usage depends on Google's current quota, model availability, video size and account eligibility. The user supplies their own API key.
- Edge TTS is an online third-party service accessed by the Vercel function. It can be throttled or change; it is not guaranteed uptime or an official unlimited production API.
- FFmpeg.wasm core is bundled from the local npm dependency (not fetched from a CDN at render time). Rendering uses 360×640 at 20 fps for the fastest preset, and 720×1280 / 1080×1920 at 24 fps. Scene clips are trimmed to the source timestamps and fitted to each generated narration segment duration. Large/long videos can still run out of phone memory or take a long time. Test with a short clip first and keep the browser tab open.
- Transcript timestamps describe the original spoken content. A rewritten Burmese recap has different wording and duration, so subtitle timing will not be perfectly aligned with recap narration unless recap segments are explicitly re-timed to the generated audio. Always review and adjust the timing before final export.
- Social-media page URLs are not direct video files and usually cannot be imported directly due to platform access controls and browser CORS. Upload a video file or use a CORS-enabled direct media URL.


## Fix log (အလုပ်မလုပ်တာတွေ ပြင်ထားချက်)

- `api/tts.js`: `tts.generate()` မရှိတဲ့ function ကို ခေါ်နေလို့ Edge TTS လုံးဝမရခဲ့ပါ။ `synthesize()` + `toBuffer()` နဲ့ ပြင်ထားပါတယ်။
- Burmese subtitle: ffmpeg `drawtext` က font မပါ၊ Burmese shaping မမှန်လို့ စာမပေါ်/ကွဲခဲ့ပါတယ်။ Browser canvas နဲ့ ရေးပြီး PNG overlay လုပ်ပါပြီ (`src/lib/subtitles.js`)။
- Subtitle က မူရင်းစာသားကို ပြနေတာကို Burmese recap အချိန်အတိုင်းပြောင်းပါပြီ။ Voiceover ကို စာကြောင်းတစ်ကြောင်းချင်း ထုတ်ပြီး scene အချိန်နဲ့ ညှိကာ subtitle timing ကို voiceover အတိုင်း ထိုးပါတယ်။
- Blur: အရင်က drawbox အနက်ရောင်ပဲ ဖုံးခဲ့တာ။ အခု တကယ် `gblur` (top / bottom / subtitle area) ပါပြီ။
- Crop: 9:16 (540×960) crop + left/center/right + zoom + flip ကို render ထဲမှာ တကယ်သုံးပါပြီ။
- ffmpeg: `exec()` error code ကို မစစ်ခဲ့လို့ fail ဖြစ်ရင် အဓိပ္ပာယ်မရှိတဲ့ error ပေါ်ခဲ့တယ်။ အခု ffmpeg log နောက်ဆုံးစာကြောင်းတွေနဲ့ ပြပါတယ်။
- `crossOriginIsolated` စစ်ပြီး render ပိတ်ထားတာ ဖယ်ပါပြီ (single-thread core က မလိုပါ)။ COOP/COEP headers ဖယ်ထားလို့ iPhone/Safari မှာလည်း ရပါမယ်။
- Slider ဆွဲတဲ့အခါ page တစ်ခုလုံး re-render ဖြစ်ပြီး ဆွဲမရတာ ပြင်ပါပြီ။ Toast ကလည်း page ကို reset မလုပ်တော့ပါ။
- `vite preview` မှာ `/api/tts` မရှိတာ ပြင်ပါပြီ။


## Termux Python TTS requirement
For the local Termux setup, install Python Edge TTS once: `python -m pip install edge-tts==7.3.1`. The local `/api/tts` endpoint calls Python `edge_tts.Communicate` like the working Telegram bot, then uses FFmpeg `atempo`, high-pass and loudness normalization to create 24 kHz mono WAV audio. Voice speed defaults to 1.25×. Voice generation runs three short segments concurrently while preserving subtitle order, and updates progress after each finished segment; Thiha Neural and Nilar Neural can be selected in Adjust & Filter. Subtitles are split into neat pages of at most two lines.


## Latest small refinements (Edge-only / phone fit / subtitles)

- The active `/api/tts` endpoint now uses Edge TTS only. If Edge TTS fails, it returns an error rather than silently switching to a different voice engine.
- Adjust & Filter includes subtitle text size and vertical position controls.
- Video framing defaults to Fit phone frame (show the full source inside the 9:16 canvas); Fill frame remains available. Zoom is intentionally limited to a subtle 1.00–1.12× range.
- 360p uses 18 fps and a slightly smaller encode target to improve render time on mobile; test visual smoothness on your device.
