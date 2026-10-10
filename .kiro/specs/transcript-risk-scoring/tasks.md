# Implementation Plan: Transcript Risk Scoring

## Overview

Implement an advisory-only transcript risk pipeline in incremental layers. Python produces stable final-turn evidence with provenance; authenticated TypeScript intake accepts and sequences it; pure TypeScript modules build bounded context, detect and validate exact evidence, aggregate independent dimensions, and map advisories; durable repository, revision, and outbox boundaries ensure idempotence and stale-result safety; authorized APIs and UI deliver only current assessments. Test subtasks are marked `*` as workflow-optional but provide the full unit, property, integration, mocked-model, multilingual, negative-fixture, and end-to-end verification plan.

## Tasks

### Required Core Tasks

- [ ] 1. Establish versioned risk contracts, validation primitives, and shared fixtures
  - [ ] 1.1 Create the pure TypeScript risk domain contracts and schema codecs
    - Add versioned transport, accepted-segment, translation-provenance, citation, detector contribution, assessment, advisory, job, receipt, rejection, and processing-event types under `lib/risk/`.
    - Implement strict runtime parsing, source-provider-model allowlists, finite confidence/range checks, identifier/timestamp/length constraints, and Unicode code-point slicing/counting helpers without mutating evidence.
    - Define checked-in catalog and policy version constants so every persisted/delivered assessment is reproducible.
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 3.1, 3.8, 3.9, 7.8_

  - [ ]* 1.2 Add versioned multilingual and negative contract fixtures
    - Create shared JSON fixtures under `tests/fixtures/risk/v1/` for English Deepgram Nova-3 and Urdu/Punjabi Cartesia Ink Whisper payloads.
    - Include accurate, misleading, absent, code-switched, and source-disagreeing translations; Urdu, Shahmukhi/Gurmukhi Punjabi, combining marks, emoji, astral code points, and mixed digits.
    - Add positive scam/threat cases and negative legitimate-finance, quotation, negation, training, benign-urgency, ambiguity, refusal, and warning cases with fixed clocks and identifiers.
    - _Requirements: 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.11_

  - [ ]* 1.3 Write table-driven contract and schema unit tests
    - Cover malformed fields, invalid source tuples, confidence endpoints, non-finite numbers, non-final turns, timestamp/identifier/enumeration/length failures, and exact Unicode preservation.
    - Assert invalid input produces machine-readable rejection before either detector can run.
    - _Requirements: 1.2, 1.5, 1.6, 1.7, 1.8, 9.4, 10.1, 10.9_

  - [ ]* 1.4 Write property test for versioned envelope validity
    - **Property 1: Versioned envelope validity**
    - Generate valid envelopes and single/multiple-field corruptions for at least 100 seeded iterations; assert only fully valid final envelopes pass and detector spies remain untouched on rejection.
    - **Validates: Requirements 1.2, 1.6, 1.7, 1.8, 9.4**

  - [ ]* 1.5 Write property test for source combination allowlisting
    - **Property 2: Source combination allowlist**
    - Generate all supported and unsupported language/provider/model combinations and assert acceptance if and only if the tuple is explicitly allowed.
    - **Validates: Requirements 1.3, 1.4, 1.5**

