# Agent Inbox Rework — Design Spec

**Date:** 2026-09-02
**Status:** Design (implementation-ready)
**Author:** Product + Systems Design
**Scope:** Strip the in-app INBOX down to a single-purpose *observable agent-to-agent email/threading system*, and formalize the already-existing cloneable `agent-inboxes` server repo as the runnable half of that system.

---

## 0. TL;DR — the important discovery

**The thing Nate is asking for already exists and is already wired in.** We do not need to design a new server or a new data model from scratch. Two things are already true in the codebase today:

1. **The cloneable/runnable repo already exists**: `/Volumes/MacMiniExtra/Projects/agent-inboxes` (remote `https://github.com/natemcguire/agent-inboxes.git`). It is a zero-dependency Python 3.11 stdlib service that gives each agent an email address (`<agent-slug>@<project-slug>`), stores immutable emails in threads in SQLite (`~/.agent-inboxes/inbox.db`), serves an HTTP REST API on `127.0.0.1:8791`, ships a CLI (`agent-inbox send/reply/list/read/whoami`), and has a full `unittest` suite. Its README is the canonical contract (`/Volumes/MacMiniExtra/Projects/agent-inboxes/README.md`).

2. **The in-app observer already exists**: `src/components/LocalAgentMailbox.tsx` is a read-only 3-pane window (Inboxes / Threads / Thread detail) that probes `127.0.0.1:8791/healthz`, renders real threads, and shows an honest OFFLINE pane when the service is down. It is already mounted inside `InboxView.tsx` as the "Local Agent Mailbox" tab.

**Therefore this rework is overwhelmingly a DELETE, not a BUILD.** The job is:

- Make `LocalAgentMailbox` the *entire* INBOX view.
- Cut the two other tabs — **Cloud Proposals** and **Marketplace** — and the now-orphaned merge-proposal / PR-diff machinery from `InboxView.tsx`.
- Add the one capability the in-app view is missing to satisfy Nate's "we can observe … threaded discussions": a **cross-inbox thread feed** so a human can watch all agent conversations without first drilling into one agent's inbox (today you must pick an inbox before you see any threads).
- Point the desktop unread badge at the right source (or drop it).
- Tidy the repo README/quickstart so "clone and run" is one honest paragraph.

"Less is more": the net change is ~700 deleted lines in `InboxView.tsx`, a small feed endpoint in the Python repo, and a modest in-app rewrite. No new D1 tables. No new cloud API.

---

## 1. Product Summary

### What the Agent Inbox IS after the rework

An **observable agent-to-agent email system**. Agents (Claude Code, Codex, Orca, custom harnesses) running on the same machine each get an email address and send each other threaded "emails" via a tiny local server. A human opens the INBOX window on nates-software.com (or `inbox.nates-software.com`) and **watches** those conversations — reads threads, sees who mailed whom, follows reply chains. It is a window pane onto machine coordination, in the Win95 aesthetic.

Two halves, one contract:

| Half | What it is | Where it lives |
|---|---|---|
| **(a) The cloneable server** | `agent-inboxes` — clone it, run it, agents file mail to each other locally | `github.com/natemcguire/agent-inboxes` (Python 3.11 stdlib) |
| **(b) The in-app observer** | The INBOX window — read-only threaded-discussion viewer | `src/views/InboxView.tsx` → renders `LocalAgentMailbox` |

They share the HTTP REST contract in §4. The browser talks to the local service over loopback (`http://127.0.0.1:8791`) with CORS already configured for the web-suite origins.

### What is REMOVED

The current `InboxView.tsx` is a three-mode mailbox with a top tab strip (`modeToggle`, lines 312–351): **☁ Cloud Proposals** (default), **🖥 Local Agent Mailbox**, **🏪 Marketplace**. We remove everything except the local agent mailbox.

Exact cuts in `src/views/InboxView.tsx`:

| What to cut | Lines (current file) | Notes |
|---|---|---|
| `mailboxMode` state (`'cloud' \| 'local' \| 'marketplace'`) | 40 | Mode no longer exists; there is only the agent mailbox. |
| The `modeToggle` tab strip JSX (all three buttons) | 312–351 | Delete entirely. No tabs remain. |
| `MarketplacePane` mode branch | 365–371 | Delete. |
| `import { MarketplacePane }` | 12 | Delete import. |
| The entire **Cloud Proposals** 3-pane body (default `return`) | 373–1263 | This is the bulk — mailbox folders (All Inbound / Pull Requests / Agent Reports / Royalties / Maker Feedback), the GitHub-style PR reading pane, diff tabs (Conversation/Commits/Files), the merge/approve control box, reward-grant control, reply forms. All gone. |
| All PR/diff/proposal state + handlers | 41–61, 63–153, 167–296 | `threads`, `selectedThreadId`, `activeFolder`, `prActiveTab`, `diffData`, `handleReviewProposal`, `handleToggleRead`, `handleSendReply`, `fetchInbox`, `fetchProposalDiff`, etc. — all specific to the cloud merge inbox. |
| `import` of `inboxDomain` helpers | 3–9 | `filterThreadsByCategory`, `calculateFolderCounts`, `conversationForThread`, `formatProposalStatus`, `PRDiffData` are no longer used by the view. |
| `useAuth` usage for the cloud inbox | 10, 36 | The local mailbox is unauthenticated (loopback). `InboxView` no longer needs `useAuth`. |
| Most `lucide-react` icons | 13–33 | Keep only what `LocalAgentMailbox` needs (it imports its own). |

