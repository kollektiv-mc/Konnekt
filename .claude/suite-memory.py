#!/usr/bin/env python3
"""The always-loaded agent memory budget, for suite-check.py's memory section.

Split out of the runner rather than written inside it, because the runner is
the largest file in this repo and its size ratchet is held at what it measured
before this existed. Vendored as a pair with it by scripts/sync-runner.sh: a
product that has one and not the other has a stale vendoring, which the runner
reports as a skip rather than a crash.

What it measures is every file Claude Code loads into context at the start of
each session, which is not the same as the file named CLAUDE.md. See
docs/conventions.md § The agent memory budget.
"""

import os
import re

# https://code.claude.com/docs/en/memory: "target under 200 lines per CLAUDE.md
# file. Longer files consume more context and reduce adherence."
DEFAULT_BUDGET = 200

# The depth the loader follows @import chains to, from the same page.
IMPORT_DEPTH = 4

# These must match suite-check.py's constants; suite-check_test.py pins them
# together, because importing them from there would be a cycle.
PASS, FAIL, SKIP = "pass", "fail", "skip"

FENCE_RE = re.compile(r"^\s{0,3}(```+|~~~+)")
CODE_SPAN_RE = re.compile(r"`[^`]*`")
IMPORT_RE = re.compile(r"(?:^|\s)@([~./\w][^\s]*)")
FRONTMATTER_PATHS_RE = re.compile(r"^paths\s*:", re.MULTILINE)


def fence_state(line, fenced, fence_char):
    """Track whether we are inside a fenced code block.

    A fence closes only on the character that opened it, so a ``` inside a ~~~
    block does not end it.
    """
    match = FENCE_RE.match(line)
    if not match:
        return fenced, fence_char
    char = match.group(1)[0]
    if not fenced:
        return True, char
    if char == fence_char:
        return False, None
    return fenced, fence_char


def strip_html_comments(text):
    """Drop block-level HTML comments, which cost no context.

    Claude Code strips them before injecting a memory file, so counting them
    would overstate the real cost and would tax exactly the maintainer notes
    that feature exists to make free. Comments inside fenced code blocks are
    preserved by the loader, so they are preserved here too.
    """
    out = []
    fenced, fence_char, in_comment = False, None, False

    for line in text.splitlines():
        if not in_comment:
            was_fenced = fenced
            fenced, fence_char = fence_state(line, fenced, fence_char)
            if fenced or was_fenced:
                out.append(line)
                continue

        kept, rest = "", line
        while rest:
            if in_comment:
                end = rest.find("-->")
                if end == -1:
                    rest = ""
                else:
                    rest, in_comment = rest[end + 3 :], False
            else:
                start = rest.find("<!--")
                if start == -1:
                    kept, rest = kept + rest, ""
                else:
                    kept, rest, in_comment = (
                        kept + rest[:start],
                        rest[start + 4 :],
                        True,
                    )

        # A line that held nothing but comment disappears rather than becoming a
        # blank one, because that is what it costs the context window: nothing.
        if line.strip() and not kept.strip():
            continue
        out.append(kept)

    return "\n".join(out)


def imports_in(text):
    """The @path imports a memory file actually triggers.

    Code spans and fenced blocks are skipped, matching the loader: a path
    written as `@README` in backticks is documentation, not an import.
    """
    refs = []
    fenced, fence_char = False, None

    for line in text.splitlines():
        was_fenced = fenced
        fenced, fence_char = fence_state(line, fenced, fence_char)
        if fenced or was_fenced:
            continue
        refs += IMPORT_RE.findall(CODE_SPAN_RE.sub(" ", line))

    return refs


def rule_is_path_scoped(path):
    """Whether a .claude/rules file declares `paths:` frontmatter.

    A rule with paths: loads only when Claude reads a file it matches, so it
    costs nothing at launch and is the sanctioned place to move detail to. One
    without it loads every session exactly like CLAUDE.md, which is what puts it
    in this budget.
    """
    try:
        with open(path, encoding="utf-8") as handle:
            text = handle.read()
    except OSError:
        return False
    if not text.startswith("---"):
        return False
    end = text.find("\n---", 3)
    if end == -1:
        return False
    return bool(FRONTMATTER_PATHS_RE.search(text[3:end]))


def resolve(root):
    """Every file this repo loads into context at launch.

    Returns (files, notes): files as (repo-relative path, line count) pairs,
    notes as strings about what was deliberately or unavoidably not counted.

    Splitting a long CLAUDE.md into @imports is what makes this function
    necessary. It organises the content and reduces the cost by nothing at all:
    imported files are expanded into context at launch, so a twelve-line root
    file importing six hundred lines costs six hundred and twelve.
    """
    seen, files, notes = set(), [], []

    def visit(abs_path, depth):
        rel = os.path.relpath(abs_path, root)
        if rel in seen:
            return
        seen.add(rel)

        try:
            with open(abs_path, encoding="utf-8") as handle:
                text = handle.read()
        except OSError as exc:
            notes.append(f"{rel}: unreadable ({exc.strerror})")
            return

        body = strip_html_comments(text)
        files.append((rel, len(body.splitlines())))

        if depth >= IMPORT_DEPTH:
            notes.append(f"{rel}: imports past depth {IMPORT_DEPTH} not followed")
            return

        for ref in imports_in(body):
            target = os.path.normpath(
                os.path.join(os.path.dirname(abs_path), os.path.expanduser(ref))
            )
            if not os.path.isfile(target):
                continue
            if os.path.relpath(target, root).startswith(".."):
                # Outside the repo is not this repo's committed content, and the
                # user is asked before such an import ever loads.
                notes.append(f"{rel}: external import {ref} not counted")
                continue
            visit(target, depth + 1)

    for name in ("CLAUDE.md", os.path.join(".claude", "CLAUDE.md")):
        path = os.path.join(root, name)
        if os.path.isfile(path):
            visit(path, 0)

    for dirpath, _, names in os.walk(os.path.join(root, ".claude", "rules")):
        for name in sorted(names):
            if name.endswith(".md"):
                path = os.path.join(dirpath, name)
                if not rule_is_path_scoped(path):
                    visit(path, 0)

    return files, notes


def evaluate(root, config):
    """Judge this repo against the budget. Returns (status, reason, details).

    Driven by no manifest list, unlike every other section, and deliberately:
    every repo pays this cost whether or not it declares anything, so a check a
    repo opts into is a check a new repo silently lacks. An absent config means
    the suite default, never a skip.

    health.memory exists only to hold an over-budget repo's ratchet while it
    comes down. Once the repo is inside the default the field has to go, which
    the schema enforces by refusing a maxLines under 201 and this refuses again
    here, because a schema only binds a repo that validates its manifest.
    """
    files, notes = resolve(root)
    if not files:
        return SKIP, "no CLAUDE.md in this repo", []

    total = sum(count for _, count in files)
    details = [f"{count:5d}  {rel}" for rel, count in files] + notes
    override = (config or {}).get("maxLines")

    if override and total <= DEFAULT_BUDGET:
        expired = (
            f"{total} lines is inside the {DEFAULT_BUDGET}-line budget, "
            "delete health.memory from the manifest"
        )
        return FAIL, expired, details

    budget = override or DEFAULT_BUDGET
    if total > budget:
        return FAIL, f"{total} lines against a budget of {budget}", details

    reason = f"{total} of {budget} lines"
    if override:
        reason += ", on the over-budget ratchet — lower it as the file shrinks"
    return PASS, reason, details
