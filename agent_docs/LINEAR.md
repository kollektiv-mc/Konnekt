# Konnekt — Linear setup

Referenced by `CLAUDE.md`. This is the decision record for how Konnekt's Linear
tracking is structured and kept in sync with `agent_docs/ROADMAP.md` and the
codebase. Keep it current when the structure changes — it's what
`/suite-kit:linear-sync` reconciles against.

> **Current state, 2026-08-04.** The workspace this file described,
> **KonnektMC**, was deleted and replaced by **Kollektiv-MC**, which is shared
> across the suite. That workspace holds one team today, `KOL`; Konnekt's own
> team, key `KON`, is declared in `.claude/suite.json` but **has not been
> created yet**. Declaring a key and provisioning a team are separate steps.
>
> Until the team exists, `/suite-kit:linear-sync` reports it as unprovisioned
> and stops rather than filing issues somewhere else. Every `KON-*` number
> below and in merged PRs refers to the deleted workspace and resolves to
> nothing — the new one renumbers from `KON-1`. Treat them as historical
> labels, not as links.
>
> The structure below is the intended shape to rebuild, not a description of
> what exists.

Conventions shared with the rest of the suite — PR magic words, the
`Source: <roadmap> § <section>` mapping rule, and the required permissions
block — live in kollektiv's `docs/conventions.md`. What stays here is Konnekt's
own project, milestone, and label structure.

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

**Layer 2 — scheduled reconcile.** `/suite-kit:linear-sync`, run manually or on a
2-week cadence aligned to the cycle boundary. It reads `agent_docs/ROADMAP.md`
and recent git history, creates issues for newly scoped `[ ]` items, moves
shipped ones to Done, and posts a project status update.

This repo previously carried its own copy of that prompt at
`.claude/commands/linear-sync.md`. It was **deleted**: it duplicated the plugin
skill and had gone stale against the deleted `KonnektMC` workspace, so running
it did nothing useful. One definition of the reconcile logic, in the plugin.

## Conventions held elsewhere

The `Source: <roadmap> § <section>` mapping rule and the PR magic-word
convention (`Fixes KON-12`, `Closes KON-9`, `Part of KON-28`) apply across the
whole suite, not just here. They live in kollektiv's `docs/conventions.md`.

They were previously written down here as though they were Konnekt's own, which
is how a shared rule drifts: the copy that gets updated is whichever one the
person happened to open.
