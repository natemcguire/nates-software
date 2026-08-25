# RIG.EXE

## The Micro-Container Runtime & SQLite Storage Engine

**Status:** Architecture specification

**Edition:** 1.0 — August 2026

## Abstract

RIG.EXE is a single-host application runtime built around two deliberately small
units of ownership: an ephemeral Linux container and a durable SQLite database
file. Application code is replaceable; user data is not. Each application
process binds to port `3001` inside its container, runs under an explicit memory
budget, and sees its database at a stable filesystem path backed by a host-local
volume. SQLite operates in write-ahead logging (WAL) mode, so normal reads do not
block the sole writer and storage operations do not incur network-database
latency.

RIG does not pretend that a single-node SQLite service is a globally replicated
database. It instead makes the single-node contract exceptionally clear:
transactional local storage, portable files, bounded processes, observable
failure, and fast recovery. A user can stop an application, checkpoint its WAL,
and take custody of a coherent `.sqlite` file without an export pipeline or a
vendor-specific restoration service.

## Core Problem Statement

Consumer software is commonly packaged as a stateless web process attached to a
proprietary, multi-tenant database. That arrangement simplifies fleet operation
for the vendor while weakening the user's ownership. Data portability becomes an
API feature; restoration depends on a control plane; local development behaves
differently from production; and a small application inherits the operational
surface of a distributed system.

RIG addresses applications whose natural write domain is one user, household,
team, or small community. For that class of workload, a network database often
adds failure modes without adding useful concurrency. The architectural question
is not whether SQLite can imitate a distributed database. It is whether the
application can be designed so that a local transactional file is the complete,
authoritative data unit.

RIG adopts the following invariants:

1. Exactly one durable database volume is assigned to an application instance.
2. Containers are disposable and contain no authoritative state.
3. The application listens on `0.0.0.0:3001`; only the RIG ingress proxy is
   published externally.
4. The database is on a local filesystem with correct POSIX locking semantics.
5. A database backup is accepted only after a successful SQLite integrity check.
6. Exit code `137` is evidence of `SIGKILL`, not proof of an out-of-memory kill;
   RIG correlates kernel and cgroup evidence before assigning cause.

## Architectural Design & Data Flow

### Runtime topology

```text
                       host trust boundary
      ┌─────────────────────────────────────────────────────────┐
TLS   │  ┌──────────────┐      private bridge                  │
─────>│  │ RIG ingress  │──────────────┐                       │
      │  │ auth/routing │              v                       │
      │  └──────────────┘   ┌─────────────────────────────┐    │
      │                     │ ephemeral Linux container   │    │
      │                     │ app process :3001           │    │
      │                     │ read-only image + tmpfs     │    │
      │                     └──────────────┬──────────────┘    │
      │                                    │ /data/app.sqlite  │
      │                                    v                   │
      │                     ┌─────────────────────────────┐    │
      │                     │ host-local durable volume   │    │
      │                     │ db + WAL + SHM              │    │
      │                     └─────────────────────────────┘    │
      │                                    │                   │
      │                         checkpoint │ snapshot          │
      │                                    v                   │
      │                     ┌─────────────────────────────┐    │
      │                     │ user-owned backup target    │    │
      │                     └─────────────────────────────┘    │
      └─────────────────────────────────────────────────────────┘
```

The supervisor creates a per-instance cgroup, an isolated network namespace, a
read-only root filesystem, a writable `tmpfs` for transient files, and one
explicit bind mount for `/data`. The image is addressed by immutable digest. RIG
injects configuration through an allowlisted environment and secret-file mount;
it never bakes credentials into the image. The application runs as a non-root UID
with dropped capabilities and `no-new-privileges` enabled. A seccomp profile and,
where available, AppArmor or SELinux policy restrict the syscall surface.

The process contract is intentionally uniform. The app binds port `3001`, exposes
`/health/live` and `/health/ready`, handles `SIGTERM`, stops accepting new writes,
and exits before the configured grace deadline. RIG maps an operator-selected
host port or hostname to the private container port. Binding consistency removes
per-application discovery logic while leaving public addressing to the ingress
layer.

### SQLite lifecycle

At first open, the application or RIG initialization hook applies a known set of
pragmas, including `journal_mode=WAL`, `foreign_keys=ON`, and a bounded
`busy_timeout`. `synchronous=FULL` is the default durability profile; operators
may explicitly select `NORMAL` when the small risk window after host power loss is
acceptable. RIG does not silently weaken durability.

WAL mode creates a three-file live set: the main database, `-wal`, and `-shm`.
Consequently, copying only the main file while the application is running is not
a valid backup procedure. RIG supports two coherent paths:

