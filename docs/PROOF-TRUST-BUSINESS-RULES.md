# Vaada proof, identity and trust rules — approval draft

Status: **Product decision draft. Do not implement backend enforcement until approved.**

## 1. Non-negotiable trust principle

Uploading evidence and deciding that a promise is complete are different powers. No uploader—including the original complainant or a government official—can directly mark a promise as completed. An upload creates an evidence submission. Completion requires the verification workflow below.

Location is a supporting signal, not proof of identity or truth. The web Geolocation API itself does not guarantee that it returns a device's actual location, so geofencing alone cannot authorize completion.

## 2. Roles

| Role | Can read | Can log promise | Can submit evidence | Can review | Can close record |
| --- | --- | --- | --- | --- | --- |
| Anonymous visitor | Yes | Yes, into moderation | No | No | No |
| Authenticated public user | Yes | Yes | Yes, subject to eligibility | No | No |
| Original logger | Yes | Yes | Yes for own record | Can respond to challenges | No |
| Nearby witness | Yes | Yes | Yes with fresh location consent | No | No |
| Verified authority representative | Yes | Yes | Yes for scoped office/jurisdiction | Can issue an official response | No, alone |
| Independent reviewer | Yes | No | Can add reviewer notes | Yes | Can recommend |
| Senior reviewer/admin | Yes | No | Can add audit evidence | Yes | Yes, with recorded reason |

The public can submit a tip anonymously, but anonymous submissions cannot receive a high trust score by themselves. The system can keep a submitter's public identity hidden while privately retaining an authenticated account for abuse prevention.

## 3. Evidence submission eligibility

A user may submit evidence when at least one condition is true:

1. They are the original logger or a collaborator explicitly added to the record.
2. They are a verified representative of the responsible office and the role is still active.
3. They are physically near the promise location at capture time and consent to one-time location verification.
4. They provide a verifiable primary public source, such as an official government URL, gazette, tender portal, budget document or authority social account.
5. A moderator grants a documented exception for remote evidence that is independently checkable.

Failure to satisfy an eligibility condition does not delete the upload. It becomes a low-trust tip awaiting corroboration and is not shown as verified proof.

## 4. Location policy

- Ask for location only at the moment a nearby witness chooses that verification route.
- Explain the purpose, retention period and visibility before the browser prompt.
- Evaluate distance on the server against a promise-specific geographic boundary; do not trust a client-provided `insideGeofence` boolean.
- Record coordinates, accuracy radius, acquisition time, server receipt time and a risk result. Reject stale fixes and fixes whose accuracy radius is larger than the allowed boundary.
- Store precise coordinates in a restricted table. Public pages show only district/ward or an approximate distance band.
- Delete or reduce precision after the challenge window unless retention is necessary for an active dispute.
- Provide a non-location route: official source link, original logger, verified authority or manual review.
- Treat impossible travel, emulator/root indicators, repeated coordinates, VPN/IP mismatch and device-time mismatch as risk flags—not automatic guilt.

Recommended MVP default: promise-specific geofence, otherwise **5 km urban / 15 km rural**, location fix no older than **10 minutes**, accuracy radius at most **150 m**. These numbers must remain configurable.

## 5. Evidence intake and tamper resistance

For every uploaded image, video or document:

1. Accept only an allow-list of required formats and enforce size/dimension/page limits.
2. Verify magic bytes and decode the file; never trust the filename or `Content-Type` header alone.
3. Generate a server filename, store outside the public web root and serve through an authorization-aware media endpoint.
4. Malware scan; use content disarm and reconstruction for PDFs/documents where practical.
5. Compute SHA-256 for the original bytes before transformations. Keep the original in versioned, immutable object storage with retention lock where available.
6. Store server receipt time, uploader account, authorization reason, source URL, capture metadata, hash, derivative hashes and every review action in an append-only audit log.
7. Preserve and validate C2PA Content Credentials when present. A valid credential proves the signed provenance assertions were not altered; it does not prove the depicted event is true. Missing credentials do not automatically mean fake.
8. OCR/AI extraction produces a draft only. Display extracted fields and require human confirmation. Save model version, prompt/version, confidence and the original source beside any extracted value.
9. Run duplicate and near-duplicate detection so one image cannot masquerade as independent corroboration.
10. Redact faces, phone numbers, addresses, signatures and identifiers in public derivatives while retaining access-controlled originals only when necessary.

Nothing is literally tamper-proof. The product goal is **tamper-evident, attributable and auditable**.

## 6. Promise and completion state machine

### Promise lifecycle

`draft → submitted → source review → published → work reported → evidence under review → provisionally complete → verified complete`

Side states: `needs information`, `disputed`, `late`, `rejected`, `reopened`, `withdrawn`.

### Completion decision

1. Eligible user submits evidence.
2. Automated checks scan files, verify source/domain, detect duplicates and assign risk—not truth.
3. A reviewer checks whether the proof maps to the exact deliverable, place, quantity, deadline and accountable office.
4. Completion becomes **provisional** only when the configured threshold is met.
5. A public challenge window opens. Challenges must include a reason and may include counter-evidence.
6. A senior reviewer closes as verified, rejects, or extends the review.
7. Later contradictory evidence can reopen the record; prior decisions remain visible in the audit timeline.

