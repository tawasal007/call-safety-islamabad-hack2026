# Call Safety — audio call milestone

This is the first working milestone of the Islamabad Hack 2026 web app. It has three screens: home (create a room or paste an invitation), room setup (share the invitation and join), and an active audio-only LiveKit call between a caller and receiver. Room setup and the call share the same room URL. Safety monitoring is marked inactive; additional tabs are deferred.

## Team setup

Clone this repository, install Node.js 24 or newer, then run:

```powershell
Copy-Item .env.example .env.local
npm ci
npm run dev
```

Replace the sample values in `.env.local` with your own LiveKit Cloud project URL, API key, and API secret. Generate a fresh `SESSION_SIGNING_SECRET` using the command in `.env.example`. Ask the project owner for access to the shared LiveKit Cloud project if you need to test in the same environment. Never commit `.env.local` or paste API secrets into issues or pull requests. The app opens at **http://localhost:3000**.

Work on a feature branch for each module and open a pull request into `main`. Run `npm run typecheck`, `npm test`, and `npm run build` before requesting review. The current call flow and `/api/rooms` contracts are described below so transcription and detection modules can connect to them without changing room admission.

## Run locally on Windows

This laptop is configured for the **Hackathon LiveKit Cloud project**. The URL, API key, API secret and invitation signing secret are stored in `.env.local`, which Git and Vercel source uploads ignore. Do not share that file or put its values in frontend code.

Start the website:

```powershell
npm install
npm run dev
```

Open **http://localhost:3000**. Click **Create room**, copy the receiver invitation from room setup, then click **Join call**. The receiver can open the invitation directly or paste it into **Join a room** on the home screen, then join. During a call, the caller can open **Invite** to share again. Use headphones when testing on separate devices. `npm test`, `npm run typecheck` and `npm run build` check the project. While the app is running, `npm run test:api` checks the backend without printing credentials or participant tokens. Tests use Node.js 24's built-in TypeScript support.

### Call controls

Use the **Light / Dark** buttons in the header on home, room setup or during a call. The selected theme is saved in this browser and shared with other app tabs. Dark is the default. Changing theme does not disconnect a call.

The call console adapts to desktop and phone widths. It shows the other participant, connection status, elapsed time from when both people first join, room context, and an invitation dialog for the caller. The waveform below the timer analyses both LiveKit microphone tracks, moves when LiveKit detects speech, and labels whether you, the other participant, or both people are speaking. **Mute** controls your microphone. **Speaker** controls incoming audio through LiveKit's remote-track volume, independently of your microphone; it uses the browser's current output device and does not switch a phone between its earpiece and loudspeaker. If autoplay is blocked, use **Enable audio playback**. **End** disconnects the room and releases your microphone.

Teammates should copy `.env.example` to `.env.local`, use their project credentials, and generate a random `SESSION_SIGNING_SECRET` with the command in that file. A checksum-verified local server binary remains in the ignored `local-livekit/` folder as a development fallback. Its command is `.\local-livekit\livekit-server.exe --dev --bind 0.0.0.0`; use `ws://localhost:7880`, `devkey`, and `secret` only for that local server in development.

### Two physical devices

A second physical device needs an **HTTPS** address for the website and a **WSS** LiveKit endpoint it can reach. `localhost` on the second device refers to that device, and a plain LAN HTTP URL usually cannot request microphone access. A LiveKit Cloud project plus an HTTPS web deployment is the simplest next event setup. Set `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` for the server, and set `LIVEKIT_PUBLIC_URL` if the browser should use a different WebSocket URL. Restart the app after changing `.env.local`.

The local development server and its `devkey` / `secret` pair are for testing only. Never deploy with those credentials.

## Join flow and backend contract

1. `POST /api/rooms` returns `{ roomId, callerAccessKey, inviteUrl }`. The caller access key is stored in that browser's `sessionStorage`. The invite URL carries the receiver's access key.
2. `POST /api/rooms/join` accepts `{ roomId, accessKey }` and returns `{ token, serverUrl, role, roomId }` after the server assigns the participant role. Invalid/expired access returns HTTP 403.
3. The browser connects using the short-lived, room-specific LiveKit token. The API key and secret remain on the server.

For the transcription teammate: the caller participant identity is `caller-${roomId}` and the receiver identity is `receiver-${roomId}`. A future worker should subscribe only to the caller's actual microphone track. The UI currently does not send transcript or warning events.

Invitations are signed on the server and expire after two hours. They work across restarts and separate Vercel instances as long as `SESSION_SIGNING_SECRET` stays the same. No database is needed for this audio milestone. Role and room changes invalidate the signature; the browser cannot choose a role. Each role has one LiveKit identity, so joining that same role again replaces its previous connection. Links grant receiver access to whoever has them: share them with the intended participant. Invitations cannot be individually revoked in this milestone; rotating the signing secret invalidates all invitations, and LiveKit tokens already issued can still be used until their 30-minute expiry.

Live website: **https://call-safety-islamabad-hack2026.vercel.app**. See [DEPLOYMENT.md](DEPLOYMENT.md) for the linked Vercel project and redeployment settings.

## Scope and verification

- Implemented: room creation, server-issued role tokens, caller/receiver joining, microphone publication, remote audio playback, participant status, timer, live speech waveform, microphone mute, Speaker on/off, end-call, and invitation copying in a responsive call console.
- Not yet implemented: live transcription, scam/threat detection, warning delivery, call recording, or mobile-number calling.
- Verified with LiveKit Cloud: Cloud API authentication passed. Two browser tabs joined the same Cloud room and Cloud reported an unmuted microphone track from each participant. The connected call rendered a 17-band analyser for each side and exposed the current LiveKit speaking state. Receiver mute changed its Cloud track to muted; both participants ended cleanly. The receiver's remote audio element was playing and ready. The production build and TypeScript checks pass. Signed-invitation tests reject altered roles, signatures, rooms, malformed input and expiry, and validate invitations in a separate process. The API smoke test created a room on the production server (port 3001) and issued caller/receiver tokens on the separate development server (port 3000), with microphone-only publication grants. Physical-device audibility and different-network testing are the post-deployment checks.

The planning documents are [requiremnts.md](requiremnts.md), [design.md](design.md), and [tasks.md](tasks.md).
