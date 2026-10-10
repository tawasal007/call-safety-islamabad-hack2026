# Tasks

**Project:** Islamabad Hack 2026 — Call Safety web app.
**Event:** Saturday, 10 October 2026, 9:30 AM–6:30 PM, BIIT, Rawalpindi.
**Time zone:** Asia/Karachi.
**Team size:** Four members.
**Status:** Audio call milestone implemented; transcription and detection remain planned.

Read these documents in order: [requiremnts.md](requiremnts.md) -> [design.md](design.md) -> [tasks.md](tasks.md).

- `requiremnts.md` defines what must work and how acceptance is judged.
- `design.md` explains architecture, data flow, interfaces, and failure handling.
- `tasks.md` assigns the four members chronological implementation tasks and iteration gates.

## How to execute this task list

**First task:** Confirm on-site development permission and the actual judging deadline, then verify LiveKit runtime access. Establish the two-person audio call before implementing transcription or detection.

The iteration/task IDs are execution references. Within an iteration, follow dependency order; rows explicitly marked parallel may be done simultaneously by their assigned human team members. Every iteration includes an individual sequence for each of the four members.

Review [requiremnts.md](requiremnts.md) for acceptance criteria and [design.md](design.md) for interfaces before writing code. Mark task completion in the team tracker only after its stated output works; save a working checkpoint at every gate. All tasks below are planned, not completed.

## Team roles and ownership

Replace Member 1–4 with actual names before starting. Each member uses Kiro for development and owns a clear set of files or modules.

| Member | Primary responsibility | Owns | Secondary responsibility |
| --- | --- | --- | --- |
| Member 1 | Frontend and receiver experience | Room/join page, call page, audio playback UI, transcript and warning components | Integrates the main demo and presents the receiver's screen |
| Member 2 | Backend and LiveKit calling | Room/session APIs, token generation, role assignment, service configuration, worker startup and shutdown | Integration coordinator, secrets, HTTPS access, caller device |
| Member 3 | Audio transcription | Silent worker, caller-track subscription, STT stream, transcript events, worker cleanup | Measures transcript latency and helps investigate audio failures |
| Member 4 | Detection and quality assurance | Contextual AI detector, output validation, detection test cases, final test record | Pitch, warning wording, demo script, independent end-to-end testing |

Member 2 coordinates integration; this does not prevent anyone from reporting problems or reviewing changes. Members 1 and 2 establish the audio call together. Members 3 and 4 support testing and service preparation until their feature gates open.

### Collaboration rules

1. Agree on API and event contracts before different members build connected modules.
2. Avoid editing the same file simultaneously. Announce shared-file edits first.
3. Use small commits after each working gate. Never commit credentials.
4. If using Git branches, use `codex/frontend`, `codex/backend`, `codex/transcription`, and `codex/detection`. Merge and run the integration checks at every gate.
5. On a shared checkout, use file ownership instead of having multiple people switch its branch. Separate clones or worktrees are needed for simultaneous branch work.
6. One person owns dependency and lockfile changes at a time; coordinate package additions with Member 2.
7. The integrated application remains runnable after each milestone. Work on optional features only after the required flow passes.

## Event schedule and iteration gates

These timeboxes fill the nine-hour event. Confirm the actual judging slot with organisers in Iteration 0. Bring rehearsal and feature freeze forward if presentations begin earlier. Take short, staggered breaks without leaving a critical integration task unattended.

| Iteration | Time | Result | Gate |
| --- | --- | --- | --- |
| 0 | 9:30–10:00 | Verified access, agreed contracts, Kiro workspace ready | Provider status and first implementation task are clear |
| 1 | 10:00–11:30 | Working two-person audio call | Two devices hear each other, mute, and end cleanly |
| 2 | 11:30–13:00 | Caller speech transcribed live | Actual caller audio appears on receiver screen |
| 3 | 13:00–14:15 | Contextual scam/threat detection | Positive and negative detection cases pass |
| 4 | 14:15–15:00 | Integrated evidence-based warning | Spoken suspicious sentence triggers visible alert during call |
| 5 | 15:00–16:15 | Reliability and recovery | Full flow passes repeatedly on two devices |
| 6 | 16:15–17:00 | Presentation-ready interface | Clear laptop layout; mandatory functionality remains intact |
| 7 | 17:00–17:45 | Rehearsed demonstration and pitch | Repeatable demo ready for judging |
| 8 | 17:45–18:30 | Buffer and final handover | Fixes only; preserve the last working version |

