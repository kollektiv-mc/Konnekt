#!/usr/bin/env python3
"""Read the `## Changelog` section of a pull request body.

One pull request can carry several changes, and the release notes list each
of them on its own line. The section is how its author says what they are:

    ## Changelog

    - feature: Add servers from a plus in the Servers header
    - fix: Make the world info panel opaque
    - chore: Load Settings on first open

Two callers, one parser, so the gate and the notes can never disagree about
what a line means:

  * `release-notes.py` loads this file from beside it and files each entry
    under the section its type names.
  * The `pr-labelled` gate runs it on a pull request's body and holds the
    status pending while any line is malformed, so a typo cannot quietly
    land a change in the wrong section.

The section is optional. A body without one, or with only the template's
commented-out example in it, has no entries, and the pull request is filed by
its `type:` label and its title, the way every pull request was before this
existed. That is what keeps Dependabot and Renovate pull requests working:
they cannot write a section.

Run as a script it reads a body on stdin and prints
`{"entries": [[type, text], ...], "errors": [...]}` as JSON. No network, no
token, nothing imported beyond the standard library: the gate fetches this one
file from the base branch and runs it in isolation.
"""

from __future__ import annotations

import json
import re
import sys

# Each type, and what the notes do with it. `bug` is accepted beside `fix`
# because the label is `type:bug` and whoever has just applied it will reach
# for the same word.
TYPES = {
    "feature": "feature",
    "fix": "fix",
    "bug": "fix",
    "chore": "chore",
    "docs": "docs",
    "skip": "skip",
}

# A line of the notes is a line of a list. A heading, a quote or a stray
# bullet inside an entry would reach the release body as markup, so an entry
# is capped and kept to plain text on one line.
MAX_ENTRY = 200

HEADING = re.compile(r"^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$")
ENTRY = re.compile(r"^\s*[-*+]\s+([A-Za-z]+)\s*:\s*(.*?)\s*$")
COMMENT = re.compile(r"<!--.*?-->", re.DOTALL)


def section_lines(body: str) -> list[tuple[int, str]] | None:
    """The lines under the Changelog heading, numbered from 1 within it.

    None when there is no such heading. The section runs to the next heading
    of the same or a higher level, so a `###` inside it ends nothing it should
    not and a following `## How it was verified` ends it.

    HTML comments are removed first and their lines kept blank, which is what
    lets the pull request template carry its instructions and an example
    inside the section without either being read as an entry.
    """
    text = COMMENT.sub(lambda m: "\n" * m.group(0).count("\n"), body or "")
    lines = text.replace("\r\n", "\n").split("\n")
    start = level = None
    for index, line in enumerate(lines):
        match = HEADING.match(line)
        if not match:
            continue
        if start is None:
            if match.group(2).strip().lower() == "changelog":
                start, level = index + 1, len(match.group(1))
        elif len(match.group(1)) <= level:
            return list(enumerate(lines[start:index], 1))
    if start is None:
        return None
    return list(enumerate(lines[start:], 1))


def parse(body: str | None) -> tuple[list[tuple[str, str]], list[str]]:
    """Every entry in the section as (type, text), and every line that is not one.

    A blank line is not an error. Anything else that is not `- type: text`
    with a known type and some text is, and names its line, because the
    person reading the gate's status has to find it.
    """
    lines = section_lines(body or "")
    if lines is None:
        return [], []
    entries: list[tuple[str, str]] = []
    errors: list[str] = []
    for number, line in lines:
        if not line.strip():
            continue
        match = ENTRY.match(line)
        if not match:
            errors.append(f"line {number} is not '- type: text'")
            continue
        kind = match.group(1).lower()
        text = " ".join(match.group(2).split()).lstrip("#> ")
        if kind not in TYPES:
            errors.append(f"line {number}: unknown type '{match.group(1)}'")
            continue
        if not text:
            errors.append(f"line {number}: no text after '{match.group(1)}:'")
            continue
        if len(text) > MAX_ENTRY:
            errors.append(f"line {number}: longer than {MAX_ENTRY} characters")
            continue
        entries.append((TYPES[kind], text))
    return entries, errors


if __name__ == "__main__":
    found, problems = parse(sys.stdin.read())
    json.dump({"entries": found, "errors": problems}, sys.stdout)
    print()
