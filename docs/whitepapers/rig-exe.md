# RIG.EXE

## Runtime-Agnostic Preview and Build Isolation

**Status:** Architecture specification

**Edition:** 2.0 — August 2026

## Abstract

RIG.EXE builds and runs application revisions inside bounded, disposable Linux
containers. It provides a real preview runtime without prescribing how an
application stores data. A workload may use SQLite, Postgres, object storage,
flat files, browser storage, an external service, or no persistence at all.

RIG owns process isolation, resource enforcement, health evidence, logs, and
artifact identity. The application owns its storage architecture. SQLite and WAL
are supported choices, never platform requirements.

## Runtime Contract

Each revision supplies a versioned manifest declaring:

- immutable runtime or container image digest;
- build and start commands;
- health checks and ports;
- CPU, memory, wall-time, and process limits;
- environment-variable names without secret values;
- network-egress policy;
- optional explicitly declared volumes;
- optional runtime-specific backup and export hooks.

Unknown manifest versions and undeclared capabilities fail closed. The workload
runs as a non-root user with dropped capabilities, a disposable root filesystem,
bounded temporary storage, and no Nate's Software control-plane secrets.

## Execution Flow

```text
Git commit + manifest
          |
          v
 isolated builder ----> content-addressed build artifact
          |
          v
 ephemeral candidate ----> health + logs + resource evidence
          |
          v
 deployment revision eligible for explicit promotion
```

A healthy preview is evidence, not publication. GITSMITH owns Git ref movement;
the deployment service owns revision activation. RIG cannot silently publish a
branch or promote itself to production.

## Storage Freedom

Persistent volumes are opt-in and explicitly declared. RIG treats a volume as an
opaque application resource unless its manifest selects a compatible adapter.
It never assumes a volume is a database, that a database is SQLite, or that a
SQLite application uses WAL.

Stateless workloads receive no durable mount. Stateful workloads can select the
storage system appropriate to their own concurrency, portability, recovery, and
availability requirements. Backup success means the application's declared hook
completed and produced verified evidence; RIG does not fabricate checkpoints or
database-integrity claims.

## Failure and Recovery

RIG records exit status, timestamps, health transitions, resource observations,
and bounded logs. Exit code 137 is classified as `SIGKILL` until cgroup and kernel
evidence proves an out-of-memory event. Restart policies use bounded backoff and
circuit breaking so a crash loop is never presented as healthy availability.

Containers are disposable. A new session starts from the selected immutable
artifact and declared inputs. Only explicitly attached external resources can
outlive it.

## Standalone Guarantee

RIG accepts standard artifacts and manifests and can run independently of
HOTWIRE, SLOPSHOP, GITSMITH, or INBOX. Its value is a truthful, reproducible
runtime boundary: real commands, real isolation, real evidence, and no hidden
storage mandate.