Iterations are dependency gates. If a gate fails, repair it before implementing the next feature. Other members can continue research, test planning, documentation, or preparation that does not depend on the failed stage.

## Chronological tasks within each iteration

### Iteration 0 — Access, scope, and setup

**Do first:** Confirm on-site development permission and the judging deadline, then verify LiveKit runtime access. Do not start by designing the landing page or building the detector.

| Order | Owner | Task | Output / dependency |
| --- | --- | --- | --- |
| 0.1 | All members | Confirm permission, judging time, four roles, and the mandatory demonstration | Shared scope and deadlines |
| 0.2 | Member 2 | Open the project workspace in Kiro; verify Git, Node, package manager, and internet | Working development environment |
| 0.3 | Member 2 | Check LiveKit project URL, API key/secret availability, permissions, and runtime allowance; make an authenticated server check | Calling access confirmed; never print secrets |
| 0.4, parallel with 0.3 | Member 3 | Verify an available streaming STT route: LiveKit Inference if accessible, otherwise a provider with usable credentials; test a short sample | STT route and supported English model confirmed |
| 0.5, parallel with 0.3 | Member 4 | Verify AI provider credentials, model access, usable allowance, and a tiny structured-response request | Detection runtime confirmed |
| 0.6, parallel with 0.3 | Member 1 | Check both devices, browsers, headphones, microphone permission, and the plan for an HTTPS application address | Hardware/network test checklist |
| 0.7 | Members 2, 3, 4 | Agree on session, role, transcript, warning, status, and shutdown contracts | Written interface agreement |
| 0.8 | All members | Record access as verified / unavailable / unknown; pick the simplest confirmed provider route | Iteration 1 ready |

**Per-member sequence:** Member 1: devices -> HTTPS plan -> UI outline. Member 2: Kiro -> LiveKit -> contracts -> integration setup. Member 3: STT access -> sample request -> transcript contract. Member 4: AI access -> sample request -> test cases and warning wording.

**Gate:** LiveKit access must be confirmed to test the real call. Missing STT or AI access is escalated to organisers immediately while the audio milestone proceeds. Do not purchase services without an explicit team decision.

### Iteration 1 — Establish the real two-person audio call

| Order | Owner | Task | Output / dependency |
| --- | --- | --- | --- |
| 1.1 | Member 2 | Create the minimal project in Kiro, configure ignored environment files, and start the server | Runnable foundation |
| 1.2 | Member 2 | Implement room/session creation, participant admission, and secure token endpoints | Server API ready |
| 1.3, after 1.1 | Member 1 | Build minimal room creation and join controls | Basic entry page |
| 1.4, after 1.2 and 1.3 | Members 1 and 2 | Connect caller and receiver to the same LiveKit room with distinct identities | Both participants connected |
| 1.5 | Member 1 | Publish microphone audio, play remote audio, and handle playback permission | Real two-way sound |
| 1.6 | Member 1 | Add mute, end-call, participant status, and permission/error feedback | Usable call controls |
| 1.7, parallel support | Member 3 | Observe track identity, mute, and disconnect behaviour; document how the future worker will select the caller | Caller-track mapping ready |
| 1.8, after 1.5 | Member 4 | Independently test on two devices with headphones; record results for join, both audio directions, mute, and end | Acceptance evidence |
| 1.9 | All members | Fix failures, repeat the call, and save a working milestone | Audio gate passed |

**Per-member sequence:** Member 1: entry page -> connection -> audio -> controls. Member 2: foundation -> secure APIs -> connection support -> checkpoint. Member 3: caller identity -> track observations -> worker integration notes. Member 4: test script -> two-device checks -> defect report -> retest.

**Gate:** Both people hear each other on separate devices. Mute stops outgoing audio; end-call releases the microphone and updates the other participant. Do not proceed based only on two tabs showing “connected.”

### Iteration 2 — Add live transcription of the caller

