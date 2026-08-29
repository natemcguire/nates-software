# DYNO — Real-World AI Agent Benchmark Model

Migration: `migrations/0007_dyno_real_world_benchmarks.sql`

DYNO is a standalone benchmark product. It measures whether a model, agent harness, and tool configuration can complete common real-world work. It does not measure how Nate's Software marketplace apps perform.

## Benchmark identity

```text
versioned suite + tasks + hidden graders
                  x
model + model config + agent harness + tools
                  x
machine + OS + runtime image + network policy
                  x
repetition + randomization seed
                  =
one reproducible DYNO run
```

## Stored evidence

- `dyno_suites`: immutable methodology coordinates and grader version.
- `dyno_tasks`: common-command scenarios with fixture and hidden-grader digests.
- `dyno_subjects`: model, configuration, harness, harness version, and tools.
- `dyno_environments`: hardware, OS, runner image, runtime, and network policy.
- `dyno_runs`: complete run identity, aggregate score, cost, tokens, trace location, and attestation.
- `dyno_task_attempts`: correctness, latency, tokens, cost, tool calls, intervention, unnecessary changes, and safety outcomes.
- `dyno_tool_events`: ordered command/tool trace metadata using content digests rather than leaking hidden fixtures.
- `dyno_grader_results`: versioned grader outcomes and evidence digests.

## Scoring rules

The public score is a projection, not raw truth. Raw task attempts and grader results are canonical. A score formula must be versioned with the suite and reproducible from those records.

Token throughput and time-to-first-token may be diagnostic measurements, but they cannot substitute for task correctness. The primary result is successful real-world completion under a controlled, repeatable environment.

## Verification levels

- `unverified`: self-submitted trace.
- `reproducible`: a second run produced results within the suite's declared tolerance.
- `verified`: executed or attested by a trusted DYNO runner.
- `rejected`: evidence, environment, or safety policy failed verification.

