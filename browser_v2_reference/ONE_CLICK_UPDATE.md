# Si Gyi Recap Studio — Voice and Subtitle Fix

- Replaced the batched browser TTS flow with bot-style per-segment generation.
- Local `/api/tts` now calls Python `edge_tts.Communicate` with the selected `my-MM-NilarNeural` or `my-MM-ThihaNeural` voice, then applies FFmpeg `atempo`, high-pass, loudness normalization, and 24 kHz mono WAV output like `bot_termux_2.py`.
- One segment is processed at a time. Progress advances after each segment instead of waiting for a whole multi-line batch. TTS and FFmpeg calls have timeouts and errors are returned to the interface.
- Added a visible Thiha Neural / Nilar Neural picker and speed control in Adjust & Filter. Changing the voice or speed regenerates the narration automatically. Default speed is 1.25×, matching the bot's `VOICE_SPEED`.
- Subtitle prompt now asks Gemini for short 2–5 second phrases. Burned-in Burmese captions use a slightly smaller font and each subtitle page is limited to two lines with yellow text and a dark outline/background. Captions use measured generated-audio timing per segment.
- Preserved existing crop, flip, zoom, blur layers, brightness/contrast/saturation, and color filter presets.

Validation: `node --check` passed for `src/main.js`, `src/lib/tts.js`, `src/lib/render.js`, `src/lib/gemini.js`, and `api/tts.js`. Full production build and live Edge TTS could not be tested in this environment because Vite dependencies and Python `edge-tts` are not installed here.
