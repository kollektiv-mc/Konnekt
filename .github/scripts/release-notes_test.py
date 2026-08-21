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

import importlib.util
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent

spec = importlib.util.spec_from_file_location("release_notes", HERE / "release-notes.py")
notes = importlib.util.module_from_spec(spec)
spec.loader.exec_module(notes)

failures: list[str] = []


def check(name: str, got: object, want: object) -> None:
    if got != want:
        failures.append(f"{name}\n    got  {got!r}\n    want {want!r}")


def pull(title: str, *labels: str) -> dict:
    return {"title": title, "labels": [{"name": name} for name in labels]}


# ── Labels decide the section ──────────────────────────────────────────────
check("type:feature wins", notes.section_for(pull("Whatever", "type:feature")), notes.FEATURES)
check("type:bug wins", notes.section_for(pull("Whatever", "type:bug")), notes.FIXES)
check("type:chore is quiet", notes.section_for(pull("Whatever", "type:chore")), notes.QUIET)
check("type:docs is quiet", notes.section_for(pull("Whatever", "type:docs")), notes.QUIET)
check("changelog:skip wins over all", notes.section_for(pull("Add a thing", "changelog:skip", "type:feature")), notes.SKIP)
check("labels are case-insensitive", notes.section_for(pull("Whatever", "Type:Bug")), notes.FIXES)

# A label beats the title's own verb. #82 "Adopt bg-overlay, and vendor the
# suite-kit check runner" shipped as a Feature because it carried type:feature;
# relabelled type:chore it drops out, and no title reading is involved either way.
check(
    "#82 label beats prose",
    notes.section_for(pull("Adopt bg-overlay, and vendor the suite-kit check runner", "type:chore")),
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
    notes.section_for(pull("Add a Full release roadmap section and a nightly snapshot build channel")),
    notes.OTHER,
)
check(
    "unlabelled 'Implement ...'",
    notes.section_for(pull("Implement in-place auto-updater with download, verify, and install")),
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
check("unlabelled 'Fix ...'", notes.section_for(pull("Fix the config dropdown staying dark")), notes.OTHER)
check(
    "#86 unlabelled 'Stop ...'",
    notes.section_for(pull("Stop backups from silently overwriting each other")),
    notes.OTHER,
)
check("unlabelled 'feat:' prefix", notes.section_for(pull("feat: add the mods tile")), notes.OTHER)
check("unlabelled 'fix:' prefix", notes.section_for(pull("fix: stop the crash")), notes.OTHER)
check("unlabelled hand-written scope", notes.section_for(pull("website: fix the hero")), notes.OTHER)
check("unlabelled neutral verb", notes.section_for(pull("Migrate the worlds tile off inline styles")), notes.OTHER)
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
    notes.section_for(pull("Stop the console dropping lines above the scrollback limit", "type:feature")),
    notes.FEATURES,
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

check("website alone does not", ships("website/index.html", "website/styles.css"), False)
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
check("#90 .claude rule beside website", ships(".claude/rules/builds-and-releases.md", "README.md", "website/index.html"), False)
# #65/#66/#75/#76 were the release tooling describing itself as an app change.
check("#76 release tooling", ships(".github/scripts/release-notes.py", ".github/workflows/snapshot.yml"), False)
check("#22 CI and agent config", ships(".claude/settings.json", ".github/workflows/ci.yml", ".gitignore"), False)
check("repo tooling alone does not", ships("scripts/check-website-links.mjs"), False)
# #51 is the case the filter must not over-reach on: repo furniture, plus a
# real IPC fix in app.go.
check("#51 app.go among repo meta", ships(".claude/suite.json", "agent_docs/ROADMAP.md", "app.go"), True)
# Prefix matching must not swallow a same-named app path.
check("docs/ prefix is a directory", ships("docs/images/banner.png"), False)
check("no changed files at all", ships(), False)

# ── The footer accounts for what was left out ──────────────────────────────
check("nothing left out", notes.footer(0, 0), "")
check(
    "both reasons",
    notes.footer(17, 6),
    "_23 pull requests are not listed: 17 changed nothing that ships in this build, 6 maintenance or documentation._",
)
check(
    "one reason only",
    notes.footer(0, 1),
    "_1 pull request is not listed: 1 maintenance or documentation._",
)
check(
    "not-shipped only",
    notes.footer(3, 0),
    "_3 pull requests are not listed: 3 changed nothing that ships in this build._",
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
if CONFIG.exists():
    configured = notes.load_non_app_paths(CONFIG)
    check("config is non-empty", len(configured) > 0, True)
    # The four path classes that leaked real pull requests into the notes. A
    # product may add to this list, but dropping one of these reopens a bug
    # that has already happened once.
    for prefix in ("website/", ".github/", ".claude/", "README.md", "CONTRIBUTING.md"):
        check(f"config still excludes {prefix}", prefix in configured, True)
    # And the one it must not exclude: build/ carries the app icon, the .desktop
    # file and the RPM spec, all of which ship.
    check("config does not exclude build/", any(p.startswith("build") for p in configured), False)

# ── Report ─────────────────────────────────────────────────────────────────
if failures:
    print(f"{len(failures)} failing:\n", file=sys.stderr)
    for failure in failures:
        print(f"  {failure}\n", file=sys.stderr)
    sys.exit(1)
print("release-notes: all checks passed")
