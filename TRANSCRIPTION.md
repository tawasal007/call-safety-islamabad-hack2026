# Live captions, translation and separate call logs

Implemented in October 2026. Active languages are English and Urdu; Punjabi is
deferred at the user's request. This document replaces the old English-only and
no-storage scope for the transcription module. The call still uses the existing
signed room admission and LiveKit audio transport.

English and Urdu now default to **LiveKit Inference with Deepgram Nova-3**, using
a persistent streaming connection per microphone. Both bypass the shared CPU
Whisper queue. Auto still uses the slower local Whisper path. Live captions
default to English + Urdu; translations follow finalized original captions.

## Local setup

Use standard CPython 3.12+ (not MSYS Python). Install `uv`, or use Python's venv
and pip. From the project folder on Windows:

```powershell
uv venv --python 3.12 worker/.venv
uv pip install --python worker/.venv/Scripts/python.exe -r worker/requirements-translation.txt
worker/.venv/Scripts/python.exe scripts/setup-worker.py
```

The setup script appends missing worker settings to ignored `.env.local`. It
generates a random shared worker secret and does not print credentials. Existing
settings are preserved. The worker reads that file; `worker/.env` can override
worker-only settings. Restart Next.js after configuration changes.

Streaming requires a LiveKit Cloud project with Inference access and available
quota/credits; it uses `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` server-side.
English and Urdu microphone audio is sent through LiveKit Inference to Deepgram
for STT. Final recognized text is translated through LiveKit/Google Gemini;
logs remain on the laptop. Inference usage is managed in LiveKit Cloud.
No extra provider keys are needed. Defaults: `ENGLISH_STT_BACKEND=livekit`,
`URDU_STT_BACKEND=livekit`, `LIVEKIT_STT_MODEL=deepgram/nova-3`,
`TEXT_TRANSLATION_BACKEND=livekit`,
`LIVEKIT_TRANSLATION_MODEL=google/gemini-3.1-flash-lite`.
For a local development LiveKit server without Cloud Inference, explicitly set
both STT backends to `whisper` and `TEXT_TRANSLATION_BACKEND=local`.

Start the caption worker in one terminal:

```powershell
Set-Location worker
.venv/Scripts/python.exe -m uvicorn server:app --host 127.0.0.1 --port 8001
```

Start the website in another:

```powershell
npm run dev
```

The first worker startup downloads the selected Whisper model. The first
local text translation downloads the separate translation model. Cloud translation
does not need that download. The UI
shows loading/pending states. Internet access and enough disk space are needed
for initial model downloads; cached models can run locally afterwards.

Create a room, choose **your** spoken language, and join. The receiver independently
chooses their own language. **English — live captions** remains the default;
choose **Urdu — live captions** for Urdu speech. Only Auto is marked as slower.
An Urdu caller and English receiver can each use their own fixed streaming language.
Use Auto only for one speaker switching languages, while testing code-switching carefully.
Auto detection chooses between English and Urdu and decodes Urdu in Urdu script;
explicit Urdu is recommended for Urdu evaluation rather than guessing per phrase.
Captions show original speech, English, Urdu, speaker, elapsed timestamp and
provisional/final status. Follow-latest can be disabled when reviewing earlier text.
Provisional Urdu appears in its original script; English translation follows the
finalized phrase. This avoids repeatedly translating unfinished Urdu and delaying
final speech processing on the CPU. English-to-Urdu translation also follows final
English speech.

## Runtime design

- `worker/server.py`: authenticated FastAPI service, one silent RTC participant per
  room, separate caller/receiver microphone streams. English/Urdu frames are relayed
  immediately into independent streaming STT connections; Whisper queues serve
  Auto or explicitly selected local fallback only. Translation has two separate
  consumers per call and never gates original captions in either language.
- `worker/streaming.py`: stable IDs for interim revisions, finalization, empty-result
  discard and duplicate-final suppression. Final text is saved before translation.
- `worker/text_translation.py`: bounded, stateless LiveKit/Gemini translation.
  Structured responses, eight-second deadline, no tools or conversation memory;
  quoted call instructions are translated rather than followed. Failures preserve
  original captions and show unavailable translation. Original-language keyword
  evidence is available before translated text arrives.
- `worker/core.py`: 20ms voice-activity frames, 200ms pre-roll, 600ms silence endpoint,
  bounded utterances, contextual phrase evidence, SQLite persistence.
- `lib/worker-client.ts`: server-only requests to the worker. Browser bundles contain
  neither the worker shared secret nor LiveKit API credentials.
- `app/api/transcription`: signed-admission check; the server derives the caller or
  receiver role and updates only that speaker's language setting.
- `app/components/live-captions.tsx`: trusted LiveKit events plus saved snapshots for
  refresh/recovery. Invalid sender/room/schema/evidence is ignored. Interim revisions
  replace previous text and cannot overwrite finalized text.