| Order | Owner | Task | Output / dependency |
| --- | --- | --- | --- |
| 2.1 | Members 2 and 3 | Define worker startup and one-worker-per-session behaviour; pass the trusted caller identity | Worker lifecycle interface |
| 2.2 | Member 3 | Connect a silent worker to the room and subscribe only to the caller's microphone track | Actual caller audio received |
| 2.3 | Member 3 | Feed audio to the confirmed streaming STT service with the required sample format | Live transcript produced |
| 2.4, after 2.1 | Member 2 | Integrate worker startup and monitoring status with session APIs | Automatic monitoring startup |
| 2.5, after 2.3 | Member 3 | Emit segment IDs and interim/final updates; handle duplicate/repeated updates | Transcript event contract implemented |
| 2.6, after 2.5 | Member 1 | Render transcript updates; replace interim text with final text; keep the latest speech visible | Receiver sees live text |
| 2.7, parallel preparation | Member 4 | Finalize detector categories and positive/negative cases; collect representative finalized transcripts | Detection specification ready |
| 2.8 | Members 3 and 4 | Speak ordinary English phrases on the caller device; measure latency; ensure receiver speech is excluded | Real-track transcription verified |
| 2.9 | All members | Fix transcription issues and save the working call-plus-transcript milestone | Transcription gate passed |

**Per-member sequence:** Member 1: event listener -> transcript rendering -> interim replacement -> UI verification. Member 2: worker lifecycle -> startup/status integration -> shutdown support. Member 3: room subscription -> audio conversion -> STT -> events -> latency. Member 4: detection cases -> observed transcripts -> independent verification.

**Gate:** Caller speech appears on the receiver's screen during the real call. Receiver speech is not incorrectly attributed to the caller. Transcription disconnects produce an explicit status rather than silent failure.

### Iteration 3 — Implement contextual detection

| Order | Owner | Task | Output / dependency |
| --- | --- | --- | --- |
| 3.1 | Member 4 | Implement one detector covering credential theft, financial fraud, threats, extortion, kidnapping claims, and coercion | Detection function/service |
| 3.2 | Members 3 and 4 | Pass finalized segments plus bounded recent context to detection; keep raw audio outside this AI request | Contextual input pipeline |
| 3.3 | Member 4 | Require structured output; validate categories, concern level, source segments, and exact quoted evidence | Safe, displayable result |
| 3.4 | Member 4 | Add timeout, malformed-output, and provider-failure handling; treat transcript text as untrusted content | Explicit unavailable state |
| 3.5, after 3.2 | Member 3 | Queue analysis separately from audio/STT; prevent duplicate and out-of-order results | Audio and transcription remain responsive |
| 3.6, parallel with 3.1 | Member 1 | Build the warning panel using labelled sample fixtures; define empty, warning, and unavailable states | UI ready for real results |
| 3.7, parallel with 3.1 | Member 2 | Review secrets, worker identity, event recipients, session association, and request boundaries | Integration/security checks |
| 3.8 | Member 4, reviewed by team | Run the full positive/negative matrix; correct instructions or context handling for observed failures | Detection gate passed |

**Per-member sequence:** Member 1: panel layout -> states -> evidence display. Member 2: server boundary review -> event routing -> integration readiness. Member 3: context buffer -> analysis queue -> stale-result handling. Member 4: detector -> validation -> failure handling -> test matrix.

**Gate:** Both scam requests and direct threats are detected; harmless advice and topic mentions do not generate strong warnings. Kidnapping claims are never declared fake or confirmed by the system. Fixtures support UI development only and must be replaced before the live-alert gate.

### Iteration 4 — Connect real warnings to the receiver

| Order | Owner | Task | Output / dependency |
| --- | --- | --- | --- |
| 4.1 | Members 2 and 3 | Deliver validated warning events from the worker to the designated receiver | Real warning transport |
| 4.2 | Member 1 | Validate expected worker identity/session and display real detection results | Live risk panel |
| 4.3 | Member 1 | Highlight exact evidence in finalized transcript segments; support evidence across multiple segments | Visible reasoning |
| 4.4 | Members 1 and 4 | Distinguish fraud uncertainty from threat seriousness; display appropriate warning wording and action | Accurate receiver guidance |
| 4.5 | Members 3 and 4 | Deduplicate repeated warnings and update related evidence without flooding the interface | Stable alerts |
| 4.6 | Member 4 | Run spoken normal -> scam -> threat/kidnapping scenarios; measure phrase-end-to-alert latency | Full live flow verified |
| 4.7 | All members | Resolve integration failures and save the first complete core demonstration | Live-alert gate passed |

