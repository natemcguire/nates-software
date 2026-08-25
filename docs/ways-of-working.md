# Ways of Working

The preferred process for taking any project from idea to production. Modeled on how Sail Scan is run.

## The rule

**Projects may start in nate-bot** (a plan doc, a prototype folder, a script) — that's fine and encouraged. But **before anything goes to production, it must be on a JIRA board** with this workflow. No silent ships.

"Production" means: deployed to a real URL, distributed on TestFlight/App Store, running as a launchd/cron automation, or anything other people depend on.

## The board

- Site: https://sailscan.atlassian.net (auth in `~/.config/keys/keys.env`: `JIRA_SITE`, `JIRA_EMAIL`, `JIRA_API_TOKEN`)
- **Every active local project has its own board** (one JIRA project per repo in `~/Projects`, created 2026-08-21 for all repos with git activity). **NB** (Nate Bot) is the hub/incubator board; **SAIL** (SailScan) is the only shared project (Alex + JRo as members); everything else is **Private, Nate only**.
- **Preferred board setup** — create any new board with `scripts/jira/create_board.py KEY "Name"` (add `--open` for non-private). It produces: team-managed kanban project, the 9-status workflow below, access level Private. Boards start empty; populate tickets when work is actually scoped.
- All projects are team-managed ("next-gen") with the same 9-status workflow:

| Status | Meaning |
|---|---|
| Icebox | Idea/plan exists, not committed to |
| Ready to Start | Committed, scoped, next up |
| In Progress | Being actively worked |
| Review Scope | Scope question came up mid-work — resolve before continuing |
| Ready for Review | Code done, needs review |
| Ready for QA | Reviewed, needs real-world verification |
| Accepted | Verified working |
| Ready for Release | Accepted and queued to ship |
| Released | In production |

All transitions are global (any → any).

## Ticket hygiene

- One ticket per shippable unit of work; write the description so it's understandable months later without this chat's context (link the plan doc in the repo if one exists).
- Descriptions are ADF, labels have no spaces (see `docs/jira-api.md`).
- Only *midway or planned* work goes on the board when seeding — don't backfill already-shipped things.
- Move the ticket as you work; the board should reflect reality (uncommitted-but-working code = In Progress, not Ready to Start).

## Lifecycle of a nate-bot incubator project

1. Idea → plan doc in nate-bot (and an **Icebox** ticket in NB).
2. Start building → move to **In Progress**; code can live in nate-bot.
3. Approaching production → graduate: own repo, own JIRA project if it's a real product (or stay in NB if it's personal infra), then Ready for Review → QA → Released.

## Agents sharing a working tree — file reservations

When more than one agent may touch the same repo at once (parallel codex/Claude sessions, Orca workers), use the checkout-lock tool in `file-reservations/` (`reserve.py`) so nobody overwrites live edits. Each agent MUST export a stable identity — `export AGENT_ID=<agent>@<project>` (e.g. `claude@nate-bot`) — because PPID-based defaults are unsafe in agent harnesses. Then: `reserve <path>` before editing a shared file, `reserve check <path>` before a Write/Edit (exit 3 = held by someone else, don't touch it), `reserve release <path>` when done. Locks auto-expire after 60 min. See `file-reservations/README.md`.

## Build convention for agent infra

Build with `codex --yolo`, review with **Sonnet** (not Fable), Fable approves and commits. Applied to NB-6/NB-7 and going forward for infra work.
