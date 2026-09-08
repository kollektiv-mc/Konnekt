#!/usr/bin/env python3
"""Decide which tag a release run builds, and refuse the ones that go wrong.

.github/workflows/release.yml has two ways in. The Actions tab's "Run workflow"
button names a channel (alpha, beta, stable) and the X.Y.Z it belongs to, and
this script turns that into the tag: the next free counter for a prerelease
(`v0.2.0-alpha.3` after `v0.2.0-alpha.2`) or the bare `v0.2.0` for stable. A
hand-pushed `v*` tag comes through here too, so both paths are held to the
same rules.

The rules, each of which has stranded someone or would have:

  * The shape is `vX.Y.Z`, `vX.Y.Z-alpha.N` or `vX.Y.Z-beta.N` and nothing
    else. The three pre-semver tags this repo still carries (`v2.0-alpha`) do
    not fit it, and a new one like them would outrank every real version.
  * A tag is never cut twice, and never below an existing tag of the same
    core: an alpha after a beta sorts under the beta and is never offered.
  * A snapshot of version.go's base has to outrank the tag being cut, or the
    snapshot channel goes quiet (see version-precedence.py). For an alpha or
    beta that means the base core is at least the tag's core; for a final it
    means the base has already been bumped past it. The bump is a commit on
    main and this workflow will not make one, so it is asked for up front,
    when it costs a merge rather than a stranded channel.

Reads:

  EVENT      push or workflow_dispatch
  REF_NAME   on push, the tag that was pushed
  CHANNEL    on dispatch: alpha, beta or stable
  VERSION    on dispatch: the X.Y.Z core, no "v", no suffix
  BASE       version.go's Version string, e.g. 0.2.0-dev
  TAGS_FILE  a file naming every existing tag, one per line
  LATEST     the newest published release's tag, or empty when there is none

Writes `key=value` lines to the file named by GITHUB_OUTPUT (stdout when it is
unset), for the jobs that follow:

  tag          v0.2.0-alpha.1
  rpm_version  0.2.0~alpha.1, since an RPM version cannot carry "-" and "~"
               sorts before the base the way a prerelease should
  prerelease   true or false: whether GitHub should flag the release. Only
               once a final has shipped; until then an alpha has to be the
               /releases/latest that the stable channel, the download page and
               the notes baseline all read, because nothing else exists.

Exits 1 with a ::error:: annotation when the tag must not be cut.
"""

from __future__ import annotations

import importlib.util
import os
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent

_spec = importlib.util.spec_from_file_location(
    "version_precedence", HERE / "version-precedence.py"
)
_precedence = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_precedence)
compare_versions = _precedence.compare_versions
split_version = _precedence.split_version

PRERELEASE_CHANNELS = ("alpha", "beta")
STABLE = "stable"
CHANNELS = (*PRERELEASE_CHANNELS, STABLE)

TAG = re.compile(r"^v(\d+\.\d+\.\d+)(?:-(alpha|beta)\.(\d+))?$")
CORE = re.compile(r"^\d+\.\d+\.\d+$")


def parse_tag(tag: str) -> tuple[str, str, int] | None:
    """(core, channel, counter) for a tag on the ladder, else None.

    A final is ("0.2.0", "stable", 0). Anything off the ladder, the rolling
    `snapshot` and the pre-semver strays included, is None and plays no part
    in any decision here.
    """
    match = TAG.match(tag)
    if not match:
        return None
    core, channel, counter = match.groups()
    if channel is None:
        return core, STABLE, 0
    return core, channel, int(counter)


def next_tag(channel: str, core: str, tags: list[str]) -> str:
    """The tag a dispatch for this channel and core produces."""
    if channel == STABLE:
        return f"v{core}"
    taken = [
        parsed[2]
        for parsed in map(parse_tag, tags)
        if parsed and parsed[0] == core and parsed[1] == channel
    ]
    return f"v{core}-{channel}.{max(taken, default=0) + 1}"


