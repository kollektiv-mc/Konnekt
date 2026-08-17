#!/usr/bin/env python3
"""Build the changelog body for the nightly `snapshot` prerelease.

GitHub's own `releases/generate-notes` cannot do the two things a snapshot's
changelog needs:

  * It has no notion of *what* a pull request touched, so the website — which
    lives in this repo but ships to Cloudflare Pages, not into the binary —
    fills the notes of a build that does not contain a line of it.
  * It sorts purely by label, and this repo's pull requests are mostly
    unlabelled, so every one of them lands in "Other changes" while the
    handful that carry a label look like the only real work.

So this script does the same job with the changed-path filter and the
categorisation rules that a build's changelog actually wants. `.github/
release.yml` is left alone: tagged releases still use GitHub's generator, and
that file is what shapes them.

Reads (all required unless noted):

  GH_TOKEN   a token that can read this repository
  REPO       owner/name
  SHA        the commit the snapshot is built from
  BASE_TAG   the release the changelog is measured from
  SERVER     github.com base URL, for the compare link (optional)

Writes the markdown body to stdout. Exits non-zero on any failure, including a
missing BASE_TAG — the caller falls back to a plain compare link, which is the
same information without the shaping.
"""

from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

# Paths that never reach the binary: the marketing site, which ships to
# Cloudflare Pages on its own, and the two documentation trees, which are read
# in the repo. A pull request touching only these did not change the thing being
# downloaded, so it is left out of the notes entirely. One touching both still
# appears — its app-side half is real.
#
# agent_docs/ earns its place here rather than being pedantry: website work
# routinely updates the roadmap alongside the page it describes, and on
# website/ alone those pull requests came back as app changes through the back
# door.
NON_APP_PREFIXES = ("website/", "agent_docs/", "docs/")

# Labels win over any guess made from the title, because a label is a
# deliberate statement and a title is prose. Names come from the suite's
# taxonomy in kollektiv's design/labels.json.
FEATURE_LABELS = {"type:feature", "feature", "enhancement"}
FIX_LABELS = {"type:bug", "bug"}
OTHER_LABELS = {"type:chore", "type:docs", "chore", "documentation"}
SKIP_LABELS = {"changelog:skip"}

# Conventional-commit types, for the titles that carry one.
FEATURE_TYPES = {"feat", "feature", "perf"}
FIX_TYPES = {"fix", "bugfix", "hotfix"}
OTHER_TYPES = {"chore", "docs", "test", "tests", "refactor", "ci", "build", "style", "revert"}

# Last resort: the leading verb of the title. Most of this repo's pull requests
# are unlabelled prose, and "Add X" really is a feature and "Fix X" really is a
# fix. Deliberately short — a verb that does not clearly mean one or the other
# ("Rework", "Update", "Make", "Migrate") belongs in "Other changes", which is
# an honest answer rather than a wrong one.
FEATURE_VERBS = {
    "add", "adds", "added", "introduce", "introduces", "implement", "implements",
    "support", "supports", "publish", "publishes", "enable", "enables", "surface",
    "surfaces", "expose", "exposes", "allow", "allows", "ship", "ships",
}
FIX_VERBS = {
    "fix", "fixes", "fixed", "correct", "corrects", "repair", "repairs", "resolve",
    "resolves", "prevent", "prevents", "restore", "restores", "unbreak", "unbreaks",
    "patch", "patches", "harden", "hardens",
}

FEATURES, FIXES, OTHER = "Features", "Fixes", "Other changes"
SECTIONS = (FEATURES, FIXES, OTHER)

CONVENTIONAL = re.compile(r"^([a-z]+)(?:\([^)]*\))?!?:\s*")

API = os.environ.get("GITHUB_API_URL", "https://api.github.com").rstrip("/")


def api(path: str, **params: object) -> object:
    """GET one page of the REST API, decoded."""
    url = f"{API}{path}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {os.environ['GH_TOKEN']}",
            "User-Agent": "konnekt-snapshot-notes",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


def commits_in_range(repo: str, base: str, head: str) -> list[dict]:
    """Every commit reachable from `head` but not `base`.

    The compare endpoint caps a page at 250 commits and reports the true total,
    so page until they agree. The page ceiling only exists so a bad range can't
    spin forever; 2500 commits is far past any plausible snapshot window.
    """
    collected: list[dict] = []
    for page in range(1, 11):
        payload = api(f"/repos/{repo}/compare/{base}...{head}", page=page, per_page=250)
        collected.extend(payload.get("commits") or [])
        if len(collected) >= payload.get("total_commits", 0) or not payload.get("commits"):
            break
    return collected


