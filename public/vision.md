# Nate's Software — the whole thing, in plain words

You know how you rent everything now? Photoshop, your email, that habit tracker, the thing
that makes your invoices. You pay every month, forever, and the day you stop paying, it all
locks up — even the files you made with it. You never owned any of it. You were renting.

Nate's Software is the opposite bet: **you buy software once and you own it forever.**

When you buy an app here, you don't get a login to someone's server. You get the running app,
the full source code in a git repo, native installers (`.dmg`, `.exe`), and a real license key
with your name on it. Cancel nothing, because there's nothing to cancel. It's yours the way a
hammer is yours.

## The part that makes it interesting

Every app here can be **forked** — copied, opened up, and changed. You don't need to ask
permission and you don't need to be a hardcore programmer, because you change it by talking to
an AI agent ("add a dark mode", "make it export to PDF"). Fork someone's app, make it better or
different, and **sell your version.**

Here's the twist that makes the whole thing fair instead of parasitic: **when your fork sells,
the money splits back down the family tree.**

- **70%** goes to you, the seller.
- **20%** goes up the chain — to the people whose work you built on top of.
- **10%** keeps the lights on (the platform).

A brand-new app with no ancestors is **90% to the maker / 10% to the platform** — there's no
lineage to pay, so that 20% just comes back to you.

So if you write something original and ten people fork it and those forks sell, **you earn a cut
of every one of those sales, forever.** Good ideas pay their authors. That's the vision in one
sentence: *make software something you own and something that pays the people it's built on.*

## Why it looks like Windows 95

Because it's a joke that's also serious. The whole thing runs as a fake retro desktop —
draggable windows, a Start menu, that teal wallpaper. It's fun, it's honest about being a
*place you operate* rather than a landing page trying to convert you, and it makes a complicated
idea (a marketplace + a git forge + an app runtime) feel like a computer you already know how to
use. The share cards you post to Twitter are modern and slick — retro tool, sharp storefront.
That contrast is on purpose.

## The apps (a sitemap)

Each of these is a real, working piece of the system. They stand alone, but they connect.

- **HOTWIRE** — the daily drop board. Every day at 12:01 AM makers drop new apps and people
  vote. It's the front page / the "what's new today".
- **SLOPSHOP** — where you fork an app and change it with an AI agent, right in the browser.
  This is the "make it yours" workshop.
- **GITSMITH** — the git forge underneath it all. Real bare git repos over SSH. Most people
  never open it directly; it's the plumbing SLOPSHOP and the marketplace are built on. It also
  works as a standalone git host.
- **RIG.EXE** — the runtime. It takes a fork and actually *runs* it in a sandboxed container so
  you can try it. It sleeps when idle so nothing costs money sitting still.
- **INBOX** — a 3-pane mailbox for merge proposals and discussion between humans and agents.
  When someone wants to merge a change back upstream, you review the actual diff here before you
  approve it. Approving means you read it.
- **DYNO** — a benchmark for how well AI models and agent setups do real developer tasks. It's
  its own product; it measures the tools, not the marketplace apps.
- **PROFILE / MY SHELF** — your maker page, your SSH keys, your earnings, and the shelf of every
  app you own with its license keys and downloads.
- **TERMINAL** — an in-browser DOS-style shell for poking at the system directly.

## The money is real (but test-mode for now)

The buy → own loop genuinely works: real Stripe checkout, a real cryptographic license minted to
your account, the lineage split computed and recorded to the penny. It's currently in Stripe
**test mode** — no real cards are charged yet — while the last onboarding pieces get finished.
Nothing about the numbers is faked; the switch to live is a config flip, not a rewrite.

## Where it's going

The near-term goal is simple: get it good enough that a skeptical stranger can land on it, buy
something, fork it, change one thing with AI, sell their version, and watch the money split
correctly — without ever reading a manual. Longer term: seed a marketplace where the best ideas
compound, and the people who had them (and the people who improved them) both get paid.

That's it. Own your software. Fork anything. Get paid when what you built gets built on.

---

*Made by Nate McGuire · [nates-software.com](https://nates-software.com)*