- [ ] 2. Implement durable session, segment, revision, assessment, audit, and outbox boundaries
  - [ ] 2.1 Define the repository port and transactional domain operations
    - Add `RiskRepository` operations for durable session registration/lookup, atomic segment acceptance, snapshot loading by revision, outbox claiming, immutable assessment commit, latest-pointer compare-and-set, and processing-event recording.
    - Define uniqueness and identity keys for sessions, `(sessionId, segmentId)`, `(sessionId, sequence)`, outbox jobs, and assessments; raw request bodies must never cross the repository port.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.7, 2.8, 7.8, 9.5_

  - [ ] 2.2 Implement the local durable transactional repository and in-memory test adapter
    - Implement atomic digest-based deduplication, conflicting-duplicate rejection, trusted sequence assignment, monotonic revision advancement, immutable exact-evidence storage, and outbox insertion in one transaction.
    - Persist processing events for rejection, degradation, stale/context mismatch, prohibited action, and projection repair without storing credentials or transcript bodies in logs.
    - Implement idempotent job claiming and assessment identity/compare-and-set semantics; provide an in-memory adapter with identical observable behavior for deterministic tests.
    - _Requirements: 2.3, 2.4, 2.5, 2.7, 2.8, 3.1, 7.8, 9.4, 9.5, 9.6_

  - [ ]* 2.3 Write repository contract and transaction integration tests
    - Run one shared contract suite against in-memory and local durable adapters for uniqueness, rollback, duplicate receipts, revision snapshots, outbox claims/retries, immutable assessments, audit events, and latest-pointer compare-and-set behavior.
    - Exercise concurrent acceptance and repeated job delivery without requiring a server or external storage service.
    - _Requirements: 2.3, 2.4, 2.5, 2.7, 2.8, 7.8, 9.5, 10.1, 10.2, 10.9_

  - [ ]* 2.4 Write property test for intake idempotence and conflict safety
    - **Property 4: Intake idempotence and conflict safety**
    - Generate accepted segments, exact resubmissions, and one-field provenance/content changes; assert exact duplicates preserve sequence, revision, jobs, and detector counts while conflicts leave durable accepted state unchanged.
    - **Validates: Requirements 2.3, 2.4**

  - [ ]* 2.5 Write property test for monotonic accepted order
    - **Property 5: Monotonic accepted order**
    - Generate interleaved session submissions and import/replay sequences; assert positive unique per-session sequence/revision growth and `stale_sequence` rejection at or below each high-water mark.
    - **Validates: Requirements 2.5, 4.1**

- [ ] 3. Produce provenance-complete Python final turns and authenticate TypeScript intake
  - [ ] 3.1 Extract a side-effect-free Python final-turn payload builder
    - Update the worker boundary so `segmentId` and `eventAt` are captured once before translation and reused unchanged across HTTP retries.
    - Preserve exact STT source text, configured language/provider/model, speaker, optional finite confidence, and complete optional translation provenance; omit rather than invent failed translations.
    - Keep payload-builder imports independent of LiveKit startup and risk-scoring decisions.
    - _Requirements: 1.3, 1.4, 3.1, 3.3, 3.4, 3.7, 3.8, 3.9, 10.6, 10.7_

  - [ ] 3.2 Register risk sessions and issue signed room-scoped ingestion associations
    - Extend room creation/session infrastructure to durably register the `call-` session and configured language before dispatch.
    - Sign short-lived versioned session/language/expiry/nonce claims, place them in trusted dispatch metadata, and expose verification that does not disclose session existence.
    - _Requirements: 1.1, 2.1, 2.2_

  - [ ] 3.3 Implement authenticated transcript intake and atomic acceptance
    - Evolve `POST /api/internal/transcripts` to check the worker bearer credential before JSON parsing/logging, then validate the signed `X-Transcript-Session` association and bounded request body.
    - Stamp `receivedAt` from an injected server clock; validate finality, source tuple, session/language identity, timestamp skew, and complete source/translation provenance before repository acceptance.
    - Return stable `202` receipts for accepted/identical duplicate submissions, safe `rejected` records for validated failures, and invoke neither detector synchronously.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 2.1, 2.2, 2.3, 2.4, 2.6, 3.3, 3.4, 9.4_

  - [ ] 3.4 Make call-log projection an idempotent post-acceptance adapter
    - Project each accepted segment to existing local/private call logs by segment ID only after durable acceptance.
    - Ensure projection failure cannot roll back risk evidence or enqueue duplicate analysis; record a retryable repair event without exposing transcript text in operational logs.
    - _Requirements: 2.3, 3.1, 7.8_

  - [ ]* 3.5 Write Python payload and retry contract tests
    - Use standard-library `unittest`, fake translator/final-turn/HTTP sinks, and shared JSON fixtures to verify stable identity/time across retries, exact source preservation, provider/model mapping, confidence behavior, and complete/absent translation records.
    - Assert tests perform no audio, LiveKit room, worker-server, or network operation.
    - _Requirements: 3.1, 3.3, 3.4, 3.7, 3.9, 10.1, 10.2, 10.6, 10.7, 10.8_

  - [ ]* 3.6 Write authenticated intake route integration tests
    - Test timing-safe credential rejection, invalid/expired/wrong-room associations, source/session/language mismatch, +60-second and just-beyond timestamps, malformed/oversized bodies, finality, duplicates, conflicts, and detector non-invocation.
    - Use fake requests, signer, fixed clock, in-memory repository, and detector spies with no network.
    - _Requirements: 1.1, 1.5, 1.6, 1.8, 2.1, 2.2, 2.3, 2.4, 2.6, 9.4, 10.2, 10.9_

  - [ ]* 3.7 Write property test for session-language isolation
    - **Property 3: Session-language isolation**
    - Generate registered sessions, signed associations, and submission permutations; assert acceptance only when session identity and all language bindings agree.
    - **Validates: Requirements 2.1, 2.2**

