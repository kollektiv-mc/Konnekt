See @agent_docs/CLAUDE.md for architecture, conventions and build/test commands.
`agent_docs/DEPENDENCIES.md` is an inventory, not a rule: read it before adding a
dependency, which `.claude/rules/dependencies.md` prompts you to do.

## graphify

An optional AST knowledge graph. Reach for it only when a question is about where
something lives or what touches it across more of the tree than you want to grep;
reading a file you already know you need is not a graphify question.

The package is `graphifyy` (the command is `graphify`), and `graphify-out/` is
gitignored, so a fresh clone has the tool only where the cloud environment's setup
script put it (`kollektiv/scripts/cloud-setup.sh`), and never the graph. Build it
on demand with `graphify update .`, AST only, no API key, and re-run that after
changing code. Then `graphify query "<q>"`, `path "<A>" "<B>"`, `explain "<c>"`.

It is precise about structure and shallow about behaviour, so read the source it
points at rather than quoting it as a conclusion. `agent_docs/CONVENTION_AUDIT.md`
records how it actually performed against this repo.