Recommended MVP threshold:

- Normal promise: two independent evidence items, including one primary/official source **or** one eligible nearby witness, reviewed by one independent reviewer.
- High-impact promise: two independent sources plus two-person review; one reviewer must not be affiliated with the responsible authority.
- Authority evidence alone: never enough for final completion. It can move the record to provisional completion.
- Original logger evidence alone: never enough for final completion. It needs independent corroboration.
- Challenge window: **14 days** normal, **30 days** high-impact.

## 7. Identity and authority verification

Public accounts should support passkeys/WebAuthn, with email magic-link fallback. Sensitive actions—authority responses, reviewer decisions, role changes and final closure—require recent step-up authentication.

Authority status is not inferred from a display name or social account alone. Require:

- verified official-domain email where available;
- office, designation and jurisdiction;
- a manual or registry-backed organizational verification;
- public verification badge that describes scope, not a generic “government verified” label;
- expiry and periodic re-verification; immediate revocation when employment changes;
- two-person approval for adding a new authority organization or reviewer.

Do not require Aadhaar for general public participation. It creates unnecessary exclusion and data risk. If a future legal requirement creates a narrow identity-proofing need, review it separately with counsel.

## 8. Anti-abuse and fairness controls

- Rate-limit by account, IP risk, device signal and promise—not IP alone.
- Queue sudden coordinated submissions instead of letting vote volume determine truth.
- Do not count multiple uploads from the same source, account, device cluster or copied media as independent corroboration.
- Require conflict-of-interest disclosure from reviewers; block self-review and same-office final review.
- Give affected authorities and original loggers equal ability to respond, but never allow either to silently delete the record.
- Publish correction history and decision reasons. Material edits create versions, not overwrites.
- Provide appeal, reopen and emergency takedown paths.
- Separate defamation/privacy moderation from factual verification so a safety takedown does not secretly rewrite the evidence history.
- Apply stricter review to allegations naming individuals; default to responsible offices rather than personal blame unless the source clearly supports it.

## 9. Privacy and safety

- Collect the minimum data needed for the selected submission route.
- Consent must be specific and separated: account, location, public attribution and notifications are different choices.
- Allow a public pseudonym/anonymous display while keeping private abuse controls.
- Define retention by data class; precise location and raw identity documents get the shortest period.
- Provide access, correction, deletion and grievance workflows, subject to documented legal/audit retention needs.
- Do not publicly expose exact witness location, private contact information, device fingerprint or unredacted identity documents.
- Block location tracking and behavioural monitoring of children; route suspected minors to a guardian-safe/manual process.
- Complete a privacy impact assessment before production geolocation or identity proofing.

## 10. Suggested implementation phases after approval

### Phase A — low-risk public MVP

- Supabase Auth with passkeys/magic links
- role and organization tables with row-level security
- promise/evidence/version/review/challenge/audit tables
- private evidence bucket, signed URLs and server-side validation
- evidence tips, human review and provisional/verified status
- no automatic closure, no geolocation requirement

### Phase B — nearby witness flow

- one-time consent and server-side geofence calculation
- restricted precise-location storage and scheduled precision reduction
- location risk signals and non-location alternative

### Phase C — stronger provenance and institutional accounts

- C2PA validation and provenance display
- official organization onboarding, role expiry and WebAuthn step-up
- two-person review for high-impact records
- transparency reports, appeals and independent audits

## 11. Product decisions required before backend/auth work

Approve or change these defaults:

1. **Who can submit proof?** Recommended: original logger, verified authority, eligible nearby witness, or anyone with a verifiable primary source; other uploads become tips.
2. **Who can close a promise?** Recommended: senior independent reviewer only; never the uploader alone.
3. **Geofence defaults?** Recommended: 5 km urban / 15 km rural, 10-minute freshness, 150 m maximum reported accuracy, configurable per promise.
4. **Challenge window?** Recommended: 14 days normal / 30 days high-impact.
5. **Anonymous proof?** Recommended: anonymous to the public is allowed, but a privately authenticated account is required for proof that can influence completion.
6. **Authority-only proof?** Recommended: may create provisional completion, never verified completion without independent corroboration.
7. **Exact location retention?** Recommended: reduce to district/ward after the challenge window unless a dispute is open.

## 12. Primary references

- [W3C Geolocation API](https://www.w3.org/TR/geolocation/): permission, minimization and the explicit warning that the API does not guarantee actual device location.
- [C2PA Technical Specification 2.4](https://spec.c2pa.org/specifications/specifications/2.4/specs/C2PA_Specification.html): cryptographically verifiable provenance and tamper-evident manifests; not a truth verdict.
- [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html): allow-lists, authorization, server-generated names, isolated storage, malware scanning and CDR.
- [NIST SP 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html): phishing-resistant authentication and WebAuthn guidance.
- [Government of India, Digital Personal Data Protection Act 2023](https://www.meity.gov.in/static/uploads/2024/06/2bf1f0e9f04e6fb4f8fef35e82c42aa5.pdf): lawful purpose, specific informed consent, necessary-data limitation, withdrawal, correction/erasure and grievance obligations.
