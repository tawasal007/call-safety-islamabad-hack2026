# Vercel deployment

Production: https://call-safety-islamabad-hack2026.vercel.app

The project is linked in ignored `.vercel/project.json` to `tawasal1/call-safety-islamabad-hack2026`. On 10 October 2026 the current local checkout was deployed with Vercel CLI. No Git commit or push was made. To deploy later local changes without Git:

```powershell
npm run typecheck
npm test
npm run build
npx --yes vercel@latest deploy --prod --yes --scope tawasal1
```

Production environment variables are `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `SESSION_SIGNING_SECRET`, `TRANSCRIPT_WORKER_SECRET`, and `BLOB_READ_WRITE_TOKEN`. Keep them server-side. The private Blob store `call-safety-transcripts` is connected to Production and Preview. Vercel Functions write one private JSON file per final speech segment, and the authorized Call Logs API assembles the transcript and `.txt` download. Local development still writes to ignored `data/call-logs/` files. `.vercelignore` excludes credentials, local transcripts, the Python environment, and the local worker from deployment uploads.

The transcription worker is not hosted by Vercel. It runs on this laptop, registers with LiveKit as `call-transcriber`, and must stay online for new calls to get live text. Start it in PowerShell:

```powershell
$env:TRANSCRIPT_APP_URL='https://call-safety-islamabad-hack2026.vercel.app'
.\.venv-worker\Scripts\python.exe worker\transcriber.py dev
```

The deployed `TRANSCRIPT_WORKER_SECRET` must match `.env.local`. Start the worker before creating a test room. If the worker stops, audio calling remains available but transcription pauses. Existing transcripts remain in the private Blob store. For local-only development, omit the PowerShell override so `TRANSCRIPT_APP_URL` points to `http://127.0.0.1:3000`.

After deployment, confirm the home page responds, create a fresh room on the production URL, and check its transcript in Call Logs. A spoken-audio probe against production on 10 October 2026 dispatched the worker, transcribed speech through LiveKit Inference, and read the saved segment back from the production Call Logs API.
