# Requirements Document

## Introduction

This document specifies a validation-first flow for assessing authenticated, final call transcript segments for possible scams and threats. The feature uses high-precision deterministic checks and a structured contextual model, keeps risk dimensions separate, preserves source and translation provenance, and produces advisory guidance only. The feature covers English, Urdu, and Punjabi calls in the existing Next.js/TypeScript application and persistent Python LiveKit worker architecture. Application-code changes are outside the scope of this specification phase.

## Glossary

- **Transcript Risk Scoring System**: The complete feature that validates transcript data, builds bounded context, detects risk, validates detector output, aggregates scores, and generates advisory guidance.
- **Risk Input Envelope**: A versioned record submitted for analysis containing `schemaVersion`, `sessionId`, `segmentId`, `sequence`, `speaker`, `isFinal`, `eventAt`, `receivedAt`, `sourceText`, `sourceLanguage`, `transcriptionProvider`, `transcriptionModel`, `transcriptConfidence`, and optional Translation Record.
- **Input Validator**: The Transcript Risk Scoring System component that authenticates and validates a Risk Input Envelope before analysis.
- **Accepted Segment**: A Risk Input Envelope that has passed authentication, schema, source, session, finality, timestamp, ordering, and deduplication validation.
- **Final Segment**: A transcript segment for which speech recognition has declared the speaking turn complete.
- **Session**: One LiveKit call room identified by a `call-` prefixed UUID and associated with exactly one configured call language.
- **Session Revision**: A monotonically increasing integer identifying the accepted transcript state used for one assessment.
- **Sequence Number**: A positive integer assigned by authenticated ingestion that establishes Final Segment order within one Session.
- **Source Text**: The immutable speech-recognition output in the configured call language.
- **Source Language**: One of `en`, `ur`, or `pa`, representing English, Urdu, or Punjabi.
- **Source Provenance**: The segment identifier, speaker, Source Language, transcription provider, transcription model, and event timestamp associated with Source Text.
- **Translation Record**: An optional record containing English translated text, translation provider, translation model, source segment identifier, and translation timestamp.
- **Translation Text**: English model output derived from Urdu or Punjabi Source Text; Translation Text is secondary evidence and is not ground truth.
- **Translation Provenance**: The source segment identifier, source language, target language, translation provider, translation model, and translation timestamp associated with Translation Text.
- **Transcript Confidence**: An optional upstream speech-recognition confidence value in the inclusive range 0.00 through 1.00, reported separately from risk scores; `unavailable` represents absence of an upstream value.
- **Bounded Context**: The ordered set containing no more than the 20 most recent Accepted Segments, no segment more than 10 minutes older than the newest included segment, and no more than 20,000 Unicode characters across Source Text and Translation Text.
- **Canonical Text**: A derived, non-authoritative representation used for matching while Source Text and Translation Text remain unchanged.
- **Deterministic Detector**: The component that applies a versioned catalog of high-precision scam and threat indicators without using a generative model.
- **Deterministic Indicator**: A versioned rule result containing indicator identifier, category, score floor, and one or more Evidence Citations.
- **Contextual Detector**: The component that submits Bounded Context to a structured model and accepts only schema-conforming structured output.
- **Evidence Citation**: A reference containing segment identifier, evidence field (`sourceText` or `translationText`), an exact quote, and inclusive-start/exclusive-end Unicode code-point offsets into the unchanged evidence field.
- **Result Validator**: The component that validates structured detector output, Evidence Citations, provenance, score ranges, context identity, and Session Revision.
- **Scam Likelihood**: An integer from 0 through 100 estimating the likelihood that available transcript evidence contains scam behavior; Scam Likelihood does not measure harm severity or transcript quality.
- **Harm Severity**: One of `none`, `concern`, `elevated`, `severe`, or `imminent`, estimating potential harm or threat severity without deciding whether a stated event is genuine.
- **Risk Aggregator**: The component that combines validated Deterministic Indicators and validated Contextual Detector output under a versioned aggregation policy.
- **Validated Risk Assessment**: A result that passed the Result Validator and contains separate Scam Likelihood, Harm Severity, Transcript Confidence, Evidence Citations, detector contributions, provenance, policy version, Session Revision, and Assessment State.
- **Assessment State**: One of `validated`, `degraded_translation`, `degraded_transcript_confidence`, `degraded_contextual_detector`, `degraded_deterministic_detector`, `insufficient_context`, or `rejected`.
- **Context Fingerprint**: A deterministic digest of the ordered segment identifiers, sequence numbers, unchanged evidence fields, and Session Revision in Bounded Context.
- **Advisory Generator**: The component that maps a Validated Risk Assessment to user-controlled cautionary guidance without performing an external or call-control action.
- **Advisory Action**: Displayed or persisted guidance that informs a user of evidence, uncertainty, and user-controlled options.
- **Prohibited Action**: Automatic call termination, third-party contact, emergency-service contact, user reporting, user accusation, transaction blocking, or transaction execution.
- **Risk Test Suite**: Automated tests for validation, detection, aggregation, degradation, provenance, multilingual behavior, prompt-injection resistance, and advisory-only constraints.

