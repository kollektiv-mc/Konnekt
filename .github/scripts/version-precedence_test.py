#!/usr/bin/env python3
"""Tests for the snapshot-channel version guard.

Run: python3 .github/scripts/version-precedence_test.py

Two jobs. The first is that `compare_versions` answers exactly what
`backend/services/update.go`'s `compareVersions` answers, so the cases below
are that function's own table from `update_test.go`, copied verbatim - if the
Go table gains a row, this one should too. The second is the guard itself: the
release shapes that strand the snapshot channel, and the ones that do not.

No network and no token: all of it is pure comparison.
"""

from __future__ import annotations

import importlib.util
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent

spec = importlib.util.spec_from_file_location("version_precedence", HERE / "version-precedence.py")
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)

failures: list[str] = []


def check(name: str, got: object, want: object) -> None:
    if got != want:
        failures.append(f"{name}\n    got:  {got!r}\n    want: {want!r}")


# ── compare_versions, against update_test.go's TestCompareVersions table ────
for a, b, want in [
    ("1.2.3", "1.2.3", 0),
    ("v1.2.3", "1.2.3", 0),
    ("1.2.4", "1.2.3", 1),
    ("1.2.3", "1.2.4", -1),
    ("1.3.0", "1.2.9", 1),
    ("2.0.0", "1.9.9", 1),
    ("1.0.0", "2.0.0", -1),
    ("1.0.0", "1.0.0-dev", 1),
    ("1.0.0-dev", "1.0.0", -1),
    ("1.0.0-alpha", "1.0.0-beta", -1),
    ("0.1.0", "0.1.0-dev", 1),
    ("0.1.0-snapshot.202608300400.def0000", "0.1.0-snapshot.202608290400.abc1234", 1),
    ("0.1.0-snapshot.202608290400.abc1234", "0.1.0-snapshot.202608300400.def0000", -1),
    ("0.1.0-snapshot.202608290400.abc1234", "0.1.0-snapshot.202608290400.abc1234", 0),
    ("0.1.0", "0.1.0-snapshot.202608290400.abc1234", 1),
    ("0.1.0-snapshot.202608290400.abc1234", "v0.1.0-alpha.1", 1),
    ("0.1.0-snapshot.202608290400.abc1234", "0.1.0-dev", 1),
    ("0.2.0-snapshot.202608010000.abc1234", "0.1.0", 1),
]:
    check(f"compare_versions({a!r}, {b!r})", guard.compare_versions(a, b), want)

# A two-component core is padded, not rejected: the tags this repo carried
# before it moved to semver looked like v2.0-alpha.
check("two-component core pads to three", guard.parse_core("2.0"), [2, 0, 0])
# And a component that is not a number stays 0, as strconv.Atoi's error path
# leaves it in the Go.
check("non-numeric component is 0", guard.parse_core("1.x.3"), [1, 0, 3])

# ── The guard ───────────────────────────────────────────────────────────────
SNAPSHOT = "0.2.0-snapshot.202608290400.abc1234"


def warns(version: str, latest: str) -> bool:
    return bool(guard.annotation(version, latest))


# The healthy state this repo is in: the base is the version being worked
# towards, and the newest release is a prerelease of it.
check("prerelease of the same core is fine", warns(SNAPSHOT, "v0.2.0-alpha.1"), False)
check("older release is fine", warns(SNAPSHOT, "v0.1.0-alpha.1"), False)
check("nothing released yet is fine", warns(SNAPSHOT, ""), False)

# The regression this script exists for. The shell guard it replaced compared
# cores with `sort -V` and only ran at all when the newest release had no
# prerelease suffix, so both of these passed silently - and a prerelease tag is
# the only kind this repo has ever cut.
check("prerelease release above the base warns", warns(SNAPSHOT, "v0.3.0-alpha.1"), True)
check("the stray v2.0-alpha shape warns", warns(SNAPSHOT, "v2.0-alpha"), True)

# The case the old guard did catch, which must keep being caught: a final
# release outranks every prerelease of the same core.
check("final release of the same core warns", warns(SNAPSHOT, "v0.2.0"), True)
check("final release above the base warns", warns(SNAPSHOT, "v1.0.0"), True)

# The message has to name what to change; a warning that only says something is
# wrong costs the reader the same search every time.
message = guard.annotation(SNAPSHOT, "v0.2.0")
check("names version.go's base", "(0.2.0)" in message, True)
check("names the release", "v0.2.0" in message, True)
check("names both files to bump", "version.go and wails.json" in message, True)
check("is a warning annotation", message.startswith("::warning::"), True)

# ── Report ─────────────────────────────────────────────────────────────────
if failures:
    print(f"{len(failures)} failing:\n", file=sys.stderr)
    for failure in failures:
        print(f"  {failure}\n", file=sys.stderr)
    sys.exit(1)
print("version-precedence: all checks passed")
