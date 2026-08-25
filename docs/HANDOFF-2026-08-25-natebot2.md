# Handoff — session "NateBot2" (2026-08-25)

Two threads ran in this session. Nothing is committed to git yet — all changes are working-tree only.

## Thread 1: Fork marketplace ("FORKYARD", name TBD)

An AI-native app marketplace: Product Hunt discovery + GitHub-style forking, where every
app is a real git repo. Users fork, modify with AI, and pull feature packages from any
fork in the family (AI semantic merge). Self-hosted git engine with a merge queue built
for agent-speed merging — positioned as more reliable than GitHub.

**Decisions locked in brainstorming (design NOT yet written to a spec):**
- Fork = source + working app; platform rules differ (web = hosted instance, iOS = you ship your own build)
- Audience: non-technical first, git fully abstracted, plus XTREME MODE (raw git over SSH)
- Updates = feature packages: commit range + plain-English spec (`refs/features/<name>@vN`); clean cherry-pick, AI merge when diverged
- Economics: free / one-time / subscription; rev share down the fork ancestry chain; feature packages sellable; free apps carry an ad-slot scaffold
- Modification: local-first via git clone; hosted browser terminal (BYOM or subscription — economics still open)
- Architecture: own the git layer (bare repos + stateless front; merge queue is the heart; metadata DB rebuildable from repos)
- Brand: Win95 chrome × Tom's Hardware density × PH popularity mechanics; Millennials–older Gen Z; homebrew-adjacent maker-club lineage

**Artifacts:**
- `docs/wireframes/fork-marketplace-wireframes.html` — 37-screen Balsamiq-clone wireframe deck, 12 flows, clickable flow map (press M). Includes design-direction slide + naming A/B slide with Grok's 10 name candidates.
- `docs/brand/naming-brief.md` (+ `.html` render) — codex-researched naming brand brief, zero name suggestions, updated with homebrew-club lineage. Updated to explicitly allow "fork" when teaching consumer ownership/compounds (e.g. FORKYARD, Forklore) rather than developer plumbing.
- `docs/brand/project-context.md` — source context the brief was generated from.

**Open decisions:** name; positioning (editorial "Nate's Software" vs community "FORKYARD" vs hybrid — flow J wireframes assume hybrid).
**Next step per brainstorming skill:** get naming/positioning call → write design spec to `docs/superpowers/specs/` → commit → writing-plans skill → NB ticket per ways-of-working.

## Thread 2: East Bay Projects ideas deck overhaul

File: `docs/east-bay-projects-ideas.html` (pre-session backup: `.bak` — note the backup
predates ALL of today's changes including reorder). Now **102 slides**. All changes verified
(balanced HTML, 36 Grok takes, humanized copy spot-checked).

**Done this session:**
1. Reordered each bet: canvas → "Wait, what is this?" → evidence.
2. Lean canvas: 16.5px→31px body, 12.5px→20px labels, 10-col grid → 2-col.
3. Wait-what panels: full width, 58ch cap removed, type bumped.
4. Grok humanize pass over all idea copy (4 rounds — Grok echoes input unless echoing is defined as failure with n-gram validation; scripts in scratchpad: `grok_pass*.py`, `patch_grok2.py`, results `grok-final.json`). Every idea also got a gold "Grok's Take" cell (opinion + refine).
5. **Killed Rehearsal Receipt** (the band idea): slides removed, scoreboard row gone, bets renumbered (Heritage→Nº5, Restitch→Nº6), graveyard card added, closer's "toy" slot now Gridle.
6. **Heritage Dossier**: now ingests existing family inputs — mom's documents/photos, 23andMe raw DNA exports, Ancestry/GEDCOM trees (Solution, Unfair Advantage, wait-what all updated).
7. **Fintech section**: conflict framing removed everywhere; 12 new slides — company-by-company case studies in canvas+wait-what format: ProjectionLab, Lunch Money, Monarch, Rocket Money, Homebot, Actual Budget (all figures use the map's existing sourced links).
8. **New Bet Nº7 "Storyframe"**: AI-restyled photo art (watercolor/sketch travelogue) → framed → mailed. Research confirmed: the TV-commercial framer is **Keepsake Frames** (ispot.tv shows sustained national campaigns); Framebridge 1M+ pieces; AI watercolor-restyle prompts are a trending 2026 category. First move: baby-room set from own photos (~$0 validation). Canvas + wait-what + numbers slides added; scoreboard row 7; counts now "Seven bets".

**Deck follow-ups not done:** dedupe check on the two different ReagentWatch ideas (slides ~57/86 — same name, different ideas, both kept); Grok takes exist for ideas but not for the 6 new fintech case studies or Storyframe (intentional — case studies don't need takes; Storyframe could get one).

## Loose ends
- Nothing committed. Suggested: commit `docs/` changes (wireframes, brand, deck, this handoff) as one or two commits.
- Memory files updated this session: `foothold-portfolio.md` (deck changes), new `fork-marketplace.md`.
- Scratchpad scripts are session-local; `grok-final.json` holds all humanized copy if the deck needs re-patching.