- [ ] 4. Build immutable multilingual context, canonical mappings, and fingerprints
  - [ ] 4.1 Implement the pure bounded-context builder, canonicalizer, and fingerprint function
    - Load only segments accepted through the requested revision; sort by sequence, retain the newest 20, apply the newest-event 10-minute window, and evict oldest whole segments until source-plus-translation content is at most 20,000 code points.
    - Keep source and translation fields distinctly labeled; return `insufficient_context` for all-whitespace source evidence and `degraded_translation` metadata for missing Urdu/Punjabi translation.
    - Produce canonical token-to-original code-point mappings and a deterministic length-delimited SHA-256 fingerprint over unchanged ordered evidence, identity, and revision.
    - _Requirements: 3.1, 3.2, 3.7, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_

  - [ ]* 4.2 Write bounded-context, canonicalization, and fingerprint unit tests
    - Test 20/21 segments, exactly/over 10 minutes, 20,000/20,001 code points, whole-segment eviction, ordering, whitespace-only context, distinct translation fields, and fingerprint sensitivity.
    - Verify canonical spans reconstruct exact English, Urdu, Punjabi, combining-mark, emoji, and astral-code-point quotes from unchanged fields.
    - _Requirements: 3.2, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 10.11, 10.12_

  - [ ]* 4.3 Write property test for immutable multilingual evidence round trips
    - **Property 6: Immutable multilingual evidence round trip**
    - Generate Unicode source and optional translation strings and assert acceptance, storage, context building, and assessment serialization preserve them byte-for-byte/code-point-for-code-point without field conflation.
    - **Validates: Requirements 3.1, 4.6**

  - [ ]* 4.4 Write property test for canonical match traceability
    - **Property 7: Canonical match traceability**
    - Generate canonical matches across supported scripts and punctuation/whitespace variants; assert mapped original code-point spans reproduce the exact quote, segment, and evidence field.
    - **Validates: Requirements 3.2, 5.3, 5.5, 10.11**

  - [ ]* 4.5 Write property test for bounded-context invariants
    - **Property 10: Bounded context invariants**
    - Generate arbitrary accepted histories and assert order, newest-20 selection, ten-minute eligibility, whole-segment behavior, and the 20,000-code-point ceiling.
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 10.12**

  - [ ]* 4.6 Write property test for context fingerprint identity
    - **Property 11: Context fingerprint identity**
    - Assert repeated equal snapshots hash identically and that changing revision, ordered identity, sequence, source, or translation changes the canonical fingerprint preimage and resulting identity.
    - **Validates: Requirements 4.5, 10.19**

