#!/usr/bin/env python3
"""Tests for the changelog classifier.

Run: python3 .github/scripts/release-notes_test.py

No network and no token: everything here is the pure decision-making — which
section a pull request lands in, which paths count as shipped, how the footer
accounts for what was left out. The API plumbing around it is exercised by
actually cutting a release, and mocking it would only test the mock.

Every case named with a `#number` is a real pull request from the range this
script was rewritten over, and the expectation is what a reader of the notes
should have seen rather than what they did see.
"""

from __future__ import annotations

import contextlib
import importlib.util
import io
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent

spec = importlib.util.spec_from_file_location(
    "release_notes", HERE / "release-notes.py"
)
notes = importlib.util.module_from_spec(spec)
spec.loader.exec_module(notes)

failures: list[str] = []


def check(name: str, got: object, want: object) -> None:
    if got != want:
        failures.append(f"{name}\n    got  {got!r}\n    want {want!r}")


def pull(title: str, *labels: str) -> dict:
    return {"title": title, "labels": [{"name": name} for name in labels]}


# ── Labels decide the section ──────────────────────────────────────────────
check(
    "type:feature wins",
    notes.section_for(pull("Whatever", "type:feature")),
    notes.FEATURES,
)
check("type:bug wins", notes.section_for(pull("Whatever", "type:bug")), notes.FIXES)
check(
    "type:chore is quiet",
    notes.section_for(pull("Whatever", "type:chore")),
    notes.QUIET,
)
check(
    "type:docs is quiet", notes.section_for(pull("Whatever", "type:docs")), notes.QUIET
)
check(
    "changelog:skip wins over all",
    notes.section_for(pull("Add a thing", "changelog:skip", "type:feature")),
    notes.SKIP,
)
check(
    "labels are case-insensitive",
    notes.section_for(pull("Whatever", "Type:Bug")),
    notes.FIXES,
)

# A label beats the title's own verb. #82 "Adopt bg-overlay, and vendor the
# suite-kit check runner" shipped as a Feature because it carried type:feature;
# relabelled type:chore it drops out, and no title reading is involved either way.
check(
    "#82 label beats prose",
    notes.section_for(
        pull("Adopt bg-overlay, and vendor the suite-kit check runner", "type:chore")
    ),
    notes.QUIET,
)

# ── Nothing is read out of the title ──────────────────────────────────────
# The rule this file exists to hold. Every title below reads as *something* to
# a person, and none of them is allowed to say what the change was. CI's
# `pr-labelled` job makes an unlabelled merge impossible, so anything reaching
# these lines is a gate that did not run, and "Other changes" is where that
# stays visible instead of being dressed up as a category.
check(
    "#63 unlabelled 'Add ...'",
    notes.section_for(
        pull("Add a Full release roadmap section and a nightly snapshot build channel")
    ),
    notes.OTHER,
)
check(
    "unlabelled 'Implement ...'",
    notes.section_for(
        pull("Implement in-place auto-updater with download, verify, and install")
    ),
    notes.OTHER,
)
check(
    "unlabelled 'Support ...'",
    notes.section_for(pull("Support NeoForge and modern Forge servers")),
    notes.OTHER,
)
# These four were guessed until the leading-verb and conventional-prefix passes
# were removed. A verb says how the author phrased a sentence, not what the
# change was, and a `feat:` prefix is a convention this repo's titles do not
# even use — its title rule is sentence case, so a prefix here is a hand-written
# scope like "website:", not a claim about the category.
check(
    "unlabelled 'Fix ...'",
    notes.section_for(pull("Fix the config dropdown staying dark")),
    notes.OTHER,
)
check(
    "#86 unlabelled 'Stop ...'",
    notes.section_for(pull("Stop backups from silently overwriting each other")),
    notes.OTHER,
)
check(
    "unlabelled 'feat:' prefix",
    notes.section_for(pull("feat: add the mods tile")),
    notes.OTHER,
)
check(
    "unlabelled 'fix:' prefix",
    notes.section_for(pull("fix: stop the crash")),
    notes.OTHER,
)
check(
    "unlabelled hand-written scope",
    notes.section_for(pull("website: fix the hero")),
    notes.OTHER,
)
check(
    "unlabelled neutral verb",
    notes.section_for(pull("Migrate the worlds tile off inline styles")),
    notes.OTHER,
)
check("empty title", notes.section_for(pull("")), notes.OTHER)

# ── The label carries the changes whose titles read as the other thing ─────
# #97 "Write a log file a bug reporter can attach" shipped under Features: a
# repair that happened to add a file, a bound method and a row of UI, which
# reads as new capability to whoever is labelling it. Nothing was wrong with
# the title. The label is what had to be right, and it is now the only thing
# that can be, which is why the ladder for choosing it lives in the product's
# CONTRIBUTING.md and pull request template rather than in this file.
check(
    "#97 a fix whose title reads as a feature",
    notes.section_for(pull("Write a log file a bug reporter can attach", "type:bug")),
    notes.FIXES,
)
check(
    "a feature whose title reads as a fix",
    notes.section_for(
        pull(
            "Stop the console dropping lines above the scrollback limit", "type:feature"
        )
    ),
    notes.FEATURES,
)