**Per-member sequence:** Member 1: real event subscription -> warning display -> highlights -> wording. Member 2: routing -> trusted worker/session review -> integration support. Member 3: warning publication -> deduplication -> latency observations. Member 4: wording review -> spoken tests -> results record.

**Gate:** A real spoken suspicious sentence produces a receiver warning while the call continues. Aim for a warning within three seconds of the relevant phrase ending; record actual performance rather than promising an unmeasured guarantee.

### Iteration 5 — Reliability, recovery, and final acceptance

| Order | Owner | Task | Output / dependency |
| --- | --- | --- | --- |
| 5.1 | Member 4 | Run the complete acceptance matrix on two devices and record reproducible defects | Prioritized defect list |
| 5.2 | Member 2 | Test invalid/expired invitations, duplicate joins, session ending, and a fresh call after ending | Backend lifecycle fixes |
| 5.3 | Member 3 | Test caller mute/unmute, caller disconnect, worker reconnect, STT failure, and stream cleanup | Worker lifecycle fixes |
| 5.4 | Member 1 | Test microphone denial, playback prompts, reconnecting status, scroll behaviour, and stale UI updates | Frontend recovery fixes |
| 5.5 | Members 3 and 4 | Test AI timeout/failure, partial sentences, cross-segment threats, and repeated requests | Detection recovery fixes |
| 5.6 | All members | Fix mandatory-flow defects first; retest each changed path and the complete call | Regression check |
| 5.7 | Member 4 | Complete three consecutive end-to-end runs with no manual repair | Reliability gate passed |
| 5.8 | Member 2 | Save the known working checkpoint and document restart steps | Feature freeze |

**Per-member sequence:** Member 1: permission/reconnect checks -> fixes -> regression test. Member 2: admission/end checks -> fixes -> checkpoint. Member 3: mute/disconnect/provider checks -> cleanup fixes -> retest. Member 4: matrix -> prioritized defects -> detection failures -> three full runs.

**Gate:** Mandatory tests pass repeatedly. After this gate, add no optional features unless the entire team agrees that the judging deadline and buffer allow them.

### Iteration 6 — Visual polish and presentation preparation

| Order | Owner | Task | Output / dependency |
| --- | --- | --- | --- |
| 6.1 | Member 1 | Improve laptop readability, contrast, participant labels, control sizing, and warning prominence | Presentation-ready interface |
| 6.2 | Member 4 | Edit warning copy for clarity and uncertainty; write the short pitch and demo transitions | Presentation script |
| 6.3 | Member 2 | Verify the actual presentation URL, HTTPS, runtime configuration, and clean startup commands | Deployment/startup readiness |
| 6.4 | Member 3 | Check worker stability and monitoring status after frontend changes | Runtime readiness |
| 6.5 | All members | Repeat the core demo after polish; remove misleading placeholders or unsupported claims | Presentation gate passed |

**Per-member sequence:** Member 1: readability -> controls -> alert emphasis -> verification. Member 2: HTTPS -> configuration -> startup notes. Member 3: worker health -> final monitoring check. Member 4: copy -> pitch -> final claim review.

**Gate:** The receiver screen is readable from a presentation distance and the core flow still works.

### Iteration 7 — Rehearse the judge demonstration

| Order | Owner | Task | Output / dependency |
| --- | --- | --- | --- |
| 7.1 | Member 4 | Deliver the problem statement and explain the website-call boundary | Clear opening |
| 7.2 | Members 1 and 2 | Join as receiver and caller on separate devices; show two-way audio | Real call proof |
| 7.3 | Member 2 | Speak ordinary conversation followed by harmless OTP advice | False-positive demonstration |
| 7.4 | Member 2 | Speak the bank impersonation and OTP request | Scam warning demonstration |
| 7.5 | Member 2 | Use a fresh room for the kidnapping/extortion scenario so warnings are easy to attribute | Threat warning demonstration |
| 7.6 | Member 1 | Point out the exact evidence, concern, uncertainty, and suggested action | Explainable result |
| 7.7 | Member 3 | Observe service health and latency; support an unexpected judge sentence if runtime remains stable | Technical support |
| 7.8 | Members 1 and 2 | End the call and show clean disconnection | Lifecycle proof |
| 7.9 | Member 4 | Explain limitations and next steps within the allotted presentation time | Honest closing |

