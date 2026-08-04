# Konnekt — Linear setup

Referenced by `CLAUDE.md`. This is the decision record for how Konnekt's
Linear workspace (**Kollektiv-MC**, team key `KON`) is structured and kept in
sync with `agent_docs/ROADMAP.md` and the codebase. Keep it current when the
structure changes — it's the source of truth the `/linear-sync` reconcile
prompt reads against.

The general reconcile rules — the `Source: <roadmap> § <section>` issue↔roadmap
mapping convention and the PR magic-word convention — live once, in
`kollektiv`'s `suite-kit` plugin (`plugins/suite-kit/skills/linear-sync/SKILL.md`),
not here. This file covers only what's specific to Konnekt: its own initiative
and project structure, labels, cycle cadence, and how the two sync layers below
are wired for this repo.

## Structure

Two Linear initiatives, five projects:

- **Konnekt Alpha** (initiative, Completed)
  - **Alpha** (project, Completed) — history only. No per-item issues; instead
    four Done milestones mirror `ROADMAP.md`'s Alpha sections: Core
    infrastructure, Server management, Tiles — implemented, Tiles — remaining
    alpha.
- **Konnekt Beta** (initiative, Active)
  - **Backups — Beta Hardening** — `ROADMAP.md` § "Backups — beta hardening"
  - **Beta Tiles** — `ROADMAP.md` § "Tiles — beta" (File explorer, Audit log,
    Mod/plugin manager, Player profiles, Player skin preview, Server Config
    beta enhancements)
  - **Beta Features** — `ROADMAP.md` § "Features — beta" (playit.gg tunnel,
    extended performance history, keyboard shortcuts, Settings completion).
    Early-shipped items (auto-updater, theme toggle, OS notifications) are
    tracked here as Done issues for an accurate picture.
  - **Remote Access — Dashboard over Web** — `ROADMAP.md` § "Remote access —
    full dashboard over the web". Modeled with **milestones = Phase 0…5**;
    Phase 0 is Done, Phases 1–5 are one issue each.

> **Known API gap:** the connected Linear MCP has no `create_initiative` /
> `save_initiative` tool — only ways to *reference* an initiative that
> already exists (`save_project`'s `addInitiatives`). The two initiatives
> above must be created once by hand in the Linear UI (Workspace →
> Initiatives → New), then each project attached to its initiative via
> `save_project(addInitiatives: [...])`. Until that's done, the five projects
> exist but aren't grouped under an initiative in the UI.

## Labels

Reuses the team defaults (`Bug`, `Feature`, `Improvement`, `question`,
`Migrated`) plus two added for cross-cutting filtering:

- **`Beta`** — anything in Beta scope, regardless of project
- **`Remote Access`** — anything in the Phase 0–5 epic, regardless of project

## Cycles

Team cadence is **2-week Scrum-standard cycles**. Cycle creation is a
team-settings toggle not exposed via the Linear MCP — enable it once in
**Team Settings → Cycles → 2 weeks** (with a short cooldown). Once cycles
exist, near-term work (the data-loss bug KON-9, KON-5, Remote Access Phase 1)
should be pulled into the active cycle via `save_issue(cycle: ...)`.

## Keeping this in sync

**Layer 1 — native GitHub integration.** Already connected (KON-5 carries a
GitHub attachment linking `sandrogekeler/Konnekt#14`, confirming it's live).
Branch names Linear generates (`alessandrogekeler/kon-N-slug`) and PR magic
words (`Fixes KON-12`, `Closes KON-9`) move issues through the workflow
automatically on PR open/merge. This needs no maintenance beyond using the
magic words in PR descriptions.

**Layer 2 — scheduled reconcile.** A recurring routine runs the prompt in
`.claude/commands/linear-sync.md` on a 2-week cadence (aligned to the cycle
boundary). It:

1. Reads `agent_docs/ROADMAP.md` and recent git history for what's shipped or
   newly scoped.
2. Reconciles Linear: new `[ ]` roadmap items with no matching issue get
   created in the right project; items now `[x]` or closed by a merged PR get
   their Linear issue moved to Done.
3. Posts a project status update (shipped / in-progress / blocked / next) on
   each active Beta-side project.

Run it manually any time with `/linear-sync` — the scheduled job and manual
runs share this same prompt, so there's one source of truth for the
reconcile logic. That prompt, and the `Source:`/magic-word conventions it
depends on, are defined once in `suite-kit` — see the note at the top of this
file rather than a restatement here.