- `/history` and `/history/[roomId]`: one visible log per call, original/translated
  text, contextual phrase tags, service events, and text/JSON downloads.

Both microphones are captioned separately. Only caller speech produces caller-risk
keyword evidence. The worker publishes no audio. Caption failures leave LiveKit
audio running. Browser participant tokens retain `canPublishData: false`; only the
server-controlled worker publishes monitoring events under identity
`transcriber-${roomId}` and topic `call-safety.transcription`.

The browser requests echo cancellation, noise suppression and automatic gain
control. Streaming provider/network/quota failures are visible with Retry service;
there is no silent fallback to a slow CPU queue. Each saved segment records its
recognizer and processing latency. Authenticated health diagnostics include audio
frame/event counts; configured STT is not a guarantee of provider availability.

**End** leaves individually, matching the existing call behavior. A worker waits 12
seconds after both people leave, flushes pending speech, saves the finalized log,
and releases its room connection. If the browser never connects, the empty worker
expires after 45 seconds. Reconnection within the grace period reuses the worker.
Shutdown timeouts are recorded; unfinished translations become unavailable rather
than staying pending forever. Restarting the service preserves logs and marks
interrupted previous processing as ended.

## Model settings and limits

The Urdu rollout was tested through Vercel with two simultaneous synthetic Urdu
speakers: first interim captions **1.62–1.94 seconds**, final segment latency
**0.07–1.96 seconds**, and English text translation **1.52–3.33 seconds** per
request. One speaker had one wrong word (normalized word error rate 4.5%);
the other matched the short fixture after diacritic/spelling normalization.
In the mixed Urdu-caller/English-receiver test, Urdu first interim was 1.06
seconds, English first interim 1.91 seconds, finals 0.23–0.28 seconds, and text
translation 1.33–1.95 seconds. Source attribution, evidence, bilingual logs,
silence and room cleanup passed in both tests. These are limited synthetic
fixtures, not human-speech accuracy or latency guarantees. Benchmark outputs:
`worker/test-output/streaming-benchmark-ur.json` and `streaming-benchmark-mixed.json`.

For Auto or explicit local fallback, defaults are `WHISPER_MODEL=small`, `WHISPER_DEVICE=cpu`,
`WHISPER_COMPUTE_TYPE=int8`. These run on this laptop without a GPU. They are a
development baseline, not a claim of production Urdu accuracy or a fixed
caption latency. `WHISPER_CPU_THREADS` defaults to 4; translation uses 2 CPU threads.

The earlier English-only streaming rollout on 10 October 2026 measured first
interim captions at **2.03–2.06 seconds** after playback began and final segment
processing at **0.25–0.30 seconds** after the segment end. Both streams reproduced
the 17-word synthetic banking/password-request clip with **0% word error rate**.
Silence produced no additional captions; logs, keyword attribution, translations
and room cleanup passed. This small synthetic fixture does not establish accuracy
for human accents, noise or phone microphones. Results are stored locally in
`worker/test-output/streaming-benchmark.json`; rerun the streaming smoke test to
measure the current deployment. Real user calls on the previous CPU queue had
13–76 second delays, so the older benchmark below understated concurrent load.

In the earlier local Whisper two-participant synthetic-audio smoke tests, final caption processing
latency from each segment's end was about 6–11 seconds for Urdu-to-English and
4–5 seconds for English transcription. Provisional source captions can arrive
earlier; English-to-Urdu translation arrives separately. These are measured demo
results, not a latency guarantee. Auto/local fallback on this CPU does not meet a strict
sub-second real-time target; it needs separate benchmarking and improvement.

For a suitable NVIDIA GPU, benchmark `WHISPER_MODEL=large-v3`,
`WHISPER_DEVICE=cuda`, `WHISPER_COMPUTE_TYPE=float16` and install a compatible
CUDA/cuDNN runtime. `medium` is another candidate. Use multilingual models;
Whisper's `turbo` and English-only `.en` models are inappropriate for the requested
Urdu-to-English translation pipeline. The service rejects these models.

Streaming original Urdu is visible immediately; its English translation is a
separate revision. Streaming English similarly gains Urdu translation afterward.
The default translator is LiveKit/Gemini. Set `TEXT_TRANSLATION_BACKEND=local` to
use the existing local NLLB model in either direction:
`URDU_TRANSLATION_MODEL=facebook/nllb-200-distilled-600M`. NLLB has a noncommercial
research license. Set `TEXT_TRANSLATION_BACKEND=disabled` to omit text translations;
the UI reports unavailable translation while retaining original captions. Whisper
fallback still translates original Urdu speech directly to English.

