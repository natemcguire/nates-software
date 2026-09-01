# Fake-stuff audit — Spec E follow-ups (deferred items)

Source: `docs/fake-stuff-audit.md`. This file tracks the items from Spec E
("Approval/merge integrity — the shippable, security-grade subset") that were
explicitly out of scope for that pass and still need real implementation work.
Branch `fresh/e-verify` implemented the bounded Spec E fixes only; the items
below were deliberately NOT attempted there.

## Deferred 1 — SSH pre-receive policy enforcement (GITSMITH audit #3)

- **Evidence:** `functions/api/git.ts:532`, `functions/api/git.ts:601`. Rich
  branch protection (required signers, required approvals, required CI
  checks, delete/non-fast-forward/protected-ref rules) is not enforced in a
  synchronous pre-receive boundary before a push is accepted.
- **Current state:** A CAS database projection accepts/records ref updates;
  it is not equivalent to rejecting an invalid Git receive at push time on
  the transport itself.
- **Why deferred:** This requires a real pre-receive hook (or equivalent
  synchronous gate on the SSH/Git transport) wired into the authoritative
  bare-repo write path, plus a policy table (protected refs, required
  signers/approvals/checks) and fail-closed behavior when the control plane
  is unreachable. That is a distinct, larger change from the INBOX
  approval-gate and FF-ancestry work in Spec E, and touches the transport
  layer (`sshTransport.ts`, `gatewayService.ts`) rather than the
  approval/merge-integrity surface this branch was scoped to.
- **Make it real:** Enforce delete/non-fast-forward/protected-ref/required-check
  rules in a synchronous pre-receive boundary and fail closed when the
  control plane is unavailable.

## Deferred 2 — RIG verification evidence bundle (RIG audit #3)

- **Evidence:** `functions/api/rig-verification.ts` accepts
  requester-selected verification commands and returns/persists
  digest-oriented results; INBOX fetches the repository diff separately
  (`src/views/InboxView.tsx`, PR diff tab) rather than receiving a single
  signed evidence bundle.
- **Current state:** A requester can choose weak/no-op build and test
  commands. The reviewer does not receive a server-owned, repository-pinned
  verification policy plus an immutable bundle of full logs, test reports,
  build artifacts, and network/isolation attestations in one package. Spec E
  added an evidence-load gate and OID-drift gate around the diff the
  reviewer already sees, but it does not create or require a verification
  evidence bundle — the diff and the (separate, requester-influenced)
  verification run remain two different objects.
- **Why deferred:** Building a real evidence bundle requires: a
  repository-owned immutable verification policy (not requester-selected
  commands), network-denied execution in the RIG runner, an R2-backed
  evidence bundle (logs, test reports, artifacts) keyed by a signed digest,
  an ancestry check binding the bundle to the exact commit under review, and
  mandatory display of that bundle in INBOX before approval. That is
  materially more infrastructure than the two bounded gates in Spec E and
  was explicitly excluded from this pass.
- **Make it real:** Repository-owned immutable verification policy,
  network-denied execution, R2 evidence bundle, signed digest, ancestry
  check, and mandatory display in INBOX before approval is enabled.

## Resolved in this pass (for reference — no longer open)

- **GITSMITH audit #4 ("Approve & merge" is ref landing, not a computed
  merge):** Found already substantially implemented on this branch's base —
  `functions/api/inbox.ts` already enforced fail-closed fast-forward
  ancestry via `getProposalDiff`/`isFastForward`/`diverged` before allowing
  approval, and the button/description language already said "fast-forward"
  rather than claiming a real three-way merge. Spec E's branch:
  - Renamed the approval button from "Approve & Land" to
    "Approve & Fast-Forward Merge" for full accuracy (`src/views/InboxView.tsx`).
  - Added the reviewer-saw-OID confirmation gate (see below) on top of the
    existing FF-ancestry check, without weakening it.
  - Verified (via `tests/inbox-approval-integrity.test.ts`) that a
    divergent (non-fast-forward) attempt still fails closed with 409 even
    when the reviewer's submitted OIDs match exactly — i.e. the new gate is
    additive, not a replacement for the ancestry check.
- **INBOX audit #4 (blind approval without loaded evidence):** Implemented
  in this branch. See `functions/api/inbox.ts` (reviewedTargetOid /
  reviewedSourceOid gate) and `src/views/InboxView.tsx` (evidence-loaded
  check, OID display, and the "I have reviewed the changes and evidence"
  acknowledgement checkbox gating the Approve button).
