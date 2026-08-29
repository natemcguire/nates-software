# DYNO — The LLM Dynamometer

DYNO measures an entire working LLM system under real developer load: model,
model configuration, agent harness, tools, environment, network policy, and
repetition. It is not a hardware token-speed test and it never benchmarks Nate's
Software marketplace applications.

Nate's Software is the official evaluator and editorial publisher. A model
vendor or user cannot buy, upload, or self-assert a Certified result.

## Measurement classes

| Class | Operator | Task visibility | Publication claim |
| --- | --- | --- | --- |
| `street` | Anyone using the DYNO CLI | Public canonical tasks | Self-reported local measurement |
| `reproduced` | Nate's Software or an approved lab | Versioned replay material | Independently reproduced Street result |
| `certified` | Nate's Software | Private, previously unused tasks | Official independent DYNO evaluation |
| `certified_double_blind` | Nate's Software and the model owner through an attested enclave | Evaluator and model assets remain mutually secret | Official double-blind DYNO evaluation |

These are evidence classes inside DYNO, not separate products. Public CLI runs
remain useful as the street-race counterpart to the controlled DYNO room, but
they cannot promote themselves into a Certified class.

## What is measured

A result is identified by the complete coordinate below. Changing any element
creates a different measurement.

```text
suite + task-set commitment + grader commitment
  × model provider + model + immutable model revision + model configuration
  × harness + harness revision + tool manifest
  × runtime image/TCB + machine class + network policy
  × seed + repetition + output policy
  = one DYNO measurement identity
```

Scores are projections of immutable attempt and grader evidence. Tokens per
second, time to first token, cache use, cost, and duration are diagnostic curves;
successful completion of real work remains the primary measurement.

## Nate-run Certified evaluations

Nate's Software controls the private task reserve, selects a previously unused
task set, executes the evaluation, reviews the evidence, and publishes the
editorial result. The public receives enough information to identify and audit
the measurement without receiving reusable hidden prompts or graders:

- methodology and scoring version;
- commitments to the private task set and graders;
- model, harness, tool, environment, and network identities;
- execution and output-policy digests;
- attestation and approval records when confidential compute is used;
- aggregate scores, uncertainty, failures, costs, and disclosed limitations.

The private task corpus is not a downloadable product. Public fixtures may test
the same skills but must not reproduce the Certified reserve.

## Double-blind Certified ceremony

Double-blind execution protects two independent secrets: Nate's private tasks
and graders, and the provider's proprietary model assets. A generic cloud worker
token is not sufficient evidence. The ceremony is:

1. Nate and the model owner agree on a public mock inference interface.
2. DYNO commits to the evaluation code, private task set, graders, and bounded
   output policy. The provider commits to the model revision and inference code.
3. An ephemeral confidential-compute environment boots with no interactive
   administration and restricted egress.
4. The environment produces a fresh hardware-rooted attestation quote. The quote
   binds a participant nonce, ephemeral channel public key, complete trusted
   computing base (TCB) measurement, execution policy, and ceremony identity.
5. Nate and the model owner independently verify the quote and approve the exact
   same manifest. Approval records are immutable and content-addressed.
6. Each party sends encrypted assets through a channel bound to the attested
   ephemeral key. Assets are never persisted in Nate's application database.
7. The approved computation runs. Only outputs allowed by the pre-approved policy
   leave the enclave.
8. The enclave signs the result identity and is destroyed. Destruction evidence
   is recorded; DYNO retains nonsensitive commitments and audit records.

No run is labeled `certified_double_blind` unless every required approval,
attestation, measurement, asset receipt, result binding, and destruction record
is present and valid. If the confidential-compute provider is unconfigured or a
quote cannot be independently verified, the ceremony remains unavailable.

## Trust boundaries and limitations

An enclave narrows trust; it does not eliminate it. DYNO must disclose the
hardware vendor, cloud operator, verifier implementation, firmware/security
version floors, reproducibility status of the TCB, proprietary components, and
any party in the attestation verification path. A valid quote proves a measured
environment ran; it does not prove the benchmark is representative or the
editorial conclusion is correct.

DYNO Pages Functions coordinate identities, approvals, jobs, and public results.
They do not execute model-supplied commands, decrypt private task/model assets,
or simulate enclave attestations. Execution belongs to a separately commissioned
runner with an allowlisted provider adapter.

This ceremony design is informed by the AVERI, Google DeepMind, OpenMined, and
MLCommons [Double Blind Evals technical report](https://storage.googleapis.com/deepmind-media/DeepMind.com/Blog/piloting-the-worlds-first-double-blind-ai-evaluations/double-blind-evaluations-technical-report.pdf).
DYNO adopts its core separation of model-owner assets, evaluator assets,
hardware-rooted measurement, independent approval, bounded output, and ephemeral
destruction while making no claim that Nate's Software currently operates that
confidential-compute infrastructure.

## First-run contract

The first DYNO screen explains the dynamometer metaphor and asks whether the user
wants to inspect Official Certified results or run a Street measurement. Street
runs show their model, harness, tools, network, and environment coordinate before
execution and remain visibly self-reported after upload. Certified pages show the
official evaluator, methodology, evidence class, disclosed limitations, and—when
applicable—the double-blind attestation ceremony.
