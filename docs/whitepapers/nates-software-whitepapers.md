Completed five standalone architectural white papers totaling roughly 7,300 words:

- [RIG.EXE](/Volumes/MacMiniExtra/Projects/nate-bot/docs/whitepapers/rig-exe.md)
- [SLOPSHOP](/Volumes/MacMiniExtra/Projects/nate-bot/docs/whitepapers/slopshop.md)
- [GITSMITH](/Volumes/MacMiniExtra/Projects/nate-bot/docs/whitepapers/gitsmith.md)
- [INBOX.EXE](/Volumes/MacMiniExtra/Projects/nate-bot/docs/whitepapers/inbox-exe.md)
- [HOTWIRE](/Volumes/MacMiniExtra/Projects/nate-bot/docs/whitepapers/hotwire.md)

A [suite index and architectural boundary diagram](/Volumes/MacMiniExtra/Projects/nate-bot/docs/whitepapers/nates-software-whitepapers.md) connects them while establishing that every product remains independently deployable.

Each paper includes the requested sections, concrete invariants, ASCII data-flow diagrams, security boundaries, failure semantics, recovery behavior, and explicit limits on its guarantees. All headings, code fences, whitespace, and index targets were validated.
inbox-exe.md)
5. [HOTWIRE — The Daily Drops Leaderboard, Popularity Engine & Lineage Ledger](hotwire.md)

## Suite Boundary

```text
 discover/fund       discuss/approve        modify/test        merge/version       run/store
┌───────────┐       ┌───────────┐       ┌───────────┐       ┌───────────┐       ┌───────────┐
│  HOTWIRE  │<----->│ INBOX.EXE │<----->│ SLOPSHOP  │<----->│ GITSMITH  │<----->│  RIG.EXE  │
└───────────┘ events└───────────┘ links └───────────┘ Git   └───────────┘ image └───────────┘
     │                    │                     │                  │                   │
 lineage + ledger   comms + approvals     feature packages   repositories       app + .sqlite
```

Arrows denote optional integrations, not ownership. No component reads another
component's database. Cross-system messages carry stable identifiers,
cryptographic provenance where relevant, and idempotency keys. A failure in the
marketplace must not prevent an app from running; a failure in communications
must not corrupt Git; and a failed feature splice must not reach the runtime
unless it passes GITSMITH's publication boundary.