- [ ] 5. Implement deterministic detection and exact-evidence validation
  - [ ] 5.1 Create the versioned high-precision scam and threat rule catalog
    - Add checked-in rule definitions for impersonation, urgent transfer, OTP, credential, advance-fee, remote-access, coercion, intimidation, extortion, physical harm, and kidnapping claims across supported evidence languages/fields.
    - Encode explicit negation, quotation, training-context, refusal/warning, and speaker-attribution safeguards; associate only evidence-backed scam/harm floors.
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 10.3, 10.4, 10.5, 10.6, 10.7_

  - [ ] 5.2 Implement the pure deterministic detector
    - Evaluate source and translation independently, correlate only explicitly supported adjacent turns, preserve speaker/field identity, and emit candidate indicators with exact quotes and code-point spans.
    - Return an available empty contribution for no matches and a typed unavailable outcome on catalog/execution failure so floors are omitted and degradation can be recorded.
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.6, 9.3_

  - [ ] 5.3 Implement the shared exact-evidence validator and deterministic candidate validation
    - Validate segment membership, existing field, integer code-point bounds, exact quote reconstruction, and complete secondary translation provenance against immutable bounded context.
    - Validate deterministic candidates independently, discard/audit only invalid indicators, and ensure no invalid citation contributes a scam or harm floor.
    - _Requirements: 3.5, 5.3, 5.5, 6.6, 6.7, 7.6, 7.8, 10.8, 10.11_

  - [ ]* 5.4 Write deterministic detector and citation unit tests with multilingual positive and negative fixtures
    - Exercise every scam/threat category, source-versus-translation disagreement, code-switching, misleading translation, negation, quotation, training, benign urgency, ambiguity, refusal/warning speech, speaker attribution, malformed offsets, and detector failure.
    - Assert every retained floor has valid exact evidence and every discarded candidate is excluded without suppressing valid siblings.
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.11_

  - [ ]* 5.5 Write property test for independent deterministic evidence fields
    - **Property 12: Independent deterministic evidence fields**
    - Generate matching/nonmatching source and translation pairs; assert each match remains attributed to its actual field and equivalent text in another field neither relabels nor erases it.
    - **Validates: Requirements 5.1, 5.2, 5.3**

- [ ] 6. Add the constrained contextual detector adapter and all-or-nothing result validation
  - [ ] 6.1 Define the contextual port, strict result schema, and safe request builder
    - Serialize only public bounded evidence/provenance as JSON in a clearly delimited `untrusted_transcript_evidence` structure with static versioned control instructions.
    - Require strict structured output for separate risk dimensions, citations, known rationale codes, expected fingerprint/revision, and model ID; reject unknown fields/actions/prose.
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [ ] 6.2 Implement the contextual model transport adapter
    - Configure deterministic settings where supported, hard timeout/abort behavior, no tools/tool definitions, and no retrieval, callback, call-control, memory, secret-bearing object, or external-action capability.
    - Return `unknown` to the validation boundary and map timeout/transport failures to an unavailable contextual contribution without logging evidence or credentials.
    - _Requirements: 6.2, 6.3, 6.4, 6.8, 9.3_

  - [ ] 6.3 Implement strict contextual result validation
    - Parse the whole response all-or-nothing; validate schema, integer score range, harm/rationale enums, model identity, revision/fingerprint equality, citation membership, exact quote/code-point spans, and citation requirements for nontrivial risk.
    - Discard the entire contextual response on any failure, retain deterministic processing, and report `degraded_contextual_detector` with a safe discard reason.
    - _Requirements: 2.8, 6.1, 6.5, 6.6, 6.7, 6.8, 9.3, 10.14_

  - [ ]* 6.4 Write mocked-model adapter and validator tests
    - Capture requests through a fake HTTP transport to prove evidence delimiting, static policy, absent tools/capabilities/secrets, expected revision/fingerprint, and hard timeout behavior.
    - Test prompt/schema/tool/secret/policy/action injection as quoted evidence plus invalid JSON, extra fields, unknown codes, ranges, model IDs, citations, offsets, revisions, and fingerprints.
    - _Requirements: 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 10.2, 10.10, 10.11, 10.14_

  - [ ]* 6.5 Write property test for contextual evidence as non-authoritative data
    - **Property 13: Contextual evidence is non-authoritative data**
    - Generate arbitrary transcript instructions targeting models, tools, secrets, schemas, policies, and actions; assert only evidence JSON changes while policy, schema, capabilities, revision, and fingerprint remain fixed.
    - **Validates: Requirements 6.2, 6.3, 6.4, 10.10**

  - [ ]* 6.6 Write property test for all-or-nothing contextual validation
    - **Property 14: Contextual results validate all-or-nothing**
    - Generate valid structured responses and independently corrupt each trusted field or citation invariant; assert any corruption discards the entire contextual contribution.
    - **Validates: Requirements 2.8, 6.1, 6.5, 6.6, 6.7, 10.14**

