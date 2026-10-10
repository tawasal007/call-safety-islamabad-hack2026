# Deploy Call Safety to Vercel

## Current test deployment — 10 October 2026

The English/Urdu frontend is deployed at **https://call-safety-urdu.vercel.app**
in the user's `priminuxx/call-safety-urdu` project. The current workspace link points
to this project. Its current deployment ID is `dpl_2TBxrFsV1sSVewGTH1w3GZdr4ihA`.
Vercel compilation, the public homepage, and room/token API checks passed.

Audio and caption APIs work. The worker is running on this laptop, protected by
bearer authentication. After explicit approval for transcripts, translations and
saved logs passing through Cloudflare, a temporary HTTPS tunnel was connected.
English and Urdu recognition use LiveKit Inference / Deepgram Nova-3 streaming, with
independent connections for both microphones and the existing LiveKit credentials.
English/Urdu audio goes to LiveKit/Deepgram for recognition; recognized text goes
through LiveKit/Google Gemini for bidirectional translation. Saved logs remain on
the laptop. LiveKit Inference credits/quota apply. Fixed English/Urdu captions
bypass the CPU speech queue; Auto remains slower. In the Urdu test, first captions
arrived in 1.62–1.94 seconds; mixed English/Urdu calls also passed. Details and
limited synthetic accuracy measurements are in TRANSCRIPTION.md.
The simultaneous synthetic-speaker production test measured first captions at
2.03–2.06 seconds, final segment updates at 0.25–0.30 seconds, and no word errors
on the short English fixture. Human speech accuracy needs separate evaluation.
Its current endpoint is `https://explicit-advice-usually-merchandise.trycloudflare.com`.
Vercel Production/Preview have `TRANSCRIPTION_WORKER_URL` and its matching secret.
Unauthenticated worker health requests return 401; authenticated health is ready.
The user's phone call delivered microphone frames to a silent diagnostic receiver;
the deployed caption-start and protected saved-log APIs returned 200, active
monitoring, and saved bilingual captions.

When restarting the tunnel, configure its new `TRANSCRIPTION_WORKER_URL` and
`TRANSCRIPTION_WORKER_SECRET` for this project and redeploy. The configuration
script supports `DEPLOY_TRANSCRIPTION_WORKER_URL` and an installed CLI via
`VERCEL_CLI_PATH`; values travel via stdin. Run future deploys with
`vercel deploy --prod --scope priminuxx`. Keep the laptop awake and worker/tunnel
running during the temporary test. See [TRANSCRIPTION.md](TRANSCRIPTION.md).

Local commands for restarting the two processes are:

```powershell
worker/.venv/Scripts/python.exe -m uvicorn server:app --app-dir worker --host 127.0.0.1 --port 8001
.deployment-tools/cloudflared.exe tunnel --url http://127.0.0.1:8001 --no-autoupdate --protocol http2
```

Run them in separate terminals. Starting a new quick tunnel changes its hostname;
the existing Vercel settings must then be updated and redeployed. Both processes
are currently running. The model cache and database stay on this laptop.

The previous workspace project link is preserved in ignored
`.deployment-tools/previous-vercel-project.json`. The following notes record the
earlier audio-only deployment in a different account.

The app uses Next.js for the website and server token endpoints, and the Hackathon LiveKit Cloud project for audio.

**Deployed production website:** https://call-safety-islamabad-hack2026.vercel.app

Vercel project: `call-safety-islamabad-hack2026` under `tawasal1`. This workspace is linked through ignored `.vercel/project.json`. Production and Preview have the four server environment variables configured. The public production domain and its room/token API work without Vercel authentication. Vercel can still protect preview or deployment-specific URLs; share the production website above.

## Values to enter in Vercel

Copy these **four values from this laptop's `.env.local`** into your Vercel project's Environment Variables. Select Production and Preview if you want both to support calls.

| Variable | Purpose |
| --- | --- |
| `LIVEKIT_URL` | Public `wss://` URL of the LiveKit Cloud project |
| `LIVEKIT_API_KEY` | Server credential for generating participant tokens |
| `LIVEKIT_API_SECRET` | Server credential; mark as Secret if offered |
| `SESSION_SIGNING_SECRET` | Signs room invitations; mark as Secret if offered |

No variable needs a `NEXT_PUBLIC_` prefix. The browser receives the public LiveKit URL and a short-lived participant token from the server. The two secrets stay on the server. `.env.local` is deliberately excluded from source uploads and commits.

## Deploy using your Git repository

1. Commit/push the project source to your own repository, excluding `.env.local`, `node_modules`, `.next` and `local-livekit`. `.gitignore` is prepared for this.
2. Import that repository in Vercel. Choose **Next.js** as the framework and the project root as the root directory.
3. Use the lockfile (`npm ci`) to install, `npm run build` to build, and the default Next.js output directory. Use Node.js 24.x where available.
4. Add the four environment variables above before deploying.
5. Click **Deploy**. If variables are changed later, redeploy so the new values take effect.

## Alternative: deploy the local folder using Vercel CLI

From this folder, `npx vercel` starts an interactive preview deployment. Sign in to your account and follow its prompts. Configure the four variables for the linked project and redeploy if the first build was created without them. Use `npx vercel --prod` when ready for the production address. `.vercelignore` excludes local credentials, the local media server, and design assets from the uploaded source.

The earlier audio-only deployment was completed on 10 October 2026. The current
workspace is linked to the new project described above; use its `priminuxx` scope.

## Test the deployed address

1. Open the Vercel HTTPS website on device A, start a new call and join.
2. Copy the new invitation link to device B. Use a different Wi-Fi network or mobile data, open it and join.
3. Allow microphone access on both devices; wear headphones. Verify each person can hear the other.
4. Mute/unmute each side, then end the call. Confirm the microphone stops and participant presence updates.

Use a new invitation created on the deployed site; local invitations contain `localhost`. A receiver needs browser microphone permission and network access to LiveKit Cloud. If audio playback is blocked by the browser, press **Enable audio playback**.

## Team handover

The caller identity is `caller-${roomId}` and receiver identity is `receiver-${roomId}`. The next transcription worker should subscribe only to the caller microphone. This milestone has no STT worker or detector connected. Those services can be developed next using the existing room/role contract.

## References

- [LiveKit connections](https://docs.livekit.io/intro/basics/connect/)
- [Vercel environment variables](https://vercel.com/docs/environment-variables)
- [Vercel CLI deployments](https://vercel.com/docs/cli/deploy)