- **Online backup:** use SQLite's backup API into a temporary destination, run
  `PRAGMA integrity_check`, `fsync` the file and containing directory, then rename
  it atomically into the backup catalog.
- **Quiesced handoff:** drain requests, stop the writer, issue
  `wal_checkpoint(TRUNCATE)`, verify that no process holds the database, and copy
  the main file.

Automatic passive checkpoints keep WAL growth bounded without stalling active
readers. When the WAL exceeds a configurable byte or frame threshold, the
supervisor requests a restart-safe checkpoint. If a long-running reader prevents
truncation, RIG reports the blocker and storage pressure rather than deleting WAL
state. Disk-watermark policy stops new writes before filesystem exhaustion can
turn an ordinary capacity issue into database corruption.

### Start, serve, and replace sequence

```text
manifest -> verify image digest -> lock instance lease -> mount volume
         -> start cgroup/container -> wait for :3001 readiness
         -> attach ingress -> serve -> drain -> checkpoint -> stop
```

An instance lease prevents two writers from mounting the same volume by mistake.
Replacement is create-before-destroy only when the application is explicitly
read-only; ordinary stateful upgrades use drain, checkpoint, stop, migrate, start,
and readiness verification. Schema migrations execute under `BEGIN IMMEDIATE`,
record their version and checksum, and must be forward-only or accompanied by a
tested restoration procedure.

### Memory enforcement and Exit 137 triage

RIG applies cgroup v2 `memory.max`, `memory.high`, and optional `memory.swap.max`
limits. The supervisor samples `memory.current`, `memory.events`, pressure stall
information, and per-process RSS. A high-water notification provides time for
diagnostic capture or graceful load shedding before the hard limit.

When a container exits with status `137` (`128 + SIGKILL`), triage follows an
evidence chain:

1. Snapshot the cgroup's `memory.events` counters before teardown.
2. Compare `oom` and `oom_kill` deltas with the instance baseline.
3. Correlate kernel OOM records, termination timestamp, configured limit, peak
   usage, and supervisor actions.
4. Classify the event as `cgroup_oom`, `host_oom`, `operator_sigkill`,
   `deadline_sigkill`, or `unknown_sigkill`.
5. Preserve the last logs, request rate, RSS trend, image digest, and database/WAL
   sizes in a crash bundle.

Restart policy is rate-limited with exponential backoff and a circuit breaker. An
OOM loop is not treated as availability: after the threshold, RIG holds the
instance, leaves its volume untouched, and presents remediation such as raising
the limit, reducing concurrency, or inspecting a suspected leak.

## Storage & Security Guarantees

RIG's strongest storage guarantee is comprehensibility. Committed SQLite
transactions survive process failure under the selected synchronous policy. A
container replacement cannot erase the database because the volume lifecycle is
separate from the container lifecycle. Backups are versioned, checksummed, and
restored into a new path before atomic activation; restoration never overwrites
the only known-good copy in place.

The “one-second migration” property refers to custody and local handoff, not an
unconditional performance promise: once quiesced and checkpointed, the complete
logical database is one ordinary `.sqlite` file that can be copied, downloaded,
or mounted elsewhere. Transfer duration still depends on file size and medium.

RIG encrypts transport at ingress and can use host-volume encryption at rest.
Application-level secrets remain external to the database unless the application
explicitly stores them. Volume paths are not shared across tenants, backup access
is separately authorized, and audit records cover starts, stops, image changes,
checkpoint outcomes, backup reads, and restore operations. Logs exclude secret
values and database contents by default.

RIG does not claim Byzantine fault tolerance, multi-primary writes, transparent
cross-region failover, or safety on filesystems that violate SQLite locking
requirements. Operators needing those properties should choose a replicated
database rather than obscuring the mismatch.

## Why It Must Be Open Source & Standalone

Data ownership is incomplete if the program required to open, run, or migrate the
data is controlled by one vendor. RIG's runtime, manifest schema, backup format,
and crash classifier must be inspectable and reproducible. No telemetry endpoint
is required for operation; an operator can run the full system on a low-cost Mac
mini, an old ThinkPad with Linux, or a commodity VPS.

Standalone operation is a structural guarantee. RIG accepts a container image, a
manifest, and a filesystem path. It does not require HOTWIRE identity, GITSMITH
hosting, SLOPSHOP metadata, or INBOX.EXE approval. The exit path is equally plain:
stop the process, checkpoint, take the `.sqlite` file, and run it under any
compatible runtime. That reversibility is the product.
