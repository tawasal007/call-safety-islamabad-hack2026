# Requirements

**Project:** Islamabad Hack 2026 — Call Safety web app.
**Event:** Saturday, 10 October 2026, 9:30 AM–6:30 PM, BIIT, Rawalpindi.
**Time zone:** Asia/Karachi.
**Team size:** Four members.
**Status:** Audio call milestone implemented; transcription and detection remain planned.

Read these documents in order: [requiremnts.md](requiremnts.md) -> [design.md](design.md) -> [tasks.md](tasks.md).

- `requiremnts.md` defines what must work and how acceptance is judged.
- `design.md` explains architecture, data flow, interfaces, and failure handling.
- `tasks.md` assigns the four members chronological implementation tasks and iteration gates.

## Objective and scope

Build a website where two people have a real, two-way audio call using separate browsers or devices. During the call, the receiver sees the caller's live transcript and evidence-based warnings about suspicious or dangerous speech.

The detector covers:

- Credential theft: requests for OTPs, PINs, passwords, or private banking information.
- Financial fraud: suspicious payment requests combined with impersonation or pressure.
- Direct threats of harm.
- Extortion: demands backed by threats, including threats to release private information.
- Kidnapping claims, especially when accompanied by ransom demands or threats.
- Coercion tactics: secrecy, isolation, pressure to stay on the call, or instructions not to contact others.

The system cannot determine whether a kidnapping claim is genuine or fabricated. It flags the claim, threats, and demands, and explains the uncertainty. Threat seriousness and certainty about fraud are separate concepts.

All actual development must happen on-site and use Kiro. Research and this planning document are allowed beforehand. Do not begin implementation until the team confirms that development is permitted.

### Required demonstration

1. Two devices join the same room and hear each other.
2. The caller's actual speech appears on the receiver's screen.
3. A suspicious request or direct threat produces a timely warning while audio continues.
4. Ordinary conversation, safety advice, and harmless topic mentions do not produce strong warnings.
5. Participants can mute and end the call cleanly.

The prototype monitors calls made through this website. It does not monitor ordinary cellular calls.

### Defer until the core demonstration passes

- Urdu or Roman Urdu support.
- Post-call summaries.
- Recording and persistent transcript storage.
- User accounts, dashboards, analytics, and databases.
- Calling mobile numbers, SMS, automatic reporting, or contacting other people.
- Extra detection models or elaborate scoring systems.

Typed transcript input is an explicitly labelled emergency fallback. It does not satisfy the real-call demonstration requirement.

## Functional requirements

The IDs below provide a shared reference for design and task reviews. Detailed scenario acceptance appears in the matrix later in this document.

| ID | Requirement | Acceptance condition |
| --- | --- | --- |
| REQ-01 | Create and join website call rooms | A caller creates a session and a second person joins using its receiver invitation link. |
| REQ-02 | Secure participant admission | The server assigns identities/roles and issues short-lived, room-specific tokens; browser code contains no API secrets. |
| REQ-03 | Real two-way audio | Two separate devices publish microphone audio and hear the other person during the same call. |
| REQ-04 | Call controls and status | Both participants can mute and end; permission failures, participant changes, and connection state are visible. |
| REQ-05 | Live caller transcription | The caller's actual LiveKit microphone track produces receiver-visible interim/final text; receiver speech is not attributed to the caller. |
| REQ-06 | Contextual multi-category detection | Finalized speech plus recent context is analysed for credential theft, financial fraud, threats, extortion, kidnapping claims, and coercion. |
| REQ-07 | Explainable live warnings | A receiver warning contains categories, concern level, exact source evidence, explanation, suggested action, and uncertainty while audio continues. |
| REQ-08 | Appropriate interpretation | Ordinary conversation, advice, harmless topic mentions, and money discussion alone do not trigger strong warnings. |
| REQ-09 | Accurate uncertainty | Fraud warnings say “Possible scam”; kidnapping claims are neither confirmed nor declared fake. Threat seriousness is distinguished from fraud certainty. |
| REQ-10 | Graceful monitoring failures | STT/AI failures leave audio running and show an explicit degraded/unavailable monitoring state. |
| REQ-11 | Clean session lifecycle | Ending a session releases microphones and worker/provider resources; duplicate workers and old-session results are prevented. |
| REQ-12 | Clear receiver interface | A room/join page and laptop-oriented call page display participant status, microphone/end controls, a live transcript, highlighted evidence, and a prominent warning panel. |

