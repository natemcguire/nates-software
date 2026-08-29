# Nate's Software — The Unbundled Suite Architecture

Every capability in the marketplace is an independent, old-school shareware product with its own binary (`.EXE`), CLI command, and standalone utility. Every product in the suite is itself a forkable repository listed on the marketplace.

---

## The 5 Standalone Suite Products

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                                    NATE'S SOFTWARE SUITE                                    │
├───────────────────┬───────────────────┬───────────────────┬───────────────────┬─────────────┤
│ 1. RUNTIME & DYNO │ 2. FORK & MODDING │ 3. HEAT LEADERBD  │ 4. GIT CAS ENGINE │ 5. COMMS    │
│    RIG.EXE        │    SLOPSHOP       │    HOTWIRE        │    GITSMITH       │  INBOX.EXE  │
├───────────────────┼───────────────────┼───────────────────┼───────────────────┼─────────────┤
│ • Ephemeral Linux │ • 1-click fork    │ • Daily 12:01 AM  │ • Bare Git over   │ • 3-Pane    │
│   WebContainers   │ • AI Agent hooks  │   drops board     │   SSH port 22     │   Outlook   │
│ • Optional volume │ • Modular feature │ • Upvotes &       │ • 41s Semantic AI │ • Async     │
│   declarations    │   cherry-picker   │   maker streaks   │   Merge Queue     │   Markdown  │
│ • OOM recovery &  │ • AST syntax      │ • Nate's Software  │ • Atomic CAS      │ • Action    │
│   instant boot    │   patch engine    │   spec benchmarks │   update-ref      │   Proposals │
└───────────────────┴───────────────────┴───────────────────┴───────────────────┴─────────────┘
```

---

### Product 1: The Dyno & Container Runtime
* **Product Name:** `RIG.EXE`
* **CLI Command:** `rig` (`rig boot <fork>`, `rig logs --crash`, `rig snapshot export`)
* **Vibe:** Turbo C++ / V8 Engine / Industrial shareware utility
* **Tagline:** *"Fire up your fork in 1.1 seconds."*
* **Standalone Utility:** A lightning-fast, zero-overhead WebContainer manager for micro-apps with SQLite file persistence. You can run `RIG` locally on your Mac mini or host it on bare metal.

---

### Product 2: The Fork & Modding Speed Shop
* **Product Name:** `SLOPSHOP` (or `SLOPSHOP.EXE`)
* **CLI Command:** `slop` or `slopshop` (`slop fork <user/app>`, `slop weld <pkg@v2>`, `slop mod --claude`)
* **Vibe:** AI speed shop / Chop shop / Norton Commander for LLM modders
* **Tagline:** *"Cut it up. Slop it together. Make it yours."*
* **Standalone Utility:** The AST-aware modification and feature-extraction engine that takes any web app, analyzes its components and database migrations, extracts modular feature packages, and deep-links repositories straight into Claude Desktop, Codex, or Cursor.

---

### Product 3: The Daily Drops & Popularity Heat Board
* **Product Name:** `HOTWIRE`
* **CLI Command:** `hotwire` (`hotwire drops --today`, `hotwire upvote <id>`, `hotwire streak`)
* **Vibe:** Product Hunt launch energy meets 1996 BBS top-warez board & Nate's Software benchmarks
* **Tagline:** *"Today's fastest, weirdest, most forked software."*
* **Standalone Utility:** The competitive discovery board that ranks software by actual forks, merge benchmark speed, uptime reliability, and maker shipping streaks.

---

### Product 4: The Bare Git & Merge Engine
* **Product Name:** `GITSMITH`
* **CLI Command:** `gitsmith` (`ssh git@gitsmith.dev`, `gitsmith cas-lock <ref>`, `gitsmith merge-queue live`)
* **Vibe:** High-precision blacksmithing / Industrial Unix CAS pipeline / Bare metal
* **Tagline:** *"The 41-second semantic Git merge engine."*
* **Standalone Utility:** The 41-second semantic Git merge engine. It provides bare Git repository hosting over SSH, runs sandboxed test matrices, signs commit trailers, and executes atomic compare-and-swap ref updates without lock starvation.

---

### Product 5: The Agent Comms & Mailbox
* **Product Name:** `INBOX.EXE`
* **CLI Command:** `inbox` (`inbox list --proposals`, `inbox dispatch --agent=claude`, `inbox reply <thr_id>`)
* **Vibe:** Win95 Microsoft Mail / Eudora / Pegasus Mail
* **Tagline:** *"Async communications for humans and coding agents."*
* **Standalone Utility:** An async communication client for humans and AI agents. It keeps conversational noise and task dispatching out of Git commit history while providing interactive 1-click merge approvals.

---

## Dogfooding Principle

Every one of these 5 products is packaged as a standalone repository on the marketplace:
1. Want to fork and mod apps with your local agent? `slop fork nate/slopshop`
2. Want your own private Git merge worker? `slop fork nate/gitsmith`
3. Want your own private Product Hunt leaderboard for your company? `slop fork nate/hotwire`
4. Want a lightweight SQLite container runner on your local network? `slop fork nate/rig`
5. Want an agent task mailbox for your team? `slop fork nate/inbox`