- [ ] 7. Aggregate separate dimensions and generate advisory-only output
  - [ ] 7.1 Implement the pure risk aggregator, confidence dimension, and degradation accounting
    - Apply `risk-aggregation-v1`: take maxima of validated contextual values and deterministic floors while preserving separate detector contributions and leaving both risk dimensions null when neither detector remains.
    - Calculate transcript confidence independently from represented cited segments (or newest segment when uncited), add all low/unavailable confidence, missing translation, and detector-unavailable reasons, and select primary state by documented precedence without dropping simultaneous reasons.
    - Retain exact citations, provenance, context/revision identity, and all catalog/policy versions in the assessment.
    - _Requirements: 3.7, 3.8, 3.9, 5.6, 6.8, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 9.1, 9.2, 9.3, 9.6_

  - [ ] 7.2 Implement deterministic advisory mapping and the closed action guard
    - Map every scam band, harm severity, assessment state/reason, and validated citation to closed display/persist action types and user-controlled guidance only.
    - Present translation-derived evidence beside unchanged source with a model-generated label; include uncertainty/error disclaimers and every limitation.
    - Reject/audit any action outside display/persist, never declare a call/participant safe, and never label kidnapping/threat claims genuine or fake.
    - _Requirements: 3.6, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10, 8.11, 8.12, 9.7_

  - [ ]* 7.3 Write aggregation, degradation, and advisory boundary unit tests
    - Cover scores 0/24/25/49/50/74/75/100, every harm enum, deterministic floor precedence, unavailable detector combinations, every primary state, simultaneous degraded reasons, confidence cases, and no-detector null dimensions.
    - Snapshot advisories for exact evidence, translation labeling, limitations, disclaimers, user-controlled options, forbidden safety/authenticity wording, and prohibited-action side-effect spies.
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 8.1-8.12, 9.1, 9.2, 9.3, 9.6, 9.7, 10.13, 10.15, 10.16, 10.17, 10.18_

  - [ ]* 7.4 Write property test for complete secondary translation provenance
    - **Property 8: Translation provenance is secondary and complete**
    - Generate translation-derived contributions and assert citations, persisted assessments, and advisories preserve complete provenance, `translationText` identity, unchanged source, and the model-generated-English label.
    - **Validates: Requirements 3.3, 3.4, 3.5, 3.6, 10.8**

  - [ ]* 7.5 Write property test for independent risk dimensions
    - **Property 9: Risk dimensions are independent**
    - Vary or omit confidence for fixed detector contributions and assert only confidence/degradation metadata changes, never scam likelihood or harm severity.
    - **Validates: Requirements 3.8, 3.9, 7.3**

  - [ ]* 7.6 Write property test for scam-floor aggregation
    - **Property 15: Scam-floor aggregation**
    - Generate contextual scam integers and deterministic floors and assert the final integer is always `[0,100]` and equals the greatest validated contribution.
    - **Validates: Requirements 7.1, 7.4, 10.13, 10.14**

  - [ ]* 7.7 Write property test for harm-floor aggregation
    - **Property 16: Harm-floor aggregation**
    - Generate contextual and deterministic harm values and assert the final enum is their maximum under the documented severity ordering.
    - **Validates: Requirements 7.2, 7.5, 10.13**

  - [ ]* 7.8 Write property test for deterministic advisory mapping
    - **Property 18: Deterministic advisory mapping**
    - Generate valid assessment combinations and assert advisory output is reproducible, band/state/evidence driven, and includes all active limitations and required error disclaimers.
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.8, 8.9, 9.7, 10.19**

  - [ ]* 7.9 Write property test for the advisory-only closed action set
    - **Property 19: Advisory-only closed action set**
    - Generate arbitrary component/model action requests and assert only display/persist actions survive while prohibited requests record `prohibited_action` and no side-effect spy fires.
    - **Validates: Requirements 8.10, 8.11, 10.18**

  - [ ]* 7.10 Write property test forbidding safety and threat-authenticity verdicts
    - **Property 20: No safety or threat-authenticity verdict**
    - Generate advisories across all bands, states, and kidnapping/threat evidence and assert wording never declares a call/participant safe or a claim genuine/fake.
    - **Validates: Requirements 8.7, 8.12, 10.16, 10.17**

  - [ ]* 7.11 Write property test for complete degraded-reason accounting
    - **Property 21: Complete degraded-reason accounting**
    - Generate missing translations, represented low/missing confidence, and detector failures alone and in combination; assert the exact complete reason/affected-identifier set survives primary-state selection.
    - **Validates: Requirements 3.7, 5.6, 6.8, 9.1, 9.2, 9.3, 9.6, 10.15**

  - [ ]* 7.12 Write property test for no-detector no-risk behavior
    - **Property 22: No-detector no-risk behavior**
    - Generate detector-unavailable/discarded outcomes and assert `insufficient_context` with null scam/harm dimensions whenever no validated available detector remains.
    - **Validates: Requirements 4.7, 7.7**