# ── The Changelog section ─────────────────────────────────────────────────
# One pull request, several changes. The parser is the one the pr-labelled gate
# runs, so these cases are also what the gate accepts and refuses.
parse = notes.changelog_section.parse


def body_pull(body: str, *labels: str, title: str = "A title") -> dict:
    return {**pull(title, *labels), "number": 1, "body": body}


TEMPLATE_BODY = """## Why

Because.

## Changelog

<!--
One line per change: - type: text
- feature: An example that must never be read
-->

## How it was verified

Ran it.
"""

check("no body", parse(None), ([], []))
check("no section", parse("## Why\n\nBecause."), ([], []))
check("the template's own example is a comment", parse(TEMPLATE_BODY), ([], []))
check(
    "three types in one pull request",
    parse(
        "## Changelog\n\n- feature: Add servers from a plus\n"
        "- fix: Make the world info panel opaque\n* chore: Load Settings on first open\n"
    ),
    (
        [
            ("feature", "Add servers from a plus"),
            ("fix", "Make the world info panel opaque"),
            ("chore", "Load Settings on first open"),
        ],
        [],
    ),
)
check(
    "bug means fix, case and spacing do not matter",
    parse("### changelog\n-   BUG :  Keep   the line  "),
    ([("fix", "Keep the line")], []),
)
check(
    "the next heading ends the section",
    parse("## Changelog\n- docs: Explain it\n## How it was verified\n- ran: it"),
    ([("docs", "Explain it")], []),
)
check(
    "a deeper heading does not end it, and is an error",
    parse("## Changelog\n### Fixes\n- fix: A fix"),
    ([("fix", "A fix")], ["line 1 is not '- type: text'"]),
)
check(
    "an unknown type names its line",
    parse("## Changelog\n\n- feature: Fine\n- bgu: Typo"),
    ([("feature", "Fine")], ["line 3: unknown type 'bgu'"]),
)
check(
    "an empty entry is an error",
    parse("## Changelog\n- fix:   "),
    ([], ["line 1: no text after 'fix:'"]),
)
check(
    "prose is an error",
    parse("## Changelog\nSome words"),
    ([], ["line 1 is not '- type: text'"]),
)
check(
    "markup at the start of an entry is dropped",
    parse("## Changelog\n- feature: ## Loud"),
    ([("feature", "Loud")], []),
)
check(
    "CRLF bodies, as GitHub stores them",
    parse("## Changelog\r\n\r\n- fix: One\r\n- skip: Two\r\n"),
    ([("fix", "One"), ("skip", "Two")], []),
)

# entries_for: the section wins over the label, and its absence falls back.
check(
    "section entries are filed by their own types",
    notes.entries_for(
        body_pull(
            "## Changelog\n- feature: New thing\n- fix: Old thing\n- docs: Words",
            "type:chore",
        )
    ),
    [
        (notes.FEATURES, "* New thing"),
        (notes.FIXES, "* Old thing"),
        (notes.QUIET, "* Words"),
    ],
)
check(
    "no section falls back to label and title",
    notes.entries_for(body_pull("Just a body", "type:bug", title="Fix the thing")),
    [(notes.FIXES, "* Fix the thing")],
)
check(
    "an empty section falls back too",
    notes.entries_for(body_pull(TEMPLATE_BODY, "type:feature", title="Do the thing")),
    [(notes.FEATURES, "* Do the thing")],
)
# The generator says on stderr that it ignored the section; that line belongs in
# a release job's log, not in this test's output.
with contextlib.redirect_stderr(io.StringIO()):
    malformed = notes.entries_for(
        body_pull("## Changelog\n- feature: Fine\n- bgu: Typo", "type:bug", title="T")
    )
check("a malformed section is not half-used", malformed, [(notes.FIXES, "* T")])
check(
    "changelog:skip silences a section",
    notes.entries_for(body_pull("## Changelog\n- feature: Hidden", "changelog:skip")),
    [(notes.SKIP, "")],
)
check(
    "a section without any label still files",
    notes.entries_for(body_pull("## Changelog\n- fix: Unlabelled but described")),
    [(notes.FIXES, "* Unlabelled but described")],
)

