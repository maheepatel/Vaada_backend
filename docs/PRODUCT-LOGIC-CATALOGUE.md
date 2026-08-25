# Vaada product and business-logic catalogue

Status: ideation catalogue for shortlisting. Items marked **MVP** are recommended for the first production release. This document expands the approved-direction draft in `PROOF-TRUST-BUSINESS-RULES.md`; it does not silently authorize backend implementation.

## Product principles

1. A promise is a source-backed public record, not an accusation.
2. An evidence upload is not a verdict.
3. AI may extract, classify, compare and flag; it may not publish, reject or close a record without a human decision.
4. Every material change is versioned and attributable.
5. Public identity can be hidden while private abuse controls remain.
6. Location is a supporting signal, not identity or truth.
7. Completion must be reversible when credible contradictory evidence appears.
8. The easiest path should be: share source → review AI draft → submit.

## 1. Promise creation and duplicate prevention

| Priority | Rule or edge case | Recommended behaviour |
| --- | --- | --- |
| MVP | Same announcement submitted repeatedly | Detect URL, normalized-title, office, place and semantic similarity; suggest joining the existing record. |
| MVP | One announcement contains several promises | AI proposes separate atomic records; user confirms each promise. |
| MVP | Promise has no deadline | Publish with “No deadline stated”; never invent one. Allow later sourced deadline amendments. |
| MVP | Promise has a vague place | Require the narrowest supported geography and mark geographic confidence. |
| MVP | Promise names a politician but not an office | Store speaker separately; map accountability to an office only when the source supports it. |
| MVP | Election manifesto promise | Label `manifesto`, party, election and jurisdiction; do not imply it is an active government commitment until applicable. |
| MVP | Old promise submitted after its deadline | Accept with original dates and immediately calculate overdue status after review. |
| MVP | Source is deleted after submission | Preserve permitted snapshot metadata, hash and archive reference; show source availability history. |
| Later | Same promise spans districts | One parent promise with district-level child deliverables and roll-up progress. |
| Later | Promise wording changes | Create a new version, show a diff and require a source for the amendment. |
| Later | Conflicting deadlines or quantities | Display both claims, select a canonical value through review and retain the conflict note. |
| Later | Conditional promise | Store the condition explicitly; do not mark broken until the condition and deadline logic are evaluated. |

## 2. Evidence eligibility and trust

| Priority | Rule or edge case | Recommended behaviour |
| --- | --- | --- |
| MVP | Original logger uploads proof | Accept as evidence, never as final completion by itself. |
| MVP | Verified authority uploads proof | May create provisional completion; needs independent corroboration for final closure. |
| MVP | Nearby resident uploads proof | Require fresh consented location or an alternative primary-source route. |
| MVP | Remote person has an official source | Accept without geolocation when the primary source is independently verifiable. |
| MVP | Anonymous person uploads proof | Treat as a tip unless privately authenticated; public anonymity remains available. |
| MVP | Evidence is only a screenshot | Ask for original link/file; lower trust if origin cannot be recovered. |
| MVP | Image predates the claimed event | Compare capture/receipt dates and flag chronology mismatch. |
| MVP | Same media is uploaded by many accounts | Count as one evidence object, not independent corroboration. |
| MVP | Authority and reviewer are from the same office | Block that reviewer from final approval. |
| MVP | Uploader withdraws evidence | Remove it from active evaluation, preserve an audit tombstone and recalculate status. |
| Later | Offline witness lacks location permission | Allow a signed local-body letter, geo-tagged original captured later, or manual verification. |
| Later | Evidence covers only part of a quantity | Record partial verified units and calculate progress from deliverable-level data. |

## 3. Completion and progress

Recommended state machine:

`draft → submitted → source review → published → work reported → evidence review → provisionally complete → challenge window → verified complete`

Side states: `needs information`, `disputed`, `late`, `rejected`, `reopened`, `withdrawn`, `superseded`.