- [ ] 8. Execute immutable revision jobs and suppress stale results
  - [ ] 8.1 Implement the outbox dispatcher and idempotent risk job runner
    - Claim immutable `(sessionId, sessionRevision)` jobs, load the exact snapshot, build context, run deterministic/contextual branches with independent degradation, validate outputs, aggregate, map advisory, and produce one versioned candidate identity.
    - Support at-least-once delivery, bounded retry/deadline behavior, optional pre-analysis supersession, and deterministic dependency injection for clock, IDs, repository, catalog/policies, and model port.
    - _Requirements: 2.3, 2.7, 2.8, 4.1, 5.6, 6.8, 7.7, 9.3, 9.5, 10.1, 10.2_

  - [ ] 8.2 Implement final revision/fingerprint compare-and-set commit and audit behavior
    - Re-read the latest revision, compare candidate/job/current revisions, verify submitted and recomputed fingerprints, insert immutable assessments idempotently, and update the latest pointer only for the current revision.
    - Preserve the newer pointer and record `stale_assessment` or `context_mismatch` when checks fail; prevent duplicate assessment/delivery on replay.
    - _Requirements: 2.7, 2.8, 7.8, 9.5_

  - [ ]* 8.3 Write job-runner, degradation, retry, and completion-order integration tests
    - Exercise each detector independently failing, both unavailable, duplicate job delivery, superseded-before-analysis, newer revisions arriving during model calls, fingerprint mismatch, commit replay, outbox retry, and unchanged-newer-pointer behavior.
    - Assert deterministic output with fixed clocks/IDs/policies and mocked contextual responses.
    - _Requirements: 2.7, 2.8, 5.6, 6.8, 7.7, 9.3, 9.5, 9.6, 10.1, 10.2, 10.14, 10.15, 10.19_

  - [ ]* 8.4 Write property test for latest-revision commit safety
    - **Property 23: Latest-revision commit safety**
    - Generate asynchronous acceptance/completion orders and fingerprint mutations; assert only matching latest-revision assessments become current and every older completion is audited without replacing newer state.
    - **Validates: Requirements 2.7, 2.8, 9.5**

