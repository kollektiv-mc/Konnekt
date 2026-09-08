#!/usr/bin/env python3
"""Tests for the release tag resolver.

Run: python3 .github/scripts/release-tag_test.py

No network and no token: the resolver reads a tag list and a few strings, and
everything it decides is decided from those. The tag lists below are this
repo's own, stray pre-semver tags included, because ignoring those correctly
is one of the jobs.
"""

from __future__ import annotations

import importlib.util
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent

spec = importlib.util.spec_from_file_location("release_tag", HERE / "release-tag.py")
resolver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(resolver)

failures: list[str] = []


def check(name: str, got: object, want: object) -> None:
    if got != want:
        failures.append(f"{name}\n    got  {got!r}\n    want {want!r}")


# What `git ls-remote --tags` returns for this repository today.
TAGS = ["snapshot", "v0.1-alpha", "v0.1.0-alpha.1", "v1.1-alpha", "v2.0-alpha"]


def dispatch(channel: str, version: str, base: str = "0.2.0-dev", latest: str = "v0.1.0-alpha.1", tags=TAGS):
    env = {"EVENT": "workflow_dispatch", "CHANNEL": channel, "VERSION": version, "BASE": base, "LATEST": latest}
    return resolver.resolve(env, list(tags))


def push(tag: str, base: str = "0.2.0-dev", latest: str = "v0.1.0-alpha.1", tags=TAGS):
    env = {"EVENT": "push", "REF_NAME": tag, "BASE": base, "LATEST": latest}
    return resolver.resolve(env, list(tags) + [tag])


# ── The shape ──────────────────────────────────────────────────────────────
check("final", resolver.parse_tag("v0.2.0"), ("0.2.0", "stable", 0))
check("alpha", resolver.parse_tag("v0.2.0-alpha.3"), ("0.2.0", "alpha", 3))
check("beta", resolver.parse_tag("v0.2.0-beta.12"), ("0.2.0", "beta", 12))
check("the rolling snapshot is off the ladder", resolver.parse_tag("snapshot"), None)
check("pre-semver stray is off the ladder", resolver.parse_tag("v2.0-alpha"), None)
check("no counter is off the ladder", resolver.parse_tag("v0.2.0-alpha"), None)
check("rc is off the ladder", resolver.parse_tag("v0.2.0-rc.1"), None)
check("no v is off the ladder", resolver.parse_tag("0.2.0"), None)

# ── The next counter ───────────────────────────────────────────────────────
check("first alpha of a core", resolver.next_tag("alpha", "0.2.0", TAGS), "v0.2.0-alpha.1")
check("first beta of a core", resolver.next_tag("beta", "0.2.0", TAGS), "v0.2.0-beta.1")
check("stable is bare", resolver.next_tag("stable", "0.2.0", TAGS), "v0.2.0")
check(
    "counts past the highest, not the count",
    resolver.next_tag("alpha", "0.2.0", TAGS + ["v0.2.0-alpha.1", "v0.2.0-alpha.4"]),
    "v0.2.0-alpha.5",
)
check(
    "counters are per channel",
    resolver.next_tag("beta", "0.2.0", TAGS + ["v0.2.0-alpha.1", "v0.2.0-alpha.2"]),
    "v0.2.0-beta.1",
)
check(
    "counters are per core",
    resolver.next_tag("alpha", "0.3.0", TAGS + ["v0.2.0-alpha.7"]),
    "v0.3.0-alpha.1",
)
check(
    "a tenth alpha follows a ninth",
    resolver.next_tag("alpha", "0.2.0", TAGS + [f"v0.2.0-alpha.{n}" for n in range(1, 10)]),
    "v0.2.0-alpha.10",
)

# ── The release this repo is about to cut ──────────────────────────────────
outputs, found = dispatch("alpha", "0.2.0")
check("v0.2.0-alpha.1 has no problems", found, [])
check("v0.2.0-alpha.1 tag", outputs.get("tag"), "v0.2.0-alpha.1")
check("v0.2.0-alpha.1 rpm version", outputs.get("rpm_version"), "0.2.0~alpha.1")
check("v0.2.0-alpha.1 is not flagged while no final exists", outputs.get("prerelease"), "false")

