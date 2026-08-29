# GITSMITH Local/Dev Git Gateway and Durable Forge Outbox Dispatcher

## 1. Architectural Overview & Authority Separation

GITSMITH implements an authoritative, Local-First bare Git repository gateway and durable forge outbox dispatcher. This repository ships the service code; it does not claim that a hosted gateway is currently provisioned or reachable.

### Authority Boundaries

| Domain | Authority | Mechanism |
|---|---|---|
| **Git Objects & Authoritative Refs** | Bare Git Storage (on disk) | `git update-ref <ref> <newOid> <expectedOldOid>` (CAS) |
| **Ref Query Projections** | Cloudflare D1 / SQLite (`repository_refs`) | Updated transactionally after successful Git CAS |
| **Ref Audit Log** | D1 `repository_ref_events` | Idempotent event rows keyed by `(repository_id, idempotency_key)` |
| **Repository Identity & Policy** | D1 `repositories`, `repository_members`, `repository_ref_policies` | Session-authenticated control plane |
| **Immutable Fork Lineage** | D1 `repository_forks` | Server-pinned parent/child OID snapshots, immutable triggers |
| **Cross-Boundary Work** | D1 `forge_outbox_events` | Durable outbox with finite conditional leases, exponential backoff, dead-letters |
| **Discrepancy Auditing** | D1 `forge_reconciliation_issues` | Automated scanning for Git vs D1 mismatches |

---

## 2. Safe Bare Repository Provisioning

All bare repositories are safely isolated beneath one explicit, configured root directory (`GITSMITH_REPOS_ROOT`).

### Security Invariants:
1. **Path Sandboxing:** Storage keys (e.g. `repositories/repo_123`) are strictly validated. Paths containing `..`, `//`, `\`, null bytes, or absolute paths are rejected before filesystem interaction.
2. **Symlink Escape Prevention:** Every component in the resolved directory chain is inspected via `fs.lstatSync()`. Symbolic links pointing outside the configured repository root are blocked immediately.
3. **Object Format Agnosticism:** Supports both `sha1` (40-hex) and `sha256` (64-hex) object formats depending on repository creation parameters and host Git binary support (`git init --bare --object-format=<sha1|sha256>`).

---

## 3. Authoritative Ref Compare-And-Swap (CAS)

D1 ref rows are never the Git authority. Ref mutations execute against the actual bare repository using Git's native compare-and-swap primitives:

- **Create Ref:** `git update-ref <ref> <newOid> 0000000000000000000000000000000000000000`
- **Update Ref:** `git update-ref <ref> <newOid> <expectedOldOid>`
- **Delete Ref:** `git update-ref -d <ref> <expectedOldOid>`

If the ref moved concurrently on disk, `git update-ref` aborts atomically and returns a stale CAS rejection without modifying refs or recording orphan events.

Following a successful Git CAS, the gateway notifies the control plane at `/api/git` (`action: 'gateway-record-ref'`) using a gateway token. If that callback fails, Git remains authoritative and an atomically-written local receipt is replayed on restart with the caller-provided idempotency key.

---

## 4. Durable Forge Outbox Dispatcher

The dispatcher continuously processes cross-boundary provisioning and fork work:

1. **Finite Conditional Leases:** Migration `0019_forge_outbox_leasing.sql` adds claim, lease, and dead-letter state. The standalone gateway claims work through authenticated control-plane actions; it does not need direct D1 credentials.
2. **Exponential Backoff & Retries:** Transient failures increment `attempts` and calculate exponential backoff (`Math.min(base * 2^(attempts-1), max)`).
3. **Dead-Lettering:** Events exceeding `maxAttempts` (default: 5) are dead-lettered and automatically generate a `forge_reconciliation_issues` audit row.
4. **Discrepancy Reconciler:** The embedded/test adapter can scan repository projections and report:
   - `git_missing_in_d1`: Ref exists in Git but is absent in D1.
   - `d1_missing_in_git`: Ref exists in D1 but is absent in Git.
   - `oid_mismatch`: Ref OID on disk differs from D1 projection.
   - `artifact_missing`: Repository marked active in D1 but missing on disk.

---

## 5. Fail-Closed Production Startup

In production (`NODE_ENV=production` or `GITSMITH_PRODUCTION_ENABLED=true`), the gateway fails closed during startup unless all 4 invariants are satisfied:
1. `GITSMITH_PRODUCTION_ENABLED=true` is explicitly set.
2. `GITSMITH_REPOS_ROOT` is configured, is an absolute dedicated directory (not root `/` or raw `/tmp`), exists, and is writable.
3. `GITSMITH_CONTROL_PLANE_URL` is configured and uses `https://`.
4. `GITSMITH_GATEWAY_TOKEN` is configured and contains at least 16 characters.

---

## 6. Local First-Run & CLI Reference

### Environment Configuration (`.env` or shell):
```bash
GITSMITH_REPOS_ROOT="/tmp/gitsmith-dev-repos"
GITSMITH_CONTROL_PLANE_URL="http://localhost:8788"
GITSMITH_GATEWAY_TOKEN="secret_gateway_token_xyz_123"
GITSMITH_PORT="8789"
```

### CLI Commands:
```bash
# Check readiness and health status
npm run gateway -- check
# or
./bin/gitsmith-gateway check

# Start the gateway server and dispatcher
npm run gateway -- start
# or
./bin/gitsmith-gateway start --port 8789
```

### Health & Readiness Probes:
- **`GET /healthz`** — Returns process uptime and status `200 OK`.
- **`GET /readyz`** — Truthfully distinguishes between `configured` and `active`:
  - Returns `200 OK` only when Git is available, storage root is writable, the dispatcher loop is running, and an authenticated control-plane probe succeeds.
  - Returns `503 Service Unavailable` with detailed check diagnostics if degraded.

## 7. End-User SSH Git Transport

When `GITSMITH_SSH_ENABLED=true`, the gateway starts a second, raw TCP listener
for standard Git-over-SSH. It accepts only the `git` SSH principal and registered
public keys from PROFILE.CFG. It provides no PTY, interactive shell, port
forwarding, or arbitrary command execution. The only accepted commands are
strictly parsed `git-upload-pack '<owner>/<repo>.git'` and
`git-receive-pack '<owner>/<repo>.git'` requests.

Every command is authorized against the control plane. Reads require repository
visibility or membership; writes require writer, maintainer, or owner membership.
Storage keys come from D1 and pass the gateway's path and symlink sandbox before
Git is spawned. `git-receive-pack` performs the authoritative atomic ref update.
A bounded post-receive hook captures the exact old/new/ref tuple, and the gateway
projects it into D1 using an idempotent callback. Callback failure creates a
durable receipt on the mounted repository volume for restart replay.

The Ed25519 server host key is generated once beneath the persistent repository
root and survives deployments. Readiness separately reports storage provisioning
and SSH transport, so an HTTP-healthy gateway cannot imply clone/push support.

Required production variables:

```bash
GITSMITH_SSH_ENABLED=true
GITSMITH_SSH_HOST=<public TCP proxy host>
GITSMITH_SSH_PORT=2222
GITSMITH_SSH_PUBLIC_PORT=<public TCP proxy port>
```
