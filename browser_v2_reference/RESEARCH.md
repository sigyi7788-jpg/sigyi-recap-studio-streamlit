# Audio transcription and voice research

## Gemini transcription

Google's current transcription guidance documents `gemini-3.5-transcribe` for dedicated audio transcription. It supports automatic language detection, speaker diarization, word-level timestamps, custom vocabulary, and verbatim/smart transcription modes. The documented request path uploads an audio file with the Files API and sends the file URI to the Interactions API. Google also documents `gemini-3.8-flash` with audio input through `generateContent`.

The audio understanding docs list WebM (`audio/webm`), Opus (`audio/opus`), MP3 (`audio/mp3`), MPEG (`audio/mpeg`), AAC, OGG, WAV, FLAC and other audio MIME types. They recommend Files API when the total request is larger than 20 MB. Timestamp prompts can refer to a specific `MM:SS` section. Dedicated transcription docs warn that word-level timestamps can reduce overall transcription accuracy, so phrase/utterance timestamps are a safer default for recap subtitles.

Sources: [1] https://ai.google.dev/gemini-api/docs/transcribe
[2] https://ai.google.dev/gemini-api/docs/generate-content/audio
[3] https://ai.google.dev/api/files

## Browser-local transcription

The implementation now uses browser-native MediaRecorder/Web Audio capture only to obtain local PCM samples, then runs multilingual Whisper through Transformers.js with WebGPU first and WASM fallback. The Whisper model is cached in the browser after the first download. Only the resulting transcript text is sent to Gemini for recap generation; the original video and audio stay on the device.

MDN documents `MediaRecorder` as widely available, with `MediaRecorder.isTypeSupported()` for selecting a browser-supported container and `dataavailable` events for receiving recorded chunks. Browser support can vary by MIME type, so the app chooses among supported WebM/Opus or OGG/Opus types.

Source: [4] https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder

## Voice options

Microsoft documents Burmese neural TTS voices under the `my-MM` locale, including Nilar and Thiha voices in the existing product reference and prior Microsoft Speech material. Free online Burmese TTS services exist, but many are limited trials or external paid services. A reliable free-first product should keep browser Speech Synthesis as a preview, optionally support a user-supplied Edge TTS/Azure endpoint, and avoid claiming that third-party free web services are unlimited or stable.

Source: [5] https://learn.microsoft.com/en-us/shows/ai-show/whats-new-with-neural-text-to-speech
