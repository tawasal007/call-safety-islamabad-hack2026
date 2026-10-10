# Design

**Project:** Islamabad Hack 2026 — Call Safety web app.
**Event:** Saturday, 10 October 2026, 9:30 AM–6:30 PM, BIIT, Rawalpindi.
**Time zone:** Asia/Karachi.
**Team size:** Four members.
**Status:** Audio call milestone implemented; transcription and detection remain planned.

Read these documents in order: [requiremnts.md](requiremnts.md) -> [design.md](design.md) -> [tasks.md](tasks.md).

- `requiremnts.md` defines what must work and how acceptance is judged.
- `design.md` explains architecture, data flow, interfaces, and failure handling.
- `tasks.md` assigns the four members chronological implementation tasks and iteration gates.

## Architecture and module boundaries

Provisional stack: Next.js with TypeScript for the website and server endpoints, LiveKit for audio transport, and a persistent Python worker for transcription and detection orchestration. Confirm SDK compatibility and a supported Python version during setup; installed Python alone is not proof that the required packages support that version.

Choose the STT and AI providers after checking actual credentials, runtime access, credits, and a small successful request. Do not assume that Kiro credits provide external runtime API access.

| Module | Responsibility | Lead |
| --- | --- | --- |
| Configuration and access checks | Validate providers; load server secrets; report missing services | Member 2, with Members 3 and 4 |
| Room and participant management | Create sessions, produce invitation links, assign roles, issue restricted tokens | Member 2 |
| Two-way audio | Connect browsers, publish microphones, play remote audio, mute, disconnect | Member 1, with Member 2 |
| Silent transcription worker | Subscribe to the designated caller track and stream audio to STT | Member 3 |
| Transcript processing | Stable segment IDs, interim/final replacement, deduplication, rolling context | Member 3 |
| Detection | Multi-category analysis, context, exact evidence validation, concern level, action | Member 4 |
| Receiver display | Live transcript, evidence highlighting, warning panel, monitoring status | Member 1 |
| Session lifecycle | One worker per session, reconnection handling, resource cleanup | Member 2, with Member 3 |

### Data flow

```text
Caller browser microphone
        |
        v
LiveKit audio room ------------------> Receiver browser audio
        |
        v
Silent worker: subscribe to caller track only
        |
        v
Streaming STT
        |
        +---- interim/final transcript events ----> Receiver transcript
        |
        v
Finalized segment + recent conversation context
        |
        v
AI detector -> schema/evidence validation
        |
        v
Warning event -------------------------------> Receiver risk panel
```

The worker does not publish spoken audio. Transcription and detection failures must not terminate the two-person audio call.

### Contracts to agree during Iteration 0

| Contract | Minimum contents or behaviour |
| --- | --- |
| Create session | Server-generated session/room identity, caller admission, receiver invitation link |
| Join session | Valid invitation/admission, server-assigned role and participant identity, short-lived LiveKit token and server URL |
| Transcript event | Session ID, segment ID, caller identity, text, interim/final status, timestamp |
| Warning event | Session ID, warning ID, source segment IDs, categories, concern level, exact evidence, explanation, suggested action, uncertainty |
| Monitoring status | Connecting, active, degraded/unavailable, ended; separate from audio connection status |
| End session | Defined leave/end behaviour; stop monitoring and release resources for an ended session |

Use one supported LiveKit delivery mechanism for worker-to-receiver events, such as reliable data messages, and document its payloads. Do not add a second realtime transport unless the chosen mechanism fails a concrete requirement. Confirm current SDK support when implementation starts.

The server controls roles; a client-provided role alone is not authorization. The receiver accepts monitoring events only from the server-designated worker identity. Secrets never appear in browser code, invitation links, logs, or committed files.

## Runtime workflow