## Requirements

### Requirement 1: Validate authenticated final transcript input

**User Story:** As a system operator, I want risk analysis to accept only authenticated and well-formed final transcript data, so that malformed or unrelated data cannot affect an assessment.

#### Acceptance Criteria

1. WHEN a Risk Input Envelope arrives through the authenticated internal transcript channel, THE Input Validator SHALL verify the channel credential before processing transcript content.
2. THE Input Validator SHALL validate every required Risk Input Envelope field against the versioned schema.
3. WHEN a Risk Input Envelope identifies English Source Text, THE Input Validator SHALL accept `deepgram` with `nova-3` as the transcription source combination.
4. WHEN a Risk Input Envelope identifies Urdu or Punjabi Source Text, THE Input Validator SHALL accept `cartesia` with `ink-whisper` as the transcription source combination.
5. IF a transcription source combination conflicts with Source Language, THEN THE Input Validator SHALL assign the `rejected` Assessment State with reason `invalid_source`.
6. IF `isFinal` is false, THEN THE Input Validator SHALL assign the `rejected` Assessment State with reason `non_final_segment`.
7. WHEN a Risk Input Envelope contains `transcriptConfidence`, THE Input Validator SHALL accept a finite numeric value from 0.00 through 1.00 inclusive.
8. IF a required field, identifier, timestamp, enumeration value, or length constraint fails schema validation, THEN THE Input Validator SHALL assign the `rejected` Assessment State with reason `invalid_schema`.

### Requirement 2: Validate session identity, order, freshness, and duplicates

**User Story:** As a system operator, I want each segment tied to one ordered call state, so that replayed, stale, duplicated, or cross-session content cannot alter current risk.

#### Acceptance Criteria

1. WHEN a Risk Input Envelope passes schema validation, THE Input Validator SHALL verify that `sessionId` matches an existing Session and the authenticated ingestion association.
2. WHEN a Risk Input Envelope passes session validation, THE Input Validator SHALL verify that Source Language matches the configured Session language.
3. IF a segment identifier has already been accepted with identical content and provenance, THEN THE Input Validator SHALL return the prior processing result without starting another detector execution.
4. IF a segment identifier has already been accepted with different content or provenance, THEN THE Input Validator SHALL assign the `rejected` Assessment State with reason `duplicate_conflict`.
5. IF a Sequence Number is less than or equal to the highest accepted Sequence Number for the Session and the segment is not an identical duplicate, THEN THE Input Validator SHALL assign the `rejected` Assessment State with reason `stale_sequence`.
6. IF `eventAt` is more than 60 seconds later than `receivedAt`, THEN THE Input Validator SHALL assign the `rejected` Assessment State with reason `invalid_timestamp`.
7. IF an analysis result identifies a Session Revision lower than the latest Session Revision, THEN THE Result Validator SHALL assign the `rejected` Assessment State with reason `stale_assessment`.
8. IF an analysis result contains a Context Fingerprint different from the Context Fingerprint submitted to the detector, THEN THE Result Validator SHALL assign the `rejected` Assessment State with reason `context_mismatch`.

### Requirement 3: Preserve transcript and translation provenance

**User Story:** As a call participant, I want source speech-recognition text distinguished from translated text, so that risk evidence does not present model-generated translation as ground truth.

#### Acceptance Criteria

