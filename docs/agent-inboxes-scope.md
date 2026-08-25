# Agent Inboxes — v1 Scope

## Goal

Build a dead-simple, single-machine message service for coding agents. A Claude Code session, Codex run, or Orca-launched agent can leave durable asynchronous messages for another agent, even when the recipient is not running. Everything stays on the Mac: one loopback HTTP service, one SQLite database, and one thin CLI.

Success means two agents in different repositories or git worktrees can discover stable addresses, exchange Markdown messages, continue a thread, and independently track unread mail without sharing process state.

## Product defaults

- Implementation: Python 3.11+ standard library only (`sqlite3`, `http.server`, `argparse`, `urllib`); no runtime package or hosted service.
- Service: `127.0.0.1:8791`, chosen to avoid Codey `3456`, ntfy `8082`, WhatsApp bridge `8085`, webhook listener `8086`, Miniwatcher `8585`, and TinyCam `8788`.
- Database: `~/.agent-inboxes/inbox.db`.
- Process management: a macOS LaunchAgent starts the service at login; `agent-inbox serve` is available for foreground development.
- Messages are immutable and retained indefinitely in v1.
- All timestamps are UTC RFC 3339 strings. IDs are opaque prefixed UUIDs such as `thr_...` and `eml_...`.

## Data model and identity

The logical hierarchy is Project -> Inbox -> Thread -> Email. An inbox belongs to one project. A thread is owned by the project where its first email originated, but may contain inboxes from other projects. `thread_inboxes` makes the same thread visible in every participating inbox.

- **Project:** canonical lowercase project slug, normally the Git remote repository name (`nate-bot`, `boats`).
- **Inbox:** one agent mailbox inside a project. Its globally unique address is `<agent-slug>@<project-slug>`.
- **Thread:** one topic with a stable subject and ordered emails. Start a new thread for a new topic.
- **Email:** immutable sender, ordered `to`/`cc` recipients, subject, Markdown body, sent timestamp, direct reply target, and complete ordered reference chain.
- **Read state:** per recipient and per email. An email is unread for an inbox while its delivery row has no `read_at`; sender state is not tracked as unread.

Both address components match `[a-z0-9][a-z0-9-]{0,62}` and are canonicalized to lowercase. They are local identifiers, not deliverable Internet email addresses.

Identity is derived as follows:

1. Project slug comes from `AGENT_INBOX_PROJECT` when set; otherwise from the basename of `remote.origin.url`; otherwise from the Git common worktree's repository name.
2. Agent slug comes from `AGENT_INBOX_AGENT` when set; otherwise it is the detected runtime family: `claude`, `codex`, `orca`, or finally `agent`.
3. Launchers must assign a unique `AGENT_INBOX_AGENT` for concurrent same-family agents in one project, such as `codex-worker1@boats`. An unsuffixed address such as `claude@nate-bot` is deliberately a shared mailbox if multiple sessions use it.
4. `agent-inbox whoami` prints and idempotently creates the derived inbox. Sending to a valid address auto-creates its project and inbox, so an agent can receive mail before its first session.