Whisper speech is split at silence or after `MAX_UTTERANCE_SECONDS` (default 10).
Streaming English and Urdu use provider interim/final events with 300ms silence endpointing
and preserves sentence context across incoming frames. Detection uses finalized
English with up to eight recent caller segments and a 60-second context window.
The rules cover credential requests, impersonation with requests/pressure,
payment plus threats, kidnapping claims, private-information threats and coercion.
Urdu source text is also matched directly so translated wording cannot erase all
credential evidence. Matches include their evidence language and must quote exact
source text; Urdu credential safety advice is excluded by tested negation rules.
They filter selected advice/fiction/quoted contexts, but are limited rules, not a
complete semantic detector, a scam score or a determination that a claim is true.
They expose exact evidence and source segment IDs for the scoring/report teammates.

Accuracy must be measured with actual Urdu, accents, code-switched
English, banking vocabulary, names, amounts, negation, quiet speech and noise. Speech
and translation models can hallucinate or mistranslate. Original recognized text is
retained alongside translation so reviewers can compare them. No raw audio is stored.

## Persistence and access

Logs live in `worker/data/calls.sqlite3` by default, including the WAL files. Use a
durable volume and `CALL_LOG_DB` for a hosted worker. There is no global public log
list: history APIs require a room-specific signed access key obtained by joining.
History access expires after 30 days. Browser storage remembers access to its last
30 joined calls; clearing storage removes this browser's history index/access keys,
not the server's transcripts. This prototype has no account-based recovery or
automatic retention deletion; manage stored data deliberately before wider use.

Run one uvicorn process (`--workers 1`, the default). In-memory worker ownership
prevents duplicate connections inside that process. Multiple replicas require an
external lease and shared persistence; they are not supported by this version.
`MAX_ACTIVE_CALLS` defaults to 4. Bounded queues expose overload instead of silently
claiming complete captions. This is a small prototype worker, not an unlimited
multi-tenant service.

## Deployment

The Next.js site can remain on Vercel. The Python worker needs a long-lived host,
model cache, sufficient RAM/CPU or GPU, and a persistent volume. It is excluded from
Vercel source builds. The deployed website cannot reach this laptop's localhost.
Set `TRANSCRIPTION_WORKER_URL` to the worker's HTTPS endpoint and set the same
`TRANSCRIPTION_WORKER_SECRET` on both services. Set the existing LiveKit credentials
on the worker. Do not expose the worker without bearer authentication/TLS.

The frontend is now deployed at https://call-safety-urdu.vercel.app. The local
worker is connected through an approved temporary Cloudflare HTTPS tunnel. Caption
startup and protected saved-log access passed through Vercel during a real phone
call. Keep the laptop and worker/tunnel running; restarting the quick tunnel needs
its new URL configured in Vercel and a redeployment. See [DEPLOYMENT.md](DEPLOYMENT.md).

## Checks

```powershell
npm run typecheck
npm test
npm run build
worker/.venv/Scripts/python.exe -m unittest discover -s worker/tests -v
worker/.venv/Scripts/python.exe scripts/smoke-streaming.py --base https://call-safety-urdu.vercel.app
worker/.venv/Scripts/python.exe scripts/smoke-streaming.py --language ur
worker/.venv/Scripts/python.exe scripts/smoke-streaming.py --language ur --mixed
worker/.venv/Scripts/python.exe scripts/smoke-transcription.py --base http://localhost:3000 --wav path/to/mono-16khz-pcm16.wav
```

The audio smoke test creates two temporary LiveKit participants, publishes the WAV
as microphone audio, checks source attribution/caption events/saved logs/keyword
evidence/authorization, then verifies worker shutdown. Its phrase must include a
direct password request to satisfy its evidence assertions. It proves real RTC
audio ingestion, not physical-device audibility or multilingual accuracy.

Local verification passed 30 Python tests (including streaming relay/disconnect,
Urdu revision, source-before-translation and translation-failure
regressions), 6 Node tests, TypeScript, the production
build, the original room/token API smoke test and real RTC audio tests for both
languages. The saved bilingual log, Urdu filter, RTL layout and downloaded UTF-8
text were checked through the frontend. See [SETUP_STATUS.md](SETUP_STATUS.md) for
the remaining physical-device and speech-quality evaluation.

References: [Whisper](https://github.com/openai/whisper),
[LiveKit Inference / Deepgram STT](https://docs.livekit.io/agents/models/stt/deepgram/),
[LiveKit Inference / Gemini](https://docs.livekit.io/agents/models/llm/gemini/),
[faster-whisper](https://github.com/SYSTRAN/faster-whisper),
[LiveKit AudioStream](https://docs.livekit.io/reference/python/livekit/rtc/audio_stream.html),
[NLLB model card](https://huggingface.co/facebook/nllb-200-distilled-600M).
