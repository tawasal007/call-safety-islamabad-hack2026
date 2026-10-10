# Deploy the audio-call milestone to Vercel

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

1. Use the shared Git repository. `.gitignore` excludes `.env.local`, `node_modules`, `.next` and `local-livekit`.
2. Import that repository in Vercel. Choose **Next.js** as the framework and the project root as the root directory.
3. Use the lockfile (`npm ci`) to install, `npm run build` to build, and the default Next.js output directory. Use Node.js 24.x where available.
4. Add the four environment variables above before deploying.
5. Click **Deploy**. If variables are changed later, redeploy so the new values take effect.

## Alternative: deploy the local folder using Vercel CLI

From this folder, `npx vercel` starts an interactive preview deployment. Sign in to your account and follow its prompts. Configure the four variables for the linked project and redeploy if the first build was created without them. Use `npx vercel --prod` when ready for the production address. `.vercelignore` excludes local credentials, the local media server, and design assets from the uploaded source.

The initial production deployment was completed by Codex on 10 October 2026 with the user's authorization. For future code changes from this linked folder, run `npx vercel deploy --prod --scope tawasal1`. Existing server variables stay configured in Vercel.

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