**Files to delete outright:**
- `src/components/MarketplacePane.tsx` — only referenced by `InboxView.tsx` (confirmed: `grep -rln MarketplacePane src/ tests/` → only `MarketplacePane.tsx` + `InboxView.tsx`).

**Files to KEEP:**
- `src/components/LocalAgentMailbox.tsx` — becomes the whole view (with the small additions in §6).
- `functions/api/inbox.ts`, `functions/api/comments.ts`, D1 `inbox_messages`, `src/lib/inboxDomain.ts`, `src/lib/gitsmith/*` — **do NOT delete.** These power the *cloud merge-proposals / PR-approval* flow, which is a **separate GITSMITH concern** that other surfaces still use (see §3 and §9). The rework removes the merge-proposal *tab from the INBOX window*; it does not remove GITSMITH's approval backend. (If a later decision retires cloud merge-proposal review entirely, that is a separate spec — out of scope here.)

---

## 2. Data Model

**No new D1 tables. No changes to D1 `inbox_messages`.** The observable agent-inbox data model lives entirely in the `agent-inboxes` repo's SQLite DB (`~/.agent-inboxes/inbox.db`), which already exists and already matches the requested shape. This section documents it as the canonical contract and reconciles it with the cloud table.

### 2.1 Canonical local schema (already implemented in `agent_inbox/db.py`)

The logical hierarchy is `Project → Inbox → Thread → Email` (README §3). Mapped to the requested model:

- **agents** ≙ `inboxes`. An "agent" is an inbox: a `(project, local_part)` pair with a globally unique address `<local_part>@<project>`, a `kind` of `human` or `agent`, a display name, and first/last-seen timestamps.
- **threads** ≙ `threads`. A conversation with a stable subject and ordered emails; participants are derived from the union of `from`/`to`/`cc` across the thread's emails.
- **messages** ≙ `emails`. Immutable records with `from`, ordered `to`/`cc`, subject, Markdown body, `sent_at`, `reply_to_email_id` (direct parent), and a `references` chain.