| Priority | Rule or edge case | Recommended behaviour |
| --- | --- | --- |
| MVP | Uploader tries to mark complete | Disallow; uploader can only submit evidence and a completion claim. |
| MVP | Progress percentage has no measurable denominator | Show milestone-based stage instead of false numeric precision. |
| MVP | Quantity promise is partly delivered | `verified delivered units / promised units`, capped at 100%. |
| MVP | Deadline passes at 100% but review is pending | Show “completion claimed — verification pending,” not “kept.” |
| MVP | Completion occurs after deadline | Store `completed late`; do not rewrite history as on-time. |
| MVP | Credible counter-evidence appears | Reopen automatically into `disputed review`; retain the previous verdict. |
| MVP | Promise is cancelled by a later government | Mark `withdrawn/cancelled`, show who cancelled it and why; do not call it fulfilled. |
| MVP | Scope is reduced | Preserve original scope and show amended scope separately; calculate both where useful. |
| Later | Multi-location delivery | Compute each child location separately and weighted roll-up. |
| Later | Quality requirement is unmet | Separate `delivered` from `verified usable/operational`. |

## 4. Review workflow

| Priority | Rule or edge case | Recommended behaviour |
| --- | --- | --- |
| MVP | Reviewer sees uploader identity | Hide unnecessary identity by default to reduce bias. |
| MVP | Reviewer has a conflict | Require declaration and reassignment. |
| MVP | Reviewer disagrees with AI | Human decision wins; log the reason for model evaluation. |
| MVP | High-impact promise | Require two reviewers, at least one independent of the authority. |
| MVP | Evidence is ambiguous | Request clarification rather than forcing accept/reject. |
| MVP | Review takes too long | SLA queue with escalation, but no automatic publication or closure. |
| MVP | Decision is challenged | Separate appeal reviewer; original reviewer cannot decide their own appeal. |
| Later | Reviewers repeatedly disagree | Calibration sampling, guideline updates and quality score—not blind majority voting. |
| Later | Reviewer account is compromised | Revoke sessions, suspend decisions and re-check recent high-risk actions. |

## 5. Identity, authority and permissions

| Priority | Rule or edge case | Recommended behaviour |
| --- | --- | --- |
| MVP | Public reader | No account required. |
| MVP | Person logging a promise | Anonymous tip allowed; account required to edit, follow or submit decision-grade proof. |
| MVP | Authority verification | Official-domain email plus manual/registry validation of office and jurisdiction. |
| MVP | Authority changes job | Role expires and must be re-verified; past signed actions remain attributed. |
| MVP | Sensitive reviewer action | Require recent passkey/WebAuthn step-up authentication. |
| MVP | Admin changes a role | Two-person approval and audit record. |
| MVP | User wants public anonymity | Store separate public display identity and restricted private account identity. |
| Later | No official email domain | Verification letter, published staff directory or supervisor approval. |
| Later | Organization disputes representative | Freeze the role, not the underlying evidence; investigate through audit trail. |

## 6. Geolocation

| Priority | Rule or edge case | Recommended behaviour |
| --- | --- | --- |
| MVP | Browser asks for location | Ask only after the user chooses “verify as nearby witness”; explain purpose first. |
| MVP | Spoofed or inaccurate coordinates | Location increases confidence only; never authorizes closure. |
| MVP | Accuracy radius exceeds boundary | Ask for a better fix or alternative evidence. |
| MVP | Stale location | Reject as proximity proof after configured freshness window. |
| MVP | Exact coordinates could endanger witness | Never publish; expose district/ward or distance band only. |
| MVP | User denies permission | Continue with official-link/manual-verification alternatives. |
| Later | Rural promise covers a broad area | Promise-specific polygon or larger configurable radius. |
| Later | Impossible travel/device anomalies | Risk flag for review, not automatic rejection. |

Recommended starting defaults for discussion: 5 km urban, 15 km rural, location no older than 10 minutes, reported accuracy within 150 m. Every value must be configurable per promise.

## 7. Media, documents and tamper evidence