- [ ] 9. Deliver only current authorized assessments through API and UI
  - [ ] 9.1 Add the authorized assessment query and call-log API response
    - Extend the room-scoped query behind existing archive authorization to return `pending`, `current`, or `unavailable`, latest accepted revision, and an assessment only when its revision equals the latest accepted revision.
    - Preserve full detector contributions, exact evidence/provenance, policy versions, state/reasons, and advisory; set `Cache-Control: no-store` and disclose no unauthorized session state.
    - _Requirements: 2.7, 3.5, 3.6, 7.6, 7.8, 9.5_

  - [ ] 9.2 Add risk presentation to active-call and call-log views
    - Render separate scam likelihood, harm severity, transcript confidence, detector contributions, limitations, exact evidence, and advisory-only options.
    - Show “Analyzing the latest completed turn” while a newer revision is pending; ignore HTTP responses below the highest rendered revision and never wire risk output to `endCall` or another consequential action.
    - Present source beside clearly labeled model-generated translations and expose every degraded state without increasing certainty.
    - _Requirements: 3.6, 3.8, 7.3, 7.6, 7.8, 8.6, 8.7, 8.8, 8.9, 8.10, 8.12, 9.1, 9.2, 9.3, 9.5, 9.6, 9.7_

  - [ ]* 9.3 Write authorized API and UI delivery tests
    - Test room authorization, no-store responses, pending/current transitions, stale response reordering, revision equality, multilingual evidence labeling, all risk dimensions/states, advisory wording, and absent call-control/communication/transaction effects.
    - Use mocked repository/query data and component-level rendering without a development server or live call.
    - _Requirements: 2.7, 3.6, 7.3, 7.6, 7.8, 8.7, 8.9, 8.10, 8.12, 9.5, 9.7, 10.16, 10.17, 10.18_

  - [ ]* 9.4 Write property test for contribution and assessment provenance round trips
    - **Property 17: Contribution and assessment provenance round trip**
    - Generate validated assessments and assert repository serialization plus authorized API delivery preserve detector contributions, citations, source/translation provenance, policy versions, fingerprint, revision, and state exactly.
    - **Validates: Requirements 7.6, 7.8**

- [ ] 10. Wire the complete pipeline and verify it without live services
  - [ ] 10.1 Compose core adapters and pure modules behind explicit configuration
    - Wire session registration, intake, repository/outbox, context, both detectors, validators, aggregation, advisory, commit, query, and UI delivery with injectable clocks/IDs/transports and versioned policies.
    - Provide an in-process outbox drain only for tests/local development; keep imports free of server/watcher startup and ensure legacy archive-only input is never risk-scored without provenance.
    - _Requirements: 1.1, 2.1, 3.1, 4.1, 5.1, 6.1, 7.8, 8.10, 9.4, 10.1, 10.2_

  - [ ]* 10.2 Add end-to-end in-memory pipeline verification
    - Accept fixed English, Urdu, and Punjabi final turns through the authenticated route, drain the outbox through mocked contextual responses, persist current assessments, query authorized API payloads, and render advisory state.
    - Cover every positive scam/threat fixture, every negative fixture, translation variant, injection attempt, validation rejection, context boundary, detector degradation, state combination, stale completion, and advisory band/harm boundary.
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.9, 10.10, 10.11, 10.12, 10.13, 10.14, 10.15, 10.16, 10.17, 10.18_

  - [ ]* 10.3 Add explicit advisory-only side-effect verification across the end-to-end matrix
    - Install spies/fail-fast fakes for LiveKit disconnect, external communication, emergency/user reporting, transaction blocking, and transaction execution; assert no accepted, rejected, degraded, stale, injected, or high-risk path calls them.
    - Assert prohibited requests are only audited and user-controlled option text remains inert display data.
    - _Requirements: 6.4, 8.10, 8.11, 10.10, 10.18_

  - [ ]* 10.4 Write property test for end-to-end repeatability
    - **Property 24: End-to-end repeatability**
    - Re-run generated fixed session histories with identical clock, IDs, catalog/policies, fixtures, repository state setup, and mocked model output; compare canonical assessments and advisories for exact equality.
    - **Validates: Requirements 10.2, 10.19**

- [ ] 11. Core checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

### Optional Production-Hardening Tasks

