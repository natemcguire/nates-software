# SLOPSHOP

## The AST-Aware Forking, Feature Splicing & AI Modding Speed Shop

**Status:** Architecture specification

**Edition:** 1.0 — August 2026

## Abstract

SLOPSHOP is a local-first software modification system for moving a bounded
feature between related TypeScript and JSX applications. It treats source code as
typed structure rather than text. The engine parses abstract syntax trees (ASTs),
extracts component and module dependency graphs, resolves a feature package from
`refs/features/*` plus `manifest.json`, plans schema migrations, and applies the
change in an isolated Git worktree. Compilation, linting, migration checks, and
tests form the acceptance boundary.

AI agents participate as planners and repair workers, not as authorities. A local
agent—Claude Desktop, OpenAI Codex, Cursor, or another tool—can be opened through
a deep link carrying a constrained task envelope. It may propose adaptations, but
SLOPSHOP independently verifies paths, capabilities, patches, and assertions
before a result becomes eligible for commit.

## Core Problem Statement

Forking copies an application but does not make its features portable. Once two
forks diverge, a feature such as dark mode, OCR ingestion, or a payment gateway is
distributed across components, hooks, routes, configuration, dependencies,
assets, and database changes. A textual patch captures historical line positions;
it does not express architectural intent. Applying it elsewhere either fails
mechanically or, worse, succeeds while omitting an invariant.

Traditional package managers solve reusable library distribution, not the
controlled transformation of an application. AI can infer transformations, but
unbounded prompting lacks repeatability and a reliable acceptance contract.
SLOPSHOP combines deterministic program analysis with explicitly scoped AI repair.
Its key artifact is not a prompt or a diff. It is a feature package whose declared
surface can be analyzed before execution and verified afterward.

The design preserves five invariants:

1. Every splice begins and ends at a Git commit boundary.
2. No feature may read or write outside its declared path and capability scope.
3. Database migrations are ordered, checksummed, and never silently reordered.
4. An AI-produced edit has no special trust; it passes the same assertions as any
   other patch.
5. If validation fails, the target branch and working directory remain unchanged.

## Architectural Design & Data Flow

### Feature package contract

A feature ref is an immutable Git ref under `refs/features/<feature>/<version>`
pointing to a commit or annotated tag. The referenced tree contains a
`manifest.json` and the feature payload. A minimal manifest declares:

```json
{
  "schemaVersion": 1,
  "id": "com.nates-software.ocr",
  "version": "2.1.0",
  "sourceCommit": "<40-or-64-hex-object-id>",
  "requires": { "node": ">=22", "framework": "next>=16 <17" },
  "entrypoints": ["src/features/ocr/index.ts"],
  "exports": ["OcrUploader", "extractText"],
  "capabilities": ["filesystem:read-user-selected", "network:ocr-provider"],
  "dependencies": { "runtime": {}, "development": {} },
  "migrations": ["migrations/20260825_001_ocr_jobs.sql"],
  "assertions": ["typecheck", "lint", "test:ocr", "build"]
}
```

The production schema additionally pins payload hashes, toolchain versions,
license and attribution data, supported source/target graph signatures,
configuration keys, secret names, routes, assets, and uninstall behavior.
Unknown schema versions fail closed. Semantic versions are advisory; hashes and
Git object IDs establish identity.

### Analysis and splice pipeline

```text
 source feature ref                        target repository
         │                                        │
         v                                        v
┌─────────────────┐                       ┌─────────────────┐
│ verify manifest │                       │ parse TS/JS/JSX │
│ hashes + policy │                       │ config + schema │
└────────┬────────┘                       └────────┬────────┘
         └───────────────┬────────────────────────┘
                         v
               ┌─────────────────────┐
               │ normalize graphs    │
               │ symbols/modules/UI  │
               │ routes/data/config  │
               └──────────┬──────────┘
                          v
               ┌─────────────────────┐
               │ deterministic plan  │
               │ exact / adapt / gap │
               └──────┬────────┬─────┘
                      │        │ unresolved semantic gap
                      │        v
                      │   ┌───────────────┐
                      │   │ local AI agent│
                      │   │ scoped repair │
                      │   └───────┬───────┘
                      └───────────┤
                                  v
                       isolated Git worktree
                                  │
                    migrations -> typecheck -> tests -> build
                                  │
                           signed splice report
```

The parser uses the target project's actual TypeScript configuration, module
resolution rules, JSX mode, and package graph. It records declarations, imports,
exports, call sites, JSX element use, route registration, context providers,
hooks, environment variables, and data-access symbols. Framework adapters add
known semantics—for example server/client boundaries or file-system routing—but
their output is normalized into a framework-neutral graph.