**Per-member sequence:** Member 1: receiver setup -> explain evidence -> end call. Member 2: caller setup -> normal/advice/scam speech -> fresh-room threat speech -> end call. Member 3: worker check -> monitor -> support unexpected input. Member 4: opening -> guide transitions -> limitations/closing.

**Gate:** Everyone knows their role; the demonstration fits the actual judging slot. Rehearse the core scenario twice.

### Iteration 8 — Buffer, final checks, and handover

| Order | Owner | Task | Output / dependency |
| --- | --- | --- | --- |
| 8.1 | Member 2 | Preserve the latest verified version; make only necessary fixes | Stable presentation build |
| 8.2 | Members 1 and 3 | Confirm devices, headphones, microphone access, website, and worker health | Final readiness |
| 8.3 | Member 4 | Confirm script, test record, limitations, and project submission requirements | Submission readiness |
| 8.4 | All members | Submit required repository/project details and present when called | Event handover |

**Per-member sequence:** Member 1: device/UI readiness -> receiver presentation. Member 2: checkpoint -> server readiness -> caller presentation. Member 3: worker readiness -> monitoring support. Member 4: submission details -> pitch -> test evidence.

**Gate:** No last-minute optional feature additions. Revert a broken change to the verified checkpoint when time is insufficient to repair and retest it.

## Kiro working sequence

For every milestone: give Kiro the bounded requirements -> inspect its proposed changes -> implement in Kiro -> run the stated checks -> record results -> save the working checkpoint.

### First implementation instruction, once development is authorised

> Implement only the first audio-call milestone in this workspace. Build a minimal Next.js/TypeScript website with server-side LiveKit room/session and token handling, server-assigned caller/receiver identities, a receiver invitation link, microphone audio publishing, remote audio playback, participant status, mute, and end-call. Keep API secrets on the server and out of Git. Include clear configuration and permission errors. Do not implement transcription, detection, summaries, or elaborate styling yet. Explain how we will test a real two-way call on two separate devices using HTTPS and headphones.

### Subsequent milestones

1. After the audio gate: implement the silent caller-only transcription worker and live transcript display.
2. After the transcription gate: implement one contextual, multi-category detector and validate its structured output against exact transcript evidence.
3. After detection tests pass: integrate trusted warning events, evidence highlighting, concern levels, and uncertainty wording.
4. After the full spoken flow passes: fix recovery and cleanup, then polish the interface and rehearse.

Each member works only within the agreed milestone and ownership boundaries. Sample data used to develop a component must be visibly labelled and removed from the primary demo path before its integration gate.

## Current readiness and final delivery checklist

Read-only checks at handover found Kiro 1.2.37, Node 24.14.0, npm 11.9.0, Python 3.14.3, and Git installed. The workspace contains an empty Git repository. No relevant service credentials were found in the workspace or checked process/user/machine environment scopes. Account access and runtime credits are unverified; absence of local credentials does not prove absence of an account.

### Access checklist

- [ ] On-site development permission confirmed for the actual implementation start.
- [ ] Actual judging deadline recorded.
- [ ] LiveKit project and authenticated server access verified.
- [ ] Streaming STT access, English model, and usable runtime allowance verified.
- [ ] AI model access and usable runtime allowance verified.
- [ ] Supported worker runtime/SDK versions confirmed.
- [ ] HTTPS address reachable from both devices.
- [ ] Two devices and headphones ready.

### Final delivery checklist

- [ ] All project development performed on-site using Kiro.
- [ ] Two-person audio call demonstrated on separate devices.
- [ ] Caller-only live transcription demonstrated from actual room audio.
- [ ] Scam/credential request warning demonstrated.
- [ ] Threat or kidnapping/extortion claim warning demonstrated.
- [ ] Harmless advice and topic mentions tested without strong warnings.
- [ ] Exact evidence, explanation, suggested action, and uncertainty visible.
- [ ] Monitoring failures shown explicitly while the call continues.
- [ ] Mute, end-call, and worker cleanup verified.
- [ ] Three consecutive complete runs passed.
- [ ] Startup/restart instructions, configuration names, and test results documented.
- [ ] Secrets excluded from browser code, logs, links, and committed files.
- [ ] Known limitations and emergency fallback accurately described.
- [ ] Repository/project and submission requirements ready.
