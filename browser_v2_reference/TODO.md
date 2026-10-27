# Si Gyi Recap Studio — Delivery TODO

## Browser-only API key and privacy messaging
- Users can enter their own Gemini API key in the browser.
- API keys are kept in the user's device/session and the product clearly states that the application does not store them.
- The product explains that video processing is client-side where supported.

## Mobile video intake
- Users can upload a video from a phone-friendly interface.
- The workflow shows source metadata, compatibility warnings, and a ready state before processing.

## Gemini transcript and Burmese recap
- Gemini can analyze the video's spoken audio and produce an editable, accurately timed transcript.
- The workflow can generate an editable Burmese recap translation that preserves meaning and is suitable for narration.

## Burmese voiceover
- The user can choose a Burmese voice and preview or retry voiceover generation.
- The UI has a graceful unavailable-state message when Edge TTS is not available in the browser.

## Video treatment editor
- Users can control top/bottom blur and subtitle-area blur.
- Users can flip horizontally, crop, and adjust brightness, contrast, saturation, and zoom.
- The editor includes an in-browser preview.

## Timed Burmese subtitles
- Users can edit Burmese Unicode subtitle text and timing.
- Subtitle styling is visible and suitable for accurate burn-in rendering.

## Local render and export
- The workflow communicates that ffmpeg.wasm renders locally in the phone browser.
- Rendering combines transformed video, timed subtitles, and Burmese voiceover where supported.
- The UI shows progress, cancellation, actionable errors, browser capability warnings, and recovery guidance.
- Users can preview and download the final video.