- [ ] 12. Add production-scale durable adapters and operational safeguards
  - [ ]* 12.1 Implement a production transactional `RiskRepository` adapter
    - Map the repository contract to the selected production transactional store with database-enforced session, segment/sequence, outbox, and assessment uniqueness plus row/compare-and-set revision safety across instances.
    - Encrypt or otherwise apply the platform’s private-data controls to accepted evidence and assessments; keep transcript bodies and all credentials out of operational logs.
    - _Requirements: 2.3, 2.4, 2.5, 2.7, 2.8, 3.1, 7.8, 9.5_

  - [ ]* 12.2 Implement a production at-least-once outbox dispatcher and queue adapter
    - Add atomic claim leases, bounded exponential backoff, retry/dead-letter metadata, crash recovery, and idempotent redelivery keyed by immutable revision job identity.
    - Keep model attempts within one job deadline and preserve expected revision/fingerprint across retries.
    - _Requirements: 2.7, 2.8, 9.3, 9.5_

  - [ ]* 12.3 Run repository and queue contract/fault tests against production adapters
    - Reuse the core contract suite and add cross-instance acceptance races, lease expiry, crash-after-claim/commit, duplicate delivery, transaction rollback, stale completion, and compare-and-set contention cases.
    - _Requirements: 2.3, 2.4, 2.5, 2.7, 2.8, 9.5, 10.1, 10.2, 10.9, 10.19_

  - [ ]* 12.4 Add privacy-safe operational telemetry and repair tooling
    - Emit structured counters/events using identifiers, versions, states, retry counts, and reason codes only; redact evidence and credentials by construction.
    - Add code-driven repair commands for failed archive projections and stuck/expired outbox claims without mutating accepted evidence or current assessment identity.
    - _Requirements: 2.3, 7.8, 9.5, 9.6_

  - [ ]* 12.5 Test telemetry redaction and repair idempotence
    - Feed secrets and multilingual transcript text through rejection, degradation, stale, retry, and projection-failure paths; assert logs/metrics contain neither evidence nor credentials.
    - Re-run repairs and assert no duplicate archive records, jobs, assessments, or participant deliveries.
    - _Requirements: 2.3, 3.1, 7.8, 9.5, 10.2, 10.19_

- [ ] 13. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional in the workflow and are not auto-implemented; they are strongly recommended before release. Tasks 12.1–12.5 are additionally isolated as production-hardening work so the core feature can be implemented and verified against the local durable/in-memory adapters first.
- Every correctness property from the design has its own property-test subtask and should run for at least 100 seeded iterations with the required `Feature: transcript-risk-scoring, Property N: <title>` tag.
- All tests use one-shot commands, fixed clocks/identifiers, shared versioned fixtures, mocked model responses, and no LiveKit room, audio device, development server, watcher, Vercel Blob, or live contextual model.
- Implementation remains advisory-only: no task may connect assessment output to call termination, communication, reporting, accusation, transaction blocking, or transaction execution.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1", "3.1"] },
    { "id": 2, "tasks": ["1.3", "1.4", "1.5", "2.2", "3.2", "3.5", "4.1", "5.1", "6.1"] },
    { "id": 3, "tasks": ["2.3", "2.4", "2.5", "3.3", "4.2", "4.3", "4.4", "4.5", "4.6", "5.2", "6.2"] },
    { "id": 4, "tasks": ["3.4", "3.6", "3.7", "5.3", "6.3"] },
    { "id": 5, "tasks": ["5.4", "5.5", "6.4", "6.5", "6.6", "7.1"] },
    { "id": 6, "tasks": ["7.2"] },
    { "id": 7, "tasks": ["7.3", "7.4", "7.5", "7.6", "7.7", "7.8", "7.9", "7.10", "7.11", "7.12", "8.1", "9.1", "12.1"] },
    { "id": 8, "tasks": ["8.2", "9.2", "12.2"] },
    { "id": 9, "tasks": ["8.3", "8.4", "9.3", "9.4", "10.1", "12.3"] },
    { "id": 10, "tasks": ["10.2", "10.3", "10.4", "12.4"] },
    { "id": 11, "tasks": ["12.5"] }
  ]
}
```
