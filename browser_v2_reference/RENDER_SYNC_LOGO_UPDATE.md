# Si-Gyi Recap Studio — Scene Sync + Logo + Preview Update

## What changed
- FFmpeg now cuts the source video using each recap segment's original `start` / `end` timestamps.
- Each source scene is time-fitted to the matching generated voice segment duration from the TTS timeline, so the narration and visual scene change together.
- Burmese subtitle sprite overlays continue to use the same TTS timeline.
- The source video's original audio remains excluded when generated voiceover is available.
- Optional logo upload supports common image formats; the browser converts it to PNG and FFmpeg overlays it in one of four corners.
- Finished MP4 has an in-page player preview before the user taps Download.
- 360p uses 20 fps for a modest speed improvement; 720p and 1080p stay at 24 fps. The existing `ultrafast` preset remains enabled.

## Preserved
- `src/lib/gemini.js` (Gemini analysis/script logic) unchanged.
- `src/lib/tts.js` (Thiha/Nilar Edge TTS logic) unchanged.
- `api/tts.js` unchanged.
- Subtitle rendering still uses browser canvas PNGs for Burmese Unicode.

## Notes
This remains a browser FFmpeg.wasm project; it does not switch rendering to native Termux FFmpeg. Scene duration fitting can speed up or slow down individual source clips to match their narration segments. Please test a short clip first on the phone, because browser memory and FFmpeg.wasm performance vary by device.
