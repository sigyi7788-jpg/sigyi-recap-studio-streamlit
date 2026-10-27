# Speed + preflight + subtitle position update

- Adds upload-stage voice selection and quick style controls before Gemini analysis. Voice can be chosen while analysis is running; synthesis starts after script is available.
- Adds `captionY` as an independent subtitle center coordinate. `subY` remains the top edge of the blur area, so the caption can be moved independently to cover the original subtitle location.
- FFmpeg and WebCodecs now use 20 fps at 720p (18 fps at 360p, 24 fps at 1080p). Scene timing and voice timeline values are not changed; lower 720p frame rate may reduce motion smoothness slightly while improving encode time.
- Gemini generation and TTS are still sequential in this build. True half-script/half-TTS overlap needs a streaming Gemini response parser and a progressive audio assembler; it is not enabled here to avoid risking the currently verified timing/audio workflow.

Test first with a 15–30 second clip: select voice/style on upload screen, analyze, inspect caption alignment, render 720p, preview and download.
