# Audio milestone setup status — 10 October 2026

## Deployed to Vercel

Production URL: **https://call-safety-islamabad-hack2026.vercel.app**

Project: `tawasal1/call-safety-islamabad-hack2026`. Deployment ID: `dpl_B86ZEzQH4BDuLJY9hNv1J9NyoVzx` (live voice waveform and light/dark themes).

- Existing Hackathon LiveKit Cloud project selected.
- Created a dedicated key named `Call Safety hackathon website`; previous key left intact.
- Saved Cloud credentials and a random invitation signing secret in ignored `.env.local`.
- Replaced the local in-memory invitation map with signed, two-hour invitations.
- Kept participant tokens room-specific, valid for 30 minutes, and restricted publication to the microphone.
- Production rejects the local development URL/key/secret combination.
- Prepared `.gitignore` and `.vercelignore` to exclude local credentials and development files.
- Prepared deployment settings and instructions in `DEPLOYMENT.md`.

## Verification completed

| Check | Result |
| --- | --- |
| LiveKit Cloud server API authentication | Passed |
| Two browser tabs in one Cloud room | Passed |
| Cloud sees both published microphone audio tracks | Passed, unmuted |
| Remote audio element | Playing, ready state 4 |
| Receiver mute reflected on Cloud track | Passed |
| Receiver and caller clean end-call UI | Passed |
| Signed invitations checked in separate Node process | Passed |
| Role/signature tampering, expiry and wrong room rejected | Passed |
| Production-create / development-join across app instances | Passed |
| Invalid API access and malformed input | HTTP 403 / HTTP 400 |
| TypeScript and Next.js production build | Passed |

Connected-call screenshot: `design-assets/livekit-cloud-call.png`.

## Phone-style UI update

Implemented the dark phone-style call screen, responsive circular controls, participant avatars, connection status and elapsed timer. The caller shares the receiver invitation through an accessible dialog. The room creation, invitation signing and token backend are unchanged.

Speaker on/off sets LiveKit remote-track volume to 1 or 0 independently of microphone mute. It uses the browser's current output device; physical earpiece/loudspeaker switching is not implemented.

Browser checks connected two participants through LiveKit Cloud, verified invitation copying, cycled Speaker off/on and microphone mute/unmute independently, and confirmed the receiver's end-call screen. Remote audio was playing with ready state 4. No browser errors were observed. Layouts fit desktop 1280×720, mobile 390×844 and compact mobile 360×740 without horizontal overflow. TypeScript and production compilation passed.

Implemented UI screenshots: `design-assets/phone-call-desktop.png` and `design-assets/phone-call-mobile.png`. Physical-device audibility remains a hands-on check.

The UI update is deployed at the production URL above. Vercel compilation passed, the live create/join API smoke test passed, and browser navigation from the live homepage displayed the new prejoin screen without browser errors. Live-screen screenshot: `design-assets/phone-call-live-prejoin.png`.

## Full interface redesign

Rebuilt the entire visitor experience around a restrained product-console direction: solid charcoal surfaces, warm neutral typography, muted red actions, and no bright gradients. The homepage now explains what works today, how the two-device demo runs, and which risk patterns the future safety layer will cover. The prejoin, live call, invite dialog, room context, and ended states use the same visual system.

The new interface preserves the room, token, invitation, LiveKit, microphone, Speaker, and end-call behavior. Two local browser sessions connected successfully after the redesign; the participant state updated to connected and Speaker remained independent of the microphone. Screenshots: `design-assets/redesign-home-desktop.png`, `design-assets/redesign-home-mobile.png`, and `design-assets/redesign-call-desktop.png`.

The redesign is live at the production URL. Vercel reported the deployment ready, the production API smoke test passed for both participant roles, and the live homepage created and opened a new signed room without browser errors. Production screenshot: `design-assets/redesign-live-home.png`.

## Remaining hands-on check

The active call now includes a 17-band live waveform driven by the actual local and remote LiveKit microphone tracks. LiveKit's speaking state selects the active track, changes the bars from idle grey to the theme's voice-activity color, and labels `You're speaking`, `<participant> is speaking`, or `Both are speaking`. The waveform remains still while nobody is speaking. Two browser tabs connected to the same local room with both microphone tracks enabled; both call screens rendered all 17 bands and the waiting/connected states correctly. The deployed production app also completed a two-browser call with both waveform instances present, no browser errors, and clean end-call behavior. The production API smoke test, TypeScript, signed-invitation tests, local build, and Vercel build pass.

Light/Dark theme controls are now available in every screen header. The choice persists in browser storage, initializes before content renders, and synchronizes across app tabs. Both palettes cover controls, dialogs, inputs, status messages and call UI. Switching themes during a connected two-browser call preserved the connection. Reload persistence, mobile layout and the production Light control were verified. Local and Vercel builds passed; production browser logs showed no errors. Screenshot: `design-assets/light-theme-live.png`.

Latest interface: a compact three-screen web app. Home has Create room and Join a room; room setup exposes the receiver invitation with a copy button and Join call; active call keeps Mute, Speaker, Invite and End controls. Marketing sections, interface mockups and roadmap content were removed. Room setup and active call share the existing room URL; server APIs are unchanged. Extra tabs are deferred.

Verification: invalid invitation input shows feedback without navigation; a valid invitation opens receiver setup; caller and receiver connected through LiveKit and both ended cleanly. Mobile layout checked at 390×844 without horizontal overflow. Local and Vercel production compilation passed. The public production homepage shows the compact app without browser errors. Screenshot: `design-assets/app-home-live.png`.

The Next.js production deployment and server variables are configured. Public API checks passed at the production domain without any Vercel authentication: room creation, both role tokens, microphone-only grants, no-store responses and invalid/malformed admission. Test the resulting HTTPS link on two physical devices with headphones, ideally on different networks. Physical audibility has not been verified by the automated browser checks.

This status covers the requested **two-person audio-call milestone**. Live transcription and scam/threat detection remain the next team milestones; the interface labels monitoring as inactive. No persistent transcription worker has been created.