# And the same tag pushed by hand resolves identically.
outputs, found = push("v0.2.0-alpha.1")
check("hand-pushed v0.2.0-alpha.1 has no problems", found, [])
check("hand-pushed tag passes through", outputs.get("tag"), "v0.2.0-alpha.1")

# ── Refusals ───────────────────────────────────────────────────────────────
def refuses(result, fragment: str) -> bool:
    _, found = result
    return any(fragment in problem for problem in found)


check("a stray shape is refused on push", refuses(push("v3.0-alpha"), "is not vX.Y.Z"), True)
check("rc is refused on push", refuses(push("v0.2.0-rc.1"), "is not vX.Y.Z"), True)
check(
    "an existing tag is refused on dispatch",
    refuses(dispatch("stable", "0.1.0", tags=TAGS + ["v0.1.0"], base="0.2.0-dev"), "already exists. Every release"),
    True,
)
check(
    "an alpha after a beta of the same core is refused",
    refuses(dispatch("alpha", "0.2.0", tags=TAGS + ["v0.2.0-beta.1"]), "v0.2.0-beta.1 already exists and v0.2.0-alpha.1 sorts at or below it"),
    True,
)
check(
    "a beta after an alpha is fine",
    dispatch("beta", "0.2.0", tags=TAGS + ["v0.2.0-alpha.3"])[1],
    [],
)
check(
    "a hand-pushed lower tag is refused, not just a dispatched one",
    refuses(push("v0.2.0-alpha.1", tags=TAGS + ["v0.2.0-alpha.2"]), "v0.2.0-alpha.2 already exists"),
    True,
)

# The snapshot-channel guard, now a refusal rather than the nightly warning.
check(
    "an alpha above the base is refused",
    refuses(dispatch("alpha", "0.3.0", base="0.2.0-dev"), "Bump version.go and wails.json to 0.3.0-dev first"),
    True,
)
check(
    "an alpha below the base is fine (a backport)",
    dispatch("alpha", "0.1.1", base="0.2.0-dev")[1],
    [],
)
check(
    "a final needs the bump before, not after",
    refuses(dispatch("stable", "0.2.0", base="0.2.0-dev"), "past it first (to 0.2.1-dev or 0.3.0-dev)"),
    True,
)
check(
    "a final after the bump is fine",
    dispatch("stable", "0.2.0", base="0.3.0-dev")[1],
    [],
)
check(
    "a final after a patch-level bump is fine",
    dispatch("stable", "0.2.0", base="0.2.1-dev")[1],
    [],
)

# ── Inputs ─────────────────────────────────────────────────────────────────
check("unknown channel", refuses(dispatch("rc", "0.2.0"), "channel must be one of"), True)
check("version with a v", refuses(dispatch("alpha", "v0.2.0"), "version must be X.Y.Z"), True)
check("version with a suffix", refuses(dispatch("alpha", "0.2.0-alpha.1"), "version must be X.Y.Z"), True)
check("two-component version", refuses(dispatch("alpha", "0.2"), "version must be X.Y.Z"), True)
check("unknown event", refuses(resolver.resolve({"EVENT": "schedule"}, []), "EVENT must be"), True)

# ── The prerelease flag ────────────────────────────────────────────────────
check("alpha with no final yet", resolver.flag_prerelease("v0.2.0-alpha.1", "v0.1.0-alpha.1"), False)
check("alpha with nothing released", resolver.flag_prerelease("v0.2.0-alpha.1", ""), False)
check("alpha after a final", resolver.flag_prerelease("v0.3.0-alpha.1", "v0.2.0"), True)
check("beta after a final", resolver.flag_prerelease("v0.2.1-beta.1", "v0.2.0"), True)
check("a final is never flagged", resolver.flag_prerelease("v0.3.0", "v0.2.0"), False)
check("an unparseable latest counts as no final", resolver.flag_prerelease("v0.2.0-alpha.2", "v2.0-alpha"), False)

# ── Report ─────────────────────────────────────────────────────────────────
if failures:
    print(f"{len(failures)} failing:\n", file=sys.stderr)
    for failure in failures:
        print(f"  {failure}\n", file=sys.stderr)
    sys.exit(1)
print("release-tag: all checks passed")