1. THE Transcript Risk Scoring System SHALL preserve Source Text without replacement, rewriting, or normalization in persisted assessment records.
2. WHEN Canonical Text is produced, THE Transcript Risk Scoring System SHALL retain a reference from Canonical Text to the unchanged evidence field and corresponding code-point offsets.
3. WHEN Source Language is Urdu or Punjabi, THE Input Validator SHALL accept Translation Text only in a Translation Record with complete Translation Provenance.
4. IF a Translation Record refers to a source segment identifier different from the enclosing segment identifier, THEN THE Input Validator SHALL assign the `rejected` Assessment State with reason `translation_source_mismatch`.
5. WHEN Translation Text contributes to a score, THE Transcript Risk Scoring System SHALL label every corresponding Evidence Citation as `translationText`.
6. WHEN Translation Text contributes to an advisory, THE Advisory Generator SHALL display the associated Source Text and identify Translation Text as model-generated English translation.
7. WHEN a Translation Record is absent for Urdu or Punjabi Source Text, THE Transcript Risk Scoring System SHALL retain Source Text for deterministic analysis and assign the `degraded_translation` Assessment State.
8. THE Transcript Risk Scoring System SHALL report Transcript Confidence independently from Scam Likelihood and Harm Severity.
9. IF upstream speech recognition omits a confidence value, THEN THE Transcript Risk Scoring System SHALL report Transcript Confidence as `unavailable`.

### Requirement 4: Build bounded and ordered analysis context

**User Story:** As a system operator, I want analysis constrained to a reproducible transcript window, so that model input remains relevant, bounded, and testable.

#### Acceptance Criteria

1. WHEN an Accepted Segment advances the Session Revision, THE Context Builder SHALL order Accepted Segments by ascending Sequence Number.
2. THE Context Builder SHALL include no more than the 20 most recent Accepted Segments in Bounded Context.
3. THE Context Builder SHALL exclude Accepted Segments more than 10 minutes older than the newest included Accepted Segment.
4. IF the selected Accepted Segments exceed 20,000 Unicode characters, THEN THE Context Builder SHALL remove oldest Accepted Segments until the character bound is satisfied.
5. WHEN Bounded Context is complete, THE Context Builder SHALL calculate a Context Fingerprint from the ordered context and Session Revision.
6. WHEN Bounded Context contains Urdu or Punjabi Translation Text, THE Context Builder SHALL present Source Text and Translation Text as distinct labeled fields.
7. IF Bounded Context contains no non-whitespace Source Text, THEN THE Transcript Risk Scoring System SHALL assign the `insufficient_context` Assessment State.

### Requirement 5: Apply high-precision deterministic detection

**User Story:** As a safety reviewer, I want reproducible high-precision checks, so that explicit scam and threat evidence can be detected without relying only on a contextual model.

#### Acceptance Criteria

1. WHEN Bounded Context is available, THE Deterministic Detector SHALL evaluate a versioned catalog of scam and threat indicators.
2. THE Deterministic Detector SHALL evaluate Source Text and Translation Text as separate evidence fields.
3. WHEN a deterministic rule matches, THE Deterministic Detector SHALL emit a Deterministic Indicator with at least one Evidence Citation.
4. THE Deterministic Detector SHALL preserve negation, quotation, speaker attribution, and evidence-field identity when evaluating a deterministic rule.
5. IF a deterministic match lacks an exact quote and valid offsets into the cited evidence field, THEN THE Result Validator SHALL discard the deterministic match.
6. IF the Deterministic Detector is unavailable, THEN THE Transcript Risk Scoring System SHALL assign the `degraded_deterministic_detector` Assessment State and omit deterministic score floors.

### Requirement 6: Apply structured contextual detection safely

**User Story:** As a safety reviewer, I want context-sensitive analysis, so that multi-turn scam tactics and threats can be assessed without allowing transcript content to control the detector.

#### Acceptance Criteria

1. WHEN Bounded Context passes validation, THE Contextual Detector SHALL request schema-conforming structured output containing Scam Likelihood, Harm Severity, Evidence Citations, detector rationale codes, Context Fingerprint, Session Revision, and model identifier.
2. THE Contextual Detector SHALL delimit every transcript evidence field as untrusted quoted data.
3. WHEN transcript content contains an instruction addressed to a model, system, developer, detector, or tool, THE Contextual Detector SHALL treat the instruction as transcript evidence rather than detector control input.
4. THE Contextual Detector SHALL operate without tool invocation, external communication, call-control capability, or access to secrets.
5. IF contextual output is not valid against the required schema, THEN THE Result Validator SHALL discard the contextual output.
6. IF contextual output contains an Evidence Citation outside Bounded Context, THEN THE Result Validator SHALL discard the contextual output.
7. IF contextual output contains a quote or offsets that do not exactly identify the unchanged cited field, THEN THE Result Validator SHALL discard the contextual output.
8. IF the Contextual Detector times out or the Result Validator discards contextual output, THEN THE Transcript Risk Scoring System SHALL assign the `degraded_contextual_detector` Assessment State and continue with validated Deterministic Indicators.