# ── The path filter ────────────────────────────────────────────────────────
# Against a fixture rather than the repo's own changelog.json, so this file is
# byte-identical wherever it sits: in a product beside the script it tests, and
# in kollektiv/plugins/suite-kit/ where it is the master copy and there is no
# product config to read. The real config is checked separately at the bottom,
# where it exists.
NON_APP = (
    ".claude/",
    ".github/",
    ".gitattributes",
    ".gitignore",
    "CLAUDE.md",
    "CONTRIBUTING.md",
    "LICENSE",
    "README.md",
    "SECURITY.md",
    "agent_docs/",
    "docs/",
    "lefthook.yml",
    "scripts/",
    "website/",
)


def ships(*files: str) -> bool:
    """Mirror of touches_app's predicate, without the paging and the network."""
    return any(not f.startswith(NON_APP) for f in files)


check("app code ships", ships("backend/services/backup.go"), True)
check("frontend ships", ships("frontend/src/tiles/registry.ts"), True)
check("build assets ship", ships("build/linux/konnekt.spec"), True)
check("root Go files ship", ships("app.go"), True)

check(
    "website alone does not", ships("website/index.html", "website/styles.css"), False
)
check("agent docs alone do not", ships("agent_docs/ROADMAP.md"), False)
# #87 rode into the notes on one README line beside an all-website diff.
check("#87 README beside website", ships("README.md", "website/download.html"), False)
# The same hole, found by the pull request that rewrote the type: label rules:
# CONTRIBUTING.md is the document those rules live in and ships nowhere, but it
# was not in the list, so a pull request editing it was filed as an app change.
check(
    "contributor docs alone do not",
    ships("CONTRIBUTING.md", "SECURITY.md", ".github/labels.yml"),
    False,
)
# #90 rode in on a .claude rule and a README line, and was labelled type:feature.
check(
    "#90 .claude rule beside website",
    ships(".claude/rules/builds-and-releases.md", "README.md", "website/index.html"),
    False,
)
# #65/#66/#75/#76 were the release tooling describing itself as an app change.
check(
    "#76 release tooling",
    ships(".github/scripts/release-notes.py", ".github/workflows/snapshot.yml"),
    False,
)
check(
    "#22 CI and agent config",
    ships(".claude/settings.json", ".github/workflows/ci.yml", ".gitignore"),
    False,
)
check("repo tooling alone does not", ships("scripts/check-website-links.mjs"), False)
# #51 is the case the filter must not over-reach on: repo furniture, plus a
# real IPC fix in app.go.
check(
    "#51 app.go among repo meta",
    ships(".claude/suite.json", "agent_docs/ROADMAP.md", "app.go"),
    True,
)
# Prefix matching must not swallow a same-named app path.
check("docs/ prefix is a directory", ships("docs/images/banner.png"), False)
check("no changed files at all", ships(), False)

# ── The footer accounts for what was left out ──────────────────────────────
check("nothing left out", notes.footer(0, 0), "")
check(
    "both reasons",
    notes.footer(17, 6),
    "_23 changes are not listed: 17 changed nothing that ships in this build, 6 maintenance or documentation._",
)
check(
    "one reason only",
    notes.footer(0, 1),
    "_1 change is not listed: 1 maintenance or documentation._",
)
check(
    "not-shipped only",
    notes.footer(3, 0),
    "_3 changes are not listed: 3 changed nothing that ships in this build._",
)

# ── Config loading ─────────────────────────────────────────────────────────
try:
    notes.load_non_app_paths(HERE / "does-not-exist.json")
    failures.append("missing config should raise")
except notes.ApiError:
    pass

# This repo's own config, when this copy is the one sitting in a product. In
# kollektiv there is no product beside it, and the fixture above is the whole
# test — a master copy has nothing of its own to validate.
CONFIG = HERE.parent / "changelog.json"
REPO = HERE.parent.parent
if CONFIG.exists():
    configured = notes.load_non_app_paths(CONFIG)
    check("config is non-empty", len(configured) > 0, True)
    # The path classes that leaked real pull requests into Konnekt's notes. A
    # product that has one of these must exclude it, and dropping it reopens a
    # bug that has already happened once; a product with no website/ or
    # CONTRIBUTING.md is not asked to name paths it does not have. This test
    # is vendored into every product, so it can only assert what is true of
    # each of them.
    for prefix in ("website/", ".github/", ".claude/", "README.md", "CONTRIBUTING.md"):
        if (REPO / prefix.rstrip("/")).exists():
            check(f"config still excludes {prefix}", prefix in configured, True)
    # And the one it must not exclude: build/ carries the app icon, the .desktop
    # file and the RPM spec, all of which ship.
    check(
        "config does not exclude build/",
        any(p.startswith("build") for p in configured),
        False,
    )

# ── Report ─────────────────────────────────────────────────────────────────
if failures:
    print(f"{len(failures)} failing:\n", file=sys.stderr)
    for failure in failures:
        print(f"  {failure}\n", file=sys.stderr)
    sys.exit(1)
print("release-notes: all checks passed")