| Priority | Rule or edge case | Recommended behaviour |
| --- | --- | --- |
| MVP | Malicious upload | Allow-list type/size, decode validation, malware scan, isolated private storage. |
| MVP | Filename or MIME is spoofed | Detect magic bytes; generate server filename. |
| MVP | Original is edited after upload | Hash original bytes immediately and store immutable version. |
| MVP | Public copy contains personal data | Generate redacted derivative; restrict original. |
| MVP | OCR misreads a letter | Show source beside extracted fields and require user confirmation. |
| MVP | AI prompt injection appears inside a document | Treat file text as untrusted data; extraction agent has no publishing/admin tools. |
| MVP | File has C2PA credentials | Validate and display provenance result without calling it a truth verdict. |
| MVP | Capture time matters | Store server receipt time; optionally add RFC 3161 trusted timestamp for higher-risk evidence. |
| Later | Video is very large | Resumable upload, transcoded preview, original hash and asynchronous review. |
| Later | Long-term evidence preservation | Evidence records, periodic re-timestamping and crypto-agile hash migration. |

## 8. Sources and AI ingestion

| Priority | Rule or edge case | Recommended behaviour |
| --- | --- | --- |
| MVP | X/Twitter or news URL is inaccessible | Ask for screenshot/text while preserving the URL and low-confidence warning. |
| MVP | Source is satire/opinion | Classify source type and hold from publication. |
| MVP | AI extracts unsupported detail | Every extracted field carries source span, confidence and “not stated” option. |
| MVP | Source language is not English | Preserve original text, show translation and language; reviewers can inspect both. |
| MVP | Source contradicts user-entered values | Highlight differences before submission. |
| MVP | Agent sees multiple responsible offices | Present choices; do not silently select one. |
| MVP | Agent task fails | Preserve upload and let user fill only missing fields; never lose the draft. |
| MVP | Automated monitoring discovers a promise | Create a private candidate queue, not a public record. |
| Later | Source changes over time | Scheduled integrity check and visible “source changed/unavailable” event. |
| Later | Syndicated news duplicates | Cluster around the earliest primary/official source. |

## 9. Rankings and statistics

| Priority | Rule or edge case | Recommended behaviour |
| --- | --- | --- |
| MVP | State has very few records | Show sample size prominently; do not imply complete government performance. |
| MVP | Easy promises inflate score | Weight only after a published methodology and sufficient data; initially show raw components. |
| MVP | Missing deadline | Exclude deadline compliance component, not the whole promise. |
| MVP | District click | Open a visible state + district filtered register with removable filters. |
| MVP | Score changes | Version methodology and keep historical score snapshots. |
| MVP | Completion later reopens | Recalculate score and show the correction event. |
| Later | Compare unlike sectors | Allow sector-specific rankings and minimum-record thresholds. |
| Later | Authority games quantity | Use independently reviewed atomic promises and duplicate controls. |

## 10. Usability and low-friction participation

| Priority | Feature | Recommended behaviour |
| --- | --- | --- |
| MVP | Fast intake | One first field: link, image, PDF or pasted text. AI fills the draft. |
| MVP | Draft safety | Autosave locally and server-side after sign-in; resume across devices. |
| MVP | Clear uncertainty | “Not stated” is a valid answer; never force guessing. |
| MVP | Language | English plus selected Indian languages, with original source preserved. |
| MVP | Weak network | Compress previews, resumable upload and offline draft queue. |
| MVP | Mobile navigation | Stable bottom destinations, compact filters and Back on subroutes. |
| MVP | Card discovery | Full-card horizontal swipe plus visible previous/next buttons for users who cannot drag. |
| MVP | Accessibility | 24 px minimum targets, logical focus, reduced-motion support and readable contrast; target 44 px where space allows. |
| MVP | Follow-up | Follow promise/state/district and receive only material updates. |
| MVP | Submission receipt | Reference ID, private status page and expected review time. |
| MVP | Corrections | One visible “Report error” action on every record. |
| Later | Assisted submission | Voice note → transcript → reviewable draft. |
| Later | Community help | Trusted volunteers can translate or locate primary sources without receiving verdict powers. |

## 11. Notifications

