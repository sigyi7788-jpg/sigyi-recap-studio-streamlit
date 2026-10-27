# Si-Gyi Recap Studio — WebCodecs Experimental Render

This update keeps FFmpeg as the default engine and adds an opt-in WebCodecs + Mediabunny test engine. Gemini script generation, Edge TTS, narration timeline, subtitle timing, logo selection, preview, and MP4 download are retained.

## Install

From the project directory in Termux:

```bash
npm install
npm run dev
```

`npm install` is required because this version adds `mediabunny` as a dependency.

## Safe test procedure

1. Keep the existing project backup.
2. Use a 15–30 second test clip first.
3. Generate the voiceover as usual.
4. Open Render and choose `WebCodecs + Mediabunny · စမ်းသပ်ရန်`.
5. Render, preview the MP4, and check the first/middle/last scene, Burmese subtitle timing, voice timing, logo, and framing.
6. If the browser reports an unsupported encoder, a blank output, scene mismatch, or slow/unstable rendering, select `FFmpeg · အတည်ပြုပြီးသား (အကြံပြု)` and render again.
7. Only test a full 2-minute 720p video after the short test passes.

## Important

- FFmpeg remains the default; the existing renderer is not removed.
- WebCodecs hardware acceleration depends on Android Chrome and the device's available encoders; speed is not guaranteed.
- Browser media playback is used to walk through the scene timeline, so test synchronization carefully on the target phone before using the experimental engine for production videos.
- The experimental renderer burns captions and logo into the canvas frames. It preserves scene-to-narration time mapping from the current timeline, but is not considered production-verified until tested on the phone.