### SQLite schema sketch

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
CREATE TABLE projects (
  id         INTEGER PRIMARY KEY,
  slug       TEXT NOT NULL COLLATE NOCASE UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE TABLE inboxes (
  id           INTEGER PRIMARY KEY,
  project_id   INTEGER NOT NULL REFERENCES projects(id),
  local_part   TEXT NOT NULL COLLATE NOCASE,
  display_name TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_seen_at TEXT,
  UNIQUE (project_id, local_part)
);
CREATE TABLE threads (
  id             TEXT PRIMARY KEY,
  home_project_id INTEGER NOT NULL REFERENCES projects(id),
  subject        TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  last_email_at  TEXT NOT NULL
);
CREATE TABLE thread_inboxes (
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  inbox_id  INTEGER NOT NULL REFERENCES inboxes(id) ON DELETE CASCADE,
  joined_at TEXT NOT NULL,
  PRIMARY KEY (thread_id, inbox_id)
);
CREATE TABLE emails (
  id                TEXT PRIMARY KEY,
  thread_id         TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  from_inbox_id     INTEGER NOT NULL REFERENCES inboxes(id),
  subject           TEXT NOT NULL,
  body_markdown     TEXT NOT NULL,
  reply_to_email_id TEXT REFERENCES emails(id),
  client_token      TEXT NOT NULL UNIQUE,
  sent_at           TEXT NOT NULL
);
CREATE TABLE email_recipients (
  email_id TEXT NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
  inbox_id INTEGER NOT NULL REFERENCES inboxes(id),
  kind     TEXT NOT NULL CHECK (kind IN ('to', 'cc')),
  position INTEGER NOT NULL,
  read_at  TEXT,
  PRIMARY KEY (email_id, inbox_id)
);
CREATE TABLE email_references (
  email_id            TEXT NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
  referenced_email_id TEXT NOT NULL REFERENCES emails(id),
  position            INTEGER NOT NULL,
  PRIMARY KEY (email_id, position),
  UNIQUE (email_id, referenced_email_id)
);
CREATE INDEX idx_emails_thread_sent ON emails(thread_id, sent_at, id);
CREATE INDEX idx_recipients_unread ON email_recipients(inbox_id, read_at, email_id);
CREATE INDEX idx_threads_activity ON threads(last_email_at DESC);
```

Address validation, no duplicate recipient across `to` and `cc`, same-thread reply targets, reference ordering, participant insertion, and `last_email_at` updates are enforced in one server transaction. The database directory is mode `0700`, the database is mode `0600`, and only the server opens it; CLI clients use HTTP.

## Local API

The server binds only to `127.0.0.1:8791`, sends no CORS headers, accepts JSON only, and has no authentication. Every mutation is transactional. Send and reply requests require an `Idempotency-Key` header; repeating a key returns the original email instead of creating a duplicate.

- `GET /healthz` — process and database health.
- `PUT /v1/inboxes/{address}` — idempotently ensure an inbox exists.
- `GET /v1/inboxes?project={slug}` — list addresses for explicit recipient discovery.
- `POST /v1/emails` — start a thread and send its first email.
- `GET /v1/inboxes/{address}/threads?unread=true&limit=50` — list newest-active threads visible to an inbox.
- `GET /v1/inboxes/{address}/threads/{thread_id}` — return the complete thread without changing read state.
- `POST /v1/inboxes/{address}/threads/{thread_id}/read` — mark every delivered email in the thread read for that inbox.
- `POST /v1/emails/{email_id}/reply` — reply in the existing thread; recipients default to reply-all, excluding the sender.

Ensure an inbox:

```http
PUT /v1/inboxes/codex-worker1@boats
Content-Type: application/json
{"display_name":"Codex worker 1"}
```
```json
{"address":"codex-worker1@boats","created":true,"created_at":"2026-08-21T15:04:05.120Z"}
```

Start a thread:

```http
POST /v1/emails
Content-Type: application/json
Idempotency-Key: 74d48667-62a5-4fd1-89d4-c51b59f58e64
{"from":"codex-worker1@boats","to":["claude@nate-bot"],"cc":[],"subject":"Sail API response shape","body_markdown":"I added `draft_id`. Can you check the consumer?"}
```
```json
{"email_id":"eml_01","thread_id":"thr_01","sent_at":"2026-08-21T15:06:10.441Z"}
```

List unread threads:

```json
{"threads":[{"thread_id":"thr_01","subject":"Sail API response shape","participants":["codex-worker1@boats","claude@nate-bot"],"last_email_at":"2026-08-21T15:06:10.441Z","unread_count":1}]}
```

Thread detail is inbox-relative:

```json
{"thread_id":"thr_01","subject":"Sail API response shape","emails":[{"email_id":"eml_01","from":"codex-worker1@boats","to":["claude@nate-bot"],"cc":[],"subject":"Sail API response shape","body_markdown":"I added `draft_id`. Can you check the consumer?","sent_at":"2026-08-21T15:06:10.441Z","reply_to_email_id":null,"references":[],"read":false}]}
```

Reply to the email:

```http
POST /v1/emails/eml_01/reply
Content-Type: application/json
Idempotency-Key: 29952737-5a3f-4a30-95e3-846e77155d7a
{"from":"claude@nate-bot","body_markdown":"Checked; the consumer now accepts it."}
```
```json
{"email_id":"eml_02","thread_id":"thr_01","to":["codex-worker1@boats"],"cc":[],"reply_to_email_id":"eml_01","references":["eml_01"],"sent_at":"2026-08-21T15:11:42.008Z"}
```

Errors use a stable shape such as `{"error":{"code":"invalid_address","message":"..."}}` with conventional `400`, `404`, `409`, or `500` status codes.

## CLI

`agent-inbox` derives the current address, talks only to the loopback API, emits JSON on stdout, and sends diagnostics to stderr with a nonzero exit code. Core commands are:

```text
agent-inbox send --to claude@nate-bot --subject "Sail API response shape" --body-file note.md
agent-inbox list --unread
agent-inbox read thr_01
agent-inbox reply eml_01 --body-file -
```

`send` accepts repeated `--to` and `--cc`. `read` prints the full thread, then marks it read only after successful output. `reply` is reply-all within the existing thread and preserves the server-generated reference chain. Auxiliary commands are `whoami`, `inboxes --project <slug>`, `setup`, `setup-project`, and `serve`; `setup` creates the data directory and installs/loads the LaunchAgent.

An MCP wrapper is deferred from v1 because the CLI and HTTP API work in every agent runtime without adding another integration or failure mode.

## Agent-usage plan

The implementation ships one canonical managed instruction block. `agent-inbox setup-project` appends it to `AGENTS.md` for Codex and `CLAUDE.md` for Claude when those files exist; projects used by both receive the identical block in both files. Orca launch profiles set `AGENT_INBOX_AGENT` to their unique worker name. The block is delimited so future installer runs replace only that block.

Paste this exact text into agent configuration files:

```markdown
<!-- agent-inboxes:start -->
## Agent Inboxes

Use the local `agent-inbox` CLI for durable coordination with agents in other sessions, worktrees, or projects. Your address is `<agent>@<project>`: the project is derived from Git, and the agent name comes from `AGENT_INBOX_AGENT` or your runtime family. Run `agent-inbox whoami` before using it. Concurrent agents of the same family in one project must be launched with unique names such as `AGENT_INBOX_AGENT=codex-worker1`.

Polling checkpoints:
- At session start, run `agent-inbox list --unread` and handle relevant mail before new work.
- Immediately before a task expected to take more than 10 minutes, check unread mail again.
- After finishing or handing off work, send any required completion reply, then check unread mail once more before ending the session.
- Do not background-poll or claim real-time delivery; these checkpoints are the contract.

Addressing:
- Use full lowercase addresses. Use `agent-inbox inboxes --project <slug>` when the recipient is not already named in the task; do not guess a person's address.
- Put action owners in `to` and observers in `cc`. Message only the smallest relevant set of agents.
- Use `send` for a new topic and `reply` for an existing one. Keep one topic per thread, preserve the subject, and reply to the newest relevant email.

Send mail for cross-session requests, blockers, handoffs, decisions that change another agent's work, shared interface changes, and completion notices another agent is waiting for. Do not send routine progress chatter, information already recorded in the repo/ticket, or notes only useful to your current session.

Agent Inboxes never reserves files or grants permission to edit them. Use the separate NB-7 file reservation system for write-lock coordination; a message about a file is not a lock.

Core commands:
`agent-inbox send --to <address> --subject "<topic>" --body-file <path-or->`
`agent-inbox list --unread`
`agent-inbox read <thread-id>`
`agent-inbox reply <email-id> --body-file <path-or->`
<!-- agent-inboxes:end -->
```

## Boundary with NB-7

Agent Inboxes communicates intent and outcomes; it does not arbitrate writes. No reservation columns, lock endpoints, ownership leases, conflict detection, or automatic messages from the reservation system belong in this scope. NB-7 may later send ordinary notification emails through this API, but its lock state remains authoritative and separate.

## Non-goals for v1

- No SMTP, IMAP, DNS, external delivery, or real email addresses.
- No authentication or authorization beyond binding to IPv4 localhost.
- No attachments, binary bodies, inline images, or MIME.
- No web UI; CLI and JSON API only.
- No push notifications, WebSockets, background polling, or delivery guarantees across machines.
- No file reservations or write-lock coordination; that is NB-7.

## Build plan for one `codex --yolo` session

1. Scaffold the dependency-free Python package and `agent-inbox` entry point; centralize path, port, address, ID, and timestamp rules.
2. Implement numbered SQLite migrations, the schema above, WAL/permissions setup, and transactional repository methods.
3. Implement identity derivation and inbox auto-provisioning, including Git remote/common-worktree tests.
4. Implement the loopback HTTP router, JSON validation/error envelope, idempotent send, reply-all threading, references, listing, detail, and read mutation.
5. Implement `send`, `list`, `read`, `reply`, `whoami`, and `inboxes`; keep stdout machine-readable and cover failure exit codes.
6. Implement `serve` plus `setup` with an idempotent macOS LaunchAgent plist targeting `127.0.0.1:8791` and the fixed database path.
7. Implement `setup-project` with managed-block insertion/replacement for `AGENTS.md` and `CLAUDE.md`, without changing unrelated content.
8. Add unit tests for schema constraints, identity normalization, recipient ordering, per-inbox unread state, reply/reference chains, and idempotency.
9. Add an end-to-end test using a temporary home and two repositories: send cross-project, restart the server, list/read, reply, and verify independent read state and persistence.
10. Run formatting, tests, a loopback-only binding check, and a manual two-terminal smoke test; document install, uninstall, backup, and troubleshooting commands.

Review convention: after Codex completes the build and green tests, a fresh Sonnet session reviews the diff and reports severity-ranked findings without editing; Codex resolves every blocking finding, then Fable runs the acceptance flow and is the sole final `GO`/`NO-GO` approver.

## Open questions for Nate

1. Can Orca reliably inject a unique `AGENT_INBOX_AGENT` into every launched worker? The v1 default assumes yes.
2. Confirm that v1 coordination is intentionally limited to agents on one Mac; the loopback-only default excludes Nate's other Macs.
3. Are there initial shared inbox names to pre-seed? The default is none; addresses are created on first use.
