# Konnekt — Linear setup

Referenced by `CLAUDE.md`.

Konnekt's issues live in **GitHub Issues**, not directly in Linear.
`kollektiv-mc/kollektiv`'s `/suite-kit:suite-sync` mirrors them into Linear on
a schedule; the full cross-suite model — teams, projects, milestones, labels,
and the GitHub↔Linear match key — is documented once, in kollektiv's
`docs/linear.md`. This file only states what's specific to Konnekt.

## Where Konnekt shows up in Linear

- Team **Apps** (shared with Kommands — the workspace has two teams total)
- Project **Konnekt**, with milestones **Alpha** (complete), **Beta**,
  **Remote Access**
- GitHub labels `milestone:beta` / `milestone:remote-access` on this repo's
  issues drive which milestone a mirrored Linear issue lands in

## History

This file previously described a from-scratch Linear structure (two
initiatives, five projects, its own `KON-*` numbering) built for a workspace,
**KonnektMC**, that was deleted and replaced by the shared **Kollektiv-MC**
workspace. That structure was never built in the replacement workspace. This
repo's own `.claude/commands/linear-sync.md` — which hardcoded
`list_issues team=KonnektMC` — has been deleted; it duplicated the plugin
skill and would have failed outright against the current workspace.

Nothing here needs a `KON-*` team key: GitHub Issues, not Linear, is where
Konnekt's work is filed and tracked.