### Requirement 7: Produce separate validated risk dimensions

**User Story:** As a call participant, I want scam probability, possible harm, and transcript quality shown separately, so that one dimension does not misrepresent another dimension.

#### Acceptance Criteria

1. WHEN detector results pass the Result Validator, THE Risk Aggregator SHALL calculate Scam Likelihood as an integer from 0 through 100 under a versioned aggregation policy.
2. WHEN detector results pass the Result Validator, THE Risk Aggregator SHALL calculate Harm Severity as `none`, `concern`, `elevated`, `severe`, or `imminent` under a versioned aggregation policy.
3. THE Risk Aggregator SHALL report Transcript Confidence without using Transcript Confidence as Scam Likelihood or Harm Severity.
4. WHEN a Deterministic Indicator defines a scam score floor, THE Risk Aggregator SHALL set Scam Likelihood to the greater of the validated contextual Scam Likelihood and the highest applicable deterministic scam score floor.
5. WHEN a Deterministic Indicator defines a harm-severity floor, THE Risk Aggregator SHALL set Harm Severity to the greater ordered severity of the validated contextual Harm Severity and the highest applicable deterministic harm-severity floor.
6. THE Risk Aggregator SHALL retain separate deterministic and contextual contributions in the Validated Risk Assessment.
7. IF no validated detector result remains, THEN THE Transcript Risk Scoring System SHALL assign the `insufficient_context` Assessment State without emitting a numeric Scam Likelihood or categorical Harm Severity.
8. WHEN a Validated Risk Assessment is persisted or displayed, THE Transcript Risk Scoring System SHALL include Evidence Citations, provenance, policy version, Context Fingerprint, Session Revision, and Assessment State.

### Requirement 8: Generate advisory-only actions

**User Story:** As a call participant, I want evidence-based cautions that leave decisions under user control, so that automated analysis cannot take consequential action.

#### Acceptance Criteria

1. WHEN a Validated Risk Assessment is available, THE Advisory Generator SHALL produce guidance determined by Scam Likelihood band, Harm Severity, Assessment State, and validated Evidence Citations.
2. WHEN Scam Likelihood is from 0 through 24, THE Advisory Generator SHALL state that available context contains no specific validated scam indicator and that the assessment does not establish call safety.
3. WHEN Scam Likelihood is from 25 through 49, THE Advisory Generator SHALL advise independent verification before sharing information or acting on a request.
4. WHEN Scam Likelihood is from 50 through 74, THE Advisory Generator SHALL advise pausing money, credential, code, or remote-access activity and independently verifying the requester.
5. WHEN Scam Likelihood is from 75 through 100, THE Advisory Generator SHALL present a prominent scam warning with the exact supporting evidence and user-controlled options.
6. WHEN Harm Severity is `elevated`, `severe`, or `imminent`, THE Advisory Generator SHALL present user-controlled options for moving to a secure setting and contacting a trusted person or local emergency service directly.
7. WHEN an assessment concerns a kidnapping claim, THE Advisory Generator SHALL describe the claim, evidence, uncertainty, and user-controlled verification options without assigning genuine or fake status.
8. THE Advisory Generator SHALL state that automated transcription, translation, and risk analysis can contain errors.
9. THE Advisory Generator SHALL describe every Assessment State other than `validated` in the displayed guidance.
10. THE Transcript Risk Scoring System SHALL limit system actions to displaying or persisting Advisory Actions.
11. IF any component requests a Prohibited Action, THEN THE Transcript Risk Scoring System SHALL reject the request and record reason `prohibited_action`.
12. THE Transcript Risk Scoring System SHALL describe assessment outcomes without declaring a call or participant safe.

### Requirement 9: Represent degraded and rejected processing explicitly