The feature extractor computes the transitive dependency closure from declared
entrypoints. It then classifies nodes as owned, shared, or external. Owned nodes
ship in the payload. Shared nodes become required interfaces or adaptation sites.
External nodes become package, service, or capability requirements. Dynamic
imports, reflection, generated code, and string-computed routes are marked as
uncertain rather than guessed.

Planning compares source and target graphs by stable symbol identity, type shape,
relative role, and structural fingerprints. Exact matches receive deterministic
AST transforms. Compatible mismatches receive adapter transforms. Ambiguous
matches become explicit gaps. Text patches are reserved for file formats without
an available structural parser and are guarded by content hashes.

### AI agent deep-linking

SLOPSHOP registers local URI handlers such as
`slopshop://task/<opaque-local-id>`. The URI contains no source, secret, or prompt;
it resolves through a loopback broker to a short-lived task envelope. Adapters
open the selected local agent with:

- target worktree and allowlisted file paths;
- source/target graph excerpts and unresolved constraints;
- commands the agent may request;
- an output schema for proposed edits and rationale;
- a nonce, expiry, and return callback bound to the local session.

The broker requires user presence for a first-use tool registration and rejects
remote origins. Agent output is staged in the isolated worktree. SLOPSHOP reparses
the result, detects undeclared capability or dependency expansion, and runs the
full assertion set. Deep-linking is therefore an ergonomics layer, not a remote
code-execution shortcut.

### Migration sequence resolver

Migrations form a directed acyclic graph keyed by `(feature_id, migration_id,
checksum)`. Dependencies may point to application schema milestones or other
feature migrations. The resolver performs a stable topological sort, rejects
cycles, detects an existing ID with a different checksum, and produces a plan for
both a fresh database and every declared supported upgrade origin.

Each migration is tested against disposable database copies. SQLite migrations
run inside the strongest transaction the operation permits; operations requiring
table reconstruction follow an explicit create-copy-verify-swap sequence.
Destructive changes require a backup assertion and an operator-visible approval.
SLOPSHOP records applied migration checksums in a dedicated schema table. A code
splice cannot pass while its database state is only partially specified.

### Compile-time and behavioral acceptance

Validation is layered so cheap, high-signal checks run first: manifest and hash
verification, parse, dependency policy, AST reanalysis, formatting, typecheck,
lint, focused feature tests, migration tests, full tests, and production build.
The package may add assertions but cannot remove repository-required assertions.
The result is a machine-readable splice report containing source and target OIDs,
toolchain digests, graph changes, commands, exit status, test evidence, generated
files, and migration plan.

## Storage & Security Guarantees

SLOPSHOP's authoritative inputs are immutable Git objects and content-addressed
feature payloads. Its cache is disposable. Plans and reports may be retained for
audit, but a splice can be reproduced from the source ref, target ref, manifest,
toolchain lock, and policy. Work occurs in a new worktree with a clean index; ref
publication is delegated to Git's atomic update mechanisms or GITSMITH.

Untrusted feature code is never evaluated during discovery. Manifests are parsed
as data, package lifecycle scripts are disabled during dependency resolution, and
tests/builds execute in a sandbox with bounded CPU, memory, time, filesystem, and
network access. Dependencies are lockfile-pinned and checked against operator
policy. Secret capabilities are names, not values; secrets are supplied only to
tests that explicitly require them and are redacted from output.

Static analysis is not claimed to be complete for a dynamic language. SLOPSHOP
makes uncertainty visible and moves residual risk into sandboxed execution and
human approval. A green report proves that the declared assertions passed for
specific inputs and toolchain versions. It does not prove the absence of all bugs
or malicious behavior.

## Why It Must Be Open Source & Standalone

The ability to alter owned software is as important as the ability to run it. If
feature formats, AST transforms, or agent routing belong to one model provider,
then apparent software ownership remains contingent on that provider. Open source
makes the transformation rules, manifest semantics, and acceptance boundary
auditable. Competing parsers, agents, and policy engines can implement the same
contract.

SLOPSHOP runs against an ordinary local Git repository. It can emit a branch,
patch series, feature ref, or signed report without GITSMITH. It can invoke any
compatible local agent or no AI at all. It does not require HOTWIRE discovery,
INBOX.EXE review, or RIG deployment. This independence prevents the modding layer
from becoming another proprietary app store gate.
