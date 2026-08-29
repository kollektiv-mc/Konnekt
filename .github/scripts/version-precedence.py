#!/usr/bin/env python3
"""Warn when version.go's base has stopped keeping snapshots above the newest
release.

A snapshot is stamped `<base>-snapshot.<stamp>.<sha>`, where the base comes
from version.go. Cut a tag whose version reaches that base and every future
snapshot sorts *below* the release: the updater offers a snapshot user the
stable build once and then tells them they are up to date forever. Nothing in
CI can repair that, and the channel gives no other sign, so the one thing worth
doing is saying so out loud on the run that first produces a stranded snapshot.

Why this is not two lines of shell
----------------------------------

The comparison has to be the updater's, because the updater is what goes quiet.
`backend/services/update.go`'s `compareVersions` ranks a plain core above any
prerelease of the same core and otherwise compares prerelease suffixes as
strings, which is not what `sort -V` does and not something it implements at
all. The shell guard this replaced worked around that by only ever looking at
*final* releases, so a prerelease tag - `v0.2.0-alpha.1`, which is every tag
this repo has cut - skipped the check entirely and stranded the channel in
silence. Mirroring the Go instead means the answer is the real one, and can be
tested offline rather than at the moment a release is being cut.

Kept in step with `compareVersions` by `version-precedence_test.py`, which runs
that function's own Go test cases through this one.

Reads:

  VERSION  the snapshot version about to be published, as snapshot.yml
           computed it (e.g. 0.2.0-snapshot.202608290400.abc1234)
  LATEST   the newest published release's tag (e.g. v0.2.0-alpha.1). Empty
           when nothing has been released yet, which is nothing to warn about.

Writes a `::warning::` annotation to stdout when the snapshot does not outrank
the release. Always exits 0: this is an observation about a decision already
made elsewhere, and failing the run would only cost the build that carries it.
"""

from __future__ import annotations

import os
import sys

SNAPSHOT_MARKER = "-snapshot."


def split_version(version: str) -> tuple[str, str]:
    """Core and prerelease, as update.go's splitVersion splits them."""
    version = version[1:] if version.startswith("v") else version
    core, separator, prerelease = version.partition("-")
    return core, prerelease if separator else ""


def parse_core(core: str) -> list[int]:
    """The three numeric components, as update.go's parseVersionCore reads them.

    A component that is not a number is left at 0 rather than rejected, which
    is what the Go does: it keeps a malformed version comparable instead of
    making every caller handle an error it cannot act on.
    """
    parts: list[int] = [0, 0, 0]
    for index, component in enumerate(core.split(".", 2)[:3]):
        try:
            parts[index] = int(component)
        except ValueError:
            continue
    return parts


def compare_versions(a: str, b: str) -> int:
    """-1, 0 or 1, matching update.go's compareVersions.

    Prerelease suffixes are compared as strings, byte for byte. Go compares
    UTF-8 bytes and Python compares code points; every version either side of
    this is ASCII, where the two agree.
    """
    core_a, pre_a = split_version(a)
    core_b, pre_b = split_version(b)

    for part_a, part_b in zip(parse_core(core_a), parse_core(core_b)):
        if part_a != part_b:
            return -1 if part_a < part_b else 1

    if not pre_a and not pre_b:
        return 0
    if not pre_a:
        return 1
    if not pre_b:
        return -1
    return (pre_a > pre_b) - (pre_a < pre_b)


def annotation(version: str, latest: str) -> str:
    """The warning for this pair, or "" when the channel is healthy."""
    if not version or not latest or compare_versions(version, latest) > 0:
        return ""
    base = version.split(SNAPSHOT_MARKER, 1)[0]
    return (
        f"::warning::version.go's base ({base}) no longer keeps snapshots above the newest "
        f"release ({latest}): {version} sorts at or below it, so the snapshot channel will "
        f"offer the stable build once and then report 'up to date' forever. "
        f"Bump version.go and wails.json past {latest}."
    )


def main() -> int:
    message = annotation(
        os.environ.get("VERSION", "").strip(), os.environ.get("LATEST", "").strip()
    )
    if message:
        print(message)
    return 0


if __name__ == "__main__":
    sys.exit(main())