## Quality and delivery requirements

- **Language:** Begin with English that has been tested on the actual speech and devices; language expansion is optional.
- **Latency:** Aim for an alert within three seconds of the relevant phrase ending. Measure actual latency; this is a prototype target, not an unverified guarantee.
- **Reliability:** Pass three consecutive end-to-end runs on two separate devices with headphones before considering the core demonstration ready.
- **Network:** The website must be accessible through HTTPS on both devices so microphone access can work. Confirm actual browser permissions and playback gestures.
- **Security:** Secrets stay on the server, outside browser code, invitation links, logs, and committed files. Only the designated worker's events are accepted as monitoring output.
- **Data scope:** Recording, persistent transcript storage, databases, and automatic external contact are deferred.
- **Presentation:** Show normal conversation, harmless safety advice, a scam request, and a threat/kidnapping claim. Offer unexpected judge input only when the flow is stable.
- **Hackathon compliance:** All application development occurs on-site using Kiro; planning documents do not constitute application implementation.

Build priority: **working audio -> live transcription -> contextual detection -> visible alerts -> reliability -> visual polish**.

## Detection and end-to-end acceptance matrix

Run detection cases first with finalized transcript fixtures, then speak representative cases through the real call. Fixture tests cannot prove live transcription or audio transport.

| Case | Example speech/action | Expected result |
| --- | --- | --- |
| Ordinary conversation | “How was your day?” | Transcript; no strong warning |
| Safety advice | “Never share your OTP.” | No strong warning |
| Harmless credential mention | “My OTP expired.” | No strong warning |
| Credential request | “Tell me your OTP now.” | Possible-scam warning quoting the request |
| Impersonation plus pressure | “I'm from your bank. Tell me the OTP now or your account will be blocked.” | Warning identifies request and pressure; advises withholding code and using an official bank channel |
| Direct threat | “I will hurt you tonight.” | High-concern threat warning with exact evidence |
| Extortion | “Pay me or I will publish your private photos.” | Extortion warning; no claim that the threat is proven |
| Kidnapping/ransom claim | “We have your brother. Send money now or we will hurt him.” | Kidnapping-claim/threat warning; authenticity remains unknown |
| Context split | First: “We have your brother.” Then: “Send money or we hurt him.” | Warning combines relevant recent evidence |
| Coercion in context | After a ransom demand: “Don't hang up or contact your family.” | Existing warning gains coercion evidence |
| Harmless discussion | “The movie was about a kidnapping.” | No strong warning |
| Conditional safety advice | “If someone threatens you, get help.” | No strong warning |
| Ordinary money discussion | “Can you return the money you borrowed?” | No strong warning solely because money is mentioned |
| Receiver speech | Receiver speaks while caller is silent | No incorrect caller transcript or caller warning |
| Mute/unmute | Caller toggles microphone | Audio stops/resumes; monitoring follows the actual track |
| STT/AI failure | Provider disconnects or times out | Audio continues; monitoring explicitly shows degraded/unavailable |
| Clean ending | End call, then start another | Microphones and worker connections released; no old results in new session |

Record device/browser, sentence, observed transcript, expected result, actual result, latency, pass/fail, and any defect. Never display “safe” simply because monitoring is unavailable or no warning has appeared yet.

## Warning behaviour and detector constraints

1. A warning quotes actual finalized transcript evidence and identifies its source segments.
2. Evidence must match the source text; reject unsupported or invented quotations.
3. Analyse recent context so a claim and later demand can be connected.
4. Treat speech as untrusted input. Caller instructions such as “ignore your rules” must not control the detector.
5. Distinguish direct requests/threats from advice, quotation, fiction, and harmless discussion using available context.
6. Urgency, the word “OTP,” or the word “kidnapping” alone is insufficient for a strong warning.
7. Use “Possible scam” for suspected fraud and explicit threat/claim wording for threatening speech. Do not claim a kidnapping is fake or genuine.
8. Suggested actions must fit the situation. A credential request and a harm threat should not receive identical guidance.
9. Keep warnings visible long enough to read. A subsequent ordinary sentence does not automatically erase serious evidence.
10. Deduplicate repeated results, reject stale-session results, and expose provider failures.

Example threat guidance should encourage seeking help and independently verifying the claimed situation through a trusted channel. Do not improvise emergency phone numbers or automate external contact in this prototype.