def problems(tag: str, tags: list[str], base: str) -> list[str]:
    """Every reason not to cut `tag`, in the order a reader should see them.

    `tags` is what exists before this one; on the push path the caller has
    already taken the pushed tag out of it.
    """
    parsed = parse_tag(tag)
    if not parsed:
        return [
            f"{tag} is not vX.Y.Z, vX.Y.Z-alpha.N or vX.Y.Z-beta.N; nothing else is released."
        ]
    core, channel, _ = parsed
    found: list[str] = []

    if tag in tags:
        found.append(f"{tag} already exists. Every release is cut exactly once.")

    below = [
        other
        for other in tags
        if (other_parsed := parse_tag(other))
        and other_parsed[0] == core
        and compare_versions(tag, other) <= 0
    ]
    for other in sorted(
        below, key=lambda other: (parse_tag(other)[1], parse_tag(other)[2])
    ):
        if other != tag:
            found.append(
                f"{other} already exists and {tag} sorts at or below it, "
                f"so the updater would never offer {tag} to anyone on {other}."
            )

    base_core, _ = split_version(base)
    snapshot = f"{base_core}-snapshot.000000000000.0000000"
    if compare_versions(snapshot, tag) <= 0:
        if channel == STABLE:
            major, minor, patch = (int(part) for part in core.split("."))
            found.append(
                f"version.go's base is {base_core}, and a snapshot of it sorts below {tag}, so the "
                f"snapshot channel would go quiet the moment this ships. Bump version.go and wails.json "
                f"past it first (to {major}.{minor}.{patch + 1}-dev or {major}.{minor + 1}.0-dev), then cut."
            )
        else:
            found.append(
                f"version.go's base is {base_core}, below {tag}'s {core}, so every snapshot would sort "
                f"below this release and the snapshot channel would go quiet. Bump version.go and "
                f"wails.json to {core}-dev first, then cut."
            )
    return found


def flag_prerelease(tag: str, latest: str) -> bool:
    """Whether GitHub should mark this release a prerelease.

    Only an alpha or beta, and only once a final has shipped: a flagged release
    leaves /releases/latest, which is what the stable channel, the website's
    download card and the release notes' baseline read. While every release is
    an alpha, flagging one would freeze all three on the previous alpha.
    """
    parsed = parse_tag(tag)
    latest_parsed = parse_tag(latest)
    return bool(
        parsed and parsed[1] != STABLE and latest_parsed and latest_parsed[1] == STABLE
    )


def rpm_version(tag: str) -> str:
    return tag.removeprefix("v").replace("-", "~")


def resolve(env: dict[str, str], tags: list[str]) -> tuple[dict[str, str], list[str]]:
    """The outputs for this run, or the problems that stop it."""
    event = env.get("EVENT", "")
    if event == "push":
        tag = env.get("REF_NAME", "").strip()
        existing = [other for other in tags if other != tag]
    elif event == "workflow_dispatch":
        channel = env.get("CHANNEL", "").strip()
        core = env.get("VERSION", "").strip()
        if channel not in CHANNELS:
            return {}, [
                f"channel must be one of {', '.join(CHANNELS)}, not {channel!r}."
            ]
        if not CORE.match(core):
            return {}, [f"version must be X.Y.Z with no v and no suffix, not {core!r}."]
        tag = next_tag(channel, core, tags)
        existing = tags
    else:
        return {}, [f"EVENT must be push or workflow_dispatch, not {event!r}."]

    found = problems(tag, existing, env.get("BASE", ""))
    if found:
        return {}, found
    return {
        "tag": tag,
        "rpm_version": rpm_version(tag),
        "prerelease": "true"
        if flag_prerelease(tag, env.get("LATEST", "").strip())
        else "false",
    }, []


def main() -> int:
    tags_file = os.environ.get("TAGS_FILE", "")
    tags = pathlib.Path(tags_file).read_text().split() if tags_file else []
    outputs, found = resolve(dict(os.environ), tags)
    if found:
        for problem in found:
            print(f"::error::{problem}")
        return 1
    destination = os.environ.get("GITHUB_OUTPUT")
    lines = "".join(f"{key}={value}\n" for key, value in outputs.items())
    if destination:
        with open(destination, "a", encoding="utf-8") as handle:
            handle.write(lines)
    else:
        sys.stdout.write(lines)
    print(f"::notice::Releasing {outputs['tag']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
