See @agent_docs/CLAUDE.md for architecture, conventions and build/test commands.
`agent_docs/DEPENDENCIES.md` is an inventory, not a rule: read it before adding a
dependency, which `.claude/rules/dependencies.md` prompts you to do.

## graphify

An AST knowledge graph of this repo lives in `graphify-out/` (gitignored,
regenerable with `graphify update .`, installed with `pipx install graphify`).

- Answer codebase questions with `graphify query "<question>"` first, when
  `graphify-out/graph.json` exists; `graphify path "<A>" "<B>"` for a
  relationship, `graphify explain "<concept>"` for one concept. Each returns a
  scoped subgraph, usually far smaller than raw grep output.
- Read `graphify-out/GRAPH_REPORT.md` only for broad architecture review.
- Run `graphify update .` after modifying code.