1. **Create:** The caller requests a session. The server creates its room/session identity, assigns caller admission, and returns a receiver invitation link.
2. **Join:** Each browser obtains its own restricted token through valid admission. The server determines identity and role.
3. **Connect audio:** Both browsers connect to LiveKit, request microphone permission, publish audio, and play the other person's track.
4. **Start monitoring:** The backend starts or dispatches one silent worker for the session, passing the designated caller and trusted worker identities.
5. **Subscribe:** The worker subscribes to the caller's microphone audio, without publishing spoken output or transcribing the receiver as the caller.
6. **Transcribe:** The worker sends correctly formatted audio to streaming STT. Interim text is replaced by finalized text using stable segment IDs.
7. **Display text:** Trusted transcript events reach the receiver and update the live transcript. Monitoring state is displayed separately from call connection state.
8. **Analyse:** Finalized segments and bounded recent context enter a separate detection queue so AI latency does not block audio or STT.
9. **Validate:** Validate the detector's structured result, exact evidence, source segments, session association, and result ordering. Reject unsupported quotations and stale results.
10. **Alert:** Send a validated warning to the receiver. Highlight evidence, show concern/category/explanation/action/uncertainty, and update related warnings without duplicating them.
11. **Recover:** Show provider failures explicitly while audio continues. Handle microphone changes, participant reconnects, and worker reconnection without starting duplicate workers.
12. **End:** Release browser audio tracks and provider connections, shut down monitoring for the ended session, and prevent further old-session updates.

### Receiver page structure

- Top: caller/receiver presence, call connection state, and separate monitoring status.
- Controls: microphone mute/unmute and clearly visible end-call action.
- Main area: live caller transcript with exact evidence highlights and a prominent risk panel.
- Panel states: waiting/monitoring, no suspicious request detected yet, warning, monitoring unavailable, and ended.
- An ordinary later sentence does not immediately erase a serious warning. “No suspicious request detected yet” does not assert that the call is safe.

### Lifecycle and runtime boundary

The website/server handles admission, session management, and browser delivery. The persistent worker handles subscribed room audio, STT, and detection orchestration. Keep the worker in a runtime that supports a long-lived process and live connections; do not assume an ordinary short-lived web request can host it.

Before implementation, agree whether the user action means leaving individually or ending the whole session. Whichever behaviour is selected, update participants clearly and clean up monitoring when the session ends. Define any brief reconnection grace period during Iteration 0; do not let it leave abandoned workers running indefinitely.

## Runtime and scope fallback decisions

| Problem | Immediate action | Scope consequence |
| --- | --- | --- |
| LiveKit credentials/access unavailable | Member 2 asks organisers for access immediately; investigate one feasible supported alternative with the team | Do not claim the real-call milestone passed; avoid spending the day on detection alone |
| Two-device microphone fails | Check HTTPS, permission, playback gesture, headset, and network; compare browsers | Fix calling before adding features |
| STT provider unavailable | Member 3 tries one confirmed alternate route; Member 2 helps with access | Typed input is emergency-only and labelled; core spoken demo remains incomplete |
| AI provider unavailable | Member 4 checks one confirmed alternate provider | A limited rule-based fallback may demonstrate selected cases, but must be labelled and its limitations stated |
| High transcript latency | Check audio format/network/stream configuration; use one tested English model | Defer language expansion |
| High detection latency | Reduce context/request size and avoid duplicate analyses; measure again | Keep core categories; defer summaries and extras |
| Too many false positives | Review negative cases, context, and structured output validation | Fix interpretation before visual polish |
| Feature deadline slipping | Remove optional features and use Iteration 8 buffer for mandatory failures | Preserve real audio, live text, evidence-based warnings, and end-call |

Investigate a blocker with a clear owner and a short timebox. Escalate unresolved access/network problems promptly; do not repeatedly switch the entire stack. Never present a fallback as the completed primary flow.

## Reference documentation

- [LiveKit rooms and room management](https://docs.livekit.io/intro/basics/rooms-participants-tracks/rooms/)
- [LiveKit access tokens and grants](https://docs.livekit.io/frontends/reference/tokens-grants/)
- [LiveKit streaming speech-to-text](https://docs.livekit.io/agents/models/stt/)
- [LiveKit text and transcriptions](https://docs.livekit.io/agents/multimodality/text/)
- [Browser microphone access and secure contexts](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)

Verify implementation details against the current documentation when development begins. Provider selection remains dependent on the team's actual runtime access.