**User Story:** As a call participant, I want analysis limitations made visible, so that partial system operation cannot appear fully validated.

#### Acceptance Criteria

1. WHEN Translation Text is unavailable for Urdu or Punjabi Source Text, THE Transcript Risk Scoring System SHALL report `degraded_translation` with the affected segment identifiers.
2. WHEN Transcript Confidence is `unavailable` or below 0.50 for any cited segment, THE Transcript Risk Scoring System SHALL report `degraded_transcript_confidence` with the affected segment identifiers.
3. WHEN one detector is unavailable and another detector produces validated output, THE Transcript Risk Scoring System SHALL identify the unavailable detector in the Assessment State and detector contributions.
4. IF input validation fails, THEN THE Transcript Risk Scoring System SHALL report `rejected` with a machine-readable reason without invoking either detector.
5. IF a stale contextual result arrives after a newer Session Revision, THEN THE Transcript Risk Scoring System SHALL retain the newer assessment and record `stale_assessment` for the discarded result.
6. WHEN multiple degraded conditions apply, THE Transcript Risk Scoring System SHALL retain every applicable degraded reason in assessment metadata.
7. WHILE an Assessment State is degraded, THE Advisory Generator SHALL avoid increasing certainty to compensate for unavailable data or unavailable detectors.

### Requirement 10: Verify the complete flow with automated tests

**User Story:** As a developer, I want a comprehensive and deterministic test suite, so that risk scoring behavior can be verified before application integration.

#### Acceptance Criteria

1. THE Risk Test Suite SHALL execute Input Validator, Context Builder, Deterministic Detector, Contextual Detector adapter, Result Validator, Risk Aggregator, and Advisory Generator tests without requiring a live call.
2. THE Risk Test Suite SHALL use fixed clocks, deterministic identifiers, versioned fixtures, and mocked contextual-model responses.
3. THE Risk Test Suite SHALL include positive scam fixtures for impersonation, urgent transfer requests, one-time-code requests, credential requests, advance-fee requests, and remote-access requests.
4. THE Risk Test Suite SHALL include positive threat fixtures for coercion, intimidation, extortion, physical-harm threats, and kidnapping claims.
5. THE Risk Test Suite SHALL include negative fixtures for legitimate financial discussions, quoted scam examples, negated threats, security training, benign urgency, and ambiguous requests.
6. THE Risk Test Suite SHALL include English fixtures sourced from Deepgram Nova-3 and Urdu and Punjabi fixtures sourced from Cartesia Ink Whisper.
7. THE Risk Test Suite SHALL include Urdu and Punjabi cases with accurate translation, misleading translation, missing translation, code-switching, and source-versus-translation disagreement.
8. THE Risk Test Suite SHALL verify that translation-based evidence retains Translation Provenance and a secondary-evidence label.
9. THE Risk Test Suite SHALL include malformed schema, invalid source combination, cross-session identifier, duplicate, duplicate conflict, non-final, out-of-order, future timestamp, stale result, and context-fingerprint mismatch cases.
10. THE Risk Test Suite SHALL include transcript content that attempts prompt injection, schema alteration, tool use, secret disclosure, policy override, and Prohibited Actions.
11. THE Risk Test Suite SHALL verify exact Evidence Citation quotes and Unicode code-point offsets for English, Urdu, and Punjabi scripts.
12. THE Risk Test Suite SHALL verify Bounded Context limits of 20 segments, 10 minutes, and 20,000 Unicode characters at each boundary and one unit beyond each boundary.
13. THE Risk Test Suite SHALL verify every Scam Likelihood band boundary and every Harm Severity value.
14. THE Risk Test Suite SHALL verify deterministic score-floor precedence and rejection of malformed contextual output.
15. THE Risk Test Suite SHALL verify each Assessment State and combinations of degraded reasons.
16. THE Risk Test Suite SHALL verify that generated guidance contains no claim that a kidnapping report is genuine or fake.
17. THE Risk Test Suite SHALL verify that generated guidance contains no declaration that a call or participant is safe.
18. THE Risk Test Suite SHALL verify that no test path automatically ends a call, contacts another party, reports a user, blocks a transaction, or executes a transaction.
19. WHEN a test fixture and mocked detector response are unchanged, THE Risk Test Suite SHALL produce an identical Validated Risk Assessment across repeated executions.