- Opt-in separately for progress, deadline, proof, decision, challenge and correction events.
- Batch low-priority updates; never spam on every minor edit.
- Notify the original logger before a promise is rejected or materially merged.
- Notify authority representatives of response/challenge windows without giving them veto power.
- Expired email/push tokens are removed; notification failure never changes record state.
- Public webhooks/API later require signatures, rate limits and versioned payloads.

## 12. Privacy, safety and legal-risk controls

- Data minimization and purpose-specific consent for identity, location, attribution and notifications.
- Exact location, identity documents, device risk signals and contact details are never public.
- Retention schedule per data class; erase or reduce precision when no longer necessary.
- Child-safe flow; do not track or behaviourally monitor children.
- Named-person allegations receive stricter moderation; prefer accountable office labels when sources permit.
- Emergency privacy/safety takedown hides public media without deleting the evidence audit record.
- Defamation/privacy review is separate from factual verification.
- Correction, access, erasure, grievance and appeal paths are documented.

## 13. Security and operations

- Row-level authorization on every promise, evidence, review and organization query.
- Service-role keys never reach clients.
- Idempotency keys for submission, upload completion and reviewer decisions.
- Rate limits and abuse scoring by action; never ban solely by shared IP.
- Append-only audit events with actor, reason, before/after hashes and server time.
- Backups, tested restore procedure and immutable evidence retention policy.
- Observability without logging raw identity documents, exact locations or secret URLs.
- Feature flags and kill switches for AI ingestion, uploads and public comments.
- Queue retries use bounded exponential backoff and dead-letter review.
- Dependency, model and methodology versions are recorded for reproducibility.

## 14. Decisions to shortlist before backend implementation

1. Proof eligibility: recommended four routes—original logger, verified authority, nearby witness, or verifiable primary source.
2. Final closure: recommended independent senior reviewer; no uploader can close alone.
3. Challenge window: recommended 14 days normal / 30 days high-impact.
4. Anonymous evidence: recommended public anonymity with private authentication for decision-grade proof.
5. Location: approve or change the configurable 5 km / 15 km / 10 minute / 150 m defaults.
6. Progress: choose measurable quantity, verified milestones, or both; never arbitrary reviewer percentage.
7. Rankings: decide whether MVP launches with raw metrics only or a composite score with minimum sample size.
8. Public comments: recommended no open comments in MVP; structured corrections and evidence challenges only.
9. Authority onboarding: official email + manual verification, with role expiry.
10. Evidence timestamping: ordinary server timestamp in MVP; RFC 3161 for high-impact evidence in a later phase.
11. Languages for MVP: select the first two or three Indian languages based on launch geography.
12. Review SLA and escalation: choose target turnaround by risk tier.

## Standards and primary references

- [WCAG 2.2 quick reference](https://www.w3.org/WAI/WCAG22/quickref/): moving content needs a pause mechanism; drag actions need a non-drag alternative; minimum pointer target guidance.
- [W3C Geolocation API](https://www.w3.org/TR/geolocation/): express permission, minimization and no guarantee of actual device location.
- [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html): upload validation, authorization, isolated storage, scanning and CDR.
- [C2PA Technical Specification](https://spec.c2pa.org/specifications/specifications/2.4/specs/C2PA_Specification.html): signed, tamper-evident content provenance without truth judgments.
- [NIST SP 800-63B](https://pages.nist.gov/800-63-4/sp800-63b.html): authentication assurance and phishing-resistant WebAuthn.
- [RFC 3161](https://www.ietf.org/rfc/rfc3161.txt) and [RFC 4998](https://datatracker.ietf.org/doc/rfc4998/): trusted timestamps and long-term evidence records.
- [Government of India DPDP Act 2023](https://www.meity.gov.in/static/uploads/2024/06/2bf1f0e9f04e6fb4f8fef35e82c42aa5.pdf): lawful purpose, specific consent, necessary-data limitation and data-principal rights.
- [Guidelines for Indian Government Websites and Apps 3.0](https://guidelines.india.gov.in/new-features-of-gigw-3-0/): accessibility, API integration, multilingual and citizen-engagement direction.