DDL to standardize in `agent_inbox/db.py` (SQLite; this is the local server's schema, **not** a D1 migration). It reflects what the service stores today, with the one requested addition of an explicit `kind` column on inboxes:

```sql
-- ~/.agent-inboxes/inbox.db   (PRAGMA journal_mode=WAL; foreign_keys=ON; busy_timeout=5000)

CREATE TABLE IF NOT EXISTS projects (
  slug        TEXT PRIMARY KEY,                       -- ^[a-z0-9][a-z0-9-]{0,62}$
  created_at  TEXT NOT NULL                           -- RFC3339 UTC, trailing 'Z'
);

CREATE TABLE IF NOT EXISTS inboxes (                  -- an "agent" (or a human observer)
  address       TEXT PRIMARY KEY,                     -- '<local_part>@<project>'
  project       TEXT NOT NULL REFERENCES projects(slug) ON DELETE CASCADE,
  local_part    TEXT NOT NULL,                        -- '^[a-z0-9][a-z0-9-]{0,62}$'
  display_name  TEXT,
  kind          TEXT NOT NULL DEFAULT 'agent'
                CHECK (kind IN ('agent','human')),    -- NEW: observers register as 'human'
  created_at    TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL,
  UNIQUE (project, local_part)
);

CREATE TABLE IF NOT EXISTS threads (
  thread_id      TEXT PRIMARY KEY,                    -- 'thr_' + hex
  project        TEXT NOT NULL REFERENCES projects(slug) ON DELETE CASCADE,
  subject        TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  last_email_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS emails (
  email_id           TEXT PRIMARY KEY,                -- 'eml_' + hex
  thread_id          TEXT NOT NULL REFERENCES threads(thread_id) ON DELETE CASCADE,
  from_address       TEXT NOT NULL REFERENCES inboxes(address),
  subject            TEXT NOT NULL,
  body_markdown      TEXT NOT NULL,
  sent_at            TEXT NOT NULL,                   -- RFC3339 UTC
  reply_to_email_id  TEXT REFERENCES emails(email_id),
  references_json    TEXT NOT NULL DEFAULT '[]'       -- ordered ancestor email_id chain
);

-- Ordered recipients (to/cc) with kind, so recipient order is stable and reproducible.
CREATE TABLE IF NOT EXISTS email_recipients (
  email_id   TEXT NOT NULL REFERENCES emails(email_id) ON DELETE CASCADE,
  address    TEXT NOT NULL REFERENCES inboxes(address),
  kind       TEXT NOT NULL CHECK (kind IN ('to','cc')),
  position   INTEGER NOT NULL,                        -- preserves ordering
  PRIMARY KEY (email_id, address, kind)
);

-- Per-recipient independent read state (README §3 axiom 6). Senders are never "unread".
CREATE TABLE IF NOT EXISTS email_reads (
  email_id   TEXT NOT NULL REFERENCES emails(email_id) ON DELETE CASCADE,
  address    TEXT NOT NULL REFERENCES inboxes(address) ON DELETE CASCADE,
  read_at    TEXT,                                    -- NULL = unread for that inbox
  PRIMARY KEY (email_id, address)
);

-- Idempotency ledger: (Idempotency-Key) -> the email it produced (README §1 axiom 7).
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key        TEXT PRIMARY KEY,
  email_id   TEXT NOT NULL REFERENCES emails(email_id),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_threads_project_last  ON threads(project, last_email_at DESC);
CREATE INDEX IF NOT EXISTS idx_emails_thread_sent    ON emails(thread_id, sent_at);
CREATE INDEX IF NOT EXISTS idx_recipients_address    ON email_recipients(address);
CREATE INDEX IF NOT EXISTS idx_reads_address         ON email_reads(address, read_at);
```

> **The only *new* thing vs. what the repo ships today** is the `kind` column on `inboxes` (so a human observer that registers itself shows up as `human`, and the UI can tint it). If `agent_inbox/db.py` already carries the other columns under slightly different names, keep the existing names and only add `kind` (default `'agent'`). Do not churn the schema for cosmetics.

### 2.2 Requested field mapping (for the record)

The task asked for these fields; here is where each lives:

| Requested | Lives as |
|---|---|
| `agents(id, handle, email address, kind human\|agent)` | `inboxes(address PK, local_part = handle, address = email, kind)` — `address` is both id and email. |
| `threads(id, subject, participants)` | `threads(thread_id, subject, …)`; **participants derived** = distinct union of `from_address` + `email_recipients.address` over the thread (see `GET …/threads` response). |
| `messages(id, thread_id, from_agent, to_agents, body, created_at, in_reply_to)` | `emails(email_id, thread_id, from_address, {email_recipients where kind='to'}, body_markdown, sent_at, reply_to_email_id)`; `cc` also captured. |

### 2.3 Reconciliation with existing D1 `inbox_messages` — EXTEND or REPLACE?

**Neither. They stay separate and untouched.** This is a deliberate, already-documented architectural separation (README §6; `LocalAgentMailbox.tsx` header comment lines 20–35):

- **D1 `inbox_messages`** (migrations `0001` line 93, extended by `0016`) is the **cloud merge-proposals / maker-feedback** store — bound to `merge_attempts`, `merge_jobs`, `contributor_shares`, evidence bundles. It is authenticated per-user and lives at the edge. **It has nothing to do with agent-to-agent local mail.**
- **`~/.agent-inboxes/inbox.db`** is the **local agent mail** store.

Trying to fold agent mail into `inbox_messages` would drag in the whole GITSMITH/D1/auth stack for what is meant to be a dead-simple loopback service — the exact over-engineering this rework removes. **Keep them separate.** The INBOX *window* simply stops showing the D1 side.

---

## 3. The Split — in-app view vs. cloneable repo

```
┌──────────────────────────────────────────────────────────────────────┐
│  agent-inboxes  (github.com/natemcguire/agent-inboxes)  — RUNS LOCALLY │
│  • Python 3.11 stdlib, zero deps                                       │
│  • bin/agent-inbox CLI  (send / reply / list / read / whoami)          │
│  • http.server on 127.0.0.1:8791  → REST API (§4)                      │
│  • SQLite ~/.agent-inboxes/inbox.db  (§2.1)                            │
│  • CORS allow-list for web-suite origins                               │
└───────────────────────────────▲──────────────────────────────────────┘
                                 │  loopback fetch() (browser → 127.0.0.1)
                                 │  shared REST contract (§4)
┌───────────────────────────────┴──────────────────────────────────────┐
│  nates-software.com  INBOX window  — OBSERVES                          │
│  • src/views/InboxView.tsx  → thin wrapper                             │
│  • src/components/LocalAgentMailbox.tsx  → the whole UI                │
│  • probes /healthz; honest OFFLINE pane when down; NO mock data ever   │
│  • read-only: read threads, follow reply chains, watch the feed        │
└───────────────────────────────────────────────────────────────────────┘
```

- **The repo owns writes and truth.** Agents `POST` mail; the server is the single writer of `~/.agent-inboxes/inbox.db`.
- **The in-app view owns observation.** It only ever `GET`s (plus best-effort mark-read `POST`). If the service is down, it says so honestly and shows nothing.
- **They share exactly the §4 contract** and nothing else. The cloud D1 inbox (`/api/inbox`) is not part of this system and the INBOX window no longer calls it.

---

## 4. API Contract (shared by BOTH halves)

Base URL: `http://127.0.0.1:8791`. `Content-Type: application/json; charset=utf-8`. This is the existing contract from `agent-inboxes/README.md §5`, restated as the spec of record, plus **one new read-only feed endpoint** (§4.7) required for cross-inbox observation.

### 4.1 `GET /healthz` — liveness
**200** → `{ "status": "ok", "db": "ok", "version": "1.0.0" }`. Anything else / connection refused ⇒ the UI treats the service as offline.

### 4.2 `PUT /v1/inboxes/{address}` — register/touch an agent (idempotent)
Body: `{ "display_name"?: string, "kind"?: "agent"|"human" }` (`kind` NEW; default `agent`).
**200** → `{ address, created, kind, created_at, last_seen_at }`.

### 4.3 `GET /v1/inboxes?project={slug}` — discover agents
**200** → `{ "inboxes": [ { address, project, local_part, display_name, kind, created_at, last_seen_at } ] }`. Omit `project` to list all (add `?project=` support; all-inboxes already exists via `/v1/inboxes`).

### 4.4 `POST /v1/emails` — file a new email (start a thread)
Header **required**: `Idempotency-Key: <uuid>`.
Body:
```json
{ "from": "codex-worker1@boats", "to": ["claude@nate-bot"], "cc": ["observer@nate-bot"],
  "subject": "Sail API response shape", "body_markdown": "I added `draft_id`. Check the consumer?" }
```
**200** → `{ "email_id": "eml_…", "thread_id": "thr_…", "sent_at": "…Z" }`. Retrying the same key returns the original record without duplicating.

### 4.5 `GET /v1/inboxes/{address}/threads?unread={bool}&limit={N}` — one agent's threads
**200** → `{ "threads": [ { thread_id, subject, participants[], last_email_at, unread_count } ] }`, newest-active first.

### 4.6 `GET /v1/inboxes/{address}/threads/{thread_id}` — read a thread (no state change)
**200** → `{ thread_id, subject, emails: [ { email_id, from, to[], cc[], subject, body_markdown, sent_at, reply_to_email_id, references[], read } ] }`.

### 4.7 `GET /v1/threads?project={slug}&limit={N}` — **NEW: cross-inbox observer feed**
The one addition. Lets the human watch *all* conversations without first picking an agent. Read-only, unauthenticated (loopback).
**200** →
```json
{ "threads": [
  { "thread_id": "thr_…", "project": "boats", "subject": "Sail API response shape",
    "participants": ["codex-worker1@boats","claude@nate-bot"],
    "last_email_at": "…Z", "email_count": 3, "last_from": "claude@nate-bot" }
] }
```
Ordered by `last_email_at DESC`. `project` optional (omit ⇒ every project). This is a trivial query over `threads` + derived participants; ~30 lines in `service.py`/`server.py`.

### 4.8 `POST /v1/inboxes/{address}/threads/{thread_id}/read` — mark read (per-inbox)
**200** → `{ thread_id, marked_read: <n> }`. Used best-effort by the observer when a human opens a thread as a registered `human` inbox (see §6/§7). Optional — the observer works read-only without it.

### 4.9 `POST /v1/emails/{email_id}/reply` — reply in thread (agents; CLI)
Header **required**: `Idempotency-Key`. Body `{ from, body_markdown, to?, cc? }`. Defaults to reply-all excluding sender. **200** → the new email envelope with `reply_to_email_id` + accumulated `references`. (Used by agents/CLI; the in-app observer does not expose compose — see §6.)

### 4.10 Error envelope
`{ "error": { "code": string, "message": string } }`. Codes per README §5: `invalid_address`, `duplicate_recipient`, `missing_subject`, `missing_idempotency_key`, `invalid_json` (400); `thread_not_found`, `email_not_found`, `not_found` (404); `conflict` (409); `internal_error` (500).

---

## 5. Each Agent Gets an Email Address

### 5.1 Addressing scheme
`<agent-slug>@<project-slug>` — e.g. `codex-worker1@boats`, `claude@nate-bot`, `observer@nate-bot`.

- **project-slug**: `^[a-z0-9][a-z0-9-]{0,62}$`. Derived (README §3) from `AGENT_INBOX_PROJECT`, else the git `remote.origin.url` basename, else the git toplevel dir name, else the cwd name.
- **agent-slug**: `^[a-z0-9][a-z0-9-]{0,62}$`. Derived from `AGENT_INBOX_AGENT`, else runtime family (`claude` if `CLAUDE_PROJECT_DIR`/`CLAUDE_CODE_ENTRYPOINT`; `codex` if `CODEX_SANDBOX`/`CODEX_THREAD_ID`; `orca` if `ORCA_TASK_ID`/`ORCA_WORKER_ID`), else `agent`.
- Addresses are **project-local**, not internet email. There is no SMTP, no external delivery. The `@` is a familiar mental model, not a mail transport. Auto-provisioned on first `whoami`/send.

> **Why not `<handle>@agents.nates-software.com`?** The task floated that scheme. Reject it: it implies a *global cloud* namespace and internet mail, which contradicts the local-first, loopback-only design and would require a central registry + auth. `<slug>@<project>` keeps every agent scoped to the project it's working in, which is exactly the coordination unit (agents on `boats` talk to other agents on `boats`). Keep the existing scheme.

### 5.2 How a filed email maps to a thread — **in_reply_to threading (chosen), not subject threading**

**Decision: thread membership is by explicit `reply_to_email_id` / thread id, NOT by subject string.**

- `POST /v1/emails` **always creates a new thread** (new `thread_id`), even if the subject matches an existing one.
- `POST /v1/emails/{email_id}/reply` **joins the thread of the email being replied to**, sets `reply_to_email_id` to that email, and accumulates the `references` chain.

**Justification:**
1. **Deterministic & collision-free.** Subject-based threading (the "email" heuristic) silently merges unrelated conversations that happen to share a subject, and splits one conversation when someone edits the subject. Agents reuse terse subjects ("update", "status", "done") constantly — subject threading would be a mess. Explicit reply pointers are unambiguous.
2. **It's already what the repo does** (README §5 shows `reply_to_email_id` + `references`), and it's what `LocalAgentMailbox`'s `LocalEmail` type already carries (`reply_to_email_id`, `references`). Choosing subject threading would mean *rewriting* working code. Less is more.
3. **Observation is cleaner.** The reply chain (`references[]`) renders as a literal indent tree in the detail pane — the human sees exactly who replied to what.

The `subject` is retained for human readability and set stably at thread creation; replies inherit it (with an optional `Re:` prefix for display only). It is metadata, never the threading key.

---

## 6. In-App View — `InboxView.tsx` becomes single-purpose

### 6.1 Target shape
`InboxView.tsx` collapses to a thin wrapper that renders the (kept, lightly-extended) `LocalAgentMailbox`. No tabs, no mode toggle, no cloud/marketplace branches. Approximate end state:

```tsx
// src/views/InboxView.tsx  (post-rework, ~15 lines)
import React from 'react';
import { LocalAgentMailbox } from '../components/LocalAgentMailbox';

export const InboxView: React.FC = () => (
  <div className="h-full overflow-hidden font-tahoma text-xs">
    <LocalAgentMailbox />
  </div>
);
```

`LocalAgentMailbox`'s `modeToggle` prop (currently rendered at the top of its left rail, line 587) is **removed** — there are no other modes to switch to. Delete the prop from the interface (lines 444–447) and the `{modeToggle}` render (line 587).

### 6.2 Panes — keep the Win95 3-pane, add the observer feed
Keep the existing `RunningPane` 3-pane layout (`grid grid-cols-12`, lines 247–437). It already IS the requested threads-list / thread-view / message-detail observer and it already keeps the Win95 aesthetic (`border-2 border-gray-800`, `bg-w95-blue`, `font-tahoma`, w95 badges). Two focused changes:

1. **Pane 1 gains a top "🌐 All Agent Threads" entry** above the inbox list. Selecting it calls the new `GET /v1/threads` feed (§4.7) and renders every project's threads in pane 2 — this is the "we can observe" affordance (watch all agent chatter without drilling into one agent first). Selecting a specific inbox behaves as today (`GET …/{address}/threads`). New state: `feedMode: 'all' | 'inbox'`. Add `fetchAllThreads()` alongside the existing `fetchLocalThreads(address)`.
2. **Pane 3 renders the reply tree.** Today it lists emails flat (lines 407–430). Indent each email under its `reply_to_email_id` parent using the `references[]` depth, so the human sees the discussion structure. Purely presentational; data already present in `LocalEmail`.

### 6.3 Read-only stance — keep it
The in-app observer **does not compose or reply**. It already says so (line 431–433: "Compose & reply are available via the CLI"). Keep that. Writing mail is an *agent* action (they have the addresses and the CLI/API); a human "sending as an agent" from the browser muddies who-said-what in an observation tool. If a human wants to inject a message, they register a `human` inbox and use the CLI — honest and simple. **Do not add a compose box to the browser in v1.**

### 6.4 Code to KEEP vs CUT (component-level)

| Keep (in `LocalAgentMailbox.tsx`) | Cut (from `InboxView.tsx`) |
|---|---|
| `checkLocalAgentInboxHealth`, `fetchLocalInboxes`, `fetchLocalThreads`, `fetchLocalThreadDetail`, `markLocalThreadRead` | Entire cloud `fetchInbox`, `fetchProposalDiff`, `handleReviewProposal`, `handleSendReply`, `handleToggleRead` |
| `OfflinePane`, `RunningPane`, `LocalAgentMailbox` container | `modeToggle` strip; `mailboxMode`; PR reading pane; diff tabs; merge control box; reward-grant UI; folder rail |
| All `LocalInbox`/`LocalThread*`/`LocalEmail` types | `InboxThread`/`PRDiffData` imports from `inboxDomain` |
| The connection status strip (probe/reconnect) | `getStatusBadge`, GITSMITH CAS footer, unread badge from `/api/inbox` |

**Add** to `LocalAgentMailbox.tsx`: `fetchAllThreads()` (calls §4.7), `feedMode` state, the "All Agent Threads" pane-1 entry, and reply-tree indentation in pane 3.

### 6.5 Desktop wiring (`src/App.tsx`)
- Route/title already say "AGENT INBOX" (App.tsx lines 59–60) and Start-menu label "Agent Inbox" (line 640) — keep.
- **Unread badge (App.tsx lines 160–187, 643):** it currently polls `/api/inbox?action=unread-count` (the D1 cloud inbox). After the rework the INBOX window shows *local agent* mail, so a cloud-inbox badge is misleading. **Decision: drop the desktop unread badge for INBOX in v1.** Remove the `inboxUnreadCount` state + poller (160–187) and the `badge:` line (643). Rationale: the local service is loopback and often offline; a persistent cross-origin poll from the desktop shell to `127.0.0.1:8791` just to compute a badge is noise. The window's own status strip already shows CONNECTED/OFFLINE. (If a badge is later wanted, it can call the local `/v1/threads?unread` — a separate, optional follow-up.)

---

## 7. The Cloneable Repo (`agent-inboxes`)

**It already exists and is feature-complete.** This section defines the *tidy* needed so "clone and run" is one honest step, plus the one new endpoint.

### 7.1 Repo layout (current — keep)
```
agent-inboxes/
├── README.md                 # canonical contract (keep; trim quickstart per §7.3)
├── pyproject.toml            # metadata only; zero runtime deps
├── bin/agent-inbox           # CLI entrypoint (executable)
├── scripts/install.sh        # symlink + LaunchAgent registration
├── agent_inbox/
│   ├── __init__.py
│   ├── config.py             # host/port/db path + env overrides
│   ├── models.py             # address/slug validation, id + RFC3339 formatting
│   ├── identity.py           # project/agent slug derivation (whoami)
│   ├── db.py                 # SQLite schema (§2.1) + pragmas + file modes
│   ├── service.py            # transactional business logic (the single writer)
│   ├── server.py             # http.server router → REST (§4) + CORS
│   ├── client.py             # thin HTTP client used by the CLI
│   ├── cli.py                # send/reply/list/read/whoami/inboxes/setup(-project)/serve
│   ├── launchagent.py        # macOS LaunchAgent plist
│   └── project_setup.py      # injects agent-inboxes block into AGENTS.md/CLAUDE.md
└── tests/                    # stdlib unittest: models/identity/db/service/server/cli/e2e
```

### 7.2 The two changes to the repo
1. **Add `GET /v1/threads` (§4.7)** — the cross-inbox observer feed. New service method (`list_all_threads(project=None, limit=…)`) + a route in `server.py` + a `test_service`/`test_server_api` case. ~40 lines total.
2. **Add `kind` to `inboxes`** (§2.1) — default `'agent'`; `PUT /v1/inboxes/{address}` accepts optional `kind`; include `kind` in inbox responses. Migrate existing DBs with `ALTER TABLE inboxes ADD COLUMN kind TEXT NOT NULL DEFAULT 'agent'` guarded by a `PRAGMA table_info` check in `db.py`.

### 7.3 "Clone and run" — the honest one-paragraph quickstart (README top)
```bash
git clone https://github.com/natemcguire/agent-inboxes && cd agent-inboxes
python3 -m unittest discover -s tests -p 'test_*.py'   # optional: prove it works
./bin/agent-inbox serve --verbose                       # starts on 127.0.0.1:8791
# In another shell / another agent:
./bin/agent-inbox whoami                                 # your address, e.g. claude@agent-inboxes
./bin/agent-inbox send --to codex@agent-inboxes --subject "hi" --body "first mail"
```
Then open the INBOX window on nates-software.com (or `inbox.nates-software.com`) — it auto-detects the running service and shows the threads live. No config, no accounts, no cloud. Requires Python 3.11+ (enforced at launch — see commit `4efa323`).

### 7.4 What NOT to add
No auth server, no multi-machine sync, no web-hosted variant, no database other than the local SQLite. Those would break the local-first axioms and are explicitly out of scope. The repo stays a single-machine, zero-dependency, loopback service.

---

## 8. How Agents Actually File Emails (write path + auth)

### 8.1 Write path
An agent files mail by hitting the local API (directly or via the CLI, which wraps it):

```
Agent (Claude Code / Codex / Orca / harness)
  └─ agent-inbox send --to claude@nate-bot --subject "…" --body "…"
        └─ CLI derives `from` via identity rules (§5.1), generates Idempotency-Key
              └─ POST http://127.0.0.1:8791/v1/emails   (Idempotency-Key: <uuid>)
                    └─ server.py → service.py: validate addresses, auto-provision
                       project+inboxes, create thread + email + recipients + reads,
                       record idempotency key, bump thread.last_email_at  (one TX)
```
Replies: `agent-inbox reply <email_id> --body "…"` → `POST /v1/emails/{id}/reply`, joins the thread (§5.2), reply-all-minus-sender by default.

Agents can also POST directly (no CLI) — the contract in §4 is all they need. The `AGENTS.md`/`CLAUDE.md` block injected by `agent-inbox setup-project` tells an agent its address and the send/reply commands, so agents discover the mailbox automatically.

### 8.2 Auth model — **open on loopback, honestly**
- **No tokens. No per-agent secret. Authentication is the loopback boundary itself.** The service binds `127.0.0.1:8791` only, and *refuses to start* if `--host`/`AGENT_INBOX_HOST` is anything but `127.0.0.1`/`localhost` (README §1 axiom 2). Anything that can reach the port is already on the machine, i.e. already trusted at the OS level. Adding per-agent tokens would be security theater for a single-user local service and would break the "agents just send" simplicity.
- **File-level hardening instead of app auth:** DB is `0600`, the service-owned data dir is `0700` (README §1 axiom 4). Only the server process opens the DB; agents go through HTTP.
- **The browser is not privileged.** CORS is allow-listed to the web-suite origins so the *observer* can `fetch()`, but the service reflects no arbitrary origin and exposes no write path the observer uses. A hostile page on another origin gets no CORS header.
- **Honesty rule (enforced in UI):** if the service is unreachable, the app shows the OFFLINE pane and **no data** — never mock/cached (README §6.2; `OfflinePane`, and the `local-agent-mailbox.test.tsx` assertions that lock this behavior).

This is simple and honest: a local, single-user, loopback-only coordination bus with OS-level trust and no fake security layer.

---

## 9. Migration / Rollout Checklist (ordered)

1. **Repo `agent-inboxes`:** add `kind` column migration in `db.py` (§7.2) + accept/return `kind` in `PUT`/`GET` inbox endpoints. Add unittest coverage. Run `python3 -m unittest discover -s tests -p 'test_*.py'` → green.
2. **Repo `agent-inboxes`:** add `GET /v1/threads` feed (§4.7) in `service.py` + `server.py`; add `test_service`/`test_server_api` cases. Tests green. Commit + push to `github.com/natemcguire/agent-inboxes`. Update README quickstart (§7.3).
3. **In-app — extend `LocalAgentMailbox.tsx`:** add `fetchAllThreads()`, `feedMode` state, the "🌐 All Agent Threads" pane-1 entry, reply-tree indentation in pane 3. Remove the `modeToggle` prop (interface + render).
4. **In-app — gut `InboxView.tsx`:** delete the mode toggle, cloud PR pane, marketplace branch, and all proposal/diff state+handlers (lines per §1). Reduce to the ~15-line wrapper (§6.1).
5. **In-app — delete `src/components/MarketplacePane.tsx`** (orphaned after step 4).
6. **In-app — `src/App.tsx`:** remove the `inboxUnreadCount` state + `/api/inbox?action=unread-count` poller (lines 160–187) and the Start-menu `badge:` (line 643). Leave the route/title/label as "AGENT INBOX" / "Agent Inbox".
7. **Do NOT touch** `functions/api/inbox.ts`, `functions/api/comments.ts`, D1 `inbox_messages`, `src/lib/inboxDomain.ts`, `src/lib/gitsmith/*` — the cloud merge-proposal backend stays (§1, §10). Only its *presence in the INBOX window* is removed.
8. **Update tests** per §10 (rewrite the two INBOX-render assertions; keep the local-mailbox suite; keep the backend inbox suites).
9. **Verify:** `npm test` green, `npm run build` green (type-check catches dangling imports of `inboxDomain`/`MarketplacePane`/`PRDiffData`). Manually: start `agent-inbox serve`, `agent-inbox send` a couple of mails, open the INBOX window, confirm the offline pane when the service is stopped and live threads (+ the All-Threads feed) when it's running.

---

## 10. Test Impact

`grep -rln inbox tests/` surfaces these; classify each:

| Test file | Touches INBOX how | Action |
|---|---|---|
| `tests/inbox.test.ts` | Imports `InboxView` (line 8) + `inboxDomain` helpers; also exercises `functions/api/inbox` backend. Line ~551-style render asserts `INBOX.EXE` / folder labels. | **Split concern.** Keep all `functions/api/inbox` backend cases (cloud merge inbox is unchanged). **Remove/rewrite** any assertion that renders `InboxView` expecting cloud strings (`INBOX.EXE`, `Pull Requests`, `All Inbound`, `GITSMITH CAS`) — those UI elements are gone. `inboxDomain` unit tests (`filterThreadsByCategory` etc.) can stay as pure-function tests of a still-existing lib, or move to a `gitsmith`-scoped test; they no longer describe the INBOX *view*. |
| `tests/inbox-pr-flow.test.ts` | Backend PR/CAS flow **plus** a `renderToString(InboxView)` UI assertion at **lines 549–555** expecting `INBOX.EXE`, `Pull Requests`, `All Inbound`, `GITSMITH CAS`. | Keep the backend/CAS half. **Delete or relocate** the `describe('3. UI Rendering & Win95 PR Layout')` block (549–556) — it asserts the removed cloud UI. The PR-review UI it tested no longer lives in `InboxView`. |
| `tests/inbox-approval-integrity.test.ts` | Backend approval integrity (D1 `merge_approvals`, evidence gates). No `InboxView` import. | **Keep unchanged** — pure backend, unaffected by the UI rework. |
| `tests/local-agent-mailbox.test.tsx` | Tests `LocalAgentMailbox` (`checkLocalAgentInboxHealth`, `OfflinePane`, `RunningPane`). | **Keep, extend.** This is now the primary INBOX UI test. Add cases for the new `fetchAllThreads`/All-Threads feed and reply-tree rendering. |
| `tests/marketplace-phase3a-grant-recording.test.ts` | Grant *recording* backend; imports include marketplace grant flow (4 refs). Does it import `MarketplacePane`? It references marketplace grant **API**, not necessarily the component. | **Verify import target.** If it imports the React `MarketplacePane` component (being deleted), rewrite to test the marketplace grant **API/domain** directly. If it only tests `/api/marketplace/*` endpoints, **keep unchanged** (those endpoints are out of scope for this rework). |
| `agent-inboxes/tests/*` (Python) | The repo's own unittest suite. | **Extend** for the new `kind` column and `GET /v1/threads` (§9 steps 1–2). |

**Net:** the only *broken* assertions are the two `renderToString(InboxView)` blocks that expect the cloud PR/folder UI (`tests/inbox.test.ts` render assert, `tests/inbox-pr-flow.test.ts` lines 549–556). Everything else is either backend (unchanged) or the local-mailbox suite (kept + extended). Delete `MarketplacePane.tsx`'s only UI test coupling if present, else nothing there breaks.

---

## 11. Open Questions / Non-Goals

- **Non-goal:** removing the cloud merge-proposals backend. This spec removes it from the *INBOX window* only. Whether GITSMITH's PR-approval UI resurfaces elsewhere (e.g. inside the GITSMITH view) is a separate decision.
- **Non-goal:** browser-based compose/reply. v1 observer is read-only by design (§6.3).
- **Non-goal:** `@agents.nates-software.com` global addressing or any cloud-hosted inbox. Rejected in §5.1 in favor of local `<slug>@<project>`.
- **Open:** whether to keep a desktop unread badge at all. §6.5 drops it; a later optional follow-up could compute it from the local `/v1/threads?unread` feed.
```
