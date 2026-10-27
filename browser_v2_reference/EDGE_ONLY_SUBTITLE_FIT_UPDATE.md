# Si Gyi Recap Studio — Edge-only + subtitle + phone-fit update

This update is based on the working `scene-sync-logo-preview` package.

## Changed
- Active website TTS endpoint (`api/tts.js`) uses Edge TTS only. It no longer falls back to gTTS, so a failed Edge request reports an error instead of switching voices.
- Subtitle text size is adjustable in Adjust & Filter; vertical position remains adjustable through the subtitle-position slider.
- Video framing defaults to `Fit phone frame`, which keeps the full source image visible in the 9:16 canvas with black padding as needed. `Fill frame` remains available to crop the edges.
- Zoom is intentionally limited to 1.00–1.12× and defaults to 1.02×.
- 360p output uses 18 FPS and CRF 34 for a lighter/faster mobile render. Higher resolutions remain 24 FPS.
- Existing Gemini, Edge TTS voice selection, subtitle timing, logo, preview, and MP4 download workflow were preserved.

## Validation
- `node --check` passed for `api/tts.js`, `src/main.js`, and `src/lib/render.js`.
- Embedded Python script syntax check passed.
- A complete Vite build could not be run in this environment because dependencies were not available (`vite: not found` after the package install timed out). Test the ZIP on the phone with a short clip first.