def merged_pulls(repo: str, commits: list[dict]) -> list[dict]:
    """The merged pull requests those commits came from, oldest merge first.

    A commit can be associated with more than one pull request — its own, plus
    any still-open branch that has it — so this keeps only merged ones, and
    dedupes because every commit of a pull request names it.
    """
    pulls: dict[int, dict] = {}
    for commit in commits:
        for pull in api(f"/repos/{repo}/commits/{commit['sha']}/pulls", per_page=100):
            if pull.get("merged_at") and pull["number"] not in pulls:
                pulls[pull["number"]] = pull
    return sorted(pulls.values(), key=lambda pull: (pull["merged_at"], pull["number"]))


def touches_app(repo: str, number: int) -> bool:
    """Whether a pull request changed anything outside the non-app paths.

    Returns early on the first app-side file, so the common case — a pull
    request that is mostly app work — costs one page. An unreadable or
    absurdly large file list is reported as app-side: a changelog that keeps
    something it could not classify is better than one that quietly drops it.
    """
    for page in range(1, 31):
        files = api(f"/repos/{repo}/pulls/{number}/files", page=page, per_page=100)
        if not files:
            return False
        for changed in files:
            if not changed["filename"].startswith(NON_APP_PREFIXES):
                return True
        if len(files) < 100:
            return False
    return True


def section_for(pull: dict) -> str | None:
    """Which section a pull request belongs in, or None to leave it out."""
    labels = {label["name"].lower() for label in pull.get("labels") or []}
    if labels & SKIP_LABELS:
        return None
    if labels & FEATURE_LABELS:
        return FEATURES
    if labels & FIX_LABELS:
        return FIXES
    if labels & OTHER_LABELS:
        return OTHER

    title = (pull.get("title") or "").strip()
    conventional = CONVENTIONAL.match(title)
    if conventional:
        kind = conventional.group(1)
        if kind in FEATURE_TYPES:
            return FEATURES
        if kind in FIX_TYPES:
            return FIXES
        if kind in OTHER_TYPES:
            return OTHER
        # A prefix that isn't a conventional type is a scope someone wrote by
        # hand ("website: ..."). Drop it so the verb check below reads the
        # sentence rather than the scope.
        title = title[conventional.end():].strip()

    verb = re.sub(r"[^a-z]", "", title.split(" ")[0].lower()) if title else ""
    if verb in FEATURE_VERBS:
        return FEATURES
    if verb in FIX_VERBS:
        return FIXES
    return OTHER


def entry(pull: dict, server: str, repo: str) -> str:
    title = " ".join((pull.get("title") or f"Pull request #{pull['number']}").split())
    author = (pull.get("user") or {}).get("login")
    byline = f" by @{author}" if author else ""
    return f"* {title}{byline} in {server}/{repo}/pull/{pull['number']}"


def main() -> int:
    repo = os.environ["REPO"]
    head = os.environ["SHA"]
    base = os.environ.get("BASE_TAG", "").strip()
    server = os.environ.get("SERVER", "https://github.com").rstrip("/")

    if not base:
        print("no base tag to measure against", file=sys.stderr)
        return 1

    commits = commits_in_range(repo, base, head)
    grouped: dict[str, list[str]] = {section: [] for section in SECTIONS}
    skipped = 0

    for pull in merged_pulls(repo, commits):
        if not touches_app(repo, pull["number"]):
            skipped += 1
            continue
        section = section_for(pull)
        if section:
            grouped[section].append(entry(pull, server, repo))

    lines = ["## What's changed", ""]
    for section in SECTIONS:
        if grouped[section]:
            lines += [f"### {section}", *grouped[section], ""]

    if not any(grouped.values()):
        lines.append("No changes to the app since the last release.")
        lines.append("")

    if skipped:
        noun = "pull request" if skipped == 1 else "pull requests"
        lines.append(
            f"_{skipped} website and documentation {noun} left out — neither ships in this build._"
        )
        lines.append("")

    lines.append(f"**Full changelog**: {server}/{repo}/compare/{base}...{head}")
    print("\n".join(lines))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (urllib.error.URLError, urllib.error.HTTPError, KeyError, OSError) as error:
        print(f"could not build the changelog: {error}", file=sys.stderr)
        sys.exit(1)
