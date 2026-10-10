# Call Safety

A two-person browser audio call with live transcription of both speakers. The app has a home page, room setup/call page, and Call Logs. The website is deployed at [call-safety-islamabad-hack2026.vercel.app](https://call-safety-islamabad-hack2026.vercel.app). The silent transcription worker still runs on this computer.

## Run locally

Requirements: Node.js 24+, Python 3.10+, and a LiveKit Cloud project with Inference STT credits. This laptop already has `.env.local` configured. On another machine, copy `.env.example` to `.env.local` and set `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `SESSION_SIGNING_SECRET`, and a separate random `TRANSCRIPT_WORKER_SECRET` (at least 32 characters). Keep these values private. The caller and receiver do not need service credentials.

Open two PowerShell terminals in the project directory:

```powershell
# Terminal 1: website and local transcript API
npm ci
npm run dev
```

```powershell
# Terminal 2: silent LiveKit transcription worker
python -m venv .venv-worker
.\.venv-worker\Scripts\python.exe -m pip install -r worker\requirements.txt
.\.venv-worker\Scripts\python.exe worker\transcriber.py dev
```

Open **http://localhost:3000**. Leave both terminals running. The worker registers as `call-transcriber` and automatically joins newly created rooms. Start the worker before creating a room. If it stops during a call, start a new room after restarting it. `TRANSCRIPT_APP_URL` defaults to `http://127.0.0.1:3000` for the worker's save callback.

Create a room, copy the receiver invitation, and join. The second person opens the link in another browser or device. Each person sees the live transcript in the call sidebar. The warning panel is not implemented yet; live text is transcription only. The app tells participants that both voices are transcribed and saved.

## Call Logs

The worker uses LiveKit Inference with Deepgram Nova-3 to transcribe each participant's microphone track. LiveKit sends interim and final text to the call UI. At the end of a speaking turn, the worker posts the final text to the app API. Locally, the API writes `data/call-logs/<room-id>/segments.jsonl` and `transcript.txt`. On Vercel, each final segment is a private file in the `call-safety-transcripts` Blob store; the API combines them into a `.txt` download. The app does not create a local audio recording. The `Call Logs` tab shows rooms joined in the current browser. If you use a different browser or clear browser storage, the transcript files remain, but that browser will not list the old rooms.

Call log reads require a signed room-specific archive key issued when someone joins. The key is kept in that browser's local storage and expires after 30 days. The worker's write endpoint requires the separate `TRANSCRIPT_WORKER_SECRET`. The room invitation itself expires after two hours. Do not share log keys or `.env.local`.

Because STT uses LiveKit Cloud, call audio is sent to the configured LiveKit service for recognition. The production transcript store is private Vercel Blob storage; `data/call-logs/` is only for local development. Keep the worker running with `TRANSCRIPT_APP_URL=https://call-safety-islamabad-hack2026.vercel.app` for deployed calls. Audio calling still works when the worker is offline, but transcription and new Call Logs entries do not. See [DEPLOYMENT.md](DEPLOYMENT.md).

## Verification

```powershell
npm run typecheck
npm test
npm run build
```

The worker can be checked without a microphone using `scripts/probe-transcriber.py` after both services are running. It creates a temporary call room and checks that the agent joins. `scripts/probe-speech.py` and `scripts/probe-receiver.py` can inject a mono 16-bit WAV for STT testing; they are development probes, not part of the user flow. On this laptop, a spoken WAV was transcribed by the worker, displayed live in the browser, saved to both local transcript files, and shown in Call Logs.

Use headphones for two nearby devices. The production HTTPS site can be opened on separate devices; the local `http://localhost:3000` setup is for testing on this computer.

## Implementation contracts

- `POST /api/rooms` creates a signed caller/receiver room invitation.
- `POST /api/rooms/join` checks the invitation and returns a short-lived LiveKit token, `archiveAccessKey`, role, room ID, and LiveKit URL. The token dispatches `call-transcriber` when the room is created.
- `POST /api/internal/transcripts` accepts final speaker segments from the worker with a bearer secret.
- `GET /api/call-logs/[roomId]` returns a room's saved segments to a bearer archive key; `?format=txt` downloads the text file.

Next milestone: analyse transcript segments for scam, threat, and fake-kidnapping language and show evidence-based **possible** risk alerts. The app does not monitor ordinary cellular calls.
