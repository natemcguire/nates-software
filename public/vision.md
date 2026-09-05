# WELCOME TO NATE'S SOFTWARE EMPORIUM

You know how you rent everything now? Photoshop, your email, that habit tracker, the thing
that makes your invoices. You pay every month, forever, and the day you stop paying, it all
locks up — even the files you made with it. You never owned any of it. You were renting.

With AI, the makers and tinkerers don't have to live this way anymore. Nate's Software is a
place for people like us to share, meet, and sell our soft-wares, and a place for people to
buy things they want to own, like for real.

When you buy an app here, you don't get a login to someone's server. You get the running app,
the full source code in a git repo, and a real license. Cancel nothing, because there's nothing to cancel. It's yours the way a
hammer is yours. Yours, so you can fork it.

## Go Fork and Multiply

You have slop, I have slop, we're all out here pushing code faster than we have ever before.
Our software marketplace is an opportunity to sell your slop to someone else. One man's trash
is another man's treasure. Everything you see on hotwire can be **forked** — copied, opened up,
and changed. If you improve it, you can sell your version. You set one royalty rate when you
list. The day someone forks you, that rate freezes. You can never raise it on them later.

Here's the twist that makes the whole thing fair instead of parasitic: **when your fork sells,
the money splits back down the family tree.** The house takes a flat 10%. Everyone up the
chain gets their own frozen rate. The seller keeps the rest. Forks of forks pay the whole
line, each ancestor at the rate that froze the day they were forked.

So if you write something original and ten people fork it and those forks sell, **you earn a cut
of every one of those sales, forever.** Good ideas pay their authors. That's the vision in one
sentence: *make software something you own and something that pays the people it's built on.*

## Why it looks like Windows 95

Because we're going back to our roots. Fun in computing.

## The apps (a sitemap)

Here's the whole machine in one breath — start at the board and follow a fork until it sells. You **find** an app on HOTWIRE and buy it or fork it.
Forking copies it into your own repo on GITSMITH — a real git forge, actual git-over-SSH, not a
folder pretending to be one. You **change** it in SLOPSHOP by talking to an AI agent right in the
browser. When you're ready to see it live, the platform **builds** your code and **runs** it —
that's the engine that used to be a visible app called RIG, now folded quietly into the pipeline.
When you want your change pulled back upstream, you send a merge proposal to the maker's INBOX,
they read the actual diff, and they approve. When something sells, the money splits down the fork
tree automatically. Everything sits on the edge — Cloudflare for the front door, hosting, and the
database (D1/SQLite); the heavier building and always-on hosting spill over to AWS only where
Cloudflare can't reach. One wildcard domain gives every app its own address, so adding an app is
a database row, not a deploy. The point of all that plumbing is that none of it should be visible:
you fork, you talk to an agent, you sell — the forge, the build, and the runtime just happen.

- **HOTWIRE** — the daily drop board. Every day at 12:01 AM makers drop new apps and people
  vote. It's the front page / the "what's new today".
- **SLOPSHOP** — where you fork an app and change it with an AI agent, right in the browser.
  This is the "make it yours" workshop.
- **GITSMITH** — the git forge underneath it all. Real bare git repos over SSH. Most people
  never open it directly; it's the plumbing SLOPSHOP and the marketplace are built on. It also
  works as a standalone git host.
- **The engine** — not an app you open. It takes a fork and actually *runs* it in a sandboxed
  container so you can try it. It sleeps when idle so nothing costs money sitting still.
- **INBOX** — a 3-pane mailbox for merge proposals and discussion between humans and agents.
  When someone wants to merge a change back upstream, you review the actual diff here before you
  approve it. Approving means you read it.
- **DYNO** — a benchmark for how well AI models and agent setups do real developer tasks. It's
  its own product; it measures the tools, not the marketplace apps.
- **PROFILE / MY SHELF** — your maker page, your SSH keys, your earnings, and the shelf of every
  app you own with its license keys and downloads.
- **TERMINAL** — an in-browser DOS-style shell for poking at the system directly.

## The money is real (but test-mode for now)

The buy → own loop genuinely works end to end. You check out through real Stripe, and when the
payment clears the platform mints you a real cryptographic license key tied to your account, drops
the app onto your shelf with its downloads, and — in the same breath — writes down exactly how the
sale splits down the fork tree, to the penny. Nothing about those numbers is faked; the split is
computed and recorded on every purchase, and the payouts to each person up your lineage are queued
as real, durable work (the kind that retries until it lands, so nobody's cut gets lost).

The only thing that isn't live yet is the charge itself: Stripe is in **test mode**, so no real
card is billed while the last onboarding pieces get finished. Flipping to real money is a config
switch — the accounting, the licenses, and the lineage math are already the production versions.

---

*Made by Nate McGuire · [nates-software.com](https://nates-software.com)*
